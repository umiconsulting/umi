import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import '../../core/errors/operator_error_message.dart';
import '../../core/localization/app_localizations.dart';
import '../../core/security/operator_permissions.dart';
import '../../shared/money.dart';
import '../../shared/widgets/station_document.dart';
import '../entry/entry_controller.dart';
import 'inventory_controller.dart';
import 'inventory_quantity.dart';

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
    canReadHistory: OperatorPermissions(
      operator.permissions,
    ).allows('inventory.history.read'),
  );
  await Navigator.of(context).push<void>(
    PosPageRoute(
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
  bool _countInvalid = false;

  List<Map<String, Object?>> get _countItems {
    final overview = widget.controller.state.overview;
    final count = widget.controller.state.count?.count;
    if (overview == null || count == null) return const [];
    final ids = {
      for (final balance in overview.balances)
        if (balance['inventoryLocationId'] == count['inventoryLocationId'])
          balance['inventoryItemId'],
    };
    return overview.items
        .where((item) => item['active'] == true && ids.contains(item['id']))
        .toList(growable: false);
  }

  int _scale(Map<String, Object?> item) =>
      (item['scale'] as num?)?.toInt() ?? 0;
  String _quantityHint(Map<String, Object?> item) => _scale(item) == 0
      ? _copy('Ingresa una cantidad entera.', 'Enter a whole quantity.')
      : _copy(
          'Hasta ${_scale(item)} decimales. Usa el punto decimal.',
          'Up to ${_scale(item)} decimal places. Use a decimal point.',
        );

  Future<void> _submitCount() async {
    final quantities = <String, int>{};
    for (final item in _countItems) {
      final id = item['id']! as String;
      final value = InventoryQuantityText.parse(
        _countInputs[id]?.text ?? '',
        _scale(item),
      );
      if (value == null) {
        setState(() => _countInvalid = true);
        return;
      }
      quantities[id] = value;
    }
    setState(() => _countInvalid = false);
    await widget.controller.submitCount(widget.scope, quantities);
  }

  // The produce dialog outlives its own future while the route pops, so the
  // State owns these and disposes them once.
  final _productionQuantity = TextEditingController();
  final _productionLot = TextEditingController();
  final _productionExpiry = TextEditingController();

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
    _productionQuantity.dispose();
    _productionLot.dispose();
    _productionExpiry.dispose();
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
    final canReadHistory =
        widget.scope.canReadHistory &&
        widget.permissions.allows('inventory.history.read');
    final historyCount = canReadHistory
        ? state.history?.entries.length ?? 0
        : 0;
    final hasMoreHistory =
        canReadHistory && state.history?.page['hasMore'] == true;
    final blindCountActive =
        state.count?.count['status'] == 'counting' &&
        state.count?.count['blind'] == true;
    return PosPage(
      appBar: PosHeader(
        title: StationHeading(
          title: _copy('Operaciones de inventario', 'Inventory operations'),
        ),
        actions: [
          PosIconButton(
            tooltip: _copy('Actualizar', 'Refresh'),
            onPressed: state.busy
                ? null
                : () => widget.controller.load(widget.scope),
            icon: const PosIcon(PosGlyphs.refresh),
          ),
        ],
      ),
      body: SafeArea(
        child: overview == null
            ? Center(
                child: state.errorCode == null
                    ? const PosSpinner()
                    : _Failure(
                        message: _error(state.errorCode!),
                        retry: () => widget.controller.load(widget.scope),
                      ),
              )
            : Column(
                children: [
                  if (state.errorCode != null)
                    PosNoticeBanner(
                      content: Text(_error(state.errorCode!)),
                      actions: [
                        PosTextButton(
                          onPressed: () => widget.controller.load(widget.scope),
                          child: Text(_copy('Reintentar', 'Retry')),
                        ),
                      ],
                    ),
                  _Header(
                    location: overview.locations.isEmpty
                        ? '—'
                        : overview.locations.first['displayName']! as String,
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
                              (review) => PosCard(
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
                                      PosButton.tonal(
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
                  if (widget.permissions.allows('inventory.count.create') &&
                      (state.count == null ||
                          [
                            'committed',
                            'cancelled',
                          ].contains(state.count!.count['status'])))
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: PosButton.icon(
                          onPressed: state.busy
                              ? null
                              : () =>
                                    widget.controller.startCount(widget.scope),
                          icon: const PosIcon(PosGlyphs.factCheckOutlined),
                          label: Text(
                            _copy('Iniciar conteo ciego', 'Start blind count'),
                          ),
                        ),
                      ),
                    ),
                  if (state.count != null && !blindCountActive)
                    _countPanel(state.count!),
                  if (widget.permissions.allows('inventory.production.produce'))
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: PosButton.icon(
                          onPressed: state.busy
                              ? null
                              : () => _productionDialog(),
                          icon: const PosIcon(
                            PosGlyphs.precisionManufacturingOutlined,
                          ),
                          label: Text(
                            AppLocalizations.of(
                              context,
                            ).inventoryProductionAction,
                          ),
                        ),
                      ),
                    ),
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
                                (canReadHistory ? 1 : 0) +
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
                                    style: PosTheme.of(
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
                                    child: PosOutlineButton(
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
      return PosCard(
        margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
        child: PosDisclosure(
          initiallyExpanded: true,
          title: Text(_copy('Conteo ciego activo', 'Active blind count')),
          subtitle: Text(
            _copy(
              'Registra cada cantidad. El sistema mostrará la varianza al enviar.',
              'Enter each quantity. The system shows variance after submission.',
            ),
          ),
          children: [
            if (widget.permissions.allows('inventory.count.create'))
              _cancelCountButton(),
            for (final item in _countItems)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
                child: PosField(
                  controller: _countInputs.putIfAbsent(
                    item['id']! as String,
                    () => TextEditingController(),
                  ),
                  keyboardType: TextInputType.numberWithOptions(
                    decimal: _scale(item) > 0,
                  ),
                  decoration: PosFieldDecoration(
                    labelText: item['displayName']! as String,
                    suffixText: InventoryQuantityText.unit(
                      item['baseUnit']! as String,
                    ),
                    helperText: _quantityHint(item),
                    errorText:
                        _countInvalid &&
                            InventoryQuantityText.parse(
                                  _countInputs[item['id']]?.text ?? '',
                                  _scale(item),
                                ) ==
                                null
                        ? _copy(
                            'Registra una cantidad válida, incluido cero.',
                            'Enter a valid quantity, including zero.',
                          )
                        : null,
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Align(
                alignment: Alignment.centerRight,
                child: PosButton(
                  onPressed: widget.controller.state.busy ? null : _submitCount,
                  child: Text(_copy('Enviar conteo', 'Submit count')),
                ),
              ),
            ),
          ],
        ),
      );
    }
    return PosCard(
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
              style: PosTheme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            for (final variance in result.variances)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: PosSelectFormField<String>(
                  initialValue:
                      _varianceReasons[variance['inventoryItemId']! as String],
                  decoration: PosFieldDecoration(
                    labelText:
                        '${_itemName(variance['inventoryItemId']! as String)} · '
                        '${InventoryQuantityText.label(variance['signed']! as Map<String, Object?>)}',
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
            if (!['committed', 'cancelled'].contains(status) &&
                widget.permissions.allows('inventory.count.create'))
              _cancelCountButton(),
            if (!['committed', 'cancelled'].contains(status) &&
                widget.permissions.allows('inventory.count.reconcile')) ...[
              const SizedBox(height: 12),
              PosButton.icon(
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
                icon: const PosIcon(PosGlyphs.balanceOutlined),
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

  Widget _cancelCountButton() => PosTextButton(
    onPressed: widget.controller.state.busy
        ? null
        : () async {
            final confirmed = await showPosDialog<bool>(
              context: context,
              builder: (dialogContext) => PosAlertDialog(
                title: Text(
                  _copy('Cancelar conteo activo', 'Cancel active count'),
                ),
                content: Text(
                  _copy(
                    'El historial se conserva. Registra de nuevo las cantidades en un conteo nuevo.',
                    'History stays available. Enter the quantities again in a new count.',
                  ),
                ),
                actions: [
                  PosTextButton(
                    onPressed: () => Navigator.pop(dialogContext, false),
                    child: Text(_copy('Volver', 'Back')),
                  ),
                  PosButton(
                    onPressed: () => Navigator.pop(dialogContext, true),
                    child: Text(
                      _copy('Cancelar y volver a contar', 'Cancel and recount'),
                    ),
                  ),
                ],
              ),
            );
            if (confirmed != true) return;
            await widget.controller.cancelCount(widget.scope);
            if (mounted && widget.controller.state.count == null) {
              setState(() {
                for (final input in _countInputs.values) {
                  input.clear();
                }
                _varianceReasons.clear();
              });
            }
          },
    child: Text(_copy('Cancelar conteo activo', 'Cancel active count')),
  );

  Future<void> _approvalDialog() async {
    final entry = widget.entry;
    final permission = widget.controller.state.approvalPermission;
    final fingerprint = widget.controller.state.approvalFingerprint;
    if (entry == null || permission == null || fingerprint == null) return;
    final pin = TextEditingController();
    final approved = await showPosDialog<bool>(
      context: context,
      builder: (dialogContext) => PosAlertDialog(
        title: Text(
          _copy(
            'Se requiere una aprobación independiente',
            'Independent approval required',
          ),
        ),
        content: PosField(
          controller: pin,
          autofocus: true,
          obscureText: true,
          keyboardType: TextInputType.number,
          decoration: PosFieldDecoration(
            labelText: _copy('PIN del aprobador', 'Approver PIN'),
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
    final quantity = await showPosDialog<int>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => PosAlertDialog(
          title: Text('${_actionLabel(action)} · ${item['displayName']}'),
          content: PosField(
            controller: input,
            autofocus: true,
            keyboardType: TextInputType.numberWithOptions(
              decimal: _scale(item) > 0,
            ),
            decoration: PosFieldDecoration(
              labelText: _copy('Cantidad', 'Quantity'),
              suffixText: InventoryQuantityText.unit(
                item['baseUnit']! as String,
              ),
              helperText: _quantityHint(item),
            ),
            onChanged: (_) => setDialogState(() {}),
          ),
          actions: [
            PosTextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: Text(_copy('Cancelar', 'Cancel')),
            ),
            PosButton(
              onPressed:
                  (InventoryQuantityText.parse(input.text, _scale(item)) ??
                          0) <=
                      0
                  ? null
                  : () => Navigator.pop(
                      dialogContext,
                      InventoryQuantityText.parse(input.text, _scale(item)),
                    ),
              child: Text(_copy('Confirmar', 'Confirm')),
            ),
          ],
        ),
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

  Future<void> _productionDialog() async {
    final overview = widget.controller.state.overview;
    if (overview == null) return;
    // The till cannot read recipes, so it offers every tracked item. The server
    // refuses an item with no recipe and the banner names that refusal.
    final candidates = overview.items
        .where((item) => item['trackingPolicy'] != 'not_tracked')
        .toList();
    if (candidates.isEmpty) return;
    final l = AppLocalizations.of(context);
    var outputItemId = candidates.first['id']! as String;
    _productionQuantity.text = '1';
    _productionLot.clear();
    _productionExpiry.clear();
    final confirmed = await showPosDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => PosAlertDialog(
          title: Text(l.inventoryProductionTitle),
          content: SizedBox(
            width: 560,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  PosSelectFormField<String>(
                    initialValue: outputItemId,
                    decoration: PosFieldDecoration(
                      labelText: l.inventoryProductionOutputLabel,
                    ),
                    items: [
                      for (final item in candidates)
                        PosSelectItem(
                          value: item['id']! as String,
                          child: Text(
                            '${item['displayName']} · ${InventoryQuantityText.unit(item['baseUnit']! as String)}',
                          ),
                        ),
                    ],
                    onChanged: (value) {
                      if (value == null) return;
                      setDialogState(() => outputItemId = value);
                    },
                  ),
                  PosField(
                    controller: _productionQuantity,
                    autofocus: true,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: PosFieldDecoration(
                      labelText: l.inventoryProductionQuantityLabel,
                      suffixText: InventoryQuantityText.unit(
                        candidates.firstWhere(
                              (item) => item['id'] == outputItemId,
                            )['baseUnit']!
                            as String,
                      ),
                      helperText: _quantityHint(
                        candidates.firstWhere(
                          (item) => item['id'] == outputItemId,
                        ),
                      ),
                    ),
                    onChanged: (_) => setDialogState(() {}),
                  ),
                  PosField(
                    controller: _productionLot,
                    decoration: PosFieldDecoration(
                      labelText: l.inventoryProductionLotLabel,
                    ),
                  ),
                  PosField(
                    controller: _productionExpiry,
                    keyboardType: TextInputType.datetime,
                    decoration: PosFieldDecoration(
                      labelText: l.inventoryProductionExpiryLabel,
                      hintText: l.inventoryProductionExpiryHint,
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            PosTextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: Text(_copy('Cancelar', 'Cancel')),
            ),
            PosButton(
              onPressed:
                  (InventoryQuantityText.parse(
                            _productionQuantity.text,
                            _scale(
                              candidates.firstWhere(
                                (item) => item['id'] == outputItemId,
                              ),
                            ),
                          ) ??
                          0) <=
                      0
                  ? null
                  : () => Navigator.pop(dialogContext, true),
              child: Text(_copy('Confirmar', 'Confirm')),
            ),
          ],
        ),
      ),
    );
    final quantity = InventoryQuantityText.parse(
      _productionQuantity.text,
      _scale(candidates.firstWhere((item) => item['id'] == outputItemId)),
    );
    final lotCode = _productionLot.text.trim();
    final expiresOn = _productionExpiry.text.trim();
    if (confirmed != true || quantity == null || quantity <= 0) return;
    await widget.controller.produce(
      widget.scope,
      item: candidates.firstWhere((item) => item['id'] == outputItemId),
      quantity: quantity,
      lotCode: lotCode.isEmpty ? null : lotCode,
      expiresOn: expiresOn.isEmpty ? null : expiresOn,
    );
    final result = widget.controller.state.production;
    if (!mounted ||
        result == null ||
        widget.controller.state.errorCode != null) {
      return;
    }
    await _productionResultDialog(result);
  }

  Future<void> _productionResultDialog(ProductionResult result) async {
    final l = AppLocalizations.of(context);
    await showPosDialog<void>(
      context: context,
      builder: (dialogContext) => PosAlertDialog(
        title: Text(l.inventoryProductionResultTitle),
        content: SizedBox(
          width: 560,
          child: SingleChildScrollView(child: _productionSummary(result)),
        ),
        actions: [
          PosButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text(_copy('Cerrar', 'Close')),
          ),
        ],
      ),
    );
  }

  /// The server says what the batch consumed, so the cook reads the real inputs
  /// and the rolled-up cost of the output.
  Widget _productionSummary(ProductionResult result) {
    final l = AppLocalizations.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          '${l.inventoryProductionLotReferenceLabel}: ${result.lotReference}',
        ),
        if (result.expiresOn != null)
          Text(
            '${l.inventoryProductionExpiryReferenceLabel}: ${result.expiresOn}',
          ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 12,
          runSpacing: 8,
          children: [
            _Metric(
              label: l.inventoryProductionProducedLabel,
              value: _quantityLabel(result.producedQuantity),
            ),
            _Metric(
              label: l.inventoryProductionDeclaredLabel,
              value: _quantityLabel(result.declaredQuantity),
            ),
            _Metric(
              label: l.inventoryProductionYieldLossLabel,
              value: _quantityLabel(result.yieldLossQuantity),
            ),
            _Metric(
              label: l.inventoryProductionUnitCostLabel,
              value: _cost(result.unitCostMinor),
            ),
            _Metric(
              label: l.inventoryProductionTotalCostLabel,
              value: _cost(result.totalCostMinor),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Text(
          l.inventoryProductionConsumedTitle,
          style: PosTheme.of(context).textTheme.titleSmall,
        ),
        for (final line in result.consumed)
          PosListRow(
            contentPadding: EdgeInsets.zero,
            title: Text(line['displayName']! as String),
            subtitle: Text(line['publicReference']! as String),
            trailing: Text(
              '${_quantityLabel(line['quantity']! as Map<String, Object?>)} · '
              '${_cost(line['lineCostMinor'] as int?)}',
            ),
          ),
        if (result.incompleteCost)
          Text(l.inventoryProductionIncompleteCostMessage),
      ],
    );
  }

  String _quantityLabel(Map<String, Object?> quantity) =>
      InventoryQuantityText.label(quantity);

  String _cost(int? minorUnits) => minorUnits == null
      ? AppLocalizations.of(context).inventoryProductionNoCostLabel
      : formatMinorUnits(minorUnits);

  Future<void> _restockDialog(Map<String, Object?> review) async {
    final components = (review['components']! as List<Object?>)
        .cast<Map<String, Object?>>();
    final decisions = <String, String>{
      for (final component in components)
        component['inventoryItemId']! as String: 'not_restocked',
    };
    final confirmed = await showPosDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => PosAlertDialog(
          title: Text(
            _copy('Destino por componente', 'Disposition by component'),
          ),
          content: SizedBox(
            width: 560,
            child: ListView.separated(
              shrinkWrap: true,
              itemCount: components.length,
              separatorBuilder: (_, _) => const PosDivider(),
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
                        '${InventoryQuantityText.label(maximum)}',
                      ),
                      const SizedBox(height: 8),
                      PosSelectFormField<String>(
                        initialValue: decisions[itemId],
                        decoration: PosFieldDecoration(
                          labelText: _copy('Destino', 'Disposition'),
                        ),
                        items: [
                          PosSelectItem(
                            value: 'restocked',
                            child: Text(_copy('Reingresar', 'Restock')),
                          ),
                          PosSelectItem(
                            value: 'not_restocked',
                            child: Text(
                              _copy('No reingresar', 'Do not restock'),
                            ),
                          ),
                          PosSelectItem(
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
            PosTextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: Text(_copy('Cancelar', 'Cancel')),
            ),
            PosButton(
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

  List<PosSelectItem<String>> _varianceReasonItems() =>
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
            (entry) =>
                PosSelectItem<String>(value: entry.$1, child: Text(entry.$2)),
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
    'INVENTORY_COUNT_BUSY' => _copy(
      'El inventario está ocupado. Intenta enviar el conteo de nuevo.',
      'Inventory is busy. Try to submit the count again.',
    ),
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
    'INVENTORY_RECIPE_REQUIRED' || 'INVENTORY_RECIPE_NOT_FOUND' =>
      AppLocalizations.of(context).inventoryProductionRecipeRequiredMessage,
    'INVENTORY_QUANTITY_NOT_EXACT' => AppLocalizations.of(
      context,
    ).inventoryProductionQuantityNotExactMessage,
    'INVENTORY_SOURCE_STATE_INSUFFICIENT' => AppLocalizations.of(
      context,
    ).inventoryProductionInsufficientStockMessage,
    // A code this screen has nothing specific to say about still gets the core
    // message. One generic sentence for every unknown refusal threw away what
    // the server did say — `VALIDATION_FAILED` reached the operator as
    // `No fue posible completar la operación de inventario.`, with nothing to
    // act on — while the shared mapping already has something specific for the
    // codes that come back most.
    _ => operatorErrorMessage(context, code),
  };
}

final class _Header extends StatelessWidget {
  const _Header({required this.location, required this.offlineBlocked});
  final String location;
  final bool offlineBlocked;

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    return PosListRow(
      leading: const PosIcon(PosGlyphs.inventory2Outlined),
      title: Text(location),
      subtitle: Text(
        offlineBlocked
            ? (es
                  ? 'Los movimientos requieren conexión'
                  : 'Stock changes require a connection')
            : (es ? 'Movimientos disponibles' : 'Stock changes available'),
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
    final scale = (item['scale'] as num?)?.toInt() ?? 0;
    final available = InventoryQuantityText.format(
      balance?['available'] ?? 0,
      scale,
    );
    final onHand = InventoryQuantityText.format(balance?['onHand'] ?? 0, scale);
    final reserved = InventoryQuantityText.format(
      balance?['reserved'] ?? 0,
      scale,
    );
    return PosCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Wrap(
          spacing: 12,
          runSpacing: 12,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            SizedBox(
              width: 260,
              child: PosListRow(
                contentPadding: EdgeInsets.zero,
                title: Text(item['displayName']! as String),
                subtitle: Text(
                  '${item['publicReference']} · ${InventoryQuantityText.unit(item['baseUnit']! as String)}',
                ),
              ),
            ),
            _Metric(label: es ? 'Existencia física' : 'On hand', value: onHand),
            _Metric(label: es ? 'Reservado' : 'Reserved', value: reserved),
            _Metric(label: es ? 'Disponible' : 'Available', value: available),
            if (permissions.allows('inventory.adjust.increase'))
              PosOutlineButton.icon(
                onPressed: busy ? null : () => onAction('increase'),
                icon: const PosIcon(PosGlyphs.add),
                label: Text(
                  es ? 'Aumentar' : 'Increase',
                  semanticsLabel: es
                      ? 'Aumentar existencias de ${item['displayName']}'
                      : 'Increase stock for ${item['displayName']}',
                ),
              ),
            if (permissions.allows('inventory.adjust.decrease'))
              PosOutlineButton.icon(
                onPressed: busy ? null : () => onAction('decrease'),
                icon: const PosIcon(PosGlyphs.remove),
                label: Text(
                  es ? 'Reducir' : 'Decrease',
                  semanticsLabel: es
                      ? 'Reducir existencias de ${item['displayName']}'
                      : 'Decrease stock for ${item['displayName']}',
                ),
              ),
            if (permissions.allows('inventory.waste.create'))
              PosIconButton(
                tooltip: es ? 'Registrar merma' : 'Record waste',
                onPressed: busy ? null : () => onAction('waste'),
                icon: const PosIcon(PosGlyphs.deleteSweepOutlined),
              ),
            if (permissions.allows('inventory.damage.create'))
              PosIconButton(
                tooltip: es ? 'Registrar daño' : 'Record damage',
                onPressed: busy ? null : () => onAction('damage'),
                icon: const PosIcon(PosGlyphs.reportProblemOutlined),
              ),
            if (permissions.allows('inventory.quarantine.release') &&
                (balance?['quarantine'] as num? ?? 0) > 0)
              PosIconButton(
                tooltip: es ? 'Liberar cuarentena' : 'Release quarantine',
                onPressed: busy ? null : () => onAction('quarantine_release'),
                icon: const PosIcon(PosGlyphs.inventoryOutlined),
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
    return PosListRow(
      leading: const PosIcon(PosGlyphs.history),
      title: Text(label),
      subtitle: Text('${entry['businessDate']} · ${entry['correlationId']}'),
      trailing: Text(InventoryQuantityText.label(quantity)),
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
    child: PosTag(label: Text('$label $value')),
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
        PosButton(onPressed: retry, child: Text(es ? 'Reintentar' : 'Retry')),
      ],
    );
  }
}
