import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/security/operator_permissions.dart';
import '../entry/entry_controller.dart';
import '../sale/sale_lifecycle_controller.dart';
import 'customer_value_controller.dart';

Future<void> showCustomerCenter(
  BuildContext context, {
  required EntryController entry,
  required CustomerValueController controller,
  required SaleLifecycleController sales,
}) async {
  final state = entry.state;
  final operator = state.operator;
  final merchant = state.selectedTenant;
  final location = state.selectedBranch;
  if (operator == null || merchant == null || location == null) return;
  await Navigator.of(context).push<void>(
    MaterialPageRoute(
      builder: (_) => CustomerValueSurface(
        controller: controller,
        sales: sales,
        scope: CustomerValueScope(
          merchantId: merchant.id,
          locationId: location.id,
          operatorSessionId: operator.id,
        ),
        permissions: OperatorPermissions(operator.permissions),
      ),
    ),
  );
}

final class CustomerValueSurface extends StatefulWidget {
  const CustomerValueSurface({
    required this.controller,
    required this.sales,
    required this.scope,
    required this.permissions,
    super.key,
  });
  final CustomerValueController controller;
  final SaleLifecycleController sales;
  final CustomerValueScope scope;
  final OperatorPermissions permissions;

  @override
  State<CustomerValueSurface> createState() => _CustomerValueSurfaceState();
}

final class _CustomerValueSurfaceState extends State<CustomerValueSurface> {
  final _search = TextEditingController();

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
    widget.controller.search(widget.scope, '', recent: true);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    _search.dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  String _copy(String es, String en) =>
      Localizations.localeOf(context).languageCode == 'es' ? es : en;

  @override
  Widget build(BuildContext context) {
    final state = widget.controller.state;
    return Scaffold(
      appBar: AppBar(
        title: Text(_copy('Centro de clientes', 'Customer center')),
        actions: [
          if (widget.permissions.allows('customer.create'))
            IconButton(
              tooltip: _copy('Crear cliente', 'Create customer'),
              onPressed: state.busy ? null : _create,
              icon: const Icon(Icons.person_add_alt_1_outlined),
            ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: SearchBar(
                controller: _search,
                hintText: _copy(
                  'Busca por nombre, teléfono o correo',
                  'Search by name, phone, or email',
                ),
                leading: const Icon(Icons.search),
                onChanged: (value) =>
                    widget.controller.search(widget.scope, value),
              ),
            ),
            if (state.ambiguous)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text(
                  _copy(
                    'Hay varias coincidencias. Confirma el cliente.',
                    'There are several matches. Confirm the customer.',
                  ),
                ),
              ),
            if (state.errorCode != null)
              Semantics(
                liveRegion: true,
                child: ListTile(
                  leading: const Icon(Icons.error_outline),
                  title: Text(
                    _copy(
                      'No se completó la operación.',
                      'The operation did not finish.',
                    ),
                  ),
                  subtitle: Text(state.errorCode!),
                ),
              ),
            Expanded(
              child: state.selected == null
                  ? _customerList(state)
                  : _customerDetail(state),
            ),
          ],
        ),
      ),
    );
  }

  Widget _customerList(CustomerValueState state) {
    if (state.busy && state.customers.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state.customers.isEmpty) {
      return Center(
        child: Text(_copy('No hay clientes.', 'No customers found.')),
      );
    }
    return ListView.builder(
      itemCount: state.customers.length,
      itemBuilder: (_, index) {
        final customer = state.customers[index];
        final contact = customer.contacts.isEmpty
            ? null
            : customer.contacts.first['maskedValue'] as String?;
        return ListTile(
          leading: const CircleAvatar(child: Icon(Icons.person_outline)),
          title: Text(customer.displayName),
          subtitle: Text(
            contact?.isNotEmpty == true ? contact! : customer.publicReference,
          ),
          onTap: () => widget.controller.select(widget.scope, customer),
        );
      },
    );
  }

  Widget _customerDetail(CustomerValueState state) {
    final customer = state.selected!;
    final currentId = widget.sales.state.sale?.customer?['id'] as String?;
    final attached = currentId == customer.id;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            IconButton(
              tooltip: _copy('Volver', 'Back'),
              onPressed: widget.controller.deselect,
              icon: const Icon(Icons.arrow_back),
            ),
            Expanded(
              child: Text(
                customer.displayName,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
            ),
          ],
        ),
        Text(customer.publicReference),
        const SizedBox(height: 12),
        if (customer.contacts.isNotEmpty)
          ...customer.contacts.map(
            (contact) => ListTile(
              leading: Icon(
                contact['type'] == 'email'
                    ? Icons.email_outlined
                    : Icons.phone_outlined,
              ),
              title: Text((contact['maskedValue'] as String?) ?? ''),
              subtitle: Text(_copy('Contacto protegido', 'Protected contact')),
            ),
          ),
        ListTile(
          leading: const Icon(Icons.privacy_tip_outlined),
          title: Text(_copy('Consentimiento separado', 'Separate consent')),
          subtitle: Text(
            _copy(
              'Los recibos, la lealtad y el marketing usan decisiones distintas.',
              'Receipts, loyalty, and marketing use separate choices.',
            ),
          ),
        ),
        if (widget.permissions.allows(
          attached ? 'customer.detach' : 'customer.attach',
        ))
          FilledButton.icon(
            onPressed: () async {
              if (attached) {
                await widget.sales.detachCustomer();
              } else {
                await widget.sales.attachCustomer(
                  SaleCustomerSummary(
                    id: customer.id,
                    displayName: customer.displayName,
                    contactHint: customer.contacts.isEmpty
                        ? null
                        : customer.contacts.first['maskedValue'] as String?,
                  ),
                );
              }
              if (mounted) setState(() {});
            },
            icon: Icon(
              attached
                  ? Icons.person_remove_outlined
                  : Icons.person_add_outlined,
            ),
            label: Text(
              attached
                  ? _copy('Usar venta anónima', 'Use anonymous sale')
                  : _copy('Adjuntar a la venta', 'Attach to sale'),
            ),
          ),
        const SizedBox(height: 16),
        Text(
          _copy('Historial', 'History'),
          style: Theme.of(context).textTheme.titleMedium,
        ),
        if (state.busy) const LinearProgressIndicator(),
        if (state.history?.entries.isEmpty ?? true)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(
              _copy('No hay movimientos visibles.', 'No visible activity.'),
            ),
          )
        else
          ...state.history!.entries.map(
            (entry) => ListTile(
              leading: const Icon(Icons.receipt_long_outlined),
              title: Text((entry['publicReference'] as String?) ?? ''),
              subtitle: Text((entry['businessDate'] as String?) ?? ''),
            ),
          ),
      ],
    );
  }

  Future<void> _create() async {
    final name = TextEditingController();
    final email = TextEditingController();
    final phone = TextEditingController();
    var language = Localizations.localeOf(context).languageCode == 'es'
        ? 'es'
        : 'en';
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(_copy('Crear cliente mínimo', 'Create minimal customer')),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: name,
                  autofocus: true,
                  decoration: InputDecoration(
                    labelText: _copy('Nombre', 'Name'),
                  ),
                ),
                TextField(
                  controller: email,
                  keyboardType: TextInputType.emailAddress,
                  decoration: InputDecoration(
                    labelText: _copy('Correo opcional', 'Optional email'),
                  ),
                ),
                TextField(
                  controller: phone,
                  keyboardType: TextInputType.phone,
                  decoration: InputDecoration(
                    labelText: _copy('Teléfono opcional', 'Optional phone'),
                  ),
                ),
                DropdownButtonFormField<String>(
                  initialValue: language,
                  decoration: InputDecoration(
                    labelText: _copy('Idioma', 'Language'),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'es', child: Text('Español')),
                    DropdownMenuItem(value: 'en', child: Text('English')),
                  ],
                  onChanged: (value) =>
                      setDialogState(() => language = value ?? language),
                ),
                const SizedBox(height: 12),
                Text(
                  _copy(
                    'No se concede consentimiento de marketing.',
                    'Marketing consent is not granted.',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(_copy('Cancelar', 'Cancel')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(_copy('Crear', 'Create')),
            ),
          ],
        ),
      ),
    );
    if (accepted == true) {
      await widget.controller.create(
        widget.scope,
        displayName: name.text,
        email: email.text,
        phone: phone.text,
        language: language,
      );
    }
    name.dispose();
    email.dispose();
    phone.dispose();
  }
}
