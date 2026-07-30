import 'dart:async';

import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import '../cart/cart_controller.dart';
import '../entry/entry_controller.dart';
import '../offline/offline_policy.dart';
import '../sale/sale_lifecycle_controller.dart';
import 'checkout_controller.dart';

Future<void> showCheckoutSheet(
  BuildContext context, {
  required CheckoutController checkout,
  required CartController cart,
  required EntryController entry,
  required SaleLifecycleController sales,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  builder: (_) => _CheckoutSheet(
    checkout: checkout,
    cart: cart,
    entry: entry,
    sales: sales,
  ),
);

final class _CheckoutSheet extends StatefulWidget {
  const _CheckoutSheet({
    required this.checkout,
    required this.cart,
    required this.entry,
    required this.sales,
  });
  final CheckoutController checkout;
  final CartController cart;
  final EntryController entry;
  final SaleLifecycleController sales;

  @override
  State<_CheckoutSheet> createState() => _CheckoutSheetState();
}

final class _CheckoutSheetState extends State<_CheckoutSheet> {
  String method = 'cash';
  bool cashEnabled = true;
  bool terminalEnabled = false;
  String terminalStatus = 'not_started';
  String receiptDestination = 'display';
  String tipKind = 'none';
  int tipBasisPoints = 0;
  String discountType = 'order_percentage';
  bool dirty = false;
  bool recoveredDraftLoaded = false;
  final cashApplied = TextEditingController();
  final cashReceived = TextEditingController();
  final terminalAmount = TextEditingController();
  final customTipPercent = TextEditingController();
  final customTipFixed = TextEditingController();
  final discountPercent = TextEditingController();
  final discountReason = TextEditingController();
  bool committed = false;

  @override
  void initState() {
    super.initState();
    widget.checkout.reset();
    widget.checkout.addListener(_changed);
    final cart = widget.cart.state.cart;
    final operator = widget.entry.state.operator;
    if (cart != null && operator != null) {
      unawaited(
        widget.checkout.recover(
          tenantId: cart.tenantId,
          branchId: cart.branchId,
          operatorSessionId: operator.id,
          cartId: cart.id,
          cartVersion: cart.version,
        ),
      );
    }
  }

  @override
  void dispose() {
    widget.checkout.removeListener(_changed);
    if (!committed) widget.sales.checkoutStopped();
    cashReceived.dispose();
    cashApplied.dispose();
    terminalAmount.dispose();
    customTipPercent.dispose();
    customTipFixed.dispose();
    discountPercent.dispose();
    discountReason.dispose();
    super.dispose();
  }

  void _changed() {
    if (!recoveredDraftLoaded &&
        widget.checkout.state.phase == CheckoutPhase.collectingPayment &&
        widget.checkout.tenderDrafts.isNotEmpty) {
      recoveredDraftLoaded = true;
      _restoreDraft(widget.checkout.tenderDrafts);
    }
    if (mounted) setState(() {});
    if (widget.checkout.state.phase == CheckoutPhase.completed && !committed) {
      committed = true;
      unawaited(widget.sales.checkoutCommitted());
    }
  }

  void _restoreDraft(List<Map<String, Object?>> drafts) {
    for (final draft in drafts) {
      final amount = draft['amount']! as Map<String, Object?>;
      final value = ((amount['minorUnits']! as num).toInt() / 100)
          .toStringAsFixed(2);
      if (draft['type'] == 'cash') {
        cashEnabled = true;
        cashApplied.text = value;
        final received = draft['amountReceived'] as Map<String, Object?>?;
        cashReceived.text = received == null
            ? value
            : (((received['minorUnits']! as num).toInt()) / 100)
                  .toStringAsFixed(2);
      } else {
        terminalEnabled = true;
        terminalAmount.text = value;
        terminalStatus = draft['status']! as String;
      }
    }
    final tip = widget.checkout.tipDraft;
    if (tip?['kind'] == 'percentage') {
      tipKind = 'percentage';
      tipBasisPoints = (tip!['basisPoints']! as num).toInt();
      customTipPercent.text = (tipBasisPoints / 100).toStringAsFixed(2);
    } else if (tip?['kind'] == 'fixed') {
      tipKind = 'fixed';
      final fixed = tip!['fixedAmount']! as Map<String, Object?>;
      customTipFixed.text = ((fixed['minorUnits']! as num).toInt() / 100)
          .toStringAsFixed(2);
    }
    final discounts = widget.checkout.discountDrafts;
    if (discounts.isNotEmpty) {
      discountType = discounts.first['type']! as String;
      if (discountType == 'order_fixed') {
        final fixed = discounts.first['fixedAmount']! as Map<String, Object?>;
        discountPercent.text = ((fixed['minorUnits']! as num).toInt() / 100)
            .toStringAsFixed(2);
      } else {
        discountPercent.text =
            ((discounts.first['basisPoints']! as num).toInt() / 100)
                .toStringAsFixed(2);
      }
      discountReason.text = discounts.first['reason']! as String;
    }
    receiptDestination =
        widget.checkout.receiptDelivery['destination']! as String;
  }

  String _money(Map<String, Object?> value) {
    final currency = value['currency'] as String? ?? '';
    final minor = (value['minorUnits'] as num?)?.toInt() ?? 0;
    return '$currency ${(minor / 100).toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final cart = widget.cart.state.cart!;
    final state = widget.checkout.state;
    final confirmation = state.result?.confirmation;
    final totals = confirmation == null
        ? TotalsPreview.fromJson(cart.totals)
        : TotalsPreview.fromJson(
            confirmation['totals']! as Map<String, Object?>,
          );
    if (cashReceived.text.isEmpty) {
      final minor = (totals.grandTotal['minorUnits']! as num).toInt();
      cashReceived.text = (minor / 100).toStringAsFixed(2);
      cashApplied.text = cashReceived.text;
    }
    final policy = state.result?.policy == null
        ? null
        : CheckoutPolicy.fromJson(state.result!.policy!);
    final paymentSummary = state.result?.paymentSummary == null
        ? null
        : PaymentSummary.fromJson(state.result!.paymentSummary!);
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .9,
        child: Padding(
          padding: const EdgeInsets.all(UmiSpacing.lg),
          child: switch (state.phase) {
            CheckoutPhase.completed => _receipt(context, state.result!),
            CheckoutPhase.provisional => _provisional(
              context,
              state.provisionalReceipt!,
            ),
            CheckoutPhase.paymentUnknown => _unknown(context, state.result!),
            CheckoutPhase.processing || CheckoutPhase.repricing => Center(
              child: Semantics(
                liveRegion: true,
                label: l.paymentProcessing,
                child: const CircularProgressIndicator(),
              ),
            ),
            CheckoutPhase.failure => _checkoutError(context, state.errorCode),
            _ => ListView(
              children: [
                Text(
                  l.checkoutTitle,
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                Text(widget.entry.state.selectedTenant?.name ?? ''),
                Text(widget.entry.state.selectedBranch?.name ?? ''),
                Text(
                  '${l.operatorLabel}: '
                  '${widget.entry.state.operator?.staffId ?? ''}',
                ),
                const SizedBox(height: UmiSpacing.lg),
                _AmountRow(
                  label: l.subtotalLabel,
                  value: _money(totals.subtotal),
                ),
                _AmountRow(label: l.taxLabel, value: _money(totals.tax)),
                _AmountRow(
                  label: l.totalLabel,
                  value: _money(totals.grandTotal),
                  emphasized: true,
                ),
                if (paymentSummary != null) ...[
                  _AmountRow(
                    label: l.appliedAmountLabel,
                    value: _money(paymentSummary.appliedAmount),
                  ),
                  _AmountRow(
                    label: l.remainingBalanceLabel,
                    value: _money(paymentSummary.remainingBalance),
                  ),
                  _AmountRow(
                    label: l.changeDueLabel,
                    value: _money(paymentSummary.change),
                  ),
                ],
                Text('${l.businessDateLabel}: ${totals.businessDate}'),
                const SizedBox(height: UmiSpacing.lg),
                Text(
                  l.tenderSelectionTitle,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                Wrap(
                  spacing: 12,
                  runSpacing: UmiSpacing.sm,
                  children: [
                    FilterChip(
                      label: Text(l.cashPayment),
                      selected: cashEnabled,
                      onSelected: (selected) => _setCash(selected, totals),
                    ),
                    if (policy?.manualTerminalEnabled ?? false)
                      FilterChip(
                        label: Text(l.manualTerminalLabel),
                        selected: terminalEnabled,
                        onSelected: (selected) =>
                            _setTerminal(selected, totals),
                      ),
                  ],
                ),
                if (cashEnabled) ...[
                  const SizedBox(height: UmiSpacing.md),
                  Text(
                    l.cashTenderTitle,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: UmiSpacing.sm),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: cashApplied,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          decoration: InputDecoration(
                            labelText: l.tenderAmountLabel,
                          ),
                          onChanged: (_) => setState(() => dirty = true),
                        ),
                      ),
                      const SizedBox(width: UmiSpacing.md),
                      Expanded(
                        child: TextField(
                          controller: cashReceived,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          decoration: InputDecoration(
                            labelText: l.cashReceivedLabel,
                          ),
                          onChanged: (_) => setState(() => dirty = true),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: UmiSpacing.sm),
                  Wrap(
                    spacing: UmiSpacing.sm,
                    runSpacing: UmiSpacing.sm,
                    children: [
                      ActionChip(
                        label: Text(l.exactAmountAction),
                        onPressed: () => _setCashReceived(
                          (totals.grandTotal['minorUnits']! as num).toInt(),
                        ),
                      ),
                      for (final value in const [10000, 20000, 50000])
                        ActionChip(
                          label: Text(
                            _money({
                              'currency': totals.grandTotal['currency'],
                              'minorUnits': value,
                            }),
                          ),
                          onPressed: () => _setCashReceived(value),
                        ),
                    ],
                  ),
                ],
                if (terminalEnabled) ...[
                  const SizedBox(height: UmiSpacing.lg),
                  Text(
                    l.manualTerminalLabel,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: UmiSpacing.sm),
                  TextField(
                    controller: terminalAmount,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: InputDecoration(labelText: l.tenderAmountLabel),
                    onChanged: (_) => setState(() => dirty = true),
                  ),
                  const SizedBox(height: UmiSpacing.sm),
                  Wrap(
                    spacing: UmiSpacing.sm,
                    runSpacing: UmiSpacing.sm,
                    children: [
                      ChoiceChip(
                        label: Text(l.terminalProcessingAction),
                        selected:
                            terminalStatus == 'operator_processing_externally',
                        onSelected: (_) =>
                            _terminalOutcome('operator_processing_externally'),
                      ),
                      ChoiceChip(
                        label: Text(l.terminalSuccessAction),
                        selected: terminalStatus == 'confirmed_success',
                        onSelected: (_) =>
                            _terminalOutcome('confirmed_success'),
                      ),
                      ChoiceChip(
                        label: Text(l.terminalFailureAction),
                        selected: terminalStatus == 'operator_reported_failure',
                        onSelected: (_) =>
                            _terminalOutcome('operator_reported_failure'),
                      ),
                      ChoiceChip(
                        label: Text(l.terminalUnknownAction),
                        selected: terminalStatus == 'outcome_unknown',
                        onSelected: (_) => _terminalOutcome('outcome_unknown'),
                      ),
                    ],
                  ),
                ],
                if (policy?.tip['enabled'] == true) ...[
                  const SizedBox(height: UmiSpacing.lg),
                  Text(
                    l.tipLabel,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  Wrap(
                    spacing: UmiSpacing.sm,
                    children: [
                      ChoiceChip(
                        label: Text(l.noTipAction),
                        selected: tipKind == 'none',
                        onSelected: (_) => _clearTip(),
                      ),
                      for (final raw
                          in policy!.tip['presetBasisPoints']! as List<Object?>)
                        ChoiceChip(
                          label: Text('${(raw as num).toInt() ~/ 100}%'),
                          selected:
                              tipKind == 'percentage' &&
                              tipBasisPoints == raw.toInt(),
                          onSelected: (_) => _setTipPercentage(raw.toInt()),
                        ),
                    ],
                  ),
                  const SizedBox(height: UmiSpacing.sm),
                  Row(
                    children: [
                      if (policy.tip['customPercentageEnabled'] == true)
                        Expanded(
                          child: TextField(
                            controller: customTipPercent,
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            decoration: InputDecoration(
                              labelText: l.customTipPercentLabel,
                            ),
                            onChanged: _setCustomTipPercentage,
                          ),
                        ),
                      if (policy.tip['customPercentageEnabled'] == true &&
                          policy.tip['customFixedEnabled'] == true)
                        const SizedBox(width: UmiSpacing.md),
                      if (policy.tip['customFixedEnabled'] == true)
                        Expanded(
                          child: TextField(
                            controller: customTipFixed,
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            decoration: InputDecoration(
                              labelText: l.customTipFixedLabel,
                            ),
                            onChanged: _setCustomTipFixed,
                          ),
                        ),
                    ],
                  ),
                ],
                if (policy?.discount['enabled'] == true) ...[
                  const SizedBox(height: UmiSpacing.lg),
                  Text(
                    l.discountLabel,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  Wrap(
                    spacing: UmiSpacing.sm,
                    children: [
                      ChoiceChip(
                        label: Text(l.percentageDiscountAction),
                        selected: discountType == 'order_percentage',
                        onSelected: (_) => _setDiscountType('order_percentage'),
                      ),
                      ChoiceChip(
                        label: Text(l.fixedDiscountAction),
                        selected: discountType == 'order_fixed',
                        onSelected: (_) => _setDiscountType('order_fixed'),
                      ),
                    ],
                  ),
                  const SizedBox(height: UmiSpacing.sm),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: discountPercent,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: false,
                          ),
                          decoration: InputDecoration(
                            labelText: discountType == 'order_fixed'
                                ? l.discountAmountLabel
                                : l.discountPercentLabel,
                          ),
                          onChanged: (_) => setState(() => dirty = true),
                        ),
                      ),
                      const SizedBox(width: UmiSpacing.md),
                      Expanded(
                        child: TextField(
                          controller: discountReason,
                          decoration: InputDecoration(
                            labelText: l.discountReasonLabel,
                          ),
                          onChanged: (_) => setState(() => dirty = true),
                        ),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: UmiSpacing.lg),
                Text(
                  l.receiptDestinationLabel,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                Wrap(
                  spacing: UmiSpacing.sm,
                  runSpacing: UmiSpacing.sm,
                  children: [
                    ChoiceChip(
                      label: Text(l.displayReceiptAction),
                      selected: receiptDestination == 'display',
                      onSelected: (_) => _setReceiptDestination('display'),
                    ),
                    ChoiceChip(
                      label: Text(l.printLaterAction),
                      selected: receiptDestination == 'print_later',
                      onSelected: (_) => _setReceiptDestination('print_later'),
                    ),
                    ChoiceChip(
                      label: Text(l.noReceiptAction),
                      selected: receiptDestination == 'none',
                      onSelected: (_) => _setReceiptDestination('none'),
                    ),
                  ],
                ),
                if (state.errorCode != null) ...[
                  const SizedBox(height: UmiSpacing.md),
                  Semantics(
                    liveRegion: true,
                    child: Text(
                      _recoveryMessage(l, state.errorCode!),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                ],
                if (state.phase == CheckoutPhase.confirmationRequired) ...[
                  const SizedBox(height: UmiSpacing.lg),
                  Semantics(
                    liveRegion: true,
                    child: Text(l.totalsConfirmedBody),
                  ),
                ],
                const SizedBox(height: UmiSpacing.lg),
                FilledButton(
                  onPressed: state.phase == CheckoutPhase.awaitingApproval
                      ? () => _requestApproval(context)
                      : state.phase == CheckoutPhase.confirmationRequired &&
                            !dirty
                      ? () => _confirm(context)
                      : () => _review(totals),
                  child: Text(
                    state.phase == CheckoutPhase.awaitingApproval
                        ? l.managerApprovalAction
                        : state.phase == CheckoutPhase.confirmationRequired &&
                              !dirty
                        ? l.confirmAndPayAction
                        : l.reviewTotalsAction,
                  ),
                ),
                TextButton(
                  onPressed: () => _closeCheckout(context),
                  child: Text(l.closeAction),
                ),
              ],
            ),
          },
        ),
      ),
    );
  }

  int _minorUnits(String raw) {
    final parts = raw.trim().split('.');
    final whole = int.tryParse(parts.first) ?? 0;
    final fraction = parts.length > 1
        ? parts[1].padRight(2, '0').substring(0, 2)
        : '00';
    return whole * 100 + (int.tryParse(fraction) ?? 0);
  }

  void _setCash(bool selected, TotalsPreview totals) {
    if (!selected && !terminalEnabled) return;
    setState(() {
      cashEnabled = selected;
      method = terminalEnabled ? 'external_terminal' : 'cash';
      dirty = true;
      _balanceTenderFields(totals);
    });
  }

  void _setTerminal(bool selected, TotalsPreview totals) {
    if (!selected && !cashEnabled) return;
    setState(() {
      terminalEnabled = selected;
      method = selected ? 'external_terminal' : 'cash';
      terminalStatus = selected
          ? 'not_started'
          : 'cancelled_before_confirmation';
      dirty = true;
      _balanceTenderFields(totals);
    });
  }

  void _balanceTenderFields(TotalsPreview totals) {
    final total = (totals.grandTotal['minorUnits']! as num).toInt();
    if (cashEnabled && terminalEnabled) {
      final cash = total ~/ 2;
      cashApplied.text = (cash / 100).toStringAsFixed(2);
      cashReceived.text = cashApplied.text;
      terminalAmount.text = ((total - cash) / 100).toStringAsFixed(2);
    } else if (cashEnabled) {
      cashApplied.text = (total / 100).toStringAsFixed(2);
      cashReceived.text = cashApplied.text;
      terminalAmount.clear();
    } else {
      terminalAmount.text = (total / 100).toStringAsFixed(2);
      cashApplied.clear();
      cashReceived.clear();
    }
  }

  void _setCashReceived(int minorUnits) => setState(() {
    cashReceived.text = (minorUnits / 100).toStringAsFixed(2);
    dirty = true;
  });

  void _terminalOutcome(String value) => setState(() {
    terminalStatus = value;
    dirty = true;
  });

  void _clearTip() => setState(() {
    tipKind = 'none';
    tipBasisPoints = 0;
    customTipPercent.clear();
    customTipFixed.clear();
    dirty = true;
  });

  void _setTipPercentage(int value) => setState(() {
    tipKind = 'percentage';
    tipBasisPoints = value;
    customTipPercent.text = (value / 100).toStringAsFixed(2);
    customTipFixed.clear();
    dirty = true;
  });

  void _setCustomTipPercentage(String value) => setState(() {
    tipKind = 'percentage';
    tipBasisPoints = (_minorUnits(value));
    customTipFixed.clear();
    dirty = true;
  });

  void _setCustomTipFixed(String _) => setState(() {
    tipKind = 'fixed';
    tipBasisPoints = 0;
    customTipPercent.clear();
    dirty = true;
  });

  void _setDiscountType(String value) => setState(() {
    discountType = value;
    discountPercent.clear();
    dirty = true;
  });

  void _setReceiptDestination(String value) => setState(() {
    receiptDestination = value;
    dirty = true;
  });

  List<Map<String, Object?>> _tenders(String currency) {
    final result = <Map<String, Object?>>[];
    if (cashEnabled) {
      result.add({
        'id': _stableId('cash'),
        'type': 'cash',
        'amount': {
          'minorUnits': _minorUnits(cashApplied.text),
          'currency': currency,
        },
        'amountReceived': {
          'minorUnits': _minorUnits(cashReceived.text),
          'currency': currency,
        },
        'status': 'draft',
        'correlationId': null,
      });
    }
    if (terminalEnabled) {
      result.add({
        'id': _stableId('terminal'),
        'type': 'manual_terminal',
        'amount': {
          'minorUnits': _minorUnits(terminalAmount.text),
          'currency': currency,
        },
        'amountReceived': null,
        'status': terminalStatus,
        'correlationId': 'manual-terminal-${widget.cart.state.cart!.id}',
      });
    }
    return result;
  }

  Map<String, Object?>? _tipDraft(String currency) => switch (tipKind) {
    'percentage' when tipBasisPoints > 0 => {
      'kind': 'percentage',
      'basisPoints': tipBasisPoints,
      'fixedAmount': null,
    },
    'fixed' when _minorUnits(customTipFixed.text) > 0 => {
      'kind': 'fixed',
      'basisPoints': null,
      'fixedAmount': {
        'minorUnits': _minorUnits(customTipFixed.text),
        'currency': currency,
      },
    },
    _ => null,
  };

  List<Map<String, Object?>> _discountDrafts(String currency) {
    final value = _minorUnits(discountPercent.text);
    if (value <= 0 || discountReason.text.trim().isEmpty) return const [];
    return [
      {
        'id': _stableId('discount'),
        'type': discountType,
        'lineId': null,
        'basisPoints': discountType == 'order_percentage' ? value : null,
        'fixedAmount': discountType == 'order_fixed'
            ? {'minorUnits': value, 'currency': currency}
            : null,
        'reason': discountReason.text.trim(),
      },
    ];
  }

  String _stableId(String kind) {
    final suffix = switch (kind) {
      'cash' => '000000000301',
      'terminal' => '000000000302',
      _ => '000000000303',
    };
    return '00000000-0000-4000-8000-$suffix';
  }

  void _review(TotalsPreview totals) {
    final cart = widget.cart.state.cart!;
    final entry = widget.entry.state;
    final tenant = entry.selectedTenant;
    final device = entry.device;
    final operator = entry.operator;
    final currency = totals.grandTotal['currency']! as String;
    final offlineAuthority =
        tenant == null || device == null || operator == null
        ? null
        : OfflineAuthorityContext(
            tenantId: tenant.id,
            branchId: cart.branchId,
            deviceId: device.id,
            credentialVersion: device.credentialVersion,
            operatorSessionId: operator.id,
            permissions: operator.permissions.toSet(),
            entitlements: operator.entitlements
                .where((item) => item['enabled'] == true)
                .map((item) => item['featureKey']! as String)
                .toSet(),
            currency: currency,
            deviceTrusted: device.state == 'active',
          );
    dirty = false;
    widget.sales.checkoutStarted();
    widget.checkout.preview(
      tenantId: cart.tenantId,
      branchId: cart.branchId,
      operatorSessionId: cart.operatorSessionId,
      cartId: cart.id,
      cartVersion: cart.version,
      paymentMethod: method,
      cart: cart,
      authority: offlineAuthority,
      branchName: entry.selectedBranch?.name ?? '',
      operatorName: operator?.staffId ?? cart.operatorSessionId,
      cashReceivedMinorUnits: cashEnabled
          ? _minorUnits(cashReceived.text)
          : null,
      tenderDrafts: _tenders(currency),
      tipDraft: _tipDraft(currency),
      discountDrafts: _discountDrafts(currency),
      receiptDelivery: {
        'destination': receiptDestination,
        'channel': null,
        'customerContactId': null,
      },
    );
  }

  Future<void> _requestApproval(BuildContext context) async {
    final l = AppLocalizations.of(context);
    final pin = TextEditingController();
    final fingerprint =
        widget.checkout.state.result?.confirmation['fingerprint'] as String?;
    if (fingerprint == null) return;
    final approved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l.managerApprovalTitle),
        content: TextField(
          controller: pin,
          obscureText: true,
          keyboardType: TextInputType.number,
          autofocus: true,
          decoration: InputDecoration(labelText: l.managerPinLabel),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l.closeAction),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(l.approveAction),
          ),
        ],
      ),
    );
    if (!(approved ?? false)) {
      pin.dispose();
      return;
    }
    final grant = await widget.entry.requestCheckoutApproval(
      managerPin: pin.text,
      permission:
          widget.checkout.state.result?.failure?['requiredPermission']
              as String? ??
          'checkout.discount.approve',
      commandFingerprint: fingerprint,
    );
    pin.dispose();
    if (grant == null) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(l.managerApprovalDeniedMessage)));
      }
      return;
    }
    widget.checkout.applyApproval(grant);
    await widget.checkout.confirm();
  }

  Future<void> _closeCheckout(BuildContext context) async {
    if (widget.checkout.state.phase == CheckoutPhase.paymentUnknown) {
      Navigator.pop(context);
      return;
    }
    final cancelled = await widget.checkout.cancel();
    if (cancelled && context.mounted) Navigator.pop(context);
  }

  String _recoveryMessage(AppLocalizations l, String code) => switch (code) {
    'insufficient_cash' => l.insufficientCashMessage,
    'remaining_balance' => l.remainingBalanceMessage,
    'approval_required' => l.approvalRequiredMessage,
    'terminal_outcome_unknown' => l.paymentUnknownBody,
    'terminal_reported_failure' => l.terminalFailureMessage,
    'tip_rejected' => l.tipRejectedMessage,
    'discount_rejected' => l.discountRejectedMessage,
    'OFFLINE_ADVANCED_TENDER_BLOCKED' => l.offlineAdvancedTenderBlockedMessage,
    _ => l.checkoutFailed,
  };

  Widget _provisional(BuildContext context, ProvisionalReceipt receipt) {
    final l = AppLocalizations.of(context);
    final snapshot = OfflineCheckoutSnapshot.fromJson(receipt.snapshot);
    final totals = TotalsConfirmation.fromJson(snapshot.totals);
    final preview = TotalsPreview.fromJson(totals.totals);
    final cart = Cart.fromJson(snapshot.cartSnapshot);
    return Semantics(
      liveRegion: true,
      label: l.provisionalSalePendingTitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Icon(Icons.cloud_off_outlined, size: 64),
          Text(
            l.provisionalSalePendingTitle,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: UmiSpacing.md),
          Text(l.provisionalSalePendingBody, textAlign: TextAlign.center),
          SelectableText(
            receipt.provisionalSaleId,
            textAlign: TextAlign.center,
          ),
          Text(receipt.branchName, textAlign: TextAlign.center),
          Text(receipt.operatorName, textAlign: TextAlign.center),
          const Divider(),
          Expanded(
            child: ListView(
              children: [
                for (final raw in cart.items)
                  Builder(
                    builder: (context) {
                      final line = CartItem.fromJson(raw);
                      return ListTile(
                        title: Text(line.productName),
                        subtitle: Text(
                          [
                            if (line.variant != null)
                              line.variant!['name'] as String,
                            ...line.modifiers.map(
                              (modifier) => modifier['name']! as String,
                            ),
                          ].join(' · '),
                        ),
                        trailing: Text('${line.quantity}'),
                      );
                    },
                  ),
              ],
            ),
          ),
          _AmountRow(label: l.taxLabel, value: _money(preview.tax)),
          _AmountRow(
            label: l.totalLabel,
            value: _money(preview.grandTotal),
            emphasized: true,
          ),
          _AmountRow(
            label: l.cashReceivedLabel,
            value: _money({
              'currency': snapshot.currency,
              'minorUnits': snapshot.amountReceivedMinorUnits,
            }),
          ),
          _AmountRow(
            label: l.changeDueLabel,
            value: _money({
              'currency': snapshot.currency,
              'minorUnits': snapshot.changeDueMinorUnits,
            }),
          ),
          Text('${l.businessDateLabel}: ${snapshot.businessDate}'),
          const Spacer(),
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: Text(l.returnToCatalogAction),
          ),
        ],
      ),
    );
  }

  Future<void> _confirm(BuildContext context) async {
    final l = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l.confirmSaleTitle),
        content: Text(l.confirmSaleBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l.closeAction),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(l.confirmAction),
          ),
        ],
      ),
    );
    if (confirmed ?? false) await widget.checkout.confirm();
  }

  Widget _unknown(BuildContext context, CheckoutResult result) {
    final l = AppLocalizations.of(context);
    final failure = result.failure;
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Icon(Icons.help_outline, size: 64),
        Text(
          l.paymentUnknownTitle,
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        Text(l.paymentUnknownBody, textAlign: TextAlign.center),
        if (failure != null)
          SelectableText('${l.correlationLabel}: ${failure['correlationId']}'),
        const SizedBox(height: UmiSpacing.lg),
        FilledButton.tonal(
          onPressed: widget.checkout.queryUnknownPayment,
          child: Text(l.queryPaymentAction),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l.closeAction),
        ),
      ],
    );
  }

  Widget _receipt(BuildContext context, CheckoutResult result) {
    final l = AppLocalizations.of(context);
    final receipt = ReceiptSnapshot.fromJson(result.receipt!);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(Icons.check_circle_outline, size: 64),
        Text(
          l.saleCompletedTitle,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        SelectableText(receipt.receiptRef, textAlign: TextAlign.center),
        const Divider(),
        Expanded(
          child: ListView(
            children: [
              ...receipt.lines.map((raw) {
                final line = ReceiptLineSnapshot.fromJson(raw);
                return ListTile(
                  title: Text(line.description),
                  subtitle: Text(
                    '${line.quantity} × ${_money(line.unitPrice)}',
                  ),
                  trailing: Text(_money(line.lineTotal)),
                );
              }),
              const Divider(),
              _AmountRow(
                label: l.totalLabel,
                value: _money(receipt.grandTotal),
                emphasized: true,
              ),
              Text('${l.businessDateLabel}: ${receipt.businessDate}'),
            ],
          ),
        ),
        FilledButton(
          onPressed: () async {
            if (!committed) {
              committed = true;
              await widget.sales.checkoutCommitted();
            }
            if (context.mounted) Navigator.pop(context);
          },
          child: Text(l.finishSaleAction),
        ),
      ],
    );
  }

  Widget _checkoutError(BuildContext context, String? code) {
    final l = AppLocalizations.of(context);
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.error_outline, size: 64),
          Text(l.checkoutFailed),
          FilledButton.tonal(
            onPressed: widget.checkout.reset,
            child: Text(l.retryAction),
          ),
        ],
      ),
    );
  }
}

final class _AmountRow extends StatelessWidget {
  const _AmountRow({
    required this.label,
    required this.value,
    this.emphasized = false,
  });
  final String label;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label),
        Text(
          value,
          style: emphasized ? Theme.of(context).textTheme.headlineSmall : null,
        ),
      ],
    ),
  );
}
