import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/observability/telemetry.dart';
import '../offline/connectivity_controller.dart';
import '../offline/offline_checkout_service.dart';
import '../offline/offline_journal.dart';
import '../offline/offline_policy.dart';
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
  failure,
}

final class CheckoutState {
  const CheckoutState({
    this.phase = CheckoutPhase.idle,
    this.result,
    this.errorCode,
    this.provisionalReceipt,
    this.failureDetails,
  });
  final CheckoutPhase phase;
  final CheckoutResult? result;
  final String? errorCode;
  final ProvisionalReceipt? provisionalReceipt;

  /// The facts a typed refusal carried (`ApiError.details`), so the failure
  /// surface can offer the recovery action the code names instead of a bare
  /// retry that re-sends the same payload.
  final Map<String, Object?>? failureDetails;

  /// The register hold the refusal resolved, when the failure was a missing cash
  /// shift: `free | held_by_this_device | held_by_active_till |
  /// held_by_orphaned_till`.
  String? get holdState => failureDetails?['holdState'] as String?;
}

final class CheckoutController extends ChangeNotifier {
  CheckoutController({
    required CheckoutRepository repository,
    OfflineCheckoutService? offlineCheckout,
    ConnectivityController? connectivity,
    required Telemetry telemetry,
    Future<void> Function(CheckoutResult result)? afterCommit,
    Future<void> Function(ProvisionalReceipt receipt)? afterOfflineCommit,
  }) : _repository = repository,
       _offlineCheckout = offlineCheckout,
       _connectivity = connectivity,
       _telemetry = telemetry,
       _afterCommit = afterCommit,
       _afterOfflineCommit = afterOfflineCommit;

  final CheckoutRepository _repository;
  final OfflineCheckoutService? _offlineCheckout;
  final ConnectivityController? _connectivity;
  final Telemetry _telemetry;
  final Future<void> Function(CheckoutResult result)? _afterCommit;
  final Future<void> Function(ProvisionalReceipt receipt)? _afterOfflineCommit;
  CheckoutState _state = const CheckoutState();
  CheckoutState get state => _state;
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
    _set(const CheckoutState(phase: CheckoutPhase.repricing));
    _event('checkout_opened');
    if (!_worthTryingOnline) {
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
      if (cached == null) {
        _set(
          const CheckoutState(
            phase: CheckoutPhase.failure,
            errorCode: 'OFFLINE_SNAPSHOT_REFRESH_REQUIRED',
          ),
        );
        return;
      }
      _set(
        CheckoutState(
          phase: CheckoutPhase.confirmationRequired,
          result: cached,
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
      final terminalFailure = await _captureTerminalTenders();
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

  Future<void> confirm() async {
    final fingerprint = _state.result?.confirmation['fingerprint'] as String?;
    if (fingerprint == null) return;
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
        (carried is Map<String, Object?> ? carried['method'] as String? : null) ??
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

  Future<void> _submit(String? fingerprint) async {
    if (_merchantId == null ||
        _locationId == null ||
        _operatorSessionId == null ||
        _cartId == null ||
        _cartVersion == null) {
      return;
    }
    try {
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
          customerValue: _customerValueSelection?.toJson(),
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
      _failure(error);
    } catch (error) {
      _unexpected(error);
    }
  }

  void _runPostCommit(CheckoutResult result) {
    final callback = _afterCommit;
    if (callback == null) return;
    unawaited(
      callback(result).catchError((Object _) {
        _event('hardware_recovery_required');
      }),
    );
  }

  Future<void> _submitOffline(String fingerprint) async {
    final offlineCheckout = _offlineCheckout;
    final cart = _cart;
    final authority = _authority;
    final raw = _state.result?.confirmation;
    if (offlineCheckout == null ||
        cart == null ||
        authority == null ||
        raw == null) {
      return;
    }
    final unsupportedTender =
        _tenderDrafts.length != 1 ||
        _tenderDrafts.any((tender) => tender['type'] != 'cash');
    if (unsupportedTender ||
        _customerValueSelection != null ||
        _tipDraft != null ||
        _discountDrafts.isNotEmpty ||
        _cashShiftId == null) {
      _set(
        CheckoutState(
          phase: CheckoutPhase.failure,
          result: _state.result,
          errorCode: 'OFFLINE_ADVANCED_TENDER_BLOCKED',
        ),
      );
      return;
    }
    final totals = TotalsConfirmation.fromJson(raw);
    final grandTotal = totals.totals['grandTotal']! as Map<String, Object?>;
    final amount = (grandTotal['minorUnits']! as num).toInt();
    final snapshotAt = DateTime.parse(
      totals.confirmedAt ?? cart.updatedAt,
    ).toUtc();
    _set(CheckoutState(phase: CheckoutPhase.processing, result: _state.result));
    try {
      final commandId = _uuid();
      final receipt = await offlineCheckout.checkout(
        OfflineCheckoutRequest(
          commandId: commandId,
          idempotencyKey: _uuid(),
          provisionalSaleId: 'prov-$commandId',
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
      final callback = _afterOfflineCommit;
      if (callback != null) {
        unawaited(
          callback(receipt).catchError((Object _) {
            _event('offline_hardware_recovery_required');
          }),
        );
      }
    } on OfflineJournalException catch (error) {
      _set(
        CheckoutState(
          phase: CheckoutPhase.failure,
          result: _state.result,
          errorCode: error.category,
        ),
      );
    }
  }

  void _failure(AppException error) {
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
