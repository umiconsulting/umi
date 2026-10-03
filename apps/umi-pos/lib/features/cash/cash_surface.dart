import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/errors/operator_error_message.dart';
import '../../core/localization/app_localizations.dart';
import '../../core/security/operator_permissions.dart';
import '../../core/theme/umi_theme.dart';
import '../../shared/widgets/inline_notice.dart';
import 'cash_approval.dart';
import 'cash_controller.dart';
import 'cash_equation.dart';
import 'cash_journal.dart';
import 'denomination_counter.dart';
import 'money_input.dart';

Future<void> showCashCenter(
  BuildContext context, {
  required CashController controller,
  required OperatorPermissions permissions,
  Future<void> Function()? onHandoffCompleted,
}) => showDialog<void>(
  context: context,
  builder: (_) => Dialog.fullscreen(
    child: CashCenter(
      controller: controller,
      permissions: permissions,
      onHandoffCompleted: onHandoffCompleted,
    ),
  ),
);

final class CashCenter extends StatefulWidget {
  const CashCenter({
    required this.controller,
    required this.permissions,
    this.onHandoffCompleted,
    super.key,
  });

  final CashController controller;
  final OperatorPermissions permissions;
  final Future<void> Function()? onHandoffCompleted;

  @override
  State<CashCenter> createState() => _CashCenterState();
}

final class _CashCenterState extends State<CashCenter> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (!mounted) return;
    setState(() {});
  }

  /// What the screen has to say about the last thing that happened, read from
  /// the state on every build.
  ///
  /// It used to be cached when the controller notified, which meant a notice
  /// that arrived before the screen was built — or while it was rebuilding for
  /// another reason — was never shown. A message that is a pure function of the
  /// state cannot be missed.
  ({String message, InlineNoticeTone tone})? _noticeFor(
    BuildContext context,
    AppLocalizations l,
    CashState state,
  ) {
    if (state.errorCode != null) {
      // The generic sentence is the last resort, not the answer. A refusal that
      // names itself — a locked manager PIN, a drawer that will not cover the
      // withdrawal, a shift that has already stopped taking money — is a
      // refusal the operator can act on, and every cash operation on this
      // screen reaches this one place.
      return (
        message: operatorErrorMessage(context, state.errorCode!),
        tone: InlineNoticeTone.error,
      );
    }
    if (state.drawerUnanswered) {
      // Not an error. The money moved and the ledger says so; what failed is the
      // pulse that opens the drawer, and the person standing at it has no other
      // way to hear about it.
      return (
        message: l.cashDrawerUnansweredMessage,
        tone: InlineNoticeTone.warning,
      );
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final state = widget.controller.state;
    final snapshot = state.snapshot;
    final notice = _noticeFor(context, l, state);
    // The keyboard's cursor for everything on this screen, dialogs included:
    // `showDialog` captures the inherited themes of the context that opens it, so
    // a ring set here reaches the count, movement and close dialogs too.
    return Theme(
      data: _cashControls(Theme.of(context)),
      child: Scaffold(
        appBar: AppBar(
          title: Text(l.cashCenterTitle),
          leading: Navigator.canPop(context)
              ? IconButton(
                  tooltip: l.closeAction,
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close),
                )
              : null,
          actions: [
            IconButton(
              tooltip: l.retryAction,
              onPressed: state.busy ? null : widget.controller.load,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(UmiSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (notice != null) ...[
                  InlineNotice(message: notice.message, tone: notice.tone),
                  const SizedBox(height: UmiSpacing.md),
                ],
                if (state.busy) ...[
                  const LinearProgressIndicator(),
                  const SizedBox(height: UmiSpacing.md),
                ],
                Expanded(
                  child: snapshot == null
                      ? (state.busy
                            // The shape of the drawer, before the drawer arrives.
                            // A centred spinner says "something is happening";
                            // this says what is coming, so the eye is already
                            // where the numbers will land and the screen does not
                            // jump when they do. (Visual principles, item 3.)
                            ? const _CashSkeleton(
                                key: ValueKey('cash-skeleton'),
                              )
                            : _CashUnavailable(onRetry: widget.controller.load))
                      : _ready(context, l, snapshot),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// The whole screen in one viewport, with no page-level scroll view.
  ///
  /// The reference viewport for the till is 1280 x 720 logical, and this screen
  /// used to be a single centred 1040-wide column of stacked cards that ran past
  /// it: on a counter terminal the operator had to scroll a *cash* screen to
  /// reach "close the shift". The width was what the layout was wasting. The
  /// same content fits side by side, and the drawer state, the movements and the
  /// close path are all visible at once without anything moving under the hand.
  Widget _ready(
    BuildContext context,
    AppLocalizations l,
    CashCenterSnapshot snapshot,
  ) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _StatusCard(
        title: _statusHeadline(l, snapshot),
        register: _registerName(snapshot),
        businessDate: snapshot.businessDate,
        // A shift that is open on another terminal still has a drawer, a moment
        // it opened, and a person holding it. The strip names those too, so the
        // headline and the panel below it never describe two different days.
        openedAt:
            (snapshot.currentShift ?? snapshot.adoptableShift)?['openedAt']
                as String?,
        closedAt: snapshot.currentShift?['closedAt'] as String?,
        lastReadAt: widget.controller.lastReadAt,
        policy: snapshot.policy,
      ),
      if (snapshot.summary != null) ...[
        const SizedBox(height: UmiSpacing.md),
        _ClosedSummaryCard(summary: snapshot.summary!),
      ],
      // An expired policy is a blocking state, not an empty screen: the drawer
      // is untouched and the terminal cannot move it. The screen says so in
      // words, and shows the policy it was holding so the owner can see what
      // lapsed.
      if (snapshot.recoveryState == 'policy_expired') ...[
        const SizedBox(height: UmiSpacing.md),
        Expanded(child: _PolicyExpired(snapshot: snapshot)),
      ] else ...[
        if (widget.controller.reclaimableRegisters.isNotEmpty) ...[
          const SizedBox(height: UmiSpacing.md),
          _ReclaimRegisterSection(
            controller: widget.controller,
            permissions: widget.permissions,
          ),
        ],
        const SizedBox(height: UmiSpacing.md),
        Expanded(child: _main(snapshot)),
      ],
    ],
  );

  Widget _main(CashCenterSnapshot snapshot) {
    if (snapshot.adoptableShift != null) {
      return _AdoptShiftSection(
        controller: widget.controller,
        permissions: widget.permissions,
      );
    }
    if (snapshot.currentShift == null) {
      return _OpenShiftSection(
        controller: widget.controller,
        permissions: widget.permissions,
        registers: snapshot.registers,
      );
    }
    return _ActiveShiftSection(
      controller: widget.controller,
      permissions: widget.permissions,
      onHandoffCompleted: widget.onHandoffCompleted,
    );
  }

  String _registerName(CashCenterSnapshot snapshot) {
    // The drawer is the one this terminal holds, or the one it is about to take
    // back from a terminal that vanished.
    final shift = snapshot.currentShift ?? snapshot.adoptableShift;
    if (shift == null) return '';
    final registerId = shift['registerId'];
    for (final register in snapshot.registers) {
      if (register['id'] == registerId) {
        return register['displayName'] as String? ?? '';
      }
    }
    return '';
  }

  /// What the state strip calls the state this screen is in.
  ///
  /// The raw status is the server's, and it lags the flow: a reconciled shift
  /// still carries `reconciliation_required` until the close is booked, so the
  /// strip used to read "Se requiere conciliación" while the only action left was
  /// "Cerrar turno". The flow knows better than the status string at that point.
  String _statusHeadline(AppLocalizations l, CashCenterSnapshot snapshot) {
    // A lapsed policy outranks the shift's own state: whatever the drawer was
    // doing, nothing on this screen can happen until the owner publishes again.
    if (snapshot.recoveryState == 'policy_expired') {
      return l.cashPolicyExpiredTitle;
    }
    if (snapshot.currentShift == null) {
      return snapshot.adoptableShift == null
          ? l.shiftRequiredMessage
          : l.adoptShiftTitle;
    }
    final status = snapshot.currentShift!['status'] as String?;
    if (snapshot.reconciliation != null && status != 'closed') {
      return l.cashStatusReadyToClose;
    }
    return _statusLabel(l, status);
  }

  String _statusLabel(AppLocalizations l, String? status) => switch (status) {
    'open' => l.cashStatusOpen,
    'suspended' || 'handoff_pending' => l.cashStatusSuspended,
    'counting' => l.cashStatusCounting,
    'reconciliation_required' || 'closing' => l.cashStatusReconciliation,
    'closed' => l.cashStatusClosed,
    _ => l.registerAvailableLabel,
  };
}

/// The screen's own shape, drawn before it has any numbers to put in it.
///
/// Same cards, same columns, same rhythm as the real thing: the state strip, the
/// drawer's account with its total on the right, the movement tiles, the journal,
/// the close path and the policy. Nothing moves when the data lands, and an
/// operator waiting on a slow network is already looking at the place the
/// answer will appear.
///
/// Deliberately still: the strip at the top of the screen already carries the
/// app's progress bar, and a second animation would be decoration.
final class _CashSkeleton extends StatelessWidget {
  const _CashSkeleton({super.key});

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final wide = constraints.maxWidth >= 1000;
      // The same height rule the real screen uses. On a short terminal the
      // journal is not the part that takes the slack — the whole column scrolls
      // — and a skeleton that kept expanding into a 146 px space reported the
      // journal's rows as an overflow.
      final roomForSlack = constraints.maxHeight >= 640;
      final drawer = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _SkeletonCard(
            children: [
              const _SkeletonBar(width: 190, height: 18),
              const SizedBox(height: UmiSpacing.md),
              cashFiguresAndTotal(
                // The same grid and the same stack-to-the-foot rule as the real
                // account, so the two line up term for term when the numbers
                // arrive — at every width.
                figures: LayoutBuilder(
                  builder: (context, constraints) {
                    final width = constraints.maxWidth;
                    final columns = width >= 1000
                        ? 6
                        : width >= 560
                        ? 3
                        : width >= 320
                        ? 2
                        : 1;
                    const gap = UmiSpacing.lg;
                    final cell = (width - gap * (columns - 1)) / columns;
                    return Wrap(
                      spacing: gap,
                      runSpacing: UmiSpacing.md,
                      children: [
                        for (var index = 0; index < 6; index++)
                          SizedBox(width: cell, child: const _SkeletonFigure()),
                      ],
                    );
                  },
                ),
                total: const _SkeletonBar(height: 104, corner: 14),
              ),
            ],
          ),
          const SizedBox(height: UmiSpacing.sm),
          _SkeletonCard(
            children: [
              const _SkeletonBar(width: 170, height: 18),
              const SizedBox(height: UmiSpacing.md),
              for (var row = 0; row < 2; row++) ...[
                Row(
                  children: [
                    for (var column = 0; column < 2; column++) ...[
                      if (column > 0) const SizedBox(width: UmiSpacing.sm),
                      const Expanded(
                        child: _SkeletonBar(height: UmiTouchTarget.minimum),
                      ),
                    ],
                  ],
                ),
                if (row == 0) const SizedBox(height: UmiSpacing.sm),
              ],
            ],
          ),
          const SizedBox(height: UmiSpacing.sm),
          if (wide && roomForSlack)
            Expanded(child: _journalSkeleton(rows: 5))
          else
            _journalSkeleton(rows: 3),
        ],
      );
      final rail = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _SkeletonCard(children: _closeSkeleton()),
          const SizedBox(height: UmiSpacing.md),
          _SkeletonCard(children: _policySkeleton()),
        ],
      );
      if (!wide) {
        return SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _SkeletonCard(
                children: [
                  Row(
                    children: [
                      const _SkeletonBar(width: 28, height: 28, corner: 14),
                      const SizedBox(width: UmiSpacing.md),
                      const _SkeletonBar(width: 240, height: 22),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: UmiSpacing.md),
              drawer,
              const SizedBox(height: UmiSpacing.lg),
              rail,
            ],
          ),
        );
      }
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _SkeletonCard(
            children: [
              Row(
                children: [
                  const _SkeletonBar(width: 28, height: 28, corner: 14),
                  const SizedBox(width: UmiSpacing.md),
                  const _SkeletonBar(width: 240, height: 22),
                ],
              ),
            ],
          ),
          const SizedBox(height: UmiSpacing.md),
          Expanded(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  flex: 3,
                  child: roomForSlack
                      ? drawer
                      : SingleChildScrollView(child: drawer),
                ),
                const SizedBox(width: UmiSpacing.lg),
                Expanded(flex: 2, child: SingleChildScrollView(child: rail)),
              ],
            ),
          ),
        ],
      );
    },
  );

  static List<Widget> _closeSkeleton() => [
    const _SkeletonBar(width: 150, height: 18),
    const SizedBox(height: UmiSpacing.md),
    for (var step = 0; step < 4; step++) ...[
      Row(
        children: [
          const _SkeletonBar(width: 32, height: 32, corner: 16),
          const SizedBox(width: UmiSpacing.md),
          const Expanded(child: _SkeletonBar(height: 16)),
        ],
      ),
      if (step < 3) const SizedBox(height: UmiSpacing.md),
    ],
    const SizedBox(height: UmiSpacing.lg),
    const _SkeletonBar(height: UmiTouchTarget.primary),
  ];

  static List<Widget> _policySkeleton() => [
    const _SkeletonBar(width: 140, height: 18),
    const SizedBox(height: UmiSpacing.md),
    for (var row = 0; row < 5; row++) ...[
      Row(
        children: [
          const Expanded(child: _SkeletonBar(height: 14)),
          const SizedBox(width: UmiSpacing.xl),
          const _SkeletonBar(width: 90, height: 14),
        ],
      ),
      if (row < 4) const SizedBox(height: UmiSpacing.md),
    ],
  ];

  Widget _journalSkeleton({required int rows}) => _SkeletonCard(
    children: [
      Row(
        children: [
          const _SkeletonBar(width: 130, height: 18),
          const Spacer(),
          const _SkeletonBar(width: 16, height: 14),
        ],
      ),
      const SizedBox(height: UmiSpacing.md),
      for (var row = 0; row < rows; row++) ...[
        Row(
          children: [
            const Expanded(child: _SkeletonBar(height: 16)),
            const SizedBox(width: UmiSpacing.xl),
            const _SkeletonBar(width: 110, height: 16),
          ],
        ),
        if (row < rows - 1) const SizedBox(height: UmiSpacing.md),
      ],
    ],
  );
}

/// One placeholder card: the real card's surface, holding bars.
final class _SkeletonCard extends StatelessWidget {
  const _SkeletonCard({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(UmiSpacing.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: children,
      ),
    ),
  );
}

/// One grey block. The colour is the card fill one step up, which reads as
/// "content will be here" on both themes without shouting.
final class _SkeletonBar extends StatelessWidget {
  const _SkeletonBar({
    this.width,
    this.height = 16,
    this.corner = UmiRadius.control,
  });

  final double? width;
  final double height;
  final double corner;

  @override
  Widget build(BuildContext context) => Container(
    width: width,
    height: height,
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(corner),
    ),
  );
}

/// A term of the drawer's account, waiting: a label above a figure.
final class _SkeletonFigure extends StatelessWidget {
  const _SkeletonFigure();

  @override
  Widget build(BuildContext context) => const Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _SkeletonBar(width: 88, height: 10),
      SizedBox(height: UmiSpacing.sm),
      _SkeletonBar(width: 118, height: 18),
    ],
  );
}

/// The terminal is holding a policy that has lapsed.
///
/// The server refuses every cash action in this state, so the screen must not
/// offer one and must not blame the operator's permissions for the silence —
/// the read-only note says "with your current permissions", which would be a
/// misdiagnosis here. What the operator needs is the reason, the instruction to
/// call the owner, and the reassurance that the money has not moved.
final class _PolicyExpired extends StatelessWidget {
  const _PolicyExpired({required this.snapshot});

  final CashCenterSnapshot snapshot;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Center(
      child: SingleChildScrollView(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(UmiSpacing.lg),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          const Icon(
                            Icons.warning_amber_outlined,
                            size: 24,
                            color: UmiTheme.warning,
                          ),
                          const SizedBox(width: UmiSpacing.sm),
                          Expanded(
                            child: Text(
                              l.cashPolicyExpiredTitle,
                              style: theme.textTheme.titleMedium,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: UmiSpacing.md),
                      Text(
                        l.cashPolicyExpiredMessage,
                        style: theme.textTheme.bodyLarge,
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: UmiSpacing.md),
              _SectionCard(
                title: l.cashPolicyLabel,
                child: CashPolicyTable(policy: snapshot.policy),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The Caja screen's own failure surface.
///
/// Shown when the first load never produced a snapshot. Before this existed the
/// screen rendered a bare `CircularProgressIndicator` for that state, so a
/// failed load was indistinguishable from a slow one and an operator had nothing
/// to press — the plan's §4 bar requires a typed message with a recovery action,
/// and the refresh icon in the app bar was the only way out (and is disabled
/// while the controller is busy). Found by driving the real app against a
/// failing API (defect D26); the strings are the two that already existed, so
/// nothing new needed translating.
final class _CashUnavailable extends StatelessWidget {
  const _CashUnavailable({required this.onRetry});

  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.lg),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(UmiSpacing.lg),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Icon(
                        Icons.error_outline,
                        size: 24,
                        color: theme.colorScheme.error,
                      ),
                      const SizedBox(width: UmiSpacing.sm),
                      Expanded(
                        child: Text(
                          l.cashUnavailableTitle,
                          style: theme.textTheme.titleMedium,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: UmiSpacing.md),
                  Text(
                    l.cashOperationFailedMessage,
                    style: theme.textTheme.bodyLarge,
                  ),
                  const SizedBox(height: UmiSpacing.sm),
                  // A load that failed is a moment where the operator has to
                  // decide whether to keep taking cash. Saying what to do next
                  // is the difference between an error and a dead end.
                  Text(
                    l.cashUnavailableHint,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: UmiSpacing.lg),
                  FilledButton.icon(
                    onPressed: onRetry,
                    icon: const Icon(Icons.refresh),
                    label: Text(l.retryAction),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, UmiTouchTarget.primary),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

final class _ClosedSummaryCard extends StatelessWidget {
  const _ClosedSummaryCard({required this.summary});

  final Map<String, Object?> summary;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    // The status strip already says the shift is closed; this card answers the
    // question that follows, in the same shape as the drawer's own count. The
    // closure announcement rides on the semantics node so a screen reader hears
    // the change of state even though the words moved.
    return Semantics(
      liveRegion: true,
      label: l.shiftClosedMessage,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(UmiSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l.cashVarianceTitle,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: UmiSpacing.md),
              Wrap(
                spacing: UmiSpacing.xl,
                runSpacing: UmiSpacing.sm,
                children: [
                  _Figure(
                    label: l.expectedCashLabel,
                    value: _money(
                      (summary['expectedCash']
                                  as Map<
                                    String,
                                    Object?
                                  >?)?['expectedDrawerCash']
                              as Map<String, Object?>? ??
                          const {},
                    ),
                  ),
                  _Figure(
                    label: l.countedCashLabel,
                    value: _money(
                      summary['countedCash'] as Map<String, Object?>? ??
                          const {},
                    ),
                  ),
                  _Figure(
                    label: l.cashVarianceLabel,
                    value: _money(
                      summary['variance'] as Map<String, Object?>? ?? const {},
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

final class _StatusCard extends StatelessWidget {
  const _StatusCard({
    required this.title,
    required this.register,
    required this.businessDate,
    this.openedAt,
    this.closedAt,
    this.lastReadAt,
    this.policy,
  });

  final String title;
  final String register;
  final String businessDate;
  final String? openedAt;

  /// Set only when the shift is closed. A closed shift is not "open for eleven
  /// hours"; what the operator wants from the strip at that point is the hour the
  /// drawer stopped, which is the one they will be asked about.
  final String? closedAt;

  /// When this screen last heard from the server, or null before the first
  /// answer. The figures below are that moment's reading, not a live feed.
  final DateTime? lastReadAt;

  /// The policy in force, for the one thing about it the operator is ever asked:
  /// which one it is, and when it lapses.
  final Map<String, Object?>? policy;

  /// How long the shift has been open, read from `openedAt` (audit F4). The
  /// screen used to show no drawer state at all.
  String? _openFor(BuildContext context) {
    final closedRaw = closedAt;
    if (closedRaw != null) {
      final closed = DateTime.tryParse(closedRaw);
      if (closed != null) {
        final spanish = Localizations.localeOf(context).languageCode == 'es';
        return '${spanish ? 'Cerrado' : 'Closed'} ${_localClock(closedRaw)}';
      }
    }
    final raw = openedAt;
    if (raw == null) return null;
    final opened = DateTime.tryParse(raw);
    if (opened == null) return null;
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    final elapsed = DateTime.now().difference(opened);
    if (elapsed.inMinutes < 1) {
      return spanish ? 'Abierto hace un momento' : 'Open just now';
    }
    final hours = elapsed.inHours;
    final minutes = elapsed.inMinutes % 60;
    final span = hours > 0 ? '$hours h $minutes min' : '$minutes min';
    return spanish ? 'Abierto hace $span' : 'Open for $span';
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final openFor = _openFor(context);
    // The identity of the policy the till is holding. A version with no date
    // tells support nothing, and a date with no version cannot be matched to a
    // published rule set, so each part is named.
    final version = policy?['version'];
    final expiresAt = policy?['expiresAt'];
    final policyIdentity = [
      if (version is String && version.isNotEmpty)
        '${l.cashPolicyVersionLabel} $version',
      if (expiresAt is String && expiresAt.isNotEmpty)
        // A timestamp is not a date, and the API does not send one shape: a
        // fixture carries `2026-10-01T00:00:00.000Z` and the live repository
        // casts a Postgres timestamp to `2027-09-03 00:13:57.416699+00`. The
        // strip writes the business day as `2026-09-30`, so the leading date is
        // what a person needs either way.
        '${l.cashPolicyExpiresAtLabel} ${_datePart(expiresAt)}',
    ].join(' · ');
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.lg),
        // One strip that scrolls sideways instead of wrapping: the state strip
        // must never grow taller. The state belongs at the top; the thresholds
        // that govern it have their own card in the right column, where they can
        // be read as rules instead of as a row of fragments.
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              Icon(
                Icons.point_of_sale,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(width: UmiSpacing.md),
              // The live region is the state, and only the state. It used to wrap
              // the whole screen, which told a screen reader that every change
              // anywhere — a spinner, a refresh — was an announcement worth
              // interrupting for.
              Semantics(
                liveRegion: true,
                child: Text(
                  title,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
              ),
              if (register.isNotEmpty) ...[
                const SizedBox(width: UmiSpacing.xl),
                Text(register),
              ],
              const SizedBox(width: UmiSpacing.xl),
              Text(businessDate),
              if (openFor != null) ...[
                const SizedBox(width: UmiSpacing.xl),
                Icon(
                  Icons.schedule,
                  size: 18,
                  color: Theme.of(context).colorScheme.outline,
                ),
                const SizedBox(width: UmiSpacing.xs),
                Text(openFor),
              ],
              // The state of the drawer as of a moment ago. On a counter where
              // two people can touch the same drawer, "how old is this screen?"
              // is the question behind every disagreement about a number — and
              // the only honest answer is a time, not a green dot.
              if (lastReadAt != null) ...[
                const SizedBox(width: UmiSpacing.xl),
                Text(
                  '${l.cashLastReadLabel} '
                  '${lastReadAt!.hour.toString().padLeft(2, '0')}:'
                  '${lastReadAt!.minute.toString().padLeft(2, '0')}',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.outline,
                  ),
                ),
              ],
              // Which policy this till is holding, and the day it lapses. An
              // operator on the phone with support is asked both, and the second
              // is worth seeing before it bites rather than only after.
              if (policyIdentity.isNotEmpty) ...[
                const SizedBox(width: UmiSpacing.xl),
                Text(
                  policyIdentity,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.outline,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// The shift is open, the drawer is full, and the terminal that was speaking for
/// it is gone. Nothing here asks for a count or an approval: the operator in
/// front of us already owns this shift, and only the address changes.
final class _AdoptShiftSection extends StatelessWidget {
  const _AdoptShiftSection({
    required this.controller,
    required this.permissions,
  });

  final CashController controller;
  final OperatorPermissions permissions;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final state = controller.state;
    final snapshot = state.snapshot;
    final shift = snapshot?.adoptableShift;
    final canAdopt =
        permissions.allows('cash.shift.resume') &&
        (snapshot?.allowedActions.contains('adopt_shift') ?? false);
    final openedAt = shift?['openedAt'] as String?;

    final registerName = () {
      for (final register
          in snapshot?.registers ?? const <Map<String, Object?>>[]) {
        if (register['id'] == shift?['registerId']) {
          return register['displayName'] as String? ?? '';
        }
      }
      return '';
    }();

    return _ShiftShell(
      // The decision and the shift it is about sit together: the operator checks
      // the drawer, the day and the hour, then moves it. The policy does not
      // change between shifts, so it keeps to the rail.
      work: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(UmiSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    l.adoptShiftCardTitle,
                    style: theme.textTheme.titleMedium,
                  ),
                  const SizedBox(height: UmiSpacing.md),
                  Text(l.adoptShiftMessage, style: theme.textTheme.bodyLarge),
                  const SizedBox(height: UmiSpacing.lg),
                  FilledButton.icon(
                    onPressed: state.busy || !canAdopt
                        ? null
                        : () => controller.adoptShift(),
                    icon: const Icon(Icons.sync_alt),
                    label: Text(l.adoptShiftAction),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, UmiTouchTarget.primary),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: UmiSpacing.md),
          _SectionCard(
            title: l.cashShiftCardTitle,
            child: Wrap(
              spacing: UmiSpacing.xl,
              runSpacing: UmiSpacing.md,
              children: [
                if (registerName.isNotEmpty)
                  _Figure(label: l.registerAssignedLabel, value: registerName),
                _Figure(
                  label: l.businessDateLabel,
                  value: snapshot?.businessDate ?? '',
                ),
                if (openedAt != null)
                  _Figure(
                    label: l.cashOpenedAtLabel,
                    value: _localClock(openedAt),
                  ),
              ],
            ),
          ),
        ],
      ),
      rail: [
        if (snapshot != null)
          _SectionCard(
            title: l.cashPolicyLabel,
            child: CashPolicyTable(policy: snapshot.policy),
          ),
      ],
    );
  }
}

/// The two columns a screen wears when the drawer is not in this terminal's
/// hands: the work at the left, the facts and the policy in the rail.
///
/// It is the same split the running shift already uses. A screen that changes
/// its shape when the drawer changes hands makes the operator re-learn the
/// layout at the moment they have the least attention to spare — and before this
/// shell existed, both of these screens were a 720 px card floating in a 1920 px
/// void, which reads as a dialog that failed to open rather than as a screen.
final class _ShiftShell extends StatelessWidget {
  const _ShiftShell({required this.work, required this.rail});

  final Widget work;
  final List<Widget> rail;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final railColumn = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (index, card) in rail.indexed) ...[
            if (index > 0) const SizedBox(height: UmiSpacing.md),
            card,
          ],
        ],
      );
      if (constraints.maxWidth < 1000) {
        return SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              work,
              const SizedBox(height: UmiSpacing.lg),
              railColumn,
            ],
          ),
        );
      }
      return Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(flex: 3, child: SingleChildScrollView(child: work)),
          const SizedBox(width: UmiSpacing.lg),
          Expanded(flex: 2, child: SingleChildScrollView(child: railColumn)),
        ],
      );
    },
  );
}

/// `HH:mm` in the terminal's own zone, for a moment the operator remembers
/// rather than a timestamp they have to convert.
String _localClock(String iso) {
  final at = DateTime.tryParse(iso);
  if (at == null) return iso;
  final local = at.toLocal();
  return '${local.hour.toString().padLeft(2, '0')}:'
      '${local.minute.toString().padLeft(2, '0')}';
}

/// A register whose holding terminal is gone for good: nobody is coming back to
/// count it, so the operator who may open a register may also free it. There is
/// no count and no approval here on purpose — the cash stays in the drawer and
/// the server proves the terminal is unusable.
final class _ReclaimRegisterSection extends StatelessWidget {
  const _ReclaimRegisterSection({
    required this.controller,
    required this.permissions,
  });

  final CashController controller;
  final OperatorPermissions permissions;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final state = controller.state;
    final canReclaim =
        permissions.allows('cash.shift.open') && state.snapshot != null;
    final registers = controller.reclaimableRegisters;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l.reclaimRegisterTitle,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: UmiSpacing.sm),
            Text(l.reclaimRegisterMessage),
            const SizedBox(height: UmiSpacing.lg),
            for (final register in registers) ...[
              FilledButton.tonal(
                onPressed: state.busy || !canReclaim
                    ? null
                    : () =>
                          controller.reclaimRegister(register['id']! as String),
                child: Text(
                  '${l.reclaimRegisterAction} · ${register['displayName'] ?? ''}',
                ),
              ),
              const SizedBox(height: UmiSpacing.sm),
            ],
          ],
        ),
      ),
    );
  }
}

final class _OpenShiftSection extends StatefulWidget {
  const _OpenShiftSection({
    required this.controller,
    required this.permissions,
    required this.registers,
  });

  final CashController controller;
  final OperatorPermissions permissions;
  final List<Map<String, Object?>> registers;

  @override
  State<_OpenShiftSection> createState() => _OpenShiftSectionState();
}

final class _OpenShiftSectionState extends State<_OpenShiftSection> {
  String? selectedRegister;
  // The opening float is counted denomination by denomination (audit F3), which
  // replaces a single free-text field that used to parse a mistyped caret as an
  // empty drawer.
  DenominationTally floatTally = const DenominationTally(
    0,
    <Map<String, Object?>>[],
  );

  @override
  void initState() {
    super.initState();
    if (widget.registers.isNotEmpty) {
      selectedRegister = widget.registers.first['id'] as String?;
    }
  }

  Map<String, Object?>? get _register {
    for (final register in widget.registers) {
      if (register['id'] == selectedRegister) return register;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final snapshot = widget.controller.state.snapshot;
    final policy = snapshot?.policy;
    final currency = _register?['currency'] as String? ?? 'MXN';
    final floatRequired = policy?['openingFloatRequired'] == true;
    final canOpen =
        widget.permissions.allows('cash.shift.open') &&
        (snapshot?.allowedActions.contains('open_shift') ?? false);
    final shortFloat = floatRequired && floatTally.totalMinorUnits <= 0;
    // The drawer in front of the operator was left behind by a terminal that is
    // gone. Opening a shift here is allowed — and it costs something the form
    // never mentioned: the stranded shift is blocked without a count, and its
    // money stays where it is. A destructive outcome stated as a plain action is
    // the one thing the design language will not have.
    final hold = _register?['hold'];
    final stranded =
        hold is Map<String, Object?> &&
        hold['state'] == 'held_by_orphaned_till';
    final enabled =
        selectedRegister != null &&
        !widget.controller.state.busy &&
        canOpen &&
        !shortFloat;

    // The work is the count. The drawer and the policy are facts about the shift
    // the count is about to open, so they sit in the rail where the running
    // shift keeps the same two things.
    return _ShiftShell(
      work: Card(
        child: Padding(
          padding: const EdgeInsets.all(UmiSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l.openingFloatLabel,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: UmiSpacing.md),
              DenominationCounter(
                key: ValueKey(currency),
                currency: currency,
                denominations: denominationsFromPolicy(policy),
                onChanged: (value) => setState(() => floatTally = value),
              ),
              // What this particular drawer costs before the form is filled in,
              // not after it fails.
              if (stranded) ...[
                const SizedBox(height: UmiSpacing.md),
                _Note(
                  icon: Icons.warning_amber_outlined,
                  text: l.openShiftOnStrandedDrawerMessage,
                ),
              ],
              const SizedBox(height: UmiSpacing.lg),
              Divider(
                height: 1,
                color: Theme.of(context).colorScheme.outlineVariant,
              ),
              const SizedBox(height: UmiSpacing.md),
              FilledButton.icon(
                onPressed: enabled
                    ? () => widget.controller.openShift(
                        registerId: selectedRegister!,
                        amountMinorUnits: floatTally.totalMinorUnits,
                        denominations: floatTally.lines,
                      )
                    : null,
                icon: const Icon(Icons.lock_open),
                label: Text(l.openShiftAction),
                style: FilledButton.styleFrom(
                  minimumSize: const Size(0, UmiTouchTarget.primary),
                ),
              ),
              // A button that refuses without saying why is a dead end. The one
              // rule the operator can fix on this screen is stated under it.
              if (shortFloat) ...[
                const SizedBox(height: UmiSpacing.sm),
                Text(
                  l.openingFloatRequiredHint,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.outline,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      rail: [
        _SectionCard(
          title: l.registerAssignedLabel,
          child: DropdownButtonFormField<String>(
            initialValue: selectedRegister,
            items: widget.registers
                .map(
                  (register) => DropdownMenuItem(
                    value: register['id'] as String,
                    child: Text(register['displayName'] as String? ?? ''),
                  ),
                )
                .toList(growable: false),
            onChanged: (value) => setState(() => selectedRegister = value),
          ),
        ),
        if (policy != null)
          _SectionCard(
            title: l.cashPolicyLabel,
            child: CashPolicyTable(policy: policy),
          ),
      ],
    );
  }
}

final class _ActiveShiftSection extends StatelessWidget {
  const _ActiveShiftSection({
    required this.controller,
    required this.permissions,
    required this.onHandoffCompleted,
  });

  final CashController controller;
  final OperatorPermissions permissions;
  final Future<void> Function()? onHandoffCompleted;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    final state = controller.state;
    final snapshot = state.snapshot!;
    final actions = snapshot.allowedActions;
    final count = state.count;
    final variance = count?.variance;

    // Frequent drawer moves. Kept apart from the shift lifecycle so the barista
    // is never offered "close" beside "paid-in" (audit F15).
    final operations = <Widget>[
      if (actions.contains('movement') &&
          permissions.allows('cash.movement.paid_in'))
        _Action(
          icon: Icons.add_circle_outline,
          label: l.paidInAction,
          onPressed: () => _movement(context, controller, 'paid_in'),
        ),
      if (actions.contains('movement') &&
          permissions.allows('cash.movement.paid_out'))
        _Action(
          icon: Icons.remove_circle_outline,
          label: l.paidOutAction,
          onPressed: () => _movement(context, controller, 'paid_out'),
        ),
      if (actions.contains('movement') &&
          permissions.allows('cash.movement.safe_drop'))
        _Action(
          icon: Icons.savings_outlined,
          label: l.safeDropAction,
          onPressed: () => _movement(context, controller, 'safe_drop'),
        ),
      if (actions.contains('no_sale') &&
          permissions.allows('cash.drawer.no_sale'))
        _Action(
          icon: Icons.point_of_sale_outlined,
          label: l.noSaleDrawerAction,
          onPressed: () => _noSale(context, controller),
        ),
    ];

    // Shift lifecycle that is not the close flow.
    final lifecycle = <Widget>[
      if (actions.contains('suspend') &&
          permissions.allows('cash.shift.suspend'))
        _Action(
          icon: Icons.pause_circle_outline,
          label: l.suspendShiftAction,
          onPressed: () => controller.suspendOrResume(suspend: true),
        ),
      if (actions.contains('resume') && permissions.allows('cash.shift.resume'))
        _Action(
          icon: Icons.play_circle_outline,
          label: l.resumeShiftAction,
          onPressed: () => controller.suspendOrResume(suspend: false),
        ),
      if (actions.contains('handoff') &&
          permissions.allows('cash.shift.handoff'))
        _Action(
          icon: Icons.swap_horiz,
          label: l.handoffShiftAction,
          onPressed: () => _handoff(context, controller, onHandoffCompleted),
        ),
    ];

    // The close flow as a numbered path (audit F5): count → record the variance
    // → reconcile → close. The step states come straight from the controller,
    // and each gate below is the same condition the flat button list used, so
    // the barista sees the whole path instead of one relabelled button.
    final varianceZero =
        (variance?['signedVariance'] as Map<String, Object?>?)?['minorUnits'] ==
        0;
    final countDone = count != null;
    final resolveNeeded = countDone && !varianceZero;
    final resolveDone = state.resolution != null || (countDone && varianceZero);
    final reconcileDone = state.reconciliation != null;
    // The shift is closed when this session closed it, and also when the terminal
    // finds it closed later. The status is the server's fact; `closeResult` is
    // only this session's memory of having asked for it, so gating the flow on it
    // alone left a closed shift offering the next step of a flow that was over.
    final closed =
        state.closeResult != null ||
        snapshot.currentShift?['status'] == 'closed';
    final canCount =
        !closed &&
        actions.contains('count') &&
        permissions.allows(
          count == null ? 'cash.count.submit' : 'cash.count.recount',
        );
    // Every step asks the server whether it is available. `resolve_variance` used
    // to be the one gate that never consulted `allowedActions`, which is how a
    // closed shift came to offer "Motivo de la diferencia" as its next action.
    final canResolve =
        !closed &&
        countDone &&
        state.resolution == null &&
        actions.contains('resolve_variance') &&
        permissions.allows('cash.reconcile');
    final canReconcile =
        !reconcileDone &&
        actions.contains('reconcile') &&
        permissions.allows('cash.reconcile') &&
        resolveDone;
    final canClose =
        !closed &&
        reconcileDone &&
        actions.contains('close') &&
        permissions.allows('cash.shift.close');
    final canCancelCount =
        !closed &&
        actions.contains('cancel_count') &&
        permissions.allows('cash.count.submit');
    final showCloseFlow = canCount || countDone || reconcileDone;

    // The drawer side reads top to bottom as the operator's day: what the counter
    // should hold, what moved through it, and what may be done next. The journal
    // is the only unbounded part, so it is the part that takes the slack; the rest
    // keeps its natural height and stays where the hand expects it.
    //
    // `expanded` is false only when the column lives inside a scroll view, where
    // there is no height for a child to expand into.
    Widget buildDrawer({required bool expanded}) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // The account stands in every state. Before a count the policy hides
        // the expected total, not the card: the terms are already lines in the
        // journal below, and a missing card read as a screen still loading.
        CashEquation(
          account: CashDrawerAccount.fromLedger(
            snapshot.ledger,
            currency: (snapshot.currentShift?['currency'] as String?) ?? 'MXN',
          ),
          expectedCash: snapshot.expectedCash,
        ),
        const SizedBox(height: UmiSpacing.sm),
        // The count is shown once. After the close, the summary card above the
        // columns already carries the same three figures, and two cards with the
        // same title and the same numbers read as a screen that drew itself
        // twice.
        if (count != null && snapshot.summary == null) ...[
          _VarianceCard(variance: variance!, count: count.count),
          const SizedBox(height: UmiSpacing.sm),
        ],
        if (operations.isNotEmpty) ...[
          _SectionCard(
            title: spanish ? 'Movimientos de caja' : 'Cash movements',
            child: _ActionGrid(actions: operations),
          ),
          const SizedBox(height: UmiSpacing.sm),
        ],
        // Reference material last, and the only part that takes the slack: the
        // controls are what the operator came for, and a journal that can scroll
        // must never push them off the screen.
        if (expanded)
          Expanded(child: CashJournal(lines: snapshot.ledger, expand: true))
        else
          CashJournal(lines: snapshot.ledger, expand: false),
      ],
    );

    // The close path is a checklist with one action at the end, not four buttons.
    // The steps say where the shift stands; the button says what happens next. The
    // audit found the old flat row gave every action equal weight, so the barista
    // could not see the path — or which part of it was theirs to take now.
    final ({String label, VoidCallback onPressed})? nextStep =
        !countDone && canCount
        ? (
            label: l.blindCountAction,
            onPressed: () => _count(context, controller),
          )
        : canResolve && resolveNeeded
        ? (
            label: l.varianceReasonLabel,
            onPressed: () => _resolve(context, controller),
          )
        : canReconcile
        ? (label: l.reconcileShiftAction, onPressed: controller.reconcile)
        : canClose
        ? (
            label: l.closeShiftAction,
            onPressed: () => _close(context, controller),
          )
        : null;

    Widget closeCard() => Card(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              spanish ? 'Cierre de turno' : 'Shift close',
              // The same weight as every other card title on the screen: the
              // state strip carries the screen's headline, and each card below
              // it is a section of it, not a screen of its own.
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: UmiSpacing.md),
            _closeSteps(
              l,
              spanish,
              countDone,
              resolveDone,
              reconcileDone,
              closed,
              varianceZero,
            ),
            // The end of the path states itself. The check marks say the steps
            // are done; this says the drawer is no longer taking money, which is
            // the fact the operator has to leave the counter knowing.
            if (closed && nextStep == null) ...[
              const SizedBox(height: UmiSpacing.md),
              Semantics(
                liveRegion: true,
                child: Row(
                  children: [
                    Icon(
                      Icons.lock_outline,
                      size: 18,
                      color: Theme.of(context).colorScheme.outline,
                    ),
                    const SizedBox(width: UmiSpacing.sm),
                    Expanded(
                      child: Text(
                        l.shiftClosedMessage,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            if (nextStep != null) ...[
              // A hairline, then the one action. Without it the button reads as
              // the fourth step's own control instead of the next step's.
              const SizedBox(height: UmiSpacing.md),
              Divider(
                height: 1,
                color: Theme.of(context).colorScheme.outlineVariant,
              ),
              const SizedBox(height: UmiSpacing.md),
              FilledButton(
                onPressed: state.busy ? null : nextStep.onPressed,
                style: FilledButton.styleFrom(
                  minimumSize: const Size(0, UmiTouchTarget.primary),
                ),
                child: Text(nextStep.label),
              ),
            ],
            if (countDone && canCount) ...[
              const SizedBox(height: UmiSpacing.sm),
              TextButton(
                onPressed: state.busy
                    ? null
                    : () => _count(context, controller),
                child: Text(l.recountAction),
              ),
            ],
            // The count moved the drawer out of `open`, and nothing can be booked
            // to a drawer under count. When the count stands alone, the operator who
            // made the mistake gets out of it here instead of closing a shift they
            // did not mean to end.
            if (canCancelCount) ...[
              const SizedBox(height: UmiSpacing.xs),
              TextButton.icon(
                onPressed: state.busy
                    ? null
                    : () => _cancelCount(context, controller),
                icon: const Icon(Icons.undo),
                label: Text(l.cancelCountAction),
              ),
            ],
          ],
        ),
      ),
    );

    // What the operator may not do, said out loud, beside the rules that bound
    // the shift. A role that can only look is a fact about the person, not a
    // fault in the screen, and it is worth the two cards.
    Widget buildReadOnlyRail() => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionCard(
          title: l.cashReadOnlyTitle,
          child: Text(
            l.cashReadOnlyMessage,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
        const SizedBox(height: UmiSpacing.md),
        _SectionCard(
          title: l.cashPolicyLabel,
          child: CashPolicyTable(policy: snapshot.policy),
        ),
      ],
    );

    // The right column owns everything about the state of the shift: where the
    // close path stands, the two ways the drawer changes hands, and the policy
    // the operator is being held to. Each card keeps its natural height: the
    // column scrolls when the terminal is short, so nothing is stretched to fill
    // a space it has no content for.
    Widget buildClose() => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        closeCard(),
        if (lifecycle.isNotEmpty) ...[
          const SizedBox(height: UmiSpacing.md),
          _SectionCard(
            title: spanish ? 'Custodia del turno' : 'Shift custody',
            child: _ActionGrid(actions: lifecycle),
          ),
        ],
        const SizedBox(height: UmiSpacing.md),
        _SectionCard(
          title: l.cashPolicyLabel,
          child: CashPolicyTable(policy: snapshot.policy),
        ),
      ],
    );

    // Two panels side by side when there is room for both, one scrolling column
    // when there is not. Below 1000 px the two columns are narrower than the
    // controls they hold, and at 800 px the action tiles ran past their own
    // labels — a single scrolling column is the honest answer there.
    return LayoutBuilder(
      builder: (context, constraints) {
        final roomForTwoColumns = constraints.maxWidth >= 1000;
        // Nothing this operator may do: no movements, no custody, no close. The
        // screen used to answer that by drawing fewer buttons and saying nothing,
        // which reads as a console that is broken rather than as a role that is
        // limited. The rail says which it is, and what to do instead.
        final readOnly =
            operations.isEmpty && lifecycle.isEmpty && !showCloseFlow;
        if (!roomForTwoColumns) {
          return SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                buildDrawer(expanded: false),
                if (readOnly) ...[
                  const SizedBox(height: UmiSpacing.lg),
                  buildReadOnlyRail(),
                ],
                if (showCloseFlow) ...[
                  const SizedBox(height: UmiSpacing.lg),
                  buildClose(),
                ],
              ],
            ),
          );
        }
        // A tall rail lets the journal take the slack and stay put. On a short
        // one — a 720 px terminal — the same column is squeezed until the list
        // is a sliver with a scrollbar a finger cannot use, so the whole rail
        // scrolls instead and every card keeps the height its content earned.
        final roomForSlack = constraints.maxHeight >= 640;
        final drawerColumn = roomForSlack
            ? buildDrawer(expanded: true)
            : SingleChildScrollView(child: buildDrawer(expanded: false));
        // Nothing to close yet: the drawer panel is the whole screen. It keeps a
        // readable width instead of stretching one tile across the full span.
        if (!showCloseFlow) {
          if (readOnly) {
            return _ShiftShell(
              work: buildDrawer(expanded: false),
              rail: [buildReadOnlyRail()],
            );
          }
          return Align(
            alignment: Alignment.topCenter,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 1100),
              child: drawerColumn,
            ),
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(flex: 3, child: drawerColumn),
            const SizedBox(width: UmiSpacing.lg),
            Expanded(
              flex: 2,
              // The rail holds more cards than a 720 px terminal has rows.
              // Scrolling it keeps every card at its own height instead of
              // stretching one until the others fit.
              child: SingleChildScrollView(child: buildClose()),
            ),
          ],
        );
      },
    );
  }
}

/// The close path as a checklist: where the shift stands, not what to press.
///
/// The single action lives at the foot of the card, so the flow reads as a path
/// with one next step instead of four buttons of equal weight (audit F5, F15).
Widget _closeSteps(
  AppLocalizations l,
  bool spanish,
  bool countDone,
  bool resolveDone,
  bool reconcileDone,
  bool closed,
  bool varianceZero,
) => Column(
  mainAxisSize: MainAxisSize.min,
  crossAxisAlignment: CrossAxisAlignment.stretch,
  children: [
    _CloseStep(
      number: 1,
      label: spanish ? 'Contar la caja' : 'Count the drawer',
      detail: l.cashStepCountDetail,
      done: countDone,
      current: !countDone,
    ),
    _CloseStep(
      number: 2,
      label: spanish ? 'Registrar la diferencia' : 'Record the variance',
      detail: l.cashStepVarianceDetail,
      done: resolveDone,
      current: countDone && !resolveDone,
      skipped: countDone && varianceZero,
      skippedLabel: l.cashVarianceBalancedLabel,
    ),
    _CloseStep(
      number: 3,
      label: spanish ? 'Conciliar el turno' : 'Reconcile the shift',
      detail: l.cashStepReconcileDetail,
      done: reconcileDone,
      current: resolveDone && !reconcileDone,
    ),
    _CloseStep(
      number: 4,
      label: l.closeShiftAction,
      detail: l.cashStepCloseDetail,
      done: closed,
      current: reconcileDone && !closed,
    ),
  ],
);

/// A titled card.
///
/// The movements and the shift lifecycle used to be bare headings on the canvas
/// while everything above them sat in a card, so the eye read them as leftovers
/// rather than as the next step of the same task.
final class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      // One padding for every card on the screen. The eye reads the left edge of
      // a column of cards as one line, and a card whose content starts 8 px
      // inside its neighbours reads as a mistake even when nobody can name it.
      padding: const EdgeInsets.all(UmiSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: UmiSpacing.md),
          child,
        ],
      ),
    ),
  );
}

final class _CloseStep extends StatelessWidget {
  const _CloseStep({
    required this.number,
    required this.label,
    required this.detail,
    required this.done,
    required this.current,
    this.skipped = false,
    this.skippedLabel,
  });

  final int number;
  final String label;

  /// What the step asks of the operator, in one line.
  final String detail;
  final bool done;
  final bool current;
  final bool skipped;
  final String? skippedLabel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final complete = done || skipped;
    final active = complete || current;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UmiSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            // The circle fills as the step is taken. On a path of four, movement
            // is the only thing that tells the operator their press landed — and
            // the design language asks the product to respect the
            // reduced-motion preference, so where the platform asks for stillness
            // the step changes without travelling there.
            child: AnimatedContainer(
              duration: MediaQuery.disableAnimationsOf(context)
                  ? Duration.zero
                  : UmiMotion.fast,
              curve: Curves.easeOut,
              width: 32,
              height: 32,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: active ? scheme.primary : scheme.surfaceContainerHighest,
              ),
              child: AnimatedSwitcher(
                duration: MediaQuery.disableAnimationsOf(context)
                    ? Duration.zero
                    : UmiMotion.fast,
                child: complete
                    ? Icon(
                        Icons.check,
                        key: const ValueKey('done'),
                        size: 18,
                        color: scheme.onPrimary,
                      )
                    : Text(
                        '$number',
                        key: ValueKey('step-$number'),
                        style: TextStyle(
                          color: current
                              ? scheme.onPrimary
                              : scheme.onSurfaceVariant,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
              ),
            ),
          ),
          const SizedBox(width: UmiSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: active ? null : scheme.outline,
                  ),
                ),
                const SizedBox(height: 2),
                // A step that is only a label states a destination; this line
                // states the work, which is what the operator has to be able to
                // picture before the button below makes sense.
                Text(
                  skipped && skippedLabel != null ? skippedLabel! : detail,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: scheme.outline,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The action tiles laid out as a grid instead of a ragged wrap.
///
/// A `Wrap` of label-sized buttons leaves a different width on every row, and
/// that is what made this half of the screen read as a pile of unrelated
/// controls. Two equal columns let the eye scan them as a set, and the width
/// comes from the panel rather than from the longest label on it.
final class _ActionGrid extends StatelessWidget {
  const _ActionGrid({required this.actions});

  final List<Widget> actions;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      const gap = UmiSpacing.sm;
      final width = (constraints.maxWidth - gap) / 2;
      // An odd number of actions leaves a ragged last row. The last tile takes
      // the full width instead, so the set reads as a grid rather than as a
      // mistake.
      final odd = actions.length.isOdd;
      return Wrap(
        spacing: gap,
        runSpacing: gap,
        children: [
          for (final (index, action) in actions.indexed)
            SizedBox(
              width: odd && index == actions.length - 1
                  ? constraints.maxWidth
                  : width,
              child: action,
            ),
        ],
      );
    },
  );
}

final class _Action extends StatelessWidget {
  const _Action({
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    // A till is read in a hurry and in low light. A bare outline on a near-black
    // surface is a shape the eye files as a panel, not as a control — the tiles
    // that move the drawer were the least button-like thing on the screen. A
    // filled ground, a hairline, and an icon in the one accent colour say "press
    // me" without competing with the single primary action in the rail.
    return SizedBox(
      height: UmiTouchTarget.minimum,
      child: OutlinedButton.icon(
        onPressed: onPressed,
        icon: Icon(icon, size: 20),
        label: Text(label),
        style:
            OutlinedButton.styleFrom(
              foregroundColor: scheme.onSurface,
              backgroundColor: scheme.surfaceContainerHighest,
              iconColor: scheme.primary,
              textStyle: theme.textTheme.labelLarge,
            ).copyWith(
              side: _focusSide(
                theme,
                filled: false,
                resting: BorderSide(color: scheme.outlineVariant),
              ),
            ),
      ),
    );
  }
}

final class _VarianceCard extends StatelessWidget {
  const _VarianceCard({required this.variance, required this.count});

  final Map<String, Object?> variance;
  final Map<String, Object?> count;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final signed = variance['signedVariance']! as Map<String, Object?>;

    // The card that decides whether the shift can move on states the outcome in
    // words. A signed number alone leaves the operator to compare it against a
    // tolerance they had to remember; the sentence is the answer, and the figures
    // underneath are the evidence.
    final reading = _varianceReading(l, variance);
    final varianceMinor = reading.minorUnits;
    final balanced = varianceMinor == 0;
    final short = reading.short;
    final status = reading.status;
    final accent = balanced || status == l.cashVarianceWithinToleranceLabel
        ? theme.colorScheme.onSurface
        : theme.colorScheme.error;
    // Whether a manager will be asked for a PIN, said here rather than discovered
    // inside the dialog that asks for it. The movement dialog announces its own
    // threshold the same way: a rule the operator can see is a rule, and a PIN
    // nobody mentioned is a surprise.
    final approvalClause = variance['approvalRequired'] == true
        ? l.cashVarianceApprovalRequiredLabel
        : l.cashVarianceNoApprovalLabel;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.lg),
        child: cashFiguresAndTotal(
          figures: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(l.cashVarianceTitle, style: theme.textTheme.titleMedium),
              const SizedBox(height: UmiSpacing.md),
              Wrap(
                spacing: UmiSpacing.xl,
                runSpacing: UmiSpacing.sm,
                children: [
                  _Figure(
                    label: l.countedCashLabel,
                    value: _money(
                      count['countedCash']! as Map<String, Object?>,
                    ),
                  ),
                  _Figure(
                    label: l.expectedCashLabel,
                    value: _money(
                      variance['expectedCash']! as Map<String, Object?>,
                    ),
                  ),
                  _Figure(
                    label: l.cashToleranceLabel,
                    value: _money(
                      variance['tolerance']! as Map<String, Object?>,
                    ),
                    muted: true,
                  ),
                ],
              ),
            ],
          ),
          total: DecoratedBox(
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(UmiRadius.control),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: UmiSpacing.lg,
                vertical: UmiSpacing.md,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    l.cashVarianceLabel.toUpperCase(),
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.outline,
                      letterSpacing: 0.7,
                    ),
                  ),
                  const SizedBox(height: UmiSpacing.xs),
                  Text(
                    formatMinorUnits(
                      varianceMinor,
                      signed['currency'] as String? ?? 'MXN',
                    ),
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: accent,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                  const SizedBox(height: UmiSpacing.xs),
                  Text(
                    short && !balanced
                        ? '${l.cashShortageLabel} · $status · $approvalClause'
                        : '$status · $approvalClause',
                    style: theme.textTheme.bodySmall?.copyWith(color: accent),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The variance as the operator has to read it: which way it went, by how much,
/// and whether the policy's tolerance covers it.
///
/// One wording for the two places that say it — the count card and the dialog
/// that asks the operator to explain it — because a reason is chosen against the
/// sentence on screen, and two sentences for one number is one sentence too many.
({String status, bool short, int minorUnits, String currency}) _varianceReading(
  AppLocalizations l,
  Map<String, Object?>? variance,
) {
  final signed = variance?['signedVariance'] as Map<String, Object?>?;
  final minorUnits = (signed?['minorUnits'] as num?)?.toInt() ?? 0;
  final currency = signed?['currency'] as String? ?? 'MXN';
  final tolerance =
      ((variance?['tolerance'] as Map<String, Object?>?)?['minorUnits'] as num?)
          ?.toInt() ??
      0;
  final status = minorUnits == 0
      ? l.cashVarianceBalancedLabel
      : minorUnits.abs() <= tolerance
      ? l.cashVarianceWithinToleranceLabel
      : l.cashVarianceOutsideToleranceLabel;
  return (
    status: status,
    short: minorUnits < 0,
    minorUnits: minorUnits,
    currency: currency,
  );
}

/// The date at the front of a server timestamp, whatever shape it arrives in.
///
/// Postgres casts come back as `2027-09-03 00:13:57.416699+00`, ISO-8601 as
/// `2026-10-01T00:00:00.000Z`. Both lead with the day, which is the part a person
/// reads; anything else is returned untouched rather than guessed at.
String _datePart(String timestamp) {
  final match = RegExp(r'^\d{4}-\d{2}-\d{2}').firstMatch(timestamp);
  return match?.group(0) ?? timestamp;
}

/// The keyboard's cursor, made visible.
///
/// A till is operated by a finger on the counter and by a keyboard at the back
/// desk, and the two do not need the same affordance: the finger has the glass
/// under it, the keyboard has nothing but this ring. The theme's default focus is
/// a 22% overlay of the accent, which moved a tile's fill by about seven per cent
/// — measured on the real render, that is not a state, it is a rumour.
///
/// The ring is two pixels of border that appear when the control has focus and
/// drop back to the resting border when it does not: a change in *shape* that
/// survives being read by someone who cannot see the colour at all.
WidgetStateProperty<BorderSide?> _focusSide(
  ThemeData theme, {
  required bool filled,
  BorderSide resting = BorderSide.none,
}) => WidgetStateProperty.resolveWith((states) {
  if (!states.contains(WidgetState.focused)) return resting;
  return BorderSide(
    // Against the brand blue, nothing in the palette contrasts like the
    // surface's own text colour: near-white on the dark theme, near-black on
    // the light one.
    color: filled ? theme.colorScheme.onSurface : theme.colorScheme.primary,
    width: 2,
  );
});

/// This screen's controls, with the keyboard's cursor drawn on every one of them.
///
/// Material 3 draws a focus border for outlined buttons only. A filled button, a
/// text button and an icon button change on focus by an overlay alone — and the
/// theme sets that overlay to 22 % of the accent, which on this near-black ground
/// moves the fill by about seven per cent. On a counter where the operator's next
/// press spends money, "about seven per cent" is not a state.
///
/// The resting side is `none` for these three, which is exactly what Material
/// gives them, so nothing about the screen changes until a control has focus.
ThemeData _cashControls(ThemeData base) {
  final scheme = base.colorScheme;
  return base.copyWith(
    // Two clauses of the design language that the shared theme sets on the large
    // sizes only: weight 600 for titles, and 1.45–1.5 line height for
    // operational text. The card titles on this screen are `titleMedium`, and
    // the journal's detail lines, the step notes and the masked-total hint are
    // `bodySmall` — so they opt in here, where the till's own controls live.
    textTheme: base.textTheme.copyWith(
      titleMedium: base.textTheme.titleMedium?.copyWith(
        fontWeight: FontWeight.w600,
      ),
      bodySmall: base.textTheme.bodySmall?.copyWith(height: 1.45),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: (base.filledButtonTheme.style ?? const ButtonStyle()).copyWith(
        side: _focusSide(base, filled: true),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: (base.textButtonTheme.style ?? const ButtonStyle()).copyWith(
        side: _focusSide(base, filled: false),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: (base.iconButtonTheme.style ?? const ButtonStyle()).copyWith(
        side: _focusSide(base, filled: false),
      ),
    ),
    // Outlined buttons already carry a border, so theirs has to keep the resting
    // colour Material would have drawn and thicken into the ring on focus.
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: (base.outlinedButtonTheme.style ?? const ButtonStyle()).copyWith(
        side: _focusSide(
          base,
          filled: false,
          resting: BorderSide(color: scheme.outline),
        ),
      ),
    ),
  );
}

/// One paragraph of context inside a cash dialog.
///
/// A dialog that asks for a PIN without saying why trains the operator to type
/// one and stop thinking. Every dialog in this flow states the rule, the amount
/// or the consequence it is about, in one shape: an icon, a sentence, and — when
/// the action is taken against money — the same figures the screen shows.
final class _Note extends StatelessWidget {
  const _Note({
    required this.icon,
    required this.text,
    this.figures = const [],
  });

  final IconData icon;
  final String text;
  final List<Widget> figures;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(UmiRadius.control),
      ),
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.md),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, size: 18, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: UmiSpacing.sm),
                Expanded(
                  child: Text(
                    text,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            ),
            if (figures.isNotEmpty) ...[
              const SizedBox(height: UmiSpacing.md),
              Wrap(
                spacing: UmiSpacing.xl,
                runSpacing: UmiSpacing.sm,
                children: figures,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// One labelled figure in a row of figures: the name above, the money below.
final class _Figure extends StatelessWidget {
  const _Figure({required this.label, required this.value, this.muted = false});

  final String label;
  final String value;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label.toUpperCase(),
          style: theme.textTheme.labelSmall?.copyWith(
            color: theme.colorScheme.outline,
            letterSpacing: 0.7,
          ),
        ),
        const SizedBox(height: UmiSpacing.xs),
        Text(
          value,
          style: theme.textTheme.titleMedium?.copyWith(
            fontWeight: muted ? FontWeight.w500 : FontWeight.w600,
            color: muted ? theme.colorScheme.outline : null,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ],
    );
  }
}

Future<void> _noSale(BuildContext context, CashController controller) async {
  final l = AppLocalizations.of(context);
  const reasonCode = 'operator_request';
  final answer = await _cashDialog(
    context,
    title: l.managerApprovalTitle,
    confirmLabel: l.confirmAction,
    cancelLabel: l.closeAction,
    above: (context, _) => _Note(icon: Icons.history, text: l.noSaleDialogHint),
    fields: [
      CashDialogField(
        label: l.managerPinLabel,
        obscure: true,
        numeric: true,
        autofocus: true,
      ),
    ],
  );
  if (answer == null || !context.mounted) return;
  final approval = await controller.approveNoSale(
    managerPin: answer.values.first,
    reasonCode: reasonCode,
  );
  await controller.requestNoSale(
    reasonCode,
    approvalId: approval.approvalId,
    approvalFingerprint: approval.fingerprint,
  );
  // No confirmation bar: the request shows up in the drawer's own list, which is
  // where the operator is already looking.
}

Future<void> _movement(
  BuildContext context,
  CashController controller,
  String type,
) async {
  final l = AppLocalizations.of(context);
  final currency =
      controller.state.snapshot?.currentShift?['currency'] as String? ?? 'MXN';
  final threshold =
      (controller.state.snapshot?.policy['movementApprovalThreshold']
              as Map<String, Object?>?)?['minorUnits']
          as num?;
  final operation = switch (type) {
    'paid_in' => l.paidInAction,
    'paid_out' => l.paidOutAction,
    _ => l.safeDropAction,
  };
  final snapshot = controller.state.snapshot;
  final registerName = () {
    final registerId = snapshot?.currentShift?['registerId'];
    for (final register
        in snapshot?.registers ?? const <Map<String, Object?>>[]) {
      if (register['id'] == registerId) {
        return register['displayName'] as String? ?? '';
      }
    }
    return '';
  }();
  // The dialog stays up until the movement is booked or the operator walks away
  // from it.
  //
  // It used to close the moment Confirm was tapped, and everything after that —
  // the manager's PIN and the write itself — happened with nothing on screen
  // able to receive a refusal. `approveMovement` does not run inside the
  // controller's guarded operation, so a refusal from it left this function as an
  // unhandled exception: the dialog already gone, no message, the operator's
  // amount and reason discarded, and the till reading exactly like a button that
  // does nothing. A drawer that could not be topped up looked like a bug in the
  // button rather than a refusal with a reason.
  //
  // A refusal now returns to the field that caused it. The manager's PIN is asked
  // for again under its own sentence, and the amount and the reason survive every
  // attempt.
  var amountText = '';
  var reasonText = '';
  String? refusal;

  while (true) {
    // The screen can be gone by the second trip round this loop — the dialog is
    // the only thing holding the route open.
    if (!context.mounted) return;
    final String? refusalMessage = refusal;
    final answer = await _cashDialog(
      context,
      title: operation,
      confirmLabel: l.submitCashMovementAction,
      cancelLabel: l.closeAction,
      above: (context, _) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (refusalMessage != null) ...[
            InlineNotice(message: refusalMessage, tone: InlineNoticeTone.error),
            const SizedBox(height: UmiSpacing.md),
          ],
          // The amount decides whether a manager will be asked for a PIN. Saying
          // so in advance turns a surprise second dialog into a rule the operator
          // already knows — which is the difference between a till that
          // interrupts and a till that explains.
          if (threshold != null)
            _Note(
              icon: Icons.info_outline,
              text: l.cashMovementApprovalHint(
                formatMinorUnits(threshold.toInt(), currency),
              ),
            ),
        ],
      ),
      fields: [
        CashDialogField(
          label: l.cashMovementAmountLabel,
          numeric: true,
          autofocus: true,
          prefix: '$currency ',
          // An amount the parser refuses used to close the dialog and do nothing:
          // no movement, no message, the operator's typing gone. The requirement
          // is stated under the field, and the confirm waits.
          helper: l.invalidAmountMessage,
          initialValue: amountText,
          validate: (value) =>
              parseMinorUnits(value) == null ? l.invalidAmountMessage : null,
        ),
        CashDialogField(
          label: l.cashMovementReasonLabel,
          maxLength: 80,
          hint: l.cashMovementReasonHint,
          helper: l.movementReasonRequiredMessage,
          initialValue: reasonText,
          validate: (value) =>
              value.trim().isEmpty ? l.movementReasonRequiredMessage : null,
        ),
      ],
    );
    if (answer == null || !context.mounted) return;
    amountText = answer.values.first;
    reasonText = answer.values.last;
    refusal = null;
    final parsedAmount = parseMinorUnits(amountText);
    // Unreachable through the dialog — the confirm waits on the field's own
    // requirement — but the loop must not book a number nobody typed.
    if (parsedAmount == null) continue;
    final amountMinorUnits = parsedAmount;
    final reason = reasonText.trim();
    final reasonCode = reason.replaceAll(RegExp(r'\s+'), '_').toLowerCase();
    String? approvalId;
    String? actionFingerprint;

    if (controller.movementRequiresApproval(amountMinorUnits)) {
      ApprovalRefusal? pinRefusal;
      // What the drawer is expected to hold, before and after this movement:
      // money in raises it, money out and a safe drop lower it. A manager is
      // entitled to see what the authorization they are being asked for does to
      // the drawer, and the two figures are the only ones that change with it.
      final expectedRaw =
          controller.state.snapshot?.expectedCash?['expectedDrawerCash'];
      final expectedMinorUnits =
          (expectedRaw as Map<String, Object?>?)?['minorUnits'] as num?;
      final prompt = ManagerApprovalPrompt(
        operation: operation,
        amount: formatMinorUnits(amountMinorUnits, currency),
        reason: reason,
        registerName: registerName,
        expectedInDrawer: expectedMinorUnits == null
            ? null
            : formatMinorUnits(expectedMinorUnits.toInt(), currency),
        expectedAfter: expectedMinorUnits == null
            ? null
            : formatMinorUnits(
                expectedMinorUnits.toInt() +
                    (type == 'paid_in' ? amountMinorUnits : -amountMinorUnits),
                currency,
              ),
      );
      while (true) {
        if (!context.mounted) return;
        // The design language asks for the operation, the scope and the amount
        // *before* the PIN. The approval dialog carries all three, and the
        // refusal from the last attempt, over the drawer it is authorizing.
        final managerPin = await showCashApprovalDialog(
          context,
          request: prompt,
          failure: pinRefusal?.message,
          retryable: pinRefusal?.retryable ?? true,
        );
        if (managerPin == null || !context.mounted) return;
        try {
          final approval = await controller.approveMovement(
            managerPin: managerPin,
            type: type,
            amountMinorUnits: amountMinorUnits,
            reasonCode: reasonCode,
          );
          approvalId = approval.approvalId;
          actionFingerprint = approval.fingerprint;
          break;
        } on AppException catch (error) {
          // The PIN is cleared and the sentence says why. The API tells a locked
          // till apart from a credential that matched nothing, so the dialog can
          // either ask again or stop asking — never both at once.
          if (!context.mounted) return;
          pinRefusal = approvalRefusal(l, error.code);
        }
      }
    }

    // The write runs inside the controller's guarded operation, which catches
    // its own refusal and records it on the state instead of throwing. A
    // refusal there is not the end of the operator's work: the dialog comes
    // back with the amount and the reason still typed, and the sentence saying
    // what the server refused.
    await controller.movement(
      type: type,
      amountMinorUnits: amountMinorUnits,
      reasonCode: reasonCode,
      approvalId: approvalId,
      actionFingerprint: actionFingerprint,
    );
    final String? writeFailure = controller.state.errorCode;
    if (writeFailure == null) return;
    if (!context.mounted) return;
    refusal = operatorErrorMessage(context, writeFailure);
  }
}

Future<void> _handoff(
  BuildContext context,
  CashController controller,
  Future<void> Function()? onHandoffCompleted,
) async {
  final l = AppLocalizations.of(context);
  final answer = await _cashDialog(
    context,
    title: l.handoffShiftAction,
    confirmLabel: l.confirmAction,
    cancelLabel: l.closeAction,
    above: (context, _) =>
        _Note(icon: Icons.swap_horiz, text: l.handoffDialogHint),
    fields: [
      CashDialogField(
        label: l.incomingOperatorPinLabel,
        obscure: true,
        numeric: true,
        autofocus: true,
      ),
    ],
  );
  if (answer == null || !context.mounted) return;
  await controller.handoff(answer.values.first);
  await onHandoffCompleted?.call();
  if (context.mounted && Navigator.canPop(context)) {
    Navigator.pop(context);
  }
}

Future<void> _count(BuildContext context, CashController controller) async {
  final l = AppLocalizations.of(context);
  if (controller.state.count != null) {
    await controller.requestRecount();
    if (controller.state.errorCode != null) return;
    if (!context.mounted) return;
  }
  final snapshot = controller.state.snapshot;
  final currency = snapshot?.currentShift?['currency'] as String? ?? 'MXN';
  final previous = controller.state.count;
  final attempt =
      ((previous?.count['attemptNumber'] as num?)?.toInt() ?? 0) + 1;
  var tally = const DenominationTally(0, <Map<String, Object?>>[]);
  final accepted = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: Text(l.blindCountAction),
        // A teller counting on a small window gets the whole drawer. Material's
        // default 40 px inset on each side left the quantity rows 10 px wider
        // than the content box, and the dialog reported it as an overflow stripe
        // across the steppers.
        insetPadding: const EdgeInsets.symmetric(
          horizontal: UmiSpacing.md,
          vertical: UmiSpacing.lg,
        ),
        // Wide enough for the counter's two columns, so the whole drawer and its
        // total are on one screen with nothing to scroll. It used to be a
        // 420-wide box with a scroll view, which cut the small coins and the
        // running total off the bottom of the count.
        content: SizedBox(
          width: 660,
          // A short window scrolls the count instead of clipping it: eleven
          // denominations are taller than a laptop in landscape. The dialog's own
          // `scrollable: true` is not the tool here — it wraps the actions in an
          // intrinsic-width bar that overflows at phone width — so the count
          // scrolls inside the content box the dialog already bounds.
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // What the count is, before the counting starts: blind means the
                // expected amount is not on this screen, and a recount means this
                // one replaces the last. Both are facts the operator has to know
                // *before* they add up the drawer, not after they submit it.
                _Note(
                  icon: Icons.visibility_off_outlined,
                  text: previous == null
                      ? l.countDialogBlindHint
                      : l.countDialogRecountHint(attempt),
                ),
                const SizedBox(height: UmiSpacing.md),
                DenominationCounter(
                  currency: currency,
                  denominations: denominationsFromPolicy(snapshot?.policy),
                  onChanged: (value) => setState(() => tally = value),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(l.closeAction),
          ),
          FilledButton(
            onPressed: tally.totalMinorUnits <= 0
                ? null
                : () => Navigator.pop(dialogContext, true),
            child: Text(l.submitBlindCountAction),
          ),
        ],
      ),
    ),
  );
  if ((accepted ?? false) && tally.totalMinorUnits > 0) {
    await controller.submitCount(
      amountMinorUnits: tally.totalMinorUnits,
      denominations: tally.lines,
    );
  }
}

/// Undo a count that should not have happened. The dialog says what the server
/// will and will not allow, so the refusal is never a surprise.
Future<void> _cancelCount(
  BuildContext context,
  CashController controller,
) async {
  final l = AppLocalizations.of(context);
  final accepted = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l.cancelCountAction),
      content: _Note(icon: Icons.undo, text: l.cancelCountMessage),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext, false),
          child: Text(l.closeAction),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(dialogContext, true),
          child: Text(l.confirmAction),
        ),
      ],
    ),
  );
  if (accepted ?? false) {
    await controller.cancelCount();
  }
}

Future<void> _resolve(BuildContext context, CashController controller) async {
  final l = AppLocalizations.of(context);
  final approvalRequired =
      controller.state.count?.variance['approvalRequired'] as bool? ?? false;
  final variance = controller.state.count?.variance;
  final reading = _varianceReading(l, variance);
  final answer = await _cashDialog(
    context,
    title: l.varianceReasonLabel,
    confirmLabel: l.confirmAction,
    cancelLabel: l.closeAction,
    // No reason is preselected. The list is the operator's answer to a number
    // they can see above it, and the confirm button waits for that answer.
    requireChoice: true,
    above: (context, state) => Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // The operator is about to explain a number. The number is right there,
        // with the count it came from and the tolerance it broke, so the reason
        // is chosen against the fact instead of from memory.
        if (variance != null) ...[
          _Note(
            icon: reading.short ? Icons.trending_down : Icons.trending_up,
            text:
                '${l.cashVarianceLabel}: '
                '${formatMinorUnits(reading.minorUnits, reading.currency)} · '
                '${reading.status}',
            figures: [
              if (variance['countedCash']
                  case final Map<String, Object?> counted)
                _Figure(label: l.countedCashLabel, value: _money(counted)),
              if (variance['expectedCash']
                  case final Map<String, Object?> expected)
                _Figure(label: l.expectedCashLabel, value: _money(expected)),
            ],
          ),
          const SizedBox(height: UmiSpacing.md),
        ],
        DropdownButtonFormField<String>(
          initialValue: state.choice,
          decoration: InputDecoration(labelText: l.varianceReasonLabel),
          items: [
            DropdownMenuItem(
              value: 'no_variance',
              child: Text(l.varianceReasonNone),
            ),
            DropdownMenuItem(
              value: 'counting_error',
              child: Text(l.varianceReasonCounting),
            ),
            DropdownMenuItem(
              value: 'change_error',
              child: Text(l.varianceReasonChange),
            ),
            DropdownMenuItem(
              value: 'cash_handling_error',
              child: Text(l.varianceReasonHandling),
            ),
            DropdownMenuItem(
              value: 'unknown_operational_difference',
              child: Text(l.varianceReasonUnknown),
            ),
          ],
          onChanged: (value) {
            if (value != null) state.choose(value);
          },
        ),
      ],
    ),
    fields: approvalRequired
        ? [
            CashDialogField(
              label: l.managerPinLabel,
              obscure: true,
              numeric: true,
            ),
          ]
        : const [],
  );
  if (answer == null || !context.mounted) return;
  final approvalId = approvalRequired
      ? await controller.approveVariance(answer.values.first)
      : null;
  await controller.resolveVariance(
    reason: answer.choice ?? 'no_variance',
    approvalId: approvalId,
  );
}

Future<void> _close(BuildContext context, CashController controller) async {
  final l = AppLocalizations.of(context);
  final approvalRequired =
      controller.state.reconciliation?.closeApprovalRequired ?? false;
  final reconciliation = controller.state.reconciliation;
  final counted =
      reconciliation?.selectedCount['countedCash'] as Map<String, Object?>?;
  final expected =
      reconciliation?.expectedCash['expectedDrawerCash']
          as Map<String, Object?>?;
  final variance = reconciliation?.variance;
  final answer = await _cashDialog(
    context,
    title: l.confirmCloseShiftTitle,
    confirmLabel: l.closeShiftAction,
    cancelLabel: l.closeAction,
    // The last thing the operator does with this drawer. The confirmation puts
    // the three numbers the close is made of beside the sentence that says it
    // cannot be undone, so nobody confirms a shape they have not read.
    above: (context, _) => _Note(
      icon: Icons.lock_outline,
      text: [
        l.confirmCloseShiftBody,
        if (approvalRequired) l.closeDialogApprovalHint,
      ].join(' '),
      figures: [
        if (expected != null)
          _Figure(label: l.expectedCashLabel, value: _money(expected)),
        if (counted != null)
          _Figure(label: l.countedCashLabel, value: _money(counted)),
        if (variance != null)
          _Figure(
            label: l.cashVarianceLabel,
            value: _money(
              variance['signedVariance'] as Map<String, Object?>? ?? const {},
            ),
          ),
      ],
    ),
    fields: approvalRequired
        ? [
            CashDialogField(
              label: l.managerPinLabel,
              obscure: true,
              numeric: true,
            ),
          ]
        : const [],
  );
  if (answer == null || !context.mounted) return;
  final approvalId = approvalRequired
      ? await controller.approveClose(answer.values.first)
      : null;
  await controller.closeShiftWithApproval(approvalId: approvalId);
}

/// One field in a cash dialog.
final class CashDialogField {
  const CashDialogField({
    required this.label,
    this.obscure = false,
    this.numeric = false,
    this.autofocus = false,
    this.maxLength,
    this.initialValue = '',
    this.prefix,
    this.hint,
    this.helper,
    this.validate,
  });

  final String label;
  final bool obscure;
  final bool numeric;
  final bool autofocus;
  final int? maxLength;
  final String initialValue;

  /// Shown inside the field before the value. A money field says the currency, so
  /// "50" is never a number the operator has to guess the unit of.
  final String? prefix;

  /// An example of what belongs in the field.
  final String? hint;

  /// The requirement, stated under the field before anything is wrong with it.
  /// Without it a disabled confirm button is a dead end: the operator can see
  /// that the dialog will not accept the form, and cannot see what it wants.
  final String? helper;

  /// What is wrong with the current value, or null when nothing is. The dialog
  /// refuses to confirm while any field has something to say, and shows it under
  /// the field — which is the difference between a form that explains itself and
  /// one that closes and does nothing.
  final String? Function(String value)? validate;
}

/// The dialog's own state, for a control beside the fields.
///
/// The variance reason list needs a selection that lives exactly as long as the
/// dialog does. It used to borrow the screen's `setState` through a
/// `StatefulBuilder`, which worked until the dialog outlived the screen.
final class CashDialogState extends ChangeNotifier {
  CashDialogState(this.choice);

  String? choice;

  void choose(String value) {
    if (choice == value) return;
    choice = value;
    notifyListeners();
  }
}

/// A dialog that owns the text fields it shows.
///
/// The screen used to create a controller, await the dialog, then dispose the
/// controller on the next line — while the route is still animating out. The
/// field rebuilds into a disposed controller: "A TextEditingController was used
/// after being disposed". On the terminal that exception took the whole widget
/// tree down with it — duplicate GlobalKeys, a broken overlay layout, and a
/// window that never mapped (measured on the native client, 2026-09-30).
///
/// A StatefulWidget owns the lifetime that matches the dialog's own, so the
/// controller cannot outlive the field that reads it.
final class CashFieldsDialog extends StatefulWidget {
  const CashFieldsDialog({
    required this.title,
    required this.confirmLabel,
    required this.cancelLabel,
    this.fields = const [],
    this.above,
    this.initialChoice,
    this.requireChoice = false,
    super.key,
  });

  final String title;
  final String confirmLabel;
  final String cancelLabel;
  final List<CashDialogField> fields;

  /// A widget above the fields. It reads the dialog's own state, which is how
  /// the reason list keeps its selection.
  final Widget Function(BuildContext context, CashDialogState state)? above;
  final String? initialChoice;

  /// True when the dialog may not be confirmed until its list has an answer.
  /// A reason picked for the operator is a reason nobody chose: the variance
  /// dialog used to open with "Sin diferencia" already selected over a shortage
  /// of 1.50, so the fastest path through it was to confirm a contradiction.
  final bool requireChoice;

  @override
  State<CashFieldsDialog> createState() => _CashFieldsDialogState();
}

final class _CashFieldsDialogState extends State<CashFieldsDialog> {
  late final List<TextEditingController> _controllers = [
    for (final field in widget.fields)
      TextEditingController(text: field.initialValue),
  ];
  late final CashDialogState _state = CashDialogState(widget.initialChoice);

  @override
  void dispose() {
    for (final controller in _controllers) {
      controller.dispose();
    }
    _state.dispose();
    super.dispose();
  }

  void _submit() => Navigator.pop(context, (
    choice: _state.choice,
    values: [for (final controller in _controllers) controller.text],
  ));

  /// Which fields the operator has typed in. A field that has never been touched
  /// states its requirement quietly; only a field they have used, or left a bad
  /// value in, turns its requirement red.
  final Set<int> _touched = <int>{};

  String? _rawErrorAt(int index) =>
      widget.fields[index].validate?.call(_controllers[index].text);

  /// Whether the dialog may be confirmed at all: every field that has a
  /// requirement must satisfy it, whether or not the operator has touched it yet.
  bool get _valid => [
    for (var index = 0; index < widget.fields.length; index++)
      _rawErrorAt(index),
  ].every((error) => error == null);

  /// What to *show* under a field: nothing for a requirement the operator has not
  /// met yet on a field they have not used, and the error once they have.
  String? _errorAt(int index) {
    final error = _rawErrorAt(index);
    if (error == null) return null;
    final used =
        _touched.contains(index) || _controllers[index].text.isNotEmpty;
    return used ? error : null;
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    // One listener for the whole dialog, so the confirm button can go quiet
    // while the list has no answer or a field has nothing usable in it, and wake
    // up when either changes.
    listenable: Listenable.merge([_state, ..._controllers]),
    builder: (context, _) => AlertDialog(
      title: Text(widget.title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (widget.above != null) ...[
              widget.above!(context, _state),
              if (widget.fields.isNotEmpty)
                const SizedBox(height: UmiSpacing.md),
            ],
            for (final (index, field) in widget.fields.indexed) ...[
              if (index > 0) const SizedBox(height: UmiSpacing.md),
              TextField(
                controller: _controllers[index],
                autofocus: field.autofocus,
                obscureText: field.obscure,
                maxLength: field.maxLength,
                keyboardType: field.numeric
                    ? TextInputType.number
                    : TextInputType.text,
                onChanged: (_) {
                  if (_touched.add(index)) setState(() {});
                },
                decoration: InputDecoration(
                  labelText: field.label,
                  prefixText: field.prefix,
                  hintText: field.hint,
                  helperText: field.helper,
                  errorText: _errorAt(index),
                ),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(widget.cancelLabel),
        ),
        FilledButton(
          onPressed: (widget.requireChoice && _state.choice == null) || !_valid
              ? null
              : _submit,
          child: Text(widget.confirmLabel),
        ),
      ],
    ),
  );
}

Future<({String? choice, List<String> values})?> _cashDialog(
  BuildContext context, {
  required String title,
  required String confirmLabel,
  required String cancelLabel,
  List<CashDialogField> fields = const [],
  Widget Function(BuildContext context, CashDialogState state)? above,
  String? initialChoice,
  bool requireChoice = false,
}) => showDialog<({String? choice, List<String> values})>(
  context: context,
  builder: (_) => CashFieldsDialog(
    title: title,
    confirmLabel: confirmLabel,
    cancelLabel: cancelLabel,
    fields: fields,
    requireChoice: requireChoice,
    above: above,
    initialChoice: initialChoice,
  ),
);

String _money(Map<String, Object?> value) {
  final currency = value['currency'] as String? ?? '';
  final minor = (value['minorUnits'] as num?)?.toInt() ?? 0;
  // One money format for the whole screen. The division happens once, inside
  // `formatMinorUnits`, which also keeps the grouped thousands and the true minus
  // sign that the equation and the journal already use.
  return formatMinorUnits(minor, currency);
}
