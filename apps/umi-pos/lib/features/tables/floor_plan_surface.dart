import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import '../entry/entry_controller.dart';
import 'floor_plan_controller.dart';
import 'table_state_controller.dart';

Future<void> showFloorPlan(
  BuildContext context, {
  required FloorPlanController controller,
  required EntryController entry,
  TableStateController? tableState,
}) => Navigator.of(context).push(
  MaterialPageRoute<void>(
    builder: (_) => FloorPlanSurface(
      controller: controller,
      entry: entry,
      tableState: tableState,
    ),
  ),
);

class FloorPlanSurface extends StatefulWidget {
  const FloorPlanSurface({
    super.key,
    required this.controller,
    required this.entry,
    this.tableState,
  });
  final FloorPlanController controller;
  final EntryController entry;

  /// The live room (plan section 8D steps 3 to 5). Null when this build has no
  /// client, and the surface then stays the read-only map it used to be.
  final TableStateController? tableState;
  @override
  State<FloorPlanSurface> createState() => _FloorPlanSurfaceState();
}

class _FloorPlanSurfaceState extends State<FloorPlanSurface>
    with WidgetsBindingObserver {
  Timer? _timer;
  Timer? _ticker;
  String? _areaId;
  String? _context;
  bool _list = false;
  bool _active = true;
  bool _returningToEntry = false;

  /// Tables chosen for a merge, in the order they were tapped.
  final List<String> _selection = <String>[];
  bool _mergeMode = false;

  /// The table whose party is waiting for somewhere to go.
  String? _moveFrom;

  /// A refusal the surface decided itself, before spending a request on it.
  String? _notice;

  /// Published geometry by table id, so capacity is known without a request.
  Map<String, FloorPlanElement> _elementsById = const {};

  bool get _hasOperatorContext {
    final state = widget.entry.state;
    return state.phase == EntryPhase.ready &&
        state.selectedTenant != null &&
        state.selectedBranch != null &&
        state.operator != null;
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.controller.addListener(_changed);
    widget.entry.addListener(_entryChanged);
    widget.tableState?.addListener(_changed);
    widget.controller.clear();
    widget.tableState?.clear();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (_active) _load();
    });
    // One tick a second, and only while somebody is sitting down: the turn
    // timers are the only thing on this screen that moves on its own.
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!_active || !mounted) return;
      if (widget.tableState?.anyPartyPresent ?? false) setState(() {});
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _active = state == AppLifecycleState.resumed;
    if (_active) _load();
  }

  void _entryChanged() => _load();
  void _changed() {
    if (mounted) setState(() {});
  }

  void _load() {
    final state = widget.entry.state;
    final merchant = state.selectedTenant?.id;
    final location = state.selectedBranch?.id;
    final operator = state.operator?.id;
    if (!_hasOperatorContext ||
        merchant == null ||
        location == null ||
        operator == null) {
      if (_context != null) {
        _context = null;
        widget.controller.clear();
        widget.tableState?.clear();
      }
      if (!_returningToEntry) {
        _returningToEntry = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          _returningToEntry = false;
          if (!_hasOperatorContext) {
            // Close the map and any table dialog above the guarded entry screen.
            Navigator.of(context).popUntil((route) => route.isFirst);
          }
        });
      }
      return;
    }
    final scope = '$merchant:$location:$operator';
    if (_context != scope) {
      _context = scope;
      _areaId = null;
      _selection.clear();
      _mergeMode = false;
      _moveFrom = null;
      _notice = null;
      widget.tableState?.clear();
    }
    unawaited(
      widget.controller.load(
        merchant,
        PosFloorPlanQuery(locationId: location, operatorSessionId: operator),
      ),
    );
    unawaited(widget.tableState?.load(merchant, location, operator));
  }

  @override
  void dispose() {
    _timer?.cancel();
    _ticker?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    widget.entry.removeListener(_entryChanged);
    widget.controller.removeListener(_changed);
    widget.tableState?.removeListener(_changed);
    widget.controller.clear();
    widget.tableState?.clear();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    final l10n = AppLocalizations.of(context);
    if (!_hasOperatorContext) {
      return Scaffold(
        appBar: AppBar(title: Text(es ? 'Mesas' : 'Tables')),
        body: Center(
          child: Text(
            es
                ? 'Ingresa tu PIN de operador para ver las mesas.'
                : 'Enter your operator PIN to view tables.',
          ),
        ),
      );
    }
    final controller = widget.controller;
    final room = widget.tableState;
    final document = controller.plan?.published;
    final areas = document == null
        ? <FloorPlanArea>[]
        : FloorPlanDocument.fromJson(
            document,
          ).areas.map(FloorPlanArea.fromJson).toList();
    final area =
        areas.where((value) => value.id == _areaId).firstOrNull ??
        areas.firstOrNull;
    final tables = areas
        .expand((value) => value.elements.map(FloorPlanElement.fromJson))
        .where((element) => element.kind == 'table')
        .toList(growable: false);
    _elementsById = {for (final table in tables) table.id: table};
    final visuals = room == null ? null : _visuals(room, tables);
    return Scaffold(
      appBar: AppBar(
        title: Text(es ? 'Mesas' : 'Tables'),
        actions: [
          IconButton(
            tooltip: es ? 'Actualizar' : 'Refresh',
            onPressed: controller.loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: _list
                ? (es ? 'Ver plano' : 'Show map')
                : (es ? 'Ver lista' : 'Show list'),
            onPressed: () => setState(() => _list = !_list),
            icon: Icon(_list ? Icons.map_outlined : Icons.list),
          ),
        ],
      ),
      body: Column(
        children: [
          if (controller.loading) const LinearProgressIndicator(),
          if (controller.failed)
            MaterialBanner(
              content: Text(
                es
                    ? 'No se pudo actualizar el plano. La información puede estar desactualizada.'
                    : 'Could not refresh the floor plan. The information may be out of date.',
              ),
              actions: [
                TextButton(
                  onPressed: _load,
                  child: Text(es ? 'Reintentar' : 'Retry'),
                ),
              ],
            ),
          if (room != null && room.stale)
            MaterialBanner(
              content: Text(
                es
                    ? 'No se pudo actualizar el estado de las mesas. Lo que ves puede estar desactualizado.'
                    : 'Could not refresh table state. What you see may be out of date.',
              ),
              actions: [
                TextButton(
                  onPressed: _load,
                  child: Text(es ? 'Reintentar' : 'Retry'),
                ),
              ],
            ),
          if (room?.errorCode != null) _failureBanner(room!, l10n),
          if (_notice != null)
            MaterialBanner(
              content: Text(_notice!),
              actions: [
                TextButton(
                  onPressed: () => setState(() => _notice = null),
                  child: Text(l10n.closeAction),
                ),
              ],
            ),
          if (_mergeMode || _moveFrom != null) _gestureBar(room, l10n, es),
          if (controller.refreshedAt != null)
            Padding(
              padding: const EdgeInsets.all(8),
              child: Text(
                '${es ? 'Plano actualizado' : 'Map refreshed'}: ${MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(controller.refreshedAt!))}',
              ),
            ),
          if (areas.isNotEmpty)
            FloorPlanAreaSelector(
              areas: areas,
              selectedAreaId: area?.id,
              onSelect: (value) => setState(() => _areaId = value),
            ),
          Expanded(
            child: area == null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        controller.loading
                            ? (es ? 'Carga del plano…' : 'Loading floor plan…')
                            : controller.failed
                            ? (es
                                  ? 'Plano no disponible.'
                                  : 'Floor plan unavailable.')
                            : (es
                                  ? 'Publica un plano desde el dashboard para ver las mesas aquí.'
                                  : 'Publish a floor plan from the dashboard to see tables here.'),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  )
                : _list
                ? ListView(
                    children: area.elements
                        .map(FloorPlanElement.fromJson)
                        .where((element) => element.kind == 'table')
                        .map(
                          (element) => ListTile(
                            leading: const Icon(
                              Icons.table_restaurant_outlined,
                            ),
                            title: Text(element.label),
                            subtitle: Text(
                              _tableSubtitle(element, visuals, es),
                            ),
                            onTap: () => _onTableTap(element, l10n, es),
                          ),
                        )
                        .toList(),
                  )
                : FloorPlanMap(
                    key: ValueKey('$_context:${area.id}'),
                    area: area,
                    tableStates: visuals,
                    onTableTap: (element) => _onTableTap(element, l10n, es),
                  ),
          ),
        ],
      ),
    );
  }

  /// What the map draws for every published table, by table id.
  Map<String, FloorPlanTableVisual> _visuals(
    TableStateController room,
    List<FloorPlanElement> tables,
  ) {
    final groupSize = <String, int>{};
    for (final table in tables) {
      final groupId = room.stateOf(table.id).groupId;
      if (groupId != null) groupSize[groupId] = (groupSize[groupId] ?? 0) + 1;
    }
    return {
      for (final table in tables)
        table.id: FloorPlanTableVisual(
          state: room.stateOf(table.id).state,
          turn: switch (room.elapsedOf(table.id)) {
            final elapsed? => formatTableTurn(elapsed),
            _ => null,
          },
          groupId: room.stateOf(table.id).groupId,
          groupSize: switch (room.stateOf(table.id).groupId) {
            final groupId? => groupSize[groupId],
            _ => null,
          },
          selected: _selection.contains(table.id),
          moving: _moveFrom == table.id,
        ),
    };
  }

  String _tableSubtitle(
    FloorPlanElement element,
    Map<String, FloorPlanTableVisual>? visuals,
    bool es,
  ) {
    final seats = '${element.capacity} ${es ? 'lugares' : 'seats'}';
    final visual = visuals?[element.id];
    if (visual == null) return seats;
    final state = _stateLabel(visual.state, es);
    return visual.turn == null ? '$state - $seats' : '$state - ${visual.turn}';
  }

  String _stateLabel(String state, bool es) {
    final l10n = AppLocalizations.of(context);
    return switch (state) {
      tableStateSeated => l10n.tableStateSeatedLabel,
      tableStateOrdered => l10n.tableStateOrderedLabel,
      tableStateServed => l10n.tableStateServedLabel,
      tableStateAwaitingPayment => l10n.tableStateAwaitingPaymentLabel,
      tableStateDirty => l10n.tableStateDirtyLabel,
      _ => l10n.tableStateOpenLabel,
    };
  }

  Widget _failureBanner(TableStateController room, AppLocalizations l10n) {
    final failure = describeTableStateFailure(room.errorCode!, l10n);
    return MaterialBanner(
      content: Text('${failure.title}\n${failure.message}\n${failure.recovery}'),
      actions: [
        TextButton(
          onPressed: () {
            room.dismissError();
            _load();
          },
          child: Text(l10n.tableStateFailureRefresh),
        ),
        TextButton(
          onPressed: room.dismissError,
          child: Text(l10n.closeAction),
        ),
      ],
    );
  }

  Widget _gestureBar(
    TableStateController? room,
    AppLocalizations l10n,
    bool es,
  ) {
    final theme = Theme.of(context);
    final label = _moveFrom != null
        ? l10n.tableStateMoveArmed(_elementsById[_moveFrom]?.label ?? '')
        : l10n.tableStateSelectHint;
    return Material(
      color: theme.colorScheme.secondaryContainer,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: UmiSpacing.md,
          vertical: UmiSpacing.sm,
        ),
        child: Row(
          children: [
            Icon(
              _moveFrom != null ? Icons.arrow_forward : Icons.check_box_outlined,
              color: theme.colorScheme.onSecondaryContainer,
            ),
            const SizedBox(width: UmiSpacing.sm),
            Expanded(child: Text(label)),
            if (_mergeMode)
              Text(
                l10n.tableStateSelectedCount(_selection.length),
                style: theme.textTheme.labelLarge,
              ),
            if (_mergeMode && _selection.length > 1)
              TextButton(
                onPressed: () => _mergeSelected(l10n),
                child: Text(l10n.tableStateMergeAction),
              ),
            IconButton(
              tooltip: es ? 'Cancelar' : 'Cancel',
              onPressed: () => setState(() {
                _mergeMode = false;
                _moveFrom = null;
                _selection.clear();
                _notice = null;
              }),
              icon: const Icon(Icons.close),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _onTableTap(
    FloorPlanElement element,
    AppLocalizations l10n,
    bool es,
  ) async {
    final room = widget.tableState;
    if (room == null) {
      await _details(element, es);
      return;
    }
    final from = _moveFrom;
    if (from != null && from != element.id) {
      await _moveParty(from, element, l10n);
      return;
    }
    if (_mergeMode) {
      _toggleSelection(element, l10n);
      return;
    }
    await _details(element, es, l10n);
  }

  /// The acceptance gesture: pick a seated party, tap a free table, and the
  /// party moves with its turn timer intact. The capacity is checked against the
  /// published plan before the request, so the operator gets the answer at once;
  /// the server refuses the same move independently.
  Future<void> _moveParty(
    String fromTableId,
    FloorPlanElement target,
    AppLocalizations l10n,
  ) async {
    final room = widget.tableState!;
    if (!tableIsFree(room.stateOf(target.id).state)) {
      setState(() => _notice = l10n.tableStateTargetOccupied);
      return;
    }
    final partySize = room.stateOf(fromTableId).partySize ?? 0;
    if (partySize > target.capacity) {
      setState(() => _notice = l10n.tableStateTargetTooSmall(partySize));
      return;
    }
    final moved = await room.move(
      fromTableId: fromTableId,
      toTableId: target.id,
    );
    if (!mounted) return;
    setState(() {
      if (moved) {
        _moveFrom = null;
        _notice = null;
      }
    });
  }

  void _toggleSelection(FloorPlanElement element, AppLocalizations l10n) {
    final room = widget.tableState!;
    if (!tableIsFree(room.stateOf(element.id).state)) {
      setState(() => _notice = l10n.tableStateTargetOccupied);
      return;
    }
    setState(() {
      _notice = null;
      if (!_selection.remove(element.id)) _selection.add(element.id);
    });
  }

  Future<void> _mergeSelected(AppLocalizations l10n) async {
    final room = widget.tableState;
    if (room == null) return;
    final tableIds = List<String>.of(_selection);
    final seats = tableIds.fold<int>(
      0,
      (total, id) => total + (_elementsById[id]?.capacity ?? 0),
    );
    final partySize = await _askPartySize(
      title: l10n.tableStateMergeTitle,
      subtitle: l10n.tableStateMergeSummary(tableIds.length, seats),
      initial: seats,
      maximum: seats,
      l10n: l10n,
    );
    if (partySize == null) return;
    final merged = await room.merge(tableIds: tableIds, partySize: partySize);
    if (!mounted) return;
    setState(() {
      if (merged) {
        _selection.clear();
        _mergeMode = false;
        _notice = null;
      }
    });
  }

  Future<void> _seat(FloorPlanElement element, AppLocalizations l10n) async {
    final room = widget.tableState;
    if (room == null) return;
    final partySize = await _askPartySize(
      title: l10n.tableStateSeatTitle(element.label),
      subtitle: '${element.capacity} ${l10n.tableStatePartySizeField}',
      initial: math.min(element.capacity, 2),
      maximum: element.capacity,
      l10n: l10n,
    );
    if (partySize == null) return;
    await room.seat(element.id, partySize);
  }

  Future<void> _clearTable(
    FloorPlanElement element,
    AppLocalizations l10n,
    bool es,
  ) async {
    final room = widget.tableState;
    if (room == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: Text(l10n.tableStateClearAction),
        content: Text(
          es
              ? '¿Ya se fue el grupo de ${element.label}?'
              : 'Has the party left ${element.label}?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialog).pop(false),
            child: Text(l10n.tableStateCancelAction),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialog).pop(true),
            child: Text(l10n.confirmAction),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await room.clearTable(element.id);
  }

  /// The party size stepper shared by seating and merging.
  Future<int?> _askPartySize({
    required String title,
    required String? subtitle,
    required int initial,
    required int maximum,
    required AppLocalizations l10n,
  }) {
    final ceiling = maximum < 1 ? 1 : maximum;
    var value = initial.clamp(1, ceiling);
    return showDialog<int>(
      context: context,
      builder: (dialog) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(title),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (subtitle != null) Text(subtitle),
              const SizedBox(height: UmiSpacing.sm),
              Row(
                children: [
                  IconButton(
                    tooltip: 'menos',
                    onPressed: value <= 1
                        ? null
                        : () => setDialogState(() => value -= 1),
                    icon: const Icon(Icons.remove_circle_outline),
                  ),
                  Expanded(
                    child: Text(
                      '$value',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                  ),
                  IconButton(
                    tooltip: 'mas',
                    onPressed: value >= ceiling
                        ? null
                        : () => setDialogState(() => value += 1),
                    icon: const Icon(Icons.add_circle_outline),
                  ),
                ],
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialog).pop(),
              child: Text(l10n.tableStateCancelAction),
            ),
            TextButton(
              onPressed: () => Navigator.of(dialog).pop(value),
              child: Text(l10n.confirmAction),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _details(
    FloorPlanElement element,
    bool es, [
    AppLocalizations? localizations,
  ]) async {
    final room = widget.tableState;
    if (room == null) {
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(element.label),
          content: Text('${element.capacity} ${es ? 'lugares' : 'seats'}'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(es ? 'Cerrar' : 'Close'),
            ),
          ],
        ),
      );
      return;
    }
    final l10n = localizations ?? AppLocalizations.of(context);
    final entry = room.stateOf(element.id);
    final present = tablePartyStates.contains(entry.state);
    final elapsed = room.elapsedOf(element.id);
    final groupId = entry.groupId;
    final groupSize = groupId == null ? 0 : room.group(groupId).length;
    final actions = <({String label, IconData icon, VoidCallback onTap})>[];
    if (present) {
      actions.add((
        label: l10n.tableStateMoveAction,
        icon: Icons.arrow_forward,
        onTap: () => setState(() {
          _moveFrom = element.id;
          _mergeMode = false;
          _selection.clear();
          _notice = null;
        }),
      ));
      if (groupSize > 1) {
        actions.add((
          label: l10n.tableStateSplitAction,
          icon: Icons.call_split,
          onTap: () => unawaited(room.split(element.id)),
        ));
      }
      actions.add((
        label: l10n.tableStateOrderedAction,
        icon: Icons.receipt_long,
        onTap: () => unawaited(room.markOrdered(element.id)),
      ));
      actions.add((
        label: l10n.tableStateServedAction,
        icon: Icons.restaurant,
        onTap: () => unawaited(room.markServed(element.id)),
      ));
      actions.add((
        label: l10n.tableStateAwaitingPaymentAction,
        icon: Icons.request_quote,
        onTap: () => unawaited(room.markAwaitingPayment(element.id)),
      ));
      actions.add((
        label: l10n.tableStateClearAction,
        icon: Icons.cleaning_services_outlined,
        onTap: () => unawaited(_clearTable(element, l10n, es)),
      ));
    } else {
      actions.add((
        label: l10n.tableStateSeatAction,
        icon: Icons.person_add_alt,
        onTap: () => unawaited(_seat(element, l10n)),
      ));
      if (entry.state == tableStateDirty) {
        actions.add((
          label: l10n.tableStateReadyAction,
          icon: Icons.check_circle_outline,
          onTap: () => unawaited(room.markReady(element.id)),
        ));
      }
      actions.add((
        label: l10n.tableStateSelectAction,
        icon: Icons.check_box_outlined,
        onTap: () => setState(() {
          _mergeMode = true;
          _notice = null;
          if (!_selection.contains(element.id)) _selection.add(element.id);
        }),
      ));
    }
    await showDialog<void>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: Text(element.label),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _stateLabel(entry.state, es),
                style: Theme.of(dialog).textTheme.titleMedium,
              ),
              const SizedBox(height: UmiSpacing.xs),
              Text(
                '${element.capacity} ${es ? 'lugares' : 'seats'}',
                style: Theme.of(dialog).textTheme.bodySmall,
              ),
              if (entry.partySize != null)
                Text(
                  l10n.tableStatePartySizeLabel(entry.partySize!),
                  style: Theme.of(dialog).textTheme.bodySmall,
                ),
              if (elapsed != null)
                Text(
                  l10n.tableStateElapsedLabel(formatTableTurn(elapsed)),
                  style: Theme.of(dialog).textTheme.bodySmall,
                ),
              if (groupSize > 1)
                Text(
                  l10n.tableStateGroupLabel(groupSize),
                  style: Theme.of(dialog).textTheme.bodySmall,
                ),
              const Divider(),
              ...actions.map(
                (action) => _action(
                  dialog,
                  action.label,
                  action.icon,
                  action.onTap,
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialog).pop(),
            child: Text(l10n.closeAction),
          ),
        ],
      ),
    );
  }

  Widget _action(
    BuildContext dialog,
    String label,
    IconData icon,
    VoidCallback onTap,
  ) => ListTile(
    leading: Icon(icon),
    title: Text(label),
    contentPadding: EdgeInsets.zero,
    onTap: () {
      Navigator.of(dialog).pop();
      onTap();
    },
  );
}

/// What one table looks like beyond its published geometry. [state] is always
/// one of the contract's six names.
final class FloorPlanTableVisual {
  const FloorPlanTableVisual({
    required this.state,
    this.turn,
    this.groupId,
    this.groupSize,
    this.selected = false,
    this.moving = false,
  });

  final String state;
  final String? turn;
  final String? groupId;
  final int? groupSize;
  final bool selected;
  final bool moving;

  bool get partyPresent => tablePartyStates.contains(state);
}

/// A refusal the API can answer with, phrased for the operator: what happened,
/// and what to do next. Section 4 of the plan's quality bar is that every
/// failure shows a typed message with a recovery action, so a code without both
/// is a bug rather than a gap.
final class TableStateFailure {
  const TableStateFailure({
    required this.title,
    required this.message,
    required this.recovery,
  });

  final String title;
  final String message;
  final String recovery;
}

TableStateFailure describeTableStateFailure(
  String code,
  AppLocalizations l10n,
) => switch (code) {
  'TABLE_ALREADY_OCCUPIED' => TableStateFailure(
    title: l10n.tableStateFailureTitle,
    message: l10n.tableStateFailureAlreadyOccupiedMessage,
    recovery: l10n.tableStateFailureAlreadyOccupiedRecovery,
  ),
  'TABLE_CAPACITY_EXCEEDED' => TableStateFailure(
    title: l10n.tableStateFailureTitle,
    message: l10n.tableStateFailureCapacityExceededMessage,
    recovery: l10n.tableStateFailureCapacityExceededRecovery,
  ),
  'TABLE_NOT_OCCUPIED' => TableStateFailure(
    title: l10n.tableStateFailureTitle,
    message: l10n.tableStateFailureNotOccupiedMessage,
    recovery: l10n.tableStateFailureNotOccupiedRecovery,
  ),
  'TABLE_NOT_GROUPED' => TableStateFailure(
    title: l10n.tableStateFailureTitle,
    message: l10n.tableStateFailureNotGroupedMessage,
    recovery: l10n.tableStateFailureNotGroupedRecovery,
  ),
  'TABLE_NOT_IN_PLAN' => TableStateFailure(
    title: l10n.tableStateFailureTitle,
    message: l10n.tableStateFailureNotInPlanMessage,
    recovery: l10n.tableStateFailureNotInPlanRecovery,
  ),
  'IDEMPOTENCY_CONFLICT' => TableStateFailure(
    title: l10n.tableStateFailureTitle,
    message: l10n.tableStateFailureIdempotencyConflictMessage,
    recovery: l10n.tableStateFailureIdempotencyConflictRecovery,
  ),
  'PERMISSION_DENIED' => TableStateFailure(
    title: l10n.tableStateFailureTitle,
    message: l10n.tableStateFailurePermissionDeniedMessage,
    recovery: l10n.tableStateFailurePermissionDeniedRecovery,
  ),
  'FLOOR_PLAN_NOT_PUBLISHED' => TableStateFailure(
    title: l10n.tableStateFailureTitle,
    message: l10n.tableStateFailurePlanNotPublishedMessage,
    recovery: l10n.tableStateFailurePlanNotPublishedRecovery,
  ),
  _ => TableStateFailure(
    title: l10n.tableStateFailureTitle,
    message: l10n.tableStateFailureGenericMessage,
    recovery: l10n.tableStateFailureGenericRecovery,
  ),
};

/// A turn timer, short enough for a table on a map: `1:05 h`, `12 min`, `40 s`.
String formatTableTurn(Duration elapsed) {
  final seconds = elapsed.isNegative ? 0 : elapsed.inSeconds;
  final hours = seconds ~/ 3600;
  final minutes = (seconds % 3600) ~/ 60;
  if (hours > 0) return '$hours:${minutes.toString().padLeft(2, '0')} h';
  if (minutes > 0) return '$minutes min';
  return '$seconds s';
}

/// Counts placed tables in an area. Derived from published geometry only.
int floorPlanTableCount(FloorPlanArea area) => area.elements
    .map(FloorPlanElement.fromJson)
    .where((element) => element.kind == 'table')
    .length;

/// Table count for one area, phrased for the active locale.
String floorPlanTableCountLabel(int count, {required bool spanish}) => spanish
    ? (count == 1 ? '1 mesa' : '$count mesas')
    : (count == 1 ? '1 table' : '$count tables');

/// Horizontal area selector. Each tab shows the area name and its table count.
class FloorPlanAreaSelector extends StatelessWidget {
  const FloorPlanAreaSelector({
    super.key,
    required this.areas,
    required this.selectedAreaId,
    required this.onSelect,
  });

  final List<FloorPlanArea> areas;
  final String? selectedAreaId;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    return DecoratedBox(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
          bottom: BorderSide(color: theme.colorScheme.outlineVariant),
        ),
      ),
      child: SizedBox(
        height: 68,
        child: ListView.builder(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.sm),
          itemCount: areas.length,
          itemBuilder: (context, index) =>
              _tab(context, theme, areas[index], spanish),
        ),
      ),
    );
  }

  Widget _tab(
    BuildContext context,
    ThemeData theme,
    FloorPlanArea area,
    bool spanish,
  ) {
    final scheme = theme.colorScheme;
    final selected = area.id == selectedAreaId;
    final color = selected ? scheme.primary : scheme.onSurfaceVariant;
    final countLabel = floorPlanTableCountLabel(
      floorPlanTableCount(area),
      spanish: spanish,
    );
    return Semantics(
      button: true,
      selected: selected,
      label: '${area.name}, $countLabel',
      child: InkWell(
        onTap: () => onSelect(area.id),
        child: Container(
          constraints: const BoxConstraints(minWidth: 96),
          padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.md),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: selected ? scheme.primary : Colors.transparent,
                width: 3,
              ),
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                area.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleMedium?.copyWith(
                  color: color,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                countLabel,
                maxLines: 1,
                style: theme.textTheme.bodySmall?.copyWith(color: color),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class FloorPlanMap extends StatelessWidget {
  const FloorPlanMap({
    super.key,
    required this.area,
    required this.onTableTap,
    this.tableStates,
  });
  final FloorPlanArea area;
  final ValueChanged<FloorPlanElement> onTableTap;

  /// The live state of each table, by table id. Null draws a map with no room
  /// state on it, which is what a surface without a table-state client shows.
  final Map<String, FloorPlanTableVisual>? tableStates;

  @override
  Widget build(BuildContext context) {
    final palette = _FloorPlanPalette.of(context);
    final elements = area.elements
        .map(FloorPlanElement.fromJson)
        .toList(growable: false);
    return LayoutBuilder(
      builder: (context, constraints) {
        final scale = math.min(
          constraints.maxWidth / area.width,
          constraints.maxHeight / area.height,
        );
        return Center(
          child: InteractiveViewer(
            minScale: 1,
            maxScale: 4,
            child: SizedBox(
              width: area.width * scale,
              height: area.height * scale,
              child: DecoratedBox(
                decoration: BoxDecoration(color: palette.canvas),
                child: Stack(
                  children: [
                    // The merged group's boundary goes under its tables: one
                    // party, one bounded region.
                    for (final region in _groupRegions(elements))
                      Positioned(
                        left: region.rect.left * scale,
                        top: region.rect.top * scale,
                        width: region.rect.width * scale,
                        height: region.rect.height * scale,
                        child: DecoratedBox(
                          key: ValueKey('floor-plan-group-${region.groupId}'),
                          decoration: BoxDecoration(
                            color: palette.groupFill,
                            border: Border.all(
                              color: palette.groupBorder,
                              width: 2,
                            ),
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                      ),
                    for (final element in elements)
                      Positioned(
                        left: (element.x - element.width / 2) * scale,
                        top: (element.y - element.height / 2) * scale,
                        width: element.width * scale,
                        height: element.height * scale,
                        child: Transform.rotate(
                          angle: element.rotation * math.pi / 180,
                          child: _FloorPlanElement(
                            element: element,
                            palette: palette,
                            state: tableStates?[element.id],
                            onTap: element.kind == 'table'
                                ? () => onTableTap(element)
                                : null,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  /// One bounding box per merged group, in plan coordinates. Only groups of two
  /// or more tables are drawn: a single table with a `groupId` is not a group.
  List<({String groupId, Rect rect})> _groupRegions(
    List<FloorPlanElement> elements,
  ) {
    final states = tableStates;
    if (states == null) return const [];
    final byGroup = <String, Rect>{};
    final counts = <String, int>{};
    for (final element in elements) {
      final groupId = states[element.id]?.groupId;
      if (groupId == null) continue;
      counts[groupId] = (counts[groupId] ?? 0) + 1;
      final rect = Rect.fromCenter(
        center: Offset(element.x.toDouble(), element.y.toDouble()),
        width: element.width.toDouble(),
        height: element.height.toDouble(),
      );
      byGroup[groupId] = byGroup[groupId]?.expandToInclude(rect) ?? rect;
    }
    return [
      for (final entry in byGroup.entries)
        if ((counts[entry.key] ?? 0) > 1)
          (groupId: entry.key, rect: entry.value.inflate(14)),
    ];
  }
}

/// One published element: a white shape with a bold label above a divider and
/// the seat count below it, for tables. The room state changes the drawing and
/// not only the colour: a badge glyph per state, a filled seat band while a
/// party is present, hatched seat space when the table needs wiping.
class _FloorPlanElement extends StatelessWidget {
  const _FloorPlanElement({
    required this.element,
    required this.palette,
    this.state,
    this.onTap,
  });

  final FloorPlanElement element;
  final _FloorPlanPalette palette;
  final FloorPlanTableVisual? state;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final isTable = element.kind == 'table';
    final visual = state;
    final accent = visual == null || visual.state == tableStateOpen
        ? null
        : palette.stateAccent(visual.state);
    final selected = visual?.selected == true || visual?.moving == true;
    final border = BorderSide(
      color: selected
          ? palette.scheme.primary
          : (accent ?? palette.borderFor(element.kind)),
      width: selected ? 3 : (accent == null ? 1 : 2),
    );
    return Semantics(
      label: isTable
          ? '${element.label}, ${element.capacity}, ${_stateSemantics(visual)}'
          : element.label,
      button: isTable,
      child: Material(
        key: ValueKey('floor-plan-element-${element.id}'),
        color: palette.fillFor(element.kind, visual?.state),
        shape: element.shape == 'round'
            ? CircleBorder(side: border)
            : RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(isTable ? 8 : 2),
                side: border,
              ),
        clipBehavior: Clip.antiAlias,
        elevation: isTable ? palette.tableElevation : 0,
        shadowColor: palette.shadow,
        surfaceTintColor: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: LayoutBuilder(
            builder: (context, constraints) =>
                _content(constraints.maxWidth, constraints.maxHeight),
          ),
        ),
      ),
    );
  }

  String _stateSemantics(FloorPlanTableVisual? visual) {
    if (visual == null) return '';
    final turn = visual.turn;
    return switch (visual.state) {
      tableStateSeated => turn == null ? 'seated' : 'seated $turn',
      tableStateOrdered => 'ordered',
      tableStateServed => 'served',
      tableStateAwaitingPayment => 'awaiting payment',
      tableStateDirty => 'needs cleaning',
      _ => 'open',
    };
  }

  Widget _content(double width, double height) {
    final isTable = element.kind == 'table';
    if (math.min(width, height) < 12) return const SizedBox.expand();
    // Small elements keep only the label; the divider and seats need room.
    final detailed = isTable && width >= 28 && height >= 32;
    final band = detailed ? height / 2 : height;
    final style = TextStyle(
      color: palette.labelFor(element.kind),
      fontWeight: FontWeight.w700,
      fontSize: math.min(band * 0.55, width * 0.4).clamp(7.0, 26.0),
      height: 1.1,
    );
    final visual = state;
    final turn = visual?.turn;
    final label = Padding(
      padding: EdgeInsets.symmetric(horizontal: width * 0.06),
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              element.label,
              maxLines: 1,
              textAlign: TextAlign.center,
              style: style,
            ),
            if (turn != null)
              Text(
                turn,
                maxLines: 1,
                textAlign: TextAlign.center,
                style: style.copyWith(
                  fontSize: math.min(band * 0.32, width * 0.3).clamp(6.0, 15.0),
                  color: palette.stateAccent(visual!.state),
                ),
              ),
          ],
        ),
      ),
    );
    final dirty = visual?.state == tableStateDirty;
    final present = visual?.partyPresent == true;
    final body = !detailed
        ? Center(child: label)
        : Column(
            children: [
              Expanded(child: Center(child: label)),
              Container(
                key: ValueKey('floor-plan-divider-${element.id}'),
                height: 1,
                color: palette.divider,
              ),
              Expanded(
                child: dirty
                    ? FloorPlanClearedBand(
                        key: ValueKey('floor-plan-cleared-${element.id}'),
                        color: palette.stateAccent(tableStateDirty),
                      )
                    : element.capacity > 0
                    ? FloorPlanSeatDots(
                        key: ValueKey('floor-plan-seats-${element.id}'),
                        count: element.capacity,
                        color: present
                            ? palette.stateAccent(visual!.state)
                            : palette.seat,
                        filled: present,
                      )
                    : const SizedBox.expand(),
              ),
            ],
          );
    if (visual == null || visual.state == tableStateOpen) return body;
    // A round table is clipped to its circle, so a badge in the square corner of
    // that box is cut by the rim — a fragment instead of an icon, which leaves
    // those tables carrying their state by colour alone. §8D step 3 forbids
    // exactly that ("colour alone must not carry the state"), and half of this
    // room is round. The inset is the distance from the corner to the rim at 45
    // degrees, so a round table draws the glyph inside the circle and a
    // rectangular one keeps it in the corner.
    final badgeInset = element.shape == 'round'
        ? math.min(width, height) * 0.15
        : 1.0;
    return Stack(
      children: [
        Positioned.fill(child: body),
        if (math.min(width, height) >= 20)
          Positioned(
            top: badgeInset,
            right: badgeInset,
            child: Icon(
              tableStateGlyph(visual.state),
              size: math.min(width, height) * 0.26,
              color: palette.stateAccent(visual.state),
            ),
          ),
      ],
    );
  }
}

/// The glyph that carries a state, so the state is never colour alone.
IconData tableStateGlyph(String state) => switch (state) {
  tableStateSeated => Icons.event_seat,
  tableStateOrdered => Icons.receipt_long,
  tableStateServed => Icons.restaurant,
  tableStateAwaitingPayment => Icons.payments_outlined,
  tableStateDirty => Icons.cleaning_services,
  _ => Icons.check_circle_outline,
};

/// Compact seat dots that represent a table's capacity in the lower band.
/// Hollow while the table is free, filled once a party is on it.
class FloorPlanSeatDots extends StatelessWidget {
  const FloorPlanSeatDots({
    super.key,
    required this.count,
    required this.color,
    this.filled = false,
  });

  final int count;
  final Color color;
  final bool filled;

  @override
  Widget build(BuildContext context) => CustomPaint(
    size: Size.infinite,
    painter: _FloorPlanSeatDotPainter(
      count: count,
      color: color,
      filled: filled,
    ),
  );
}

class _FloorPlanSeatDotPainter extends CustomPainter {
  const _FloorPlanSeatDotPainter({
    required this.count,
    required this.color,
    required this.filled,
  });

  final int count;
  final Color color;
  final bool filled;

  @override
  void paint(Canvas canvas, Size size) {
    if (count <= 0 || size.width <= 0 || size.height <= 0) return;
    final rows = count <= 4 ? 1 : (count <= 8 ? 2 : 3);
    final perRow = (count / rows).ceil();
    final diameter = math.min(
      math.min(size.height / (rows * 1.7), size.width / (perRow * 2.2)),
      12.0,
    );
    if (diameter < 1.5) return;
    final gap = diameter * 0.8;
    final pitch = diameter + gap;
    final paint = Paint()
      ..color = color
      ..style = filled ? PaintingStyle.fill : PaintingStyle.stroke
      ..strokeWidth = 1.2;
    var top = (size.height - (rows * diameter + (rows - 1) * gap)) / 2;
    var remaining = count;
    for (var row = 0; row < rows; row++) {
      final inRow = math.min(perRow, remaining);
      remaining -= inRow;
      var left = (size.width - (inRow * diameter + (inRow - 1) * gap)) / 2;
      for (var dot = 0; dot < inRow; dot++) {
        canvas.drawCircle(
          Offset(left + diameter / 2, top + diameter / 2),
          diameter / 2,
          paint,
        );
        left += pitch;
      }
      top += pitch;
    }
  }

  @override
  bool shouldRepaint(_FloorPlanSeatDotPainter oldDelegate) =>
      oldDelegate.count != count ||
      oldDelegate.color != color ||
      oldDelegate.filled != filled;
}

/// The clearing mark a dirty table carries: hatching where the seats were.
class FloorPlanClearedBand extends StatelessWidget {
  const FloorPlanClearedBand({super.key, required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) =>
      CustomPaint(size: Size.infinite, painter: _FloorPlanHatchPainter(color));
}

class _FloorPlanHatchPainter extends CustomPainter {
  const _FloorPlanHatchPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.width <= 0 || size.height <= 0) return;
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.2;
    final step = math.max(size.height / 2.5, 4.0);
    for (var x = -size.height; x < size.width; x += step) {
      canvas.drawLine(
        Offset(x, size.height),
        Offset(x + size.height, 0),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(_FloorPlanHatchPainter oldDelegate) =>
      oldDelegate.color != color;
}

/// Floor surface colors resolved from the active theme.
class _FloorPlanPalette {
  const _FloorPlanPalette({
    required this.dark,
    required this.scheme,
    required this.canvas,
    required this.tableFill,
    required this.tableBorder,
    required this.divider,
    required this.seat,
    required this.label,
    required this.tableElevation,
    required this.shadow,
    required this.groupFill,
    required this.groupBorder,
    required this.stateTint,
    required this.stateAccents,
  });

  factory _FloorPlanPalette.of(BuildContext context) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    return _FloorPlanPalette(
      dark: dark,
      scheme: theme.colorScheme,
      canvas: dark ? const Color(0xff15161a) : const Color(0xffededf2),
      tableFill: dark ? const Color(0xff25272e) : Colors.white,
      tableBorder: dark ? const Color(0xff3b3e47) : const Color(0xffdfdfe7),
      divider: dark ? const Color(0xff3b3e47) : const Color(0xffe6e6ec),
      seat: dark ? const Color(0xffa7adb8) : const Color(0xff9ba1ab),
      label: theme.colorScheme.onSurface,
      tableElevation: dark ? 0 : 1.5,
      shadow: const Color(0x1a101828),
      groupFill: dark ? const Color(0x332f6f4f) : const Color(0x141b7f4b),
      groupBorder: dark ? const Color(0xff7fd0a6) : const Color(0xff1b7f4b),
      stateTint: dark ? const Color(0x221f9e63) : const Color(0x0f1b7f4b),
      stateAccents: {
        tableStateSeated: dark
            ? const Color(0xff7fd0a6)
            : const Color(0xff1b7f4b),
        tableStateOrdered: dark
            ? const Color(0xff8fc4ff)
            : const Color(0xff1d4ed8),
        tableStateServed: dark
            ? const Color(0xffc9b6ff)
            : const Color(0xff6d28d9),
        tableStateAwaitingPayment: dark
            ? const Color(0xffffd479)
            : const Color(0xffb45309),
        tableStateDirty: dark
            ? const Color(0xffffb078)
            : const Color(0xffc2410c),
      },
    );
  }

  final bool dark;
  final ColorScheme scheme;
  final Color canvas;
  final Color tableFill;
  final Color tableBorder;
  final Color divider;
  final Color seat;
  final Color label;
  final double tableElevation;
  final Color shadow;
  final Color groupFill;
  final Color groupBorder;
  final Color stateTint;
  final Map<String, Color> stateAccents;

  Color stateAccent(String state) => stateAccents[state] ?? scheme.primary;

  Color fillFor(String kind, [String? state]) {
    if (kind != 'table' || state == null || state == tableStateOpen) {
      return switch (kind) {
        'table' => tableFill,
        'wall' => dark ? const Color(0xff5a6577) : const Color(0xff64748b),
        'counter' => dark ? const Color(0xff4a4231) : const Color(0xffe8ddc9),
        'door' => dark ? const Color(0xff2e4557) : const Color(0xffbfd7e5),
        'label' => Colors.transparent,
        _ => scheme.surfaceContainerHighest,
      };
    }
    return Color.alphaBlend(stateTint, tableFill);
  }

  Color borderFor(String kind) => switch (kind) {
    'table' => tableBorder,
    'wall' => dark ? const Color(0xff76829a) : const Color(0xff526075),
    'counter' => dark ? const Color(0xff5e5440) : const Color(0xffcbbda2),
    'door' => dark ? const Color(0xff3d5a70) : const Color(0xff9dbece),
    'label' => Colors.transparent,
    _ => scheme.outlineVariant,
  };

  Color labelFor(String kind) => switch (kind) {
    'wall' => Colors.white,
    'label' => scheme.onSurfaceVariant,
    _ => label,
  };
}
