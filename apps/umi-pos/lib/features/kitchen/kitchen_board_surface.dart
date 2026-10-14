import 'dart:async';

import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/security/operator_permissions.dart';
import '../../core/theme/display_preferences.dart';
import '../../core/theme/umi_theme.dart';
import '../../shared/widgets/connectivity_label.dart';
import '../../shared/widgets/station_document.dart';
import '../entry/entry_controller.dart';
import '../offline/connectivity_controller.dart';
import 'kitchen_alerts.dart';
import 'kitchen_audio.dart';
import 'kitchen_board_controller.dart';
import 'kitchen_ticket_age.dart';
import 'kitchen_unassigned_surface.dart';

export 'kitchen_ticket_age.dart' show formatTicketAge;

/// Opens the unified KDS mode (PoloTab pattern): the same app, on a device that
/// runs the kitchen, shows the order board full-screen.
Future<void> showKitchenBoard(
  BuildContext context, {
  required KitchenBoardController controller,
  required EntryController entry,
  required ConnectivityController connectivity,
}) => Navigator.of(context).push(
  PosPageRoute<void>(
    fullscreenDialog: true,
    builder: (_) => KitchenBoardSurface(
      controller: controller,
      entry: entry,
      connectivity: connectivity,
    ),
  ),
);

/// The reasons a recalled ticket can carry. The server refuses a recall with no
/// reason on it (`invalid_kitchen_command`), and this is the short list a cook
/// can answer from a station without typing: the three causes that actually
/// bring food back, plus "other".
final List<({String code, String Function(AppLocalizations) label})>
kitchenRecallReasons = [
  (
    code: 'customer_returned',
    label: (l10n) => l10n.kitchenRecallReasonCustomerReturned,
  ),
  (code: 'wrong_item', label: (l10n) => l10n.kitchenRecallReasonWrongItem),
  (code: 'quality_issue', label: (l10n) => l10n.kitchenRecallReasonQuality),
  (code: 'other', label: (l10n) => l10n.kitchenRecallReasonOther),
];

final class KitchenBoardSurface extends StatefulWidget {
  const KitchenBoardSurface({
    required this.controller,
    required this.entry,
    required this.connectivity,
    this.embedded = false,
    this.clock = DateTime.now,
    super.key,
  });
  final KitchenBoardController controller;
  final EntryController entry;

  /// The till's own view of the network, shown when it is anything but online.
  final ConnectivityController connectivity;

  /// True when the board is the shell's own body instead of a pushed route.
  ///
  /// The board is a cook's home (plan §8.2 F1), so the shell places it inside
  /// its own PosPage under the tab bar. In that position there is nothing to
  /// "close" — the shell owns the exit — so the close control is dropped. A
  /// seller who opens the board from the till still gets the close control.
  final bool embedded;
  final DateTime Function() clock;

  @override
  State<KitchenBoardSurface> createState() => _KitchenBoardSurfaceState();
}

class _KitchenBoardSurfaceState extends State<KitchenBoardSurface> {
  Timer? _ticker;
  Timer? _alertTicker;
  final _alerts = KitchenAlertTracker();
  final _audio = KitchenAudio();
  bool _localMuted = false;
  String _dayFilter = 'today';
  bool get _muted => _preferences?.kitchenSoundsMuted ?? _localMuted;
  String? _stationFilter;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
    widget.entry.addListener(_changed);
    widget.connectivity.addListener(_changed);
    _load();
    // The kitchen board refreshes on its own so a cook never taps to see a new
    // ticket. That poll is now the FLOOR, not the delivery path: the controller
    // also holds a watch request open, and the server releases it the moment a
    // ticket moves (§8H step 8). Eight seconds is what a cook waits when the
    // wake-up is missed — a dropped connection, a notification lost while the
    // laptop slept, a ticket written straight into SQL — and milliseconds when
    // it is not.
    _ticker = Timer.periodic(const Duration(seconds: 8), (_) => _load());
    _alertTicker = Timer.periodic(
      const Duration(seconds: 1),
      (_) => _changed(),
    );
    unawaited(widget.controller.startWatching());
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _alertTicker?.cancel();
    _audio.dispose();
    widget.controller.stopWatching();
    widget.connectivity.removeListener(_changed);
    widget.controller.removeListener(_changed);
    widget.entry.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (!mounted) return;
    if (widget.controller.state.phase == KitchenBoardPhase.ready) {
      for (final sound in _alerts.observe(
        widget.controller.state.orders,
        widget.clock(),
        stationId: _screenStationId ?? _stationFilter,
        muted: _muted,
      )) {
        unawaited(_audio.play(sound));
      }
    }
    setState(() {});
  }

  Future<void> _toggleSounds() async {
    final next = !_muted;
    setState(() => _localMuted = next);
    if (next) await _audio.silence();
    await _preferences?.setKitchenSoundsMuted(next);
    if (mounted) setState(() {});
  }

  void _load() {
    final state = widget.entry.state;
    final merchant = state.selectedTenant?.id;
    final location = state.selectedBranch?.id;
    final operator = state.operator?.id;
    if (merchant == null || location == null || operator == null) return;
    unawaited(
      widget.controller.load(
        merchant,
        PosKitchenOrderQuery(locationId: location, operatorSessionId: operator),
      ),
    );
  }

  /// A recall needs a reason, so the board asks for one before it sends
  /// anything. Cancelling the dialog sends no command at all.
  Future<void> _recall(KitchenOrderProjection order) async {
    final reason = await showPosDialog<({String code, String? note})>(
      context: context,
      builder: (context) => _RecallDialog(order: order),
    );
    if (reason == null || !mounted) return;
    await widget.controller.recall(
      order,
      reasonCode: reason.code,
      reasonNote: reason.note,
    );
  }

  /// The station THIS SCREEN is, remembered on the device (see
  /// `DisplayPreferences.kitchenStationId`). A bar screen and a kitchen screen are
  /// different screens, not two tilings of one: the person in front of each works its
  /// assigned station without needing to choose it from a filter on every visit.
  String? _screenStationId;
  bool _screenStationRestored = false;
  DisplayPreferences? _preferences;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _preferences = DisplayPreferencesScope.maybeOf(context);
    if (_screenStationRestored) return;
    _screenStationRestored = true;
    final id = _preferences?.kitchenStationId;
    if (id != null && id.isNotEmpty) {
      _screenStationId = id;
      _screenStationName = _preferences?.kitchenStationName;
      _stationFilter = id;
    }
  }

  String? _screenStationName;

  void _selectStation(String? id, String? name) {
    setState(() {
      _stationFilter = id;
      _screenStationId = id;
      _screenStationName = name;
    });
    final preferences = _preferences;
    if (preferences != null) {
      unawaited(preferences.setKitchenStation(id: id, name: name));
    }
  }

  List<({String id, String name})> _stationsIn(
    List<KitchenOrderProjection> orders,
  ) {
    final seen = <String, String>{};
    for (final order in orders) {
      final name = order.stationName;
      if (name == null || name.isEmpty) continue;
      seen.putIfAbsent(order.stationId, () => name);
    }
    return [
      for (final entry in seen.entries) (id: entry.key, name: entry.value),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final state = widget.controller.state;
    final orders = state.orders;
    return PosPage(
      appBar: PosHeader(
        key: const ValueKey('kitchen-toolbar'),
        automaticallyImplyLeading: false,
        toolbarHeight: 56,
        titleSpacing: 12,
        title: StationHeading(title: l10n.kitchenBoardTitle),
        actions: [
          PosIconButton(
            onPressed: _toggleSounds,
            tooltip: _muted ? l10n.kitchenSoundsEnable : l10n.kitchenSoundsMute,
            icon: PosIcon(_muted ? PosGlyphs.volumeOff : PosGlyphs.volumeUp),
          ),
          // The connection, when it is not the one the board is built for.
          //
          // A board whose poll AND wake-up are both failing shows the last
          // tickets it saw, which looks exactly like a quiet service — and a cook
          // who cannot tell those apart keeps plating food nobody ordered. The
          // chip is the difference, and it is absent when the till is online
          // because a badge that always says so is noise on a rail.
          if (showsConnectivityWarning(widget.connectivity.state))
            Padding(
              padding: const EdgeInsets.only(right: UmiSpacing.sm),
              child: _Pill(
                label: connectivityLabel(context, widget.connectivity.state),
                color: widget.connectivity.state == PosConnectivity.offline
                    ? PosTheme.of(context).colorScheme.error
                    : PosTheme.of(context).colorScheme.outline,
              ),
            ),
          PosIconButton(
            tooltip: l10n.kitchenBoardRefresh,
            onPressed: _load,
            icon: const PosIcon(PosGlyphs.refresh),
          ),
          // Hidden when the board is the shell's home: there is no route to
          // close, and the tab bar owns the way out.
          if (!widget.embedded)
            PosIconButton(
              tooltip: l10n.closeAction,
              onPressed: () => Navigator.of(context).maybePop(),
              icon: const PosIcon(PosGlyphs.close),
            ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            if (_canReadKitchen)
              Align(
                alignment: Alignment.centerRight,
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: UmiSpacing.md,
                    vertical: UmiSpacing.xs,
                  ),
                  child: _unassignedButton(l10n),
                ),
              ),
            Expanded(child: _ticketRail(context, l10n, state, orders)),
          ],
        ),
      ),
    );
  }

  bool get _canReadKitchen => OperatorPermissions(
    widget.entry.state.operator?.permissions ?? const [],
  ).allows('kitchen.read');

  Widget _unassignedButton(AppLocalizations l10n) => PosTextButton(
    key: const ValueKey('open-unassigned-kitchen'),
    onPressed: () {
      unawaited(widget.controller.refresh());
      Navigator.of(context).push(
        PosPageRoute<void>(
          builder: (_) => KitchenUnassignedSurface(
            controller: widget.controller,
            entry: widget.entry,
          ),
        ),
      );
    },
    child: Text(
      '${l10n.localeName.startsWith('es') ? 'Sin estación' : 'Unassigned'} · ${widget.controller.unassignedLoaded ? widget.controller.unassignedOrders.length : '…'}',
    ),
  );

  /// The order rail is the only KDS view. Station and day controls only narrow it.
  Widget _ticketRail(
    BuildContext context,
    AppLocalizations l10n,
    KitchenBoardState state,
    List<KitchenOrderProjection> orders,
  ) {
    final stations = _stationsIn(orders);
    final known = <({String id, String name})>[
      for (final station in state.stations)
        (id: station.id, name: station.name),
      for (final station in stations)
        if (!state.stations.any((known) => known.id == station.id)) station,
    ];
    if (_stationFilter != null &&
        _stationFilter != _screenStationId &&
        !stations.any((station) => station.id == _stationFilter)) {
      _stationFilter = null;
    }
    final chipStations = [...known];
    if (_stationFilter != null &&
        !chipStations.any((station) => station.id == _stationFilter)) {
      chipStations.add((
        id: _stationFilter!,
        name: _screenStationName ?? l10n.kitchenStationAll,
      ));
    }
    final stationOrders = _stationFilter == null
        ? orders
        : orders.where((order) => order.stationId == _stationFilter).toList();
    final businessDate = state.businessDate;
    final previous = businessDate == null
        ? <KitchenOrderProjection>[]
        : stationOrders
              .where((order) => order.businessDate.compareTo(businessDate) < 0)
              .toList();
    final today = businessDate == null
        ? stationOrders
        : stationOrders
              .where((order) => order.businessDate == businessDate)
              .toList();
    final visible = switch (_dayFilter) {
      'previous' => previous,
      'all' => stationOrders,
      _ => today,
    };
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    return LayoutBuilder(
      builder: (context, railConstraints) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: railConstraints.maxHeight * .5,
            ),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    key: const ValueKey('kitchen-filters'),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 6,
                    ),
                    child: Wrap(
                      alignment: WrapAlignment.start,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 16,
                      runSpacing: 6,
                      children: [
                        if (chipStations.length > 1 || _stationFilter != null)
                          _stationChips(context, l10n, chipStations),
                        if (businessDate != null)
                          Wrap(
                            spacing: UmiSpacing.sm,
                            runSpacing: 6,
                            children: [
                              for (final choice in [
                                (
                                  id: 'today',
                                  label: spanish ? 'Hoy' : 'Today',
                                  count: today.length,
                                ),
                                (
                                  id: 'previous',
                                  label: spanish ? 'Anteriores' : 'Previous',
                                  count: previous.length,
                                ),
                                (
                                  id: 'all',
                                  label: spanish ? 'Todos' : 'All',
                                  count: stationOrders.length,
                                ),
                              ])
                                PosTooltip(
                                  message:
                                      choice.id == 'previous' &&
                                          previous.isNotEmpty
                                      ? (spanish
                                            ? '${previous.length} pendientes de jornadas anteriores. Revisa Anteriores.'
                                            : '${previous.length} pending from previous business days. Review Previous.')
                                      : choice.label,
                                  child: _StationChip(
                                    label: '${choice.label} (${choice.count})',
                                    widthLabel:
                                        '${choice.label} (${'8' * orders.length.toString().length})',
                                    icon: choice.id == 'previous'
                                        ? PosGlyphs.history
                                        : null,
                                    selected: _dayFilter == choice.id,
                                    onTap: () =>
                                        setState(() => _dayFilter = choice.id),
                                  ),
                                ),
                            ],
                          ),
                      ],
                    ),
                  ),
                  if (state.errorCode != null)
                    _failureBanner(context, l10n, state.errorCode!),
                ],
              ),
            ),
          ),
          Expanded(
            child: switch (state.phase) {
              KitchenBoardPhase.loading when orders.isEmpty => const Center(
                child: PosSpinner(),
              ),
              KitchenBoardPhase.failure when orders.isEmpty => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const PosIcon(PosGlyphs.cloudOffOutlined, size: 56),
                    const SizedBox(height: UmiSpacing.md),
                    Text(l10n.kitchenBoardLoadFailed),
                    const SizedBox(height: UmiSpacing.md),
                    PosButton(onPressed: _load, child: Text(l10n.retryAction)),
                  ],
                ),
              ),
              _ when visible.isEmpty => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    PosIcon(
                      PosGlyphs.restaurantMenuOutlined,
                      size: 56,
                      color: PosTheme.of(context).colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(height: UmiSpacing.md),
                    Text(
                      l10n.kitchenBoardEmpty,
                      style: PosTheme.of(context).textTheme.titleMedium,
                    ),
                  ],
                ),
              ),
              _ => LayoutBuilder(
                builder: (context, constraints) => SingleChildScrollView(
                  padding: const EdgeInsets.all(UmiSpacing.md),
                  child: Wrap(
                    spacing: UmiSpacing.md,
                    runSpacing: UmiSpacing.md,
                    children: [
                      for (final order in visible)
                        _TicketCard(
                          now: widget.clock(),
                          currentBusinessDate: businessDate,
                          permissions: OperatorPermissions(
                            widget.entry.state.operator?.permissions ??
                                const [],
                          ),
                          width:
                              (320 * MediaQuery.textScalerOf(context).scale(1))
                                  .clamp(
                                    0.0,
                                    (constraints.maxWidth - 2 * UmiSpacing.md)
                                        .clamp(0.0, double.infinity),
                                  )
                                  .toDouble(),
                          order: order,
                          l10n: l10n,
                          allDayFor: state.allDayFor,
                          busyTarget: state.busyTarget,
                          onItemTap: (itemId) =>
                              widget.controller.markItemReady(order, itemId),
                          onFire: (courseNumber) => widget.controller
                              .fireCourse(order, courseNumber: courseNumber),
                          onStart: () =>
                              widget.controller.startPreparation(order),
                          onComplete: () => widget.controller.complete(order),
                          onDiscard: () => widget.controller.discard(order),
                          onRecall: () => _recall(order),
                        ),
                    ],
                  ),
                ),
              ),
            },
          ),
        ],
      ),
    );
  }

  Widget _stationChips(
    BuildContext context,
    AppLocalizations l10n,
    List<({String id, String name})> stations,
  ) => Wrap(
    spacing: UmiSpacing.sm,
    runSpacing: UmiSpacing.sm,
    children: [
      _StationChip(
        label: l10n.kitchenStationAll,
        selected: _stationFilter == null,
        onTap: () => _selectStation(null, null),
      ),
      for (final station in stations)
        _StationChip(
          label: station.name,
          selected: _stationFilter == station.id,
          onTap: () => _selectStation(station.id, station.name),
        ),
    ],
  );

  Widget _failureBanner(
    BuildContext context,
    AppLocalizations l10n,
    String code,
  ) {
    final failure = describeKitchenBoardFailure(
      code,
      l10n,
      reference: widget.controller.state.errorReference,
    );
    return PosNoticeBanner(
      content: Text(
        '${failure.title}\n${failure.message}\n${failure.recovery}',
      ),
      actions: [
        PosTextButton(
          onPressed: () {
            widget.controller.dismissError();
            _load();
          },
          child: Text(l10n.kitchenFailureRefresh),
        ),
        PosTextButton(
          onPressed: widget.controller.dismissError,
          child: Text(l10n.closeAction),
        ),
      ],
    );
  }
}

/// A refusal the cook can read: what did not happen, why, and what to do next.
final class KitchenBoardFailure {
  const KitchenBoardFailure({
    required this.title,
    required this.message,
    required this.recovery,
  });

  final String title;
  final String message;
  final String recovery;
}

KitchenBoardFailure describeKitchenBoardFailure(
  String code,
  AppLocalizations l10n, {
  String? reference,
}) => switch (code) {
  // The ticket moved between the read and the bump. The board has already been
  // re-read by the time this is shown, so the recovery is "look again", never
  // "tap again" — the same tap would be a second bump.
  'OPTIMISTIC_VERSION_CONFLICT' ||
  'KITCHEN_VERSION_CONFLICT' => KitchenBoardFailure(
    title: l10n.kitchenFailureTitle,
    message: _namesTicket(reference)
        ? l10n.kitchenFailureVersionConflictMessage(reference!)
        : l10n.kitchenFailureVersionConflictGenericMessage,
    recovery: l10n.kitchenFailureVersionConflictRecovery,
  ),
  'KITCHEN_FINGERPRINT_CONFLICT' ||
  'IDEMPOTENCY_CONFLICT' => KitchenBoardFailure(
    title: l10n.kitchenFailureTitle,
    message: l10n.kitchenFailureFingerprintMessage(reference ?? ''),
    recovery: l10n.kitchenFailureFingerprintRecovery,
  ),
  // The server's own state machine refused the move: a ready ticket cannot go
  // back to preparation without a recall, for instance.
  'KITCHEN_INVALID_TRANSITION' => KitchenBoardFailure(
    title: l10n.kitchenFailureTitle,
    message: l10n.kitchenFailureInvalidTransitionMessage,
    recovery: l10n.kitchenFailureInvalidTransitionRecovery,
  ),
  'PERMISSION_DENIED' ||
  'KITCHEN_PERMISSION_DENIED' ||
  'KITCHEN_PERMISSION_REQUIRED' => KitchenBoardFailure(
    title: l10n.kitchenFailureTitle,
    message: l10n.kitchenFailurePermissionDeniedMessage,
    recovery: l10n.kitchenFailurePermissionDeniedRecovery,
  ),
  // The command route answers `ticket_not_found` for both a ticket that left
  // the board and a ticket outside this device's station scope, so the message
  // says what the cook can see happen and names the escalation that fixes the
  // second cause.
  'TICKET_NOT_FOUND' || 'RESOURCE_NOT_FOUND' => KitchenBoardFailure(
    title: l10n.kitchenFailureTitle,
    message: _namesTicket(reference)
        ? l10n.kitchenFailureTicketMissingMessage(reference!)
        : l10n.kitchenFailureTicketMissingGenericMessage,
    recovery: l10n.kitchenFailureTicketMissingRecovery,
  ),
  'DEVICE_REVOKED' || 'AUTHENTICATION_REQUIRED' => KitchenBoardFailure(
    title: l10n.kitchenFailureTitle,
    message: l10n.kitchenFailureDeviceMessage,
    recovery: l10n.kitchenFailureDeviceRecovery,
  ),
  _ => KitchenBoardFailure(
    title: l10n.kitchenFailureTitle,
    message: l10n.kitchenFailureGenericMessage,
    recovery: l10n.kitchenFailureGenericRecovery,
  ),
};

/// A failure message names the ticket when the board can name it. A ticket
/// reference the operator cannot see on a card would be worse than no name.
bool _namesTicket(String? reference) =>
    reference != null && reference.trim().isNotEmpty;

final class _StationChip extends StatelessWidget {
  const _StationChip({
    required this.label,
    required this.selected,
    required this.onTap,
    this.icon,
    this.widthLabel,
  });
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final PosGlyph? icon;
  final String? widthLabel;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final style = theme.textTheme.labelLarge?.copyWith(
      color: selected
          ? theme.colorScheme.primary
          : theme.colorScheme.onSurfaceVariant,
    );
    double? labelWidth;
    if (widthLabel != null) {
      final painter = TextPainter(
        text: TextSpan(text: widthLabel, style: style),
        textDirection: Directionality.of(context),
        textScaler: MediaQuery.textScalerOf(context),
        maxLines: 1,
      )..layout();
      labelWidth = painter.width.ceilToDouble();
      painter.dispose();
    }
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: PosTapRegion(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: UmiTouchTarget.minimum),
          padding: const EdgeInsets.symmetric(
            horizontal: UmiSpacing.md,
            vertical: UmiSpacing.sm,
          ),
          decoration: BoxDecoration(
            color: selected
                ? theme.colorScheme.primaryContainer
                : const Color(0x00000000),
            border: Border.all(
              color: selected
                  ? theme.colorScheme.primary
                  : theme.colorScheme.outlineVariant,
            ),
            borderRadius: BorderRadius.circular(UmiRadius.control),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                PosIcon(icon!, size: 18),
                const SizedBox(width: 6),
              ],
              Flexible(
                child: SizedBox(
                  width: labelWidth,
                  child: Text(label, style: style),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

final class _TicketCard extends StatelessWidget {
  const _TicketCard({
    required this.now,
    required this.currentBusinessDate,
    required this.width,
    required this.permissions,
    required this.order,
    required this.l10n,
    required this.allDayFor,
    required this.busyTarget,
    required this.onItemTap,
    required this.onFire,
    required this.onStart,
    required this.onComplete,
    required this.onDiscard,
    required this.onRecall,
  });

  final double width;
  final DateTime now;
  final String? currentBusinessDate;
  final OperatorPermissions permissions;
  final KitchenOrderProjection order;
  final AppLocalizations l10n;

  /// Today's count for a line, or null when the count is not available.
  final KitchenAllDayItem? Function(KitchenOrderItem item) allDayFor;
  final String? busyTarget;
  final ValueChanged<String> onItemTap;

  /// Fires one whole course. The course number is the one the board read as
  /// held, so the tap can only ever ask for work the server still has waiting.
  final ValueChanged<int> onFire;
  final VoidCallback onStart;
  final VoidCallback onComplete;
  final VoidCallback onDiscard;
  final VoidCallback onRecall;

  /// A line can be bumped while the station still owes it AND the kitchen has
  /// been told to start its course. A HELD line is not slower work — it is not
  /// work yet, and a tap on it would start the dessert with the starters, which
  /// is the whole thing courses exist to prevent. A line already marked done, or
  /// pulled, is not tappable either: the tap would be a no-op the cook could not
  /// tell apart from a silent failure.
  static bool bumpable(KitchenOrderItem item) =>
      item.fired && (item.status == 'queued' || item.status == 'preparing');

  ({Color color, String label}) _statusStyle(PosPalette scheme) =>
      kitchenOrderOverdue(order, now)
      ? (color: scheme.error, label: l10n.kitchenTimeOverdue)
      : switch (kitchenStationStatus(order)) {
          'ready' => (
            color: const Color(0xFF3cb44b),
            label: l10n.kitchenStatusReady,
          ),
          'partially_ready' => (
            color: const Color(0xFF2E7DFF),
            label: l10n.kitchenStatusPartiallyReady,
          ),
          'in_preparation' => (
            color: const Color(0xFF2E7DFF),
            label: l10n.kitchenStatusInPreparation,
          ),
          'exception' => (
            color: scheme.error,
            label: l10n.kitchenStatusException,
          ),
          'cancelled' => (
            color: scheme.error,
            label: l10n.kitchenStatusCancelled,
          ),
          _ => (color: scheme.outline, label: l10n.kitchenStatusQueued),
        };

  String _elapsed() {
    final queued = DateTime.tryParse(order.queuedAt);
    if (queued == null) return '';
    return formatTicketAge(
      now.toUtc().difference(queued.toUtc()),
      now: l10n.kitchenElapsedNow,
      minutes: l10n.kitchenElapsedMinutes,
      hoursMinutes: l10n.kitchenElapsedHoursMinutes,
      daysHours: l10n.kitchenElapsedDaysHours,
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = PosTheme.of(context).colorScheme;
    final status = _statusStyle(scheme);
    final urgent = order.priority == 'urgent';
    final high = order.priority == 'high';
    final accent = urgent
        ? scheme.error
        : high
        ? const Color(0xFFf58231)
        : status.color;
    // The groups, not a flat line list: the course is what the kitchen stages
    // by, and a held course has to be readable as one block rather than as
    // lines scattered among the work (§8H step 4).
    final groups = groupCourses(order);
    final nextCourse = nextHeldCourse(order);
    return SizedBox(
      width: width,
      child: PosSurface(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(14),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(height: 4, color: accent),
            Padding(
              padding: const EdgeInsets.all(UmiSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          currentBusinessDate != null &&
                                  order.businessDate != currentBusinessDate
                              ? '${order.publicReference} · ${order.businessDate}'
                              : order.publicReference,
                          style: PosTheme.of(context).textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                      ),
                      Text(
                        _elapsed(),
                        style: PosTheme.of(context).textTheme.bodySmall
                            ?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: UmiSpacing.sm,
                    runSpacing: UmiSpacing.xs,
                    children: [
                      // Which station owes this ticket. A till is handed one card per
                      // station for the same cuenta, so without the name two cards are
                      // the same card; a station device has one, where the label is a
                      // caption rather than the only way to tell them apart.
                      if ((order.stationName ?? '').isNotEmpty)
                        _Pill(color: scheme.primary, label: order.stationName!),
                      _Pill(color: status.color, label: status.label),
                      if (urgent || high) ...[
                        _Pill(
                          color: accent,
                          label: urgent
                              ? l10n.kitchenPriorityUrgent
                              : l10n.kitchenPriorityHigh,
                        ),
                      ],
                    ],
                  ),
                  const PosDivider(height: UmiSpacing.lg),
                  if (kitchenStationStatus(order) != order.status)
                    Text(
                      '${l10n.localeName.startsWith('es') ? 'Pedido completo' : 'Whole order'}: ${switch (order.status) {
                        'partially_ready' => l10n.kitchenStatusPartiallyReady,
                        'in_preparation' => l10n.kitchenStatusInPreparation,
                        'ready' => l10n.kitchenStatusReady,
                        'exception' => l10n.kitchenStatusException,
                        'cancelled' => l10n.kitchenStatusCancelled,
                        _ => l10n.kitchenStatusQueued,
                      }}',
                      style: PosTheme.of(context).textTheme.bodySmall,
                    ),
                  for (var index = 0; index < groups.length; index++) ...[
                    if (index > 0) const SizedBox(height: UmiSpacing.sm),
                    _CourseBlock(
                      canMarkReady:
                          order.status != 'cancelled' &&
                          permissions.allows('kitchen.ready'),
                      group: groups[index],
                      l10n: l10n,
                      allDayFor: allDayFor,
                      busyTarget: busyTarget,
                      onItemTap: onItemTap,
                    ),
                  ],
                  // One action, and only when there is a course left to start:
                  // an ordinary ticket arrives already fired through course 1,
                  // so this line is absent from every single-course sale.
                  if (order.status != 'cancelled' &&
                      nextCourse != null &&
                      permissions.allows('kitchen.prepare')) ...[
                    const SizedBox(height: UmiSpacing.md),
                    _FireCourseAction(
                      courseNumber: nextCourse,
                      l10n: l10n,
                      busy:
                          busyTarget ==
                          KitchenBoardController.fireTarget(nextCourse),
                      // The route takes one command at a time. While any other
                      // command is in flight this one says so with its face
                      // rather than swallowing the tap.
                      enabled: busyTarget == null,
                      onFire: () => onFire(nextCourse),
                    ),
                  ],
                  const SizedBox(height: UmiSpacing.sm),
                  _TicketActions(
                    permissions: permissions,
                    order: order,
                    l10n: l10n,
                    busy: busyTarget == order.id,
                    onStart: onStart,
                    onComplete: onComplete,
                    onDiscard: onDiscard,
                    onRecall: onRecall,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One course of a ticket, named, with its held lines drawn as a single block
/// that is visibly not work (§8H step 4).
///
/// Fired lines render first and normally; whatever is still held renders under
/// them inside [_HeldCourseBlock]. A course that is entirely held therefore
/// renders as a held block and nothing else, which is exactly the reading the
/// cook needs: this round has been ordered, and it has not been called yet.
final class _CourseBlock extends StatelessWidget {
  const _CourseBlock({
    required this.group,
    required this.canMarkReady,
    required this.l10n,
    required this.allDayFor,
    required this.busyTarget,
    required this.onItemTap,
  });

  final KitchenCourseGroup group;
  final bool canMarkReady;
  final AppLocalizations l10n;
  final KitchenAllDayItem? Function(KitchenOrderItem item) allDayFor;
  final String? busyTarget;
  final ValueChanged<String> onItemTap;

  @override
  Widget build(BuildContext context) {
    final scheme = PosTheme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.kitchenCourseGroup(group.courseNumber),
          style: PosTheme.of(context).textTheme.labelLarge?.copyWith(
            color: scheme.onSurfaceVariant,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: UmiSpacing.xs),
        for (final item in group.fired)
          _ItemRow(
            canMarkReady: canMarkReady,
            item: item,
            l10n: l10n,
            allDay: allDayFor(item),
            busy: busyTarget == item.id,
            onTap: () => onItemTap(item.id),
          ),
        if (group.held.isNotEmpty)
          _HeldCourseBlock(
            group: group,
            l10n: l10n,
            allDayFor: allDayFor,
            busyTarget: busyTarget,
          ),
      ],
    );
  }
}

/// The lines of a course the kitchen has not been told to start.
///
/// This is deliberately not a dimmed [KitchenOrderItem] list: it is its own
/// framed block, it carries the count, and it says in words that it is not being
/// cooked. A cook who cannot see the difference between "queued" and "for later"
/// starts the dessert with the starters, which is the failure this whole step
/// exists to remove. The lines inside are not tappable — there is nothing to
/// bump in a course that has not been called.
final class _HeldCourseBlock extends StatelessWidget {
  const _HeldCourseBlock({
    required this.group,
    required this.l10n,
    required this.allDayFor,
    required this.busyTarget,
  });

  final KitchenCourseGroup group;
  final AppLocalizations l10n;
  final KitchenAllDayItem? Function(KitchenOrderItem item) allDayFor;
  final String? busyTarget;

  @override
  Widget build(BuildContext context) {
    final scheme = PosTheme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(top: UmiSpacing.xs),
      padding: const EdgeInsets.symmetric(
        horizontal: UmiSpacing.sm,
        vertical: UmiSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              PosIcon(
                PosGlyphs.schedule,
                size: 16,
                color: scheme.onSurfaceVariant,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  l10n.kitchenCourseHeld(group.heldQuantity),
                  style: PosTheme.of(context).textTheme.labelMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: UmiSpacing.xs),
          Text(
            l10n.kitchenCourseHeldNote,
            style: PosTheme.of(
              context,
            ).textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
          for (final item in group.held)
            _ItemRow(
              item: item,
              l10n: l10n,
              allDay: allDayFor(item),
              busy: busyTarget == item.id,
              held: true,
              onTap: () {},
            ),
        ],
      ),
    );
  }
}

/// The single action that starts the next held course.
///
/// One button per ticket, naming the course it will call, because the board's
/// own read is the only thing that decides which course is next: the watermark
/// moves forward by one course at a time and the server refuses anything else.
final class _FireCourseAction extends StatelessWidget {
  const _FireCourseAction({
    required this.courseNumber,
    required this.l10n,
    required this.busy,
    required this.enabled,
    required this.onFire,
  });

  static const Key buttonKey = Key('kitchen-fire-course');

  final int courseNumber;
  final AppLocalizations l10n;
  final bool busy;
  final bool enabled;
  final VoidCallback onFire;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: double.infinity,
    child: PosButton.icon(
      key: buttonKey,
      onPressed: enabled && !busy ? onFire : null,
      icon: busy
          ? const SizedBox(
              width: 16,
              height: 16,
              child: PosSpinner(strokeWidth: 2),
            )
          : const PosIcon(PosGlyphs.localFireDepartment, size: 18),
      label: Text(
        l10n.kitchenCourseFire(courseNumber),
        overflow: TextOverflow.ellipsis,
      ),
      style: PosButton.styleFrom(
        minimumSize: const Size(0, UmiTouchTarget.minimum),
      ),
    ),
  );
}

/// One line of a ticket. The whole row is the target — a cook taps the dish,
/// not a 16 px glyph — and the semantics tree says what the tap will do.
final class _ItemRow extends StatelessWidget {
  const _ItemRow({
    required this.item,
    required this.l10n,
    required this.allDay,
    required this.busy,
    required this.onTap,
    this.held = false,
    this.canMarkReady = false,
  });

  final KitchenOrderItem item;
  final AppLocalizations l10n;

  /// How many of this dish the kitchen has been asked for today (§8H step 6).
  /// Null when the count is not available, and nothing is rendered then: a `×0`
  /// would be a claim about the day that the till cannot make.
  final KitchenAllDayItem? allDay;

  final bool busy;

  /// The line belongs to a course the kitchen has not been told to start. The
  /// row says so in its own mark and in what a screen reader hears, and it is
  /// never tappable however the ticket's own status reads.
  final bool held;
  final bool canMarkReady;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = PosTheme.of(context).colorScheme;
    final voided = item.status == 'cancelled';
    final missingRoute = item.status == 'exception';
    final ready = item.status == 'ready';
    final bumpable = canMarkReady && !held && _TicketCard.bumpable(item);
    // §8.5: the labels come from the payload, never from a code table here. A
    // label the till does not know is still a label the cook must read.
    final allergenLabels = item.allergens
        .map((allergen) => allergen['label'])
        .whereType<String>()
        .where((label) => label.trim().isNotEmpty)
        .toList(growable: false);
    return Semantics(
      button: bumpable,
      label: held
          ? l10n.kitchenItemHeld(item.productName)
          : bumpable
          ? l10n.kitchenItemMarkReady(item.productName)
          : ready
          ? l10n.kitchenItemAlreadyReady(item.productName)
          : item.productName,
      child: PosTapRegion(
        onTap: bumpable ? onTap : null,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
          child: Opacity(
            // Held is quieter than work but not hidden: the cook still has to be
            // able to read the whole order off the ticket.
            opacity: voided ? 0.55 : (held ? 0.75 : 1),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${item.quantity}×',
                  style: PosTheme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    decoration: voided ? TextDecoration.lineThrough : null,
                  ),
                ),
                const SizedBox(width: UmiSpacing.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.productName,
                        style: PosTheme.of(context).textTheme.bodyLarge
                            ?.copyWith(
                              decoration: voided
                                  ? TextDecoration.lineThrough
                                  : null,
                              color: voided ? scheme.onSurfaceVariant : null,
                            ),
                      ),
                      if (ready || voided || missingRoute || allDay != null)
                        Padding(
                          padding: const EdgeInsets.only(top: UmiSpacing.xs),
                          child: Wrap(
                            spacing: UmiSpacing.sm,
                            runSpacing: UmiSpacing.xs,
                            children: [
                              if (missingRoute)
                                Text(
                                  l10n.kitchenItemRouteMissing,
                                  style: TextStyle(color: scheme.error),
                                ),
                              if (ready) ...[
                                Text(
                                  l10n.kitchenStatusReady,
                                  style: PosTheme.of(context)
                                      .textTheme
                                      .labelSmall
                                      ?.copyWith(
                                        color: const Color(0xFF3cb44b),
                                        fontWeight: FontWeight.w700,
                                      ),
                                ),
                              ],
                              if (voided) ...[
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 6,
                                    vertical: 1,
                                  ),
                                  decoration: BoxDecoration(
                                    color: scheme.error.withValues(alpha: .16),
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Text(
                                    l10n.kitchenItemVoided,
                                    style: PosTheme.of(context)
                                        .textTheme
                                        .labelSmall
                                        ?.copyWith(
                                          color: scheme.error,
                                          fontWeight: FontWeight.w700,
                                          letterSpacing: 0.5,
                                        ),
                                  ),
                                ),
                              ],
                              // The all-day count (§8H step 6): how many of this dish
                              // the kitchen has been asked for today, which is the
                              // number a cook reads first and the one a ticket cannot
                              // answer — a ticket is one order. A cancelled line shows
                              // no count, because it is not being cooked.
                              if (allDay != null && !voided) ...[
                                PosTooltip(
                                  message: l10n.kitchenAllDayTooltip(
                                    allDay!.ordered,
                                    allDay!.outstanding,
                                  ),
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 6,
                                      vertical: 1,
                                    ),
                                    decoration: BoxDecoration(
                                      color: scheme.surfaceContainerHighest,
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: Text(
                                      l10n.kitchenAllDayCount(allDay!.ordered),
                                      style: PosTheme.of(context)
                                          .textTheme
                                          .labelSmall
                                          ?.copyWith(
                                            color: scheme.onSurfaceVariant,
                                            fontWeight: FontWeight.w700,
                                          ),
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      // The allergens sit under the name on their own wrapped
                      // row. A long label truncates inside its own badge, so it
                      // cannot cover the quantity or the course below.
                      if (allergenLabels.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: UmiSpacing.xs),
                          child: Wrap(
                            spacing: UmiSpacing.xs,
                            runSpacing: 2,
                            children: [
                              for (final label in allergenLabels)
                                KitchenAllergenBadge(label: label),
                            ],
                          ),
                        ),
                      if (item.variantName != null || item.modifiers.isNotEmpty)
                        Text(
                          [
                            if (item.variantName != null) item.variantName!,
                            ...item.modifiers,
                          ].join(' · '),
                          style: PosTheme.of(context).textTheme.bodySmall
                              ?.copyWith(
                                color: scheme.onSurfaceVariant,
                                decoration: voided
                                    ? TextDecoration.lineThrough
                                    : null,
                              ),
                        ),
                      if (item.preparationNote != null)
                        Text(
                          item.preparationNote!,
                          style: PosTheme.of(context).textTheme.bodySmall
                              ?.copyWith(
                                color: scheme.error,
                                fontStyle: FontStyle.italic,
                              ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: UmiSpacing.sm),
                if (busy)
                  const SizedBox(
                    width: 20,
                    height: 20,
                    child: PosSpinner(strokeWidth: 2),
                  )
                else if (ready)
                  const PosIcon(
                    PosGlyphs.checkBox,
                    size: 22,
                    color: Color(0xFF3cb44b),
                  )
                else if (voided)
                  PosIcon(PosGlyphs.block, size: 22, color: scheme.error)
                else if (held)
                  PosIcon(
                    PosGlyphs.schedule,
                    size: 22,
                    color: scheme.onSurfaceVariant,
                  )
                else
                  PosIcon(
                    PosGlyphs.checkBoxOutlineBlank,
                    size: 22,
                    color: scheme.onSurfaceVariant,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// One allergen label a ticket line carries (§8.5).
///
/// The badge uses the board's own chip idiom: a small rounded container at the
/// label type scale. The label is drawn exactly as the payload sent it, and the
/// text is clipped rather than allowed to grow into the next line.
final class KitchenAllergenBadge extends StatelessWidget {
  const KitchenAllergenBadge({required this.label, super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    final scheme = PosTheme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: scheme.tertiaryContainer,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: scheme.tertiary),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: PosTheme.of(context).textTheme.labelMedium?.copyWith(
          color: scheme.onTertiaryContainer,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

/// The moves that belong to the ticket as a whole. Each is offered only where
/// the server's state machine allows it: a queued ticket can start, a ready one
/// can be recalled or completed, and `completed` is terminal for this route.
final class _TicketActions extends StatelessWidget {
  const _TicketActions({
    required this.order,
    required this.permissions,
    required this.l10n,
    required this.busy,
    required this.onStart,
    required this.onComplete,
    required this.onDiscard,
    required this.onRecall,
  });

  final KitchenOrderProjection order;
  final OperatorPermissions permissions;
  final AppLocalizations l10n;
  final bool busy;
  final VoidCallback onStart;
  final VoidCallback onComplete;
  final VoidCallback onDiscard;
  final VoidCallback onRecall;

  @override
  Widget build(BuildContext context) {
    if (busy) {
      return Row(
        children: [
          const SizedBox(
            width: 16,
            height: 16,
            child: PosSpinner(strokeWidth: 2),
          ),
          const SizedBox(width: UmiSpacing.sm),
          Text(
            l10n.kitchenTicketSending,
            style: PosTheme.of(context).textTheme.bodySmall,
          ),
        ],
      );
    }
    if (order.status == 'cancelled') {
      if (!permissions.allows('kitchen.cancel_ack')) {
        return const SizedBox.shrink();
      }
      return PosButton.icon(
        onPressed: onDiscard,
        icon: const PosIcon(PosGlyphs.close, size: 18),
        label: Text(l10n.kitchenTicketDiscardAction),
      );
    }
    final actions = <Widget>[
      if (order.items
              .map(KitchenOrderItem.fromJson)
              .any((item) => item.fired && item.status == 'queued') &&
          permissions.allows('kitchen.prepare'))
        PosButton.tonalIcon(
          onPressed: onStart,
          icon: const PosIcon(PosGlyphs.playArrow, size: 18),
          label: Text(l10n.kitchenTicketStartAction),
        ),
      if (kitchenStationStatus(order) == 'ready' &&
          permissions.allows('kitchen.recall'))
        PosButton.tonalIcon(
          onPressed: onRecall,
          icon: const PosIcon(PosGlyphs.undo, size: 18),
          label: Text(l10n.kitchenTicketRecallAction),
        ),
      if (kitchenStationStatus(order) == 'ready' &&
          permissions.allows('kitchen.complete'))
        PosButton.icon(
          onPressed: onComplete,
          icon: const PosIcon(PosGlyphs.check, size: 18),
          label: Text(l10n.kitchenTicketCompleteAction),
        ),
    ];
    if (actions.isEmpty) return const SizedBox.shrink();
    return Wrap(
      spacing: UmiSpacing.sm,
      runSpacing: UmiSpacing.sm,
      children: actions,
    );
  }
}

/// Asks why a finished ticket is coming back. A reason is required by the
/// server, so the confirm button stays disabled until one is chosen.
final class _RecallDialog extends StatefulWidget {
  const _RecallDialog({required this.order});
  final KitchenOrderProjection order;

  @override
  State<_RecallDialog> createState() => _RecallDialogState();
}

class _RecallDialogState extends State<_RecallDialog> {
  String? _code;
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return PosAlertDialog(
      title: Text(l10n.kitchenRecallTitle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l10n.kitchenRecallBody),
          const SizedBox(height: UmiSpacing.sm),
          for (final reason in kitchenRecallReasons)
            PosRadioRow<String>(
              value: reason.code,
              // ignore: deprecated_member_use
              groupValue: _code,
              // ignore: deprecated_member_use
              onChanged: (value) => setState(() => _code = value),
              title: Text(reason.label(l10n)),
              contentPadding: EdgeInsets.zero,
              dense: true,
            ),
          PosField(
            controller: _note,
            maxLength: 500,
            decoration: PosFieldDecoration(
              labelText: l10n.kitchenRecallNoteLabel,
            ),
          ),
        ],
      ),
      actions: [
        PosTextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.kitchenRecallCancel),
        ),
        PosButton(
          key: const Key('kitchen-recall-confirm'),
          onPressed: _code == null
              ? null
              : () {
                  final note = _note.text.trim();
                  Navigator.of(
                    context,
                  ).pop((code: _code!, note: note.isEmpty ? null : note));
                },
          child: Text(l10n.kitchenTicketRecallAction),
        ),
      ],
    );
  }
}

final class _Pill extends StatelessWidget {
  const _Pill({required this.color, required this.label});
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.sm, vertical: 3),
    decoration: BoxDecoration(
      color: color.withValues(alpha: .18),
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: color),
    ),
    child: Text(
      label,
      style: PosTheme.of(context).textTheme.labelMedium?.copyWith(
        color: color,
        fontWeight: FontWeight.w600,
      ),
    ),
  );
}
