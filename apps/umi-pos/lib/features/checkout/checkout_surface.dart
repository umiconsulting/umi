import 'dart:async';

import 'package:flutter/services.dart' show SystemChannels;
import 'package:flutter_svg/flutter_svg.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import '../../core/config/api_assets.dart';
import '../../core/errors/app_error.dart';
import '../../core/localization/app_localizations.dart';
import '../../core/security/operator_permissions.dart';
import '../../core/theme/umi_theme.dart';
import '../../shared/widgets/inline_notice.dart';
import '../../shared/widgets/receipt_print_action.dart';
import '../cart/cart_controller.dart';
import '../cash/money_input.dart';
import '../customer_value/customer_value_controller.dart';
import '../entry/device_channel_socket_client.dart';
import '../entry/entry_controller.dart';
import '../offline/offline_policy.dart';
import '../sale/sale_lifecycle_controller.dart';
import 'checkout_controller.dart';
import 'partial_checkout_surface.dart';
import 'tender_identity.dart';

Future<bool?> _showBankTransferDetailsDialog(
  BuildContext context, {
  required CheckoutController checkout,
  required CartController cart,
  required EntryController entry,
  required int amountMinor,
  String? currency,
  required bool selected,
}) {
  final policy = checkout.policy;
  final details = policy?.bankTransferDetails;
  if (policy == null || details == null) {
    return Future<bool?>.value(false);
  }
  final total = cart.state.cart?.totals['grandTotal'];
  final resolvedCurrency =
      currency ??
      (total is Map ? total['currency'] as String? ?? 'MXN' : 'MXN');
  return showPosDialog<bool>(
    context: context,
    builder: (dialogContext) => BankTransferDialog(
      details: details,
      merchantName: entry.state.selectedTenant?.name ?? 'ONCA',
      logoUrl: policy.merchantLogoUrl,
      amount: formatMinorUnits(amountMinor, resolvedCurrency),
      accountFolio: cart.state.cart?.accountFolio,
      selected: selected,
    ),
  );
}

/// Opens an account's partial-payment ledger directly.
///
/// Split check starts from the cart, so mounting the full checkout first and
/// immediately pushing the ledger over it makes one operator tap look like two
/// navigation events. The ledger is the requested destination; recovery and
/// policy loading happen inside that route instead.
Future<void> showSplitCheckout(
  BuildContext context, {
  required CheckoutController checkout,
  required String? cashShiftId,
  required CartController cart,
  required EntryController entry,
  required SaleLifecycleController sales,
}) async {
  checkout.reset();
  await showPartialCheckout(
    context,
    checkout: checkout,
    cart: cart,
    operatorSessionId:
        entry.state.operator?.id ?? cart.state.cart!.operatorSessionId,
    operatorName: entry.operatorName,
    canConfirmManualTerminal:
        entry.state.operator?.permissions.contains(
          'checkout.terminal.confirm',
        ) ==
        true,
    cashShiftId: cashShiftId,
    prepare: () =>
        _prepareSplitCheckout(checkout: checkout, cart: cart, entry: entry),
    onShowBankTransferDetails: (amountMinor, selected) =>
        _showBankTransferDetailsDialog(
          context,
          checkout: checkout,
          cart: cart,
          entry: entry,
          amountMinor: amountMinor,
          selected: selected,
        ),
  );
  final paid = _checkoutHasFinancialResult(checkout.state.phase);
  if (paid) {
    await sales.checkoutCommitted();
  } else {
    sales.checkoutStopped();
  }
  sales.finishCheckoutPresentation(
    force: paid || sales.state.phase == SalePhase.committed,
  );
}

Future<void> _prepareSplitCheckout({
  required CheckoutController checkout,
  required CartController cart,
  required EntryController entry,
}) async {
  final currentCart = cart.state.cart;
  final operator = entry.state.operator;
  if (currentCart == null || operator == null) return;
  checkout.bindPartialLedger(
    merchantId: currentCart.merchantId,
    locationId: currentCart.locationId,
    operatorSessionId: operator.id,
    cartId: currentCart.id,
    cartVersion: currentCart.version,
  );
  final currency = currentCart.totals['grandTotal'] is Map
      ? (currentCart.totals['grandTotal'] as Map)['currency'] as String?
      : null;
  if (currency == null) return;
  await checkout.loadPolicy(
    merchantId: currentCart.merchantId,
    locationId: currentCart.locationId,
    operatorSessionId: operator.id,
    currency: currency,
  );
}

Future<void> showCheckoutSheet(
  BuildContext context, {
  required CheckoutController checkout,
  required String? cashShiftId,
  required CartController cart,
  required EntryController entry,
  required SaleLifecycleController sales,
  CustomerValueController? customerValue,
  // The same call Ventas uses for a reprint, so the customer who asks for their
  // ticket at the counter gets it from the screen they are already standing at.
  // Null on a till with no hardware service, which is what makes the dialog offer
  // no print button rather than a button that cannot work.
  ReceiptPrintRequest? onPrint,
  Future<String?> Function(String holdState)? onRecoverCashShift,
  Future<String?> Function()? onOpenCashShift,
  // The till's wake-up from the API: the server resolves a card attempt about a
  // second after the terminal answers, and this is what tells the waiting screen
  // so instead of the terminal's own ten- and forty-second windows.
  //
  // Null — or a channel that never connects — leaves the poll exactly as it was.
  // The poll is the delivery path; this is only the latency.
  DeviceChannelSocketClient? deviceChannel,
  // The card terminal's poll schedule, injectable so a test can watch the wait
  // end without spending a minute of wall clock. The defaults are the plan's:
  // ask at about one second, double to a five second cap, and give the vendor's
  // documented 40-second window plus margin before calling it unresolved.
  Duration cardTerminalPollStart = const Duration(seconds: 1),
  Duration cardTerminalPollCap = const Duration(seconds: 5),
  Duration cardTerminalWaitBound = const Duration(seconds: 60),
  // The wall clock the card wait reads. Injectable so a test can reach the
  // bound without spending a minute of real time; the till passes the real one.
  DateTime Function() now = DateTime.now,
}) async {
  await Navigator.of(context).push(
    // PoloTab pays on a full screen, not a sheet — a focused, low-light surface.
    PosPageRoute<void>(
      fullscreenDialog: true,
      builder: (_) => PosPage(
        backgroundColor: PosTheme.of(context).scaffoldBackgroundColor,
        body: _CheckoutSheet(
          checkout: checkout,
          cashShiftId: cashShiftId,
          cart: cart,
          entry: entry,
          sales: sales,
          customerValue: customerValue,
          onPrint: onPrint,
          onRecoverCashShift: onRecoverCashShift,
          onOpenCashShift: onOpenCashShift,
          deviceChannel: deviceChannel,
          cardTerminalPollStart: cardTerminalPollStart,
          cardTerminalPollCap: cardTerminalPollCap,
          cardTerminalWaitBound: cardTerminalWaitBound,
          now: now,
        ),
      ),
    ),
  );
  final paid = _checkoutHasFinancialResult(checkout.state.phase);
  // A hardware back press on the paid receipt returns here without the
  // "Nuevo pedido" action. Mark the sale committed before the cart is
  // cleared, or the paid account stays visible and offers "Cobrar" again.
  if (paid) {
    await sales.checkoutCommitted();
  }
  // The payment is the authority that this cart is no longer editable. Clear
  // the local cart even when the lifecycle controller did not observe the
  // `checkingOut -> committed` transition. A completed split used to leave the
  // paid account painted and offer `Cobrar` again.
  sales.finishCheckoutPresentation(
    force: paid || sales.state.phase == SalePhase.committed,
  );
}

bool _checkoutHasFinancialResult(CheckoutPhase phase) =>
    phase == CheckoutPhase.completed ||
    phase == CheckoutPhase.provisional ||
    phase == CheckoutPhase.provisionalSynced;

final class _CheckoutSheet extends StatefulWidget {
  const _CheckoutSheet({
    required this.checkout,
    required this.cashShiftId,
    required this.cart,
    required this.entry,
    required this.sales,
    required this.customerValue,
    this.onPrint,
    required this.onRecoverCashShift,
    required this.onOpenCashShift,
    required this.deviceChannel,
    required this.cardTerminalPollStart,
    required this.cardTerminalPollCap,
    required this.cardTerminalWaitBound,
    required this.now,
  });
  final CheckoutController checkout;
  final String? cashShiftId;
  final CartController cart;
  final EntryController entry;
  final SaleLifecycleController sales;
  final CustomerValueController? customerValue;

  /// Print this sale's receipt — the completion screen's own way in, and the same
  /// request Ventas makes. See `receiptPrintAction` for why the paper is a copy.
  final ReceiptPrintRequest? onPrint;

  /// Recover the till's cash shift after a `CASH_SHIFT_REQUIRED` refusal and
  /// return the shift id now in force, or null when the recovery freed the
  /// drawer but left no shift to charge against.
  final Future<String?> Function(String holdState)? onRecoverCashShift;
  final Future<String?> Function()? onOpenCashShift;
  final DeviceChannelSocketClient? deviceChannel;
  final Duration cardTerminalPollStart;
  final Duration cardTerminalPollCap;
  final Duration cardTerminalWaitBound;

  /// The clock the card wait reads. A test supplies its own so the bound can be
  /// reached without waiting real seconds; the till uses the system clock.
  final DateTime Function() now;

  @override
  State<_CheckoutSheet> createState() => _CheckoutSheetState();
}

final class _CheckoutSheetState extends State<_CheckoutSheet> {
  String method = 'cash';
  bool cashEnabled = true;
  bool cashRecoveryBusy = false;
  bool terminalEnabled = false;
  String terminalStatus = 'not_started';
  int? _confirmedManualTerminalMinorUnits;

  /// The CARD terminal's own tender state, kept PARALLEL to the manual one
  /// rather than overloaded onto it.
  ///
  /// The two tiles are different promises on the same wire type
  /// (`manual_terminal` is the only `TenderType` that maps to
  /// `external_terminal`): the manual one records an operator's word, the card
  /// one records what a provider said. They also carry different identities
  /// (`terminal` vs `card_terminal`), so they can never collide on
  /// `pos_tender_fact.id`.
  bool cardEnabled = false;
  bool bankEnabled = false;
  bool bankConfirmed = false;

  /// The operator asked to divide this check across more than one method.
  /// Default false: one method per sale unless the operator says otherwise.
  bool splitArmed = false;
  bool _partialInProgress = false;
  bool _partialRouteOpen = false;
  bool _chargeInFlight = false;

  /// The recovered draft holds a tender combination this location cannot take.
  ///
  /// Observed on the real till: a cart whose checkout draft was written by an
  /// earlier session opened with `Efectivo` AND `Terminal manual` both selected,
  /// on a location whose policy forbids mixed tender. The tiles contradicted the
  /// policy, the cash leg and the card leg each showed a number, and the charge
  /// that followed could not succeed. Nothing was adopted here: the operator gets
  /// the conflict by name and the one honest way forward.
  bool recoveredTenderConflict = false;

  /// `not_started | awaiting_terminal | confirmed_success | outcome_unknown`.
  String cardStatus = 'not_started';

  /// The terminal's own words, shown while it works and after it answers.
  String? cardProviderStatus;

  /// The sentence the till shows about the card attempt.
  String? cardMessage;

  /// The identity the capture used, which is also the tender draft's id.
  String? cardCommandIdentity;

  /// A capture is in flight. The charge button is inert while this is true, so a
  /// second press cannot ask the terminal for a second charge.
  bool cardCaptureInFlight = false;

  /// The poller is live: the till is still asking the terminal.
  bool cardWaiting = false;
  Timer? cardPollTimer;
  DateTime? cardWaitDeadline;
  Duration cardPollDelay = const Duration(seconds: 1);

  /// The attempt id the capture created, as the row answers it. Kept so a nudge
  /// that carries no command identity can still be recognised as this sale's.
  String? cardAttemptId;

  /// The device channel's subscription: opened when a card charge starts, and
  /// cancelled with the sheet. Null when no channel is wired, or before the first
  /// charge on this sheet.
  ///
  /// Cancelled in `dispose`, which is where this sheet's teardown lives: the lint
  /// only reads the one method that creates the subscription.
  // ignore: cancel_subscriptions
  StreamSubscription<TenderAttemptNudge>? cardNudgeSubscription;

  /// The totals the sheet is showing, so the card flow can re-balance the tender
  /// fields from a poll that runs while the operator is looking elsewhere.
  TotalsPreview? shownTotals;
  String tipKind = 'none';
  int tipBasisPoints = 0;

  /// WHICH NUMBER THE ON-SCREEN KEYPAD IS EDITING.
  ///
  /// The till has one numeric keypad and two numbers that want it — what the customer put
  /// down, and the tip percentage — and neither field opens the system keyboard any more.
  /// A POS often has no keyboard at all, and the one it may have is the wrong tool: the
  /// operator tapped the field, the sheet scrolled, the keyboard came up over the amount
  /// they were reading, and getting a caret into the box took several tries (owner,
  /// 2026-10-13). Tapping a field says which number the keypad is on; the keypad is the
  /// only thing that writes.
  String _padTarget = 'cash';
  String discountType = 'order_percentage';
  bool dirty = false;

  /// The cashier has set the tender split by hand.
  ///
  /// Distinct from [dirty], which the customer-value preview raises on its own
  /// before anyone touches the sheet — so `dirty` cannot tell an edited amount
  /// from an untouched one, and a stale draft stayed on screen because of it.
  bool tenderEdited = false;
  bool cashReceivedEdited = false;
  String? _splitEditedLeg;
  bool recoveredDraftLoaded = false;
  final cashApplied = TextEditingController();
  final cashReceived = TextEditingController();
  final terminalAmount = TextEditingController();
  final cardAmount = TextEditingController();
  final bankAmount = TextEditingController();
  final customTipPercent = TextEditingController();
  final customTipFixed = TextEditingController();
  final discountPercent = TextEditingController();
  final discountReason = TextEditingController();
  bool committed = false;
  bool fundedGiftCardRevealed = false;
  bool fundedGiftCardRevealInFlight = false;
  String? customerValuePreviewKey;
  Future<void>? customerValuePreviewInFlight;
  List<Map<String, Object?>> storedValueTenders = const [];

  @override
  void initState() {
    super.initState();
    widget.checkout.reset();
    widget.checkout.addListener(_changed);
    widget.customerValue?.addListener(_changed);
    final cart = widget.cart.state.cart;
    final operator = widget.entry.state.operator;
    if (cart != null && operator != null) {
      // What this location may offer, asked BEFORE anything is charged. The
      // payment-method tiles are drawn from the policy, and it used to arrive
      // only with the charge itself, so the tiles could not appear until the
      // sale was already done.
      final currency =
          TotalsPreview.fromJson(cart.totals).grandTotal['currency'] as String?;
      if (currency != null) {
        unawaited(
          widget.checkout.loadPolicy(
            merchantId: cart.merchantId,
            locationId: cart.locationId,
            operatorSessionId: operator.id,
            currency: currency,
          ),
        );
      }
      unawaited(_anchorCheckout());
    }
  }

  /// Open the checkout against the cart's CURRENT version.
  ///
  /// The version is the commit's optimistic guard, and the till's copy can be a
  /// write behind — a cancelled checkout bumps the cart server-side and the till
  /// never sees the answer. Anchoring on the copy in hand made the commit refuse
  /// with OPTIMISTIC_VERSION_CONFLICT, and the retry re-sent the same stale
  /// number, so the sale was unpayable and the only way out was to back off the
  /// screen. One read here is the difference between a recoverable refusal and a
  /// dead end.
  Future<void> _anchorCheckout() async {
    if (widget.cart.state.cart == null || widget.entry.state.operator == null) {
      return;
    }
    if (!widget.checkout.usesLocalCheckout) {
      await widget.cart.refresh();
    }
    if (!mounted) return;
    final cart = widget.cart.state.cart;
    final operator = widget.entry.state.operator;
    if (cart == null || operator == null) return;
    await widget.checkout.recover(
      merchantId: cart.merchantId,
      locationId: cart.locationId,
      operatorSessionId: operator.id,
      cartId: cart.id,
      cartVersion: cart.version,
    );
    if (!mounted ||
        !widget.checkout.supportsPartialPayments ||
        widget.checkout.state.phase == CheckoutPhase.completed) {
      return;
    }
    if (widget.checkout.policy == null) {
      final currency = cart.totals['grandTotal'] is Map
          ? (cart.totals['grandTotal'] as Map)['currency'] as String?
          : null;
      if (currency != null) {
        await widget.checkout.loadPolicy(
          merchantId: cart.merchantId,
          locationId: cart.locationId,
          operatorSessionId: operator.id,
          currency: currency,
        );
      }
    }
    await _syncPartialLedger(openWhenFound: true);
  }

  Future<bool> _syncPartialLedger({bool openWhenFound = false}) async {
    final cart = widget.cart.state.cart;
    final operator = widget.entry.state.operator;
    if (cart == null ||
        operator == null ||
        !widget.checkout.canCollectPartialPayments) {
      return false;
    }
    try {
      final snapshot = await widget.checkout.partialPayments(
        merchantId: cart.merchantId,
        cartId: cart.id,
        locationId: cart.locationId,
        operatorSessionId: operator.id,
      );
      if (!mounted) return false;
      final found = (snapshot['tenderDrafts'] as List? ?? const []).isNotEmpty;
      setState(() => _partialInProgress = found);
      if (found && openWhenFound && !_partialRouteOpen) {
        await _presentPartialCheckout();
      }
      return found;
    } on AppException catch (failure) {
      if (failure.code == 'RESOURCE_NOT_FOUND' && mounted) {
        setState(() => _partialInProgress = false);
      }
      return false;
    }
  }

  Future<void> _presentPartialCheckout() async {
    if (_partialRouteOpen || !mounted) return;
    _partialRouteOpen = true;
    try {
      await showPartialCheckout(
        context,
        checkout: widget.checkout,
        cart: widget.cart,
        operatorSessionId:
            widget.entry.state.operator?.id ??
            widget.cart.state.cart!.operatorSessionId,
        operatorName: widget.entry.operatorName,
        canConfirmManualTerminal:
            widget.entry.state.operator?.permissions.contains(
              'checkout.terminal.confirm',
            ) ==
            true,
        cashShiftId: widget.cashShiftId,
        onShowBankTransferDetails: (amountMinor, selected) {
          final policy = widget.checkout.policy;
          if (policy?.bankTransferDetails == null) {
            return Future<bool?>.value(false);
          }
          final total = widget.cart.state.cart?.totals['grandTotal'];
          final currency = total is Map
              ? total['currency'] as String? ?? 'MXN'
              : 'MXN';
          return _showBankDetails(
            policy!,
            amountMinor: amountMinor,
            currency: currency,
            selected: selected,
          );
        },
      );
    } finally {
      _partialRouteOpen = false;
      if (mounted && widget.checkout.state.phase != CheckoutPhase.completed) {
        await _syncPartialLedger();
      }
    }
  }

  @override
  void dispose() {
    // Leaving the screen stops the wait. The attempt is NOT cancelled — our API
    // has no vendor-cancel route, and the row stays recorded and queryable.
    cardPollTimer?.cancel();
    // The wake-up goes with the sheet. Cancelling the last listener is what takes
    // the device socket down; the client belongs to the app, not to this screen.
    final nudge = cardNudgeSubscription;
    cardNudgeSubscription = null;
    if (nudge != null) unawaited(nudge.cancel());
    widget.checkout.removeListener(_changed);
    widget.customerValue?.removeListener(_changed);
    if (!committed) widget.sales.checkoutStopped();
    cashReceived.dispose();
    cashApplied.dispose();
    terminalAmount.dispose();
    cardAmount.dispose();
    bankAmount.dispose();
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
    _loadCustomerValuePreview();
    if (_checkoutHasFinancialResult(widget.checkout.state.phase) &&
        !committed) {
      committed = true;
      unawaited(widget.sales.checkoutCommitted());
      if (widget.checkout.state.phase == CheckoutPhase.completed) {
        unawaited(_revealFundedGiftCardAfterCommit());
      }
    }
  }

  void _loadCustomerValuePreview() {
    final pending = _requestCustomerValuePreview();
    if (pending != null) unawaited(pending);
  }

  /// Ask for the loyalty and stored-value preview this checkout is owed, and hand
  /// back the answer WHILE IT IS STILL IN FLIGHT.
  ///
  /// The panel only wants the preview to render, so it drops the future. The commit
  /// cannot: the command has to carry the preview's own fingerprint, and the
  /// database refuses a command whose half of the pair is missing
  /// (`merchant.assert_loyalty_earn_preview` → `LOYALTY_PREVIEW_STALE`). Returning
  /// the same request the panel is showing is what lets the commit WAIT for the
  /// answer instead of racing it — and it asks the server once, not twice.
  ///
  /// Null means this sale has nothing to preview: no customer attached, or no
  /// checkout fingerprint yet.
  Future<void>? _requestCustomerValuePreview() {
    final controller = widget.customerValue;
    final confirmation = widget.checkout.state.result?.confirmation;
    final fingerprint = confirmation?['fingerprint'] as String?;
    final cart = widget.cart.state.cart;
    final customerId = widget.sales.state.sale?.customer?['id'] as String?;
    final operator = widget.entry.state.operator;
    if (controller == null ||
        fingerprint == null ||
        cart == null ||
        operator == null ||
        customerId == null) {
      // No customer attached: an anonymous sale has no loyalty or stored value
      // to preview, so do not start the lookup.
      return null;
    }
    // ASK ONLY WHILE THE COMMAND CARRIES NO VALUE, AND KEY THE ROW ON THE BASIS.
    //
    // The closeout pairs the preview with the command's fingerprint computed WITHOUT its
    // `customerValue` ("the basis", `customerValueBasisFingerprint` → `merchant.assert_loyalty_earn_preview`).
    // So the request that writes the row has to carry the basis, and the only fingerprint that IS
    // the basis belongs to a command with no value in it. Once a value is applied, the fingerprint
    // in hand is the value-carrying one, and asking with it writes a row the commit can never name
    // — which is how a second review used to poison the pair.
    if (widget.checkout.customerValueSelection != null) return null;
    // A basis that changed — the operator corrected a tender or chose a tip after the preview was
    // taken — needs a NEW row, and the server replaces the one this checkout version has
    // (`merchant.replace_loyalty_earn_preview`). One row per version, always the one the next
    // command will name.
    final key = '$customerId:${cart.version}:$fingerprint';
    if (customerValuePreviewKey == key) return customerValuePreviewInFlight;
    customerValuePreviewKey = key;
    final pending = controller.loadPreview(
      CustomerValueScope(
        merchantId: cart.merchantId,
        locationId: cart.locationId,
        operatorSessionId: operator.id,
      ),
      saleId: cart.id,
      saleVersion: cart.version,
      customerId: customerId,
      checkoutFingerprint: fingerprint,
    );
    customerValuePreviewInFlight = pending;
    return pending.whenComplete(() {
      if (identical(customerValuePreviewInFlight, pending)) {
        customerValuePreviewInFlight = null;
      }
    });
  }

  void _restoreDraft(List<Map<String, Object?>> drafts) {
    // A draft can hold a split this location is not allowed to take, and adopting
    // it would put two selected methods on screen beside a policy that forbids
    // exactly that — the operator reads a contradiction and the charge cannot
    // succeed. The draft is NOT erased and the claim stays where it is; what does
    // not happen is the till pretending the combination is payable.
    final methods = drafts
        .map((draft) => draft['type'] as String?)
        .whereType<String>()
        .toSet();
    if (methods.length > 1 && !_mixedTenderAllowed) {
      recoveredTenderConflict = true;
      return;
    }
    // The draft carried a split, so the operator asked for one in the earlier
    // session. The mode has to match what is about to appear on screen, or the
    // first tap on a tile would quietly collapse the recovered split.
    if (methods.length > 1) splitArmed = true;
    cashEnabled = false;
    terminalEnabled = false;
    cardEnabled = false;
    bankEnabled = false;
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
        cashReceivedEdited =
            received != null && received['minorUnits'] != amount['minorUnits'];
      } else if (draft['id'] ==
          tenderId(widget.cart.state.cart!.id, 'card_terminal')) {
        // A card tender restored after a restart is the SAME tender: its identity
        // comes from the cart, so the attempt the terminal holds is still keyed
        // by it and the commit can still link it.
        cardEnabled = true;
        cardAmount.text = value;
        cardStatus = draft['status']! as String;
      } else if (draft['type'] == 'bank_transfer') {
        bankEnabled = true;
        bankAmount.text = value;
        bankConfirmed = false;
      } else {
        terminalEnabled = true;
        terminalAmount.text = value;
        terminalStatus = draft['status']! as String;
      }
    }
    if (splitArmed && cashEnabled) _splitEditedLeg = 'cash';
    method = _selectedPaymentMethod;
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
  }

  String _money(Map<String, Object?> value) {
    final currency = value['currency'] as String? ?? '';
    final minor = (value['minorUnits'] as num?)?.toInt() ?? 0;
    return formatMinorUnits(minor, currency);
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
    shownTotals = totals;
    // SEED THE TENDER FROM THE TOTAL THAT IS ON SCREEN NOW.
    //
    // `_restoreDraft` refills these fields from the saved tender, which was
    // written against whatever the cart cost at the time. Add a line and reopen
    // the sheet and the cashier was shown MXN 55.00 to collect on a MXN 110.00
    // bill — the checkout then refused to complete and said only that it could
    // not be done safely. A draft that no longer covers the total is stale, so
    // it is replaced. `dirty` means the cashier typed the split themselves, and
    // their numbers are never overwritten.
    // The bill PLUS the tip and minus the discount: the amount due, which is what the tenders have
    // to cover (see `_dueMinorUnits`).
    final grandTotal = _dueMinorUnits(totals);
    final tendered = _tenderedLegsMinorUnits;
    if (tenderNeedsReseed(
      receivedEmpty: cashReceived.text.isEmpty,
      tenderEdited: tenderEdited,
      tenderedMinorUnits: tendered,
      grandTotalMinorUnits: grandTotal,
    )) {
      _balanceTenderFields(totals);
    }
    // The policy read on open, so the method tiles exist before the charge; the
    // checkout's own copy is the fallback for a sheet that opened while the read
    // was still in flight.
    final policy =
        widget.checkout.policy ??
        (state.result?.policy == null
            ? null
            : CheckoutPolicy.fromJson(state.result!.policy!));
    final paymentSummary = state.result?.paymentSummary == null
        ? null
        : PaymentSummary.fromJson(state.result!.paymentSummary!);
    return SafeArea(
      key: const ValueKey('checkout-surface'),
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.lg),
        child: switch (state.phase) {
          CheckoutPhase.completed => _receipt(
            context,
            state.result!,
            state.postCommitWarning,
          ),
          CheckoutPhase.provisional => _provisional(
            context,
            state.provisionalReceipt!,
          ),
          CheckoutPhase.provisionalSynced => _provisional(
            context,
            state.provisionalReceipt!,
            officialSaleId: state.officialSaleId,
          ),
          CheckoutPhase.paymentUnknown => _unknown(context, state.result!),
          CheckoutPhase.processing || CheckoutPhase.repricing => Center(
            child: Semantics(
              liveRegion: true,
              label: l.paymentProcessing,
              child: const PosSpinner(),
            ),
          ),
          CheckoutPhase.failure => _checkoutError(context, state.errorCode),
          _ when _partialInProgress => Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    Localizations.localeOf(context).languageCode == 'es'
                        ? 'Cobro dividido en curso'
                        : 'Split payment in progress',
                    style: PosTheme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: UmiSpacing.md),
                  Text(
                    Localizations.localeOf(context).languageCode == 'es'
                        ? 'Consulta el saldo y continúa los pagos de esta cuenta.'
                        : 'Check the balance and continue this account’s payments.',
                  ),
                  const SizedBox(height: UmiSpacing.lg),
                  PosButton(
                    key: const ValueKey('partial-checkout-resume'),
                    onPressed: _presentPartialCheckout,
                    child: Text(
                      Localizations.localeOf(context).languageCode == 'es'
                          ? 'Continuar cobro dividido'
                          : 'Continue split payment',
                    ),
                  ),
                  PosTextButton(
                    onPressed: () => _closeCheckout(context),
                    child: Text(l.closeAction),
                  ),
                ],
              ),
            ),
          ),
          // The bill on the left, the money the customer put down on the right.
          //
          // This was one scrolling column, and the screen the cashier stands in
          // front of when a customer hands over cash was the one that suffered:
          // the keypad and the "Cobrar · MXN 55.00" button sat below the fold, so
          // taking money meant scrolling a live sale with the customer waiting.
          // The two halves are what the job actually is - read the bill, count
          // the cash - and they fit side by side on the counter terminal with
          // nothing to scroll. The left side keeps a scroll view only because
          // the policy can add tip, discount and receipt sections to it.
          _ => Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                flex: 6,
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Compact header: the title and a close affordance, with the where
                      // and who folded into one muted line — the amount, not the chrome,
                      // is what the cashier reads first.
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              l.checkoutTitle,
                              style: PosTheme.of(
                                context,
                              ).textTheme.headlineSmall,
                            ),
                          ),
                          PosIconButton(
                            tooltip: l.closeAction,
                            onPressed: () => _closeCheckout(context),
                            icon: const PosIcon(PosGlyphs.close),
                          ),
                        ],
                      ),
                      Text(
                        [
                              widget.entry.state.selectedTenant?.name,
                              widget.entry.state.selectedBranch?.name,
                              widget.entry.operatorName,
                            ]
                            .whereType<String>()
                            .where((v) => v.isNotEmpty)
                            .join(' · '),
                        style: PosTheme.of(context).textTheme.bodySmall
                            ?.copyWith(
                              color: PosTheme.of(
                                context,
                              ).colorScheme.onSurfaceVariant,
                            ),
                      ),
                      const SizedBox(height: UmiSpacing.lg),
                      // The amount due, extra-large — the number the cashier verifies at a
                      // glance and the star of the tender screen (SOTA POS convention).
                      _TotalHero(
                        label: l.totalLabel,
                        amount: _money({
                          'currency': totals.grandTotal['currency'],
                          'minorUnits': grandTotal,
                        }),
                      ),
                      const SizedBox(height: UmiSpacing.md),
                      _AmountRow(
                        label: l.subtotalLabel,
                        value: _money(totals.subtotal),
                      ),
                      _AmountRow(label: l.taxLabel, value: _money(totals.tax)),
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
                      Text(
                        '${l.businessDateLabel}: ${totals.businessDate}',
                        style: PosTheme.of(context).textTheme.bodySmall
                            ?.copyWith(
                              color: PosTheme.of(
                                context,
                              ).colorScheme.onSurfaceVariant,
                            ),
                      ),
                      // Loyalty and stored value only apply when a customer is
                      // attached. An anonymous sale showed a permanent "Consulta en
                      // curso." block and fired a lookup for a customer that does not
                      // exist — hide the block and skip the lookup (see also
                      // `_loadCustomerValuePreview`).
                      if (widget.customerValue != null && _hasCustomer)
                        _customerValueSection(totals),
                      const SizedBox(height: UmiSpacing.lg),
                      // What the terminal said about the card attempt, in its
                      // own words where it has any. It stays on screen after the
                      // tile is deselected (a refusal leaves the sale open, and
                      // the operator must be able to read why).
                      if (cardMessage != null) ...[
                        _cardTerminalNotice(context, cardMessage!),
                        const SizedBox(height: UmiSpacing.lg),
                      ],
                      // The split control rides on the heading, so the choice to
                      // divide a check is made BEFORE a second tile is tapped
                      // rather than inferred from it.
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              l.tenderSelectionTitle,
                              style: PosTheme.of(context).textTheme.titleMedium,
                            ),
                          ),
                          if (_partialControlOffered(policy))
                            PosTextButton.icon(
                              key: const ValueKey('partial-checkout-open'),
                              onPressed: _openPartialCheckout,
                              icon: const PosIcon(PosGlyphs.callSplit),
                              label: Text(l.splitTenderAction),
                            )
                          else if (!widget.checkout.supportsPartialPayments &&
                              _splitControlOffered(policy))
                            PosTextButton.icon(
                              key: ValueKey(
                                splitArmed
                                    ? 'tender-split-disarm'
                                    : 'tender-split-arm',
                              ),
                              onPressed: () =>
                                  _toggleSplit(!splitArmed, totals),
                              icon: PosIcon(
                                splitArmed
                                    ? PosGlyphs.mergeType
                                    : PosGlyphs.callSplit,
                              ),
                              label: Text(
                                splitArmed
                                    ? l.splitTenderCancelAction
                                    : l.splitTenderAction,
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: UmiSpacing.sm),
                      _tenderReading(context, totals),
                      LayoutBuilder(
                        builder: (context, constraints) {
                          final columns = constraints.maxWidth < 760 ? 2 : 4;
                          final width =
                              (constraints.maxWidth -
                                  UmiSpacing.md * (columns - 1)) /
                              columns;
                          return Wrap(
                            spacing: UmiSpacing.md,
                            runSpacing: UmiSpacing.md,
                            children: [
                              SizedBox(
                                width: width,
                                child: _MethodTile(
                                  icon: PosGlyphs.paymentsOutlined,
                                  label: l.cashPayment,
                                  selected: cashEnabled,
                                  onTap: () => _setCash(!cashEnabled, totals),
                                ),
                              ),
                              if (policy?.manualTerminalEnabled ?? false)
                                SizedBox(
                                  width: width,
                                  child: _MethodTile(
                                    icon: PosGlyphs.creditCardOutlined,
                                    label: l.manualTerminalLabel,
                                    selected: terminalEnabled,
                                    onTap: () =>
                                        _setTerminal(!terminalEnabled, totals),
                                  ),
                                ),
                              if (widget.checkout.cardTerminalProviderId !=
                                  null)
                                SizedBox(
                                  width: width,
                                  child: _MethodTile(
                                    key: const ValueKey('method-card-terminal'),
                                    icon: PosGlyphs.contactlessOutlined,
                                    label: l.cardTerminalLabel,
                                    selected: cardEnabled,
                                    onTap: () => _setCard(!cardEnabled, totals),
                                  ),
                                ),
                              if (_bankAvailable(policy))
                                SizedBox(
                                  width: width,
                                  child: _MethodTile(
                                    key: const ValueKey('method-bank-transfer'),
                                    icon:
                                        PosGlyphs.accountBalanceWalletOutlined,
                                    label: l.bankTransferLabel,
                                    selected: bankEnabled,
                                    onTap: () => _chooseBank(policy!, totals),
                                  ),
                                ),
                            ],
                          );
                        },
                      ),
                      // One method per sale here, and more than one way to pay:
                      // say so under the tiles rather than let a tap on a second
                      // tile be read as a choice the location does not allow.
                      if (!_mixedTenderAllowed &&
                          _methodsOffered(policy) > 1) ...[
                        const SizedBox(height: UmiSpacing.xs),
                        Text(
                          l.singleMethodOnlyNote,
                          style: PosTheme.of(context).textTheme.bodySmall
                              ?.copyWith(
                                color: PosTheme.of(
                                  context,
                                ).colorScheme.onSurfaceVariant,
                              ),
                        ),
                      ],
                      if (cashEnabled) ...[
                        const SizedBox(height: UmiSpacing.lg),
                        // Split tender only: how much of the bill goes on cash (the rest
                        // is charged to the card, whichever card tile is on). A
                        // single-method cash sale collects the whole total, so this field
                        // is hidden and the total stands.
                        if (terminalEnabled || cardEnabled || bankEnabled) ...[
                          PosField(
                            controller: cashApplied,
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            inputFormatters: cashAmountFormatters,
                            decoration: PosFieldDecoration(
                              labelText: l.cashTenderTitle,
                              errorText:
                                  parseMinorUnits(cashApplied.text) == null
                                  ? l.invalidAmountMessage
                                  : null,
                            ),
                            onChanged: (_) => _editSplitAmount('cash'),
                          ),
                          const SizedBox(height: UmiSpacing.md),
                        ],
                        // Cash received: a big right-aligned amount the keypad and the
                        // quick-cash notes both drive, so a barista never hunts for the
                        // decimal key on a busy till.
                        PosField(
                          controller: cashReceived,
                          // No system keyboard: the keypad below is the input, and it is
                          // the one the till has. `readOnly` also keeps the caret out of a
                          // field the operator only reads.
                          readOnly: true,
                          showCursor: false,
                          inputFormatters: cashAmountFormatters,
                          textAlign: TextAlign.right,
                          style: PosTheme.of(context).textTheme.headlineSmall,
                          decoration: PosFieldDecoration(
                            labelText: l.cashReceivedLabel,
                            errorText:
                                parseMinorUnits(cashReceived.text) == null
                                ? l.invalidAmountMessage
                                : null,
                          ),
                          // A tap points the keypad here and selects the seeded figure, so
                          // the first digit the operator types REPLACES it. Without the
                          // selection the amount they hand over is appended to the total
                          // (55.00 → 55.00500) and the checkout refuses it.
                          onTap: () {
                            setState(() {
                              _padTarget = 'cash';
                              cashReceived.selection = TextSelection(
                                baseOffset: 0,
                                extentOffset: cashReceived.text.length,
                              );
                            });
                          },
                          onChanged: (_) => setState(() {
                            dirty = true;
                            tenderEdited = true;
                            cashReceivedEdited = true;
                          }),
                        ),
                        const SizedBox(height: UmiSpacing.sm),
                        Row(
                          children: [
                            Expanded(
                              child: _QuickCashButton(
                                label: l.exactAmountAction,
                                onTap: () => _setCashReceived(
                                  (totals.grandTotal['minorUnits']! as num)
                                      .toInt(),
                                ),
                              ),
                            ),
                            for (final value in const [
                              10000,
                              20000,
                              50000,
                            ]) ...[
                              const SizedBox(width: UmiSpacing.sm),
                              Expanded(
                                child: _QuickCashButton(
                                  label: _money({
                                    'currency': totals.grandTotal['currency'],
                                    'minorUnits': value,
                                  }),
                                  onTap: () => _setCashReceived(value),
                                ),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: UmiSpacing.md),
                      ],
                      if (terminalEnabled) ...[
                        const SizedBox(height: UmiSpacing.lg),
                        Text(
                          l.manualTerminalLabel,
                          style: PosTheme.of(context).textTheme.titleSmall,
                        ),
                        const SizedBox(height: UmiSpacing.sm),
                        PosField(
                          controller: terminalAmount,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          inputFormatters: cashAmountFormatters,
                          decoration: PosFieldDecoration(
                            labelText: l.tenderAmountLabel,
                            errorText:
                                parseMinorUnits(terminalAmount.text) == null
                                ? l.invalidAmountMessage
                                : null,
                          ),
                          onChanged: (_) => _editSplitAmount('terminal'),
                        ),
                        const SizedBox(height: UmiSpacing.sm),
                        Wrap(
                          spacing: UmiSpacing.sm,
                          runSpacing: UmiSpacing.sm,
                          children: [
                            PosChoice(
                              label: Text(l.terminalProcessingAction),
                              selected:
                                  terminalStatus ==
                                  'operator_processing_externally',
                              onSelected: (_) => _terminalOutcome(
                                'operator_processing_externally',
                              ),
                            ),
                          ],
                        ),
                      ],
                      // The card terminal's panel. The operator declares
                      // NOTHING here: the terminal is the witness, and the till
                      // follows its attempt until it answers.
                      if (cardEnabled) ...[
                        const SizedBox(height: UmiSpacing.lg),
                        Text(
                          l.cardTerminalLabel,
                          style: PosTheme.of(context).textTheme.titleSmall,
                        ),
                        const SizedBox(height: UmiSpacing.sm),
                        PosField(
                          controller: cardAmount,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          inputFormatters: cashAmountFormatters,
                          decoration: PosFieldDecoration(
                            labelText: l.tenderAmountLabel,
                            errorText: parseMinorUnits(cardAmount.text) == null
                                ? l.invalidAmountMessage
                                : null,
                          ),
                          onChanged: (_) => _editSplitAmount('card'),
                        ),
                        const SizedBox(height: UmiSpacing.sm),
                        _cardTerminalProgress(context),
                        // The card FACE owns this action when the card has the
                        // whole screen; the panel owns it only on a split, where
                        // the cash keypad keeps the right column.
                        if (cardWaiting && cashEnabled) ...[
                          const SizedBox(height: UmiSpacing.sm),
                          PosTextButton(
                            onPressed: _stopWaitingForCardTerminal,
                            child: Text(l.terminalStopWaitingAction),
                          ),
                        ],
                      ],
                      if (bankEnabled) ...[
                        const SizedBox(height: UmiSpacing.lg),
                        Text(
                          l.bankTransferLabel,
                          style: PosTheme.of(context).textTheme.titleSmall,
                        ),
                        const SizedBox(height: UmiSpacing.sm),
                        PosField(
                          key: const ValueKey('bank-transfer-amount'),
                          controller: bankAmount,
                          readOnly: true,
                          decoration: PosFieldDecoration(
                            labelText: l.tenderAmountLabel,
                          ),
                        ),
                        const SizedBox(height: UmiSpacing.xs),
                        Text(
                          l.bankTransferPendingNote,
                          style: PosTheme.of(context).textTheme.bodySmall,
                        ),
                        PosTextButton(
                          onPressed: () =>
                              _showBankInstructions(policy!, totals),
                          child: Text(l.bankTransferViewDetails),
                        ),
                      ],
                      if (policy?.tip['enabled'] == true) ...[
                        const SizedBox(height: UmiSpacing.lg),
                        Text(
                          l.tipLabel,
                          style: PosTheme.of(context).textTheme.titleMedium,
                        ),
                        Wrap(
                          spacing: UmiSpacing.sm,
                          children: [
                            PosChoice(
                              label: Text(l.noTipAction),
                              selected: tipKind == 'none',
                              onSelected: (_) => _clearTip(),
                            ),
                            for (final raw
                                in policy!.tip['presetBasisPoints']!
                                    as List<Object?>)
                              PosChoice(
                                label: Text('${(raw as num).toInt() ~/ 100}%'),
                                selected:
                                    tipKind == 'percentage' &&
                                    tipBasisPoints == raw.toInt(),
                                onSelected: (_) =>
                                    _setTipPercentage(raw.toInt()),
                              ),
                          ],
                        ),
                        const SizedBox(height: UmiSpacing.sm),
                        Row(
                          children: [
                            if (policy.tip['customPercentageEnabled'] == true)
                              Expanded(
                                child: PosField(
                                  key: const ValueKey('custom-tip-percentage'),
                                  controller: customTipPercent,
                                  // Same rule as the cash received: the keypad writes, the
                                  // field shows. Tapping it is what moves the keypad here.
                                  readOnly: true,
                                  showCursor: false,
                                  decoration: PosFieldDecoration(
                                    labelText: l.customTipPercentLabel,
                                  ),
                                  // Tapping the field is how the operator says "I am typing
                                  // this number now": it takes the keypad and starts a fresh
                                  // percentage, so a preset they had chosen is not appended
                                  // to (15 + 5 is not 155 %).
                                  onTap: () {
                                    FocusManager.instance.primaryFocus
                                        ?.unfocus();
                                    setState(() {
                                      _padTarget = 'tip_percent';
                                      customTipPercent.text = '';
                                      tipKind = 'percentage';
                                      tipBasisPoints = 0;
                                      dirty = true;
                                    });
                                  },
                                ),
                              ),
                            if (policy.tip['customPercentageEnabled'] == true &&
                                policy.tip['customFixedEnabled'] == true)
                              const SizedBox(width: UmiSpacing.md),
                            if (policy.tip['customFixedEnabled'] == true)
                              Expanded(
                                child: PosField(
                                  key: const ValueKey('custom-tip-fixed'),
                                  controller: customTipFixed,
                                  readOnly: true,
                                  showCursor: false,
                                  decoration: PosFieldDecoration(
                                    labelText: l.customTipFixedLabel,
                                  ),
                                  onTap: () {
                                    FocusManager.instance.primaryFocus
                                        ?.unfocus();
                                    setState(() {
                                      _padTarget = 'tip_fixed';
                                      customTipFixed.clear();
                                      tipKind = 'fixed';
                                      dirty = true;
                                    });
                                  },
                                ),
                              ),
                          ],
                        ),
                      ],
                      if (policy?.discount['enabled'] == true) ...[
                        const SizedBox(height: UmiSpacing.lg),
                        Text(
                          l.discountLabel,
                          style: PosTheme.of(context).textTheme.titleMedium,
                        ),
                        Wrap(
                          spacing: UmiSpacing.sm,
                          children: [
                            PosChoice(
                              label: Text(l.percentageDiscountAction),
                              selected: discountType == 'order_percentage',
                              onSelected: (_) =>
                                  _setDiscountType('order_percentage'),
                            ),
                            PosChoice(
                              label: Text(l.fixedDiscountAction),
                              selected: discountType == 'order_fixed',
                              onSelected: (_) =>
                                  _setDiscountType('order_fixed'),
                            ),
                          ],
                        ),
                        const SizedBox(height: UmiSpacing.sm),
                        Row(
                          children: [
                            Expanded(
                              child: PosField(
                                controller: discountPercent,
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                      decimal: false,
                                    ),
                                decoration: PosFieldDecoration(
                                  labelText: discountType == 'order_fixed'
                                      ? l.discountAmountLabel
                                      : l.discountPercentLabel,
                                ),
                                // A discount moves the amount due (and the base the tip is
                                // computed on), so the tenders are re-seeded with it.
                                onChanged: (_) {
                                  setState(() => dirty = true);
                                  _rebalanceForDraftChange();
                                },
                              ),
                            ),
                            const SizedBox(width: UmiSpacing.md),
                            Expanded(
                              child: PosField(
                                controller: discountReason,
                                decoration: PosFieldDecoration(
                                  labelText: l.discountReasonLabel,
                                ),
                                // The reason is what makes the discount travel (`_discountDrafts`
                                // drops one without it), so it can turn the discount on and off.
                                onChanged: (_) {
                                  setState(() => dirty = true);
                                  _rebalanceForDraftChange();
                                },
                              ),
                            ),
                          ],
                        ),
                      ],
                      // One message at a time. A recovered conflict already says
                      // what happened and what to do; the draft's own stale error
                      // underneath it is the second, contradictory sentence the
                      // owner read on this screen.
                      if (state.errorCode != null &&
                          !recoveredTenderConflict) ...[
                        const SizedBox(height: UmiSpacing.md),
                        Semantics(
                          liveRegion: true,
                          child: Text(
                            _recoveryMessage(l, state.errorCode!),
                            style: TextStyle(
                              color: PosTheme.of(context).colorScheme.error,
                            ),
                          ),
                        ),
                      ],
                      if (state.phase ==
                          CheckoutPhase.confirmationRequired) ...[
                        const SizedBox(height: UmiSpacing.lg),
                        Semantics(
                          liveRegion: true,
                          child: Text(l.totalsConfirmedBody),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              const SizedBox(width: UmiSpacing.lg),
              Expanded(
                flex: 5,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // THE CARD FACE CENTRES; THE OTHERS READ TOP-DOWN. A tender
                    // that is waiting on a terminal is not a form — it is one
                    // fact ("the terminal has not answered yet") and the operator
                    // stands there watching it. Left at the top of a 5/11 column
                    // it was a small card with ~700 px of empty panel under it
                    // and the charge button stranded at the bottom, which reads
                    // as a half-drawn screen rather than as a wait. So, and only
                    // while the card face is the one on screen, the switch takes
                    // the column's free space and centres what it draws.
                    // A card face is a full-column statement because a tender
                    // waiting on a terminal IS the whole job — unless the card is
                    // only part of a divided check. On a cash + card split the
                    // cashier still has to take the cash and read the change, so
                    // the keypad keeps the column and the card's own amount and
                    // progress stay in the bill column, where they already are.
                    //
                    // Both card faces sit in the free space rather than at the
                    // top of it: whichever terminal owns the sale, the panel is
                    // one fact to watch, and left at the top it stranded ~400 px
                    // of empty panel under itself on a 1080-tall till.
                    if (!cashEnabled)
                      Expanded(
                        child: Center(
                          child: AnimatedSwitcher(
                            duration:
                                (MediaQuery.maybeDisableAnimationsOf(context) ??
                                    false)
                                ? Duration.zero
                                : UmiMotion.standard,
                            transitionBuilder: (child, animation) =>
                                FadeTransition(
                                  opacity: animation,
                                  child: SlideTransition(
                                    position: Tween<Offset>(
                                      begin: const Offset(0, 0.04),
                                      end: Offset.zero,
                                    ).animate(animation),
                                    child: child,
                                  ),
                                ),
                            child: _padTarget.startsWith('tip_')
                                ? _tipKeypadFace(context)
                                : cardEnabled
                                ? _cardTerminalFace(context, totals)
                                : bankEnabled
                                ? _bankTransferFace(context, totals, policy)
                                : _terminalTenderFace(context, totals),
                          ),
                        ),
                      )
                    else
                      AnimatedSwitcher(
                        // The keypad belongs to cash. A short slide makes the
                        // surface read as a swap rather than as a redraw.
                        duration:
                            (MediaQuery.maybeDisableAnimationsOf(context) ??
                                false)
                            ? Duration.zero
                            : UmiMotion.standard,
                        transitionBuilder: (child, animation) => FadeTransition(
                          opacity: animation,
                          child: SlideTransition(
                            position: Tween<Offset>(
                              begin: const Offset(0, 0.04),
                              end: Offset.zero,
                            ).animate(animation),
                            child: child,
                          ),
                        ),
                        // Cash on the sale keeps the cash face — on a divided
                        // check too, because the keypad is what takes the cash.
                        child: _cashTenderFace(totals, grandTotal),
                      ),
                    // The terminal faces already took the free space (above),
                    // so the spacer belongs to the keypad, which keeps its own
                    // height and must not drift away from the charge button.
                    if (cashEnabled) const Spacer(),
                    PosButton(
                      // An unreadable amount never leaves the terminal. Sending it
                      // meant tendering a number the cashier did not type.
                      style: PosButton.styleFrom(
                        minimumSize: const Size.fromHeight(64),
                        textStyle: PosTheme.of(context).textTheme.titleLarge,
                      ),
                      // While a charge is at the terminal the button is inert:
                      // pressing it again must never ask for a second charge.
                      // Once the wait is over (approved, or unresolved) it is
                      // live again, because those are decisions.
                      onPressed:
                          !_amountsReadable ||
                              _chargeInFlight ||
                              (cashEnabled &&
                                  _minorUnits(cashReceived.text) <
                                      ((terminalEnabled ||
                                              cardEnabled ||
                                              bankEnabled)
                                          ? _minorUnits(cashApplied.text)
                                          : grandTotal)) ||
                              // A recovered combination this location cannot take
                              // cannot be charged either, and offering a live
                              // button for it is the contradiction itself.
                              recoveredTenderConflict ||
                              cardCaptureInFlight ||
                              cardWaiting ||
                              // A split whose legs do not add up to the bill
                              // cannot be charged; the reading above says by
                              // how much.
                              (_splitMode &&
                                  _tenderLegCount >= 2 &&
                                  _tenderedLegsMinorUnits != grandTotal)
                          ? null
                          : state.phase == CheckoutPhase.awaitingApproval
                          ? () => _requestApproval(context)
                          : state.phase == CheckoutPhase.confirmationRequired &&
                                !dirty
                          ? () => _confirm(totals)
                          : () => _review(totals),
                      child: Text(
                        state.phase == CheckoutPhase.awaitingApproval
                            ? l.managerApprovalAction
                            : state.phase == CheckoutPhase.confirmationRequired
                            ? l.confirmAndPayAction
                            // The total rides on the button, so the cashier confirms
                            // the amount at the moment of the tap (SOTA convention).
                            : '${Localizations.localeOf(context).languageCode == 'es' ? 'Pagar' : 'Pay'} · ${_money({'currency': totals.grandTotal['currency'], 'minorUnits': grandTotal})}',
                      ),
                    ),
                    const SizedBox(height: UmiSpacing.sm),
                    PosTextButton(
                      onPressed: () => _closeCheckout(context),
                      child: Text(l.closeAction),
                    ),
                  ],
                ),
              ),
            ],
          ),
        },
      ),
    );
  }

  /// What the tender is doing, said before the operator taps anything.
  ///
  /// Two selected method tiles with nothing said about them is the screen the
  /// owner called confusing, and it was two different screens wearing one face: a
  /// SPLIT — the same customer paying with two methods, which this location may
  /// allow — and a recovered draft holding a split this location may NOT take. The
  /// first is a choice and is named with its legs in the order they are charged;
  /// the second is a refusal and is named with the one honest way forward. Silence
  /// in the middle of those two is what made the tiles read as a contradiction.
  Widget _tenderReading(BuildContext context, TotalsPreview totals) {
    final l = AppLocalizations.of(context);
    final scheme = PosTheme.of(context).colorScheme;
    if (recoveredTenderConflict) {
      return _TenderNotice(
        tone: scheme.errorContainer,
        ink: scheme.onErrorContainer,
        icon: PosGlyphs.reportProblemOutlined,
        title: l.tenderConflictTitle,
        body: l.tenderConflictBody,
      );
    }
    final currency = totals.grandTotal['currency'] as String? ?? '';
    String amount(int minorUnits) =>
        _money({'currency': currency, 'minorUnits': minorUnits});
    String money(TextEditingController field) =>
        amount(_minorUnits(field.text));
    // Cash first, then the card legs: the drawer is what the operator takes at
    // the counter and what the change is measured from, so it is the leg the
    // rest of the split is reasoned about from.
    final legs = <String>[
      if (cashEnabled) '${l.cashPayment}: ${money(cashApplied)}',
      if (cardEnabled) '${l.cardTerminalLabel}: ${money(cardAmount)}',
      if (terminalEnabled) '${l.manualTerminalLabel}: ${money(terminalAmount)}',
      if (bankEnabled) '${l.bankTransferLabel}: ${money(bankAmount)}',
    ];
    if (legs.length < 2) {
      // An armed split with one leg is half a decision: name the next step
      // instead of leaving the operator to guess what the control did.
      if (!_splitMode) return const SizedBox.shrink();
      return _TenderNotice(
        tone: scheme.surfaceContainerHighest,
        ink: scheme.onSurface,
        icon: PosGlyphs.callSplit,
        title: l.splitTenderTitle,
        body: l.splitTenderPickSecond,
      );
    }
    final grandTotal = _dueMinorUnits(totals);
    final difference = _tenderedLegsMinorUnits - grandTotal;
    return _TenderNotice(
      tone: scheme.surfaceContainerHighest,
      ink: scheme.onSurface,
      icon: PosGlyphs.callSplit,
      title: l.splitTenderTitle,
      body: [
        for (var index = 0; index < legs.length; index++)
          '${index + 1}. ${legs[index]}',
        // A split that does not add up is not payable, and saying by how much
        // is the difference between a dead button and a next step.
        if (difference < 0) l.tenderShortBy(amount(-difference)),
        if (difference > 0) l.tenderOverBy(amount(difference)),
      ].join('   '),
    );
  }

  /// The cash face of the tender surface: the keypad, then the change panel it
  /// drives.
  ///
  /// The keypad fills the column, so its keys line up with the change panel
  /// under them and the charge button under that. It used to be capped at 340 px
  /// and left-aligned, which parked dead space beside it and made the money half
  /// of the screen look unfinished.
  Widget _cashTenderFace(TotalsPreview totals, int grandTotal) => Column(
    key: const ValueKey('tender-cash'),
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _Numpad(onKey: _pushDigit),
      // The change due stays beside the keypad that changes it: the cashier
      // types what the customer put down and watches this number, so the two
      // cannot be a column apart.
      const SizedBox(height: UmiSpacing.md),
      Builder(
        builder: (context) {
          final es = Localizations.localeOf(context).languageCode == 'es';
          final received = _minorUnits(cashReceived.text);
          // Change is measured against what the CASH LEG owes, not the bill.
          // On a split the card pays the rest: a customer who hands over 50.00
          // for a 27.50 cash leg gets 22.50 back, and this said "Falta por
          // cobrar MXN 5.00" because it compared the drawer against the whole
          // bill (50.00 - 55.00).
          // Either card tile consumes the rest of the bill, so the change is
          // measured against the cash leg on both kinds of split — a cash +
          // card-terminal split used to compare the drawer against the whole
          // bill and read "Falta por cobrar" on money that was fully covered.
          final cashLeg = (terminalEnabled || cardEnabled || bankEnabled)
              ? _minorUnits(cashApplied.text)
              : grandTotal;
          final change = received - cashLeg;
          final owes = change < 0;
          final scheme = PosTheme.of(context).colorScheme;
          final tone = owes ? scheme.errorContainer : scheme.primaryContainer;
          final ink = owes
              ? scheme.onErrorContainer
              : scheme.onPrimaryContainer;
          return Container(
            padding: const EdgeInsets.symmetric(
              horizontal: UmiSpacing.lg,
              vertical: UmiSpacing.md,
            ),
            decoration: BoxDecoration(
              color: tone,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  owes
                      ? (es ? 'Falta por cobrar' : 'Amount due')
                      : (es ? 'Cambio' : 'Change due'),
                  style: PosTheme.of(
                    context,
                  ).textTheme.titleMedium?.copyWith(color: ink),
                ),
                Text(
                  _money({
                    'currency': totals.grandTotal['currency'] as String? ?? '',
                    'minorUnits': change.abs(),
                  }),
                  style: PosTheme.of(context).textTheme.headlineMedium
                      ?.copyWith(fontWeight: FontWeight.bold, color: ink),
                ),
              ],
            ),
          );
        },
      ),
    ],
  );

  Widget _tipKeypadFace(BuildContext context) {
    final l = AppLocalizations.of(context);
    final fixed = _padTarget == 'tip_fixed';
    return Column(
      key: const ValueKey('tender-tip-keypad'),
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                fixed ? l.customTipFixedLabel : l.customTipPercentLabel,
                style: PosTheme.of(context).textTheme.titleMedium,
              ),
            ),
            PosTextButton(
              onPressed: () => setState(() => _padTarget = 'cash'),
              child: Text(l.confirmAction),
            ),
          ],
        ),
        const SizedBox(height: UmiSpacing.sm),
        _Numpad(onKey: _pushDigit),
      ],
    );
  }

  Widget _bankTransferFace(
    BuildContext context,
    TotalsPreview totals,
    CheckoutPolicy? policy,
  ) {
    final l = AppLocalizations.of(context);
    final theme = PosTheme.of(context);
    final scheme = theme.colorScheme;
    return Container(
      key: const ValueKey('tender-bank-transfer'),
      padding: const EdgeInsets.all(UmiSpacing.xl),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHigh,
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: BorderRadius.circular(UmiRadius.surface),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: PosIcon(
              PosGlyphs.accountBalanceWalletOutlined,
              size: 56,
              color: scheme.primary,
            ),
          ),
          const SizedBox(height: UmiSpacing.md),
          Text(
            l.bankTransferLabel,
            textAlign: TextAlign.center,
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: UmiSpacing.sm),
          Text(
            _money({
              'currency': totals.grandTotal['currency'],
              'minorUnits': _minorUnits(bankAmount.text),
            }),
            textAlign: TextAlign.center,
            style: theme.textTheme.displaySmall?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: UmiSpacing.sm),
          Text(
            l.bankTransferPendingNote,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
          if (_bankAvailable(policy)) ...[
            const SizedBox(height: UmiSpacing.lg),
            PosButton.tonal(
              onPressed: () => _showBankInstructions(policy!, totals),
              child: Text(l.bankTransferViewDetails),
            ),
          ],
        ],
      ),
    );
  }

  Widget _tapToPayIcon(Color color) => SvgPicture.asset(
    'assets/icons/tap_to_pay.svg',
    width: 104,
    height: 78,
    fit: BoxFit.contain,
    colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
    excludeFromSemantics: true,
  );

  /// The card-terminal face: the operator declares the outcome here because the
  /// POS never reads it.
  Widget _terminalTenderFace(BuildContext context, TotalsPreview totals) {
    final l = AppLocalizations.of(context);
    final theme = PosTheme.of(context);
    final scheme = theme.colorScheme;
    final amount = _money({
      'currency': totals.grandTotal['currency'],
      'minorUnits': _minorUnits(terminalAmount.text),
    });
    final statusInk = switch (terminalStatus) {
      'operator_reported_failure' => scheme.error,
      'confirmed_success' => scheme.primary,
      _ => scheme.onSurfaceVariant,
    };
    return Container(
      key: const ValueKey('tender-terminal'),
      padding: const EdgeInsets.all(UmiSpacing.xl),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHigh,
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: BorderRadius.circular(UmiRadius.surface),
      ),
      child: Column(
        // The panel is one fact, not a form: it shrink-wraps and centres in the
        // column instead of stretching into a mostly empty box.
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(child: _tapToPayIcon(scheme.primary)),
          const SizedBox(height: UmiSpacing.md),
          Text(
            l.terminalChargeTitle,
            textAlign: TextAlign.center,
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: UmiSpacing.sm),
          Text(
            amount,
            textAlign: TextAlign.center,
            style: theme.textTheme.displaySmall?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: UmiSpacing.sm),
          Text(
            l.terminalChargeInstruction(amount),
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: UmiSpacing.lg),
          Container(
            padding: const EdgeInsets.all(UmiSpacing.md),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(UmiRadius.control),
            ),
            child: Row(
              children: [
                Text(l.terminalStatusLabel, style: theme.textTheme.bodyMedium),
                const SizedBox(width: UmiSpacing.md),
                Expanded(
                  child: Text(
                    _terminalStatusSentence(l),
                    textAlign: TextAlign.right,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: statusInk,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: UmiSpacing.lg),
          Text(
            l.terminalOperatorDeclaration,
            style: theme.textTheme.bodySmall?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }

  /// The status sentence the terminal face shows for [terminalStatus].
  String _terminalStatusSentence(AppLocalizations l) =>
      switch (terminalStatus) {
        'operator_processing_externally' => l.terminalStatusProcessing,
        'confirmed_success' => l.terminalStatusConfirmed,
        'operator_reported_failure' => l.terminalStatusFailed,
        'outcome_unknown' => l.terminalStatusUnknown,
        'cancelled_before_confirmation' => l.terminalStatusCancelled,
        _ => l.terminalStatusNotStarted,
      };

  /// The CARD terminal's face: the amount, what the terminal is doing, and the
  /// one action the operator owns — leaving it to the terminal, or not.
  ///
  /// It never declares an outcome. The sentence about the outcome lives in the
  /// notice above the tiles, so a refusal stays readable after the tile is gone.
  Widget _cardTerminalFace(BuildContext context, TotalsPreview totals) {
    final l = AppLocalizations.of(context);
    final theme = PosTheme.of(context);
    final scheme = theme.colorScheme;
    final amount = _money({
      'currency': totals.grandTotal['currency'] as String? ?? '',
      'minorUnits': _minorUnits(cardAmount.text),
    });
    final approved = cardStatus == 'confirmed_success';
    final unresolved = cardStatus == 'outcome_unknown';
    final waiting = cardStatus == 'awaiting_terminal';
    return Container(
      key: const ValueKey('tender-card-terminal'),
      padding: const EdgeInsets.all(UmiSpacing.xl),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHigh,
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: BorderRadius.circular(UmiRadius.surface),
      ),
      child: Column(
        // One fact to watch, not a form to fill in: it centres in the column
        // rather than stretching to the charge button.
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: approved
                ? SizedBox(
                    width: 104,
                    height: 78,
                    child: Center(
                      child: PosIcon(
                        PosGlyphs.checkCircleOutline,
                        size: 56,
                        color: scheme.primary,
                      ),
                    ),
                  )
                : _tapToPayIcon(unresolved ? scheme.error : scheme.primary),
          ),
          const SizedBox(height: UmiSpacing.md),
          Text(
            approved
                ? l.terminalStatusConfirmed
                : unresolved
                ? l.terminalStatusUnknown
                : waiting
                ? l.terminalWaitingTitle
                : l.cardTerminalLabel,
            textAlign: TextAlign.center,
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: UmiSpacing.sm),
          Text(
            amount,
            textAlign: TextAlign.center,
            style: theme.textTheme.displaySmall?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: UmiSpacing.lg),
          _cardTerminalProgress(context),
          if (cardWaiting) ...[
            const SizedBox(height: UmiSpacing.lg),
            PosOutlineButton(
              onPressed: _stopWaitingForCardTerminal,
              child: Text(l.terminalStopWaitingAction),
            ),
          ],
        ],
      ),
    );
  }

  /// The terminal's own progress, exactly as the provider states it.
  Widget _cardTerminalProgress(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = PosTheme.of(context);
    final scheme = theme.colorScheme;
    final status = cardProviderStatus;
    return Container(
      padding: const EdgeInsets.all(UmiSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(UmiRadius.control),
      ),
      child: Row(
        children: [
          Text(l.terminalStatusLabel, style: theme.textTheme.bodyMedium),
          const SizedBox(width: UmiSpacing.md),
          Expanded(
            child: Text(
              status == null || status.isEmpty
                  ? l.terminalStatusNotStarted
                  : status,
              textAlign: TextAlign.right,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: switch (cardStatus) {
                  'confirmed_success' => scheme.primary,
                  'outcome_unknown' => scheme.error,
                  _ => scheme.onSurfaceVariant,
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// What the terminal said, or what the till knows about it instead.
  Widget _cardTerminalNotice(BuildContext context, String message) {
    final theme = PosTheme.of(context);
    final scheme = theme.colorScheme;
    final tone = switch (cardStatus) {
      'confirmed_success' => scheme.primaryContainer,
      'outcome_unknown' => scheme.errorContainer,
      _ => scheme.surfaceContainerHighest,
    };
    final ink = switch (cardStatus) {
      'confirmed_success' => scheme.onPrimaryContainer,
      'outcome_unknown' => scheme.onErrorContainer,
      _ => scheme.onSurfaceVariant,
    };
    return Semantics(
      liveRegion: true,
      child: Container(
        key: const ValueKey('card-terminal-notice'),
        padding: const EdgeInsets.all(UmiSpacing.md),
        decoration: BoxDecoration(
          color: tone,
          borderRadius: BorderRadius.circular(UmiRadius.control),
        ),
        child: Text(
          message,
          style: theme.textTheme.bodyMedium?.copyWith(color: ink),
        ),
      ),
    );
  }

  Widget _customerValueSection(TotalsPreview totals) {
    final controller = widget.customerValue!;
    final state = controller.state;
    final preview = state.preview;
    final es = Localizations.localeOf(context).languageCode == 'es';
    if (preview == null) {
      return PosListRow(
        leading: const PosIcon(PosGlyphs.loyaltyOutlined),
        title: Text(es ? 'Valor del cliente' : 'Customer value'),
        subtitle: Text(es ? 'Consulta en curso.' : 'Loading value summary.'),
      );
    }
    final summary = preview.summary;
    final points = summary['points'] as Map<String, Object?>?;
    final wallet = summary['wallet'] as Map<String, Object?>?;
    final giftCards = (summary['giftCards'] as List<Object?>? ?? const [])
        .cast<Map<String, Object?>>();
    final permissions = widget.entry.state.operator?.permissions ?? const [];
    return PosCard(
      margin: const EdgeInsets.only(top: UmiSpacing.lg),
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              es ? 'Lealtad y saldo' : 'Loyalty and balance',
              style: PosTheme.of(context).textTheme.titleMedium,
            ),
            if (points != null)
              Text(
                es
                    ? 'Puntos disponibles: ${points['available']} · pendientes: ${points['pending']}'
                    : 'Available points: ${points['available']} · pending: ${points['pending']}',
              ),
            if (preview.earn != null)
              Text(
                es
                    ? 'Puntos previstos: ${preview.earn!['expectedPoints']}'
                    : 'Expected points: ${preview.earn!['expectedPoints']}',
              ),
            for (final reward in preview.rewards)
              PosListRow(
                contentPadding: EdgeInsets.zero,
                leading: const PosIcon(PosGlyphs.redeemOutlined),
                title: Text(
                  (reward['reward']! as Map<String, Object?>)['displayName']!
                      as String,
                ),
                subtitle: Text(
                  (reward['eligible']! as bool)
                      ? '${reward['pointsCost']} ${es ? 'puntos' : 'points'}'
                      : reward['state'] == 'replacement_confirmation_required'
                      ? (es
                            ? 'Requiere reemplazar el reward actual'
                            : 'Requires reward replacement')
                      : (es ? 'No disponible' : 'Unavailable'),
                ),
                trailing:
                    state.rewardAuthorization?.rewardId ==
                        (reward['reward']! as Map<String, Object?>)['id']
                    ? const PosIcon(PosGlyphs.checkCircleOutline)
                    : PosTextButton(
                        onPressed:
                            (reward['eligible'] == true ||
                                    reward['state'] == 'approval_required' ||
                                    reward['state'] ==
                                        'replacement_confirmation_required') &&
                                permissions.contains('loyalty.reward.authorize')
                            ? () => _authorizeReward(reward, totals)
                            : null,
                        child: Text(es ? 'Usar' : 'Use'),
                      ),
              ),
            if (wallet != null && permissions.contains('wallet.authorize'))
              PosListRow(
                contentPadding: EdgeInsets.zero,
                leading: const PosIcon(PosGlyphs.accountBalanceWalletOutlined),
                title: Text(es ? 'Cartera' : 'Wallet'),
                subtitle: Text(
                  _money({
                    'minorUnits': wallet['available'],
                    'currency': wallet['currency'],
                  }),
                ),
                trailing: PosTextButton(
                  onPressed: () => _authorizeStoredValue(
                    totals,
                    accountType: 'wallet',
                    account: wallet,
                  ),
                  child: Text(es ? 'Aplicar' : 'Apply'),
                ),
              ),
            for (final card in giftCards)
              if (permissions.contains('gift_card.authorize'))
                PosListRow(
                  contentPadding: EdgeInsets.zero,
                  leading: const PosIcon(PosGlyphs.cardGiftcardOutlined),
                  title: Text(card['maskedCode']! as String),
                  subtitle: Text(
                    _money({
                      'minorUnits':
                          (card['balance']!
                              as Map<String, Object?>)['available'],
                      'currency': card['currency'],
                    }),
                  ),
                  trailing: PosTextButton(
                    onPressed: () => _authorizeStoredValue(
                      totals,
                      accountType: 'gift_card',
                      account: {
                        'accountId': card['id'],
                        'publicReference': card['publicReference'],
                        'customerId': card['customerId'],
                        'available':
                            (card['balance']!
                                as Map<String, Object?>)['available'],
                        'currency': card['currency'],
                      },
                    ),
                    child: Text(es ? 'Aplicar' : 'Apply'),
                  ),
                ),
            if (permissions.contains('gift_card.lookup'))
              PosTextButton.icon(
                onPressed: () => _lookupGiftCard(totals),
                icon: const PosIcon(PosGlyphs.qrCodeScannerOutlined),
                label: Text(es ? 'Buscar tarjeta regalo' : 'Look up gift card'),
              ),
            if (permissions.contains('gift_card.issue'))
              PosTextButton.icon(
                onPressed: () => _issueSaleFundedGiftCard(totals),
                icon: const PosIcon(PosGlyphs.addCardOutlined),
                label: Text(
                  es ? 'Vender tarjeta de regalo' : 'Sell a gift card',
                ),
              ),
            if (state.storedValueAuthorizations.isNotEmpty ||
                state.rewardAuthorization != null)
              Text(
                es
                    ? 'Autorización temporal lista. Revisa los totales otra vez.'
                    : 'Temporary authorization ready. Review totals again.',
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _authorizeReward(
    Map<String, Object?> eligibility,
    TotalsPreview totals,
  ) async {
    final cart = widget.cart.state.cart!;
    final customerId = widget.sales.state.sale?.customer?['id'] as String?;
    final operator = widget.entry.state.operator;
    if (customerId == null || operator == null) return;
    final reward = eligibility['reward']! as Map<String, Object?>;
    final scope = CustomerValueScope(
      merchantId: cart.merchantId,
      locationId: cart.locationId,
      operatorSessionId: operator.id,
    );
    final current = widget.customerValue!.state.rewardAuthorization;
    if (current != null && current.rewardId != reward['id']) {
      final replace = await showPosDialog<bool>(
        context: context,
        builder: (context) => PosAlertDialog(
          title: Text(
            Localizations.localeOf(context).languageCode == 'es'
                ? 'Reemplazar reward'
                : 'Replace reward',
          ),
          content: Text(
            Localizations.localeOf(context).languageCode == 'es'
                ? 'El sistema liberará el reward actual antes de autorizar el nuevo.'
                : 'The system will release the current reward before it authorizes the new reward.',
          ),
          actions: [
            PosTextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(
                Localizations.localeOf(context).languageCode == 'es'
                    ? 'Conservar actual'
                    : 'Keep current',
              ),
            ),
            PosButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(
                Localizations.localeOf(context).languageCode == 'es'
                    ? 'Reemplazar'
                    : 'Replace',
              ),
            ),
          ],
        ),
      );
      if (replace != true || !mounted) return;
      final released = await widget.customerValue!.releaseAuthorization(
        scope,
        authorizationId: current.id,
        accountType: 'loyalty_reward',
        fingerprint: current.fingerprint,
      );
      if (!released) return;
      final checkoutFingerprint =
          widget.checkout.state.result?.confirmation['fingerprint'] as String?;
      if (checkoutFingerprint == null) return;
      await widget.customerValue!.loadPreview(
        scope,
        saleId: cart.id,
        saleVersion: cart.version,
        customerId: customerId,
        checkoutFingerprint: checkoutFingerprint,
      );
    }
    _applyCustomerValue(totals);
    await _review(totals);
    final storedValueFingerprint =
        widget.checkout.state.result?.confirmation['storedValueFingerprint']
            as String?;
    var authorization = await widget.customerValue!.authorizeReward(
      scope,
      saleId: cart.id,
      saleVersion: cart.version,
      customerId: customerId,
      rewardId: reward['id']! as String,
      storedValueFingerprint: storedValueFingerprint,
    );
    final approvalPermission =
        widget.customerValue!.state.pendingRewardApprovalPermission;
    final approvalFingerprint =
        widget.customerValue!.state.pendingRewardApprovalFingerprint;
    if (authorization == null &&
        approvalPermission != null &&
        approvalFingerprint != null &&
        mounted) {
      final approvalId = await _requestRewardApproval(
        approvalPermission,
        approvalFingerprint,
      );
      if (approvalId == null) return;
      authorization = await widget.customerValue!.authorizeReward(
        scope,
        saleId: cart.id,
        saleVersion: cart.version,
        customerId: customerId,
        rewardId: reward['id']! as String,
        storedValueFingerprint: storedValueFingerprint,
        approvalId: approvalId,
        approvalFingerprint: approvalFingerprint,
      );
    }
    if (authorization == null) return;
    _applyCustomerValue(totals);
  }

  Future<void> _authorizeStoredValue(
    TotalsPreview totals, {
    required String accountType,
    required Map<String, Object?> account,
  }) async {
    final available = (account['available']! as num).toInt();
    final currency = account['currency']! as String;
    final amount = await _requestValueAmount(available, currency);
    if (amount == null) return;
    final cart = widget.cart.state.cart!;
    final operator = widget.entry.state.operator;
    if (operator == null) return;
    final authorization = await widget.customerValue!.authorizeStoredValue(
      CustomerValueScope(
        merchantId: cart.merchantId,
        locationId: cart.locationId,
        operatorSessionId: operator.id,
      ),
      accountType: accountType,
      accountId: account['accountId']! as String,
      accountPublicReference:
          account['publicReference'] as String? ??
          '${accountType == 'wallet' ? 'WAL' : 'GFT'}-${account['accountId']}',
      customerId:
          account['customerId'] as String? ??
          widget.sales.state.sale?.customer?['id'] as String?,
      saleId: cart.id,
      saleVersion: cart.version,
      amountMinorUnits: amount,
      currency: currency,
    );
    if (authorization == null) return;
    _applyCustomerValue(totals);
  }

  Future<void> _lookupGiftCard(TotalsPreview totals) async {
    final code = TextEditingController();
    final es = Localizations.localeOf(context).languageCode == 'es';
    final accepted = await showPosDialog<bool>(
      context: context,
      builder: (context) => PosAlertDialog(
        title: Text(es ? 'Buscar tarjeta regalo' : 'Look up gift card'),
        content: PosField(
          controller: code,
          autofocus: true,
          obscureText: true,
          decoration: PosFieldDecoration(labelText: es ? 'Código' : 'Code'),
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(es ? 'Cancelar' : 'Cancel'),
          ),
          PosButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(es ? 'Buscar' : 'Look up'),
          ),
        ],
      ),
    );
    final value = code.text;
    code.dispose();
    if (accepted != true || value.trim().isEmpty) return;
    final cart = widget.cart.state.cart!;
    final operator = widget.entry.state.operator;
    if (operator == null) return;
    final card = await widget.customerValue!.lookupGiftCard(
      CustomerValueScope(
        merchantId: cart.merchantId,
        locationId: cart.locationId,
        operatorSessionId: operator.id,
      ),
      value,
    );
    if (card == null) return;
    await _authorizeStoredValue(
      totals,
      accountType: 'gift_card',
      account: {
        'accountId': card.id,
        'publicReference': card.publicReference,
        'customerId': card.customerId,
        'available': card.balance['available'],
        'currency': card.currency,
      },
    );
  }

  Future<int?> _requestValueAmount(int available, String currency) async {
    final amount = TextEditingController();
    final es = Localizations.localeOf(context).languageCode == 'es';
    final accepted = await showPosDialog<bool>(
      context: context,
      builder: (context) => PosAlertDialog(
        title: Text(es ? 'Importe autorizado' : 'Authorized amount'),
        content: PosField(
          controller: amount,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: PosFieldDecoration(
            labelText:
                '$currency · ${es ? 'máximo' : 'maximum'} '
                '${formatMinorUnits(available)}',
          ),
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(es ? 'Cancelar' : 'Cancel'),
          ),
          PosButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(es ? 'Autorizar' : 'Authorize'),
          ),
        ],
      ),
    );
    final value = _minorUnits(amount.text);
    amount.dispose();
    return accepted == true && value > 0 && value <= available ? value : null;
  }

  Future<void> _issueSaleFundedGiftCard(TotalsPreview totals) async {
    final cart = widget.cart.state.cart;
    final operator = widget.entry.state.operator;
    final controller = widget.customerValue;
    if (cart == null ||
        operator == null ||
        controller == null ||
        cart.items.isEmpty) {
      return;
    }
    final es = Localizations.localeOf(context).languageCode == 'es';
    String? selectedLineId;
    final accepted = await showPosDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => PosAlertDialog(
          title: Text(
            es ? 'Tarjeta financiada por venta' : 'Sale-funded gift card',
          ),
          content: PosSelectFormField<String>(
            initialValue: selectedLineId,
            decoration: PosFieldDecoration(
              labelText: es ? 'Línea de tarjeta' : 'Gift-card line',
            ),
            items: cart.items
                .where((item) => item['saleAction'] == 'gift_card')
                .map(
                  (item) => PosSelectItem<String>(
                    value: item['id']! as String,
                    child: Text(item['productName']! as String),
                  ),
                )
                .toList(),
            onChanged: (value) => setDialogState(() {
              selectedLineId = value;
            }),
          ),
          actions: [
            PosTextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: Text(es ? 'Cancelar' : 'Cancel'),
            ),
            PosButton(
              onPressed: () {
                Navigator.pop(dialogContext, selectedLineId != null);
              },
              child: Text(es ? 'Revisar' : 'Review'),
            ),
          ],
        ),
      ),
    );
    if (accepted != true || selectedLineId == null || !mounted) return;
    final line = cart.items.singleWhere((item) => item['id'] == selectedLineId);
    final linePrice = line['price']! as Map<String, Object?>;
    final value = linePrice['lineTotal']! as Map<String, Object?>;
    final scope = CustomerValueScope(
      merchantId: cart.merchantId,
      locationId: cart.locationId,
      operatorSessionId: operator.id,
    );
    final preview = await controller.previewGiftCardIssuance(
      scope,
      valueMinorUnits: (value['minorUnits']! as num).toInt(),
      currency: value['currency']! as String,
      source: 'sale',
      saleId: cart.id,
      saleLineId: selectedLineId,
    );
    if (preview == null || !mounted) return;
    String? approvalId;
    if (preview.approvalPermission != null) {
      approvalId = await _requestRewardApproval(
        preview.approvalPermission!,
        preview.fingerprint,
        title: es ? 'Aprobar tarjeta' : 'Approve gift card',
      );
      if (approvalId == null) return;
    }
    final issued = await controller.issueGiftCard(
      scope,
      approvalId: approvalId,
      approvalFingerprint: approvalId == null ? null : preview.fingerprint,
    );
    if (issued?.fundingAssignment == null || !mounted) return;
    _applyCustomerValue(totals);
  }

  Future<void> _revealFundedGiftCardAfterCommit() async {
    if (fundedGiftCardRevealed || fundedGiftCardRevealInFlight) return;
    final controller = widget.customerValue;
    final result = controller?.state.giftCardIssuance;
    final cart = widget.cart.state.cart;
    final operator = widget.entry.state.operator;
    if (controller == null ||
        result?.fundingAssignment == null ||
        cart == null ||
        operator == null) {
      return;
    }
    fundedGiftCardRevealInFlight = true;
    final secret = await controller.revealGiftCardSecret(
      CustomerValueScope(
        merchantId: cart.merchantId,
        locationId: cart.locationId,
        operatorSessionId: operator.id,
      ),
      result!.deliveryToken,
    );
    fundedGiftCardRevealInFlight = false;
    if (secret == null) {
      if (!mounted) return;
      final es = Localizations.localeOf(context).languageCode == 'es';
      // This is the one message in the till that carried an action, so it is
      // not simply dropped: it moves into the same dialog the successful reveal
      // uses, where the retry is an ordinary button instead of a bar that
      // disappears while the operator is reaching for it.
      await showPosDialog<void>(
        context: context,
        builder: (dialogContext) => PosAlertDialog(
          title: Text(es ? 'Código no recibido' : 'Code not received'),
          content: Text(
            es
                ? 'No se recibió el código. Recupera el resultado original.'
                : 'The code response was lost. Recover the original result.',
          ),
          actions: [
            PosTextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: Text(es ? 'Cerrar' : 'Close'),
            ),
            PosButton(
              onPressed: () {
                Navigator.pop(dialogContext);
                unawaited(_revealFundedGiftCardAfterCommit());
              },
              child: Text(es ? 'Reintentar' : 'Retry'),
            ),
          ],
        ),
      );
      return;
    }
    if (!mounted) return;
    fundedGiftCardRevealed = true;
    final es = Localizations.localeOf(context).languageCode == 'es';
    await showPosDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => PosAlertDialog(
        title: Text(es ? 'Código de entrega única' : 'One-time delivery code'),
        content: PosSelectableText('${secret.maskedReference}\n${secret.code}'),
        actions: [
          PosButton(
            onPressed: () => Navigator.pop(context),
            child: Text(es ? 'Código entregado' : 'Code delivered'),
          ),
        ],
      ),
    );
  }

  void _applyCustomerValue(TotalsPreview totals) {
    final controller = widget.customerValue!;
    final selection = controller.selection();
    final authorizations = controller.state.storedValueAuthorizations;
    storedValueTenders = authorizations
        .map(
          (authorization) => <String, Object?>{
            'id': authorization.allocationId,
            'type': authorization.accountType,
            'amount': {
              'minorUnits': authorization.amountMinorUnits,
              'currency': authorization.currency,
            },
            'amountReceived': null,
            'status': 'confirmed_success',
            'correlationId': authorization.correlationId,
            'authorizationId': authorization.id,
          },
        )
        .toList();
    method = authorizations.any((item) => item.accountType == 'gift_card')
        ? 'gift_card'
        : authorizations.isNotEmpty
        ? 'stored_value'
        : method;
    widget.checkout.applyCustomerValue(selection);
    setState(() => dirty = true);
  }

  Future<String?> _requestRewardApproval(
    String permission,
    String fingerprint, {
    String? title,
  }) async {
    final pin = TextEditingController();
    final es = Localizations.localeOf(context).languageCode == 'es';
    final accepted = await showPosDialog<bool>(
      context: context,
      builder: (dialogContext) => PosAlertDialog(
        title: Text(title ?? (es ? 'Aprobar reward' : 'Approve reward')),
        content: PosField(
          controller: pin,
          obscureText: true,
          keyboardType: TextInputType.number,
          autofocus: true,
          decoration: PosFieldDecoration(
            labelText: es ? 'PIN del responsable' : 'Manager PIN',
          ),
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(es ? 'Cancelar' : 'Cancel'),
          ),
          PosButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(es ? 'Aprobar' : 'Approve'),
          ),
        ],
      ),
    );
    final value = pin.text;
    pin.dispose();
    if (accepted != true || value.isEmpty) return null;
    return widget.entry.requestCheckoutApproval(
      managerPin: value,
      permission: permission,
      commandFingerprint: fingerprint,
    );
  }

  /// The amount a person typed, or zero when it is not an amount.
  ///
  /// The reading itself lives in `parseMinorUnits`, which refuses rather than
  /// invents: this copy used to answer `1,500.00` with zero and `0.999` with
  /// 0.99, on the tender that settles the sale. `_amountsReadable` is what stops
  /// an unreadable field from reaching the server; this getter only has to be
  /// safe for the running totals shown while the cashier is still typing.
  int _minorUnits(String raw) => parseMinorUnits(raw) ?? 0;

  /// A customer is attached to the sale, so loyalty and stored value apply.
  bool get _hasCustomer => widget.sales.state.sale?.customer != null;

  /// Every money field on the sheet is a well-formed amount.
  bool get _amountsReadable {
    for (final field in [
      if (cashEnabled) cashApplied,
      if (cashEnabled) cashReceived,
      if (terminalEnabled) terminalAmount,
      if (cardEnabled) cardAmount,
      if (bankEnabled) bankAmount,
    ]) {
      if (parseMinorUnits(field.text) == null) return false;
    }
    if (_splitMode &&
        _tenderLegCount >= 2 &&
        ((cashEnabled && _minorUnits(cashApplied.text) == 0) ||
            (terminalEnabled && _minorUnits(terminalAmount.text) == 0) ||
            (cardEnabled && _minorUnits(cardAmount.text) == 0) ||
            (bankEnabled && _minorUnits(bankAmount.text) == 0))) {
      return false;
    }
    return true;
  }

  void _setCash(bool selected, TotalsPreview totals) {
    // The till is never left with no method at all.
    if (!selected && _tenderLegCount <= 1) return;
    // A card the terminal may already have charged owns this sale. Outside a
    // split the cash tap REPLACES the card, so the same guard that stopped a
    // second method beside a locked card now stops the replacement: the
    // operator resolves the terminal, or closes the sale and leaves the attempt
    // recorded for whoever reconciles it. Clearing it here would hand a cash
    // sale the card tender nobody confirmed.
    if (selected && !_splitMode && cardEnabled && _cardTenderLocked) return;
    if (selected && _splitMode && _tenderLegCount >= _maxTenderLines) return;
    setState(() {
      cashEnabled = selected;
      // ONE method per sale unless the operator armed a split. Tapping a second
      // tile used to accumulate legs whenever the policy merely allowed mixed
      // tender, so a second method — and the server's refusal of it — arrived
      // without anyone asking. Now the tile replaces the selection.
      if (selected && !_splitMode) {
        terminalEnabled = false;
        cardEnabled = false;
        bankEnabled = false;
      }
      method = _selectedPaymentMethod;
      dirty = true;
      _balanceTenderFields(totals);
    });
  }

  /// Whether this location permits more than one payment method on one sale.
  /// Unknown policy reads as no, which is what `default-deny` means.
  bool get _mixedTenderAllowed =>
      widget.checkout.policy?.mixedTenderEnabled ?? false;

  /// The most tender lines this location takes on one sale.
  int get _maxTenderLines => widget.checkout.policy?.maximumTenderLines ?? 1;

  /// A split is possible here AND the operator asked for it.
  bool get _splitMode =>
      splitArmed && _mixedTenderAllowed && _maxTenderLines > 1;

  /// How many methods are on the sale right now.
  int get _tenderLegCount =>
      (cashEnabled ? 1 : 0) +
      (terminalEnabled ? 1 : 0) +
      (cardEnabled ? 1 : 0) +
      (bankEnabled ? 1 : 0);

  /// What the legs on screen add up to, in minor units.
  int get _tenderedLegsMinorUnits =>
      (cashEnabled ? _minorUnits(cashApplied.text) : 0) +
      (terminalEnabled ? _minorUnits(terminalAmount.text) : 0) +
      (cardEnabled ? _minorUnits(cardAmount.text) : 0) +
      (bankEnabled ? _minorUnits(bankAmount.text) : 0);

  String get _selectedPaymentMethod => bankEnabled
      ? 'bank_transfer'
      : (terminalEnabled || cardEnabled ? 'external_terminal' : 'cash');

  bool _bankAvailable(CheckoutPolicy? policy) =>
      policy?.bankTransferEnabled == true &&
      policy?.bankTransferDetails != null;

  /// How many method tiles this location offers: cash always, plus the manual
  /// terminal and the card terminal when they exist here.
  int _methodsOffered(CheckoutPolicy? policy) =>
      1 +
      ((policy?.manualTerminalEnabled ?? false) ? 1 : 0) +
      (widget.checkout.cardTerminalProviderId != null ? 1 : 0) +
      (_bankAvailable(policy) ? 1 : 0);

  /// The arm/disarm control exists only where a split is possible AND there is
  /// more than one way to pay for one.
  bool _splitControlOffered(CheckoutPolicy? policy) =>
      _mixedTenderAllowed && _maxTenderLines > 1 && _methodsOffered(policy) > 1;

  bool _partialControlOffered(CheckoutPolicy? policy) =>
      widget.checkout.canCollectPartialPayments &&
      (widget.cashShiftId != null ||
          (policy?.manualTerminalEnabled == true &&
              widget.entry.state.operator?.permissions.contains(
                    'checkout.terminal.confirm',
                  ) ==
                  true) ||
          policy?.bankTransferEnabled == true);

  Future<void> _openPartialCheckout() async {
    final l = AppLocalizations.of(context);
    final currency = shownTotals?.grandTotal['currency'] as String? ?? 'MXN';
    if (_discountDrafts(currency).isNotEmpty ||
        widget.checkout.customerValueSelection != null) {
      await showPosDialog<void>(
        context: context,
        builder: (dialogContext) => PosAlertDialog(
          title: Text(l.splitTenderTitle),
          content: Text(
            Localizations.localeOf(context).languageCode == 'es'
                ? 'Este cobro dividido todavía no admite descuentos ni saldo de cliente. Quita esos ajustes antes de dividir.'
                : 'Split payment does not yet support discounts or customer value. Remove those adjustments before splitting.',
          ),
          actions: [
            PosButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: Text(l.closeAction),
            ),
          ],
        ),
      );
      return;
    }
    if (!mounted) return;
    await _presentPartialCheckout();
  }

  Future<void> _chooseBank(CheckoutPolicy policy, TotalsPreview totals) async {
    if (!_bankAvailable(policy)) return;
    if (bankEnabled) {
      if (_tenderLegCount > 1) {
        setState(() {
          bankEnabled = false;
          bankConfirmed = false;
          method = _selectedPaymentMethod;
          dirty = true;
          _balanceTenderFields(totals);
        });
        return;
      }
      await _showBankInstructions(policy, totals);
      return;
    }
    if (cardEnabled && _cardTenderLocked) return;
    if (_splitMode &&
        _tenderLegCount >= _maxTenderLines &&
        !terminalEnabled &&
        !cardEnabled) {
      return;
    }
    final accepted = await _showBankInstructions(policy, totals);
    if (accepted != true || !mounted) return;
    setState(() {
      bankEnabled = true;
      bankConfirmed = false;
      terminalEnabled = false;
      cardEnabled = false;
      if (!_splitMode) cashEnabled = false;
      method = _selectedPaymentMethod;
      dirty = true;
      _balanceTenderFields(totals);
    });
  }

  Future<bool?> _showBankInstructions(
    CheckoutPolicy policy,
    TotalsPreview totals,
  ) => _showBankDetails(
    policy,
    currency: totals.grandTotal['currency'] as String? ?? 'MXN',
    amountMinor: bankEnabled
        ? _minorUnits(bankAmount.text)
        : _splitMode && cashEnabled
        ? _dueMinorUnits(totals) - _dueMinorUnits(totals) ~/ 2
        : _dueMinorUnits(totals),
    selected: bankEnabled,
  );

  Future<bool?> _showBankDetails(
    CheckoutPolicy policy, {
    required int amountMinor,
    required String currency,
    required bool selected,
  }) => _showBankTransferDetailsDialog(
    context,
    checkout: widget.checkout,
    cart: widget.cart,
    entry: widget.entry,
    amountMinor: amountMinor,
    currency: currency,
    selected: selected,
  );

  Future<bool> _confirmBankReceived() async {
    final confirmed = await showPosDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        final l = AppLocalizations.of(dialogContext);
        return PosAlertDialog(
          title: Text(l.bankTransferConfirmTitle),
          content: Text(l.bankTransferConfirmBody),
          actions: [
            PosTextButton(
              key: const ValueKey('bank-transfer-confirm-close'),
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: Text(l.closeAction),
            ),
            PosButton(
              key: const ValueKey('bank-transfer-confirm'),
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: Text(l.bankTransferConfirmAction),
            ),
          ],
        );
      },
    );
    if (confirmed != true || !mounted) return false;
    setState(() => bankConfirmed = true);
    return true;
  }

  Future<bool> _confirmManualTerminalCharge() async {
    final confirmed = await showPosDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        final l = AppLocalizations.of(dialogContext);
        final amount = _money({
          'currency': shownTotals?.grandTotal['currency'] ?? 'MXN',
          'minorUnits': _minorUnits(terminalAmount.text),
        });
        return PosAlertDialog(
          title: Text(l.manualTerminalConfirmTitle),
          content: Text(l.manualTerminalConfirmBody(amount)),
          actions: [
            PosTextButton(
              key: const ValueKey('manual-terminal-confirm-close'),
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: Text(l.closeAction),
            ),
            PosButton(
              key: const ValueKey('manual-terminal-confirm'),
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: Text(l.manualTerminalConfirmAction),
            ),
          ],
        );
      },
    );
    if (confirmed != true || !mounted) return false;
    setState(() {
      terminalStatus = 'confirmed_success';
      _confirmedManualTerminalMinorUnits = _minorUnits(terminalAmount.text);
    });
    return true;
  }

  void _setTerminal(bool selected, TotalsPreview totals) {
    if (!selected && _tenderLegCount <= 1) return;
    // Same rule as cash: a locked card tender is not replaced by the manual one.
    if (selected && cardEnabled && _cardTenderLocked) return;
    // The two terminals are the same wire type, so selecting this one retires
    // the card tile rather than adding a leg; the retired leg is not counted
    // against the location's line cap.
    final replacing = cardEnabled || bankEnabled;
    if (selected &&
        _splitMode &&
        _tenderLegCount - (replacing ? 1 : 0) >= _maxTenderLines) {
      return;
    }
    setState(() {
      terminalEnabled = selected;
      // The two terminals are different promises on the same wire type, so a
      // sale carries one of them at a time.
      if (selected) {
        cardEnabled = false;
        bankEnabled = false;
        bankConfirmed = false;
        if (!_splitMode) cashEnabled = false;
      }
      method = _selectedPaymentMethod;
      terminalStatus = selected
          ? 'operator_processing_externally'
          : 'cancelled_before_confirmation';
      _confirmedManualTerminalMinorUnits = null;
      dirty = true;
      _balanceTenderFields(totals);
    });
  }

  /// Select the CARD terminal: a real provider, followed by its own attempt.
  ///
  /// Nothing is declared here. Selecting the tile only arms the charge; the
  /// capture happens when the operator taps Cobrar, and the terminal's answer is
  /// what moves the tender — never a chip on this screen.
  void _setCard(bool selected, TotalsPreview totals) {
    if (!selected && _tenderLegCount <= 1) return;
    // A card the terminal may ALREADY have charged cannot be waved away by
    // tapping the tile off. Only the terminal's own answer, or the commit's own
    // refusal of an unresolved tender, ends it — dropping it silently is exactly
    // the "present a card payment nobody confirmed as a cash sale" failure this
    // whole path exists to prevent.
    if (!selected && _cardTenderLocked) return;
    // The manual terminal is the same wire type as this one, so selecting the
    // card tile retires it rather than adding a leg.
    final replacing = terminalEnabled || bankEnabled;
    if (selected &&
        _splitMode &&
        _tenderLegCount - (replacing ? 1 : 0) >= _maxTenderLines) {
      return;
    }
    setState(() {
      cardEnabled = selected;
      if (selected) {
        terminalEnabled = false;
        bankEnabled = false;
        bankConfirmed = false;
        terminalStatus = 'cancelled_before_confirmation';
        if (!_splitMode) cashEnabled = false;
      }
      if (!selected) {
        // Deselecting before anything was captured is an operator undoing their
        // own choice; a capture that already exists is a different story and
        // `_setCard` is not reachable for it (the tile stays selected until the
        // sale is decided).
        cardStatus = 'not_started';
        cardMessage = null;
      }
      method = _selectedPaymentMethod;
      dirty = true;
      _balanceTenderFields(totals);
    });
  }

  /// A card tender a provider may already have charged, in any state but
  /// `not_started`.
  bool get _cardTenderLocked => cardStatus != 'not_started';

  /// Arm or disarm a divided payment.
  ///
  /// Arming is the ONLY way a second method ever joins a sale: the tiles
  /// replace each other by default. Disarming puts the sale back to one method
  /// so the on-screen legs always match the mode the operator chose.
  void _toggleSplit(bool armed, TotalsPreview totals) {
    // A card the terminal may already have charged owns the sale; the split
    // cannot be closed over an attempt that is still unresolved.
    if (!armed && _cardTenderLocked) return;
    if (armed) {
      setState(() {
        splitArmed = true;
        _splitEditedLeg = null;
        dirty = true;
        _balanceTenderFields(totals);
      });
      return;
    }
    setState(() {
      splitArmed = false;
      _splitEditedLeg = null;
      // Exactly one method survives, in the order the operator would keep them:
      // the cash in the drawer, else the card the terminal holds, else the
      // manual one.
      if (cashEnabled) {
        terminalEnabled = false;
        cardEnabled = false;
        bankEnabled = false;
      } else if (cardEnabled) {
        terminalEnabled = false;
        bankEnabled = false;
      } else if (bankEnabled) {
        terminalEnabled = false;
      }
      method = _selectedPaymentMethod;
      dirty = true;
      _balanceTenderFields(totals);
    });
  }

  /// What the tenders have to cover, in minor units: the amount due the server will ask for.
  ///
  /// THE SERVER ADDS THE TIP TO THE AMOUNT DUE — `checkout-calculator.ts`:
  /// `amountDue = discountedSubtotal + tipAmount` — and then checks that the tenders cover it. The
  /// applied legs were balanced against the BILL alone, so a tip the cashier had just chosen left
  /// the sheet reading `Falta por cobrar MXN 32.60`, with nothing on the sheet able to raise the
  /// applied amount and a charge the server refused as a remaining balance. Measured on the iMin
  /// D3-504 on 2026-10-11: a 10 % tip on MXN 326.00, and the 358.60 could never be collected.
  ///
  /// Once a review has come back, the server's own `grandTotal` IS the amount due, so it is used as
  /// it is; before the first review it is computed here with the same arithmetic the calculator
  /// uses, so the tender the cashier sees already covers the tip they just chose.
  int _dueMinorUnits(TotalsPreview totals) {
    final confirmed = widget.checkout.state.result?.confirmation['totals'];
    final confirmedGrand = confirmed is Map<String, Object?>
        ? confirmed['grandTotal'] as Map<String, Object?>?
        : null;
    final confirmedMinor = confirmedGrand?['minorUnits'] as num?;
    if (confirmedMinor != null) return confirmedMinor.toInt();
    final bill = (totals.grandTotal['minorUnits']! as num).toInt();
    final discounted = bill - _discountMinorUnits(bill);
    return discounted + _tipMinorUnits(discounted);
  }

  /// The order-level discount this sheet is about to send, in minor units — the calculator's own
  /// rounding (`round(base * basisPoints / 10 000)`), so the tip is computed on the base the server
  /// will use for it. A discount without a reason is not sent, so it does not count here either.
  int _discountMinorUnits(int billMinorUnits) {
    final raw = _minorUnits(discountPercent.text);
    if (raw <= 0 || discountReason.text.trim().isEmpty) return 0;
    if (discountType == 'order_fixed') return raw;
    if (discountType != 'order_percentage') return 0;
    return ((billMinorUnits * raw) / 10000).round();
  }

  /// The tip this sheet is about to send, in minor units, on the discounted subtotal — the same
  /// arithmetic the calculator applies to `tipDraft`.
  int _tipMinorUnits(int discountedSubtotalMinorUnits) => switch (tipKind) {
    'percentage' when tipBasisPoints > 0 =>
      ((discountedSubtotalMinorUnits * tipBasisPoints) / 10000).round(),
    'fixed' => _minorUnits(customTipFixed.text),
    _ => 0,
  };

  /// Re-seed the tenders after something that changes what the server will ask for — a tip or a
  /// discount. The split the cashier typed is theirs; it was simply balanced against a different
  /// amount due, and leaving it there is what `Falta por cobrar` means.
  void _rebalanceForDraftChange() {
    final totals = shownTotals;
    if (totals == null) return;
    _balanceTenderFields(totals);
  }

  void _editSplitAmount(String leg) {
    setState(() {
      dirty = true;
      tenderEdited = true;
      if (terminalEnabled) _confirmedManualTerminalMinorUnits = null;
      if (_splitMode && _tenderLegCount >= 2) {
        _splitEditedLeg = leg;
        _rebalanceForDraftChange();
      }
    });
  }

  void _balanceTenderFields(TotalsPreview totals) {
    final total = _dueMinorUnits(totals);
    final cardLeg = cardEnabled;
    final bankLeg = bankEnabled;
    // WHAT THE CUSTOMER HANDED OVER IS NOT OURS TO REWRITE.
    //
    // This runs on every draft change — a tip, a discount — and it used to overwrite the
    // cash-received field with the new total. A customer who puts 500 on a 100 bill and
    // then gets a 20 % tip added has handed over 500 for 120: the change is 380, and the
    // till was rewriting the 500 to 120.00 so the change read zero and the money on the
    // counter disappeared from the screen (owner, 2026-10-13). The field is seeded on the
    // first balance and left alone once the operator has said otherwise — `tenderEdited`
    // is the operator's own statement about what is on the counter.
    if (cashEnabled && (terminalEnabled || cardLeg || bankLeg)) {
      final other = cardLeg
          ? cardAmount
          : bankLeg
          ? bankAmount
          : terminalAmount;
      final cash = switch (_splitEditedLeg) {
        'cash' => _minorUnits(cashApplied.text),
        'card' ||
        'terminal' ||
        'bank' => (total - _minorUnits(other.text)).clamp(0, total),
        _ => total ~/ 2,
      };
      cashApplied.text = (cash / 100).toStringAsFixed(2);
      if (!cashReceivedEdited) cashReceived.text = cashApplied.text;
      final remaining = (total - cash).clamp(0, total);
      if (bankLeg) {
        bankAmount.text = (remaining / 100).toStringAsFixed(2);
      } else if (cardLeg) {
        cardAmount.text = (remaining / 100).toStringAsFixed(2);
      } else {
        terminalAmount.text = (remaining / 100).toStringAsFixed(2);
      }
    } else if (cashEnabled) {
      _splitEditedLeg = null;
      cashApplied.text = (total / 100).toStringAsFixed(2);
      if (!cashReceivedEdited) cashReceived.text = cashApplied.text;
      terminalAmount.clear();
      cardAmount.clear();
      bankAmount.clear();
    } else if (cardLeg) {
      _splitEditedLeg = null;
      cardAmount.text = (total / 100).toStringAsFixed(2);
      terminalAmount.clear();
      bankAmount.clear();
      cashApplied.clear();
      cashReceived.clear();
    } else if (bankLeg) {
      _splitEditedLeg = null;
      bankAmount.text = (total / 100).toStringAsFixed(2);
      terminalAmount.clear();
      cardAmount.clear();
      cashApplied.clear();
      cashReceived.clear();
    } else {
      _splitEditedLeg = null;
      terminalAmount.text = (total / 100).toStringAsFixed(2);
      cardAmount.clear();
      bankAmount.clear();
      cashApplied.clear();
      cashReceived.clear();
    }
    bankConfirmed = false;
  }

  void _setCashReceived(int minorUnits) => setState(() {
    cashReceived.text = (minorUnits / 100).toStringAsFixed(2);
    dirty = true;
    tenderEdited = true;
    cashReceivedEdited = true;
  });

  /// The on-screen keypad, and the ONLY writer of either number: a POS often has no
  /// keyboard, so digits, one decimal point (capped at two places) and a backspace go
  /// straight into whichever field the operator tapped — the cash received, or the
  /// custom tip percentage. The fields themselves are read-only displays; tapping one is
  /// what tells the keypad which number it is on.
  void _pushDigit(String key) {
    final tipPercentTarget = _padTarget == 'tip_percent';
    final tipFixedTarget = _padTarget == 'tip_fixed';
    final tipTarget = tipPercentTarget || tipFixedTarget;
    final controller = tipPercentTarget
        ? customTipPercent
        : tipFixedTarget
        ? customTipFixed
        : cashReceived;
    var text = controller.text;
    // A SEEDED FIGURE IS REPLACED, NOT ADDED TO. The cash field starts on the bill's own
    // amount (and the quick-cash buttons seed it again), so an operator who taps the field
    // and types what the customer handed over means "this instead of that": 55.00500 was
    // the bug when the first digit appended to the total.
    final wholeSelection =
        controller.selection.isValid &&
        controller.selection.baseOffset == 0 &&
        controller.selection.extentOffset == text.length &&
        text.isNotEmpty;
    if (key == 'back') {
      if (text.isEmpty) return;
      text = text.substring(0, text.length - 1);
    } else if (key == '.') {
      if (text.contains('.')) return;
      text = text.isEmpty || wholeSelection ? '0.' : '$text.';
    } else {
      if (wholeSelection) text = '';
      final dot = text.indexOf('.');
      if (dot >= 0 && text.length - dot > 2) return;
      text = text == '0' ? key : '$text$key';
    }
    setState(() {
      controller.text = text;
      controller.selection = TextSelection.collapsed(offset: text.length);
      dirty = true;
      if (tipPercentTarget) {
        tipKind = 'percentage';
        tipBasisPoints = _minorUnits(text);
        customTipFixed.clear();
      } else if (tipFixedTarget) {
        tipKind = 'fixed';
        tipBasisPoints = 0;
        customTipPercent.clear();
      } else {
        tenderEdited = true;
        cashReceivedEdited = true;
      }
    });
    if (tipTarget) _rebalanceForDraftChange();
  }

  void _terminalOutcome(String value) => setState(() {
    terminalStatus = value;
    dirty = true;
  });

  void _clearTip() {
    setState(() {
      _padTarget = 'cash';
      tipKind = 'none';
      tipBasisPoints = 0;
      customTipPercent.clear();
      customTipFixed.clear();
      dirty = true;
    });
    _rebalanceForDraftChange();
  }

  void _setTipPercentage(int value) {
    setState(() {
      _padTarget = 'cash';
      tipKind = 'percentage';
      tipBasisPoints = value;
      customTipPercent.text = (value / 100).toStringAsFixed(2);
      customTipFixed.clear();
      dirty = true;
    });
    _rebalanceForDraftChange();
  }

  // The two handlers that used to sit here read the SYSTEM KEYBOARD's own field. Both
  // fields are read-only displays now and the keypad is the only writer, so the
  // percentage path lives in `_pushDigit` — one place that decides what a typed
  // percentage means. A fixed-amount tip (a policy this café does not enable) would need
  // its own target here when it is turned on.

  void _setDiscountType(String value) {
    setState(() {
      discountType = value;
      discountPercent.clear();
      dirty = true;
    });
    _rebalanceForDraftChange();
  }

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
    if (cardEnabled) {
      result.add({
        // Its OWN identity, derived from the cart like the manual one's, so the
        // two can never collide on `pos_tender_fact.id` — and so a retry of this
        // sale, or a till that restarted mid-charge, asks for the SAME attempt.
        'id': _stableId('card_terminal'),
        // `manual_terminal` is the only TenderType that maps to
        // `external_terminal`. The PROOF is not decided by the type: it comes
        // from the attempt the commit links (`proof_source = provider`).
        'type': 'manual_terminal',
        'amount': {
          'minorUnits': _minorUnits(cardAmount.text),
          'currency': currency,
        },
        'amountReceived': null,
        // `awaiting_terminal` is the till's own word for "the terminal has not
        // answered"; on the wire it is the unresolved state, so a commit that
        // somehow gets here is REFUSED rather than read as a purchase.
        'status': cardStatus == 'awaiting_terminal'
            ? 'outcome_unknown'
            : cardStatus,
        'correlationId': 'card-terminal-${widget.cart.state.cart!.id}',
      });
    }
    if (bankEnabled) {
      result.add({
        'id': _stableId('bank_transfer'),
        'type': 'bank_transfer',
        'amount': {
          'minorUnits': _minorUnits(bankAmount.text),
          'currency': currency,
        },
        'amountReceived': null,
        'status': bankConfirmed ? 'confirmed_success' : 'not_started',
        'correlationId': null,
      });
    }
    result.addAll(storedValueTenders);
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

  String _stableId(String kind) => tenderId(widget.cart.state.cart!.id, kind);

  Future<void> _review(TotalsPreview totals) async {
    if (_chargeInFlight) return;
    setState(() => _chargeInFlight = true);
    try {
      final shownDue = _dueMinorUnits(totals);
      // Nothing is left to type once the operator commits, so the field lets go of the focus here.
      //
      // THIS DOES NOT DISMISS THE KEYBOARD ON THE iMin, and the comment says so rather than pretending
      // otherwise: measured on 2026-10-11, `dumpsys input_method` still reports `mInputShown=true`
      // three to ten seconds after `Pagado`, Gboard's log shows the numeric IME being attached
      // (`inputType=8001`) at the moment of the charge, and no editable is focused in the semantics
      // tree. `unfocus` here, `unfocus` plus `TextInput.hide` on the result screen, and
      // `TextInput.hide` here as well were each measured — none of them closed it, and `BACK` does.
      // The defect and the evidence are in `docs/reports/2026-10-11-imin-keyboard-stays-open.md`; the
      // next step is to trace the text-input channel during a charge rather than guess again.
      FocusManager.instance.primaryFocus?.unfocus();
      unawaited(SystemChannels.textInput.invokeMethod<void>('TextInput.hide'));
      // A card tender is charged on a real terminal BEFORE the checkout runs, and
      // the checkout waits for the terminal's answer. Every other path (cash, the
      // manual terminal, an already-answered card) falls through to the ordinary
      // review below.
      if (cardEnabled && cardStatus == 'not_started') {
        await _chargeCardTerminal(totals);
        if (!mounted) return;
        return;
      }
      if (terminalEnabled &&
          (terminalStatus != 'confirmed_success' ||
              _confirmedManualTerminalMinorUnits !=
                  _minorUnits(terminalAmount.text)) &&
          !await _confirmManualTerminalCharge()) {
        return;
      }
      if (bankEnabled && !await _confirmBankReceived()) return;
      dirty = false;
      widget.sales.checkoutStarted();
      await _sendReview(totals);
      if (!mounted) return;
      // One-tap checkout: the cashier saw and verified this total before tapping
      // Cobrar. The preview is a server recompute for integrity — if it matches
      // what they saw, commit now in the same action. If UMI recomputed a
      // DIFFERENT total, fall through to the confirmation screen so the cashier
      // sees the new number (an inaccurate charge is the costly error to prevent).
      final reviewed = widget.checkout.state;
      if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
        final repricedProbe =
            reviewed.result?.confirmation['totals'] as Map<String, Object?>?;
        final newTotalProbe = repricedProbe == null
            ? null
            : (TotalsPreview.fromJson(repricedProbe).grandTotal['minorUnits']
                      as num?)
                  ?.toInt();
        debugPrint(
          '[umipos] checkout review phase=${reviewed.phase.name} '
          'dirty=$dirty newTotal=$newTotalProbe shownDue=$shownDue',
        );
      }
      if (reviewed.phase == CheckoutPhase.confirmationRequired) {
        final repriced =
            reviewed.result?.confirmation['totals'] as Map<String, Object?>?;
        final newTotal = repriced == null
            ? null
            : (TotalsPreview.fromJson(repriced).grandTotal['minorUnits']
                      as num?)
                  ?.toInt();
        if (newTotal != null && newTotal == shownDue) {
          await _makeValuePairWhole(totals);
          if (!mounted) return;
          await widget.checkout.confirm();
        }
      }
    } finally {
      if (mounted) setState(() => _chargeInFlight = false);
    }
  }

  /// Post the review for [totals] with what the sheet holds right now.
  ///
  /// Extracted because a charge with a customer's value reviews TWICE: once with no value, which is
  /// the basis the preview is asked against, and once carrying the selection, which is the
  /// confirmation the commit has to name. Both reviews must be identical apart from the value, so
  /// they come from one place.
  Future<void> _sendReview(TotalsPreview totals) async {
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
            merchantId: tenant.id,
            locationId: cart.locationId,
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
    await widget.checkout.preview(
      merchantId: cart.merchantId,
      locationId: cart.locationId,
      operatorSessionId: cart.operatorSessionId,
      cartId: cart.id,
      cartVersion: cart.version,
      paymentMethod: method,
      cart: cart,
      authority: offlineAuthority,
      locationName: entry.selectedBranch?.name ?? '',
      operatorName: operator?.staffId ?? cart.operatorSessionId,
      cashShiftId: widget.cashShiftId,
      cashReceivedMinorUnits: cashEnabled
          ? _minorUnits(cashReceived.text)
          : null,
      tenderDrafts: _tenders(currency),
      tipDraft: _tipDraft(currency),
      discountDrafts: _discountDrafts(currency),
      receiptDelivery: {
        'destination': 'display',
        'channel': null,
        'customerContactId': null,
      },
    );
  }

  /// Charge the card on the terminal this location offers, then LEARN the answer.
  ///
  /// The capture answers in about a second, with `unknown` while the customer is
  /// still at the terminal — a customer takes up to forty seconds, and no screen
  /// may hold the till for that. So the waiting starts here, and the operator
  /// stays free.
  ///
  /// Nothing the terminal did not say is ever presented. A capture that could not
  /// be sent leaves the sale on cash with the refusal named; a success marks the
  /// tender and waits for the operator's own Cobrar; a refusal deselects it.
  Future<void> _chargeCardTerminal(TotalsPreview totals) async {
    final providerId = widget.checkout.cardTerminalProviderId;
    if (providerId == null) return;
    final l = AppLocalizations.of(context);
    final currency = totals.grandTotal['currency']! as String;
    // The tender's identity IS the command identity: derived from the cart, so a
    // second press — or a till that restarted mid-sale — presents the same
    // tender to the same attempt instead of asking for a second charge.
    final identity = _stableId('card_terminal');
    final amount = {
      'minorUnits': _minorUnits(cardAmount.text),
      'currency': currency,
    };
    // The wake-up comes up with the charge, so the socket is already listening
    // when the customer reaches the terminal. It changes nothing about the
    // capture: the answer is the same whether or not it ever connects.
    _listenForCardNudge();
    setState(() {
      cardCaptureInFlight = true;
      cardWaiting = false;
      cardStatus = 'awaiting_terminal';
      cardCommandIdentity = identity;
      cardProviderStatus = null;
      cardMessage = null;
      dirty = false;
    });
    final TenderCaptureResult capture;
    try {
      capture = await widget.checkout.captureCardTender(
        scope: _tenderScope,
        tenderId: identity,
        commandIdentity: identity,
        provider: providerId,
        amount: amount,
      );
    } on AppException catch (error) {
      if (!mounted) return;
      setState(() {
        cardCaptureInFlight = false;
        cardEnabled = false;
        cardStatus = 'not_started';
        cashEnabled = true;
        method = 'cash';
        _balanceTenderFields(totals);
        cardMessage = _recoveryMessage(l, error.code);
      });
      return;
    }
    if (!mounted) return;
    final kind = capture.outcome['kind'] as String?;
    final code = capture.outcome['code'] as String?;
    final providerStatus = capture.outcome['providerStatus'] as String?;
    // The attempt the terminal is holding, so a later nudge can name it.
    cardAttemptId = capture.attempt['id'] as String?;
    setState(() {
      cardCaptureInFlight = false;
      cardProviderStatus = providerStatus;
    });
    switch (kind) {
      case 'succeeded':
        _approveCardTender(l);
      case 'declined':
        _declineCardTender(l, code ?? providerStatus);
      default:
        // Still unknown: the customer has not finished. Follow the attempt by
        // the identity the capture used, at the terminal's own query window.
        cardPollDelay = widget.cardTerminalPollStart;
        final now = widget.now();
        setState(
          () => cardWaitDeadline = now.add(widget.cardTerminalWaitBound),
        );
        _scheduleCardPoll(_cardDelayFromQueryAfter(capture.attempt));
    }
  }

  /// The terminal said it took the money.
  ///
  /// Nothing is committed here. The tender becomes `confirmed_success` and the
  /// operator's ordinary Cobrar is what commits the sale; the commit LINKS the
  /// attempt this capture created and keeps the provider's own payment id as the
  /// proof. That is why a card tender must never go through `settleTender`: the
  /// proof is the provider's, not a person's.
  void _approveCardTender(AppLocalizations l) {
    cardPollTimer?.cancel();
    cardPollTimer = null;
    if (!mounted) return;
    setState(() {
      cardWaiting = false;
      cardStatus = 'confirmed_success';
      cardMessage = l.terminalApprovedMessage;
    });
  }

  /// The terminal refused, or the order it was holding was cancelled or expired:
  /// no money moved. The sale stays open on cash and the operator reads the
  /// terminal's own code and words. A declined card is NEVER a purchase.
  void _declineCardTender(AppLocalizations l, String? code) {
    cardPollTimer?.cancel();
    cardPollTimer = null;
    if (!mounted) return;
    final totals = shownTotals;
    setState(() {
      cardWaiting = false;
      cardEnabled = false;
      cardStatus = 'not_started';
      cashEnabled = true;
      method = 'cash';
      if (totals != null) _balanceTenderFields(totals);
      cardMessage = l.terminalDeclinedMessage(code ?? l.terminalStatusFailed);
    });
  }

  /// The next delay: the terminal's own `queryAfter` when it carries one, and a
  /// bounded backoff (1s → 2s → 4s → 5s cap) when it does not.
  ///
  /// Polling IS the delivery path today. The realtime nudge resolves the attempt
  /// in the merchant's DASHBOARD room and the native till has no device socket,
  /// so its own read is how it learns the terminal answered (plan §10.4 item 2).
  /// `refresh: true` makes the server ask the terminal — one vendor call — so
  /// this is asked on a schedule and never in a loop.
  Duration _cardDelayFromQueryAfter(Map<String, Object?>? attempt) {
    final raw = attempt?['queryAfter'] as String?;
    if (raw == null) return cardPollDelay;
    final at = DateTime.tryParse(raw)?.toUtc();
    if (at == null) return cardPollDelay;
    final delta = at.difference(widget.now().toUtc());
    // Never hammer the vendor: the terminal's window is the floor, not a
    // licence to ask early.
    return delta < widget.cardTerminalPollStart
        ? widget.cardTerminalPollStart
        : delta;
  }

  /// The scope every card-tender call is made in: the cart the sheet is paying,
  /// which is the only place the tender routes' identities come from.
  TenderScope get _tenderScope {
    final cart = widget.cart.state.cart!;
    return TenderScope(
      merchantId: cart.merchantId,
      locationId: cart.locationId,
      operatorSessionId: cart.operatorSessionId,
      cartId: cart.id,
    );
  }

  /// Double the backoff, capped. The vendor documents no rate limit, so this
  /// ceiling is our own protection.
  Duration _nextCardDelay() {
    final next = cardPollDelay * 2;
    return next > widget.cardTerminalPollCap
        ? widget.cardTerminalPollCap
        : next;
  }

  /// Bring the device channel up for this sheet's wait, once.
  ///
  /// Subscribed where a card charge starts rather than in `initState`: a sheet
  /// that never touches the terminal opens no socket, and the wait is exactly the
  /// window a nudge is for. `dispose` cancels it, and cancelling the last listener
  /// is what takes the socket down.
  void _listenForCardNudge() {
    final channel = widget.deviceChannel;
    if (channel == null || cardNudgeSubscription != null) return;
    cardNudgeSubscription = channel.watch().listen(_cardNudgeArrived);
  }

  /// The API says the attempt moved. Re-read it NOW rather than at [queryAfter].
  ///
  /// Nothing here is trusted and nothing here is presented: the nudge carries ids
  /// only, and what follows is the read the poll would have made — the same
  /// identity, the same `refresh`, the same answer. A nudge for another sale, or
  /// one that arrives when no wait is live, changes nothing at all.
  void _cardNudgeArrived(TenderAttemptNudge nudge) {
    if (!mounted || !cardEnabled || !cardWaiting) return;
    final identity = cardCommandIdentity;
    if (identity == null) return;
    if (!nudge.matches(identity: identity, attemptId: cardAttemptId)) return;
    // THE POLL IS THE GUARANTEE AND THIS IS ONLY ITS SCHEDULE. A pending poll is
    // replaced by this read, so a nudge can never become a second question; and a
    // read already in flight — which is the one case with no timer pending — is
    // left to answer, because its answer is the newer one.
    final pending = cardPollTimer;
    if (pending == null) return;
    pending.cancel();
    cardPollTimer = null;
    unawaited(
      _pollCardAttempt().whenComplete(() {
        // A wait must never be left without its poll because of this channel: if
        // the read ended without arming one — it failed before it could — the
        // schedule comes back, and the sale is where it would have been.
        if (mounted && cardWaiting && cardPollTimer == null) {
          _scheduleCardPoll(cardPollDelay);
        }
      }),
    );
  }

  void _scheduleCardPoll(Duration delay) {
    cardPollTimer?.cancel();
    final deadline = cardWaitDeadline;
    if (deadline == null) return;
    final remaining = deadline.difference(widget.now());
    // Never sleep past the bound: the wait ends on time, and reaching the bound
    // is the UNRESOLVED case, not a silent failure.
    final effective = remaining < delay ? remaining : delay;
    if (effective <= Duration.zero) {
      _resolveCardUnresolved();
      return;
    }
    if (!cardWaiting) setState(() => cardWaiting = true);
    cardPollTimer = Timer(effective, _pollCardAttempt);
  }

  Future<void> _pollCardAttempt() async {
    final identity = cardCommandIdentity;
    if (!mounted || !cardEnabled || identity == null) return;
    final deadline = cardWaitDeadline;
    if (deadline != null && !widget.now().isBefore(deadline)) {
      _resolveCardUnresolved();
      return;
    }
    final TenderAttemptResult result;
    try {
      result = await widget.checkout.tenderAttempt(
        _tenderScope,
        identity,
        refresh: true,
      );
    } on AppException catch (_) {
      // A poll that failed is not an answer. Keep asking until the bound, which
      // is exactly the unresolved case — never a silent drop.
      if (!mounted) return;
      cardPollDelay = _nextCardDelay();
      _scheduleCardPoll(cardPollDelay);
      return;
    }
    if (!mounted || !cardEnabled) return;
    final attempt = result.attempt;
    final state = attempt['state'] as String?;
    final providerStatus = attempt['providerStatus'] as String?;
    // Nothing renders this, and nothing has to be rebuilt for it: it is the
    // backstop identity a later nudge may name.
    cardAttemptId = attempt['id'] as String? ?? cardAttemptId;
    if (providerStatus != null) {
      setState(() => cardProviderStatus = providerStatus);
    }
    switch (state) {
      case 'succeeded':
        _approveCardTender(AppLocalizations.of(context));
      case 'declined':
      case 'cancelled':
        _declineCardTender(
          AppLocalizations.of(context),
          result.outcome?['code'] as String? ?? providerStatus,
        );
      default:
        final outcomeKind = result.outcome?['kind'] as String?;
        if (outcomeKind == 'succeeded') {
          _approveCardTender(AppLocalizations.of(context));
          return;
        }
        if (outcomeKind == 'declined') {
          _declineCardTender(
            AppLocalizations.of(context),
            result.outcome?['code'] as String? ?? providerStatus,
          );
          return;
        }
        // Still working, or a state this version does not know: keep asking.
        cardPollDelay = _nextCardDelay();
        _scheduleCardPoll(_cardDelayFromQueryAfter(attempt));
    }
  }

  /// The wait ran out.
  ///
  /// This is the UNRESOLVED case and it is NOT a silent failure. The attempt may
  /// still be a real charge, so the tender stays SELECTED with
  /// `outcome_unknown`: the commit then refuses the whole sale with its own
  /// named code (`PAYMENT_UNKNOWN`) instead of closing it, and this screen says
  /// in words that there is a card payment nobody has confirmed.
  void _resolveCardUnresolved() {
    cardPollTimer?.cancel();
    cardPollTimer = null;
    if (!mounted) return;
    final l = AppLocalizations.of(context);
    setState(() {
      cardWaiting = false;
      cardStatus = 'outcome_unknown';
      cardMessage = l.terminalUnresolvedMessage;
    });
  }

  /// "Dejar de esperar" stops the POLLING, and nothing else.
  ///
  /// It is NOT a cancellation: our API has no vendor-cancel route (that is
  /// Phase 4), so the attempt stays recorded and queryable and the terminal may
  /// still hold the order. Because that is true, the tender stays SELECTED with
  /// `outcome_unknown` — the commit refuses the sale by its own named code
  /// rather than closing it over money nobody confirmed — and nothing is settled
  /// here, because a settlement would be inventing the answer.
  void _stopWaitingForCardTerminal() {
    cardPollTimer?.cancel();
    cardPollTimer = null;
    if (!mounted) return;
    final l = AppLocalizations.of(context);
    setState(() {
      cardWaiting = false;
      cardStatus = 'outcome_unknown';
      cardMessage = l.terminalStoppedWaitingMessage;
    });
  }

  Future<void> _requestApproval(BuildContext context) async {
    final l = AppLocalizations.of(context);
    final pin = TextEditingController();
    final fingerprint =
        widget.checkout.state.result?.confirmation['fingerprint'] as String?;
    if (fingerprint == null) return;
    final approved = await showPosDialog<bool>(
      context: context,
      builder: (context) => PosAlertDialog(
        title: Text(l.managerApprovalTitle),
        content: PosField(
          controller: pin,
          obscureText: true,
          keyboardType: TextInputType.number,
          autofocus: true,
          decoration: PosFieldDecoration(labelText: l.managerPinLabel),
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l.closeAction),
          ),
          PosButton(
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
        await showPosDialog<void>(
          context: context,
          builder: (dialogContext) => PosAlertDialog(
            title: Text(l.managerApprovalTitle),
            content: Text(l.managerApprovalDeniedMessage),
            actions: [
              PosTextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: Text(l.closeAction),
              ),
            ],
          ),
        );
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
    await _releaseCustomerValue();
    final cancelled = await widget.checkout.cancel();
    if (!context.mounted) return;
    if (cancelled) {
      Navigator.pop(context);
      return;
    }
    // The checkout refused to be cancelled, and it is RIGHT to: the draft holds a
    // terminal payment somebody said went through, and erasing it would erase the
    // claim. But that is a reason to keep the RECORD, not a reason to keep the
    // operator. This used to do nothing at all — the sheet stayed open, `Cerrar`
    // looked broken, and there is no "Nueva venta" on this screen, so the only way
    // out of a refused card sale was to kill the app. Starting a new sale abandons
    // the CART and leaves the claim exactly where it is, for whoever reconciles it.
    await widget.sales.newSale();
    if (context.mounted) Navigator.pop(context);
  }

  Future<void> _releaseCustomerValue() async {
    final controller = widget.customerValue;
    final cart = widget.cart.state.cart;
    final operator = widget.entry.state.operator;
    if (controller == null || cart == null || operator == null) return;
    final scope = CustomerValueScope(
      merchantId: cart.merchantId,
      locationId: cart.locationId,
      operatorSessionId: operator.id,
    );
    final reward = controller.state.rewardAuthorization;
    if (reward != null) {
      await controller.releaseAuthorization(
        scope,
        authorizationId: reward.id,
        accountType: 'loyalty_reward',
        fingerprint: reward.fingerprint,
      );
    }
    for (final authorization in List<StoredValueAuthorization>.from(
      controller.state.storedValueAuthorizations,
    )) {
      await controller.releaseAuthorization(
        scope,
        authorizationId: authorization.id,
        accountType: authorization.accountType,
        fingerprint: authorization.fingerprint,
      );
    }
    widget.checkout.applyCustomerValue(null);
    storedValueTenders = const [];
  }

  String _recoveryMessage(AppLocalizations l, String code) => switch (code) {
    'insufficient_cash' => l.insufficientCashMessage,
    // The tender the server refused, at the moment it refused it. The checkout
    // reports this as `invalid_amount`, which had no message, so every refusal
    // of this kind fell through to "the charge could not be completed safely" -
    // true, useless, and the reason a dead end looked like a server fault.
    'invalid_amount' => l.invalidTenderMessage,
    'totals_changed' => l.totalsConfirmedBody,
    'remaining_balance' => l.remainingBalanceMessage,
    'approval_required' => l.approvalRequiredMessage,
    'terminal_outcome_unknown' => l.paymentUnknownBody,
    'terminal_reported_failure' => l.terminalFailureMessage,
    // The terminal's own answer, read back to the operator on the tender screen
    // the sale returns to. A decline is not a failure of ours and not a sale:
    // nothing was taken, so the sentence has to say so before it offers cash.
    'terminal_declined' => l.terminalDeclinedNoChargeMessage,
    'terminal_approved' => l.terminalApprovedCollectMessage,
    // The card tile charges BEFORE the checkout, so a refusal here is a tender
    // refusal and not a checkout failure: the sale is still open on this screen.
    'TENDER_PROVIDER_UNAVAILABLE' ||
    'TERMINAL_TENDER_UNAVAILABLE' => l.terminalUnavailableMessage,
    'TERMINAL_BUSY' => l.terminalBusyMessage,
    'tip_rejected' => l.tipRejectedMessage,
    'discount_rejected' => l.discountRejectedMessage,
    'OFFLINE_ADVANCED_TENDER_BLOCKED' => l.offlineAdvancedTenderBlockedMessage,
    _ => l.checkoutFailed,
  };

  Widget _provisional(
    BuildContext context,
    ProvisionalReceipt receipt, {
    String? officialSaleId,
  }) {
    final l = AppLocalizations.of(context);
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    final synced = officialSaleId != null;
    final snapshot = OfflineCheckoutSnapshot.fromJson(receipt.snapshot);
    final totals = TotalsConfirmation.fromJson(snapshot.totals);
    final preview = TotalsPreview.fromJson(totals.totals);
    final cart = Cart.fromJson(snapshot.cartSnapshot);
    return Semantics(
      liveRegion: true,
      label: synced
          ? (spanish ? 'Venta sincronizada' : 'Sale synchronised')
          : l.provisionalSalePendingTitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Centered, not stretched. A `PosIcon` is a `SizedBox.square` around
          // a painter that scales by the box's width and height separately, and
          // this Column stretches its children — so the 64 px cloud was being
          // laid out 1 800 px wide and painted 28:1 flat, which on the receipt
          // screen looked like a torn dark ribbon above the title.
          Center(
            child: PosIcon(
              synced ? PosGlyphs.cloudDoneOutlined : PosGlyphs.cloudOffOutlined,
              size: 64,
            ),
          ),
          Text(
            synced
                ? (spanish ? 'Venta sincronizada' : 'Sale synchronised')
                : l.provisionalSalePendingTitle,
            textAlign: TextAlign.center,
            style: PosTheme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: UmiSpacing.md),
          Text(
            synced
                ? (spanish
                      ? 'La venta ya es oficial. El folio de abajo identifica la venta en el servidor.'
                      : 'The sale is official. The reference below identifies it on the server.')
                : l.provisionalSalePendingBody,
            textAlign: TextAlign.center,
          ),
          PosSelectableText(
            officialSaleId ?? receipt.provisionalSaleId,
            textAlign: TextAlign.center,
          ),
          Text(receipt.locationName, textAlign: TextAlign.center),
          Text(receipt.operatorName, textAlign: TextAlign.center),
          const PosDivider(),
          Expanded(
            child: ListView(
              children: [
                for (final raw in cart.items)
                  Builder(
                    builder: (context) {
                      final line = CartItem.fromJson(raw);
                      return PosListRow(
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
          PosButton(
            onPressed: () => Navigator.pop(context),
            child: Text(l.returnToCatalogAction),
          ),
        ],
      ),
    );
  }

  Future<void> _confirm(TotalsPreview totals) async {
    if (_chargeInFlight) return;
    setState(() => _chargeInFlight = true);
    try {
      if (terminalEnabled &&
          (terminalStatus != 'confirmed_success' ||
              _confirmedManualTerminalMinorUnits !=
                  _minorUnits(terminalAmount.text))) {
        if (!await _confirmManualTerminalCharge()) return;
        if (!mounted) return;
        await _sendReview(totals);
        if (!mounted) return;
      }
      if (bankEnabled && !bankConfirmed) {
        if (!await _confirmBankReceived()) return;
        if (!mounted) return;
        await _sendReview(totals);
        if (!mounted) return;
      }
      // The confirmationRequired screen already shows the recomputed totals and
      // the "Confirmar y cobrar" button, so a second modal asking the same thing
      // was pure friction — commit directly. A customer's value still owes its
      // half of the pair, so the charge goes through the same three steps the
      // one-tap path uses.
      await _makeValuePairWhole(totals);
      if (!mounted) return;
      await widget.checkout.confirm();
    } finally {
      if (mounted) setState(() => _chargeInFlight = false);
    }
  }

  /// Wait for the customer-value preview the commit has to carry, then push it to the checkout.
  ///
  /// THE CUSTOMER'S PREVIEW MUST LAND BEFORE THE COMMIT, NOT ALONGSIDE IT. What the database asserts
  /// is the loyalty earn preview for the cart and customer, looked up **by the fingerprint on the
  /// checkout command** (`merchant.assert_loyalty_earn_preview`,
  /// `38_pos_customer_value_closeout.sql`), so a command without it is refused with
  /// `LOYALTY_PREVIEW_STALE`. The panel's own load (`_loadCustomerValuePreview`) is fire-and-forget,
  /// and this sheet charges in one action — review, then confirm without an operator step in
  /// between — so the confirm used to leave **seven milliseconds** after the preview was asked for
  /// and before its answer: measured on the iMin on 2026-10-11 (preview `11:49:20.860`, confirm
  /// `.867`), with `"customerValue": null` in both bodies and the till answering "No fue posible
  /// completar el cobro de forma segura." twice while the panel on the same screen showed the points
  /// the sale had just earned. A customer-attached sale could not be paid at all.
  ///
  /// Both charging paths go through here: the one-tap charge at the end of `_review`, and the
  /// `Confirmar y cobrar` tap on the confirmation screen (`_confirm`).
  ///
  /// Nothing else moves here: the tenders, the payment method and the sheet's `dirty` flag belong to
  /// the operator's own actions.
  /// Returns whether a selection was pushed, so the caller knows a second review is owed.
  Future<bool> _applyCustomerValueForCommit() async {
    final pending = _requestCustomerValuePreview();
    if (pending != null) {
      try {
        await pending;
      } on Object {
        // A preview that could not be read is not a reason to hold the money: the
        // panel already named the refusal, and the command travels without the
        // preview so the server refuses it by name instead of the till going quiet.
      }
    }
    if (!mounted) return false;
    final controller = widget.customerValue;
    if (controller == null) return false;
    final selection = controller.selection();
    // Only ever PUSH a selection. A null one means this checkout has no preview to
    // pair the command with, and clearing what an earlier authorization left behind
    // belongs to the flow that released it, not here.
    if (selection == null) return false;
    widget.checkout.applyCustomerValue(selection);
    return true;
  }

  /// Put the customer's value pair together BEFORE the money moves: the preview, the
  /// confirmation the commit names, and both fingerprint halves.
  ///
  /// THE ORDER IS THE CONTRACT, and it is why a customer-attached sale used to be un-chargeable.
  /// The confirmation the commit has to quote is hashed over the command INCLUDING its
  /// `customerValue` (`checkout-calculator.ts`: source fingerprint, discounts, `customerValue`,
  /// reward, tip, tenders, receipt, policy, amountDue), while the database pairs the preview with
  /// the command's fingerprint computed WITHOUT any value and without wallet/gift-card tenders
  /// (`customerValueBasisFingerprint` → `merchant.assert_loyalty_earn_preview`). So the sheet has
  /// to do three things in this order:
  ///
  ///   1. the review that carries no value — its fingerprint is the basis the PREVIEW is asked
  ///      against, and the row that preview creates is the one the database asserts at commit;
  ///   2. the preview itself, AWAITED — the panel's own load is fire-and-forget, and the one-tap
  ///      charge used to commit seven milliseconds after asking for it, with `"customerValue": null`,
  ///      which the database refuses as `LOYALTY_PREVIEW_STALE`;
  ///   3. one more review, now carrying the selection — the fingerprint it publishes is the one the
  ///      commit must name, and its `storedValueFingerprint` is the other half the API insists on
  ///      (`storedValueSelectionInvalid` in `pos-checkout.service.ts`).
  ///
  /// Measured on the iMin D3-504, 2026-10-11: a commit sent straight after step 2 was answered
  /// `CHECKOUT_CART_CHANGED` on identical totals (`edf9273d…` at review, `26f3e80b…` at commit),
  /// because the value it carried was not in the confirmation it quoted.
  Future<void> _makeValuePairWhole(TotalsPreview totals) async {
    // THE BASIS FIRST, WHENEVER IT CAN STILL MOVE.
    //
    // The pair is keyed on the command WITHOUT its value, and taking the value out of a command that
    // already carries a reward or a stored-value authorization would drop the authorization itself —
    // so this runs for the plain loyalty-earn sale, which is what a café takes all day. It reviews
    // once with the value removed: that confirmation's fingerprint IS the basis, and the preview the
    // commit will name is asked against it. A tender or a tip corrected after the previous preview
    // (the customer hands over a different note, `Falta por cobrar` is topped up) changes that
    // fingerprint, and the row is replaced rather than left naming a command that no longer exists.
    //
    // A STORED VALUE OR A REWARD KEEPS THE OLD ORDER, and the walk that showed why is written up in
    // `2026-10-11-loyalty-preview-lifecycle.md`: the authorization is bound to the preview it was
    // asked against, so standing the value aside to re-key the earn row re-issued it — twice, over a
    // sale that still would not close. Their pair needs its own pass, not a rider on this one.
    final controller = widget.customerValue;
    if (controller != null &&
        widget.checkout.customerValueSelection != null &&
        controller.state.rewardAuthorization == null &&
        controller.state.storedValueAuthorizations.isEmpty) {
      widget.checkout.applyCustomerValue(null);
      await _sendReview(totals);
      if (!mounted) return;
    }
    final valued = await _applyCustomerValueForCommit();
    if (!mounted || !valued) return;
    await _sendReview(totals);
    if (!mounted) return;
    _adoptStoredValueFingerprint();
  }

  /// Carry the `storedValueFingerprint` the fresh confirmation published on the selection.
  ///
  /// The API refuses a commit that holds a `customerValue` whose `storedValueFingerprint` does not
  /// match the one it recomputes (`storedValueSelectionInvalid`), and the confirmation it hands back
  /// is where that half is published. Without it the checkout falls back to `collecting_payment`
  /// and the sale never closes.
  void _adoptStoredValueFingerprint() {
    final selection = widget.checkout.customerValueSelection;
    final stored =
        widget.checkout.state.result?.confirmation['storedValueFingerprint']
            as String?;
    if (selection == null || stored == null) return;
    widget.checkout.applyCustomerValue(
      CustomerValueSelection(
        previewFingerprint: selection.previewFingerprint,
        storedValueFingerprint: stored,
        rewardAuthorizationId: selection.rewardAuthorizationId,
        rewardApprovalId: selection.rewardApprovalId,
        storedValueAuthorizationIds: selection.storedValueAuthorizationIds,
        fundedGiftCards: selection.fundedGiftCards,
      ),
    );
  }

  /// THE UNKNOWN SCREEN, MADE SPECIFIC.
  ///
  /// This was a bare Column in the middle of a 1920-wide checkout: no
  /// `mainAxisSize`, no width bound, no padding. The icon floated, the sentence
  /// ran the width of the counter, and the two actions sat off to one side — a
  /// debug screen on the one path where an operator is most anxious, money that
  /// may or may not have moved. It also NAMED nothing: not the charge, not what
  /// the terminal had said, only a generic sentence and a correlation id.
  ///
  /// The panel below names the amount and the terminal's own last answer, and its
  /// first action asks the terminal instead of re-reading our own silence (see
  /// `queryUnknownPayment`).
  Widget _unknown(BuildContext context, CheckoutResult result) {
    final l = AppLocalizations.of(context);
    final theme = PosTheme.of(context);
    final failure = result.failure;
    final payment = result.payment;
    // The API nests the money (`amount: {minorUnits, currency}`) on a payment
    // attempt and the flat pair on the tender row's own copy; read whichever
    // arrived rather than guessing.
    final amount = payment?['amount'];
    final currency =
        (amount is Map<String, Object?>
            ? amount['currency'] as String?
            : null) ??
        payment?['currency'] as String?;
    final amountMinor =
        (amount is Map<String, Object?> ? (amount['minorUnits'] as num?) : null)
            ?.toInt() ??
        (payment?['amountMinorUnits'] as num?)?.toInt();
    final providerStatus = payment?['providerStatus'] as String?;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const PosIcon(PosGlyphs.helpOutline, size: 64),
            const SizedBox(height: UmiSpacing.sm),
            Text(
              l.paymentUnknownTitle,
              textAlign: TextAlign.center,
              style: theme.textTheme.headlineSmall,
            ),
            const SizedBox(height: UmiSpacing.sm),
            Text(l.paymentUnknownBody, textAlign: TextAlign.center),
            if (amountMinor != null && currency != null) ...[
              const SizedBox(height: UmiSpacing.md),
              Text(
                _money({'currency': currency, 'minorUnits': amountMinor}),
                textAlign: TextAlign.center,
                style: theme.textTheme.headlineMedium,
              ),
            ],
            if (providerStatus != null) ...[
              const SizedBox(height: UmiSpacing.xs),
              Text(
                '${l.terminalLastAnswerLabel}: $providerStatus',
                textAlign: TextAlign.center,
              ),
            ],
            if (failure != null) ...[
              const SizedBox(height: UmiSpacing.sm),
              PosSelectableText(
                '${l.correlationLabel}: ${failure['correlationId']}',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall,
              ),
            ],
            const SizedBox(height: UmiSpacing.lg),
            PosButton(
              onPressed: widget.checkout.queryUnknownPayment,
              child: Text(l.queryPaymentAction),
            ),
            PosTextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(l.closeAction),
            ),
          ],
        ),
      ),
    );
  }

  Widget _receipt(
    BuildContext context,
    CheckoutResult result,
    String? postCommitWarning,
  ) {
    // THE COMPLETION SCREEN ASKS FOR NOTHING TO BE TYPED, so it drops the focus and asks the
    // platform to put its keyboard away. Both calls are belt and braces: they do NOT close the
    // keyboard on the iMin (measured 2026-10-11 — see the note in `_review` and
    // `docs/reports/2026-10-11-imin-keyboard-stays-open.md`), and they are kept because the intent
    // is right and other platforms do honour them.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      FocusManager.instance.primaryFocus?.unfocus();
      unawaited(SystemChannels.textInput.invokeMethod<void>('TextInput.hide'));
    });
    final l = AppLocalizations.of(context);
    final es = Localizations.localeOf(context).languageCode == 'es';
    final receipt = ReceiptSnapshot.fromJson(result.receipt!);
    final summary = result.paymentSummary == null
        ? null
        : PaymentSummary.fromJson(result.paymentSummary!);
    final currency = receipt.grandTotal['currency'] as String? ?? '';
    final totalMinor = (receipt.grandTotal['minorUnits'] as num?)?.toInt() ?? 0;
    final changeMinor = summary == null
        ? 0
        : (summary.change['minorUnits'] as num?)?.toInt() ?? 0;
    final receivedMinor = totalMinor + changeMinor;
    Map<String, Object?> money(int minor) => {
      'currency': currency,
      'minorUnits': minor,
    };
    // PoloTab's completion screen: the change to hand back in huge blue, the amount
    // paid in huge white, a one-line receipt summary, and two actions.
    const brandBlue = Color(0xFF2E7DFF);
    final display = PosTheme.of(context).textTheme.displayLarge;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (postCommitWarning != null) ...[
          // The sale is recorded and the money is right; what failed is the
          // pulse that opens the drawer, which shares the printer's port. The
          // cashier is standing here, so this is where it is said — a log line
          // is a failure nobody at the till can act on (plan §8.2 F5).
          InlineNotice(
            message: l.cashDrawerUnansweredMessage,
            tone: InlineNoticeTone.warning,
          ),
          const SizedBox(height: UmiSpacing.md),
        ],
        const Spacer(),
        // CHANGE IS A FACT ONLY WHEN CASH WAS GIVEN. This screen led with
        // "Cambio a dar MXN 0.00" in the largest type on the till — for a card
        // sale, where nobody handed over anything and there is nothing to give
        // back. An operator glancing at it reads the headline and not the word
        // "Pagado" underneath. So the change block appears when there is change,
        // and a card sale leads with the amount the terminal took.
        if (changeMinor > 0) ...[
          Text(
            es ? 'Cambio a dar' : 'Change due',
            textAlign: TextAlign.center,
            style: PosTheme.of(context).textTheme.titleMedium?.copyWith(
              color: PosTheme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: UmiSpacing.xs),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              _money(money(changeMinor)),
              style: display?.copyWith(
                color: brandBlue,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(height: UmiSpacing.lg),
        ],
        Text(
          es ? 'Pagado' : 'Paid',
          textAlign: TextAlign.center,
          style: PosTheme.of(context).textTheme.titleMedium?.copyWith(
            color: PosTheme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: UmiSpacing.xs),
        FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            _money(receipt.grandTotal),
            style: display?.copyWith(fontWeight: FontWeight.w800),
          ),
        ),
        const SizedBox(height: UmiSpacing.md),
        Text(
          '${es ? 'Recibiste' : 'Received'}: ${_money(money(receivedMinor))}   ·   '
          '${es ? 'Consumo' : 'Total'}: ${_money(receipt.grandTotal)}',
          textAlign: TextAlign.center,
          style: PosTheme.of(context).textTheme.bodySmall?.copyWith(
            color: PosTheme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
        const Spacer(),
        Row(
          children: [
            Expanded(
              child: PosOutlineButton.icon(
                onPressed: () => _showReceiptDetail(
                  context,
                  receipt,
                  // The receipt's own id is what the server files the print job
                  // against, and it comes from the committed sale.
                  receiptId: result.sale?['receiptId'] as String?,
                  snapshot: result.receipt,
                ),
                icon: const PosIcon(PosGlyphs.receiptLongOutlined),
                label: Text(es ? 'Ver comprobante' : 'View receipt'),
              ),
            ),
            const SizedBox(width: UmiSpacing.md),
            Expanded(
              child: PosButton(
                style: PosButton.styleFrom(
                  minimumSize: const Size.fromHeight(56),
                ),
                onPressed: () async {
                  if (!committed) {
                    committed = true;
                    await widget.sales.checkoutCommitted();
                  }
                  widget.sales.finishCheckoutPresentation(force: true);
                  if (context.mounted) Navigator.pop(context);
                },
                child: Text(es ? 'Nuevo pedido' : 'New order'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _showReceiptDetail(
    BuildContext context,
    ReceiptSnapshot receipt, {
    String? receiptId,
    Map<String, Object?>? snapshot,
  }) {
    final permissions = OperatorPermissions(
      widget.entry.state.operator?.permissions ?? const [],
    );
    return showReceiptDocument(
      context,
      receipt,
      // THE CUSTOMER ASKING FOR THEIR TICKET, from the screen the operator is
      // already on. Same dialog and same request as Ventas, so there is one
      // behaviour to reason about; the paper says COPIA because the sale's own
      // print is the original.
      printAction: receiptPrintAction(
        canPrint: permissions.allows('hardware.printer.print'),
        receiptId: receiptId,
        snapshot: snapshot,
        onPrint: widget.onPrint,
      ),
    );
  }

  Widget _checkoutError(BuildContext context, String? code) {
    final l = AppLocalizations.of(context);
    final state = widget.checkout.state;
    final hold = state.holdState;
    var body = l.checkoutFailed;
    Widget action = PosButton.tonal(
      onPressed: widget.checkout.reset,
      child: Text(l.retryAction),
    );
    // A charge refused for a missing cash shift is not a server fault and a
    // retry re-sends the same null-shift payload. The refusal named the register
    // and its hold, so the surface can offer the one action that actually moves
    // the till forward: take our own shift back, free an orphaned drawer, or say
    // out loud that a manager has to count a live terminal's cash.
    if (code == 'CASH_SHIFT_REQUIRED') {
      body = l.cashShiftRequiredMessage;
      final recover = widget.onRecoverCashShift;
      if (recover != null &&
          (hold == 'held_by_this_device' || hold == 'held_by_orphaned_till')) {
        final resume = hold == 'held_by_this_device';
        action = PosButton(
          onPressed: cashRecoveryBusy
              ? null
              : () => _recoverCashShift(recover, hold),
          child: Text(
            resume
                ? l.resumeShiftAndRetryAction
                : l.reclaimRegisterAndRetryAction,
          ),
        );
      } else if (hold == 'held_by_active_till') {
        body = '${l.cashShiftRequiredMessage} ${l.cashHeldByActiveTillMessage}';
      } else if (widget.onOpenCashShift != null) {
        body = '${l.cashShiftRequiredMessage} ${l.openCashAndContinueHint}';
        action = PosButton(
          onPressed: cashRecoveryBusy
              ? null
              : () =>
                    _recoverCashShift((_) => widget.onOpenCashShift!(), 'free'),
          child: Text(l.openCashAndContinueAction),
        );
      }
    }
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const PosIcon(PosGlyphs.errorOutline, size: 64),
          Text(body, textAlign: TextAlign.center),
          const SizedBox(height: UmiSpacing.md),
          action,
          // ALWAYS a way out.
          //
          // This surface used to offer exactly one control — Retry — and the
          // refusal a cashier can actually cause (a tender the policy forbids,
          // an amount the engine rejects) is marked `retryable: false`, so
          // retrying re-sent the same refused payload for as long as the
          // operator was willing to press it. The cart survives the close, so
          // "Cerrar" returns the sale to the till to be fixed. Found the hard
          // way: this surface trapped the sweep mid-run, and the only node it
          // published was the retry button.
          const SizedBox(height: UmiSpacing.sm),
          PosTextButton(
            onPressed: () => _closeCheckout(context),
            child: Text(l.closeAction),
          ),
        ],
      ),
    );
  }

  Future<void> _recoverCashShift(
    Future<String?> Function(String holdState) recover,
    String? hold,
  ) async {
    if (cashRecoveryBusy) return;
    setState(() => cashRecoveryBusy = true);
    String? shiftId;
    try {
      shiftId = await recover(hold ?? 'free');
    } finally {
      if (mounted) setState(() => cashRecoveryBusy = false);
    }
    if (!mounted) return;
    // A recovered shift lets the charge go through as it stands. A reclaim frees
    // the drawer but leaves no shift to book the money against, so the till
    // returns to the catalog where a shift can be opened on it.
    if (shiftId != null) {
      await widget.checkout.retryWithCashShift(shiftId);
      return;
    }
    // A resume the operator walked away from — a cancelled PIN, a pad closed —
    // leaves the refusal and the cart where they were: the sale is not lost,
    // and pressing the button again asks for the PIN again. Only the other
    // holds send the till back to the catalog, because a drawer this device
    // cannot speak for leaves nothing here to charge against.
    if (mounted && hold != 'held_by_this_device') Navigator.of(context).pop();
  }
}

/// The amount due, rendered extra-large in a tinted card — the anchor of the
/// tender screen. It scales down rather than wrap so a four-figure total still
/// fits on one line.
final class _TotalHero extends StatelessWidget {
  const _TotalHero({required this.label, required this.amount});
  final String label;
  final String amount;

  @override
  Widget build(BuildContext context) {
    final scheme = PosTheme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: UmiSpacing.lg,
        vertical: UmiSpacing.md,
      ),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: PosTheme.of(context).textTheme.labelMedium?.copyWith(
              color: scheme.onSurfaceVariant,
              letterSpacing: 1,
            ),
          ),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              amount,
              style: PosTheme.of(context).textTheme.displaySmall?.copyWith(
                fontWeight: FontWeight.w800,
                color: scheme.onSurface,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A payment method as a big, labelled, tappable tile (not a chip): the two or
/// three ways to pay are the first decision on the screen, so they get real
/// targets and a clear selected state.
/// One sentence about the tender, above the tiles.
///
/// Deliberately plain: an icon, a sentence and the facts, in the same shape for
/// the refusal and for the split so the two cannot be mistaken for each other —
/// only the tone (error container vs surface) and the words differ.
final class _TenderNotice extends StatelessWidget {
  const _TenderNotice({
    required this.tone,
    required this.ink,
    required this.icon,
    required this.title,
    required this.body,
  });
  final Color tone;
  final Color ink;
  final PosGlyph icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: UmiSpacing.sm),
      child: Container(
        padding: const EdgeInsets.all(UmiSpacing.md),
        decoration: BoxDecoration(
          color: tone,
          borderRadius: BorderRadius.circular(UmiRadius.control),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            PosIcon(icon, color: ink, size: 20),
            const SizedBox(width: UmiSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: PosTheme.of(
                      context,
                    ).textTheme.titleSmall?.copyWith(color: ink),
                  ),
                  const SizedBox(height: UmiSpacing.xs),
                  Text(
                    body,
                    style: PosTheme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: ink),
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

final class BankTransferDialog extends StatelessWidget {
  const BankTransferDialog({
    super.key,
    required this.details,
    required this.merchantName,
    required this.logoUrl,
    required this.amount,
    required this.accountFolio,
    required this.selected,
  });

  final Map<String, Object?> details;
  final String merchantName;
  final String? logoUrl;
  final String amount;
  final String? accountFolio;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = PosTheme.of(context);
    final clabe = (details['clabe'] as String?)?.trim();
    final account = (details['accountNumber'] as String?)?.trim();
    final name = merchantName.trim().isEmpty ? 'ONCA' : merchantName;
    final logo = logoUrl?.trim();
    final dark = theme.brightness == Brightness.dark;
    final headerInk = dark
        ? theme.colorScheme.onSurface
        : const Color(0xFF151515);
    final headerMuted = dark
        ? theme.colorScheme.onSurfaceVariant
        : const Color(0xFF626262);
    final folio = accountFolio?.trim();
    final concept = folio == null || folio.isEmpty
        ? null
        : RegExp(r'^(cuenta|account)\b', caseSensitive: false).hasMatch(folio)
        ? '$name $folio'
        : '$name ${l.bankTransferAccountWord} $folio';
    return PosAlertDialog(
      constraints: const BoxConstraints(maxWidth: 560),
      contentPadding: const EdgeInsets.all(UmiSpacing.lg),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 60,
                height: 60,
                padding: const EdgeInsets.all(5),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFFFFF),
                  border: Border.all(
                    color: dark
                        ? theme.colorScheme.outlineVariant
                        : const Color(0xFFD8D8D8),
                  ),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: logo == null || logo.isEmpty
                    ? Center(
                        child: Text(
                          name.substring(0, 1).toUpperCase(),
                          style: theme.textTheme.headlineMedium?.copyWith(
                            color: const Color(0xFF151515),
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      )
                    : Image.network(
                        resolveApiAssetUrl(logo),
                        fit: BoxFit.contain,
                        errorBuilder: (_, _, _) => Center(
                          child: Text(
                            name.substring(0, 1).toUpperCase(),
                            style: theme.textTheme.headlineMedium?.copyWith(
                              color: const Color(0xFF151515),
                              fontWeight: FontWeight.w800,
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
                      name,
                      style: theme.textTheme.titleLarge?.copyWith(
                        color: headerInk,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      l.bankTransferLabel,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: headerMuted,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: UmiSpacing.md),
          Container(
            height: 1,
            color: dark
                ? theme.colorScheme.outlineVariant
                : const Color(0xFFE6E6E6),
          ),
          const SizedBox(height: UmiSpacing.lg),
          Text(l.bankTransferAmountLabel, style: theme.textTheme.labelLarge),
          Text(
            amount,
            key: const ValueKey('bank-transfer-modal-amount'),
            style: theme.textTheme.headlineMedium?.copyWith(
              fontWeight: FontWeight.w800,
              color: theme.colorScheme.primary,
            ),
          ),
          const SizedBox(height: UmiSpacing.md),
          _BankDetailRow(
            label: l.bankTransferBankLabel,
            value: details['bankName'] as String? ?? '',
          ),
          _BankDetailRow(
            label: l.bankTransferHolderLabel,
            value: details['holderName'] as String? ?? '',
          ),
          if (clabe != null && clabe.isNotEmpty)
            _BankDetailRow(
              label: 'CLABE',
              value: clabe,
              key: const ValueKey('bank-transfer-clabe'),
            ),
          if (account != null && account.isNotEmpty)
            _BankDetailRow(label: l.bankTransferAccountLabel, value: account),
          if (concept != null)
            _BankDetailRow(label: l.bankTransferConceptLabel, value: concept),
          const SizedBox(height: UmiSpacing.md),
          Text(
            l.bankTransferInstructions,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
      actions: [
        PosTextButton(
          key: const ValueKey('bank-transfer-close'),
          onPressed: () => Navigator.of(context).pop(false),
          child: Text(l.closeAction),
        ),
        if (!selected)
          PosButton(
            key: const ValueKey('bank-transfer-select'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l.bankTransferSelectAction),
          ),
      ],
    );
  }
}

final class _BankDetailRow extends StatelessWidget {
  const _BankDetailRow({super.key, required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UmiSpacing.xs),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: theme.textTheme.labelMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          Text(
            value,
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

final class _MethodTile extends StatelessWidget {
  const _MethodTile({
    super.key,
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });
  final PosGlyph icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = PosTheme.of(context).colorScheme;
    return PosSurface(
      color: selected
          ? scheme.primaryContainer
          : scheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(14),
      child: PosTapRegion(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          height: 72,
          padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.md),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected ? scheme.primary : scheme.outlineVariant,
              width: selected ? 2 : 1,
            ),
          ),
          child: Row(
            children: [
              PosIcon(
                icon,
                color: selected
                    ? scheme.onPrimaryContainer
                    : scheme.onSurfaceVariant,
              ),
              const SizedBox(width: UmiSpacing.sm),
              Expanded(
                child: Text(
                  label,
                  style: PosTheme.of(context).textTheme.titleMedium?.copyWith(
                    color: selected
                        ? scheme.onPrimaryContainer
                        : scheme.onSurface,
                    fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
              ),
              if (selected)
                PosIcon(PosGlyphs.checkCircle, color: scheme.primary, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

/// A quick-cash note button: exact change, or the bills a barista actually takes,
/// sized as a real touch target so the common tenders are one tap away.
final class _QuickCashButton extends StatelessWidget {
  const _QuickCashButton({required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => PosOutlineButton(
    onPressed: onTap,
    style: PosOutlineButton.styleFrom(
      minimumSize: const Size.fromHeight(48),
      padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.sm),
    ),
    child: FittedBox(fit: BoxFit.scaleDown, child: Text(label)),
  );
}

/// The on-screen numeric keypad. A till may have no keyboard, so cash is entered
/// here; keys are wide, high-contrast, and drive the cash-received field.
final class _Numpad extends StatelessWidget {
  const _Numpad({required this.onKey});
  final ValueChanged<String> onKey;

  @override
  Widget build(BuildContext context) {
    const keys = [
      '1', '2', '3', //
      '4', '5', '6', //
      '7', '8', '9', //
      '.', '0', 'back',
    ];
    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: UmiSpacing.sm,
      crossAxisSpacing: UmiSpacing.sm,
      childAspectRatio: 2,
      children: [
        for (final key in keys) _KeyButton(label: key, onTap: () => onKey(key)),
      ],
    );
  }
}

final class _KeyButton extends StatelessWidget {
  const _KeyButton({required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = PosTheme.of(context).colorScheme;
    return PosSurface(
      color: scheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(12),
      child: PosTapRegion(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Center(
          child: label == 'back'
              ? const PosIcon(PosGlyphs.backspaceOutlined)
              : Text(
                  label,
                  style: PosTheme.of(context).textTheme.headlineSmall,
                ),
        ),
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
        Expanded(child: Text(label)),
        const SizedBox(width: UmiSpacing.sm),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: emphasized
                ? const UmiOperatorTokens()
                      .money(PosTheme.of(context).textTheme)
                      .copyWith(fontSize: 24)
                : null,
          ),
        ),
      ],
    ),
  );
}
