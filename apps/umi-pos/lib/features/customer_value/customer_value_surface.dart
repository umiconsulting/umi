import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/operator_error_message.dart';
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
        entry: entry,
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
    required this.entry,
    required this.controller,
    required this.sales,
    required this.scope,
    required this.permissions,
    super.key,
  });
  final EntryController entry;
  final CustomerValueController controller;
  final SaleLifecycleController sales;
  final CustomerValueScope scope;
  final OperatorPermissions permissions;

  @override
  State<CustomerValueSurface> createState() => _CustomerValueSurfaceState();
}

final class _CustomerValueSurfaceState extends State<CustomerValueSurface> {
  final _search = TextEditingController();
  String _historyCategory = 'all';

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
                  subtitle: Text(
                    operatorErrorMessage(context, state.errorCode!),
                  ),
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
        if (state.history?.pointsBalance case final points?)
          Card(
            child: ListTile(
              leading: const Icon(Icons.stars_outlined),
              title: Text(_copy('Puntos disponibles', 'Available points')),
              trailing: Text('${points['available'] ?? 0}'),
              subtitle: Text(
                _copy(
                  'Pendientes: ${points['pending'] ?? 0}',
                  'Pending: ${points['pending'] ?? 0}',
                ),
              ),
            ),
          ),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (widget.permissions.allows('loyalty.adjust'))
              OutlinedButton.icon(
                onPressed: state.busy || state.history?.loyaltyAccount == null
                    ? null
                    : _adjustPoints,
                icon: const Icon(Icons.tune),
                label: Text(_copy('Ajustar puntos', 'Adjust points')),
              ),
            if (widget.permissions.allows('gift_card.issue'))
              OutlinedButton.icon(
                onPressed: state.busy ? null : _issueGiftCard,
                icon: const Icon(Icons.card_giftcard),
                label: Text(_copy('Emitir tarjeta', 'Issue gift card')),
              ),
          ],
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: Text(
                _copy('Historial', 'History'),
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            DropdownButton<String>(
              value: _historyCategory,
              items: const [
                DropdownMenuItem(value: 'all', child: Text('Todo / All')),
                DropdownMenuItem(value: 'sale', child: Text('Ventas / Sales')),
                DropdownMenuItem(
                  value: 'exception',
                  child: Text('Reembolsos / Refunds'),
                ),
                DropdownMenuItem(
                  value: 'loyalty',
                  child: Text('Puntos / Points'),
                ),
                DropdownMenuItem(value: 'reward', child: Text('Rewards')),
                DropdownMenuItem(value: 'wallet', child: Text('Wallet')),
                DropdownMenuItem(value: 'gift_card', child: Text('Gift cards')),
              ],
              onChanged: state.busy
                  ? null
                  : (value) async {
                      if (value == null) return;
                      setState(() => _historyCategory = value);
                      await widget.controller.select(
                        widget.scope,
                        customer,
                        category: value,
                      );
                    },
            ),
          ],
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
          ...state.history!.entries.map(_historyTile),
        if (state.history?.nextCursor != null)
          TextButton.icon(
            onPressed: state.busy
                ? null
                : () => widget.controller.loadMoreHistory(
                    widget.scope,
                    category: _historyCategory,
                  ),
            icon: const Icon(Icons.expand_more),
            label: Text(_copy('Cargar más', 'Load more')),
          ),
      ],
    );
  }

  Widget _historyTile(Map<String, Object?> entry) {
    final type = entry['type'] as String? ?? 'sale';
    final label = switch (type) {
      'sale' => _copy('Venta', 'Sale'),
      'receipt' => _copy('Recibo', 'Receipt'),
      'refund' => _copy('Reembolso', 'Refund'),
      'void' => _copy('Anulación', 'Void'),
      'points_earn' => _copy('Puntos', 'Points'),
      'reward' => _copy('Recompensa', 'Reward'),
      'wallet' => _copy('Wallet', 'Wallet'),
      'gift_card' => _copy('Tarjeta de regalo', 'Gift card'),
      'consent' => _copy('Consentimiento', 'Consent'),
      _ => _copy('Movimiento', 'Activity'),
    };
    final points = entry['points'];
    final total = entry['total'] as Map<String, Object?>?;
    final detail = points != null
        ? '$points ${_copy('puntos', 'points')}'
        : total != null
        ? '${total['minorUnits']} ${total['currency']}'
        : entry['status'] as String? ?? '';
    return ListTile(
      leading: const Icon(Icons.receipt_long_outlined),
      title: Text('$label · ${entry['publicReference'] ?? ''}'),
      subtitle: Text('${entry['businessDate'] ?? ''} · $detail'),
    );
  }

  Future<void> _adjustPoints() async {
    final amount = TextEditingController();
    final note = TextEditingController();
    var direction = 'increase';
    var reason = 'customer_service_correction';
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(_copy('Ajustar puntos', 'Adjust points')),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: direction,
                  decoration: InputDecoration(
                    labelText: _copy('Dirección', 'Direction'),
                  ),
                  items: [
                    DropdownMenuItem(
                      value: 'increase',
                      child: Text(_copy('Aumentar', 'Increase')),
                    ),
                    DropdownMenuItem(
                      value: 'decrease',
                      child: Text(_copy('Disminuir', 'Decrease')),
                    ),
                  ],
                  onChanged: (value) =>
                      setDialogState(() => direction = value ?? direction),
                ),
                TextField(
                  controller: amount,
                  autofocus: true,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
                    labelText: _copy('Puntos', 'Points'),
                  ),
                ),
                DropdownButtonFormField<String>(
                  initialValue: reason,
                  decoration: InputDecoration(
                    labelText: _copy('Motivo', 'Reason'),
                  ),
                  items: [
                    DropdownMenuItem(
                      value: 'customer_service_correction',
                      child: Text(
                        _copy('Corrección de servicio', 'Service correction'),
                      ),
                    ),
                    DropdownMenuItem(
                      value: 'operational_correction',
                      child: Text(
                        _copy('Corrección operativa', 'Operational correction'),
                      ),
                    ),
                    DropdownMenuItem(
                      value: 'fraud_correction',
                      child: Text(
                        _copy('Corrección por fraude', 'Fraud correction'),
                      ),
                    ),
                  ],
                  onChanged: (value) =>
                      setDialogState(() => reason = value ?? reason),
                ),
                TextField(
                  controller: note,
                  maxLength: 240,
                  decoration: InputDecoration(
                    labelText: _copy('Nota opcional', 'Optional note'),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: Text(_copy('Cancelar', 'Cancel')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: Text(_copy('Revisar', 'Review')),
            ),
          ],
        ),
      ),
    );
    final points = int.tryParse(amount.text);
    amount.dispose();
    if (accepted != true || points == null || points <= 0) {
      note.dispose();
      return;
    }
    final preview = await widget.controller.previewPointsAdjustment(
      widget.scope,
      direction: direction,
      points: points,
      reason: reason,
      note: note.text.trim().isEmpty ? null : note.text.trim(),
    );
    note.dispose();
    if (!mounted || preview == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(_copy('Confirma el ajuste', 'Confirm adjustment')),
        content: Text(
          '${_copy('Saldo actual', 'Current balance')}: ${preview.currentAvailable}\n'
          '${_copy('Saldo final', 'Final balance')}: ${preview.projectedAvailable}',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(_copy('Cancelar', 'Cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(_copy('Confirmar', 'Confirm')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    String? approvalId;
    if (preview.approvalPermission != null) {
      approvalId = await _requestApproval(
        preview.approvalPermission!,
        preview.fingerprint,
      );
      if (approvalId == null) return;
    }
    final result = await widget.controller.commitPointsAdjustment(
      widget.scope,
      approvalId: approvalId,
      approvalFingerprint: approvalId == null ? null : preview.fingerprint,
    );
    if (result != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_copy('Ajuste registrado.', 'Adjustment recorded.')),
        ),
      );
      await widget.controller.select(
        widget.scope,
        widget.controller.state.selected!,
      );
    }
  }

  Future<void> _issueGiftCard() async {
    final amount = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_copy('Emitir tarjeta de regalo', 'Issue gift card')),
        content: TextField(
          controller: amount,
          autofocus: true,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(
            labelText: _copy('Valor en centavos', 'Value in minor units'),
            helperText: _copy(
              'Ejemplo: 50000 = MXN 500.00',
              'Example: 50000 = MXN 500.00',
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(_copy('Cancelar', 'Cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(_copy('Revisar', 'Review')),
          ),
        ],
      ),
    );
    final value = int.tryParse(amount.text);
    amount.dispose();
    if (accepted != true || value == null || value <= 0 || !mounted) return;
    final preview = await widget.controller.previewGiftCardIssuance(
      widget.scope,
      valueMinorUnits: value,
      currency: 'MXN',
    );
    if (!mounted || preview == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(_copy('Confirma la emisión', 'Confirm issuance')),
        content: Text(
          '${preview.valueMinorUnits} ${preview.currency}\n'
          '${_copy('Límite', 'Limit')}: ${preview.maximumValueMinorUnits}',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(_copy('Cancelar', 'Cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(_copy('Confirmar', 'Confirm')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    String? approvalId;
    if (preview.approvalPermission != null) {
      approvalId = await _requestApproval(
        preview.approvalPermission!,
        preview.fingerprint,
      );
      if (approvalId == null) return;
    }
    final result = await widget.controller.issueGiftCard(
      widget.scope,
      approvalId: approvalId,
      approvalFingerprint: approvalId == null ? null : preview.fingerprint,
    );
    if (result == null || !mounted) return;
    final secret = await widget.controller.revealGiftCardSecret(
      widget.scope,
      result.deliveryToken,
    );
    if (secret == null || !mounted) return;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: Text(_copy('Código de entrega única', 'One-time delivery code')),
        content: SelectableText('${secret.maskedReference}\n${secret.code}'),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: Text(_copy('Código entregado', 'Code delivered')),
          ),
        ],
      ),
    );
  }

  Future<String?> _requestApproval(
    String permission,
    String fingerprint,
  ) async {
    final pin = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_copy('Aprobación del responsable', 'Manager approval')),
        content: TextField(
          controller: pin,
          obscureText: true,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(
            labelText: _copy('PIN del responsable', 'Manager PIN'),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(_copy('Cancelar', 'Cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(_copy('Aprobar', 'Approve')),
          ),
        ],
      ),
    );
    final value = pin.text;
    pin.dispose();
    if (accepted != true || value.isEmpty) return null;
    return widget.entry.requestCheckoutApproval(
      managerPin: value,
      permission: permission,
      commandFingerprint: fingerprint,
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
