import 'dart:async';
import 'dart:math' as math;

import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/security/operator_permissions.dart';
import '../../core/theme/umi_theme.dart';
import '../../shared/widgets/station_document.dart';
import '../entry/entry_controller.dart';
import 'floor_plan_controller.dart';
import 'table_state_controller.dart';

Future<void> showFloorPlan(
  BuildContext context, {
  required FloorPlanController controller,
  required EntryController entry,
  TableStateController? tableState,
  Future<void> Function(FloorPlanElement table)? onOpenAccount,
  VoidCallback? onShowAccounts,
}) => Navigator.of(context).push(
  PosPageRoute<void>(
    builder: (_) => FloorPlanSurface(
      controller: controller,
      entry: entry,
      tableState: tableState,
      onOpenAccount: onOpenAccount,
      onShowAccounts: onShowAccounts,
    ),
  ),
);

class FloorPlanSurface extends StatefulWidget {
  const FloorPlanSurface({
    super.key,
    required this.controller,
    required this.entry,
    this.tableState,
    this.embedded = false,
    this.onOpenAccount,
    this.onShowAccounts,
    this.directAccounts = false,
    this.onSetUpTables,
  });
  final FloorPlanController controller;
  final EntryController entry;
  final bool embedded;
  final Future<void> Function(FloorPlanElement table)? onOpenAccount;
  final VoidCallback? onShowAccounts;
  final bool directAccounts;
  final VoidCallback? onSetUpTables;

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
  bool _active = true;
  bool _returningToEntry = false;

  /// Tables chosen for a merge, in the order they were tapped.
  final List<String> _selection = <String>[];
  bool _mergeMode = false;

  /// The table whose party is waiting for somewhere to go.
  String? _moveFrom;

  /// The table shown in the persistent detail panel. The panel keeps the
  /// address of the work on screen, so the operator reads the table and its
  /// actions without losing the map.
  String? _selectedId;

  /// At and above this width the surface shows the map and the detail panel
  /// side by side. Narrower surfaces keep the modal sheet.
  static const double _panelBreakpoint = 720;

  bool get _panelShown => MediaQuery.sizeOf(context).width >= _panelBreakpoint;

  // El plano reduce las etiquetas al espacio de cada mesa. El texto al 200 %
  // necesita una lista legible en pantallas angostas.
  bool get _accessibleList =>
      !_panelShown && MediaQuery.textScalerOf(context).scale(16) >= 32;

  /// The room read is behind, or the last read failed. The map keeps drawing
  /// what it has, and the top bar says so instead of pretending it is current.
  bool get _roomOffline {
    final room = widget.tableState;
    return room != null && (room.stale || room.errorCode != null);
  }

  /// Drives the map's zoom. The zoom buttons and the pinch gesture write the
  /// same controller, so the two cannot disagree about the scale.
  final TransformationController _zoom = TransformationController();

  static const double _zoomStep = 1.25;

  double get _zoomScale => _zoom.value.getMaxScaleOnAxis();

  void _zoomBy(double factor) {
    final next = (_zoomScale * factor).clamp(1.0, 4.0);
    setState(() => _zoom.value = Matrix4.diagonal3Values(next, next, 1));
  }

  /// A refusal the surface decided itself, before spending a request on it.
  String? _notice;
  String? _result;

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
      _result = null;
      _selectedId = null;
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
    _zoom.dispose();
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
    final theme = PosTheme.of(context);
    if (!_hasOperatorContext) {
      return PosPage(
        appBar: PosHeader(
          automaticallyImplyLeading: !widget.embedded,
          title: Text(es ? 'Mesas' : 'Tables'),
        ),
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
    return PosPage(
      body: SafeArea(
        child: Column(
          children: [
            _topBar(tables, visuals, l10n, es),
            if (widget.onShowAccounts != null)
              Align(
                alignment: Alignment.centerRight,
                child: PosTextButton.icon(
                  onPressed: widget.onShowAccounts,
                  icon: const PosIcon(PosGlyphs.receiptLong),
                  label: Text(es ? 'Cuentas abiertas' : 'Open accounts'),
                ),
              ),
            if (controller.loading) const PosProgress(),
            if (controller.failed)
              PosNoticeBanner(
                content: Text(
                  es
                      ? 'No se pudo actualizar el plano. La información puede estar desactualizada.'
                      : 'Could not refresh the floor plan. The information may be out of date.',
                ),
                actions: [
                  PosTextButton(
                    onPressed: _load,
                    child: Text(es ? 'Reintentar' : 'Retry'),
                  ),
                ],
              ),
            if (room != null && room.stale)
              PosNoticeBanner(
                content: Text(
                  es
                      ? 'No se pudo actualizar el estado de las mesas. Lo que ves puede estar desactualizado.'
                      : 'Could not refresh table state. What you see may be out of date.',
                ),
                actions: [
                  PosTextButton(
                    onPressed: _load,
                    child: Text(es ? 'Reintentar' : 'Retry'),
                  ),
                ],
              ),
            if (room?.errorCode != null) _failureBanner(room!, l10n),
            if (_notice != null)
              PosNoticeBanner(
                content: Text(_notice!),
                actions: [
                  PosTextButton(
                    onPressed: () => setState(() => _notice = null),
                    child: Text(l10n.closeAction),
                  ),
                ],
              ),
            if (_result != null)
              Semantics(
                liveRegion: true,
                child: PosNoticeBanner(
                  content: Text(_result!),
                  actions: [
                    PosTextButton(
                      onPressed: () => setState(() => _result = null),
                      child: Text(l10n.closeAction),
                    ),
                  ],
                ),
              ),
            if (_mergeMode || _moveFrom != null) _gestureBar(room, l10n, es),
            if (!widget.directAccounts && controller.refreshedAt != null)
              Padding(
                padding: const EdgeInsets.all(8),
                child: Text(
                  '${es ? 'Plano actualizado' : 'Map refreshed'}: ${PosLocalLabels.of(context).formatTimeOfDay(PosTime.fromDateTime(controller.refreshedAt!))}',
                ),
              ),
            if (areas.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  UmiSpacing.md,
                  0,
                  UmiSpacing.md,
                  UmiSpacing.sm,
                ),
                child: LayoutBuilder(
                  builder: (context, constraints) => Row(
                    children: [
                      Expanded(
                        child: FloorPlanAreaSelector(
                          areas: areas,
                          selectedAreaId: area?.id,
                          onSelect: (value) => setState(() => _areaId = value),
                        ),
                      ),
                      // The hint is a nicety, so it yields to the chips: the
                      // operator needs every area on a narrow surface.
                      //
                      // It ALSO YIELDS TO AN ARMED MODE. It says what a tap on a table does — open
                      // its detail — and with a move or a merge armed a tap does something else.
                      // Two instructions on one screen, one of them false, is how a table gets
                      // moved by accident; the gesture bar above already says what the next tap
                      // will do. Measured on the iMin D3-504 on 2026-10-11: with `Moviendo Mesa 3…`
                      // in the bar, this hint still read `Toca una mesa para ver el detalle`.
                      if (constraints.maxWidth >= 560 &&
                          _moveFrom == null &&
                          !_mergeMode) ...[
                        const SizedBox(width: UmiSpacing.md),
                        Flexible(
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 280),
                            child: Text(
                              es
                                  ? 'Toca una mesa para ver el detalle'
                                  : 'Tap a table to see its detail',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              textAlign: TextAlign.right,
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            Expanded(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(child: _roomView(area, visuals, l10n, es)),
                  if (_panelShown) _detailPanel(area, l10n, es),
                ],
              ),
            ),
            if (!_panelShown) _selectedSummary(area, l10n, es),
          ],
        ),
      ),
    );
  }

  /// The top bar: who is on shift, how the room stands, and the two controls
  /// that do not belong to the map itself.
  Widget _topBar(
    List<FloorPlanElement> tables,
    Map<String, FloorPlanTableVisual>? visuals,
    AppLocalizations l10n,
    bool es,
  ) {
    final branch = widget.entry.state.selectedBranch?.name;
    final operator = widget.entry.operatorName;
    final who = [branch, operator].whereType<String>().join(' · ');
    final dirty =
        visuals?.values
            .where((visual) => visual.state == tableStateDirty)
            .length ??
        0;
    return PosHeader(
      toolbarHeight: widget.directAccounts ? 56 : 72,
      actionsInline:
          widget.directAccounts && MediaQuery.sizeOf(context).width >= 560,
      automaticallyImplyLeading: !widget.embedded,
      leading: widget.embedded
          ? null
          : PosIconButton(
              tooltip: PosLocalLabels.of(context).backButtonTooltip,
              onPressed: _returningToEntry
                  ? null
                  : () => Navigator.of(context).maybePop(),
              icon: const PosIcon(PosGlyphs.arrowBack),
            ),
      title: StationHeading(
        title: es ? 'Mesas' : 'Tables',
        subtitle: widget.directAccounts || who.isEmpty ? null : who,
      ),
      actions: [
        if (visuals != null) ...[
          _TopBarBadge(
            label: es ? '${tables.length} mesas' : '${tables.length} tables',
            color: UmiTheme.brand,
          ),
          if (dirty > 0)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.sm),
              child: _TopBarBadge(
                label: es ? '$dirty por limpiar' : '$dirty to clear',
                color: const Color(0xFFB26A00),
              ),
            ),
          if (widget.tableState != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.sm),
              child: _TopBarBadge(
                label: _roomOffline
                    ? (es ? 'Sin conexión' : 'Offline')
                    : (es ? '● En línea' : '● Online'),
                color: _roomOffline
                    ? const Color(0xFFB26A00)
                    : const Color(0xFF3FA76B),
              ),
            ),
        ],
        PosIconButton(
          tooltip: es ? 'Actualizar' : 'Refresh',
          onPressed: widget.controller.loading ? null : _load,
          icon: const PosIcon(PosGlyphs.refresh),
        ),
      ],
    );
  }

  List<Widget> _zoomControls(bool es) => [
    PosIconButton(
      tooltip: es ? 'Alejar' : 'Zoom out',
      onPressed: _zoomScale <= 1 ? null : () => _zoomBy(1 / _zoomStep),
      icon: const PosIcon(PosGlyphs.removeCircleOutline),
    ),
    PosIconButton(
      tooltip: es ? 'Acercar' : 'Zoom in',
      onPressed: _zoomScale >= 4 ? null : () => _zoomBy(_zoomStep),
      icon: const PosIcon(PosGlyphs.addCircleOutline),
    ),
    PosOutlineButton(
      onPressed: () => setState(() => _zoom.value = Matrix4.identity()),
      child: Text(es ? 'Ajustar' : 'Fit'),
    ),
  ];

  Widget _roomView(
    FloorPlanArea? area,
    Map<String, FloorPlanTableVisual>? visuals,
    AppLocalizations l10n,
    bool es,
  ) {
    final controller = widget.controller;
    if (widget.directAccounts &&
        !controller.loading &&
        !controller.failed &&
        widget.onSetUpTables != null &&
        (controller.plan?.published == null ||
            !FloorPlanDocument.fromJson(controller.plan!.published!).areas
                .map(FloorPlanArea.fromJson)
                .any(
                  (room) => room.elements.any(
                    (element) => element['kind'] == 'table',
                  ),
                ))) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(es ? 'Aún no hay mesas' : 'There are no tables yet'),
            const SizedBox(height: UmiSpacing.md),
            PosButton(
              onPressed: widget.onSetUpTables,
              child: Text(es ? 'Crear mesas' : 'Create tables'),
            ),
          ],
        ),
      );
    }
    if (area == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            controller.loading
                ? (es ? 'Carga del plano…' : 'Loading floor plan…')
                : controller.failed
                ? (es ? 'Plano no disponible.' : 'Floor plan unavailable.')
                : (es
                      ? 'Publica un plano desde el dashboard para ver las mesas aquí.'
                      : 'Publish a floor plan from the dashboard to see tables here.'),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    if (_accessibleList) {
      return ListView(
        padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.md),
        children: area.elements
            .map(FloorPlanElement.fromJson)
            .where((element) => element.kind == 'table')
            .map(
              (element) => PosListRow(
                selected: _selectedId == element.id,
                leading: PosIcon(
                  tableStateGlyph(
                    visuals?[element.id]?.state ?? tableStateOpen,
                  ),
                  color: _FloorPlanPalette.of(
                    context,
                  ).stateAccent(visuals?[element.id]?.state ?? tableStateOpen),
                ),
                title: Text(element.label),
                subtitle: Text(_tableSubtitle(element, visuals, es)),
                trailing: const PosIcon(PosGlyphs.chevronRight),
                onTap: () => _onTableTap(element, l10n, es),
              ),
            )
            .toList(),
      );
    }
    final theme = PosTheme.of(context);
    return Column(
      children: [
        Expanded(
          child: Container(
            margin: const EdgeInsets.fromLTRB(
              UmiSpacing.md,
              0,
              UmiSpacing.sm,
              UmiSpacing.sm,
            ),
            decoration: BoxDecoration(
              color: theme.scaffoldBackgroundColor,
              borderRadius: BorderRadius.circular(UmiRadius.surface),
              border: Border.all(color: theme.colorScheme.outlineVariant),
            ),
            clipBehavior: Clip.antiAlias,
            child: Padding(
              padding: const EdgeInsets.all(UmiSpacing.sm),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(UmiRadius.control),
                child: FloorPlanMap(
                  key: ValueKey('$_context:${area.id}'),
                  area: area,
                  tableStates: visuals,
                  controller: _zoom,
                  onTableTap: (element) => _onTableTap(element, l10n, es),
                ),
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            UmiSpacing.md,
            0,
            UmiSpacing.sm,
            UmiSpacing.sm,
          ),
          child: _mapFooter(es),
        ),
      ],
    );
  }

  /// The legend and the zoom controls, under the map. The legend names every
  /// state in the till's own words, so the map's colour and glyph are never the
  /// only place a state is explained.
  Widget _mapFooter(bool es) {
    final theme = PosTheme.of(context);
    final palette = _FloorPlanPalette.of(context);
    return Row(
      children: [
        Expanded(
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final state in const [
                  tableStateOpen,
                  tableStateSeated,
                  tableStateOrdered,
                  tableStateServed,
                  tableStateAwaitingPayment,
                  tableStateDirty,
                ]) ...[
                  PosIcon(
                    tableStateGlyph(state),
                    size: 13,
                    color: palette.stateAccent(state),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    _stateLabel(state, es),
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: palette.stateAccent(state),
                    ),
                  ),
                  const SizedBox(width: 12),
                ],
              ],
            ),
          ),
        ),
        ..._zoomControls(es),
      ],
    );
  }

  /// The persistent detail panel. It holds the selected table, its live facts,
  /// and the actions the table offers. The map stays on screen, so the operator
  /// reads one table without losing the room.
  ///
  /// The rows are what the contract's table state actually carries: the party
  /// size, the turn, and the group. A server and a balance are not in it, so
  /// this panel does not invent them.
  Widget _panelRow(String label, String value) {
    final theme = PosTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          Text(value, style: theme.textTheme.bodySmall),
        ],
      ),
    );
  }

  Widget _detailPanel(FloorPlanArea? area, AppLocalizations l10n, bool es) {
    final theme = PosTheme.of(context);
    final palette = _FloorPlanPalette.of(context);
    final room = widget.tableState;
    final selected = _selectedId == null ? null : _elementsById[_selectedId];
    final inArea =
        selected != null &&
        area != null &&
        area.elements
            .map(FloorPlanElement.fromJson)
            .any((candidate) => candidate.id == selected.id);

    final children = <Widget>[];
    if (selected == null || !inArea) {
      children.add(
        Text(
          l10n.tableStatePanelEmpty,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      );
    } else {
      final entry = room?.stateOf(selected.id);
      final state = entry?.state ?? tableStateOpen;
      final elapsed = room?.elapsedOf(selected.id);
      final groupId = entry?.groupId;
      final groupSize = (room != null && groupId != null)
          ? room.group(groupId).length
          : 0;
      final partySize = entry?.partySize;
      children.addAll([
        Row(
          children: [
            Expanded(
              child: Text(
                l10n.tableStatePanelTitle(selected.label),
                style: theme.textTheme.titleLarge,
              ),
            ),
            Text(
              '${selected.capacity} ${es ? 'lugares' : 'seats'}',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
        const SizedBox(height: UmiSpacing.xs),
        Align(
          alignment: Alignment.centerLeft,
          child: Container(
            padding: const EdgeInsets.symmetric(
              horizontal: UmiSpacing.sm,
              vertical: UmiSpacing.xs,
            ),
            decoration: BoxDecoration(
              color: palette.stateAccent(state).withValues(alpha: .16),
              borderRadius: BorderRadius.circular(UmiRadius.surface),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: palette.stateAccent(state),
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: UmiSpacing.xs),
                Text(
                  _stateLabel(state, es),
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: palette.stateAccent(state),
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ),
        if (partySize != null)
          _panelRow(l10n.tableStatePartySizeField, '$partySize'),
        if (elapsed != null)
          _panelRow(l10n.tableStateElapsedField, formatTableTurn(elapsed)),
        if (groupSize > 1) _panelRow(l10n.tableStateGroupField, '$groupSize'),
        const PosDivider(),
        Text(
          l10n.tableStatePanelActions,
          style: theme.textTheme.labelMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: UmiSpacing.sm),
      ]);
      if (room != null) {
        final actions = _tableActions(selected, room, l10n, es);
        children.add(
          Wrap(
            spacing: UmiSpacing.sm,
            runSpacing: UmiSpacing.sm,
            children: [
              for (var index = 0; index < actions.length; index++)
                if (index == 0 && widget.onOpenAccount != null)
                  PosButton.icon(
                    onPressed: actions[index].onTap,
                    icon: PosIcon(actions[index].icon, size: 18),
                    label: Text(actions[index].label),
                  )
                else
                  PosOutlineButton.icon(
                    onPressed: actions[index].onTap,
                    icon: PosIcon(actions[index].icon, size: 18),
                    label: Text(actions[index].label),
                  ),
            ],
          ),
        );
      } else if (widget.onOpenAccount != null) {
        children.add(
          PosButton.icon(
            onPressed: () => unawaited(widget.onOpenAccount!(selected)),
            icon: const PosIcon(PosGlyphs.receiptLong),
            label: Text(es ? 'Abrir cuenta' : 'Open account'),
          ),
        );
      }
    }

    return Container(
      key: const ValueKey('table-detail-panel'),
      width: 320,
      margin: const EdgeInsets.fromLTRB(0, 0, UmiSpacing.md, UmiSpacing.md),
      padding: const EdgeInsets.all(UmiSpacing.md),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(UmiRadius.surface),
        border: Border.all(color: theme.colorScheme.outlineVariant),
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: children,
        ),
      ),
    );
  }

  Widget _selectedSummary(FloorPlanArea? area, AppLocalizations l10n, bool es) {
    final selected = _elementsById[_selectedId];
    if (selected == null ||
        area == null ||
        !area.elements.any(
          (value) => FloorPlanElement.fromJson(value).id == selected.id,
        )) {
      return const SizedBox.shrink();
    }
    final room = widget.tableState;
    final facts = <String>[
      _stateLabel(room?.stateOf(selected.id).state ?? tableStateOpen, es),
    ];
    final party = room?.stateOf(selected.id).partySize;
    if (party != null) facts.add(l10n.tableStatePartySizeLabel(party));
    return Container(
      key: const ValueKey('selected-table-summary'),
      padding: const EdgeInsets.all(UmiSpacing.sm),
      decoration: BoxDecoration(
        color: PosTheme.of(context).colorScheme.surface,
        border: Border(
          top: BorderSide(
            color: PosTheme.of(context).colorScheme.outlineVariant,
          ),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  selected.label,
                  style: PosTheme.of(context).textTheme.titleMedium,
                ),
                Text(
                  facts.join(' · '),
                  style: PosTheme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          PosOutlineButton(
            onPressed: () => _details(selected, es, l10n),
            child: Text(es ? 'Detalle' : 'Details'),
          ),
          PosIconButton(
            tooltip: es ? 'Quitar selección' : 'Clear selection',
            onPressed: () => setState(() => _selectedId = null),
            icon: const PosIcon(PosGlyphs.close),
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
          partySize: room.stateOf(table.id).partySize,
          turn: switch (room.elapsedOf(table.id)) {
            final elapsed? => formatTableTurn(elapsed),
            _ => null,
          },
          groupId: room.stateOf(table.id).groupId,
          groupSize: switch (room.stateOf(table.id).groupId) {
            final groupId? => groupSize[groupId],
            _ => null,
          },
          selected: _selection.contains(table.id) || _selectedId == table.id,
          moving: _moveFrom == table.id,
        ),
    };
  }

  String _tableSubtitle(
    FloorPlanElement element,
    Map<String, FloorPlanTableVisual>? visuals,
    bool es,
  ) {
    // THE SEATS ARE NOT THE TILL'S BUSINESS. The owner asked for them gone
    // (2026-10-12): capacity belongs to the floor plan the dashboard publishes, and
    // on the counter it competed with the two facts an operator reads off a tile —
    // whether the table is taken, and how long the party has been sitting there.
    final visual = visuals?[element.id];
    if (visual == null) return _stateLabel(tableStateOpen, es);
    return [
      _stateLabel(visual.state, es),
      if (visual.partySize != null)
        AppLocalizations.of(
          context,
        ).tableStatePartySizeLabel(visual.partySize!),
      if (visual.turn != null) visual.turn!,
    ].join(' · ');
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
    return PosNoticeBanner(
      content: Text(
        '${failure.title}\n${failure.message}\n${failure.recovery}',
      ),
      actions: [
        PosTextButton(
          onPressed: () {
            room.dismissError();
            _load();
          },
          child: Text(l10n.tableStateFailureRefresh),
        ),
        PosTextButton(
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
    final theme = PosTheme.of(context);
    final label = _moveFrom != null
        ? l10n.tableStateMoveArmed(_elementsById[_moveFrom]?.label ?? '')
        : l10n.tableStateSelectHint;
    return PosSurface(
      color: theme.colorScheme.secondaryContainer,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: UmiSpacing.md,
          vertical: UmiSpacing.sm,
        ),
        child: Row(
          children: [
            PosIcon(
              _moveFrom != null
                  ? PosGlyphs.arrowForward
                  : PosGlyphs.checkBoxOutlined,
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
              PosTextButton(
                onPressed: () => _mergeSelected(l10n),
                child: Text(l10n.tableStateMergeAction),
              ),
            PosIconButton(
              tooltip: es ? 'Cancelar' : 'Cancel',
              onPressed: () => setState(() {
                _mergeMode = false;
                _moveFrom = null;
                _selection.clear();
                _notice = null;
              }),
              icon: const PosIcon(PosGlyphs.close),
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
      setState(() => _selectedId = element.id);
      if (_panelShown) {
        return;
      }
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
    setState(() => _selectedId = element.id);
    if (_panelShown) return;
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
        _selectedId = target.id;
        final es = Localizations.localeOf(context).languageCode == 'es';
        _result = es
            ? 'Personas trasladadas a ${target.label}. El tiempo de atención se conserva.'
            : 'Guests moved to ${target.label}. The service timer is preserved.';
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
    final seated = await room.seat(element.id, partySize);
    if (seated && mounted) await widget.onOpenAccount?.call(element);
  }

  Future<void> _splitTables(
    FloorPlanElement element,
    AppLocalizations l10n,
    bool es,
  ) async {
    final confirmed = await showPosDialog<bool>(
      context: context,
      builder: (dialog) => PosAlertDialog(
        title: Text(l10n.tableStateSplitAction),
        content: Text(
          es
              ? 'Se separarán las mesas del grupo. Las personas se repartirán según la capacidad. Las mesas sin personas quedarán por limpiar. La cuenta se conserva en su mesa.'
              : 'Separate the group tables? Guests will be distributed within each capacity. Empty tables will need cleaning. The account stays on its table.',
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.of(dialog).pop(false),
            child: Text(l10n.tableStateCancelAction),
          ),
          PosTextButton(
            onPressed: () => Navigator.of(dialog).pop(true),
            child: Text(l10n.confirmAction),
          ),
        ],
      ),
    );
    if (confirmed == true && mounted) {
      await widget.tableState?.split(element.id);
    }
  }

  Future<void> _clearTable(
    FloorPlanElement element,
    AppLocalizations l10n,
    bool es,
  ) async {
    final room = widget.tableState;
    if (room == null) return;
    final confirmed = await showPosDialog<bool>(
      context: context,
      builder: (dialog) => PosAlertDialog(
        title: Text(l10n.tableStateClearAction),
        content: Text(
          es
              ? '¿Ya se fue el grupo de ${element.label}?'
              : 'Has the party left ${element.label}?',
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.of(dialog).pop(false),
            child: Text(l10n.tableStateCancelAction),
          ),
          PosTextButton(
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
    return showPosDialog<int>(
      context: context,
      builder: (dialog) => StatefulBuilder(
        builder: (context, setDialogState) => PosAlertDialog(
          title: Text(title),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (subtitle != null) Text(subtitle),
              const SizedBox(height: UmiSpacing.sm),
              Row(
                children: [
                  PosIconButton(
                    tooltip: 'menos',
                    onPressed: value <= 1
                        ? null
                        : () => setDialogState(() => value -= 1),
                    icon: const PosIcon(PosGlyphs.removeCircleOutline),
                  ),
                  Expanded(
                    child: Text(
                      '$value',
                      textAlign: TextAlign.center,
                      style: PosTheme.of(context).textTheme.headlineSmall,
                    ),
                  ),
                  PosIconButton(
                    tooltip: 'mas',
                    onPressed: value >= ceiling
                        ? null
                        : () => setDialogState(() => value += 1),
                    icon: const PosIcon(PosGlyphs.addCircleOutline),
                  ),
                ],
              ),
            ],
          ),
          actions: [
            PosTextButton(
              onPressed: () => Navigator.of(dialog).pop(),
              child: Text(l10n.tableStateCancelAction),
            ),
            PosTextButton(
              onPressed: () => Navigator.of(dialog).pop(value),
              child: Text(l10n.confirmAction),
            ),
          ],
        ),
      ),
    );
  }

  /// The actions a table offers, in the order the operator reads them. The
  /// detail panel and the modal sheet share this list, so one place owns the
  /// rule and the two surfaces cannot drift apart.
  List<({String label, PosGlyph icon, VoidCallback onTap})> _tableActions(
    FloorPlanElement element,
    TableStateController room,
    AppLocalizations l10n,
    bool es,
  ) {
    final entry = room.stateOf(element.id);
    final present = tablePartyStates.contains(entry.state);
    final groupId = entry.groupId;
    final groupSize = groupId == null ? 0 : room.group(groupId).length;
    final actions = <({String label, PosGlyph icon, VoidCallback onTap})>[];
    if (widget.onOpenAccount != null) {
      actions.add((
        label: es ? 'Abrir cuenta' : 'Open account',
        icon: PosGlyphs.receiptLong,
        onTap: () => unawaited(widget.onOpenAccount!(element)),
      ));
    }
    final permissions = OperatorPermissions(
      widget.entry.state.operator?.permissions ?? const [],
    );
    if (!permissions.allows('sale.lifecycle')) return actions;
    if (present) {
      actions.add((
        label: l10n.tableStateMoveAction,
        icon: PosGlyphs.arrowForward,
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
          icon: PosGlyphs.callSplit,
          onTap: () => unawaited(_splitTables(element, l10n, es)),
        ));
      }
      actions.add((
        label: l10n.tableStateOrderedAction,
        icon: PosGlyphs.receiptLong,
        onTap: () => unawaited(room.markOrdered(element.id)),
      ));
      actions.add((
        label: l10n.tableStateServedAction,
        icon: PosGlyphs.restaurant,
        onTap: () => unawaited(room.markServed(element.id)),
      ));
      actions.add((
        label: l10n.tableStateAwaitingPaymentAction,
        icon: PosGlyphs.requestQuote,
        onTap: () => unawaited(room.markAwaitingPayment(element.id)),
      ));
      actions.add((
        label: l10n.tableStateClearAction,
        icon: PosGlyphs.cleaningServicesOutlined,
        onTap: () => unawaited(_clearTable(element, l10n, es)),
      ));
    } else {
      actions.add((
        label: l10n.tableStateSeatAction,
        icon: PosGlyphs.personAddAlt,
        onTap: () => unawaited(_seat(element, l10n)),
      ));
      if (entry.state == tableStateDirty) {
        actions.add((
          label: l10n.tableStateReadyAction,
          icon: PosGlyphs.checkCircleOutline,
          onTap: () => unawaited(room.markReady(element.id)),
        ));
      }
      actions.add((
        label: l10n.tableStateSelectAction,
        icon: PosGlyphs.checkBoxOutlined,
        onTap: () => setState(() {
          _mergeMode = true;
          _notice = null;
          if (!_selection.contains(element.id)) _selection.add(element.id);
        }),
      ));
    }
    return actions;
  }

  Future<void> _details(
    FloorPlanElement element,
    bool es, [
    AppLocalizations? localizations,
  ]) async {
    final room = widget.tableState;
    if (room == null) {
      await showPosDialog<void>(
        context: context,
        builder: (context) => PosAlertDialog(
          title: Text(element.label),
          content: Text('${element.capacity} ${es ? 'lugares' : 'seats'}'),
          actions: [
            if (widget.onOpenAccount != null)
              PosButton(
                onPressed: () {
                  Navigator.pop(context);
                  unawaited(widget.onOpenAccount!(element));
                },
                child: Text(es ? 'Abrir cuenta' : 'Open account'),
              ),
            PosTextButton(
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
    final elapsed = room.elapsedOf(element.id);
    final groupId = entry.groupId;
    final groupSize = groupId == null ? 0 : room.group(groupId).length;
    final actions = _tableActions(element, room, l10n, es);
    await showPosDialog<void>(
      context: context,
      builder: (dialog) => PosAlertDialog(
        title: Text(element.label),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _stateLabel(entry.state, es),
                style: PosTheme.of(dialog).textTheme.titleMedium,
              ),
              const SizedBox(height: UmiSpacing.xs),
              Text(
                '${element.capacity} ${es ? 'lugares' : 'seats'}',
                style: PosTheme.of(dialog).textTheme.bodySmall,
              ),
              if (entry.partySize != null)
                Text(
                  l10n.tableStatePartySizeLabel(entry.partySize!),
                  style: PosTheme.of(dialog).textTheme.bodySmall,
                ),
              if (elapsed != null)
                Text(
                  l10n.tableStateElapsedLabel(formatTableTurn(elapsed)),
                  style: PosTheme.of(dialog).textTheme.bodySmall,
                ),
              if (groupSize > 1)
                Text(
                  l10n.tableStateGroupLabel(groupSize),
                  style: PosTheme.of(dialog).textTheme.bodySmall,
                ),
              const PosDivider(),
              ...actions.map(
                (action) =>
                    _action(dialog, action.label, action.icon, action.onTap),
              ),
            ],
          ),
        ),
        actions: [
          PosTextButton(
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
    PosGlyph icon,
    VoidCallback onTap,
  ) => PosListRow(
    leading: PosIcon(icon),
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
    this.partySize,
  });

  final String state;
  final String? turn;
  final String? groupId;
  final int? groupSize;
  final int? partySize;
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
    final theme = PosTheme.of(context);
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    return SizedBox(
      height: UmiTouchTarget.minimum,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: areas.length,
        separatorBuilder: (_, _) => const SizedBox(width: UmiSpacing.sm),
        itemBuilder: (context, index) =>
            _chip(context, theme, areas[index], spanish),
      ),
    );
  }

  Widget _chip(
    BuildContext context,
    PosThemeData theme,
    FloorPlanArea area,
    bool spanish,
  ) {
    final scheme = theme.colorScheme;
    final selected = area.id == selectedAreaId;
    final countLabel = floorPlanTableCountLabel(
      floorPlanTableCount(area),
      spanish: spanish,
    );
    final nameColor = selected ? PosColors.white : scheme.onSurface;
    final countColor = selected
        ? PosColors.white.withValues(alpha: .8)
        : scheme.onSurfaceVariant;
    // THE TAP REGION WRAPS THE SURFACE, NOT THE OTHER WAY AROUND. Inside it, the region is
    // inset by the surface's 1px border, so the control the engine publishes — and the one the
    // POS surface inventory measures — came out 42px tall inside a 44px chip. The chip looks
    // identical; what a finger lands on is now the whole 44px box.
    return PosTapRegion(
      selected: selected,
      semanticLabel: '${area.name}, $countLabel',
      onTap: () => onSelect(area.id),
      child: PosSurface(
        color: selected ? UmiTheme.brand : scheme.surfaceContainerHighest,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(UmiRadius.control),
          side: BorderSide(
            color: selected ? PosColors.transparent : scheme.outlineVariant,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: UmiSpacing.md,
            vertical: UmiSpacing.sm,
          ),
          child: Row(
            children: [
              Text(
                area.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleSmall?.copyWith(
                  color: nameColor,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(width: UmiSpacing.sm),
              Text(
                countLabel,
                maxLines: 1,
                style: theme.textTheme.labelSmall?.copyWith(color: countColor),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A small pill in the top bar: a count, or a standing of the room.
class _TopBarBadge extends StatelessWidget {
  const _TopBarBadge({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UmiSpacing.sm,
        vertical: UmiSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .16),
        borderRadius: BorderRadius.circular(UmiRadius.surface),
      ),
      child: Text(
        label,
        style: theme.textTheme.labelSmall?.copyWith(
          color: color,
          fontWeight: FontWeight.w600,
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
    this.controller,
  });
  final FloorPlanArea area;
  final ValueChanged<FloorPlanElement> onTableTap;

  /// The live state of each table, by table id. Null draws a map with no room
  /// state on it, which is what a surface without a table-state client shows.
  final Map<String, FloorPlanTableVisual>? tableStates;

  /// The transform the map shares with the surface's zoom controls. Null lets
  /// the map own it, which is what a caller with no zoom buttons wants.
  final TransformationController? controller;

  @override
  Widget build(BuildContext context) {
    final palette = _FloorPlanPalette.of(context);
    final elements = area.elements
        .map(FloorPlanElement.fromJson)
        .toList(growable: false);
    return LayoutBuilder(
      builder: (context, constraints) {
        var frame = Rect.fromLTWH(
          0,
          0,
          area.width.toDouble(),
          area.height.toDouble(),
        );
        // A short viewport frames the furniture instead of empty canvas margins.
        if (constraints.maxHeight < 320 && elements.isNotEmpty) {
          Rect? occupied;
          for (final element in elements) {
            final angle = element.rotation * math.pi / 180;
            final width =
                element.width * math.cos(angle).abs() +
                element.height * math.sin(angle).abs();
            final height =
                element.height * math.cos(angle).abs() +
                element.width * math.sin(angle).abs();
            final bounds = Rect.fromCenter(
              center: Offset(element.x.toDouble(), element.y.toDouble()),
              width: width,
              height: height,
            );
            occupied = occupied?.expandToInclude(bounds) ?? bounds;
          }
          frame = occupied!.inflate(24);
        }
        final fitScale = math.min(
          constraints.maxWidth / frame.width,
          constraints.maxHeight / frame.height,
        );
        var scale = fitScale;
        if (constraints.maxHeight < 320) {
          for (final element in elements.where(
            (element) => element.kind == 'table',
          )) {
            final side = math.min(element.width, element.height);
            if (side > 0) {
              // Reserve both 3-pixel borders outside the table's touch region.
              scale = math.max(scale, (UmiTouchTarget.minimum + 6) / side);
            }
          }
        }
        final canvasWidth = math.max(frame.width * scale, constraints.maxWidth);
        final leftInset = (canvasWidth - frame.width * scale) / 2;
        return Center(
          child: InteractiveViewer(
            constrained: false,
            alignment: Alignment.center,
            transformationController: controller,
            minScale: 1,
            maxScale: 4,
            child: SizedBox(
              width: canvasWidth,
              height: frame.height * scale,
              child: DecoratedBox(
                decoration: BoxDecoration(color: palette.canvas),
                child: Stack(
                  children: [
                    // The merged group's boundary goes under its tables: one
                    // party, one bounded region.
                    for (final region in _groupRegions(elements))
                      Positioned(
                        left:
                            (region.rect.left - frame.left) * scale + leftInset,
                        top: (region.rect.top - frame.top) * scale,
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
                        left:
                            (element.x - element.width / 2 - frame.left) *
                                scale +
                            leftInset,
                        top:
                            (element.y - element.height / 2 - frame.top) *
                            scale,
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
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    final stateLabel = _stateName(visual?.state ?? tableStateOpen, spanish);
    final label = [
      element.label,
      if (isTable) '${element.capacity} ${spanish ? 'lugares' : 'seats'}',
      if (isTable && visual != null) stateLabel,
      if (visual?.partySize != null)
        '${visual!.partySize} ${spanish ? 'personas' : 'guests'}',
      if (visual?.turn != null)
        '${spanish ? 'Tiempo' : 'Time'} ${visual!.turn}',
    ].join(', ');
    final content = LayoutBuilder(
      builder: (context, constraints) =>
          _content(constraints.maxWidth, constraints.maxHeight),
    );
    return PosSurface(
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
      surfaceTintColor: PosColors.transparent,
      child: isTable
          ? PosTapRegion(
              onTap: onTap,
              selected: visual?.selected,
              semanticLabel: label,
              child: content,
            )
          : Semantics(label: label, excludeSemantics: true, child: content),
    );
  }

  String _stateName(String state, bool spanish) => switch (state) {
    tableStateSeated => spanish ? 'Ocupada' : 'Seated',
    tableStateOrdered => spanish ? 'Pedido tomado' : 'Order taken',
    tableStateServed => spanish ? 'Servido' : 'Served',
    tableStateAwaitingPayment => spanish ? 'Por cobrar' : 'Awaiting payment',
    tableStateDirty => spanish ? 'Por limpiar' : 'Needs cleaning',
    _ => spanish ? 'Libre' : 'Open',
  };

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
      padding: EdgeInsets.symmetric(
        horizontal: width * (element.shape == 'round' ? .14 : .06),
      ),
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
    final seats = dirty
        ? FloorPlanClearedBand(
            key: ValueKey('floor-plan-cleared-${element.id}'),
            color: palette.stateAccent(tableStateDirty),
          )
        : element.capacity > 0
        ? FloorPlanSeatDots(
            key: ValueKey('floor-plan-seats-${element.id}'),
            count: element.capacity,
            color: present ? palette.stateAccent(visual!.state) : palette.seat,
            filled: present,
          )
        : const SizedBox.expand();
    if (!detailed) return Center(child: label);
    return Column(
      children: [
        Expanded(child: Center(child: label)),
        Container(
          key: ValueKey('floor-plan-divider-${element.id}'),
          height: 1,
          color: palette.divider,
        ),
        Expanded(
          child: visual != null && visual.state != tableStateOpen
              ? Padding(
                  padding: EdgeInsets.symmetric(horizontal: width * .15),
                  child: Row(
                    children: [
                      PosIcon(
                        tableStateGlyph(visual.state),
                        size: math.min(width, height) * .18,
                        color: palette.stateAccent(visual.state),
                      ),
                      Expanded(child: seats),
                    ],
                  ),
                )
              : seats,
        ),
      ],
    );
  }
}

/// The glyph that carries a state, so the state is never colour alone.
PosGlyph tableStateGlyph(String state) => switch (state) {
  tableStateSeated => PosGlyphs.eventSeat,
  tableStateOrdered => PosGlyphs.receiptLong,
  tableStateServed => PosGlyphs.restaurant,
  tableStateAwaitingPayment => PosGlyphs.paymentsOutlined,
  tableStateDirty => PosGlyphs.cleaningServices,
  _ => PosGlyphs.checkCircleOutline,
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
    final theme = PosTheme.of(context);
    final dark = theme.brightness == Brightness.dark;
    return _FloorPlanPalette(
      dark: dark,
      scheme: theme.colorScheme,
      canvas: dark ? const Color(0xff15161a) : const Color(0xffededf2),
      tableFill: dark ? const Color(0xff25272e) : PosColors.white,
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
  final PosPalette scheme;
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
        'label' => PosColors.transparent,
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
    'label' => PosColors.transparent,
    _ => scheme.outlineVariant,
  };

  Color labelFor(String kind) => switch (kind) {
    'wall' => PosColors.white,
    'label' => scheme.onSurfaceVariant,
    _ => label,
  };
}
