import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/security/operator_permissions.dart';
import '../../core/theme/umi_theme.dart';
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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppLocalizations.of(context).cashOperationFailedMessage,
          ),
        ),
      );
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
        child: snapshot == null
            ? const Center(child: CircularProgressIndicator())
            : Semantics(
                liveRegion: true,
                label: _statusLabel(
                  l,
                  snapshot.currentShift?['status'] as String?,
                ),
                child: LayoutBuilder(
                  builder: (context, constraints) => SingleChildScrollView(
                    padding: const EdgeInsets.all(UmiSpacing.lg),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 1040),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _StatusCard(
                              title: snapshot.currentShift == null
                                  ? l.shiftRequiredMessage
                                  : _statusLabel(
                                      l,
                                      snapshot.currentShift!['status']
                                          as String?,
                                    ),
                              register: _registerName(snapshot),
                              businessDate: snapshot.businessDate,
                              openedAt:
                                  snapshot.currentShift?['openedAt'] as String?,
                            ),
                            const SizedBox(height: UmiSpacing.lg),
                            if (snapshot.summary != null) ...[
                              _ClosedSummaryCard(summary: snapshot.summary!),
                              const SizedBox(height: UmiSpacing.lg),
                            ],
                            if (snapshot.adoptableShift != null)
                              _AdoptShiftSection(
                                controller: widget.controller,
                                permissions: widget.permissions,
                              )
                            else if (snapshot.currentShift == null)
                              _OpenShiftSection(
                                controller: widget.controller,
                                permissions: widget.permissions,
                                registers: snapshot.registers,
                              )
                            else
                              _ActiveShiftSection(
                                controller: widget.controller,
                                permissions: widget.permissions,
                                onHandoffCompleted: widget.onHandoffCompleted,
                              ),
                            if (state.busy) ...[
                              const SizedBox(height: UmiSpacing.md),
                              const LinearProgressIndicator(),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
      ),
    );
  }

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

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (snapshot.expectedCash != null)
          _MoneyCard(
            label: l.expectedCashLabel,
            money:
                snapshot.expectedCash!['expectedDrawerCash']
                    as Map<String, Object?>,
          ),
        if (count != null) ...[
          const SizedBox(height: UmiSpacing.md),
          _VarianceCard(variance: variance!, count: count.count),
        ],
        if (operations.isNotEmpty) ...[
          const SizedBox(height: UmiSpacing.lg),
          Text(
            spanish ? 'Movimientos de caja' : 'Cash movements',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: UmiSpacing.sm),
          Wrap(
            spacing: UmiSpacing.sm,
            runSpacing: UmiSpacing.sm,
            children: operations,
          ),
        ],
        if (lifecycle.isNotEmpty) ...[
          const SizedBox(height: UmiSpacing.lg),
          Text(
            spanish ? 'Turno' : 'Shift',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: UmiSpacing.sm),
          Wrap(
            spacing: UmiSpacing.sm,
            runSpacing: UmiSpacing.sm,
            children: lifecycle,
          ),
        ],
        if (showCloseFlow) ...[
          const SizedBox(height: UmiSpacing.lg),
          Card(
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
                    label: spanish
                        ? 'Conciliar el turno'
                        : 'Reconcile the shift',
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
          ),
        ],
        if (state.closeResult != null) ...[
          const SizedBox(height: UmiSpacing.lg),
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
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(l.drawerRequestRecordedMessage)));
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
        content: SizedBox(
          width: 420,
          child: SingleChildScrollView(
            child: DenominationCounter(
              currency: currency,
              denominations: denominationsFromPolicy(snapshot?.policy),
              onChanged: (value) => setState(() => tally = value),
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
