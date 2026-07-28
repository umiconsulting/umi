import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import '../cart/cart_controller.dart';
import '../entry/entry_controller.dart';
import 'checkout_controller.dart';

Future<void> showCheckoutSheet(
  BuildContext context, {
  required CheckoutController checkout,
  required CartController cart,
  required EntryController entry,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  builder: (_) => _CheckoutSheet(checkout: checkout, cart: cart, entry: entry),
);

final class _CheckoutSheet extends StatefulWidget {
  const _CheckoutSheet({
    required this.checkout,
    required this.cart,
    required this.entry,
  });
  final CheckoutController checkout;
  final CartController cart;
  final EntryController entry;

  @override
  State<_CheckoutSheet> createState() => _CheckoutSheetState();
}

final class _CheckoutSheetState extends State<_CheckoutSheet> {
  String method = 'cash';

  @override
  void initState() {
    super.initState();
    widget.checkout.reset();
    widget.checkout.addListener(_changed);
  }

  @override
  void dispose() {
    widget.checkout.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
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
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .9,
        child: Padding(
          padding: const EdgeInsets.all(UmiSpacing.lg),
          child: switch (state.phase) {
            CheckoutPhase.completed => _receipt(context, state.result!),
            CheckoutPhase.paymentUnknown => _unknown(context, state.result!),
            CheckoutPhase.processing || CheckoutPhase.repricing => Center(
              child: Semantics(
                liveRegion: true,
                label: l.paymentProcessing,
                child: const CircularProgressIndicator(),
              ),
            ),
            CheckoutPhase.failure => _checkoutError(context, state.errorCode),
            _ => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
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
                Text('${l.businessDateLabel}: ${totals.businessDate}'),
                const SizedBox(height: UmiSpacing.lg),
                Text(
                  l.paymentMethodLabel,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                Wrap(
                  spacing: 12,
                  children: [
                    ChoiceChip(
                      label: Text(l.cashPayment),
                      selected: method == 'cash',
                      onSelected: state.phase == CheckoutPhase.idle
                          ? (_) => setState(() => method = 'cash')
                          : null,
                    ),
                    ChoiceChip(
                      label: Text(l.externalTerminalPayment),
                      selected: method == 'external_terminal',
                      onSelected: state.phase == CheckoutPhase.idle
                          ? (_) => setState(() => method = 'external_terminal')
                          : null,
                    ),
                  ],
                ),
                if (state.phase == CheckoutPhase.confirmationRequired) ...[
                  const SizedBox(height: UmiSpacing.lg),
                  Semantics(
                    liveRegion: true,
                    child: Text(l.totalsConfirmedBody),
                  ),
                ],
                const Spacer(),
                FilledButton(
                  onPressed: state.phase == CheckoutPhase.confirmationRequired
                      ? () => _confirm(context)
                      : () => widget.checkout.preview(
                          tenantId: cart.tenantId,
                          branchId: cart.branchId,
                          operatorSessionId: cart.operatorSessionId,
                          cartId: cart.id,
                          cartVersion: cart.version,
                          paymentMethod: method,
                        ),
                  child: Text(
                    state.phase == CheckoutPhase.confirmationRequired
                        ? l.confirmAndPayAction
                        : l.reviewTotalsAction,
                  ),
                ),
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: Text(l.closeAction),
                ),
              ],
            ),
          },
        ),
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
            final tenant = widget.entry.state.selectedTenant;
            final branch = widget.entry.state.selectedBranch;
            final operator = widget.entry.state.operator;
            widget.cart.clearLocal();
            if (tenant != null && branch != null && operator != null) {
              await widget.cart.open(tenant.id, branch.id, operator.id);
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
          Text(code ?? 'CHECKOUT_FAILED'),
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
