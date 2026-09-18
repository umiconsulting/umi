import 'dart:async';

import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import '../../shared/widgets/connectivity_label.dart';
import '../entry/entry_controller.dart';
import '../offline/connectivity_controller.dart';
import 'kitchen_board_controller.dart';
import 'prep_list_controller.dart';
import 'prep_list_model.dart';

/// Opens the unified KDS mode (PoloTab pattern): the same app, on a device that
/// runs the kitchen, shows the order board full-screen.
Future<void> showKitchenBoard(
  BuildContext context, {
  required KitchenBoardController controller,
  required EntryController entry,
  required ConnectivityController connectivity,
}) => Navigator.of(context).push(
  MaterialPageRoute<void>(
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
    super.key,
  });
  final KitchenBoardController controller;
  final EntryController entry;

  /// The till's own view of the network, shown when it is anything but online.
  final ConnectivityController connectivity;

  @override
  State<KitchenBoardSurface> createState() => _KitchenBoardSurfaceState();
}

class _KitchenBoardSurfaceState extends State<KitchenBoardSurface>
    with SingleTickerProviderStateMixin {
  Timer? _ticker;

  /// The two views of one kitchen: the tickets to work, and what to make.
  /// The ticket rail stays the default view.
  late final TabController _tabs;

  /// The prep list has its own state, so its refusal never touches the rail.
  late final PrepListController _prepList;

  @override
  void initState() {
    super.initState();
    _prepList = PrepListController(widget.controller.repository);
    _prepList.addListener(_changed);
    _tabs = TabController(length: 2, vsync: this)..addListener(_tabChanged);
    widget.controller.addListener(_changed);
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
    unawaited(widget.controller.startWatching());
  }

  @override
  void dispose() {
    _ticker?.cancel();
    widget.controller.stopWatching();
    _tabs.dispose();
    _prepList.removeListener(_changed);
    _prepList.dispose();
    widget.connectivity.removeListener(_changed);
    widget.controller.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  /// The prep list is read when its tab opens, not on the board's poll.
  void _tabChanged() {
    if (_tabs.index == 1) _loadPrepList(once: true);
  }

  /// Read the prep list with the till's own merchant and location.
  ///
  /// [once] leaves an already loaded list alone, which is what opening the tab
  /// does. The refresh control calls again with `once: false`.
  void _loadPrepList({required bool once}) {
    final state = widget.entry.state;
    final merchant = state.selectedTenant?.id;
    final location = state.selectedBranch?.id;
    final operatorSessionId = state.operator?.id;
    if (merchant == null || location == null || operatorSessionId == null) return;
    if (once && _prepList.state.phase != PrepListPhase.idle) return;
    unawaited(
      _prepList.load(merchant, locationId: location, operatorSessionId: operatorSessionId),
    );
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
    final reason = await showDialog<({String code, String? note})>(
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

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final state = widget.controller.state;
    final orders = state.orders;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.kitchenBoardTitle),
        bottom: TabBar(
          controller: _tabs,
          tabs: [
            Tab(text: l10n.kitchenBoardTabTickets),
            Tab(text: l10n.kitchenPrepTab),
          ],
        ),
        actions: [
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
                    ? Theme.of(context).colorScheme.error
                    : Theme.of(context).colorScheme.outline,
              ),
            ),
          IconButton(
            tooltip: l10n.kitchenBoardRefresh,
            // The refresh control follows the visible tab, so a cook on the
            // prep list never reads a stale list after a tap on the icon.
            onPressed: () {
              if (_tabs.index == 1) {
                _loadPrepList(once: false);
              } else {
                _load();
              }
            },
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: l10n.closeAction,
            onPressed: () => Navigator.of(context).maybePop(),
            icon: const Icon(Icons.close),
          ),
        ],
      ),
      body: SafeArea(
        child: TabBarView(
          controller: _tabs,
          children: [
            _ticketRail(context, l10n, state, orders),
            _PrepListTab(
              controller: _prepList,
              l10n: l10n,
              onRefresh: () => _loadPrepList(once: false),
            ),
          ],
        ),
      ),
    );
  }

  /// The ticket rail, exactly as it was before the prep list joined the board.
  Widget _ticketRail(
    BuildContext context,
    AppLocalizations l10n,
    KitchenBoardState state,
    List<KitchenOrderProjection> orders,
  ) => Column(
    children: [
      if (state.errorCode != null)
        _failureBanner(context, l10n, state.errorCode!),
      Expanded(
        child: switch (state.phase) {
          KitchenBoardPhase.loading when orders.isEmpty => const Center(
            child: CircularProgressIndicator(),
          ),
          KitchenBoardPhase.failure when orders.isEmpty => Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.cloud_off_outlined, size: 56),
                const SizedBox(height: UmiSpacing.md),
                Text(l10n.kitchenBoardLoadFailed),
                const SizedBox(height: UmiSpacing.md),
                FilledButton(
                  onPressed: _load,
                  child: Text(l10n.retryAction),
                ),
              ],
            ),
          ),
          _ when orders.isEmpty => Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.restaurant_menu_outlined,
                  size: 56,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                const SizedBox(height: UmiSpacing.md),
                Text(
                  l10n.kitchenBoardEmpty,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
          ),
          _ => SingleChildScrollView(
            padding: const EdgeInsets.all(UmiSpacing.md),
            child: Wrap(
              spacing: UmiSpacing.md,
              runSpacing: UmiSpacing.md,
              children: [
                for (final order in orders)
                  _TicketCard(
                    order: order,
                    l10n: l10n,
                    allDayFor: state.allDayFor,
                    busyTarget: state.busyTarget,
                    onItemTap: (itemId) =>
                        widget.controller.markItemReady(order, itemId),
                    onFire: (courseNumber) => widget.controller.fireCourse(
                      order,
                      courseNumber: courseNumber,
                    ),
                    onStart: () => widget.controller.startPreparation(order),
                    onComplete: () => widget.controller.complete(order),
                    onRecall: () => _recall(order),
                  ),
              ],
            ),
          ),
        },
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
    return MaterialBanner(
      content: Text(
        '${failure.title}\n${failure.message}\n${failure.recovery}',
      ),
      actions: [
        TextButton(
          onPressed: () {
            widget.controller.dismissError();
            _load();
          },
          child: Text(l10n.kitchenFailureRefresh),
        ),
        TextButton(
          onPressed: widget.controller.dismissError,
          child: Text(l10n.closeAction),
        ),
      ],
    );
  }
}

/// A refusal the cook can read: what did not happen, why, and what to do next.
/// How long a ticket has been waiting, in units a cook can read at a glance:
/// `now`, `12 min`, `2 h 5 min`, `10 d 5 h`.
///
/// The board used to render minutes for every age, so a ticket from ten days ago
/// read `14747 min` — a number nobody can turn into "that is from last week"
/// while plating. Two units, and the second only once the first stops being a
/// glance. (Defect D33 found it on the live screen.)
String formatTicketAge(
  Duration age, {
  required String now,
  required String Function(int minutes) minutes,
  required String Function(int hours, int minutes) hoursMinutes,
  required String Function(int days, int hours) daysHours,
}) {
  final safe = age.isNegative ? Duration.zero : age;
  if (safe.inMinutes <= 0) return now;
  if (safe.inDays >= 1) return daysHours(safe.inDays, safe.inHours % 24);
  if (safe.inHours >= 1) return hoursMinutes(safe.inHours, safe.inMinutes % 60);
  return minutes(safe.inMinutes);
}

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
  'PERMISSION_DENIED' || 'KITCHEN_PERMISSION_DENIED' => KitchenBoardFailure(
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

final class _TicketCard extends StatelessWidget {
  const _TicketCard({
    required this.order,
    required this.l10n,
    required this.allDayFor,
    required this.busyTarget,
    required this.onItemTap,
    required this.onFire,
    required this.onStart,
    required this.onComplete,
    required this.onRecall,
  });

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
  final VoidCallback onRecall;

  /// A line can be bumped while the station still owes it AND the kitchen has
  /// been told to start its course. A HELD line is not slower work — it is not
  /// work yet, and a tap on it would start the dessert with the starters, which
  /// is the whole thing courses exist to prevent. A line already marked done, or
  /// pulled, is not tappable either: the tap would be a no-op the cook could not
  /// tell apart from a silent failure.
  static bool bumpable(KitchenOrderItem item) =>
      item.fired && (item.status == 'queued' || item.status == 'preparing');

  ({Color color, String label}) _statusStyle(
    ColorScheme scheme,
  ) => switch (order.status) {
    'ready' => (color: const Color(0xFF3cb44b), label: l10n.kitchenStatusReady),
    'partially_ready' => (
      color: const Color(0xFFf58231),
      label: l10n.kitchenStatusPartiallyReady,
    ),
    'in_preparation' => (
      color: const Color(0xFF2E7DFF),
      label: l10n.kitchenStatusInPreparation,
    ),
    'exception' => (color: scheme.error, label: l10n.kitchenStatusException),
    _ => (color: scheme.outline, label: l10n.kitchenStatusQueued),
  };

  String _elapsed() {
    final queued = DateTime.tryParse(order.queuedAt);
    if (queued == null) return '';
    return formatTicketAge(
      DateTime.now().toUtc().difference(queued.toUtc()),
      now: l10n.kitchenElapsedNow,
      minutes: l10n.kitchenElapsedMinutes,
      hoursMinutes: l10n.kitchenElapsedHoursMinutes,
      daysHours: l10n.kitchenElapsedDaysHours,
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
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
      width: 320,
      child: Material(
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
                          order.publicReference,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                      ),
                      Text(
                        _elapsed(),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      _Pill(color: status.color, label: status.label),
                      if (urgent || high) ...[
                        const SizedBox(width: UmiSpacing.sm),
                        _Pill(
                          color: accent,
                          label: urgent
                              ? l10n.kitchenPriorityUrgent
                              : l10n.kitchenPriorityHigh,
                        ),
                      ],
                    ],
                  ),
                  const Divider(height: UmiSpacing.lg),
                  for (var index = 0; index < groups.length; index++) ...[
                    if (index > 0) const SizedBox(height: UmiSpacing.sm),
                    _CourseBlock(
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
                  if (nextCourse != null) ...[
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
                    order: order,
                    l10n: l10n,
                    busy: busyTarget == order.id,
                    onStart: onStart,
                    onComplete: onComplete,
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
    required this.l10n,
    required this.allDayFor,
    required this.busyTarget,
    required this.onItemTap,
  });

  final KitchenCourseGroup group;
  final AppLocalizations l10n;
  final KitchenAllDayItem? Function(KitchenOrderItem item) allDayFor;
  final String? busyTarget;
  final ValueChanged<String> onItemTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.kitchenCourseGroup(group.courseNumber),
          style: Theme.of(context).textTheme.labelLarge?.copyWith(
            color: scheme.onSurfaceVariant,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: UmiSpacing.xs),
        for (final item in group.fired)
          _ItemRow(
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
    final scheme = Theme.of(context).colorScheme;
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
            children: [
              Icon(Icons.schedule, size: 16, color: scheme.onSurfaceVariant),
              const SizedBox(width: 6),
              Text(
                l10n.kitchenCourseHeld(group.heldQuantity),
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(width: UmiSpacing.sm),
              // Ellipsised rather than wrapped: the count is the fact and this
              // is the sentence that explains it, so the sentence gives way.
              Flexible(
                child: Text(
                  l10n.kitchenCourseHeldNote,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
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
    child: FilledButton.icon(
      key: buttonKey,
      onPressed: enabled && !busy ? onFire : null,
      icon: busy
          ? const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.local_fire_department, size: 18),
      label: Text(
        l10n.kitchenCourseFire(courseNumber),
        overflow: TextOverflow.ellipsis,
      ),
      style: FilledButton.styleFrom(
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
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final voided = item.status == 'cancelled' || item.status == 'exception';
    final ready = item.status == 'ready';
    final bumpable = !held && _TicketCard.bumpable(item);
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
          : l10n.kitchenItemAlreadyReady(item.productName),
      child: InkWell(
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
                SizedBox(
                  width: 28,
                  child: Text(
                    '${item.quantity}×',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      decoration: voided ? TextDecoration.lineThrough : null,
                    ),
                  ),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Flexible(
                            child: Text(
                              item.productName,
                              style: Theme.of(context).textTheme.bodyLarge
                                  ?.copyWith(
                                    decoration: voided
                                        ? TextDecoration.lineThrough
                                        : null,
                                    color: voided
                                        ? scheme.onSurfaceVariant
                                        : null,
                                  ),
                            ),
                          ),
                          if (ready) ...[
                            const SizedBox(width: UmiSpacing.sm),
                            Text(
                              l10n.kitchenStatusReady,
                              style: Theme.of(context).textTheme.labelSmall
                                  ?.copyWith(
                                    color: const Color(0xFF3cb44b),
                                    fontWeight: FontWeight.w700,
                                  ),
                            ),
                          ],
                          if (voided) ...[
                            const SizedBox(width: UmiSpacing.sm),
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
                                style: Theme.of(context).textTheme.labelSmall
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
                            const SizedBox(width: UmiSpacing.sm),
                            Tooltip(
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
                                  '×${allDay!.ordered}',
                                  style: Theme.of(context).textTheme.labelSmall
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
                          style: Theme.of(context).textTheme.bodySmall
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
                          style: Theme.of(context).textTheme.bodySmall
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
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                else if (ready)
                  const Icon(
                    Icons.check_box,
                    size: 22,
                    color: Color(0xFF3cb44b),
                  )
                else if (voided)
                  Icon(Icons.block, size: 22, color: scheme.error)
                else if (held)
                  Icon(Icons.schedule, size: 22, color: scheme.onSurfaceVariant)
                else
                  Icon(
                    Icons.check_box_outline_blank,
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
    final scheme = Theme.of(context).colorScheme;
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
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
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
    required this.l10n,
    required this.busy,
    required this.onStart,
    required this.onComplete,
    required this.onRecall,
  });

  final KitchenOrderProjection order;
  final AppLocalizations l10n;
  final bool busy;
  final VoidCallback onStart;
  final VoidCallback onComplete;
  final VoidCallback onRecall;

  @override
  Widget build(BuildContext context) {
    if (busy) {
      return Row(
        children: [
          const SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: UmiSpacing.sm),
          Text(
            l10n.kitchenTicketSending,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      );
    }
    final actions = <Widget>[
      if (order.status == 'queued')
        FilledButton.tonalIcon(
          onPressed: onStart,
          icon: const Icon(Icons.play_arrow, size: 18),
          label: Text(l10n.kitchenTicketStartAction),
        ),
      if (order.status == 'ready')
        FilledButton.tonalIcon(
          onPressed: onRecall,
          icon: const Icon(Icons.undo, size: 18),
          label: Text(l10n.kitchenTicketRecallAction),
        ),
      if (order.status == 'ready')
        FilledButton.icon(
          onPressed: onComplete,
          icon: const Icon(Icons.check, size: 18),
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
    return AlertDialog(
      title: Text(l10n.kitchenRecallTitle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l10n.kitchenRecallBody),
          const SizedBox(height: UmiSpacing.sm),
          for (final reason in kitchenRecallReasons)
            RadioListTile<String>(
              value: reason.code,
              // ignore: deprecated_member_use
              groupValue: _code,
              // ignore: deprecated_member_use
              onChanged: (value) => setState(() => _code = value),
              title: Text(reason.label(l10n)),
              contentPadding: EdgeInsets.zero,
              dense: true,
            ),
          TextField(
            controller: _note,
            maxLength: 500,
            decoration: InputDecoration(labelText: l10n.kitchenRecallNoteLabel),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.kitchenRecallCancel),
        ),
        FilledButton(
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
      style: Theme.of(context).textTheme.labelMedium?.copyWith(
        color: color,
        fontWeight: FontWeight.w600,
      ),
    ),
  );
}

/// The board's second tab: what the kitchen must make today (§8.4).
///
/// The server owns the arithmetic (plan D13). The till shows the par, the
/// on-hand, the forecast usage over the window the response states, and the
/// quantity to make. The largest quantity comes first, because that is the order
/// the kitchen works in.
final class _PrepListTab extends StatelessWidget {
  const _PrepListTab({
    required this.controller,
    required this.l10n,
    required this.onRefresh,
  });

  final PrepListController controller;
  final AppLocalizations l10n;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final state = controller.state;
    final list = state.list;
    if (list == null) {
      return switch (state.phase) {
        PrepListPhase.failure => _PrepFailure(l10n: l10n, onRetry: onRefresh),
        _ => const Center(child: CircularProgressIndicator()),
      };
    }
    final rows = sortPrepItems(list.items);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            UmiSpacing.md,
            UmiSpacing.sm,
            UmiSpacing.sm,
            0,
          ),
          child: Row(
            children: [
              // The window comes from the response, never from a guess about
              // the shelf life the server used.
              Expanded(
                child: Text(
                  l10n.kitchenPrepWindow(list.from, list.to),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
              IconButton(
                tooltip: l10n.kitchenPrepRefresh,
                onPressed: onRefresh,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
        ),
        // One failed refresh keeps the last list readable and says what
        // happened. The error state is the surface's own, not a blank list.
        if (state.phase == PrepListPhase.failure)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.md),
            child: Text(
              l10n.kitchenPrepLoadFailed,
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.error,
              ),
            ),
          ),
        Expanded(
          child: rows.isEmpty
              ? Center(
                  child: Text(
                    l10n.kitchenPrepEmpty,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                )
              : SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(UmiSpacing.md),
                    child: _prepTable(context, rows),
                  ),
                ),
        ),
      ],
    );
  }

  Widget _prepTable(BuildContext context, List<PrepListItem> rows) {
    final theme = Theme.of(context);
    final header = theme.textTheme.labelMedium?.copyWith(
      fontWeight: FontWeight.w700,
      color: theme.colorScheme.onSurfaceVariant,
    );
    final number = theme.textTheme.bodyMedium;
    return DataTable(
      columnSpacing: UmiSpacing.md,
      horizontalMargin: UmiSpacing.sm,
      headingRowHeight: 40,
      dataRowMinHeight: 48,
      dataRowMaxHeight: 96,
      columns: [
        DataColumn(label: Text(l10n.kitchenPrepItemColumn, style: header)),
        DataColumn(label: Text(l10n.kitchenPrepUnitColumn, style: header)),
        DataColumn(
          numeric: true,
          label: Text(l10n.kitchenPrepParColumn, style: header),
        ),
        DataColumn(
          numeric: true,
          label: Text(l10n.kitchenPrepOnHandColumn, style: header),
        ),
        DataColumn(
          numeric: true,
          label: Text(l10n.kitchenPrepForecastColumn, style: header),
        ),
        DataColumn(
          numeric: true,
          label: Text(l10n.kitchenPrepQuantityColumn, style: header),
        ),
      ],
      rows: [
        for (final item in rows)
          DataRow(
            cells: [
              DataCell(
                Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.displayName,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      item.publicReference,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              DataCell(Text(kitchenUnitLabel(l10n, item.unit), style: number)),
              DataCell(
                Text(
                  scaledQuantityText(
                        l10n,
                        scaledQuantityView(item.parQuantity),
                      ) ??
                      '·',
                  style: number,
                ),
              ),
              DataCell(
                Text(
                  scaledQuantityText(
                        l10n,
                        scaledQuantityView(item.onHandQuantity),
                      ) ??
                      '·',
                  style: number,
                ),
              ),
              DataCell(
                Text(
                  scaledQuantityText(
                        l10n,
                        scaledQuantityView(item.forecastUsageQuantity),
                      ) ??
                      '·',
                  style: number,
                ),
              ),
              DataCell(_prepQuantityCell(theme, item)),
            ],
          ),
      ],
    );
  }

  /// The cell the cook reads. An item with no par has no work order, so the
  /// cell names that state instead of printing a zero.
  Widget _prepQuantityCell(ThemeData theme, PrepListItem item) {
    final quantity = prepQuantityView(item);
    if (quantity == null) return _NoParBadge(label: l10n.kitchenPrepNoPar);
    final text = scaledQuantityText(l10n, quantity);
    if (text == null) return Text('·', style: theme.textTheme.bodyMedium);
    return Text(
      text,
      style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
    );
  }
}

/// The named state for an item with no par. It is not a zero: a zero means a
/// par the cafe already meets, and this item has no par to meet.
final class _NoParBadge extends StatelessWidget {
  const _NoParBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: scheme.secondaryContainer,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
          color: scheme.onSecondaryContainer,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

/// The prep tab's own failure state: what failed and one way to try again.
final class _PrepFailure extends StatelessWidget {
  const _PrepFailure({required this.l10n, required this.onRetry});

  final AppLocalizations l10n;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.cloud_off_outlined, size: 56),
        const SizedBox(height: UmiSpacing.md),
        Text(l10n.kitchenPrepLoadFailed),
        const SizedBox(height: UmiSpacing.md),
        FilledButton(onPressed: onRetry, child: Text(l10n.retryAction)),
      ],
    ),
  );
}
