import 'dart:async';

import 'package:flutter/services.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/operator_error_message.dart';
import '../../core/theme/pos_ui.dart';
import 'floor_plan_surface.dart';
import 'table_state_controller.dart';

typedef CreateOrderTables =
    Future<List<FloorPlanArea>?> Function(List<int> slots);
typedef AddOrderTable =
    Future<List<FloorPlanArea>?> Function(
      String areaId,
      String label,
      int capacity,
    );

typedef _CreatedTable = ({
  List<FloorPlanArea> areas,
  String areaId,
  String label,
});

// Slots use zero-based positions in four columns. Persistence owns IDs and
// idempotency across retries after an uncertain network result.

Future<FloorPlanElement?> showOrderTablePicker(
  BuildContext context, {
  required List<FloorPlanArea> areas,
  CreateOrderTables? createTables,
  AddOrderTable? addTable,
  TableStateController? room,
  Future<void> Function()? refreshRoom,
  bool canManage = false,
  String? assigningAccountId,
}) => showPosDialog<FloorPlanElement>(
  context: context,
  barrierDismissible: false,
  builder: (_) => OrderTablePicker(
    areas: areas,
    createTables: createTables,
    addTable: addTable,
    room: room,
    refreshRoom: refreshRoom,
    canManage: canManage,
    assigningAccountId: assigningAccountId,
  ),
);

class OrderTablePicker extends StatefulWidget {
  const OrderTablePicker({
    required this.areas,
    this.createTables,
    this.addTable,
    this.room,
    this.refreshRoom,
    this.canManage = false,
    this.assigningAccountId,
    super.key,
  });

  final List<FloorPlanArea> areas;
  final CreateOrderTables? createTables;
  final AddOrderTable? addTable;
  final TableStateController? room;
  final Future<void> Function()? refreshRoom;
  final bool canManage;
  final String? assigningAccountId;

  @override
  State<OrderTablePicker> createState() => _OrderTablePickerState();
}

class _NewOrderTableDialog extends StatefulWidget {
  const _NewOrderTableDialog({
    required this.area,
    required this.label,
    required this.add,
  });
  final FloorPlanArea area;
  final String label;
  final AddOrderTable add;
  @override
  State<_NewOrderTableDialog> createState() => _NewOrderTableDialogState();
}

class _NewOrderTableDialogState extends State<_NewOrderTableDialog> {
  late final _name = TextEditingController(text: widget.label);
  final _capacity = TextEditingController(text: '4');
  bool _saving = false;
  bool _failed = false;
  bool get _valid =>
      _name.text.trim().isNotEmpty &&
      _name.text.trim().length <= 80 &&
      !RegExp(r'[<>\x00-\x1f]').hasMatch(_name.text) &&
      (int.tryParse(_capacity.text) ?? 0) >= 1 &&
      (int.tryParse(_capacity.text) ?? 0) <= 100;
  @override
  void dispose() {
    _name.dispose();
    _capacity.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving || !_valid) return;
    setState(() {
      _saving = true;
      _failed = false;
    });
    try {
      final result = await widget.add(
        widget.area.id,
        _name.text.trim(),
        int.parse(_capacity.text),
      );
      if (!mounted) return;
      if (result != null) {
        Navigator.pop<_CreatedTable>(context, (
          areas: result,
          areaId: widget.area.id,
          label: _name.text.trim(),
        ));
        return;
      }
      setState(() => _failed = true);
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    return PopScope(
      canPop: !_saving,
      child: PosAlertDialog(
        title: Text(es ? 'Crear mesa nueva' : 'Create new table'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              es
                  ? 'Mesa física en ${widget.area.name}. Quedará guardada para los próximos servicios. Puedes ajustar su posición desde el dashboard.'
                  : 'Physical table in ${widget.area.name}. It stays available for future services. You can adjust its position in the dashboard.',
            ),
            const SizedBox(height: 16),
            PosField(
              key: const ValueKey('new-table-name'),
              controller: _name,
              enabled: !_saving,
              decoration: PosFieldDecoration(
                labelText: es ? 'Nombre de la mesa' : 'Table name',
              ),
              inputFormatters: [LengthLimitingTextInputFormatter(80)],
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            PosField(
              key: const ValueKey('new-table-capacity'),
              controller: _capacity,
              enabled: !_saving,
              decoration: PosFieldDecoration(
                labelText: es ? 'Lugares' : 'Seats',
              ),
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(3),
              ],
              onChanged: (_) => setState(() {}),
            ),
            if (_failed)
              Text(
                es
                    ? 'No se pudo crear. Revisa que el nombre no exista e intenta de nuevo.'
                    : 'Could not create the table. Check its name is unique and try again.',
              ),
          ],
        ),
        actions: [
          PosTextButton(
            onPressed: _saving ? null : () => Navigator.pop(context),
            child: Text(es ? 'Cancelar' : 'Cancel'),
          ),
          PosButton(
            onPressed: _saving || !_valid ? null : _save,
            child: Text(es ? 'Crear mesa' : 'Create table'),
          ),
        ],
      ),
    );
  }
}

class _OrderTablePickerState extends State<OrderTablePicker> {
  final _countController = TextEditingController(text: '1');

  int? get _count => int.tryParse(_countController.text);
  bool get _validCount => _count != null && _count! >= 1 && _count! <= 50;

  @override
  void dispose() {
    _poll?.cancel();
    widget.room?.removeListener(_roomChanged);
    _countController.dispose();
    super.dispose();
  }

  void _step(int delta) {
    final count = ((_count ?? 0) + delta).clamp(1, 50);
    _countController.text = '$count';
    setState(() => _failed = false);
  }

  late List<({FloorPlanElement table, String area})> _tables;
  late List<FloorPlanArea> _areas;
  String? _areaId;
  FloorPlanElement? _selected;
  Timer? _poll;
  bool _saving = false;
  bool _failed = false;
  bool _confirming = false;

  @override
  void initState() {
    super.initState();
    _installAreas(widget.areas);
    widget.room?.addListener(_roomChanged);
    if (widget.refreshRoom != null) {
      _poll = Timer.periodic(const Duration(seconds: 5), (_) {
        if (WidgetsBinding.instance.lifecycleState ==
            AppLifecycleState.resumed) {
          unawaited(widget.refreshRoom!());
        }
      });
    }
  }

  void _roomChanged() {
    if (mounted) setState(() {});
  }

  void _installAreas(List<FloorPlanArea> areas) {
    _areas = areas;
    if (!_areas.any((area) => area.id == _areaId)) {
      _areaId = _areas.firstOrNull?.id;
    }
    _tables = [
      for (final area in areas)
        for (final element in area.elements.map(FloorPlanElement.fromJson))
          if (element.kind == 'table') (table: element, area: area.name),
    ];
  }

  Future<void> _save() async {
    if (_saving || !_validCount || widget.createTables == null) return;
    setState(() {
      _saving = true;
      _failed = false;
    });
    try {
      final areas = await widget.createTables!(
        List.generate(_count!, (index) => index),
      );
      if (!mounted) return;
      if (areas == null ||
          !areas.any(
            (area) =>
                area.elements.any((element) => element['kind'] == 'table'),
          )) {
        setState(() => _failed = true);
      } else {
        setState(() {
          _installAreas(areas);
        });
      }
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String _stateLabel(String state, bool es) => switch (state) {
    tableStateSeated => es ? 'Ocupada' : 'Occupied',
    tableStateOrdered => es ? 'Pedido enviado' : 'Order sent',
    tableStateServed => es ? 'Servida' : 'Served',
    tableStateAwaitingPayment => es ? 'Pidió la cuenta' : 'Bill requested',
    tableStateDirty => es ? 'Por limpiar' : 'Needs cleaning',
    _ => es ? 'Disponible' : 'Available',
  };

  bool get _unavailable => _saving || _confirming || _roomUnavailable;

  bool get _roomUnavailable =>
      (widget.room?.busy ?? false) ||
      (widget.room?.loading ?? false) ||
      (widget.room != null && (widget.room!.map == null || widget.room!.stale));

  bool get _otherAccount {
    final account = _selected == null
        ? null
        : widget.room?.stateOf(_selected!.id).openAccountId;
    return widget.assigningAccountId != null &&
        account != null &&
        account != widget.assigningAccountId;
  }

  Future<void> _confirm() async {
    if (_selected == null || _unavailable || _otherAccount) return;
    setState(() => _confirming = true);
    try {
      await widget.refreshRoom?.call();
      if (!mounted || _roomUnavailable || _otherAccount) return;
      if (widget.assigningAccountId == null) {
        final accountTable = widget.room
            ?.stateOf(_selected!.id)
            .openAccountTableId;
        if (accountTable != null) {
          final target = _tables
              .where((entry) => entry.table.id == accountTable)
              .firstOrNull;
          if (target == null) return;
          Navigator.pop(context, target.table);
          return;
        }
      }
      Navigator.pop(context, _selected);
    } finally {
      if (mounted) setState(() => _confirming = false);
    }
  }

  Future<void> _clear(FloorPlanElement table, bool es) async {
    final groupId = widget.room!.stateOf(table.id).groupId;
    final grouped = groupId != null && widget.room!.group(groupId).length > 1;
    final accepted = await showPosDialog<bool>(
      context: context,
      builder: (dialog) => PosAlertDialog(
        title: Text(
          es ? '¿Los clientes ya se fueron?' : 'Have the guests left?',
        ),
        content: Text(
          es
              ? grouped
                    ? 'Todas las mesas de este grupo quedarán por limpiar. Las cuentas abiertas impiden liberar el grupo.'
                    : '${table.label} quedará por limpiar. Cobrar la cuenta no significa que los clientes se hayan ido.'
              : grouped
              ? 'All tables in this group will need cleaning. Open accounts prevent releasing the group.'
              : '${table.label} will need cleaning. Payment does not mean the guests have left.',
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(dialog, false),
            child: Text(es ? 'Volver' : 'Back'),
          ),
          PosButton(
            onPressed: () => Navigator.pop(dialog, true),
            child: Text(es ? 'Sí, ya se fueron' : 'Yes, they left'),
          ),
        ],
      ),
    );
    if (accepted != true || !mounted) return;
    await _manage(() => widget.room!.clearTable(table.id));
  }

  Future<void> _manage(Future<bool> Function() command) async {
    if (_unavailable) return;
    final ok = await command();
    if (!mounted) return;
    if (!ok) {
      showPosFeedback(
        context,
        operatorErrorMessage(
          context,
          widget.room!.errorCode ?? 'TABLE_OPERATION_FAILED',
        ),
      );
    }
    await widget.refreshRoom?.call();
  }

  Future<void> _add(bool es) async {
    final area = _areas.firstWhere((area) => area.id == _areaId);
    var next = 1;
    final labels = _tables
        .map((entry) => entry.table.label.toLowerCase())
        .toSet();
    while (labels.contains('mesa $next')) {
      next++;
    }
    final result = await showPosDialog<_CreatedTable>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _NewOrderTableDialog(
        area: area,
        label: 'Mesa $next',
        add: widget.addTable!,
      ),
    );
    if (!mounted || result == null) return;
    setState(() {
      _installAreas(result.areas);
      _areaId = result.areaId;
      _selected = result.areas
          .where((area) => area.id == result.areaId)
          .expand((area) => area.elements.map(FloorPlanElement.fromJson))
          .where(
            (table) => table.kind == 'table' && table.label == result.label,
          )
          .firstOrNull;
    });
    await widget.refreshRoom?.call();
  }

  Widget _mapPicker(bool es) {
    final room = widget.room;
    final selected = _selected;
    final entry = selected == null ? null : room?.stateOf(selected.id);
    final area = _areas.firstWhere((area) => area.id == _areaId);
    final primary = _otherAccount
        ? (es ? 'Mesa con otra cuenta' : 'Table has another account')
        : entry?.openAccountId != null && widget.assigningAccountId == null
        ? (es ? 'Abrir ${entry!.openAccountFolio ?? 'cuenta'}' : 'Open account')
        : selected != null &&
              room?.partyPresent(selected.id) == true &&
              entry?.openAccountId == null
        ? (es ? 'Continuar con estos clientes' : 'Continue with these guests')
        : (es ? 'Usar mesa' : 'Use table');
    return PosAlertDialog(
      insetPadding: const EdgeInsets.all(12),
      constraints: const BoxConstraints(maxWidth: 1040),
      title: Text(es ? 'Elige una mesa' : 'Choose a table'),
      content: SizedBox(
        width: 968,
        child: LayoutBuilder(
          builder: (context, box) {
            final wide = box.maxWidth >= 720;
            // Preserve readable text when a narrow viewport cannot fit enlarged labels on the map.
            final largeText =
                !wide && MediaQuery.textScalerOf(context).scale(16) >= 28;
            final height =
                (MediaQuery.sizeOf(context).height * (wide ? .52 : .32)).clamp(
                  220.0,
                  460.0,
                );
            final map = SizedBox(
              height: height,
              child: largeText
                  ? ListView(
                      children: [
                        for (final element
                            in area.elements
                                .map(FloorPlanElement.fromJson)
                                .where((e) => e.kind == 'table'))
                          PosListRow(
                            key: ValueKey('table-choice-${element.id}'),
                            title: Text(element.label),
                            subtitle: Text(
                              '${_stateLabel(room?.stateOf(element.id).state ?? tableStateOpen, es)} · ${element.capacity} ${es ? 'lugares' : 'seats'}',
                            ),
                            onTap: _confirming
                                ? null
                                : () => setState(() => _selected = element),
                          ),
                      ],
                    )
                  : FloorPlanMap(
                      key: ValueKey('order-table-map-${area.id}'),
                      area: area,
                      onTableTap: (table) {
                        if (!_confirming) setState(() => _selected = table);
                      },
                      tableStates: {
                        for (final table in _tables)
                          table.table.id: FloorPlanTableVisual(
                            state:
                                room?.stateOf(table.table.id).state ??
                                tableStateOpen,
                            selected: selected?.id == table.table.id,
                            partySize: room?.stateOf(table.table.id).partySize,
                            groupId: room?.stateOf(table.table.id).groupId,
                          ),
                      },
                    ),
            );
            final detail = _selectionDetails(es);
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    for (final item in _areas)
                      PosTextButton(
                        onPressed: _confirming
                            ? null
                            : () => setState(() {
                                _areaId = item.id;
                                _selected = null;
                              }),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (item.id == area.id) ...[
                              const PosIcon(PosGlyphs.check, size: 16),
                              const SizedBox(width: 6),
                            ],
                            Text(item.name),
                          ],
                        ),
                      ),
                    if (widget.addTable != null)
                      PosButton.tonal(
                        key: const ValueKey('create-additional-table'),
                        onPressed: _unavailable ? null : () => _add(es),
                        child: Text(
                          es ? 'Crear mesa nueva' : 'Create new table',
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                if (room != null && (room.map == null || room.stale)) ...[
                  Text(
                    es
                        ? 'No se pudo actualizar la sala. Actualiza antes de elegir.'
                        : 'The room could not refresh. Refresh before choosing.',
                  ),
                  PosTextButton(
                    onPressed: room.loading ? null : widget.refreshRoom,
                    child: Text(es ? 'Actualizar' : 'Refresh'),
                  ),
                ],
                if (wide)
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: map),
                      const SizedBox(width: 20),
                      SizedBox(width: 280, child: detail),
                    ],
                  )
                else ...[
                  map,
                  const SizedBox(height: 16),
                  detail,
                ],
              ],
            );
          },
        ),
      ),
      actions: [
        PosTextButton(
          onPressed: room?.busy == true || _confirming
              ? null
              : () => Navigator.pop(context),
          child: Text(es ? 'Cancelar' : 'Cancel'),
        ),
        PosButton(
          key: const ValueKey('confirm-table'),
          onPressed: selected == null || _unavailable || _otherAccount
              ? null
              : _confirm,
          child: Text(primary),
        ),
      ],
    );
  }

  Widget _selectionDetails(bool es) {
    final table = _selected;
    if (table == null) {
      return Text(
        es
            ? 'Toca una mesa para ver su estado y elegirla.'
            : 'Tap a table to see its status and choose it.',
      );
    }
    final room = widget.room;
    final entry = room?.stateOf(table.id);
    final present = room?.partyPresent(table.id) ?? false;
    final elapsed = room?.elapsedOf(table.id);
    return Semantics(
      liveRegion: true,
      child: Column(
        key: const ValueKey('order-table-detail'),
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(table.label, style: PosTheme.of(context).textTheme.titleLarge),
          Text(
            '${_stateLabel(entry?.state ?? tableStateOpen, es)} · ${table.capacity} ${es ? 'lugares' : 'seats'}',
          ),
          if (elapsed != null)
            Text('${es ? 'Tiempo' : 'Time'}: ${formatTableTurn(elapsed)}'),
          if (entry?.openAccountId != null) ...[
            Text(
              entry!.openAccountFolio ??
                  (es ? 'Cuenta abierta' : 'Open account'),
            ),
            Text(
              es
                  ? 'La mesa tiene una cuenta abierta y no se puede liberar.'
                  : 'The table has an open account and cannot be released.',
            ),
            if (_otherAccount)
              Text(
                es
                    ? 'Elige otra mesa para esta cuenta. Para unir cuentas, usa las acciones de la cuenta.'
                    : 'Choose another table for this account. Use account actions to merge accounts.',
              ),
          ] else if (present) ...[
            Text(
              es
                  ? 'Sin cuenta abierta. Confirma si los clientes siguen aquí o ya se fueron.'
                  : 'No open account. Confirm whether the guests are still here or have left.',
            ),
            if (widget.canManage)
              PosTextButton(
                onPressed: _unavailable ? null : () => _clear(table, es),
                child: Text(es ? 'Los clientes se fueron' : 'The guests left'),
              ),
          ],
          if (entry?.state == tableStateDirty) ...[
            Text(
              es
                  ? 'Revisa la limpieza antes de sentar al siguiente grupo.'
                  : 'Check the table is clean before seating the next party.',
            ),
            if (widget.canManage)
              PosTextButton(
                onPressed: _unavailable
                    ? null
                    : () => _manage(() => room!.markReady(table.id)),
                child: Text(es ? 'Marcar limpia' : 'Mark clean'),
              ),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    final theme = PosTheme.of(context);
    final setup = _tables.isEmpty;
    if (!setup) return _mapPicker(es);
    return PopScope(
      canPop: !_saving,
      child: PosAlertDialog(
        insetPadding: const EdgeInsets.all(16),
        constraints: const BoxConstraints(maxWidth: 620),
        title: Text(
          setup
              ? (es ? 'Agrega tus mesas' : 'Add your tables')
              : (es ? 'Elige una mesa' : 'Choose a table'),
        ),
        content: SizedBox(
          width: 560,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                setup
                    ? widget.createTables == null
                          ? (es
                                ? 'Todavía no hay mesas disponibles.'
                                : 'No tables are available yet.')
                          : (es
                                ? 'Para inicio rápido, ingresa el número total de mesas de tu negocio. Después, edita el mapa de piso en la consola de administración.'
                                : 'For a quick start, enter the total number of tables in your business. Then edit the floor plan in the administration console.')
                    : (es
                          ? 'Toca la mesa para continuar con el pedido.'
                          : 'Tap the table to continue with the order.'),
              ),
              const SizedBox(height: 16),
              if (setup && widget.createTables != null) ...[
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Flexible(
                      child: SizedBox(
                        width: 220,
                        child: PosField(
                          key: const ValueKey('table-count'),
                          controller: _countController,
                          enabled: !_saving,
                          semanticLabel: es
                              ? 'Número de mesas'
                              : 'Number of tables',
                          textAlign: TextAlign.center,
                          keyboardType: TextInputType.number,
                          textInputAction: TextInputAction.done,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                            LengthLimitingTextInputFormatter(2),
                          ],
                          style: theme.textTheme.displayLarge?.copyWith(
                            fontSize: 72,
                            fontWeight: FontWeight.w700,
                          ),
                          decoration: const PosFieldDecoration(
                            contentPadding: EdgeInsets.symmetric(
                              vertical: 12,
                              horizontal: 8,
                            ),
                          ),
                          onChanged: (_) => setState(() => _failed = false),
                        ),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        PosIconButton(
                          key: const ValueKey('table-count-increase'),
                          tooltip: es ? 'Aumentar mesas' : 'Increase tables',
                          constraints: const BoxConstraints(
                            minWidth: 56,
                            minHeight: 56,
                          ),
                          onPressed: _saving || (_count ?? 0) >= 50
                              ? null
                              : () => _step(1),
                          icon: const PosIcon(PosGlyphs.arrowUpward, size: 32),
                        ),
                        const SizedBox(height: 8),
                        PosIconButton(
                          key: const ValueKey('table-count-decrease'),
                          tooltip: es ? 'Reducir mesas' : 'Decrease tables',
                          constraints: const BoxConstraints(
                            minWidth: 56,
                            minHeight: 56,
                          ),
                          onPressed: _saving || (_count ?? 0) <= 1
                              ? null
                              : () => _step(-1),
                          icon: const RotatedBox(
                            quarterTurns: 2,
                            child: PosIcon(PosGlyphs.arrowUpward, size: 32),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  es ? 'De 1 a 50 mesas' : 'From 1 to 50 tables',
                  textAlign: TextAlign.center,
                ),
              ],
              if (_saving) ...[
                const SizedBox(height: 12),
                Semantics(
                  liveRegion: true,
                  child: Text(es ? 'Guardando mesas…' : 'Saving tables…'),
                ),
              ],
              if (_failed) ...[
                const SizedBox(height: 12),
                Semantics(
                  liveRegion: true,
                  child: Text(
                    es
                        ? 'No pudimos guardar las mesas. Intenta de nuevo.'
                        : 'We could not save the tables. Try again.',
                    style: theme.textTheme.bodyMedium!.copyWith(
                      color: theme.colorScheme.error,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
        actions: [
          PosTextButton(
            onPressed: _saving ? null : () => Navigator.pop(context),
            child: Text(es ? 'Cancelar' : 'Cancel'),
          ),
          if (setup && widget.createTables != null)
            PosButton(
              onPressed: _saving || !_validCount ? null : _save,
              child: Text(es ? 'Guardar mesas' : 'Save tables'),
            ),
        ],
      ),
    );
  }
}
