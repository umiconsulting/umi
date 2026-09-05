import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import 'exception_controller.dart';

Future<void> showSaleExceptionDialog(
  BuildContext context, {
  required SaleExceptionController controller,
  required String saleId,
}) => showDialog<void>(
  context: context,
  builder: (_) => Dialog(
    clipBehavior: Clip.antiAlias,
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 920, maxHeight: 760),
      child: _SaleExceptionSurface(controller: controller, saleId: saleId),
    ),
  ),
);

final class _SaleExceptionSurface extends StatefulWidget {
  const _SaleExceptionSurface({required this.controller, required this.saleId});
  final SaleExceptionController controller;
  final String saleId;

  @override
  State<_SaleExceptionSurface> createState() => _SaleExceptionSurfaceState();
}

final class _SaleExceptionSurfaceState extends State<_SaleExceptionSurface> {
  String? _exceptionType;
  String _reason = 'customer_changed_mind';
  final _note = TextEditingController();
  final _managerPin = TextEditingController();
  final Map<String, int> _quantities = {};
  final Map<String, String> _restock = {};
  String _fullRestock = 'restock';

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
    widget.controller.load(widget.saleId);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    _note.dispose();
    _managerPin.dispose();
    super.dispose();
  }

  void _changed() {
    if (!mounted) return;
    final eligibility = widget.controller.state.eligibility;
    if (eligibility != null && _exceptionType == null) {
      _exceptionType = eligibility.allowedTypes.isEmpty
          ? null
          : eligibility.allowedTypes.first;
    }
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final state = widget.controller.state;
    return SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              UmiSpacing.lg,
              UmiSpacing.lg,
              UmiSpacing.sm,
              UmiSpacing.md,
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    l.saleExceptionTitle,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                ),
                IconButton(
                  tooltip: l.closeAction,
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: Semantics(
              liveRegion: true,
              label: _phaseLabel(l, state.phase),
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(UmiSpacing.lg),
                child: switch (state.phase) {
                  SaleExceptionPhase.loading || SaleExceptionPhase.committing =>
                    const Center(child: CircularProgressIndicator()),
                  SaleExceptionPhase.blocked => _blocked(l, state),
                  SaleExceptionPhase.failure => _failure(l, state),
                  SaleExceptionPhase.committed ||
                  SaleExceptionPhase.recovered => _receipt(l, state.result),
                  SaleExceptionPhase.outcomeUnknown => _unknown(l, state),
                  SaleExceptionPhase.previewReady ||
                  SaleExceptionPhase.approvalRequired ||
                  SaleExceptionPhase.terminalRequired => _preview(l, state),
                  SaleExceptionPhase.eligible => _selection(
                    l,
                    state.eligibility!,
                  ),
                  _ => const SizedBox.shrink(),
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _blocked(AppLocalizations l, SaleExceptionState state) {
    final refund = state.eligibility?.refund;
    final codes = (refund?['blockCodes'] as List<Object?>? ?? const [])
        .map((code) => _blockLabel(l, '$code'))
        .join('\n');
    return _status(
      Icons.block_outlined,
      l.refundBlockedMessage,
      codes.isEmpty ? l.supportRequiredMessage : codes,
    );
  }

  Widget _failure(AppLocalizations l, SaleExceptionState state) => _status(
    Icons.error_outline,
    l.refundOperationFailedMessage,
    _errorLabel(l, state.errorCode),
  );

  Widget _unknown(AppLocalizations l, SaleExceptionState state) {
    final correlation =
        state.terminalOutcome?.correlationReference ??
        state.preview?.correlationReference;
    final guidance = correlation == null
        ? l.verifyTerminalAction
        : '${l.verifyTerminalAction}\n${l.correlationLabel}: $correlation';
    return _status(
      Icons.help_outline,
      l.paymentOutcomeUnknownMessage,
      guidance,
    );
  }

  Widget _status(IconData icon, String title, String message) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 560),
      child: Column(
        children: [
          Icon(icon, size: 52),
          const SizedBox(height: UmiSpacing.md),
          Text(title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: UmiSpacing.sm),
          Text(message, textAlign: TextAlign.center),
        ],
      ),
    ),
  );

  Widget _selection(AppLocalizations l, SaleExceptionEligibility eligibility) {
    final sale = eligibility.sale;
    final refund = eligibility.refund;
    final lines = (refund['lines']! as List<Object?>)
        .cast<Map<String, Object?>>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _moneyRow(
          l.refundableAmountLabel,
          sale['remainingRefundable']! as Map<String, Object?>,
        ),
        const SizedBox(height: UmiSpacing.lg),
        Wrap(
          spacing: UmiSpacing.sm,
          runSpacing: UmiSpacing.sm,
          children: eligibility.allowedTypes
              .map(
                (type) => ChoiceChip(
                  selected: _exceptionType == type,
                  label: Text(_typeLabel(l, type)),
                  onSelected: (_) => setState(() {
                    _exceptionType = type;
                    _reason = type == 'void'
                        ? 'operator_error'
                        : 'customer_changed_mind';
                  }),
                ),
              )
              .toList(),
        ),
        if (_exceptionType == 'partial_refund') ...[
          const SizedBox(height: UmiSpacing.lg),
          ...lines.map((line) => _lineSelector(l, line)),
        ] else if (_exceptionType == 'full_refund' ||
            _exceptionType == 'void') ...[
          const SizedBox(height: UmiSpacing.lg),
          Text(
            l.restockIntentLabel,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: UmiSpacing.sm),
          SegmentedButton<String>(
            segments: [
              ButtonSegment(value: 'restock', label: Text(l.restockAction)),
              ButtonSegment(
                value: 'do_not_restock',
                label: Text(l.doNotRestockAction),
              ),
              ButtonSegment(
                value: 'inspection_required',
                label: Text(l.inspectionRequiredAction),
              ),
            ],
            selected: {_fullRestock},
            onSelectionChanged: (value) =>
                setState(() => _fullRestock = value.first),
            showSelectedIcon: false,
          ),
        ],
        const SizedBox(height: UmiSpacing.lg),
        DropdownButtonFormField<String>(
          key: ValueKey(_exceptionType == 'void'),
          initialValue: _reasons(_exceptionType == 'void').contains(_reason)
              ? _reason
              : _reasons(_exceptionType == 'void').first,
          decoration: InputDecoration(labelText: l.refundReasonLabel),
          items: _reasons(_exceptionType == 'void')
              .map(
                (reason) => DropdownMenuItem(
                  value: reason,
                  child: Text(_reasonLabel(l, reason)),
                ),
              )
              .toList(),
          onChanged: (value) => setState(() => _reason = value ?? _reason),
        ),
        const SizedBox(height: UmiSpacing.md),
        TextField(
          controller: _note,
          maxLength: 160,
          decoration: InputDecoration(labelText: l.refundReasonLabel),
        ),
        const SizedBox(height: UmiSpacing.md),
        FilledButton.icon(
          onPressed: _createPreview,
          icon: const Icon(Icons.preview_outlined),
          label: Text(l.refundPreviewAction),
        ),
        if (widget.controller.state.history?.entries.isNotEmpty ?? false) ...[
          const SizedBox(height: UmiSpacing.lg),
          Text(
            l.exceptionHistoryLabel,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          ...widget.controller.state.history!.entries.map(
            (entry) => ListTile(
              leading: const Icon(Icons.history),
              title: Text(_typeLabel(l, '${entry['exceptionType']}')),
              subtitle: Text(_reasonLabel(l, '${entry['reason']}')),
              trailing: Text(_money(entry['amount']! as Map<String, Object?>)),
            ),
          ),
        ],
      ],
    );
  }

  Widget _lineSelector(AppLocalizations l, Map<String, Object?> line) {
    final id = line['saleLineId']! as String;
    final quantity = line['quantity']! as Map<String, Object?>;
    final remaining = quantity['remaining']! as int;
    final selected = _quantities[id] ?? 0;
    final service = line['isService']! as bool;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Checkbox(
                  value: selected > 0,
                  onChanged: (value) => setState(() {
                    _quantities[id] = value ?? false ? 1 : 0;
                    _restock[id] = service ? 'not_applicable' : 'restock';
                  }),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${line['displayName']}'),
                      Text('${l.remainingRefundableQuantityLabel}: $remaining'),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: l.decreaseRefundQuantityTooltip,
                  onPressed: selected > 0
                      ? () => setState(() => _quantities[id] = selected - 1)
                      : null,
                  icon: const Icon(Icons.remove),
                ),
                Semantics(
                  label: '${l.remainingRefundableQuantityLabel}: $selected',
                  child: Text('$selected'),
                ),
                IconButton(
                  tooltip: l.increaseRefundQuantityTooltip,
                  onPressed: selected < remaining
                      ? () => setState(() => _quantities[id] = selected + 1)
                      : null,
                  icon: const Icon(Icons.add),
                ),
              ],
            ),
            if (selected > 0 && !service)
              SegmentedButton<String>(
                segments: [
                  ButtonSegment(value: 'restock', label: Text(l.restockAction)),
                  ButtonSegment(
                    value: 'do_not_restock',
                    label: Text(l.doNotRestockAction),
                  ),
                  ButtonSegment(
                    value: 'inspection_required',
                    label: Text(l.inspectionRequiredAction),
                  ),
                ],
                selected: {_restock[id] ?? 'restock'},
                onSelectionChanged: (value) =>
                    setState(() => _restock[id] = value.first),
                showSelectedIcon: false,
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _createPreview() async {
    final type = _exceptionType;
    if (type == null) {
      return;
    }
    final eligibilityLines =
        (widget.controller.state.eligibility?.refund['lines']
                    as List<Object?>? ??
                const [])
            .cast<Map<String, Object?>>();
    final lines = type == 'partial_refund'
        ? _quantities.entries
              .where((entry) => entry.value > 0)
              .map(
                (entry) => <String, Object?>{
                  'saleLineId': entry.key,
                  'quantity': entry.value,
                  'restockDecision': _restock[entry.key] ?? 'restock',
                },
              )
              .toList()
        : eligibilityLines.map((line) {
            final quantity = line['quantity']! as Map<String, Object?>;
            return <String, Object?>{
              'saleLineId': line['saleLineId'],
              'quantity': quantity['remaining'],
              'restockDecision': line['isService']! as bool
                  ? 'not_applicable'
                  : _fullRestock,
            };
          }).toList();
    if (type == 'partial_refund' && lines.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context).selectRefundLinesMessage),
        ),
      );
      return;
    }
    await widget.controller.createPreview(
      exceptionType: type,
      reason: _reason,
      lines: lines,
      note: _note.text,
    );
  }

  Widget _preview(AppLocalizations l, SaleExceptionState state) {
    final preview = state.preview!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          _typeLabel(l, preview.exceptionType),
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: UmiSpacing.md),
        _moneyRow(
          l.taxRefundLabel,
          preview.tax['amount']! as Map<String, Object?>,
        ),
        _moneyRow(
          l.discountAllocationLabel,
          preview.discount['amount']! as Map<String, Object?>,
        ),
        _moneyRow(
          l.tipRefundLabel,
          preview.tip['amount']! as Map<String, Object?>,
        ),
        const Divider(),
        _moneyRow(
          l.refundableAmountLabel,
          preview.allocation['total']! as Map<String, Object?>,
        ),
        const SizedBox(height: UmiSpacing.md),
        ...preview.tenders.map(
          (tender) => ListTile(
            leading: Icon(
              tender['tenderType'] == 'cash'
                  ? Icons.payments_outlined
                  : Icons.credit_card,
            ),
            title: Text(
              tender['tenderType'] == 'cash'
                  ? l.cashRefundLabel
                  : l.manualTerminalRefundLabel,
            ),
            trailing: Text(_money(tender['amount']! as Map<String, Object?>)),
          ),
        ),
        const SizedBox(height: UmiSpacing.sm),
        Text(
          l.restockIntentLabel,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        ...preview.lines.map(
          (line) => ListTile(
            dense: true,
            title: Text(
              '${line['quantity']} × ${_restockLabel(l, '${line['restockDecision']}')}',
            ),
          ),
        ),
        if (preview.manualTerminal != null &&
            (state.terminalOutcome == null ||
                state.terminalOutcome?.status ==
                    'operator_reported_failure')) ...[
          Text(
            l.manualTerminalRefundProviderNotice,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: UmiSpacing.sm),
          Wrap(
            spacing: UmiSpacing.sm,
            runSpacing: UmiSpacing.sm,
            children: [
              FilledButton.tonal(
                onPressed: () => widget.controller.recordTerminalOutcome(
                  'confirmed_success',
                ),
                child: Text(l.terminalRefundSuccessAction),
              ),
              OutlinedButton(
                onPressed: () => widget.controller.recordTerminalOutcome(
                  'operator_reported_failure',
                ),
                child: Text(l.terminalRefundFailureAction),
              ),
              OutlinedButton(
                onPressed: () =>
                    widget.controller.recordTerminalOutcome('outcome_unknown'),
                child: Text(l.terminalRefundUnknownAction),
              ),
            ],
          ),
        ],
        if (preview.approvalRequired && state.approval == null) ...[
          const SizedBox(height: UmiSpacing.lg),
          TextField(
            controller: _managerPin,
            obscureText: true,
            keyboardType: TextInputType.number,
            autofillHints: const [],
            decoration: InputDecoration(labelText: l.managerPinLabel),
            onSubmitted: _approve,
          ),
          const SizedBox(height: UmiSpacing.sm),
          FilledButton.tonal(
            onPressed: () => _approve(_managerPin.text),
            child: Text(l.approvalRequiredMessage),
          ),
        ],
        if ((!preview.approvalRequired || state.approval != null) &&
            (preview.manualTerminal == null ||
                state.terminalOutcome?.status == 'confirmed_success')) ...[
          const SizedBox(height: UmiSpacing.lg),
          FilledButton.icon(
            onPressed: () => _confirmCommit(l),
            icon: const Icon(Icons.check_circle_outline),
            label: Text(l.commitRefundAction),
          ),
        ],
      ],
    );
  }

  Future<void> _confirmCommit(AppLocalizations l) async {
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l.refundConfirmationTitle),
        content: Text(l.refundConfirmationBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(l.closeAction),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(l.commitRefundAction),
          ),
        ],
      ),
    );
    if (accepted ?? false) await widget.controller.commit();
  }

  Future<void> _approve(String pin) async {
    try {
      await widget.controller.approve(pin);
    } finally {
      _managerPin.clear();
    }
  }

  Widget _receipt(AppLocalizations l, SaleExceptionResult? result) {
    if (result == null) {
      return _status(
        Icons.receipt_long_outlined,
        l.compensatingReceiptTitle,
        l.recoveredRefundMessage,
      );
    }
    final receipt = result.receipt;
    return Column(
      children: [
        const Icon(Icons.check_circle_outline, size: 56),
        const SizedBox(height: UmiSpacing.md),
        Text(
          l.compensatingReceiptTitle,
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: UmiSpacing.sm),
        Text(
          receipt?['publicReference'] as String? ??
              result.exceptionId.substring(0, 8),
        ),
        const SizedBox(height: UmiSpacing.lg),
        _moneyRow(
          l.refundableAmountLabel,
          result.allocation['total']! as Map<String, Object?>,
        ),
        Text(l.refundCommittedMessage),
      ],
    );
  }

  Widget _moneyRow(String label, Map<String, Object?> value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: UmiSpacing.xs),
    child: Row(
      children: [
        Expanded(child: Text(label)),
        Text(
          _money(value),
          style: const TextStyle(fontFeatures: [FontFeature.tabularFigures()]),
        ),
      ],
    ),
  );

  String _money(Map<String, Object?> value) {
    final minor = value['minorUnits']! as int;
    return '${value['currency']} ${(minor / 100).toStringAsFixed(2)}';
  }

  String _typeLabel(AppLocalizations l, String type) => switch (type) {
    'void' => l.voidSaleAction,
    'full_refund' => l.fullRefundAction,
    'partial_refund' => l.partialRefundAction,
    _ => l.supportRequiredMessage,
  };

  String _restockLabel(AppLocalizations l, String decision) =>
      switch (decision) {
        'restock' => l.restockAction,
        'do_not_restock' => l.doNotRestockAction,
        'inspection_required' => l.inspectionRequiredAction,
        'not_applicable' => l.restockNotApplicableLabel,
        _ => l.restockInventoryReviewLabel,
      };

  String _reasonLabel(AppLocalizations l, String reason) => switch (reason) {
    'customer_changed_mind' => l.refundReasonCustomerChangedMind,
    'product_defect' => l.refundReasonProductDefect,
    'incorrect_item' => l.refundReasonIncorrectItem,
    'incorrect_quantity' => l.refundReasonIncorrectQuantity,
    'duplicate_charge' => l.refundReasonDuplicateCharge,
    'quality_issue' => l.refundReasonQualityIssue,
    'order_preparation_error' => l.refundReasonOrderPreparationError,
    'pricing_error' => l.refundReasonPricingError,
    'operator_error' => l.voidReasonOperatorError,
    'duplicate_sale' => l.voidReasonDuplicateSale,
    'incorrect_tender' => l.voidReasonIncorrectTender,
    'sale_entered_by_mistake' => l.voidReasonSaleEnteredByMistake,
    _ => l.otherApprovedReasonLabel,
  };

  List<String> _reasons(bool voidReason) => voidReason
      ? const [
          'operator_error',
          'duplicate_sale',
          'incorrect_tender',
          'sale_entered_by_mistake',
        ]
      : const [
          'customer_changed_mind',
          'product_defect',
          'incorrect_item',
          'incorrect_quantity',
          'duplicate_charge',
          'quality_issue',
          'order_preparation_error',
          'pricing_error',
        ];

  String _blockLabel(AppLocalizations l, String code) => switch (code) {
    'policy_window_expired' => l.refundPolicyExpiredMessage,
    'payment_outcome_unknown' => l.paymentOutcomeUnknownMessage,
    'fully_refunded' => l.fullyRefundedLabel,
    _ => l.refundBlockedMessage,
  };

  String _errorLabel(AppLocalizations l, String? code) => switch (code) {
    'PAYMENT_OUTCOME_UNKNOWN' => l.paymentOutcomeUnknownMessage,
    'APPROVAL_EXPIRED' => l.approvalExpiredMessage,
    'CASH_SHIFT_NOT_ELIGIBLE' => l.refundBlockedMessage,
    _ => l.refundOperationFailedMessage,
  };

  String _phaseLabel(AppLocalizations l, SaleExceptionPhase phase) =>
      switch (phase) {
        SaleExceptionPhase.committed => l.refundCommittedMessage,
        SaleExceptionPhase.recovered => l.recoveredRefundMessage,
        SaleExceptionPhase.outcomeUnknown => l.paymentOutcomeUnknownMessage,
        SaleExceptionPhase.blocked => l.refundBlockedMessage,
        _ => l.saleExceptionTitle,
      };
}
