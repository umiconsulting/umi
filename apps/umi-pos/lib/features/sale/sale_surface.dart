import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import '../exception/exception_controller.dart';
import '../exception/exception_surface.dart';
import 'sale_lifecycle_controller.dart';

Future<void> showSuspendSaleDialog(
  BuildContext context,
  SaleLifecycleController lifecycle,
) async {
  final l = AppLocalizations.of(context);
  final label = TextEditingController();
  final accepted = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l.suspendSaleAction),
      content: TextField(
        controller: label,
        autofocus: true,
        maxLength: 120,
        decoration: InputDecoration(labelText: l.suspendedSaleLabel),
        onSubmitted: (_) => Navigator.pop(dialogContext, true),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext, false),
          child: Text(l.closeAction),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(dialogContext, true),
          child: Text(l.suspendSaleAction),
        ),
      ],
    ),
  );
  if (accepted ?? false) await lifecycle.suspend(label.text);
  label.dispose();
}

Future<void> showCancelSaleDialog(
  BuildContext context,
  SaleLifecycleController lifecycle,
) async {
  final l = AppLocalizations.of(context);
  final reason = TextEditingController();
  final accepted = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l.confirmCancelSaleTitle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l.confirmCancelSaleBody),
          const SizedBox(height: UmiSpacing.md),
          TextField(
            controller: reason,
            autofocus: true,
            maxLength: 160,
            decoration: InputDecoration(labelText: l.cancelSaleReasonLabel),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext, false),
          child: Text(l.closeAction),
        ),
        FilledButton.tonal(
          onPressed: () =>
              Navigator.pop(dialogContext, reason.text.trim().isNotEmpty),
          child: Text(l.cancelSaleAction),
        ),
      ],
    ),
  );
  if (accepted ?? false) await lifecycle.cancel(reason.text);
  reason.dispose();
}

Future<void> showCustomerPicker(
  BuildContext context,
  SaleLifecycleController lifecycle,
) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  constraints: const BoxConstraints(maxWidth: 680),
  builder: (_) => _CustomerPicker(lifecycle: lifecycle),
);

Future<void> showSaleCenter(
  BuildContext context,
  SaleLifecycleController lifecycle,
  [SaleExceptionController? exceptions]
) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  constraints: const BoxConstraints(maxWidth: 820),
  builder: (_) => _SaleCenter(lifecycle: lifecycle, exceptions: exceptions),
);

final class _CustomerPicker extends StatefulWidget {
  const _CustomerPicker({required this.lifecycle});
  final SaleLifecycleController lifecycle;

  @override
  State<_CustomerPicker> createState() => _CustomerPickerState();
}

final class _CustomerPickerState extends State<_CustomerPicker> {
  final search = TextEditingController();

  @override
  void initState() {
    super.initState();
    widget.lifecycle.addListener(_changed);
    widget.lifecycle.searchCustomers('', recent: true);
  }

  @override
  void dispose() {
    widget.lifecycle.removeListener(_changed);
    search.dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final current = widget.lifecycle.state.sale?.customer;
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .75,
        child: Padding(
          padding: const EdgeInsets.all(UmiSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l.currentCustomerLabel,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: UmiSpacing.sm),
              Text(
                current == null
                    ? l.anonymousCustomerLabel
                    : SaleCustomerSummary.fromJson(current).displayName,
              ),
              const SizedBox(height: UmiSpacing.md),
              TextField(
                controller: search,
                autofocus: true,
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search),
                  hintText: l.searchCustomerHint,
                ),
                onChanged: widget.lifecycle.searchCustomers,
              ),
              const SizedBox(height: UmiSpacing.md),
              if (current != null)
                OutlinedButton.icon(
                  onPressed: () async {
                    await widget.lifecycle.detachCustomer();
                    if (context.mounted) Navigator.pop(context);
                  },
                  icon: const Icon(Icons.person_off_outlined),
                  label: Text(l.detachCustomerAction),
                ),
              Expanded(
                child: ListView.builder(
                  itemCount: widget.lifecycle.state.customers.length,
                  itemBuilder: (context, index) {
                    final customer = widget.lifecycle.state.customers[index];
                    return ListTile(
                      minTileHeight: 52,
                      leading: const Icon(Icons.person_outline),
                      title: Text(customer.displayName),
                      subtitle: customer.contactHint == null
                          ? null
                          : Text(customer.contactHint!),
                      onTap: () async {
                        await widget.lifecycle.attachCustomer(customer);
                        if (context.mounted) Navigator.pop(context);
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

final class _SaleCenter extends StatefulWidget {
  const _SaleCenter({required this.lifecycle, this.exceptions});
  final SaleLifecycleController lifecycle;
  final SaleExceptionController? exceptions;

  @override
  State<_SaleCenter> createState() => _SaleCenterState();
}

final class _SaleCenterState extends State<_SaleCenter> {
  final search = TextEditingController();
  String? filter;
  String sort = 'newest';

  @override
  void initState() {
    super.initState();
    widget.lifecycle.addListener(_changed);
    widget.lifecycle.loadHistory();
  }

  @override
  void dispose() {
    widget.lifecycle.removeListener(_changed);
    search.dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  Future<void> _reload() => widget.lifecycle.loadHistory(
    state: filter,
    search: search.text,
    sort: sort,
  );

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .88,
        child: Padding(
          padding: const EdgeInsets.all(UmiSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l.saleHistoryTitle,
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: UmiSpacing.md),
              TextField(
                controller: search,
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search),
                  hintText: l.saleSearchHint,
                ),
                onSubmitted: (_) => _reload(),
              ),
              const SizedBox(height: UmiSpacing.sm),
              Wrap(
                spacing: UmiSpacing.sm,
                runSpacing: UmiSpacing.sm,
                children: [
                  _Filter(
                    label: l.saleHistoryTitle,
                    selected: filter == null,
                    onSelected: () {
                      setState(() => filter = null);
                      _reload();
                    },
                  ),
                  _Filter(
                    label: l.suspendedSalesLabel,
                    selected: filter == 'suspended',
                    onSelected: () {
                      setState(() => filter = 'suspended');
                      _reload();
                    },
                  ),
                  _Filter(
                    label: l.committedSalesLabel,
                    selected: filter == 'committed',
                    onSelected: () {
                      setState(() => filter = 'committed');
                      _reload();
                    },
                  ),
                  _Filter(
                    label: l.cancelledSalesLabel,
                    selected: filter == 'cancelled',
                    onSelected: () {
                      setState(() => filter = 'cancelled');
                      _reload();
                    },
                  ),
                  DropdownButton<String>(
                    value: sort,
                    items: [
                      DropdownMenuItem(
                        value: 'newest',
                        child: Text(l.sortNewestLabel),
                      ),
                      DropdownMenuItem(
                        value: 'oldest',
                        child: Text(l.sortOldestLabel),
                      ),
                    ],
                    onChanged: (value) {
                      if (value == null) return;
                      setState(() => sort = value);
                      _reload();
                    },
                  ),
                ],
              ),
              const SizedBox(height: UmiSpacing.md),
              Expanded(
                child: widget.lifecycle.state.history.isEmpty
                    ? Center(child: Text(l.saleHistoryEmpty))
                    : ListView.separated(
                        itemCount:
                            widget.lifecycle.state.history.length +
                            (widget.lifecycle.canLoadMoreHistory ? 1 : 0),
                        separatorBuilder: (_, _) => const Divider(),
                        itemBuilder: (context, index) {
                          if (index == widget.lifecycle.state.history.length) {
                            return Padding(
                              padding: const EdgeInsets.all(UmiSpacing.md),
                              child: FilledButton.tonal(
                                onPressed: widget.lifecycle.historyLoading
                                    ? null
                                    : widget.lifecycle.loadMoreHistory,
                                child: Text(l.loadMoreSalesAction),
                              ),
                            );
                          }
                          final sale = widget.lifecycle.state.history[index];
                          final cart = Cart.fromJson(sale.cart);
                          final customer = sale.customer == null
                              ? null
                              : SaleCustomerSummary.fromJson(sale.customer!);
                          return ListTile(
                            minTileHeight: 64,
                            leading: Icon(_stateIcon(sale.state)),
                            title: Text(
                              sale.label ??
                                  '${l.saleNameFallback} ${sale.id.substring(0, 8)}',
                            ),
                            subtitle: Text(
                              [
                                _stateLabel(l, sale.state),
                                customer?.displayName ??
                                    l.anonymousCustomerLabel,
                                cart.totals['businessDate'] as String,
                              ].join(' · '),
                            ),
                            trailing: Wrap(
                              spacing: UmiSpacing.sm,
                              children: [
                                if (sale.state == 'suspended')
                                  IconButton(
                                    tooltip: l.renameSaleAction,
                                    onPressed: () => _rename(context, sale),
                                    icon: const Icon(Icons.edit_outlined),
                                  ),
                                if (sale.state == 'suspended')
                                  FilledButton.tonal(
                                    onPressed:
                                        widget.lifecycle.canResumeSuspendedSale
                                        ? () async {
                                            await widget.lifecycle.resume(sale);
                                            if (context.mounted &&
                                                widget.lifecycle.state.phase ==
                                                    SalePhase.recovered) {
                                              Navigator.pop(context);
                                            }
                                          }
                                        : null,
                                    child: Text(l.resumeSaleAction),
                                  ),
                                if (sale.state == 'committed' &&
                                    widget.exceptions != null)
                                  IconButton(
                                    tooltip: l.saleExceptionAction,
                                    onPressed: () => showSaleExceptionDialog(
                                      context,
                                      controller: widget.exceptions!,
                                      saleId: sale.id,
                                    ),
                                    icon: const Icon(
                                      Icons.assignment_return_outlined,
                                    ),
                                  ),
                                if (sale.state == 'committed')
                                  IconButton(
                                    tooltip: l.reprintReceiptAction,
                                    onPressed: () async {
                                      await widget.lifecycle.openReceipt(sale);
                                      if (context.mounted) {
                                        await _showReceipt(
                                          context,
                                          widget.lifecycle.state.receipt,
                                        );
                                      }
                                    },
                                    icon: const Icon(
                                      Icons.receipt_long_outlined,
                                    ),
                                  ),
                              ],
                            ),
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _rename(BuildContext context, SaleSnapshot sale) async {
    final l = AppLocalizations.of(context);
    final label = TextEditingController(text: sale.label);
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l.renameSaleAction),
        content: TextField(
          controller: label,
          autofocus: true,
          maxLength: 120,
          decoration: InputDecoration(labelText: l.suspendedSaleLabel),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(l.closeAction),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(dialogContext, label.text.trim().isNotEmpty),
            child: Text(l.confirmAction),
          ),
        ],
      ),
    );
    if (accepted ?? false) {
      await widget.lifecycle.renameSuspended(sale, label.text);
    }
    label.dispose();
  }
}

final class _Filter extends StatelessWidget {
  const _Filter({
    required this.label,
    required this.selected,
    required this.onSelected,
  });
  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) => ChoiceChip(
    label: Text(label),
    selected: selected,
    onSelected: (_) => onSelected(),
  );
}

Future<void> _showReceipt(
  BuildContext context,
  SaleReceiptResult? result,
) async {
  final l = AppLocalizations.of(context);
  final raw = result?.receipt;
  if (raw == null) return;
  final receipt = ReceiptSnapshot.fromJson(raw);
  await showDialog<void>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l.receiptAvailableMessage),
      content: SizedBox(
        width: 520,
        child: ListView(
          shrinkWrap: true,
          children: [
            SelectableText(receipt.receiptRef),
            const Divider(),
            for (final rawLine in receipt.lines)
              Builder(
                builder: (_) {
                  final line = ReceiptLineSnapshot.fromJson(rawLine);
                  return ListTile(
                    title: Text(line.description),
                    trailing: Text('${line.quantity}'),
                  );
                },
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext),
          child: Text(l.closeAction),
        ),
      ],
    ),
  );
}

String _stateLabel(AppLocalizations l, String state) => switch (state) {
  'suspended' => l.saleStateSuspended,
  'committed' => l.saleStateCommitted,
  'cancelled' => l.saleStateCancelled,
  'recovered' => l.saleStateRecovered,
  _ => l.saleStateBuilding,
};

IconData _stateIcon(String state) => switch (state) {
  'suspended' => Icons.pause_circle_outline,
  'committed' => Icons.check_circle_outline,
  'cancelled' => Icons.cancel_outlined,
  'recovered' => Icons.restore_outlined,
  _ => Icons.shopping_cart_outlined,
};
