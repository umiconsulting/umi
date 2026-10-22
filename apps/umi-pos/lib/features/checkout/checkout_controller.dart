import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/observability/telemetry.dart';
import '../offline/connectivity_controller.dart';
import '../offline/offline_checkout_service.dart';
import '../offline/offline_journal.dart';
import '../offline/offline_policy.dart';
import '../offline/replay_engine.dart';
import 'checkout_repository.dart';
import 'tender_identity.dart';

/// Who is charging, where, and in which cart.
///
/// The card flow needs it BEFORE the checkout runs — a card is captured against
/// a terminal long before any checkout command exists — so the surface passes it
/// in rather than the controller reading its own `preview` fields, which are
/// still empty at that moment.
final class TenderScope {
  const TenderScope({
    required this.merchantId,
    required this.locationId,
    required this.operatorSessionId,
    required this.cartId,
  });
  final String merchantId;
  final String locationId;
  final String operatorSessionId;
  final String cartId;
}

enum CheckoutPhase {
  idle,
  repricing,
  confirmationRequired,
  processing,
  collectingPayment,
  awaitingApproval,
  paymentUnknown,
  completed,
  provisional,

  /// The provisional sale was accepted on replay; the receipt on screen now
  /// names the official sale instead of asking the operator to keep waiting.
  provisionalSynced,
  failure,
}

final class CheckoutState {
  const CheckoutState({
    this.phase = CheckoutPhase.idle,
    this.result,
    this.errorCode,
    this.provisionalReceipt,
    this.officialSaleId,
    this.failureDetails,
    this.postCommitWarning,
  });
  final CheckoutPhase phase;
  final CheckoutResult? result;
  final String? errorCode;
  final ProvisionalReceipt? provisionalReceipt;

  /// Set once the provisional sale in `provisionalReceipt` has landed.
  final String? officialSaleId;

  /// A warning from the hardware that ran AFTER a completed sale — the drawer's
  /// pulse especially. The money is recorded either way; what failed is the
  /// signal that opens the drawer, and the cashier has no other way to hear it.
  final String? postCommitWarning;

  /// The facts a typed refusal carried (`ApiError.details`), so the failure
  /// surface can offer the recovery action the code names instead of a bare
  /// retry that re-sends the same payload.
  final Map<String, Object?>? failureDetails;

  /// The register hold the refusal resolved, when the failure was a missing cash
  /// shift: `free | held_by_this_device | held_by_active_till |
  /// held_by_orphaned_till`.
  String? get holdState => failureDetails?['holdState'] as String?;

  /// The shift the refusal refused over, when it named one. The resume recovery
  /// acts on THIS id instead of re-deriving "the current shift" from the cash
  /// screen, which is what leaves an operator pressing a button that cannot work
  /// after an app update moved the session on.
  String? get holdShiftId => _detailString('shiftId');

  /// One field out of a refusal, whatever shape the envelope took.
  ///
  /// `failureDetails` is the API's `details` map, and the platform's own client
  /// notes that a thrown payload arrives NESTED: the filter wraps it as
  /// `{ statusCode, error: { code, message, details } }`, so a field can sit one
  /// level down from where the route put it. Reading only the top level is how a
  /// recovery button ends up with a null it never reports — measured on the iMin
  /// D3-504 on 2026-10-11: the till held the shift id in the refusal and pressed
  /// the resume anyway with nothing to resume.
  String? _detailString(String key) {
    for (final bag in [
      failureDetails,
      failureDetails?['details'],
      failureDetails?['error'],
    ]) {
      if (bag is! Map) continue;
      final value = bag[key];
      if (value is String && value.isNotEmpty) return value;
    }
    return null;
  }
}

final class CheckoutController extends ChangeNotifier {
  CheckoutController({
    required CheckoutRepository repository,
    OfflineCheckoutService? offlineCheckout,
    ConnectivityController? connectivity,
    EncryptedOfflineJournal? journal,
    OfflineRecoveryController? recovery,
    bool Function()? pendingLocalCommands,
    Future<bool> Function()? preserveLocalCommands,
    Future<void> Function()? refreshOfflinePolicy,
    required Telemetry telemetry,
    Future<String?> Function(CheckoutResult result)? afterCommit,
    Future<void> Function(ProvisionalReceipt receipt)? afterOfflineCommit,
    this.localFirstFastPathEnabled = false,
  }) : _repository = repository,
       _offlineCheckout = offlineCheckout,
       _connectivity = connectivity,
       _journal = journal,
       _recovery = recovery,
       _pendingLocalCommands = pendingLocalCommands,
       _preserveLocalCommands = preserveLocalCommands,
       _refreshOfflinePolicy = refreshOfflinePolicy,
       _telemetry = telemetry,
       _afterCommit = afterCommit,
       _afterOfflineCommit = afterOfflineCommit {
    _recovery?.addListener(_recoveryChanged);
  }

  final CheckoutRepository _repository;
  final OfflineCheckoutService? _offlineCheckout;
  final ConnectivityController? _connectivity;
  final EncryptedOfflineJournal? _journal;
  final OfflineRecoveryController? _recovery;
  final bool Function()? _pendingLocalCommands;
  final Future<bool> Function()? _preserveLocalCommands;
  final Future<void> Function()? _refreshOfflinePolicy;
  final Telemetry _telemetry;
  final Future<String?> Function(CheckoutResult result)? _afterCommit;
  final Future<void> Function(ProvisionalReceipt receipt)? _afterOfflineCommit;
  final bool localFirstFastPathEnabled;
  CheckoutState _state = const CheckoutState();
  CheckoutState get state => _state;
  bool get usesLocalCheckout => !_worthTryingOnline || _localFastCheckout;
  List<Map<String, Object?>> get tenderDrafts => _tenderDrafts;
  Map<String, Object?>? get tipDraft => _tipDraft;
  List<Map<String, Object?>> get discountDrafts => _discountDrafts;
  Map<String, Object?> get receiptDelivery => _receiptDelivery;
  CustomerValueSelection? get customerValueSelection => _customerValueSelection;
  String? _merchantId;
  String? _locationId;
  String? _operatorSessionId;
  String? _cartId;
  String? _cashShiftId;
  int? _cartVersion;
  String _paymentMethod = 'cash';
  bool _partialLedgerFinalization = false;
  Cart? _cart;
  OfflineAuthorityContext? _authority;
  String _locationName = '';
  String _operatorName = '';
  int? _cashReceivedMinorUnits;

  /// What this location may offer in a tender, read once when the sheet opens.
  ///
  /// Deliberately NOT a field of `CheckoutState`: every transition builds a
  /// fresh state object for the attempt, so a policy kept there is silently
  /// dropped by whichever concurrent load finishes last — which is exactly what
  /// happened when the recovery read landed 50 ms after the policy read and the
  /// card-terminal tile vanished from a screen that had already offered it.
  /// The policy describes the LOCATION, so it lives here and survives a reset.
  CheckoutPolicy? _policy;
  CheckoutPolicy? get policy => _policy;
  bool get supportsPartialPayments => _repository is PartialPaymentRepository;
  bool get canCollectPartialPayments =>
      supportsPartialPayments && _worthTryingOnline;

  Future<Map<String, Object?>> partialPayments({
    required String merchantId,
    required String cartId,
    required String locationId,
    required String operatorSessionId,
  }) {
    final repository = _repository;
    if (repository is! PartialPaymentRepository || !_worthTryingOnline) {
      throw StateError('PARTIAL_PAYMENTS_UNAVAILABLE');
    }
    return (repository as PartialPaymentRepository)
        .partialPayments(
          merchantId,
          cartId,
          CheckoutPartialPaymentQuery(
            locationId: locationId,
            operatorSessionId: operatorSessionId,
          ),
        )
        .then((result) => result.data);
  }

  /// Bind the identifiers a partial-payment write needs without first reading
  /// checkout recovery. Opening Split check is a ledger read, and the ledger is
  /// already authoritative about its own drafts. Recovery used to turn a normal
  /// "no checkout yet" answer into a multi-second 404 on the critical path.
  void bindPartialLedger({
    required String merchantId,
    required String locationId,
    required String operatorSessionId,
    required String cartId,
    required int cartVersion,
  }) {
    _merchantId = merchantId;
    _locationId = locationId;
    _operatorSessionId = operatorSessionId;
    _cartId = cartId;
    _cartVersion = cartVersion;
  }

  Future<Map<String, Object?>> collectPartialPayment({
    required String merchantId,
    required String cartId,
    required Map<String, Object?> command,
  }) {
    final repository = _repository;
    if (repository is! PartialPaymentRepository || !_worthTryingOnline) {
      throw StateError('PARTIAL_PAYMENTS_UNAVAILABLE');
    }
    return (repository as PartialPaymentRepository)
        .collectPartialPayment(
          merchantId,
          cartId,
          CheckoutPartialPaymentRequest.fromJson(command),
        )
        .then((result) => result.data);
  }

  /// The card-present provider this location may actually use, or null.
  ///
  /// Kept beside `_policy` for the same reason: it describes the LOCATION, so it
  /// survives a reset, and it is a READ — a failure leaves this null and the
  /// screen on cash rather than blocking a sale. The till never hardcodes the
  /// vendor slug; it draws the tile from whoever the server says is available.
  String? _cardTerminalProviderId;
  String? get cardTerminalProviderId => _cardTerminalProviderId;
  List<Map<String, Object?>> _tenderDrafts = const [];
  Map<String, Object?>? _tipDraft;
  List<Map<String, Object?>> _discountDrafts = const [];
  List<String> _approvalIds = const [];
  Map<String, Object?> _receiptDelivery = const {
    'destination': 'display',
    'channel': null,
    'customerContactId': null,
  };
  CustomerValueSelection? _customerValueSelection;
  Map<String, Object?>? _recoveredPaymentOutcome;
  String? _commitCommandId;
  String? _commitIdempotencyKey;
  String? _customerValueFingerprintCommandId;
  final Map<String, CheckoutResult> _confirmationCache = {};

  Future<void> preview({
    required String merchantId,
    required String locationId,
    required String operatorSessionId,
    required String cartId,
    required int cartVersion,
    required String paymentMethod,
    String? cashShiftId,
    Cart? cart,
    OfflineAuthorityContext? authority,
    String locationName = '',
    String operatorName = '',
    int? cashReceivedMinorUnits,
    bool partialLedgerFinalization = false,
    List<Map<String, Object?>> tenderDrafts = const [],
    Map<String, Object?>? tipDraft,
    List<Map<String, Object?>> discountDrafts = const [],
    List<String> approvalIds = const [],
    Map<String, Object?> receiptDelivery = const {
      'destination': 'display',
      'channel': null,
      'customerContactId': null,
    },
  }) async {
    _merchantId = merchantId;
    _locationId = locationId;
    _operatorSessionId = operatorSessionId;
    _cartId = cartId;
    _cartVersion = cartVersion;
    _paymentMethod = paymentMethod;
    _partialLedgerFinalization = partialLedgerFinalization;
    _cashShiftId = cashShiftId;
    _cart = cart;
    _authority = authority;
    _locationName = locationName;
    _operatorName = operatorName;
    _cashReceivedMinorUnits = cashReceivedMinorUnits;
    _tenderDrafts = List.unmodifiable(tenderDrafts);
    _tipDraft = tipDraft == null ? null : Map.unmodifiable(tipDraft);
    _discountDrafts = List.unmodifiable(discountDrafts);
    _approvalIds = List.unmodifiable(approvalIds);
    _receiptDelivery = Map.unmodifiable(receiptDelivery);
    _commitCommandId = _uuid();
    _commitIdempotencyKey = _uuid();
    _customerValueFingerprintCommandId ??= _uuid();
    if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
      debugPrint(
        '[umipos] checkout preview fast=$_localFastCheckout '
        'tenders=${_tenderDrafts.length} method=$_paymentMethod '
        'tip=${_tipDraft != null} discounts=${_discountDrafts.length}',
      );
    }
    _set(const CheckoutState(phase: CheckoutPhase.repricing));
    _event('checkout_opened');
    if (!_worthTryingOnline || _localFastCheckout) {
      if (cart == null || authority == null) {
        _set(
          const CheckoutState(
            phase: CheckoutPhase.failure,
            errorCode: 'OFFLINE_CONTEXT_UNAVAILABLE',
          ),
        );
        return;
      }
      final cached = _confirmationCache['${cart.id}:${cart.version}'];
      final confirmation = cached ?? _localConfirmation(cart);
      _confirmationCache['${cart.id}:${cart.version}'] = confirmation;
      _set(
        CheckoutState(
          phase: CheckoutPhase.confirmationRequired,
          result: confirmation,
        ),
      );
      return;
    }
    // A terminal tender becomes a REAL attempt before this checkout can record
    // one, and the operator's reading of the terminal screen is what settles it.
    //
    // The whole online half sits in one catch-all: capturing a terminal tender
    // talks to a provider, which is exactly where an error this file has no
    // type for comes from, and an escape here left the sheet on the spinner the
    // phase above just set. See `_unexpected`.
    try {
      // The partial-payment endpoint already persisted the operator's
      // confirmation and reference for each external tender. A final checkout
      // links that ledger; capturing the same terminal tender here again would
      // create a second attempt after the money was recorded.
      final terminalFailure = _partialLedgerFinalization
          ? null
          : await _captureTerminalTenders();
      if (terminalFailure != null) {
        _set(
          CheckoutState(
            phase: CheckoutPhase.failure,
            errorCode: terminalFailure,
          ),
        );
        return;
      }
      await _submit(null);
    } catch (error) {
      _unexpected(error);
    }
  }

  ///
  /// Turn each terminal tender into an attempt, and settle the ones the operator
  /// has ALREADY read the screen for.
  ///
  /// This is the half that was missing, and its absence is why a card tender could
  /// not be recovered: without it the till wrote a `manual_terminal` tender
  /// straight into the checkout draft, and the draft's own guards then refused to
  /// let anyone change or cancel it — correctly, because a confirmed terminal
  /// payment is a claim that money moved, and there was nothing behind the claim
  /// to resolve. The attempt is what can be resolved.
  ///
  /// The order matters and is deliberate: capture FIRST (the attempt exists even
  /// if the till dies on the next line), then settle, then let the checkout
  /// commit. A capture says `unknown` for a manual terminal and always will —
  /// only a person can read that screen — so the settlement is where the operator
  /// turns what they saw into a decision, and it carries
  /// `proofSource: operator_attested` rather than a provider's.
  ///
  /// A tender the operator has NOT read yet is left alone: an attempt for a
  /// question nobody has answered would be noise, and the checkout refuses the
  /// tender with its own code.
  ///
  /// A CARD tender never reaches the capture+settle pair below: the till already
  /// captured it against a provider before this commit, so an attempt exists for
  /// its identity and the draft is skipped. See the loop.
  ///
  /// Returns a failure code when the attempt could not be created or settled, or
  /// null when there was nothing to do or everything worked.
  Future<String?> _captureTerminalTenders() async {
    final merchantId = _merchantId;
    final locationId = _locationId;
    final operatorSessionId = _operatorSessionId;
    final cartId = _cartId;
    if (merchantId == null ||
        locationId == null ||
        operatorSessionId == null ||
        cartId == null) {
      return null;
    }
    final terminalRepository = _terminalRepository;
    for (final tender in _tenderDrafts) {
      if (tender['type'] != 'manual_terminal') continue;
      final tenderId = tender['id'] as String?;
      final amount = tender['amount'] as Map<String, Object?>?;
      final status = tender['status'] as String?;
      if (tenderId == null || amount == null || status == null) continue;
      final decided = switch (status) {
        'confirmed_success' => 'paid',
        'operator_reported_failure' => 'not_paid',
        // The operator does not know. Capturing records the question; settling
        // would be inventing the answer, and the commit refuses an unresolved
        // capture on purpose.
        'outcome_unknown' => null,
        // Nobody has looked at the terminal yet.
        _ => null,
      };
      if (status != 'confirmed_success' &&
          status != 'operator_reported_failure' &&
          status != 'outcome_unknown') {
        continue;
      }
      // A CARD tender is `manual_terminal` on the wire — that is the only type
      // that maps to `external_terminal` — but its PROOF is not decided by the
      // type: it comes from the attempt the till captured at the terminal before
      // this commit (the commit LINKS that attempt and keeps the provider's own
      // payment id). So ask for the attempt by the tender's own identity FIRST.
      // If one exists, this draft is already answered and the manual
      // capture+attestation path below must not touch it — that path would
      // invent an operator's word for money a terminal took. A 404
      // (`TENDER_ATTEMPT_NOT_FOUND`) means no attempt exists yet and the manual
      // path runs unchanged, which is also what makes the flow survive a till
      // restart: the identity is derived from the cart, not from this session.
      if (terminalRepository != null) {
        try {
          final existing = await terminalRepository.tenderAttempt(
            merchantId,
            tenderId,
            TenderAttemptQuery(
              locationId: locationId,
              operatorSessionId: operatorSessionId,
              refresh: false,
            ),
          );
          if (existing.attempt.isNotEmpty) continue;
        } on AppException catch (error) {
          if (error.code != 'TENDER_ATTEMPT_NOT_FOUND' &&
              error.code != 'RESOURCE_NOT_FOUND') {
            return error.code;
          }
        }
      }
      try {
        await _repository.captureTender(
          merchantId,
          TenderCaptureRequest(
            cartId: cartId,
            tenderId: tenderId,
            locationId: locationId,
            operatorSessionId: operatorSessionId,
            // The tender's own id, which `tenderId(cartId, kind)` derives from the
            // cart: stable across a retry of this sale, and never seen again once
            // the sale is done. That is what makes a retried capture find the
            // attempt instead of asking the provider a second time.
            commandIdentity: tenderId,
            provider: 'manual_terminal',
            amount: amount,
            idempotencyKey: _uuid(),
          ),
        );
      } on AppException catch (error) {
        return error.code;
      }
      if (decided == null) continue;
      try {
        await _repository.settleTender(
          merchantId,
          tenderId,
          TenderSettlementRequest(
            locationId: locationId,
            operatorSessionId: operatorSessionId,
            outcome: decided,
            evidence: decided == 'paid'
                ? 'terminal_screen_shows_paid'
                : 'terminal_screen_shows_declined',
            note: null,
            idempotencyKey: _uuid(),
          ),
        );
      } on AppException catch (error) {
        return error.code;
      }
    }
    return null;
  }

  Future<void> recover({
    required String merchantId,
    required String locationId,
    required String operatorSessionId,
    required String cartId,
    required int cartVersion,
  }) async {
    if (usesLocalCheckout && _state.result == null) {
      _set(const CheckoutState());
      return;
    }
    try {
      _merchantId = merchantId;
      _locationId = locationId;
      _operatorSessionId = operatorSessionId;
      _cartId = cartId;
      _cartVersion = cartVersion;
      final recovered = await _repository.recovery(
        merchantId,
        cartId,
        CheckoutRecoveryQuery(
          locationId: locationId,
          operatorSessionId: operatorSessionId,
        ),
      );
      _tenderDrafts = recovered.tenderDrafts;
      _tipDraft = recovered.tipDraft;
      _discountDrafts = recovered.discountDrafts;
      _receiptDelivery = recovered.receiptDelivery;
      _recoveredPaymentOutcome = recovered.paymentOutcome;
      final recoveredAttempt =
          recovered.paymentOutcome?['attempt'] as Map<String, Object?>?;
      final committedResult = recovered.result == null
          ? null
          : CheckoutResult.fromJson(recovered.result!);
      final recoveredResult =
          committedResult ??
          (recovered.state == 'payment_unknown'
              ? CheckoutResult(
                  status: 'payment_unknown',
                  confirmation: const {},
                  payment: recovered.paymentOutcome,
                  payments: recovered.paymentOutcome == null
                      ? const []
                      : [recovered.paymentOutcome!],
                  reservation: null,
                  sale: null,
                  receipt: null,
                  failure: {
                    'code': 'TERMINAL_OUTCOME_UNKNOWN',
                    'retryable': false,
                    'operatorGuidance': 'verify_terminal_outcome',
                    'correlationId':
                        recoveredAttempt?['correlationId'] as String? ??
                        'checkout-recovery',
                  },
                  paymentSummary: recovered.paymentSummary,
                  recoveryState: recovered.recoveryState,
                  receiptDelivery: recovered.receiptDelivery,
                  policy: null,
                )
              : null);
      final phase = switch (recoveredResult?.status) {
        'completed' => CheckoutPhase.completed,
        'payment_unknown' => CheckoutPhase.paymentUnknown,
        _ when recovered.state == 'completed' => CheckoutPhase.failure,
        _ => CheckoutPhase.collectingPayment,
      };
      _set(
        CheckoutState(
          phase: phase,
          result: recoveredResult,
          errorCode: phase == CheckoutPhase.failure
              ? 'receipt_pending'
              : recovered.recoveryState,
        ),
      );
      if (phase == CheckoutPhase.completed && recoveredResult != null) {
        _runPostCommit(recoveredResult);
      }
      _event('checkout_recovered');
    } on AppException catch (error) {
      if (_state.result == null &&
          (error.category == AppErrorCategory.transport ||
              error.category == AppErrorCategory.timeout ||
              error.category == AppErrorCategory.server ||
              error.category == AppErrorCategory.unknown)) {
        // There is no prior checkout state to recover. A network failure here
        // is not a checkout refusal; leave the screen clean for the local path.
        _set(const CheckoutState());
        return;
      }
      if (error.code != 'RESOURCE_NOT_FOUND') _failure(error);
    }
  }

  void applyApproval(String approvalId) {
    _approvalIds = List.unmodifiable({..._approvalIds, approvalId});
    _commitCommandId = _uuid();
    _commitIdempotencyKey = _uuid();
  }

  void applyCustomerValue(CustomerValueSelection? selection) {
    _customerValueSelection = selection;
    _commitCommandId = _uuid();
    _commitIdempotencyKey = _uuid();
    notifyListeners();
  }

  /// The customer-value half of the checkout command, with the absent optionals LEFT OUT.
  ///
  /// `CustomerValueSelection.toJson()` is generated and writes every key, so the fields the sale
  /// has no value for travel as `null`. The contract declares those fields optional, which makes an
  /// explicit null a DIFFERENT thing from an absent one, and the ones the database reads as arrays
  /// (`storedValueAuthorizationIds`, `fundedGiftCards`) are refused or explode when they arrive as
  /// null: measured on the iMin D3-504 on 2026-10-11, a customer sale that had just earned its
  /// preview was answered
  /// `400 VALIDATION_FAILED … fieldErrors: {"customerValue.fundedGiftCards":["Expected array, received null"]}`.
  /// Dropping the nulls is what the contract asks for: `z.array(...).optional()`, `.nullable().optional()`
  /// and `.default(null)` all mean "absent is fine", and none of them means "null is fine".
  static Map<String, Object?>? _customerValuePayload(
    CustomerValueSelection? selection,
  ) {
    final json = selection?.toJson();
    if (json == null) return null;
    json.removeWhere((_, value) => value == null);
    return json;
  }

  Future<void> confirm() async {
    final fingerprint = _state.result?.confirmation['fingerprint'] as String?;
    if (fingerprint == null) return;
    if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
      debugPrint(
        '[umipos] checkout confirm fast=$_shouldCommitLocally '
        'online=$_worthTryingOnline fingerprint=${fingerprint.substring(0, 8)}',
      );
    }
    if (!_worthTryingOnline) {
      await _submitOffline(fingerprint);
      return;
    }
    _set(CheckoutState(phase: CheckoutPhase.processing, result: _state.result));
    _event('checkout_confirmed');
    _event('payment_started');
    await _submit(fingerprint);
  }

  /// ASK WHOEVER ACTUALLY HOLDS THE MONEY.
  ///
  /// A card sale leaves TWO rows behind, and only one of them can answer. The
  /// tender attempt the terminal was asked about carries the provider and the
  /// vendor's order; this checkout's own payment row is a `query_only` record
  /// with NO provider at all. The first version of this method asked the second
  /// one, so "Consultar estado del pago" re-read our own silence, came back
  /// `unknown` again and re-rendered the same sentence. A button that cannot
  /// change the screen is worse than no button: the operator presses it while a
  /// customer waits, and learns nothing.
  ///
  /// The payment row does carry the key. `tenderId` is the identity the capture
  /// used — `tenderId(cartId, 'card_terminal')`, derived from the cart, which is
  /// why it survives a till restart — and that is where the terminal's answer is
  /// filed.
  Future<void> queryUnknownPayment() async {
    final payment = _state.result?.payment ?? _recoveredPaymentOutcome;
    if (payment == null ||
        _merchantId == null ||
        _locationId == null ||
        _operatorSessionId == null) {
      return;
    }
    // The outcome carries the attempt under `attempt`; the card identity is the
    // one the cart derives — `tenderId(cart, 'card_terminal')`, which is exactly
    // what the capture sent as its command identity, so it survives a restart of
    // the till as long as the cart does.
    final carried = payment['attempt'];
    final method =
        (carried is Map<String, Object?>
            ? carried['method'] as String?
            : null) ??
        payment['method'] as String?;
    final tenderIdentity =
        payment['tenderId'] as String? ??
        (_cartId == null ? null : tenderId(_cartId!, 'card_terminal'));
    if (method == 'external_terminal' && tenderIdentity != null) {
      final answered = await _askTerminalForCardAnswer(tenderIdentity);
      // The terminal could not be asked — no transport in this build, or no
      // attempt for that identity — so fall through to the payment row rather
      // than turning "we have nothing to ask" into a failure.
      if (answered) return;
    }
    final attempt = PaymentAttempt.fromJson(
      payment['attempt']! as Map<String, Object?>,
    );
    try {
      final outcome = await _repository.paymentStatus(
        _merchantId!,
        attempt.id,
        PaymentStatusQuery(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
        ),
      );
      if (outcome.attempt['status'] == 'unknown' ||
          outcome.attempt['status'] == 'timeout') {
        final outcomeJson = outcome.toJson();
        _recoveredPaymentOutcome = outcomeJson;
        final current = _state.result;
        final updated = current == null
            ? null
            : CheckoutResult.fromJson({
                ...current.toJson(),
                'status': 'payment_unknown',
                'payment': outcomeJson,
                'payments': [outcomeJson],
                'recoveryState': 'terminal_outcome_unknown',
              });
        _event('payment_unknown');
        _set(
          CheckoutState(
            phase: CheckoutPhase.paymentUnknown,
            result: updated,
            errorCode: 'terminal_outcome_unknown',
          ),
        );
        return;
      }
      _set(
        CheckoutState(
          phase: CheckoutPhase.failure,
          result: _state.result,
          errorCode: 'PAYMENT_STATUS_CHANGED',
        ),
      );
    } on AppException catch (error) {
      _failure(error);
    }
  }

  /// The terminal's own answer, asked of the terminal.
  ///
  /// Three answers, three screens, and none of them commits anything:
  ///
  ///  - still open (`at_terminal`, `created`, ...) — the sale stays unknown, but
  ///    the screen now says whose answer is missing and what the terminal last
  ///    said, instead of a generic sentence about a payment nobody can name.
  ///  - declined or cancelled — the money did NOT move. The sale goes back to
  ///    the tender screen with the terminal's code, so the operator can take
  ///    cash; retrying the card needs a new cart, because the identity is derived
  ///    from the cart on purpose (one attempt per cart, never a second charge).
  ///  - succeeded — the terminal took the money and the operator's own Cobrar is
  ///    what commits the sale, linking the provider's payment as its proof.
  /// Returns true when the terminal answered and the screen moved.
  Future<bool> _askTerminalForCardAnswer(String commandIdentity) async {
    final repository = _terminalRepository;
    if (repository == null) return false;
    try {
      final result = await repository.tenderAttempt(
        _merchantId!,
        commandIdentity,
        TenderAttemptQuery(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          refresh: true,
        ),
      );
      final current = _state.result;
      if (current == null) return false;
      final attempt = result.attempt;
      // The tender route names the state `state`; the checkout's own payment
      // outcome names it `status`. Both mean the same thing here.
      final status =
          attempt['state'] as String? ?? attempt['status'] as String?;
      final settled =
          status == 'succeeded' ||
          status == 'declined' ||
          status == 'cancelled' ||
          status == 'failed';
      // The facts travel with the payment map so the screen can name them: the
      // status the terminal last reported is what makes this screen specific.
      final answered = <String, Object?>{
        ...(_state.result?.payment ?? const <String, Object?>{}),
        'tenderId': commandIdentity,
        'method': 'external_terminal',
        'status': status,
        'providerStatus': attempt['providerStatus'],
        'providerOrderId': attempt['providerOrderId'],
      };
      if (!settled) {
        _set(
          CheckoutState(
            phase: CheckoutPhase.paymentUnknown,
            result: CheckoutResult.fromJson({
              ...current.toJson(),
              'status': 'payment_unknown',
              'payment': answered,
              'payments': [answered],
              'recoveryState': 'terminal_outcome_unknown',
            }),
            errorCode: 'terminal_outcome_unknown',
          ),
        );
        return true;
      }
      _set(
        CheckoutState(
          phase: CheckoutPhase.collectingPayment,
          result: CheckoutResult.fromJson({
            ...current.toJson(),
            'status': 'payment_pending',
            'payment': answered,
            'payments': [answered],
            'recoveryState': status == 'succeeded'
                ? 'terminal_approved'
                : 'terminal_declined',
          }),
          errorCode: status == 'succeeded'
              ? 'terminal_approved'
              : 'terminal_declined',
        ),
      );
      return true;
    } on AppException {
      // A QUESTION THAT COULD NOT BE ASKED IS NOT AN ANSWER. The caller falls
      // back to the only other thing it knows (the payment row) and the sale
      // stays unknown, which is exactly what an unanswered charge is.
      return false;
    }
  }

  void reset() {
    _merchantId = null;
    _locationId = null;
    _operatorSessionId = null;
    _cartId = null;
    _cashShiftId = null;
    _cartVersion = null;
    _paymentMethod = 'cash';
    _partialLedgerFinalization = false;
    _cart = null;
    _authority = null;
    _locationName = '';
    _operatorName = '';
    _cashReceivedMinorUnits = null;
    _tenderDrafts = const [];
    _tipDraft = null;
    _discountDrafts = const [];
    _approvalIds = const [];
    _customerValueSelection = null;
    _receiptDelivery = const {
      'destination': 'display',
      'channel': null,
      'customerContactId': null,
    };
    _recoveredPaymentOutcome = null;
    _commitCommandId = null;
    _commitIdempotencyKey = null;
    _customerValueFingerprintCommandId = null;
    // `_policy` is NOT cleared: it describes the location, not the attempt. See
    // its declaration.
    _set(const CheckoutState());
  }

  Future<bool> cancel({String reason = 'operator_cancelled'}) async {
    if (_merchantId == null ||
        _locationId == null ||
        _operatorSessionId == null ||
        _cartId == null) {
      reset();
      return true;
    }
    if (_state.phase == CheckoutPhase.paymentUnknown) return false;
    try {
      await _repository.cancel(
        _merchantId!,
        _cartId!,
        CheckoutCancellationRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          reason: reason,
          checkoutFingerprint:
              _state.result?.confirmation['fingerprint'] as String?,
          approvalIds: _approvalIds,
          idempotencyKey: _uuid(),
        ),
      );
      _event('checkout_cancelled');
      reset();
      return true;
    } on AppException catch (error) {
      _failure(error);
      return false;
    } catch (error) {
      // Same rule as the charge path: a close that cannot be completed must say
      // so and leave the sheet usable, not swallow the press.
      _unexpected(error);
      return false;
    }
  }

  Future<void> _submit(
    String? fingerprint, {
    bool retryIdempotencyConflict = true,
  }) async {
    if (_merchantId == null ||
        _locationId == null ||
        _operatorSessionId == null ||
        _cartId == null ||
        _cartVersion == null) {
      return;
    }
    // A local cash sale must never continue through the online partial-payment
    // path without a drawer. That path records the cash, redisplays Cobrar on
    // the same total, and asks the operator for a second tap. Stop before money
    // unless Cash Center has produced this terminal's shift.
    if (localFirstFastPathEnabled &&
        _worthTryingOnline &&
        _isSimpleCashTender &&
        _cashShiftId == null) {
      _set(
        CheckoutState(
          phase: CheckoutPhase.failure,
          result: _state.result,
          errorCode: 'CASH_SHIFT_REQUIRED',
        ),
      );
      return;
    }
    // When the till already knows the API is unreachable, committing locally is
    // the answer, not another request. Waiting for the 15 s client timeout to
    // expire first is what turned "offline" into "the till froze": the cashier
    // sees nothing, taps again, and the queue grows behind a sale that was
    // never ambiguous. The confirmation step still runs, because the operator
    // is entitled to see the totals before the sale is written.
    if (_shouldCommitLocally()) {
      if (fingerprint == null && _cart != null) {
        final confirmation = _localConfirmation(_cart!);
        _confirmationCache['${_cart!.id}:${_cart!.version}'] = confirmation;
        _event('totals_confirmed_offline');
        _set(
          CheckoutState(
            phase: CheckoutPhase.confirmationRequired,
            result: confirmation,
          ),
        );
        return;
      }
      if (fingerprint != null) {
        final storedLocally = await _submitOffline(
          fingerprint,
          fallbackOnline: localFirstFastPathEnabled && _worthTryingOnline,
        );
        if (storedLocally ||
            !localFirstFastPathEnabled ||
            !_worthTryingOnline) {
          return;
        }
      }
    }
    try {
      if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
        debugPrint(
          '[umipos] checkout request fingerprint=${fingerprint == null ? "preview" : fingerprint.substring(0, 8)} '
          'command=${_commitCommandId ?? "preview"} '
          'idempotency=${_commitIdempotencyKey ?? "preview"}',
        );
      }
      final result = await _repository.checkout(
        _merchantId!,
        CheckoutCommand(
          commandId: fingerprint == null ? _uuid() : _commitCommandId,
          customerValueFingerprintCommandId: _customerValueFingerprintCommandId,
          cartId: _cartId!,
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          expectedCartVersion: _cartVersion!,
          paymentMethod: _paymentMethod,
          totalsFingerprint: fingerprint,
          idempotencyKey: fingerprint == null
              ? _uuid()
              : (_commitIdempotencyKey ?? _uuid()),
          tenderDrafts: _tenderDrafts,
          tipDraft: _tipDraft,
          discountDrafts: _discountDrafts,
          approvalIds: _approvalIds,
          receiptDelivery: _receiptDelivery,
          cashShiftId: _cashShiftId,
          customerValue: _customerValuePayload(_customerValueSelection),
        ),
      );
      final storedValueFingerprint =
          result.confirmation['storedValueFingerprint'] as String?;
      final selectedValue = _customerValueSelection;
      if (selectedValue != null && storedValueFingerprint != null) {
        _customerValueSelection = CustomerValueSelection(
          previewFingerprint: selectedValue.previewFingerprint,
          storedValueFingerprint: storedValueFingerprint,
          rewardAuthorizationId: selectedValue.rewardAuthorizationId,
          rewardApprovalId: selectedValue.rewardApprovalId,
          storedValueAuthorizationIds:
              selectedValue.storedValueAuthorizationIds,
          fundedGiftCards: selectedValue.fundedGiftCards,
        );
      }
      final phase = switch (result.status) {
        'confirmation_required' => CheckoutPhase.confirmationRequired,
        'payment_unknown' => CheckoutPhase.paymentUnknown,
        'completed' => CheckoutPhase.completed,
        'payment_pending' when result.recoveryState == 'approval_required' =>
          CheckoutPhase.awaitingApproval,
        'payment_pending' => CheckoutPhase.collectingPayment,
        _ => CheckoutPhase.processing,
      };
      _set(
        CheckoutState(
          phase: phase,
          result: result,
          errorCode: result.recoveryState == 'none'
              ? null
              : result.recoveryState,
        ),
      );
      if (phase == CheckoutPhase.confirmationRequired && _cart != null) {
        _confirmationCache['${_cart!.id}:${_cart!.version}'] = result;
      }
      if (phase == CheckoutPhase.completed) {
        _event('payment_completed');
        _event('receipt_created');
        _runPostCommit(result);
      } else if (phase == CheckoutPhase.paymentUnknown) {
        _event('payment_unknown');
      }
    } on AppException catch (error) {
      if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
        debugPrint(
          '[umipos] checkout submit failed category=${error.category.name} '
          'code=${error.code} fallback=${_canFallbackOffline(error)}',
        );
      }
      if (error.code == 'IDEMPOTENCY_CONFLICT') {
        await recover(
          merchantId: _merchantId!,
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          cartId: _cartId!,
          cartVersion: _cartVersion!,
        );
        if (_state.phase == CheckoutPhase.completed ||
            _state.phase == CheckoutPhase.paymentUnknown) {
          return;
        }
        _commitCommandId = _uuid();
        _commitIdempotencyKey = _uuid();
        if (retryIdempotencyConflict) {
          await _submit(fingerprint, retryIdempotencyConflict: false);
          return;
        }
        final priorResult = _state.result;
        _set(
          CheckoutState(
            phase: CheckoutPhase.failure,
            result: priorResult,
            errorCode: error.code,
            failureDetails: error.details,
          ),
        );
        return;
      }
      if (_canFallbackOffline(error)) {
        _connectivity?.networkDown();
        if (fingerprint == null && _cart != null) {
          final confirmation = _localConfirmation(_cart!);
          _confirmationCache['${_cart!.id}:${_cart!.version}'] = confirmation;
          _set(
            CheckoutState(
              phase: CheckoutPhase.confirmationRequired,
              result: confirmation,
            ),
          );
          return;
        }
        if (fingerprint != null) {
          await _submitOffline(fingerprint);
          return;
        }
      }
      _failure(error);
    } catch (error) {
      _unexpected(error);
    }
  }

  CheckoutResult _localConfirmation(Cart cart) {
    final taxes = <String, Object?>{
      'total': cart.totals['tax'],
      'entries': const <Map<String, Object?>>[],
    };
    final fingerprint = sha256
        .convert(
          utf8.encode(
            jsonEncode({
              'cartVersion': cart.version,
              'items': cart.items,
              'totals': cart.totals,
              'taxes': taxes,
            }),
          ),
        )
        .toString();
    final now = DateTime.now().toUtc().toIso8601String();
    return CheckoutResult(
      status: 'confirmation_required',
      confirmation: TotalsConfirmation(
        cartVersion: cart.version,
        fingerprint: fingerprint,
        totals: cart.totals,
        taxes: taxes,
        discounts:
            cart.totals['discounts'] as Map<String, Object?>? ??
            const {'total': {}, 'entries': <Map<String, Object?>>[]},
        catalogVersion: fingerprint,
        pricingVersion: fingerprint,
        taxVersion: fingerprint,
        snapshotAt: now,
        confirmedAt: now,
      ).toJson(),
      payment: null,
      reservation: null,
      sale: null,
      receipt: null,
      failure: null,
      recoveryState: 'none',
    );
  }

  bool _canFallbackOffline(AppException error) =>
      _offlineCheckout != null &&
      _cart != null &&
      _authority != null &&
      (error.category == AppErrorCategory.transport ||
          error.category == AppErrorCategory.timeout ||
          error.category == AppErrorCategory.server ||
          error.category == AppErrorCategory.unknown);

  /// The offline evidence is strong enough to skip the round trip.
  ///
  /// Only [PosConnectivity.offline] qualifies: it takes three consecutive failed
  /// calls (or the OS saying there is no interface), so it is a fact about the
  /// API rather than a guess. `degraded` and `unknown` still try the network —
  /// committing locally on a single hiccup would journal sales that the server
  /// could have taken immediately.
  bool _shouldCommitLocally() =>
      (_connectivity?.state == PosConnectivity.offline ||
          (localFirstFastPathEnabled &&
              _worthTryingOnline &&
              _cashShiftId != null &&
              _isSimpleCashTender)) &&
      _offlineCheckout != null &&
      _cart != null &&
      _authority != null;

  bool get _localFastCheckout =>
      localFirstFastPathEnabled &&
      _offlineCheckout != null &&
      _isSimpleCashTender;

  bool get _isSimpleCashTender =>
      _paymentMethod == 'cash' &&
      _tenderDrafts.length == 1 &&
      _tenderDrafts.single['type'] == 'cash' &&
      _customerValueSelection == null &&
      _tipDraft == null &&
      _discountDrafts.isEmpty &&
      _approvalIds.isEmpty;

  void _runPostCommit(CheckoutResult result) {
    final callback = _afterCommit;
    if (callback == null) return;
    unawaited(() async {
      try {
        final warning = await callback(result);
        if (warning == null || _state.phase != CheckoutPhase.completed) {
          return;
        }
        // The sale is done; this is a fact about the drawer the operator is
        // standing in front of. It rides the state the receipt screen reads,
        // so it appears where the cashier is rather than in a log.
        final current = _state;
        _set(
          CheckoutState(
            phase: current.phase,
            result: current.result,
            errorCode: current.errorCode,
            provisionalReceipt: current.provisionalReceipt,
            failureDetails: current.failureDetails,
            postCommitWarning: warning,
          ),
        );
      } catch (_) {
        _event('hardware_recovery_required');
      }
    }());
  }

  Future<bool> _submitOffline(
    String fingerprint, {
    bool fallbackOnline = false,
  }) async {
    final offlineCheckout = _offlineCheckout;
    final cart = _cart;
    final authority = _authority;
    final raw = _state.result?.confirmation;
    if (offlineCheckout == null ||
        cart == null ||
        authority == null ||
        raw == null) {
      return false;
    }
    final unsupportedTender =
        _tenderDrafts.length != 1 ||
        _tenderDrafts.any((tender) => tender['type'] != 'cash');
    if (unsupportedTender ||
        _customerValueSelection != null ||
        _tipDraft != null ||
        _discountDrafts.isNotEmpty ||
        _cashShiftId == null) {
      if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
        debugPrint(
          '[umipos] offline checkout unsupported tender=$unsupportedTender '
          'customer=${_customerValueSelection != null} '
          'tip=${_tipDraft != null} discounts=${_discountDrafts.length} '
          'shift=${_cashShiftId != null}',
        );
      }
      if (!fallbackOnline) {
        _set(
          CheckoutState(
            phase: CheckoutPhase.failure,
            result: _state.result,
            errorCode: 'OFFLINE_ADVANCED_TENDER_BLOCKED',
          ),
        );
      }
      return false;
    }
    final totals = TotalsConfirmation.fromJson(raw);
    final grandTotal = totals.totals['grandTotal']! as Map<String, Object?>;
    final amount = (grandTotal['minorUnits']! as num).toInt();
    final snapshotAt = DateTime.parse(
      totals.confirmedAt ?? cart.updatedAt,
    ).toUtc();
    final preserved = await _preserveLocalCommands?.call() ?? true;
    if (!preserved) {
      _set(
        CheckoutState(
          phase: CheckoutPhase.failure,
          result: _state.result,
          errorCode: 'OFFLINE_SYNC_PENDING',
        ),
      );
      return true;
    }
    _set(CheckoutState(phase: CheckoutPhase.processing, result: _state.result));
    try {
      final commandId = _uuid();
      final receipt = await offlineCheckout.checkout(
        OfflineCheckoutRequest(
          commandId: commandId,
          idempotencyKey: _uuid(),
          provisionalSaleId: _uuid(),
          authority: authority,
          checkoutCommand: CheckoutCommand(
            commandId: commandId,
            cartId: cart.id,
            locationId: cart.locationId,
            operatorSessionId: cart.operatorSessionId,
            expectedCartVersion: cart.version,
            paymentMethod: 'cash',
            totalsFingerprint: fingerprint,
            idempotencyKey: _uuid(),
            // The contract types this as a UUID, and the online path always
            // sends one even when no customer value is being redeemed. Leaving
            // it null here made every offline cash sale fail contract
            // validation on replay — the sale reached the journal, showed a
            // receipt, and could never land.
            customerValueFingerprintCommandId:
                _customerValueFingerprintCommandId ??= _uuid(),
            tenderDrafts: _tenderDrafts,
            tipDraft: _tipDraft,
            discountDrafts: _discountDrafts,
            approvalIds: const [],
            receiptDelivery: _receiptDelivery,
            cashShiftId: _cashShiftId,
            customerValue: null,
          ),
          cart: cart,
          totals: totals,
          catalogVersion: totals.catalogVersion,
          pricingVersion: totals.pricingVersion,
          taxVersion: totals.taxVersion,
          catalogSnapshotAt: snapshotAt,
          pricingSnapshotAt: snapshotAt,
          taxSnapshotAt: snapshotAt,
          amountReceivedMinorUnits: _cashReceivedMinorUnits ?? amount,
          businessDate: TotalsPreview.fromJson(totals.totals).businessDate,
          locationName: _locationName,
          operatorName: _operatorName,
        ),
        facts: OfflineCheckoutFacts(
          amountMinorUnits: amount,
          catalogSnapshotAt: snapshotAt,
          pricingSnapshotAt: snapshotAt,
          taxSnapshotAt: snapshotAt,
          connectivity: _connectivity?.state ?? PosConnectivity.unknown,
          paymentMethod: _paymentMethod,
          localCommitWhileOnline:
              localFirstFastPathEnabled && _worthTryingOnline,
        ),
        now: DateTime.now().toUtc(),
      );
      _set(
        CheckoutState(
          phase: CheckoutPhase.provisional,
          result: _state.result,
          provisionalReceipt: receipt,
        ),
      );
      _event('offline_checkout_journaled');
      final recovery = _recovery;
      if (recovery != null) {
        unawaited(
          recovery.recover(
            ReplayScope(
              deviceId: authority.deviceId,
              merchantId: authority.merchantId,
              locationId: authority.locationId,
              operatorSessionId: authority.operatorSessionId,
              credentialVersion: authority.credentialVersion,
            ),
          ),
        );
      }
      final callback = _afterOfflineCommit;
      if (callback != null) {
        unawaited(
          callback(receipt).catchError((Object _) {
            _event('offline_hardware_recovery_required');
          }),
        );
      }
      return true;
    } on OfflineJournalException catch (error) {
      if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
        debugPrint('[umipos] offline checkout blocked=${error.category}');
      }
      if (fallbackOnline && error.category != 'cash_received_insufficient') {
        _event('offline_checkout_fallback_online');
        return false;
      }
      _set(
        CheckoutState(
          phase: CheckoutPhase.failure,
          result: _state.result,
          errorCode: error.category,
        ),
      );
      return false;
    }
  }

  void _failure(AppException error) {
    if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
      debugPrint(
        '[umipos] checkout failure category=${error.category.name} '
        'code=${error.code}',
      );
    }
    _event('checkout_failed');
    _set(
      CheckoutState(
        phase: CheckoutPhase.failure,
        result: _state.result,
        errorCode: error.code,
        failureDetails: error.details,
      ),
    );
  }

  /// A failure the protocol did not describe.
  ///
  /// Every money-path method here catches [AppException] — the typed error the
  /// API client builds from a refusal it understands. Anything else (a raw
  /// transport error, a body that does not parse, a bug in this file) used to
  /// escape the method entirely: no state was written, so the phase stayed at
  /// `repricing`/`processing` and the sheet showed a spinner FOR EVER with no
  /// error, no close and no retry. Observed live: the till sat on "Procesando
  /// pago" for minutes, past the point where the API answered again, and the
  /// only way out was killing the app. An unexpected failure is still a failure
  /// the operator has to see, and the failure surface is where a cashier gets
  /// told what happened and is offered the exit.
  void _unexpected(Object error) {
    if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
      debugPrint('[umipos] checkout unexpected error=$error');
    }
    _event('checkout_failed');
    _set(
      CheckoutState(
        phase: CheckoutPhase.failure,
        result: _state.result,
        errorCode: 'UNEXPECTED_CHECKOUT_FAILURE',
        failureDetails: {'cause': error.toString()},
      ),
    );
  }

  /// Retry the charge on a shift the till just recovered (resumed or reclaimed
  /// from the failure surface). Nothing happens without a *new* shift id, so this
  /// can never re-send the same broken payload that produced the failure.
  Future<void> retryWithCashShift(String? cashShiftId) async {
    if (cashShiftId == null || cashShiftId == _cashShiftId) return;
    _cashShiftId = cashShiftId;
    final fingerprint = _state.result?.confirmation['fingerprint'] as String?;
    if (fingerprint == null) return;
    _set(CheckoutState(phase: CheckoutPhase.processing, result: _state.result));
    await _submit(fingerprint);
  }

  void _event(String name) =>
      _telemetry.event(ClientEvent(name: name, values: const {}));

  /// Whether the charge should be ATTEMPTED over the network.
  ///
  /// One rule, read by both the preview and the confirm, because the two used to
  /// decide separately and drifted: the preview was fixed to tolerate an
  /// unproven connection and the confirm was not, so a card tender reached the
  /// offline path while previewing online and was refused there as an
  /// "advanced tender" — no request, no failure handler, a generic message and a
  /// Retry that re-sent nothing.
  ///
  /// The states that do NOT reach here are the ones that mean something:
  /// `offline` (three consecutive failures), `blocked`, `replaying` and
  /// `reconciliationRequired` (the till is mid-recovery and must not take money
  /// it cannot confirm). `unknown` and `recovering` mean the connection is
  /// unproven or back, and **`degraded` means one or two recent failures** — a
  /// blip, not an outage. Refusing a sale on a blip is what left a till with a
  /// working API unable to charge until something else happened to promote it
  /// again, and only the catalog's bootstrap and the replay engine ever call
  /// `apiReachable`, so nothing necessarily would. A request that really cannot
  /// reach the API fails on its own and marks the failure.
  bool get _worthTryingOnline {
    if (_pendingLocalCommands?.call() == true) return false;
    final connectivity = _connectivity?.state ?? PosConnectivity.online;
    return switch (connectivity) {
      PosConnectivity.offline ||
      PosConnectivity.blocked ||
      PosConnectivity.replaying ||
      PosConnectivity.reconciliationRequired => false,
      PosConnectivity.online ||
      PosConnectivity.unknown ||
      PosConnectivity.recovering ||
      PosConnectivity.degraded => true,
    };
  }

  void _set(CheckoutState value) {
    _state = value;
    notifyListeners();
  }

  /// Follow the provisional sale until the journal says it landed.
  ///
  /// The receipt on screen used to say "pending synchronisation" for the rest
  /// of the shift, because nothing told it otherwise: replay happens in another
  /// controller, and the surface is a snapshot of the state at commit time. The
  /// operator is left holding a slip that may already be an official sale — the
  /// exact kind of doubt that makes staff re-check work they have already done.
  Future<void> _recoveryChanged() async {
    final recovery = _recovery;
    final journal = _journal;
    if (recovery == null || journal == null) return;
    if (_state.phase != CheckoutPhase.provisional) return;
    final phase = recovery.status.phase;
    if (phase != RecoveryPhase.completed &&
        phase != RecoveryPhase.readyToReplay) {
      return;
    }
    final provisionalId = _state.provisionalReceipt?.provisionalSaleId;
    if (provisionalId == null) return;
    try {
      final snapshot = await journal.load();
      final entry = snapshot.entries
          .where(
            (candidate) =>
                candidate.command.provisionalId == provisionalId &&
                (candidate.status == JournalStatus.accepted ||
                    candidate.status == JournalStatus.duplicate),
          )
          .toList();
      if (entry.isEmpty) return;
      final officialId = entry.first.officialId;
      if (officialId == null) return;
      if (_state.phase != CheckoutPhase.provisional) return;
      _set(
        CheckoutState(
          phase: CheckoutPhase.provisionalSynced,
          result: _state.result,
          provisionalReceipt: _state.provisionalReceipt,
          officialSaleId: officialId,
        ),
      );
    } catch (_) {
      // An unreadable journal is the recovery centre's to report.
    }
  }

  @override
  void dispose() {
    _recovery?.removeListener(_recoveryChanged);
    super.dispose();
  }

  /// Ask what this location may offer, before anything is charged.
  ///
  /// The tender screen draws its payment-method tiles from the policy, and the
  /// policy used to arrive only on the CHECKOUT response — the call that takes
  /// the money. Because the first press of `Cobrar` is a one-tap sale when the
  /// server reprices to the same total, the tiles were unreachable: a card
  /// terminal could exist in the router, the engine and the policy and still
  /// never be selectable from the screen. This is a READ, safe to repeat, and a
  /// failure leaves the screen exactly as it was — cash only — rather than
  /// blocking a sale that a cashier is standing in front of a customer to take.
  Future<void> loadPolicy({
    required String merchantId,
    required String locationId,
    required String operatorSessionId,
    required String currency,
  }) async {
    try {
      _policy = await _repository.policy(
        merchantId,
        PosCheckoutPolicyQuery(
          locationId: locationId,
          operatorSessionId: operatorSessionId,
          currency: currency,
        ),
      );
      if (_worthTryingOnline) {
        try {
          await _refreshOfflinePolicy?.call();
        } catch (_) {
          // The server checkout policy is already usable. A failed refresh
          // leaves the last signed offline policy in place.
        }
      }
      notifyListeners();
    } catch (_) {
      // Cash only, exactly as a location with no policy is. The charge itself
      // still decides, so this never invents a permission.
    }
    // Which card terminal this location may offer, asked in the same breath as
    // the policy and for the same reason: a method tile that fails AFTER the
    // customer decided is worse than no tile. Same doctrine as the policy read —
    // this is a READ, a failure leaves the screen exactly as it was (cash only)
    // and it never blocks a sale.
    await _loadCardTerminalProvider(
      merchantId: merchantId,
      locationId: locationId,
      operatorSessionId: operatorSessionId,
    );
  }

  /// The provider the card tile is drawn from: the FIRST provider the server
  /// says is an available card-present terminal. The slug is never hardcoded —
  /// today it is `mercado_pago_point`, tomorrow it is whatever the list holds.
  Future<void> _loadCardTerminalProvider({
    required String merchantId,
    required String locationId,
    required String operatorSessionId,
  }) async {
    final repository = _terminalRepository;
    if (repository == null) return;
    try {
      final list = await repository.tenderProviders(
        merchantId,
        TenderProviderQuery(
          locationId: locationId,
          operatorSessionId: operatorSessionId,
        ),
      );
      String? id;
      for (final raw in list.providers) {
        final provider = TenderProviderOption.fromJson(raw);
        if (provider.family == 'card_present' && provider.available) {
          id = provider.id;
          break;
        }
      }
      _cardTerminalProviderId = id;
      notifyListeners();
    } catch (_) {
      // Cash only, exactly as a read that found nothing. The next policy read
      // can find it again.
    }
  }

  /// A card tender, charged on a real terminal.
  ///
  /// [scope] is passed in rather than read from this controller's own fields: a
  /// card is charged BEFORE the checkout runs, so `preview` has not filled them
  /// in yet — and the tender routes are about the cart, not about a checkout
  /// attempt that does not exist.
  ///
  /// The attempt is created BEFORE the provider is called (the server's rule),
  /// so a retry with the same `commandIdentity` finds that attempt rather than
  /// asking the terminal a second time. The till does NOT settle this tender:
  /// only the terminal can answer, and the attempt it links is the proof.
  ///
  /// Throws [AppException] when the capture was refused; the surface turns that
  /// into a sentence and leaves the sale open.
  Future<TenderCaptureResult> captureCardTender({
    required TenderScope scope,
    required String tenderId,
    required String commandIdentity,
    required String provider,
    required Map<String, Object?> amount,
  }) async {
    final repository = _terminalRepository;
    if (repository == null) {
      throw const AppException(
        category: AppErrorCategory.unsupported,
        code: 'TERMINAL_TENDER_UNAVAILABLE',
        recoverable: false,
      );
    }
    _event('card_terminal_capture_started');
    return _repository.captureTender(
      scope.merchantId,
      TenderCaptureRequest(
        cartId: scope.cartId,
        tenderId: tenderId,
        locationId: scope.locationId,
        operatorSessionId: scope.operatorSessionId,
        commandIdentity: commandIdentity,
        provider: provider,
        amount: amount,
        idempotencyKey: _uuid(),
      ),
    );
  }

  /// What became of the attempt keyed by [commandIdentity].
  ///
  /// `refresh: true` is the till's delivery path today: the realtime nudge
  /// reaches the merchant's dashboard room and the native till has no device
  /// socket, so polling this read IS how the till learns the terminal answered
  /// (plan §10.4 item 2, Phase 3 step 3). One vendor call per poll, so it is
  /// asked on a schedule and never in a loop.
  Future<TenderAttemptResult> tenderAttempt(
    TenderScope scope,
    String commandIdentity, {
    bool refresh = true,
  }) async {
    final repository = _terminalRepository;
    if (repository == null) {
      throw const AppException(
        category: AppErrorCategory.unsupported,
        code: 'TERMINAL_TENDER_UNAVAILABLE',
        recoverable: false,
      );
    }
    return repository.tenderAttempt(
      scope.merchantId,
      commandIdentity,
      TenderAttemptQuery(
        locationId: scope.locationId,
        operatorSessionId: scope.operatorSessionId,
        refresh: refresh,
      ),
    );
  }

  /// The tender routes, when this build's repository speaks them.
  TerminalTenderRepository? get _terminalRepository {
    final Object repository = _repository;
    return repository is TerminalTenderRepository ? repository : null;
  }

  String _uuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }
}
