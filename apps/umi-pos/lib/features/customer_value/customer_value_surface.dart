import 'package:flutter/rendering.dart' show ScrollCacheExtent;
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import '../../core/errors/operator_error_message.dart';
import '../../core/security/operator_permissions.dart';
import '../../shared/widgets/station_document.dart';
import '../cash/money_input.dart';
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
    PosPageRoute(
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
    return PosPage(
      appBar: PosHeader(
        title: StationHeading(
          title: _copy('Centro de clientes', 'Customer center'),
        ),
        actions: [
          if (widget.permissions.allows('customer.create'))
            PosIconButton(
              tooltip: _copy('Crear cliente', 'Create customer'),
              onPressed: state.busy ? null : _create,
              icon: const PosIcon(PosGlyphs.personAddAlt1Outlined),
            ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              // A `PosField` on the shared `inputDecorationTheme`, the same
              // field the catalog searches with. `SearchBar` publishes a 24 px
              // `<input>` inside its 48 px pill, so the editable region — the
              // node a screen reader and the sweep both measure — was under
              // the touch floor while the pill looked fine.
              child: PosField(
                controller: _search,
                textInputAction: TextInputAction.search,
                decoration: PosFieldDecoration(
                  prefixIcon: const PosIcon(PosGlyphs.search),
                  hintText: _copy(
                    'Busca por nombre, teléfono o correo',
                    'Search by name, phone, or email',
                  ),
                ),
                onChanged: (value) =>
                    widget.controller.search(widget.scope, value),
                onSubmitted: (value) =>
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
                child: PosListRow(
                  leading: const PosIcon(PosGlyphs.errorOutline),
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
      return const Center(child: PosSpinner());
    }
    if (state.customers.isEmpty) {
      return Center(
        child: Text(_copy('No hay clientes.', 'No customers found.')),
      );
    }
    return ListView.builder(
      itemCount: state.customers.length,
      // Every row is 72 px and the first page is short, so cache the whole
      // result rather than letting the scrollable clip the last row's
      // published rect to its 250 px cache window — a 10 px tall button in the
      // accessibility tree for a full-height row.
      scrollCacheExtent: const ScrollCacheExtent.viewport(2),
      itemBuilder: (_, index) {
        final customer = state.customers[index];
        final contact = customer.contacts.isEmpty
            ? null
            : customer.contacts.first['maskedValue'] as String?;
        return PosListRow(
          leading: const PosAvatar(child: PosIcon(PosGlyphs.personOutline)),
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
            PosIconButton(
              tooltip: _copy('Volver', 'Back'),
              onPressed: widget.controller.deselect,
              icon: const PosIcon(PosGlyphs.arrowBack),
            ),
            Expanded(
              child: Text(
                customer.displayName,
                style: PosTheme.of(context).textTheme.headlineSmall,
              ),
            ),
          ],
        ),
        Text(customer.publicReference),
        const SizedBox(height: 12),
        if (customer.contacts.isNotEmpty)
          ...customer.contacts.map(
            (contact) => PosListRow(
              leading: PosIcon(
                contact['type'] == 'email'
                    ? PosGlyphs.emailOutlined
                    : PosGlyphs.phoneOutlined,
              ),
              title: Text((contact['maskedValue'] as String?) ?? ''),
              subtitle: Text(_copy('Contacto protegido', 'Protected contact')),
            ),
          ),
        PosListRow(
          leading: const PosIcon(PosGlyphs.privacyTipOutlined),
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
        )) ...[
          PosButton.icon(
            // Offered only while there is a sale it can change. The command
            // behind it returns in silence when there is none, so a button that
            // looks ready would leave the operator tapping at nothing. It stands
            // down, and says why, instead.
            onPressed: widget.sales.canEditSale
                ? () async {
                    if (attached) {
                      await widget.sales.detachCustomer();
                    } else {
                      await widget.sales.attachCustomer(
                        SaleCustomerSummary(
                          id: customer.id,
                          displayName: customer.displayName,
                          contactHint: customer.contacts.isEmpty
                              ? null
                              : customer.contacts.first['maskedValue']
                                    as String?,
                        ),
                      );
                    }
                    if (mounted) setState(() {});
                  }
                : null,
            icon: PosIcon(
              attached
                  ? PosGlyphs.personRemoveOutlined
                  : PosGlyphs.personAddOutlined,
            ),
            label: Text(
              attached
                  ? _copy('Usar venta anónima', 'Use anonymous sale')
                  : _copy('Adjuntar a la venta', 'Attach to sale'),
            ),
          ),
          if (!widget.sales.canEditSale)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                _copy(
                  'Empieza o reanuda una venta para adjuntar un cliente.',
                  'Start or resume a sale to attach a customer.',
                ),
                style: PosTheme.of(context).textTheme.bodySmall,
              ),
            ),
        ],
        if (state.history?.pointsBalance case final points?)
          PosCard(
            child: PosListRow(
              leading: const PosIcon(PosGlyphs.starsOutlined),
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
              PosOutlineButton.icon(
                onPressed: state.busy || state.history?.loyaltyAccount == null
                    ? null
                    : _adjustPoints,
                icon: const PosIcon(PosGlyphs.tune),
                label: Text(_copy('Ajustar puntos', 'Adjust points')),
              ),
            if (widget.permissions.allows('gift_card.issue'))
              PosOutlineButton.icon(
                onPressed: state.busy ? null : _issueGiftCard,
                icon: const PosIcon(PosGlyphs.cardGiftcard),
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
                style: PosTheme.of(context).textTheme.titleMedium,
              ),
            ),
            PosSelect<String>(
              value: _historyCategory,
              items: const [
                PosSelectItem(value: 'all', child: Text('Todo / All')),
                PosSelectItem(value: 'sale', child: Text('Ventas / Sales')),
                PosSelectItem(
                  value: 'exception',
                  child: Text('Reembolsos / Refunds'),
                ),
                PosSelectItem(value: 'loyalty', child: Text('Puntos / Points')),
                PosSelectItem(value: 'reward', child: Text('Rewards')),
                PosSelectItem(value: 'wallet', child: Text('Wallet')),
                PosSelectItem(value: 'gift_card', child: Text('Gift cards')),
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
        if (state.busy) const PosProgress(),
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
          PosTextButton.icon(
            onPressed: state.busy
                ? null
                : () => widget.controller.loadMoreHistory(
                    widget.scope,
                    category: _historyCategory,
                  ),
            icon: const PosIcon(PosGlyphs.expandMore),
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
    // Money here goes through the app's single formatter. The row used to print
    // the raw minor units beside the currency code, so a MXN 20.00 wallet hold
    // read `2000 MXN` and a MXN 500.00 gift card read `50000 MXN` — a
    // hundredfold overstatement of the customer's own money. Both figures are
    // the ledger's own numbers (`loyalty_stored_value_ledger.amount_minor_units`,
    // `loyalty_gift_card.amount_cents`), measured on the iMin D3-504 on
    // 2026-10-11.
    final detail = points != null
        ? '$points ${_copy('puntos', 'points')}'
        : total != null
        ? formatMinorUnits(
            (total['minorUnits'] as num?)?.toInt() ?? 0,
            total['currency'] as String? ?? '',
          )
        : entry['status'] as String? ?? '';
    return PosListRow(
      leading: const PosIcon(PosGlyphs.receiptLongOutlined),
      title: Text('$label · ${entry['publicReference'] ?? ''}'),
      subtitle: Text('${entry['businessDate'] ?? ''} · $detail'),
    );
  }

  Future<void> _adjustPoints() async {
    final amount = TextEditingController();
    final note = TextEditingController();
    var direction = 'increase';
    var reason = 'customer_service_correction';
    final accepted = await showPosDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => PosAlertDialog(
          title: Text(_copy('Ajustar puntos', 'Adjust points')),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                PosSelectFormField<String>(
                  initialValue: direction,
                  decoration: PosFieldDecoration(
                    labelText: _copy('Dirección', 'Direction'),
                  ),
                  items: [
                    PosSelectItem(
                      value: 'increase',
                      child: Text(_copy('Aumentar', 'Increase')),
                    ),
                    PosSelectItem(
                      value: 'decrease',
                      child: Text(_copy('Disminuir', 'Decrease')),
                    ),
                  ],
                  onChanged: (value) =>
                      setDialogState(() => direction = value ?? direction),
                ),
                PosField(
                  controller: amount,
                  autofocus: true,
                  keyboardType: TextInputType.number,
                  decoration: PosFieldDecoration(
                    labelText: _copy('Puntos', 'Points'),
                  ),
                ),
                PosSelectFormField<String>(
                  initialValue: reason,
                  decoration: PosFieldDecoration(
                    labelText: _copy('Motivo', 'Reason'),
                  ),
                  items: [
                    PosSelectItem(
                      value: 'customer_service_correction',
                      child: Text(
                        _copy('Corrección de servicio', 'Service correction'),
                      ),
                    ),
                    PosSelectItem(
                      value: 'operational_correction',
                      child: Text(
                        _copy('Corrección operativa', 'Operational correction'),
                      ),
                    ),
                    PosSelectItem(
                      value: 'fraud_correction',
                      child: Text(
                        _copy('Corrección por fraude', 'Fraud correction'),
                      ),
                    ),
                  ],
                  onChanged: (value) =>
                      setDialogState(() => reason = value ?? reason),
                ),
                PosField(
                  controller: note,
                  maxLength: 240,
                  decoration: PosFieldDecoration(
                    labelText: _copy('Nota opcional', 'Optional note'),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            PosTextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: Text(_copy('Cancelar', 'Cancel')),
            ),
            PosButton(
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
    final confirmed = await showPosDialog<bool>(
      context: context,
      builder: (context) => PosAlertDialog(
        title: Text(_copy('Confirma el ajuste', 'Confirm adjustment')),
        content: Text(
          '${_copy('Saldo actual', 'Current balance')}: ${preview.currentAvailable}\n'
          '${_copy('Saldo final', 'Final balance')}: ${preview.projectedAvailable}',
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(_copy('Cancelar', 'Cancel')),
          ),
          PosButton(
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
      // No confirmation bar. `select` below re-reads the account, so the
      // adjustment is on screen the moment it lands; a bar that slides up to
      // announce it covers the bottom of the screen to repeat what the ledger
      // row already says.
      await widget.controller.select(
        widget.scope,
        widget.controller.state.selected!,
      );
    }
  }

  Future<void> _issueGiftCard() async {
    final amount = TextEditingController();
    final accepted = await showPosDialog<bool>(
      context: context,
      builder: (dialogContext) => PosAlertDialog(
        title: Text(_copy('Emitir tarjeta de regalo', 'Issue gift card')),
        content: PosField(
          controller: amount,
          autofocus: true,
          keyboardType: TextInputType.number,
          decoration: PosFieldDecoration(
            labelText: _copy('Valor en centavos', 'Value in minor units'),
            helperText: _copy(
              'Ejemplo: 50000 = MXN 500.00',
              'Example: 50000 = MXN 500.00',
            ),
          ),
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(_copy('Cancelar', 'Cancel')),
          ),
          PosButton(
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
    final confirmed = await showPosDialog<bool>(
      context: context,
      builder: (context) => PosAlertDialog(
        title: Text(_copy('Confirma la emisión', 'Confirm issuance')),
        // The preview's own figures, in the app's one money format. Printed raw
        // they read `50000 MXN` for a MXN 500.00 card — the operator's last
        // chance to say no, saying something that looks like a 100× mistake.
        content: Text(
          '${formatMinorUnits(preview.valueMinorUnits, preview.currency)}\n'
          '${_copy('Límite', 'Limit')}: '
          '${formatMinorUnits(preview.maximumValueMinorUnits, preview.currency)}',
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(_copy('Cancelar', 'Cancel')),
          ),
          PosButton(
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
    await showPosDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => PosAlertDialog(
        title: Text(_copy('Código de entrega única', 'One-time delivery code')),
        content: PosSelectableText('${secret.maskedReference}\n${secret.code}'),
        actions: [
          PosButton(
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
    final accepted = await showPosDialog<bool>(
      context: context,
      builder: (dialogContext) => PosAlertDialog(
        title: Text(_copy('Aprobación del responsable', 'Manager approval')),
        content: PosField(
          controller: pin,
          obscureText: true,
          keyboardType: TextInputType.number,
          decoration: PosFieldDecoration(
            labelText: _copy('PIN del responsable', 'Manager PIN'),
          ),
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(_copy('Cancelar', 'Cancel')),
          ),
          PosButton(
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
    final accepted = await showPosDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => PosAlertDialog(
          title: Text(_copy('Crear cliente mínimo', 'Create minimal customer')),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                PosField(
                  controller: name,
                  autofocus: true,
                  decoration: PosFieldDecoration(
                    labelText: _copy('Nombre', 'Name'),
                  ),
                ),
                PosField(
                  controller: email,
                  keyboardType: TextInputType.emailAddress,
                  decoration: PosFieldDecoration(
                    labelText: _copy('Correo opcional', 'Optional email'),
                  ),
                ),
                PosField(
                  controller: phone,
                  keyboardType: TextInputType.phone,
                  decoration: PosFieldDecoration(
                    labelText: _copy('Teléfono opcional', 'Optional phone'),
                  ),
                ),
                PosSelectFormField<String>(
                  initialValue: language,
                  decoration: PosFieldDecoration(
                    labelText: _copy('Idioma', 'Language'),
                  ),
                  items: const [
                    PosSelectItem(value: 'es', child: Text('Español')),
                    PosSelectItem(value: 'en', child: Text('English')),
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
            PosTextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(_copy('Cancelar', 'Cancel')),
            ),
            PosButton(
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
