import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/security/operator_permissions.dart';
import '../entry/entry_controller.dart';
import 'inventory_controller.dart';

Future<void> showInventoryCenter(
  BuildContext context, {
  required EntryController entry,
  required InventoryController controller,
}) async {
  final state = entry.state;
  final operator = state.operator;
  final merchant = state.selectedTenant;
  final location = state.selectedBranch;
  if (operator == null || merchant == null || location == null) return;
  final scope = InventoryScope(
    merchantId: merchant.id,
    locationId: location.id,
    operatorSessionId: operator.id,
  );
  await Navigator.of(context).push<void>(
    MaterialPageRoute(
      builder: (_) => InventorySurface(
        controller: controller,
        scope: scope,
        permissions: OperatorPermissions(operator.permissions),
        entry: entry,
      ),
    ),
  );
}

final class InventorySurface extends StatefulWidget {
  const InventorySurface({
    required this.controller,
    required this.scope,
    required this.permissions,
    this.entry,
    super.key,
  });
  final InventoryController controller;
  final InventoryScope scope;
  final OperatorPermissions permissions;
  final EntryController? entry;

  @override
  State<InventorySurface> createState() => _InventorySurfaceState();
}

final class _InventorySurfaceState extends State<InventorySurface> {
  final Map<String, TextEditingController> _countInputs = {};
  final Map<String, String> _varianceReasons = {};

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
    widget.controller.load(widget.scope);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    for (final controller in _countInputs.values) {
      controller.dispose();
    }
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
    final overview = state.overview;
    final historyCount = state.history?.entries.length ?? 0;
    final hasMoreHistory = state.history?.page['hasMore'] == true;
    final blindCountActive =
        state.count?.count['status'] == 'counting' &&
        state.count?.count['blind'] == true;
    return Scaffold(
      appBar: AppBar(
        title: Text(_copy('Operaciones de inventario', 'Inventory operations')),
        actions: [
          IconButton(
            tooltip: _copy('Actualizar', 'Refresh'),
            onPressed: state.busy
                ? null
                : () => widget.controller.load(widget.scope),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: SafeArea(
        child: overview == null
            ? Center(
                child: state.errorCode == null
                    ? const CircularProgressIndicator()
                    : _Failure(
                        message: _error(state.errorCode!),
                        retry: () => widget.controller.load(widget.scope),
                      ),
              )
            : Column(
                children: [
                  if (state.errorCode != null)
                    MaterialBanner(
                      content: Text(_error(state.errorCode!)),
                      actions: [
                        TextButton(
                          onPressed: () => widget.controller.load(widget.scope),
                          child: Text(_copy('Reintentar', 'Retry')),
                        ),
                      ],
                    ),
                  _Header(
                    location: overview.locations.isEmpty
                        ? '—'
                        : overview.locations.first['displayName']! as String,
                    policy: overview.policy['version']! as String,
                    offlineBlocked:
                        overview.policy['offlineMutationsAllowed'] != true,
                  ),
                  if (overview.restockReviews.isNotEmpty &&
                      widget.permissions.allows('inventory.restock.resolve'))
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: overview.restockReviews
                            .map(
                              (review) => Card(
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    crossAxisAlignment:
                                        WrapCrossAlignment.center,
                                    children: [
                                      Text(
                                        _copy(
                                          'Decisión de devolución pendiente',
                                          'Pending refund disposition',
                                        ),
                                      ),
                                      FilledButton.tonal(
                                        onPressed: state.busy
                                            ? null
                                            : () => _restockDialog(review),
                                        child: Text(
                                          _copy(
                                            'Revisar componentes',
                                            'Review components',
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            )
                            .toList(),
                      ),
                    ),
                  if (widget.permissions.allows('inventory.count.create'))
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: FilledButton.icon(
                          onPressed: state.busy
                              ? null
                              : () =>
                                    widget.controller.startCount(widget.scope),
                          icon: const Icon(Icons.fact_check_outlined),
                          label: Text(
                            _copy('Iniciar conteo ciego', 'Start blind count'),
                          ),
                        ),
                      ),
                    ),
                  if (state.count != null && !blindCountActive)
                    _countPanel(state.count!),
                  Expanded(
                    child: blindCountActive
                        ? SingleChildScrollView(
                            padding: const EdgeInsets.only(bottom: 16),
                            child: _countPanel(state.count!),
                          )
                        : ListView.builder(
                            padding: const EdgeInsets.all(16),
                            itemCount:
                                overview.items.length +
                                historyCount +
                                1 +
                                (hasMoreHistory ? 1 : 0),
                            itemBuilder: (context, index) {
                              if (index < overview.items.length) {
                                final item = overview.items[index];
                                final balance = _balance(item['id']! as String);
                                return Padding(
                                  padding: const EdgeInsets.only(bottom: 8),
                                  child: _InventoryItemCard(
                                    item: item,
                                    balance: balance,
                                    busy: state.busy,
                                    permissions: widget.permissions,
                                    onAction: (action) =>
                                        _quantityDialog(item, action),
                                  ),
                                );
                              }
                              final historyIndex =
                                  index - overview.items.length;
                              if (historyIndex == 0) {
                                return Padding(
                                  padding: const EdgeInsets.fromLTRB(
                                    4,
                                    20,
                                    4,
                                    8,
                                  ),
                                  child: Text(
                                    _copy(
                                      'Historial inmutable',
                                      'Immutable history',
                                    ),
                                    style: Theme.of(
                                      context,
                                    ).textTheme.titleLarge,
                                  ),
                                );
                              }
                              if (historyIndex > historyCount) {
                                return Padding(
                                  padding: const EdgeInsets.symmetric(
                                    vertical: 12,
                                  ),
                                  child: Center(
                                    child: OutlinedButton(
                                      onPressed: state.busy
                                          ? null
                                          : () => widget.controller
                                                .loadMoreHistory(widget.scope),
                                      child: Text(
                                        _copy(
                                          'Cargar más movimientos',
                                          'Load more movements',
                                        ),
                                      ),
                                    ),
                                  ),
                                );
                              }
                              final entry =
                                  state.history!.entries[historyIndex - 1];
                              return _HistoryTile(
                                entry: entry,
                                label: _entryLabel(entry['type']! as String),
                              );
                            },
                          ),
                  ),
                ],
              ),
      ),
    );
  }

  Widget _countPanel(InventoryCountResult result) {
    final count = result.count;
    final status = count['status']! as String;
    if (status == 'counting') {
      return Card(
        margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
        child: ExpansionTile(
          initiallyExpanded: true,
          title: Text(_copy('Conteo ciego activo', 'Active blind count')),
          subtitle: Text(
            _copy(
              'Registra cada cantidad. El sistema mostrará la varianza al enviar.',
              'Enter each quantity. The system shows variance after submission.',
            ),
          ),
          children: [
            for (final item in widget.controller.state.overview!.items)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
                child: TextField(
                  controller: _countInputs.putIfAbsent(
                    item['id']! as String,
                    () => TextEditingController(),
                  ),
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
                    labelText: item['displayName']! as String,
                    suffixText: item['baseUnit']! as String,
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Align(
                alignment: Alignment.centerRight,
                child: FilledButton(
                  onPressed: widget.controller.state.busy
                      ? null
                      : () => widget.controller.submitCount(widget.scope, {
                          for (final entry in _countInputs.entries)
                            if (int.tryParse(entry.value.text)
                                case final value?)
                              if (value >= 0) entry.key: value,
                        }),
                  child: Text(_copy('Enviar conteo', 'Submit count')),
                ),
              ),
            ),
          ],
        ),
      );
    }
    return Card(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              status == 'committed'
                  ? _copy('Conteo reconciliado', 'Reconciled count')
                  : _copy('Varianza del conteo', 'Count variance'),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            for (final variance in result.variances)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: DropdownButtonFormField<String>(
                  initialValue:
                      _varianceReasons[variance['inventoryItemId']! as String],
                  decoration: InputDecoration(
                    labelText:
                        '${_itemName(variance['inventoryItemId']! as String)} · '
                        '${(variance['signed']! as Map<String, Object?>)['value']}',
                  ),
                  hint: Text(
                    _copy('Selecciona el motivo', 'Select the reason'),
                  ),
                  items: _varianceReasonItems(),
                  onChanged: (value) {
                    if (value == null) return;
                    setState(() {
                      _varianceReasons[variance['inventoryItemId']! as String] =
                          value;
                    });
                  },
                ),
              ),
            if (status != 'committed' &&
                widget.permissions.allows('inventory.count.reconcile')) ...[
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed:
                    widget.controller.state.busy ||
                        !_hasAllVarianceReasons(result)
                    ? null
                    : () async {
                        await widget.controller.reconcileCount(
                          widget.scope,
                          Map.unmodifiable(_varianceReasons),
                        );
                        if (mounted &&
                            widget.controller.state.pendingReconciliation !=
                                null) {
                          await _approvalDialog();
                        }
                      },
                icon: const Icon(Icons.balance_outlined),
                label: Text(
                  _copy('Solicitar reconciliación', 'Request reconciliation'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _approvalDialog() async {
    final entry = widget.entry;
    final permission = widget.controller.state.approvalPermission;
    final fingerprint = widget.controller.state.approvalFingerprint;
    if (entry == null || permission == null || fingerprint == null) return;
    final pin = TextEditingController();
    final approved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(
          _copy(
            'Se requiere una aprobación independiente',
            'Independent approval required',
          ),
        ),
        content: TextField(
          controller: pin,
          autofocus: true,
          obscureText: true,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(
            labelText: _copy('PIN del aprobador', 'Approver PIN'),
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
    if (!(approved ?? false)) {
      pin.dispose();
      return;
    }
    final approvalId = await entry.requestCheckoutApproval(
      managerPin: pin.text,
      permission: permission,
      commandFingerprint: fingerprint,
    );
    pin.dispose();
    if (approvalId != null) {
      if (widget.controller.state.pendingReconciliation != null) {
        await widget.controller.approveReconciliation(widget.scope, approvalId);
      } else {
        await widget.controller.approvePendingOperation(
          widget.scope,
          approvalId,
        );
      }
    }
  }

  String _itemName(String itemId) {
    for (final item in widget.controller.state.overview!.items) {
      if (item['id'] == itemId) return item['displayName']! as String;
    }
    return _copy('Artículo de inventario', 'Inventory item');
  }

  Map<String, Object?>? _balance(String itemId) {
    for (final balance in widget.controller.state.overview!.balances) {
      if (balance['inventoryItemId'] == itemId) return balance;
    }
    return null;
  }

  Future<void> _quantityDialog(Map<String, Object?> item, String action) async {
    final input = TextEditingController(text: '1');
    final quantity = await showDialog<int>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('${_actionLabel(action)} · ${item['displayName']}'),
        content: TextField(
          controller: input,
          autofocus: true,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(
            labelText: _copy('Cantidad escalada', 'Scaled quantity'),
            helperText: _copy(
              'La API valida la unidad y la escala.',
              'The API validates the unit and scale.',
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text(_copy('Cancelar', 'Cancel')),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(dialogContext, int.tryParse(input.text)),
            child: Text(_copy('Confirmar', 'Confirm')),
          ),
        ],
      ),
    );
    input.dispose();
    if (quantity == null || quantity <= 0) return;
    switch (action) {
      case 'increase':
      case 'decrease':
        await widget.controller.adjust(
          widget.scope,
          item: item,
          direction: action,
          quantity: quantity,
        );
      case 'waste':
        await widget.controller.recordWaste(
          widget.scope,
          item: item,
          quantity: quantity,
        );
      case 'damage':
        await widget.controller.recordDamage(
          widget.scope,
          item: item,
          quantity: quantity,
        );
      case 'quarantine_release':
        await widget.controller.returnFromQuarantine(
          widget.scope,
          item: item,
          quantity: quantity,
        );
    }
    if (mounted && widget.controller.state.pendingOperation != null) {
      await _approvalDialog();
    }
  }

  Future<void> _restockDialog(Map<String, Object?> review) async {
    final components = (review['components']! as List<Object?>)
        .cast<Map<String, Object?>>();
    final decisions = <String, String>{
      for (final component in components)
        component['inventoryItemId']! as String: 'not_restocked',
    };
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(
            _copy('Destino por componente', 'Disposition by component'),
          ),
          content: SizedBox(
            width: 560,
            child: ListView.separated(
              shrinkWrap: true,
              itemCount: components.length,
              separatorBuilder: (_, _) => const Divider(),
              itemBuilder: (context, index) {
                final component = components[index];
                final itemId = component['inventoryItemId']! as String;
                final displayName = component['displayName']! as String;
                final publicReference = component['publicReference']! as String;
                final maximum = component['maximum']! as Map<String, Object?>;
                return Semantics(
                  label: _copy(
                    'Destino del componente $displayName',
                    'Disposition for component $displayName',
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '$displayName · $publicReference · '
                        '${maximum['value']} ${maximum['unit']}',
                      ),
                      const SizedBox(height: 8),
                      DropdownButtonFormField<String>(
                        initialValue: decisions[itemId],
                        decoration: InputDecoration(
                          labelText: _copy('Destino', 'Disposition'),
                        ),
                        items: [
                          DropdownMenuItem(
                            value: 'restocked',
                            child: Text(_copy('Reingresar', 'Restock')),
                          ),
                          DropdownMenuItem(
                            value: 'not_restocked',
                            child: Text(
                              _copy('No reingresar', 'Do not restock'),
                            ),
                          ),
                          DropdownMenuItem(
                            value: 'inspection_queued',
                            child: Text(
                              _copy(
                                'Enviar a inspección',
                                'Send to inspection',
                              ),
                            ),
                          ),
                        ],
                        onChanged: (value) {
                          if (value == null) return;
                          setDialogState(() => decisions[itemId] = value);
                        },
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: Text(_copy('Cancelar', 'Cancel')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: Text(_copy('Confirmar', 'Confirm')),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true || !mounted) return;
    await widget.controller.resolveRestock(widget.scope, review, decisions);
    if (mounted && widget.controller.state.pendingOperation != null) {
      await _approvalDialog();
    }
  }

  bool _hasAllVarianceReasons(InventoryCountResult result) => result.variances
      .where(
        (variance) =>
            (variance['absolute']! as Map<String, Object?>)['value'] != 0,
      )
      .every(
        (variance) => _varianceReasons.containsKey(
          variance['inventoryItemId']! as String,
        ),
      );

  List<DropdownMenuItem<String>> _varianceReasonItems() =>
      [
            ('counting_error', _copy('Error de conteo', 'Counting error')),
            (
              'unrecorded_waste',
              _copy('Merma no registrada', 'Unrecorded waste'),
            ),
            (
              'unrecorded_damage',
              _copy('Daño no registrado', 'Unrecorded damage'),
            ),
            ('missing_stock', _copy('Existencia faltante', 'Missing stock')),
            ('found_stock', _copy('Existencia encontrada', 'Found stock')),
            (
              'unit_conversion_error',
              _copy('Error de conversión de unidad', 'Unit conversion error'),
            ),
            (
              'operational_handling_difference',
              _copy('Diferencia operativa', 'Operational handling difference'),
            ),
            (
              'unknown_difference',
              _copy('Diferencia desconocida', 'Unknown difference'),
            ),
            ('authorized_other', _copy('Otro autorizado', 'Authorized other')),
          ]
          .map(
            (entry) => DropdownMenuItem<String>(
              value: entry.$1,
              child: Text(entry.$2),
            ),
          )
          .toList();

  String _actionLabel(String action) => switch (action) {
    'increase' => _copy('Aumentar', 'Increase'),
    'decrease' => _copy('Disminuir', 'Decrease'),
    'waste' => _copy('Registrar merma', 'Record waste'),
    'damage' => _copy('Marcar daño', 'Mark damage'),
    'quarantine_release' => _copy('Liberar cuarentena', 'Release quarantine'),
    _ => action,
  };

  String _entryLabel(String type) => switch (type) {
    'opening_balance' => _copy('Saldo inicial', 'Opening balance'),
    'reservation_created' => _copy('Reserva creada', 'Reservation created'),
    'reservation_released' => _copy('Reserva liberada', 'Reservation released'),
    'reservation_expired' => _copy('Reserva vencida', 'Reservation expired'),
    'sale_committed' => _copy('Venta comprometida', 'Sale committed'),
    'refund_restocked' => _copy('Refund reingresado', 'Refund restocked'),
    'refund_not_restocked' => _copy(
      'Refund sin reingreso',
      'Refund not restocked',
    ),
    'inspection_queued' => _copy('Inspección pendiente', 'Inspection queued'),
    'adjustment_increase' => _copy('Ajuste de aumento', 'Increase adjustment'),
    'adjustment_decrease' => _copy(
      'Ajuste de reducción',
      'Decrease adjustment',
    ),
    'waste_recorded' => _copy('Merma registrada', 'Waste recorded'),
    'damage_recorded' => _copy('Daño registrado', 'Damage recorded'),
    'quarantine_entered' => _copy('Entrada a cuarentena', 'Entered quarantine'),
    'quarantine_released' => _copy(
      'Salida de cuarentena',
      'Released quarantine',
    ),
    'count_correction' => _copy('Corrección de conteo', 'Count correction'),
    _ => _copy('Movimiento de inventario', 'Inventory movement'),
  };

  String _error(String code) => switch (code) {
    'APPROVAL_REQUIRED' => _copy(
      'Esta operación requiere una aprobación vinculada.',
      'This operation requires a bound approval.',
    ),
    'PERMISSION_DENIED' => _copy(
      'Tu perfil no permite esta operación.',
      'Your profile does not permit this operation.',
    ),
    'NEGATIVE_STOCK_BLOCKED' => _copy(
      'La política bloquea las existencias negativas.',
      'The policy blocks negative stock.',
    ),
    _ => _copy(
      'No fue posible completar la operación de inventario.',
      'The inventory operation could not finish.',
    ),
  };
}

final class _Header extends StatelessWidget {
  const _Header({
    required this.location,
    required this.policy,
    required this.offlineBlocked,
  });
  final String location;
  final String policy;
  final bool offlineBlocked;

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    return ListTile(
      leading: const Icon(Icons.inventory_2_outlined),
      title: Text(location),
      subtitle: Text(
        '${es ? 'Política' : 'Policy'} $policy · '
        '${offlineBlocked ? (es ? 'Solo en línea' : 'Online-only') : (es ? 'En línea' : 'Online')}',
      ),
    );
  }
}

final class _InventoryItemCard extends StatelessWidget {
  const _InventoryItemCard({
    required this.item,
    required this.balance,
    required this.busy,
    required this.permissions,
    required this.onAction,
  });
  final Map<String, Object?> item;
  final Map<String, Object?>? balance;
  final bool busy;
  final OperatorPermissions permissions;
  final ValueChanged<String> onAction;

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    final available = balance?['available'] ?? 0;
    final onHand = balance?['onHand'] ?? 0;
    final reserved = balance?['reserved'] ?? 0;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Wrap(
          spacing: 12,
          runSpacing: 12,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            SizedBox(
              width: 260,
              child: ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(item['displayName']! as String),
                subtitle: Text(
                  '${item['publicReference']} · ${item['baseUnit']}',
                ),
              ),
            ),
            _Metric(
              label: es ? 'Existencia física' : 'On hand',
              value: '$onHand',
            ),
            _Metric(label: es ? 'Reservado' : 'Reserved', value: '$reserved'),
            _Metric(
              label: es ? 'Disponible' : 'Available',
              value: '$available',
            ),
            if (permissions.allows('inventory.adjust.increase'))
              OutlinedButton(
                onPressed: busy ? null : () => onAction('increase'),
                child: const Text('+'),
              ),
            if (permissions.allows('inventory.adjust.decrease'))
              OutlinedButton(
                onPressed: busy ? null : () => onAction('decrease'),
                child: const Text('−'),
              ),
            if (permissions.allows('inventory.waste.create'))
              IconButton(
                tooltip: es ? 'Registrar merma' : 'Record waste',
                onPressed: busy ? null : () => onAction('waste'),
                icon: const Icon(Icons.delete_sweep_outlined),
              ),
            if (permissions.allows('inventory.damage.create'))
              IconButton(
                tooltip: es ? 'Registrar daño' : 'Record damage',
                onPressed: busy ? null : () => onAction('damage'),
                icon: const Icon(Icons.report_problem_outlined),
              ),
            if (permissions.allows('inventory.quarantine.release') &&
                (balance?['quarantine'] as num? ?? 0) > 0)
              IconButton(
                tooltip: es ? 'Liberar cuarentena' : 'Release quarantine',
                onPressed: busy ? null : () => onAction('quarantine_release'),
                icon: const Icon(Icons.inventory_outlined),
              ),
          ],
        ),
      ),
    );
  }
}

final class _HistoryTile extends StatelessWidget {
  const _HistoryTile({required this.entry, required this.label});
  final Map<String, Object?> entry;
  final String label;

  @override
  Widget build(BuildContext context) {
    final quantity = entry['quantity']! as Map<String, Object?>;
    return ListTile(
      leading: const Icon(Icons.history),
      title: Text(label),
      subtitle: Text('${entry['businessDate']} · ${entry['correlationId']}'),
      trailing: Text('${quantity['value']} ${quantity['unit']}'),
    );
  }
}

final class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Semantics(
    label: '$label: $value',
    child: Chip(label: Text('$label $value')),
  );
}

final class _Failure extends StatelessWidget {
  const _Failure({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(message),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: retry,
          child: Text(es ? 'Reintentar' : 'Retry'),
        ),
      ],
    );
  }
}
