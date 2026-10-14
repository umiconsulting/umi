import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import '../../core/errors/operator_error_message.dart';
import '../../core/localization/app_localizations.dart';
import '../../core/security/operator_permissions.dart';
import '../../core/theme/umi_theme.dart';
import '../../shared/money.dart';
import '../../shared/widgets/inline_notice.dart';
import '../../shared/widgets/receipt_print_action.dart';
import '../../shared/widgets/station_document.dart';
import '../exception/exception_controller.dart';
import '../exception/exception_surface.dart';
import 'sale_lifecycle_controller.dart';

Future<void> showSuspendSaleDialog(
  BuildContext context,
  SaleLifecycleController lifecycle,
) async {
  final l = AppLocalizations.of(context);
  final sale = lifecycle.state.sale;
  final accepted = await showPosDialog<bool>(
    context: context,
    builder: (dialogContext) => PosAlertDialog(
      title: Text(l.suspendSaleAction),
      content: Text(sale == null ? l.saleNameFallback : _historyLabel(sale, l)),
      actions: [
        PosTextButton(
          onPressed: () => Navigator.pop(dialogContext, false),
          child: Text(l.closeAction),
        ),
        PosButton(
          onPressed: () => Navigator.pop(dialogContext, true),
          child: Text(l.suspendSaleAction),
        ),
      ],
    ),
  );
  if (accepted ?? false) await lifecycle.suspend(null);
}

/// WHY a sale is cancelled, as a typed choice (plan §8.3).
///
/// The list is small on purpose. The legacy till this café left recorded free text,
/// and 16 of its 17 cancellations said "prueba" — so the reason is chosen from these
/// four, and the operator's words are an optional note, never the only record.
final List<({String code, String Function(AppLocalizations) label})>
cancelSaleReasons = [
  (code: 'customer_changed', label: (l) => l.cancelReasonCustomerChanged),
  (code: 'operator_mistake', label: (l) => l.cancelReasonOperatorMistake),
  (code: 'duplicate', label: (l) => l.cancelReasonDuplicate),
  (code: 'other', label: (l) => l.cancelReasonOther),
];

Future<void> showCancelSaleDialog(
  BuildContext context,
  SaleLifecycleController lifecycle,
) async {
  final l = AppLocalizations.of(context);
  final note = TextEditingController();
  String? reasonCode;
  final accepted = await showPosDialog<bool>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (dialogContext, setState) => PosAlertDialog(
        title: Text(l.confirmCancelSaleTitle),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(l.confirmCancelSaleBody),
              const SizedBox(height: UmiSpacing.sm),
              Text(
                l.cancelSaleReasonLabel,
                style: PosTheme.of(context).textTheme.titleSmall,
              ),
              // The reason is a choice, not a sentence: the operator answers from
              // the list and the till records a fact it can count.
              for (final reason in cancelSaleReasons)
                PosListRow(
                  contentPadding: EdgeInsets.zero,
                  leading: PosIcon(
                    reasonCode == reason.code
                        ? PosGlyphs.radioButtonChecked
                        : PosGlyphs.radioButtonUnchecked,
                  ),
                  title: Text(reason.label(l)),
                  onTap: () => setState(() {
                    reasonCode = reason.code;
                    if (reasonCode != 'other') note.clear();
                  }),
                ),
              if (reasonCode == 'other') ...[
                const SizedBox(height: UmiSpacing.sm),
                PosField(
                  controller: note,
                  maxLength: 160,
                  decoration: PosFieldDecoration(
                    labelText: l.otherReasonDetailLabel,
                  ),
                  onChanged: (_) => setState(() {}),
                ),
              ],
            ],
          ),
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(l.closeAction),
          ),
          PosButton.tonal(
            // A cancellation always names a reason: without one there is nothing to
            // count, which is the state this dialog exists to end.
            onPressed:
                reasonCode == null ||
                    (reasonCode == 'other' && note.text.trim().isEmpty)
                ? null
                : () => Navigator.pop(dialogContext, true),
            child: Text(l.cancelSaleAction),
          ),
        ],
      ),
    ),
  );
  final chosen = reasonCode;
  if ((accepted ?? false) && chosen != null) {
    await lifecycle.cancel(chosen, note: chosen == 'other' ? note.text : null);
    // A cancelled account leaves the screen. In open-accounts mode, keep the
    // next folio unallocated until an operator starts an actual order.
    if (lifecycle.state.phase == SalePhase.cancelled) {
      if (!lifecycle.finishCancellationPresentation()) {
        await lifecycle.newSale();
      }
    }
  }
  note.dispose();
}

Future<void> showCustomerPicker(
  BuildContext context,
  SaleLifecycleController lifecycle,
) => showPosSheet<void>(
  context: context,
  isScrollControlled: true,
  // The list is a choice, not a search: the operator reads the recent customers
  // first, and the keyboard waits for a tap on the field.
  showDragHandle: true,
  constraints: const BoxConstraints(maxWidth: 680),
  builder: (_) => _CustomerPicker(lifecycle: lifecycle),
);

Future<void> showSaleCenter(
  BuildContext context,
  SaleLifecycleController lifecycle,
  OperatorPermissions permissions, [
  SaleExceptionController? exceptions,
  ReceiptPrintRequest? onPrint,
  Future<PosKitchenStatusResult> Function(SaleSnapshot sale)? onKitchenStatus,
]) => Navigator.of(context).push<void>(
  PosPageRoute<void>(
    builder: (_) => SaleCenterSurface(
      lifecycle: lifecycle,
      permissions: permissions,
      exceptions: exceptions,
      onPrint: onPrint,
      onKitchenStatus: onKitchenStatus,
    ),
  ),
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
                style: PosTheme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: UmiSpacing.sm),
              Text(
                current == null
                    ? l.anonymousCustomerLabel
                    : SaleCustomerSummary.fromJson(current).displayName,
              ),
              const SizedBox(height: UmiSpacing.md),
              PosField(
                controller: search,
                decoration: PosFieldDecoration(
                  prefixIcon: const PosIcon(PosGlyphs.search),
                  hintText: l.searchCustomerHint,
                ),
                onChanged: widget.lifecycle.searchCustomers,
              ),
              const SizedBox(height: UmiSpacing.md),
              if (current != null)
                PosOutlineButton.icon(
                  onPressed: () async {
                    await widget.lifecycle.detachCustomer();
                    if (context.mounted) Navigator.pop(context);
                  },
                  icon: const PosIcon(PosGlyphs.personOffOutlined),
                  label: Text(l.detachCustomerAction),
                ),
              Expanded(
                // AN EMPTY LIST IS NOT A BLANK SHEET.
                //
                // A café that has just installed the till has no customers, and this
                // pane drew nothing at all: the operator could not tell whether the
                // screen was broken, still loading, or simply empty. The customers
                // here arrive through OTHER channels — a WhatsApp conversation, a
                // loyalty account, a Wallet pass — so the empty state says where they
                // come from, and that a sale does not need one (owner, 2026-10-12).
                child: widget.lifecycle.state.customers.isEmpty
                    ? _NoCustomers(search: search.text.trim())
                    : ListView.builder(
                        itemCount: widget.lifecycle.state.customers.length,
                        itemBuilder: (context, index) {
                          final customer =
                              widget.lifecycle.state.customers[index];
                          return PosListRow(
                            minTileHeight: 52,
                            leading: const PosIcon(PosGlyphs.personOutline),
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

/// Nobody in the list — and the two ways that happens are not the same fact.
final class _NoCustomers extends StatelessWidget {
  const _NoCustomers({required this.search});

  /// What the operator typed. Empty means the café has no customers yet; anything
  /// else means the search found nobody, which the operator fixes by editing it.
  final String search;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = PosTheme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            PosIcon(
              PosGlyphs.personOutline,
              size: 40,
              color: theme.colorScheme.outline,
            ),
            const SizedBox(height: UmiSpacing.md),
            Text(
              search.isEmpty
                  ? l.customerPickerEmptyTitle
                  : l.customerPickerNoMatch(search),
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium,
            ),
            if (search.isEmpty) ...[
              const SizedBox(height: UmiSpacing.sm),
              Text(
                l.customerPickerEmptyBody,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

final class SaleCenterSurface extends StatefulWidget {
  const SaleCenterSurface({
    required this.lifecycle,
    required this.permissions,
    this.exceptions,
    this.onPrint,
    this.onKitchenStatus,
    this.embedded = false,
    this.active = true,
    this.onResumed,
    super.key,
  });
  final bool embedded;
  final bool active;
  final VoidCallback? onResumed;
  final SaleLifecycleController lifecycle;
  final OperatorPermissions permissions;
  final SaleExceptionController? exceptions;
  final ReceiptPrintRequest? onPrint;
  final Future<PosKitchenStatusResult> Function(SaleSnapshot sale)?
  onKitchenStatus;

  @override
  State<SaleCenterSurface> createState() => SaleCenterSurfaceState();
}

final class SaleCenterSurfaceState extends State<SaleCenterSurface> {
  final search = TextEditingController();
  final _searchKey = GlobalKey(debugLabel: 'sale-history-search');
  final _controlsKey = GlobalKey(debugLabel: 'sale-history-controls');
  String? filter;
  String sort = 'newest';

  @override
  void initState() {
    super.initState();
    widget.lifecycle.addListener(_changed);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && widget.active) _reload();
    });
  }

  @override
  void didUpdateWidget(covariant SaleCenterSurface oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!oldWidget.active && widget.active) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && widget.active) _reload();
      });
    }
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
    return PosPage(
      appBar: PosHeader(
        automaticallyImplyLeading: false,
        title: StationHeading(title: l.saleHistoryTitle),
        leading: widget.embedded
            ? null
            : PosIconButton(
                tooltip: l.closeAction,
                onPressed: () => Navigator.pop(context),
                icon: const PosIcon(PosGlyphs.arrowBack),
              ),
      ),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1160),
            child: Padding(
              padding: const EdgeInsets.all(UmiSpacing.lg),
              child: LayoutBuilder(
                builder: (context, box) {
                  final headers = <Widget>[
                    PosField(
                      key: _searchKey,
                      controller: search,
                      decoration: PosFieldDecoration(
                        prefixIcon: const PosIcon(PosGlyphs.search),
                        hintText: l.saleSearchHint,
                      ),
                      onSubmitted: (_) => _reload(),
                    ),
                    const SizedBox(height: UmiSpacing.sm),
                    KeyedSubtree(key: _controlsKey, child: _historyControls(l)),
                    const SizedBox(height: UmiSpacing.md),
                    if (widget.lifecycle.state.errorCode
                        case final String code) ...[
                      InlineNotice(
                        message: operatorErrorMessage(context, code),
                        tone: InlineNoticeTone.error,
                      ),
                      const SizedBox(height: UmiSpacing.sm),
                    ],
                    if (!widget.lifecycle.historyRefreshing &&
                        !widget.lifecycle.historyRefreshFailed &&
                        widget.lifecycle.state.history.any(
                          (sale) => sale.state == 'suspended',
                        ) &&
                        widget.permissions.allows('sale.lifecycle') &&
                        !widget.lifecycle.canResumeFromHistory &&
                        const {
                          SalePhase.buildingCart,
                          SalePhase.readyForCheckout,
                          SalePhase.recovered,
                        }.contains(widget.lifecycle.state.phase)) ...[
                      InlineNotice(
                        message: l.resumeCurrentOrderHint,
                        tone: InlineNoticeTone.warning,
                      ),
                      const SizedBox(height: UmiSpacing.sm),
                    ],
                    if (widget.lifecycle.historyRefreshing) const PosProgress(),
                  ];
                  final status = _historyStatus(l);
                  final count =
                      widget.lifecycle.state.history.length +
                      (widget.lifecycle.canLoadMoreHistory ? 1 : 0);
                  final reflow =
                      box.maxWidth < 760 &&
                      MediaQuery.textScalerOf(context).scale(16) >= 24;
                  if (reflow) {
                    return CustomScrollView(
                      key: const PageStorageKey('sale-history-flow'),
                      slivers: [
                        for (final header in headers)
                          SliverToBoxAdapter(child: header),
                        if (status != null)
                          SliverToBoxAdapter(
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                vertical: UmiSpacing.lg,
                              ),
                              child: status,
                            ),
                          )
                        else
                          SliverList.separated(
                            itemCount: count,
                            findItemIndexCallback: _historyItemIndex,
                            itemBuilder: (context, index) =>
                                _historyItem(context, l, index),
                            separatorBuilder: (_, _) => const PosDivider(),
                          ),
                      ],
                    );
                  }
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      ...headers,
                      Expanded(
                        child:
                            status ??
                            ListView.separated(
                              key: const PageStorageKey('sale-history-list'),
                              itemCount: count,
                              itemBuilder: (context, index) =>
                                  _historyItem(context, l, index),
                              separatorBuilder: (_, _) => const PosDivider(),
                            ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget? _historyStatus(AppLocalizations l) =>
      widget.lifecycle.historyRefreshing
      ? Center(
          child: Semantics(liveRegion: true, child: Text(l.saleHistoryLoading)),
        )
      : widget.lifecycle.historyRefreshFailed
      ? Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(l.saleHistoryLoadFailed),
              const SizedBox(height: UmiSpacing.sm),
              PosButton.tonal(onPressed: _reload, child: Text(l.retryAction)),
            ],
          ),
        )
      : widget.lifecycle.state.history.isEmpty
      ? Center(
          child: Semantics(
            liveRegion: true,
            child: Text(
              search.text.trim().isNotEmpty
                  ? l.saleHistoryNoMatches
                  : l.saleHistoryEmpty,
            ),
          ),
        )
      : null;

  int? _historyItemIndex(Key key) {
    if (key == const ValueKey('history-load-more')) {
      return widget.lifecycle.canLoadMoreHistory
          ? widget.lifecycle.state.history.length
          : null;
    }
    if (key is! ValueKey<String>) return null;
    final index = widget.lifecycle.state.history.indexWhere(
      (sale) => sale.id == key.value,
    );
    return index < 0 ? null : index;
  }

  /// The mark on a sale in the list: the state's glyph in white on a filled tile.
  ///
  /// THE ONE SALE THAT WENT THROUGH IS BLUE; THE REST ARE GREY (owner, 2026-10-12).
  /// A committed sale is the only one that leaves the till as money in the drawer,
  /// and it used to be drawn with the same thin outline as a cart still being built,
  /// so the eye had to read the words to know which rows had already happened. The
  /// tile is filled — the palette's blue for the sale that closed, the muted grey it
  /// keeps for what is not finished for everything else — and the glyph sits in
  /// white on top of it, which is what makes a column of them readable across the
  /// room.
  ///
  /// A tile and not a disc: the owner asked for the marks to stop being circles
  /// (2026-10-12). The shape is the same rounded square every other control in the
  /// till uses, so the mark reads as part of the app rather than as a badge borrowed
  /// from somewhere else.
  Widget _stateBadge(BuildContext context, String state) {
    final palette = PosTheme.of(context).colorScheme;
    final committed = state == 'committed';
    return DecoratedBox(
      key: const ValueKey('sale-state-badge'),
      decoration: BoxDecoration(
        color: committed ? palette.primary : palette.onSurfaceVariant,
        borderRadius: BorderRadius.circular(PosGeometry.controlRadius),
      ),
      child: Padding(
        padding: const EdgeInsets.all(5),
        child: PosIcon(
          committed ? PosGlyphs.check : _stateIcon(state),
          size: 16,
          strokeWidth: state == 'suspended' || state == 'cancelled' ? 3 : 1.65,
          color: PosColors.white,
        ),
      ),
    );
  }

  Widget _historyItem(BuildContext context, AppLocalizations l, int index) {
    if (index == widget.lifecycle.state.history.length) {
      return Padding(
        key: const ValueKey('history-load-more'),
        padding: const EdgeInsets.all(UmiSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (widget.lifecycle.historyErrorCode case final String code) ...[
              InlineNotice(
                message: operatorErrorMessage(context, code),
                tone: InlineNoticeTone.error,
              ),
              const SizedBox(height: UmiSpacing.sm),
            ],
            if (widget.lifecycle.historyLoading) ...[
              const PosProgress(),
              const SizedBox(height: UmiSpacing.sm),
            ],
            PosButton.tonal(
              onPressed: widget.lifecycle.historyLoading
                  ? null
                  : widget.lifecycle.loadMoreHistory,
              child: Text(
                widget.lifecycle.historyErrorCode == null
                    ? l.loadMoreSalesAction
                    : l.retryAction,
              ),
            ),
          ],
        ),
      );
    }
    final sale = widget.lifecycle.state.history[index];
    final customer = sale.customer == null
        ? null
        : SaleCustomerSummary.fromJson(sale.customer!);
    return _SaleHistoryRecord(
      key: ValueKey(sale.id),
      sale: sale,
      leading: _stateBadge(context, sale.state),
      title: Text(_historyLabel(sale, l)),
      subtitle: Text(
        [
          _saleMoment(sale),
          _stateLabel(l, sale.state),
          customer?.displayName ?? l.anonymousCustomerLabel,
        ].join(' · '),
      ),
      // THE ROW'S OWN MENU RIDES BESIDE THE AMOUNT.
      //
      // It used to sit on a line of its own under the row, which pushed every
      // committed sale two lines taller and put the only control that acts on the
      // sale away from the number it acts on (owner, 2026-10-12). The labelled
      // action a parked sale needs — "Reanudar venta" — keeps its own line below,
      // where a button that wide belongs.
      trailingInline: sale.state == 'committed'
          ? _saleActionsMenu(context, sale, l)
          : null,
      trailing: sale.state == 'suspended'
          ? PosButton.tonal(
              onPressed:
                  widget.permissions.allows('sale.lifecycle') &&
                      widget.lifecycle.canResumeFromHistory
                  ? () async {
                      await widget.lifecycle.resumeFromHistory(sale);
                      if (context.mounted &&
                          widget.lifecycle.state.phase == SalePhase.recovered) {
                        if (widget.onResumed != null) {
                          widget.onResumed!();
                        } else {
                          Navigator.pop(context);
                        }
                      }
                    }
                  : null,
              child: Text(l.resumeSaleAction),
            )
          : null,
    );
  }

  /// Post-sale actions were three look-alike, icon-only buttons. Collect them into
  /// one clearly labelled menu so each choice reads as a full action, not a guessed
  /// glyph.
  Widget _saleActionsMenu(
    BuildContext context,
    SaleSnapshot sale,
    AppLocalizations l,
  ) {
    return PosMenuButton<String>(
      tooltip: Localizations.localeOf(context).languageCode == 'es'
          ? 'Acciones de la venta'
          : 'Sale actions',
      icon: const PosIcon(PosGlyphs.moreVert),
      onSelected: (value) async {
        switch (value) {
          case 'kitchen':
            await _showKitchenStatus(context, sale);
          case 'exception':
            await showSaleExceptionDialog(
              context,
              controller: widget.exceptions!,
              saleId: sale.committedSaleId ?? sale.id,
            );
          case 'reprint':
            await widget.lifecycle.openReceipt(sale);
            if (context.mounted) {
              await _showReceipt(
                context,
                widget.lifecycle.state.receipt,
                receiptId: sale.receiptId,
                onPrint: widget.onPrint,
                canPrint: widget.permissions.allows('hardware.printer.print'),
              );
            }
        }
      },
      itemBuilder: (_) => [
        if (sale.sourceOrderId != null && widget.onKitchenStatus != null)
          PosMenuItem(
            value: 'kitchen',
            child: _MenuAction(
              icon: PosGlyphs.soupKitchenOutlined,
              label: Localizations.localeOf(context).languageCode == 'es'
                  ? 'Estado de cocina'
                  : 'Kitchen status',
            ),
          ),
        if (widget.exceptions != null &&
            widget.permissions.allows('sale.exception.read'))
          PosMenuItem(
            value: 'exception',
            child: _MenuAction(
              icon: PosGlyphs.assignmentReturnOutlined,
              label: l.saleExceptionAction,
            ),
          ),
        PosMenuItem(
          value: 'reprint',
          child: _MenuAction(
            icon: PosGlyphs.receiptLongOutlined,
            label: l.openReceiptAction,
          ),
        ),
      ],
    );
  }

  Widget _historyControls(AppLocalizations l) => LayoutBuilder(
    builder: (context, box) {
      final choices = <(String, String)>[
        ('all', l.allSalesLabel),
        ('suspended', l.suspendedSalesLabel),
        ('cancelled', l.cancelledSalesLabel),
      ];
      void select(String? value) {
        if (value == null) return;
        setState(() => filter = value == 'all' ? null : value);
        _reload();
      }

      final compact =
          box.maxWidth < 760 || MediaQuery.textScalerOf(context).scale(16) > 22;
      final sorting = PosSelect<String>(
        value: sort,
        items: [
          PosSelectItem(
            value: 'newest',
            child: Text(compact ? l.recentSalesLabel : l.sortNewestLabel),
          ),
          PosSelectItem(
            value: 'oldest',
            child: Text(compact ? l.oldestSalesLabel : l.sortOldestLabel),
          ),
        ],
        onChanged: (value) {
          if (value == null) return;
          setState(() => sort = value);
          _reload();
        },
      );
      final filtering = compact
          ? PosSelect<String>(
              value: filter ?? 'all',
              items: [
                for (final (value, label) in choices)
                  PosSelectItem(value: value, child: Text(label)),
              ],
              onChanged: select,
            )
          : Wrap(
              spacing: UmiSpacing.sm,
              children: [
                for (final (value, label) in choices)
                  _Filter(
                    label: label,
                    selected: (filter ?? 'all') == value,
                    onSelected: () => select(value),
                  ),
              ],
            );
      if (MediaQuery.textScalerOf(context).scale(16) > 20) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            filtering,
            const SizedBox(height: UmiSpacing.sm),
            sorting,
          ],
        );
      }
      return Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: filtering),
          const SizedBox(width: UmiSpacing.sm),
          SizedBox(width: compact ? 144 : 204, child: sorting),
        ],
      );
    },
  );

  Future<void> _showKitchenStatus(
    BuildContext context,
    SaleSnapshot sale,
  ) async {
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    try {
      final result = await widget.onKitchenStatus!(sale);
      if (!context.mounted) return;
      await showPosDialog<void>(
        context: context,
        builder: (dialogContext) => PosAlertDialog(
          title: Text(spanish ? 'Estado de cocina' : 'Kitchen status'),
          content: Text(_kitchenStatusLabel(result.status, spanish)),
          actions: [
            PosTextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: Text(spanish ? 'Cerrar' : 'Close'),
            ),
          ],
        ),
      );
    } catch (_) {
      if (!context.mounted) return;
      // The operator asked a question and gets an answer either way, in the
      // same dialog the successful path uses. A silent catch would leave the
      // press doing visibly nothing.
      await showPosDialog<void>(
        context: context,
        builder: (dialogContext) => PosAlertDialog(
          title: Text(spanish ? 'Estado de cocina' : 'Kitchen status'),
          content: Text(
            spanish
                ? 'No se pudo obtener el estado de cocina.'
                : 'Kitchen status is not available.',
          ),
          actions: [
            PosTextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: Text(spanish ? 'Cerrar' : 'Close'),
            ),
          ],
        ),
      );
    }
  }
}

String _kitchenStatusLabel(String status, bool spanish) => switch (status) {
  'queued' => spanish ? 'En cola' : 'Queued',
  'in_preparation' => spanish ? 'En preparación' : 'Preparing',
  'partially_ready' => spanish ? 'Parcialmente lista' : 'Partially ready',
  'ready' => spanish ? 'Lista' : 'Ready',
  'completed' => spanish ? 'Completada' : 'Completed',
  'cancelled' => spanish ? 'Cancelada' : 'Cancelled',
  'exception' => spanish ? 'Requiere atención' : 'Needs attention',
  _ => spanish ? 'Estado no disponible' : 'Status unavailable',
};

String _historyLabel(SaleSnapshot sale, AppLocalizations l) {
  final items = (sale.cart['items'] as List<Object?>)
      .cast<Map<String, Object?>>();
  final names = items
      .map((item) => item['productName'] as String)
      .toSet()
      .toList();
  // THE SALE IS NAMED BY ITS ACCOUNT, AND SAYS WHAT WAS ORDERED.
  //
  // The list used to title a row with whatever label the sale carried — a table, a
  // customer, or the first product on the ticket — so the same row could not be
  // matched to the account the crew had been calling out. The folio is the one name
  // that is unique and short, and the owner asked for the articles to ride with it
  // (2026-10-12): "Cuenta 088 · Cappuccino" says both what to call the sale and what
  // was in it, without opening anything.
  final folio = (sale.cart['accountFolio'] as String?)?.trim();
  if (folio != null && folio.isNotEmpty) {
    return names.isEmpty ? folio : '$folio · ${names.join(' · ')}';
  }
  final label = sale.label?.trim();
  if (label != null && label.isNotEmpty) return label;
  if (names.isEmpty) return l.saleNameFallback;
  return names.length == 1
      ? names.first
      : '${names.first} +${names.length - 1}';
}

final class _SaleHistoryRecord extends StatelessWidget {
  const _SaleHistoryRecord({
    required this.sale,
    required this.leading,
    required this.title,
    required this.subtitle,
    this.trailingInline,
    this.trailing,
    super.key,
  });
  final SaleSnapshot sale;
  final Widget leading, title, subtitle;

  /// The control that belongs on the amount's own line — the sale's menu.
  final Widget? trailingInline;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final totals = sale.cart['totals'] as Map<String, Object?>;
    final amount = totals['grandTotal'] as Map<String, Object?>;
    final price = formatMinorUnits(
      (amount['minorUnits'] as num).toInt(),
      amount['currency'] as String? ?? '',
    );
    final name = DefaultTextStyle(
      style: theme.textTheme.titleMedium!,
      child: title,
    );
    final total = Text(price, style: theme.textTheme.titleMedium);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UmiSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(padding: const EdgeInsets.only(top: 4), child: leading),
          const SizedBox(width: UmiSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                LayoutBuilder(
                  builder: (context, constraints) =>
                      constraints.maxWidth <
                          420 * MediaQuery.textScalerOf(context).scale(1)
                      ? Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            name,
                            // THE MENU KEEPS ITS LINE AT EVERY WIDTH. This narrow
                            // branch stacks the name over the amount, and it is the
                            // branch a phone at 200 % text takes — the one where a
                            // control that only existed in the other branch simply
                            // disappeared.
                            Row(
                              children: [
                                Expanded(child: total),
                                if (trailingInline != null) ...[
                                  const SizedBox(width: UmiSpacing.sm),
                                  trailingInline!,
                                ],
                              ],
                            ),
                          ],
                        )
                      : Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(child: name),
                            const SizedBox(width: UmiSpacing.md),
                            Flexible(
                              fit: FlexFit.tight,
                              child: Align(
                                alignment: Alignment.topRight,
                                child: total,
                              ),
                            ),
                            // The sale's own menu, on the amount's line: the only
                            // control that acts on the sale sits next to the number
                            // it acts on, and the row stays one line tall.
                            if (trailingInline != null) ...[
                              const SizedBox(width: UmiSpacing.sm),
                              trailingInline!,
                            ],
                          ],
                        ),
                ),
                const SizedBox(height: UmiSpacing.xs),
                DefaultTextStyle(
                  style: theme.textTheme.bodySmall!.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  child: subtitle,
                ),
                // NO RECEIPT REFERENCE BUTTON ON THE ROW. It printed the receipt's
                // own reference under every committed sale — a string the operator
                // never reads off the screen and cannot act on, in a row that already
                // carries a number, a moment, a state and a customer (owner,
                // 2026-10-12). The reference still travels: "Abrir recibo" in the
                // row's own menu opens the receipt, and the receipt is where a
                // reference belongs.
                if (trailing != null) ...[
                  const SizedBox(height: UmiSpacing.xs),
                  Wrap(
                    alignment: WrapAlignment.spaceBetween,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: UmiSpacing.sm,
                    runSpacing: UmiSpacing.xs,
                    children: [?trailing],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
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
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    return PosTapRegion(
      semanticLabel: label,
      selected: selected,
      onTap: onSelected,
      child: Container(
        constraints: const BoxConstraints(minHeight: 48),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: selected
                  ? theme.colorScheme.primary
                  : theme.colorScheme.outlineVariant,
              width: selected ? 3 : 1,
            ),
          ),
        ),
        child: Text(
          label,
          style: theme.textTheme.labelLarge?.copyWith(
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

final class _MenuAction extends StatelessWidget {
  const _MenuAction({required this.icon, required this.label});
  final PosGlyph icon;
  final String label;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      PosIcon(icon),
      const SizedBox(width: UmiSpacing.md),
      Flexible(child: Text(label)),
    ],
  );
}

Future<void> _showReceipt(
  BuildContext context,
  SaleReceiptResult? result, {
  String? receiptId,
  ReceiptPrintRequest? onPrint,
  bool canPrint = false,
}) async {
  final raw = result?.receipt;
  if (raw == null) return;
  final receipt = ReceiptSnapshot.fromJson(raw);
  await showReceiptDocument(
    context,
    receipt,
    // One implementation, shared with the sale's completion screen (`Ventas` itself
    // is where a receipt is *re*printed, which is why this screen asks for it here).
    printAction: receiptPrintAction(
      canPrint: canPrint,
      receiptId: receiptId,
      snapshot: raw,
      onPrint: onPrint,
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

/// The moment of a sale, in the terminal's own zone.
///
/// The list used to show the business date, which is a calendar day and not a
/// time. A person who is looking for one sale between two shifts needs the
/// minute it happened. The server sends a timestamp; this shows the same
/// instant as the clock on the counter reads it.
String _saleMoment(SaleSnapshot sale) {
  final at = DateTime.tryParse(sale.updatedAt);
  if (at == null) return sale.updatedAt;
  final local = at.toLocal();
  String two(int value) => value.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year} '
      '${two(local.hour)}:${two(local.minute)}';
}

PosGlyph _stateIcon(String state) => switch (state) {
  'suspended' => PosGlyphs.pause,
  'committed' => PosGlyphs.checkCircleOutline,
  'cancelled' => PosGlyphs.close,
  'recovered' => PosGlyphs.restoreOutlined,
  _ => PosGlyphs.shoppingCartOutlined,
};
