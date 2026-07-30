import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import 'cash_controller.dart';

Future<void> showCashCenter(
  BuildContext context, {
  required CashController controller,
  Future<void> Function()? onHandoffCompleted,
}) => showDialog<void>(
  context: context,
  builder: (_) => Dialog.fullscreen(
    child: CashCenter(
      controller: controller,
      onHandoffCompleted: onHandoffCompleted,
    ),
  ),
);

final class CashCenter extends StatefulWidget {
  const CashCenter({
    required this.controller,
    this.onHandoffCompleted,
    super.key,
  });

  final CashController controller;
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
                            ),
                            const SizedBox(height: UmiSpacing.lg),
                            if (snapshot.summary != null) ...[
                              _ClosedSummaryCard(summary: snapshot.summary!),
                              const SizedBox(height: UmiSpacing.lg),
                            ],
                            if (snapshot.currentShift == null)
                              _OpenShiftSection(
                                controller: widget.controller,
                                registers: snapshot.registers,
                              )
                            else
                              _ActiveShiftSection(
                                controller: widget.controller,
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
  });

  final String title;
  final String register;
  final String businessDate;

  @override
  Widget build(BuildContext context) => Card(
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
        ],
      ),
    ),
  );
}

final class _OpenShiftSection extends StatefulWidget {
  const _OpenShiftSection({required this.controller, required this.registers});

  final CashController controller;
  final List<Map<String, Object?>> registers;

  @override
  State<_OpenShiftSection> createState() => _OpenShiftSectionState();
}

final class _OpenShiftSectionState extends State<_OpenShiftSection> {
  final amount = TextEditingController(text: '0.00');
  String? selectedRegister;

  @override
  void initState() {
    super.initState();
    if (widget.registers.isNotEmpty) {
      selectedRegister = widget.registers.first['id'] as String?;
    }
  }

  @override
  void dispose() {
    amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final canOpen =
        widget.controller.state.snapshot?.allowedActions.contains(
          'open_shift',
        ) ??
        false;
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
            TextField(
              controller: amount,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              textInputAction: TextInputAction.done,
              decoration: InputDecoration(
                labelText: l.openingFloatLabel,
                prefixText: 'MXN ',
              ),
            ),
            const SizedBox(height: UmiSpacing.lg),
            FilledButton.icon(
              onPressed:
                  selectedRegister == null ||
                      widget.controller.state.busy ||
                      !canOpen
                  ? null
                  : () => widget.controller.openShift(
                      registerId: selectedRegister!,
                      amountMinorUnits: _minorUnits(amount.text),
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
    required this.onHandoffCompleted,
  });

  final CashController controller;
  final Future<void> Function()? onHandoffCompleted;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final state = controller.state;
    final snapshot = state.snapshot!;
    final actions = snapshot.allowedActions;
    final count = state.count;
    final variance = count?.variance;
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
        const SizedBox(height: UmiSpacing.lg),
        Text(l.cashCenterTitle, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: UmiSpacing.sm),
        Wrap(
          spacing: UmiSpacing.sm,
          runSpacing: UmiSpacing.sm,
          children: [
            if (actions.contains('movement')) ...[
              _Action(
                icon: Icons.add_circle_outline,
                label: l.paidInAction,
                onPressed: () => _movement(context, controller, 'paid_in'),
              ),
              _Action(
                icon: Icons.remove_circle_outline,
                label: l.paidOutAction,
                onPressed: () => _movement(context, controller, 'paid_out'),
              ),
              _Action(
                icon: Icons.savings_outlined,
                label: l.safeDropAction,
                onPressed: () => _movement(context, controller, 'safe_drop'),
              ),
            ],
            if (actions.contains('suspend'))
              _Action(
                icon: Icons.pause_circle_outline,
                label: l.suspendShiftAction,
                onPressed: () => controller.suspendOrResume(suspend: true),
              ),
            if (actions.contains('handoff'))
              _Action(
                icon: Icons.swap_horiz,
                label: l.handoffShiftAction,
                onPressed: () =>
                    _handoff(context, controller, onHandoffCompleted),
              ),
            if (actions.contains('no_sale'))
              _Action(
                icon: Icons.point_of_sale_outlined,
                label: l.noSaleDrawerAction,
                onPressed: () async {
                  await controller.requestNoSale('operator_request');
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(l.drawerRequestRecordedMessage)),
                    );
                  }
                },
              ),
            if (actions.contains('resume'))
              _Action(
                icon: Icons.play_circle_outline,
                label: l.resumeShiftAction,
                onPressed: () => controller.suspendOrResume(suspend: false),
              ),
            if (actions.contains('count'))
              _Action(
                icon: Icons.calculate_outlined,
                label: count == null ? l.blindCountAction : l.recountAction,
                onPressed: () => _count(context, controller),
              ),
            if (count != null && state.resolution == null)
              _Action(
                icon: Icons.rule,
                label: l.varianceReasonLabel,
                onPressed: () => _resolve(context, controller),
              ),
            if (state.reconciliation == null &&
                actions.contains('reconcile') &&
                (state.resolution != null ||
                    (variance?['signedVariance']
                            as Map<String, Object?>?)?['minorUnits'] ==
                        0))
              _Action(
                icon: Icons.balance,
                label: l.reconcileShiftAction,
                onPressed: controller.reconcile,
              ),
            if (state.reconciliation != null && actions.contains('close'))
              _Action(
                icon: Icons.lock_outline,
                label: l.closeShiftAction,
                onPressed: () => _close(context, controller),
              ),
          ],
        ),
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
  if ((accepted ?? false) && reason.text.trim().isNotEmpty) {
    await controller.movement(
      type: type,
      amountMinorUnits: _minorUnits(amount.text),
      reasonCode: reason.text
          .trim()
          .replaceAll(RegExp(r'\s+'), '_')
          .toLowerCase(),
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
  final amount = TextEditingController();
  if (controller.state.count != null) {
    await controller.requestRecount();
    if (controller.state.errorCode != null) {
      amount.dispose();
      return;
    }
    if (!context.mounted) {
      amount.dispose();
      return;
    }
  }
  final accepted = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l.blindCountAction),
      content: TextField(
        controller: amount,
        autofocus: true,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: InputDecoration(labelText: l.countedCashLabel),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext, false),
          child: Text(l.closeAction),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(dialogContext, true),
          child: Text(l.submitBlindCountAction),
        ),
      ],
    ),
  );
  if (accepted ?? false) {
    await controller.submitCount(amountMinorUnits: _minorUnits(amount.text));
  }
  amount.dispose();
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

int _minorUnits(String value) {
  final normalized = value.trim().replaceAll(',', '.');
  final parts = normalized.split('.');
  final whole = int.tryParse(parts.first) ?? 0;
  final fraction = parts.length > 1
      ? int.tryParse(parts[1].padRight(2, '0').substring(0, 2)) ?? 0
      : 0;
  return whole * 100 + fraction;
}

String _money(Map<String, Object?> value) {
  final currency = value['currency'] as String? ?? '';
  final minor = (value['minorUnits'] as num?)?.toInt() ?? 0;
  return '$currency ${(minor / 100).toStringAsFixed(2)}';
}
