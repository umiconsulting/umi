import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/security/operator_permissions.dart';
import '../../core/theme/umi_theme.dart';
import '../../shared/widgets/inline_notice.dart';
import 'cash_controller.dart';
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
  /// The last failed cash operation, shown inline. It used to be a bar that
  /// slid up from the bottom, which in this screen landed over the denomination
  /// keypad the operator is mid-way through counting.
  String? _notice;

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
    final error = widget.controller.state.errorCode;
    if (error != null) {
      _notice = AppLocalizations.of(context).cashOperationFailedMessage;
    } else {
      _notice = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final state = widget.controller.state;
    final snapshot = state.snapshot;
    return Scaffold(
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
              if (_notice != null) ...[
                InlineNotice(message: _notice!),
                const SizedBox(height: UmiSpacing.md),
              ],
              if (state.busy) ...[
                const LinearProgressIndicator(),
                const SizedBox(height: UmiSpacing.md),
              ],
              Expanded(
                child: snapshot == null
                    ? (state.busy
                          ? const Center(child: CircularProgressIndicator())
                          : _CashUnavailable(onRetry: widget.controller.load))
                    : Semantics(
                        liveRegion: true,
                        label: _statusLabel(
                          l,
                          snapshot.currentShift?['status'] as String?,
                        ),
                        child: _ready(context, l, snapshot),
                      ),
              ),
            ],
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
        title: snapshot.currentShift == null
            ? l.shiftRequiredMessage
            : _statusLabel(l, snapshot.currentShift!['status'] as String?),
        register: _registerName(snapshot),
        businessDate: snapshot.businessDate,
        openedAt: snapshot.currentShift?['openedAt'] as String?,
      ),
      if (snapshot.summary != null) ...[
        const SizedBox(height: UmiSpacing.md),
        _ClosedSummaryCard(summary: snapshot.summary!),
      ],
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
  );

  Widget _main(CashCenterSnapshot snapshot) {
    if (snapshot.adoptableShift != null) {
      return _centred(
        _AdoptShiftSection(
          controller: widget.controller,
          permissions: widget.permissions,
        ),
      );
    }
    if (snapshot.currentShift == null) {
      return _centred(
        _OpenShiftSection(
          controller: widget.controller,
          permissions: widget.permissions,
          registers: snapshot.registers,
        ),
      );
    }
    return _ActiveShiftSection(
      controller: widget.controller,
      permissions: widget.permissions,
      onHandoffCompleted: widget.onHandoffCompleted,
    );
  }

  /// A short section reads as a panel, not as a band stretched across a 1920
  /// screen: the open and adopt forms keep a comfortable width in the middle.
  /// The scroll view here is a guard for the denomination counter only, which
  /// grows with the policy's coin list; nothing else on this screen needs it.
  Widget _centred(Widget child) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 720),
      child: SingleChildScrollView(child: child),
    ),
  );

  String _registerName(CashCenterSnapshot snapshot) {
    final shift = snapshot.currentShift;
    if (shift == null) return '';
    final registerId = shift['registerId'];
    for (final register in snapshot.registers) {
      if (register['id'] == registerId) {
        return register['displayName'] as String? ?? '';
      }
    }
    return '';
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
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.error_outline,
              size: 32,
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: UmiSpacing.md),
            Text(
              l.cashOperationFailedMessage,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            const SizedBox(height: UmiSpacing.md),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: Text(l.retryAction),
              style: FilledButton.styleFrom(
                minimumSize: const Size(0, UmiTouchTarget.minimum),
              ),
            ),
          ],
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
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              liveRegion: true,
              child: Text(
                l.shiftClosedMessage,
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            const SizedBox(height: UmiSpacing.sm),
            Text(
              '${l.expectedCashLabel}: ${_money((summary['expectedCash'] as Map<String, Object?>?)?['expectedDrawerCash'] as Map<String, Object?>? ?? const {})}',
            ),
            Text(
              '${l.countedCashLabel}: ${_money(summary['countedCash'] as Map<String, Object?>? ?? const {})}',
            ),
            Text(
              '${l.cashVarianceLabel}: ${_money(summary['variance'] as Map<String, Object?>? ?? const {})}',
            ),
          ],
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
  });

  final String title;
  final String register;
  final String businessDate;
  final String? openedAt;

  /// How long the shift has been open, read from `openedAt` (audit F4). The
  /// screen used to show no drawer state at all.
  String? _openFor(BuildContext context) {
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
    final openFor = _openFor(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.lg),
        child: Wrap(
          spacing: UmiSpacing.xl,
          runSpacing: UmiSpacing.sm,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Icon(
              Icons.point_of_sale,
              color: Theme.of(context).colorScheme.primary,
            ),
            Text(title, style: Theme.of(context).textTheme.headlineSmall),
            if (register.isNotEmpty) Text(register),
            Text(businessDate),
            if (openFor != null)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.schedule,
                    size: 18,
                    color: Theme.of(context).colorScheme.outline,
                  ),
                  const SizedBox(width: UmiSpacing.xs),
                  Text(openFor),
                ],
              ),
          ],
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
    final state = controller.state;
    final canAdopt =
        permissions.allows('cash.shift.resume') &&
        (state.snapshot?.allowedActions.contains('adopt_shift') ?? false);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l.adoptShiftTitle,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: UmiSpacing.sm),
            Text(l.adoptShiftMessage),
            const SizedBox(height: UmiSpacing.lg),
            FilledButton(
              onPressed: state.busy || !canAdopt
                  ? null
                  : () => controller.adoptShift(),
              child: Text(l.adoptShiftAction),
            ),
          ],
        ),
      ),
    );
  }
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
              style: Theme.of(context).textTheme.titleLarge,
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
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l.shiftRequiredMessage,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: UmiSpacing.md),
            DropdownButtonFormField<String>(
              initialValue: selectedRegister,
              decoration: InputDecoration(labelText: l.registerAssignedLabel),
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
            const SizedBox(height: UmiSpacing.md),
            Text(
              l.openingFloatLabel,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: UmiSpacing.sm),
            DenominationCounter(
              key: ValueKey(currency),
              currency: currency,
              denominations: denominationsFromPolicy(policy),
              onChanged: (value) => setState(() => floatTally = value),
            ),
            const SizedBox(height: UmiSpacing.lg),
            FilledButton.icon(
              onPressed:
                  selectedRegister == null ||
                      widget.controller.state.busy ||
                      !canOpen ||
                      (floatRequired && floatTally.totalMinorUnits <= 0)
                  ? null
                  : () => widget.controller.openShift(
                      registerId: selectedRegister!,
                      amountMinorUnits: floatTally.totalMinorUnits,
                      denominations: floatTally.lines,
                    ),
              icon: const Icon(Icons.lock_open),
              label: Text(l.openShiftAction),
            ),
          ],
        ),
      ),
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
    final closed = state.closeResult != null;
    final canCount =
        actions.contains('count') &&
        permissions.allows(
          count == null ? 'cash.count.submit' : 'cash.count.recount',
        );
    final canResolve =
        countDone &&
        state.resolution == null &&
        permissions.allows('cash.reconcile');
    final canReconcile =
        !reconcileDone &&
        actions.contains('reconcile') &&
        permissions.allows('cash.reconcile') &&
        resolveDone;
    final canClose =
        reconcileDone &&
        actions.contains('close') &&
        permissions.allows('cash.shift.close');
    final showCloseFlow = canCount || countDone || reconcileDone;

    final drawer = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (snapshot.expectedCash != null) ...[
          _MoneyCard(
            label: l.expectedCashLabel,
            money:
                snapshot.expectedCash!['expectedDrawerCash']
                    as Map<String, Object?>,
          ),
          const SizedBox(height: UmiSpacing.md),
        ],
        if (count != null) ...[
          _VarianceCard(variance: variance!, count: count.count),
          const SizedBox(height: UmiSpacing.md),
        ],
        if (operations.isNotEmpty) ...[
          Text(
            spanish ? 'Movimientos de caja' : 'Cash movements',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: UmiSpacing.sm),
          _ActionGrid(actions: operations),
        ],
        if (lifecycle.isNotEmpty) ...[
          if (operations.isNotEmpty) const SizedBox(height: UmiSpacing.md),
          Text(
            spanish ? 'Turno' : 'Shift',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: UmiSpacing.sm),
          _ActionGrid(actions: lifecycle),
        ],
        if (state.closeResult != null) ...[
          const SizedBox(height: UmiSpacing.md),
          Semantics(
            liveRegion: true,
            child: Text(
              l.shiftClosedMessage,
              style: Theme.of(context).textTheme.titleLarge,
            ),
          ),
        ],
      ],
    );

    // Nothing to close yet: the drawer panel is the whole screen, held to a
    // readable width rather than stretching two tiles across the full span.
    if (!showCloseFlow) {
      return Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 900),
          child: SingleChildScrollView(child: drawer),
        ),
      );
    }

    final close = Card(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              spanish ? 'Cierre de turno' : 'Shift close',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: UmiSpacing.md),
            _CloseStep(
              number: 1,
              label: spanish ? 'Contar la caja' : 'Count the drawer',
              done: countDone,
              current: !countDone,
              action: canCount && !countDone
                  ? _StepAction(
                      label: l.blindCountAction,
                      onPressed: () => _count(context, controller),
                    )
                  : null,
              secondary: countDone && canCount
                  ? _StepAction(
                      label: l.recountAction,
                      onPressed: () => _count(context, controller),
                    )
                  : null,
            ),
            _CloseStep(
              number: 2,
              label: spanish
                  ? 'Registrar la diferencia'
                  : 'Record the variance',
              done: resolveDone,
              current: countDone && !resolveDone,
              skipped: countDone && varianceZero,
              skippedLabel: spanish ? 'Sin diferencia' : 'No variance',
              action: canResolve && resolveNeeded
                  ? _StepAction(
                      label: l.varianceReasonLabel,
                      onPressed: () => _resolve(context, controller),
                    )
                  : null,
            ),
            _CloseStep(
              number: 3,
              label: spanish ? 'Conciliar el turno' : 'Reconcile the shift',
              done: reconcileDone,
              current: resolveDone && !reconcileDone,
              action: canReconcile
                  ? _StepAction(
                      label: l.reconcileShiftAction,
                      onPressed: controller.reconcile,
                    )
                  : null,
            ),
            _CloseStep(
              number: 4,
              label: l.closeShiftAction,
              done: closed,
              current: reconcileDone && !closed,
              action: canClose
                  ? _StepAction(
                      label: l.closeShiftAction,
                      primary: true,
                      onPressed: () => _close(context, controller),
                    )
                  : null,
            ),
          ],
        ),
      ),
    );

    // Two panels side by side when there is room for both, one column when
    // there is not. Below this width the two columns are narrower than the
    // controls they hold - at 800 px the action tiles ran past their own labels
    // - and a single scrolling column is the honest answer rather than a
    // squeezed one. The counter terminal this was designed for is 1280 wide,
    // where the panels fit with room to spare.
    return LayoutBuilder(
      builder: (context, constraints) => constraints.maxWidth >= 1000
          ? Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: SingleChildScrollView(child: drawer)),
                const SizedBox(width: UmiSpacing.lg),
                Expanded(child: SingleChildScrollView(child: close)),
              ],
            )
          : SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  drawer,
                  const SizedBox(height: UmiSpacing.lg),
                  close,
                ],
              ),
            ),
    );
  }
}

/// One step in the numbered close flow (audit F5).
class _StepAction {
  const _StepAction({
    required this.label,
    required this.onPressed,
    this.primary = false,
  });

  final String label;
  final VoidCallback onPressed;
  final bool primary;
}

final class _CloseStep extends StatelessWidget {
  const _CloseStep({
    required this.number,
    required this.label,
    required this.done,
    required this.current,
    this.action,
    this.secondary,
    this.skipped = false,
    this.skippedLabel,
  });

  final int number;
  final String label;
  final bool done;
  final bool current;
  final _StepAction? action;
  final _StepAction? secondary;
  final bool skipped;
  final String? skippedLabel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final complete = done || skipped;
    final active = complete || current;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UmiSpacing.xs),
      child: Row(
        children: [
          CircleAvatar(
            radius: 16,
            backgroundColor: active
                ? scheme.primary
                : scheme.surfaceContainerHighest,
            child: complete
                ? Icon(Icons.check, size: 18, color: scheme.onPrimary)
                : Text(
                    '$number',
                    style: TextStyle(
                      color: current
                          ? scheme.onPrimary
                          : scheme.onSurfaceVariant,
                      fontWeight: FontWeight.w700,
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
                if (skipped && skippedLabel != null)
                  Text(
                    skippedLabel!,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.outline,
                    ),
                  ),
              ],
            ),
          ),
          if (action != null)
            action!.primary
                ? FilledButton(
                    onPressed: action!.onPressed,
                    child: Text(action!.label),
                  )
                : FilledButton.tonal(
                    onPressed: action!.onPressed,
                    child: Text(action!.label),
                  )
          else if (secondary != null)
            OutlinedButton(
              onPressed: secondary!.onPressed,
              child: Text(secondary!.label),
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
      return Wrap(
        spacing: gap,
        runSpacing: gap,
        children: [
          for (final action in actions) SizedBox(width: width, child: action),
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
  Widget build(BuildContext context) => SizedBox(
    height: 48,
    child: OutlinedButton.icon(
      onPressed: onPressed,
      icon: Icon(icon),
      label: Text(label),
    ),
  );
}

final class _MoneyCard extends StatelessWidget {
  const _MoneyCard({required this.label, required this.money});

  final String label;
  final Map<String, Object?> money;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(UmiSpacing.lg),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label),
          Text(_money(money), style: Theme.of(context).textTheme.headlineSmall),
        ],
      ),
    ),
  );
}

final class _VarianceCard extends StatelessWidget {
  const _VarianceCard({required this.variance, required this.count});

  final Map<String, Object?> variance;
  final Map<String, Object?> count;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final signed = variance['signedVariance']! as Map<String, Object?>;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.lg),
        child: Wrap(
          spacing: UmiSpacing.xl,
          runSpacing: UmiSpacing.sm,
          children: [
            Text(
              '${l.countedCashLabel}: ${_money(count['countedCash']! as Map<String, Object?>)}',
            ),
            Text(
              '${l.expectedCashLabel}: ${_money(variance['expectedCash']! as Map<String, Object?>)}',
            ),
            Text('${l.cashVarianceLabel}: ${_money(signed)}'),
            Text(
              '${l.cashToleranceLabel}: ${_money(variance['tolerance']! as Map<String, Object?>)}',
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> _noSale(BuildContext context, CashController controller) async {
  final l = AppLocalizations.of(context);
  const reasonCode = 'operator_request';
  final managerPin = TextEditingController();
  final accepted = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l.managerApprovalTitle),
      content: TextField(
        controller: managerPin,
        autofocus: true,
        obscureText: true,
        keyboardType: TextInputType.number,
        decoration: InputDecoration(labelText: l.managerPinLabel),
      ),
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
  if (!(accepted ?? false)) {
    managerPin.dispose();
    return;
  }
  final approval = await controller.approveNoSale(
    managerPin: managerPin.text,
    reasonCode: reasonCode,
  );
  managerPin.clear();
  managerPin.dispose();
  await controller.requestNoSale(
    reasonCode,
    approvalId: approval.approvalId,
    approvalFingerprint: approval.fingerprint,
  );
  if (context.mounted) {
    // No confirmation bar: the request shows up in the drawer's own list, which
    // is where the operator is already looking.
  }
}

Future<void> _movement(
  BuildContext context,
  CashController controller,
  String type,
) async {
  final l = AppLocalizations.of(context);
  final amount = TextEditingController();
  final reason = TextEditingController();
  final accepted = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(switch (type) {
        'paid_in' => l.paidInAction,
        'paid_out' => l.paidOutAction,
        _ => l.safeDropAction,
      }),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: amount,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: InputDecoration(labelText: l.cashMovementAmountLabel),
            ),
            const SizedBox(height: UmiSpacing.md),
            TextField(
              controller: reason,
              maxLength: 80,
              decoration: InputDecoration(labelText: l.cashMovementReasonLabel),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext, false),
          child: Text(l.closeAction),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(dialogContext, true),
          child: Text(l.submitCashMovementAction),
        ),
      ],
    ),
  );
  if (!context.mounted) {
    amount.dispose();
    reason.dispose();
    return;
  }
  final parsedAmount = parseMinorUnits(amount.text);
  if ((accepted ?? false) &&
      reason.text.trim().isNotEmpty &&
      parsedAmount != null) {
    final amountMinorUnits = parsedAmount;
    final reasonCode = reason.text
        .trim()
        .replaceAll(RegExp(r'\s+'), '_')
        .toLowerCase();
    String? approvalId;
    String? actionFingerprint;
    if (controller.movementRequiresApproval(amountMinorUnits)) {
      final managerPin = TextEditingController();
      final approvalAccepted = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(l.managerApprovalTitle),
          content: TextField(
            controller: managerPin,
            autofocus: true,
            obscureText: true,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: l.managerPinLabel),
          ),
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
      if (!(approvalAccepted ?? false)) {
        managerPin.dispose();
        amount.dispose();
        reason.dispose();
        return;
      }
      final approval = await controller.approveMovement(
        managerPin: managerPin.text,
        type: type,
        amountMinorUnits: amountMinorUnits,
        reasonCode: reasonCode,
      );
      approvalId = approval.approvalId;
      actionFingerprint = approval.fingerprint;
      managerPin.clear();
      managerPin.dispose();
    }
    await controller.movement(
      type: type,
      amountMinorUnits: amountMinorUnits,
      reasonCode: reasonCode,
      approvalId: approvalId,
      actionFingerprint: actionFingerprint,
    );
  }
  amount.dispose();
  reason.dispose();
}

Future<void> _handoff(
  BuildContext context,
  CashController controller,
  Future<void> Function()? onHandoffCompleted,
) async {
  final l = AppLocalizations.of(context);
  final pin = TextEditingController();
  final accepted = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l.handoffShiftAction),
      content: TextField(
        controller: pin,
        autofocus: true,
        obscureText: true,
        keyboardType: TextInputType.number,
        decoration: InputDecoration(labelText: l.incomingOperatorPinLabel),
      ),
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
    await controller.handoff(pin.text);
    await onHandoffCompleted?.call();
    if (context.mounted && Navigator.canPop(context)) {
      Navigator.pop(context);
    }
  }
  pin.clear();
  pin.dispose();
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
  var tally = const DenominationTally(0, <Map<String, Object?>>[]);
  final accepted = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: Text(l.blindCountAction),
        // Wide enough for the counter's two columns, so the whole drawer and its
        // total are on one screen with nothing to scroll. It used to be a
        // 420-wide box with a scroll view, which cut the small coins and the
        // running total off the bottom of the count.
        content: SizedBox(
          width: 660,
          child: DenominationCounter(
            currency: currency,
            denominations: denominationsFromPolicy(snapshot?.policy),
            onChanged: (value) => setState(() => tally = value),
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

Future<void> _resolve(BuildContext context, CashController controller) async {
  final l = AppLocalizations.of(context);
  String reason = 'no_variance';
  final approvalRequired =
      controller.state.count?.variance['approvalRequired'] as bool? ?? false;
  final managerPin = TextEditingController();
  final accepted = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: Text(l.varianceReasonLabel),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: reason,
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
                onChanged: (value) => setState(() => reason = value ?? reason),
              ),
              if (approvalRequired) ...[
                const SizedBox(height: UmiSpacing.md),
                TextField(
                  controller: managerPin,
                  obscureText: true,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(labelText: l.managerPinLabel),
                ),
              ],
            ],
          ),
        ),
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
    ),
  );
  if (accepted ?? false) {
    final approvalId = approvalRequired
        ? await controller.approveVariance(managerPin.text)
        : null;
    await controller.resolveVariance(reason: reason, approvalId: approvalId);
  }
  managerPin.clear();
  managerPin.dispose();
}

Future<void> _close(BuildContext context, CashController controller) async {
  final l = AppLocalizations.of(context);
  final approvalRequired =
      controller.state.reconciliation?.closeApprovalRequired ?? false;
  final managerPin = TextEditingController();
  final accepted = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l.confirmCloseShiftTitle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(l.confirmCloseShiftBody),
          if (approvalRequired) ...[
            const SizedBox(height: UmiSpacing.md),
            TextField(
              controller: managerPin,
              obscureText: true,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(labelText: l.managerPinLabel),
            ),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext, false),
          child: Text(l.closeAction),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(dialogContext, true),
          child: Text(l.closeShiftAction),
        ),
      ],
    ),
  );
  try {
    if (accepted ?? false) {
      final approvalId = approvalRequired
          ? await controller.approveClose(managerPin.text)
          : null;
      await controller.closeShiftWithApproval(approvalId: approvalId);
    }
  } finally {
    managerPin.dispose();
  }
}

String _money(Map<String, Object?> value) {
  final currency = value['currency'] as String? ?? '';
  final minor = (value['minorUnits'] as num?)?.toInt() ?? 0;
  return '$currency ${(minor / 100).toStringAsFixed(2)}';
}
