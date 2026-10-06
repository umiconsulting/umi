import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

/// The tender-provider reads — a SECOND interface, on purpose.
///
/// `implements` does not inherit bodies, so a new member on [CheckoutRepository]
/// breaks every fake in the tree that already implements it, including the
/// cash-only fakes in `test/checkout_test.dart`, which are correct as they stand.
/// A repository that speaks no tender routes is therefore simply not a
/// [TerminalTenderRepository], and the till stays on cash — which is where the
/// Phase 3 doctrine says a location with no provider belongs.
abstract interface class TerminalTenderRepository {
  /// Which tender providers this location may offer. A read, made with the
  /// policy and never a gate on a sale.
  Future<TenderProviderList> tenderProviders(
    String merchantId,
    TenderProviderQuery query,
  );

  /// What became of the attempt keyed by [commandIdentity].
  ///
  /// A 404 (`TENDER_ATTEMPT_NOT_FOUND`) is a normal answer meaning "no attempt
  /// exists for this identity", not an error — the callers that need the
  /// distinction catch it themselves.
  Future<TenderAttemptResult> tenderAttempt(
    String merchantId,
    String commandIdentity,
    TenderAttemptQuery query,
  );
}

abstract interface class CheckoutRepository {
  /// What the tender screen may offer, read before anything is charged (§8G).
  Future<CheckoutPolicy> policy(
    String merchantId,
    PosCheckoutPolicyQuery query,
  );

  /// Ask a provider for money. The attempt is created BEFORE the provider is
  /// called, so a retry finds out what happened instead of charging again.
  Future<TenderCaptureResult> captureTender(
    String merchantId,
    TenderCaptureRequest request,
  );

  /// Decide an attempt whose answer only a person has. See `pos.tenderSettle`.
  Future<TenderSettlementResult> settleTender(
    String merchantId,
    String commandIdentity,
    TenderSettlementRequest request,
  );
  Future<CheckoutResult> checkout(String merchantId, CheckoutCommand command);
  Future<PaymentOutcome> paymentStatus(
    String merchantId,
    String paymentId,
    PaymentStatusQuery query,
  );
  Future<CheckoutRecoverySnapshot> recovery(
    String merchantId,
    String cartId,
    CheckoutRecoveryQuery query,
  );
  Future<CheckoutCancellationResult> cancel(
    String merchantId,
    String cartId,
    CheckoutCancellationRequest request,
  );
}

final class ApiCheckoutRepository
    implements CheckoutRepository, TerminalTenderRepository {
  ApiCheckoutRepository(this._api);
  final ApiClient _api;

  @override
  Future<CheckoutPolicy> policy(
    String merchantId,
    PosCheckoutPolicyQuery query,
  ) async => CheckoutPolicy.fromJson(
    (await _api.request(
          method: ApiMethod.get,
          path: Uri(
            path: UmiRoutes.posCheckoutPolicy(merchantId),
            queryParameters: {
              'locationId': query.locationId,
              'operatorSessionId': query.operatorSessionId,
              'currency': query.currency,
            },
          ).toString(),
        ))['data']
        as Map<String, Object?>,
  );

  @override
  Future<TenderCaptureResult> captureTender(
    String merchantId,
    TenderCaptureRequest request,
  ) async => TenderCaptureResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posTenderCapture(merchantId),
      body: request.toJson(),
      // The command identity is the idempotency: a retry finds this attempt.
      idempotent: true,
    ),
  );

  @override
  Future<TenderSettlementResult> settleTender(
    String merchantId,
    String commandIdentity,
    TenderSettlementRequest request,
  ) async => TenderSettlementResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posTenderSettle(merchantId, commandIdentity),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<TenderProviderList> tenderProviders(
    String merchantId,
    TenderProviderQuery query,
  ) async =>
      // The tender routes answer with the MODEL, not with the checkout
      // service's `{ok, data}` envelope — `pos.tenderCapture` is read the same
      // way just below. Reading `['data']` here is what silently emptied this
      // read on the real till: the server answered 200 with the provider list,
      // the cast produced null, the read failed, and the screen stayed on cash
      // with no card tile and nothing in the log to say why.
      TenderProviderList.fromJson(
        await _api.request(
          method: ApiMethod.get,
          path: Uri(
            path: UmiRoutes.posTenderProviders(merchantId),
            queryParameters: {
              'locationId': query.locationId,
              'operatorSessionId': query.operatorSessionId,
            },
          ).toString(),
        ),
      );

  @override
  Future<TenderAttemptResult> tenderAttempt(
    String merchantId,
    String commandIdentity,
    TenderAttemptQuery query,
  ) async =>
      // Same shape as `tenderProviders`: the attempt route answers with the
      // attempt, not inside `data`.
      TenderAttemptResult.fromJson(
        await _api.request(
          method: ApiMethod.get,
          path: Uri(
            path: UmiRoutes.posTenderAttempt(merchantId, commandIdentity),
            queryParameters: {
              'locationId': query.locationId,
              'operatorSessionId': query.operatorSessionId,
              // `refresh: true` makes the server ASK THE TERMINAL (one vendor
              // call), so only the poller sets it; an existence check reads.
              // A query parameter is a STRING: passing the bool through raw
              // makes `Uri` throw before the request is ever sent, which is a
              // poll that dies silently rather than a poll that reads.
              'refresh': (query.refresh ?? false) ? 'true' : 'false',
            },
          ).toString(),
        ),
      );

  @override
  Future<CheckoutResult> checkout(
    String merchantId,
    CheckoutCommand command,
  ) async => CheckoutResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCheckout(merchantId),
      body: command.toJson(),
    ),
  );

  @override
  Future<PaymentOutcome> paymentStatus(
    String merchantId,
    String paymentId,
    PaymentStatusQuery query,
  ) async => PaymentOutcome.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posCheckoutPayment(merchantId, paymentId),
        queryParameters: {
          'locationId': query.locationId,
          'operatorSessionId': query.operatorSessionId,
        },
      ).toString(),
    ),
  );

  @override
  Future<CheckoutRecoverySnapshot> recovery(
    String merchantId,
    String cartId,
    CheckoutRecoveryQuery query,
  ) async => CheckoutRecoverySnapshot.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posCheckoutRecovery(merchantId, cartId),
        queryParameters: {
          'locationId': query.locationId,
          'operatorSessionId': query.operatorSessionId,
        },
      ).toString(),
    ),
  );

  @override
  Future<CheckoutCancellationResult> cancel(
    String merchantId,
    String cartId,
    CheckoutCancellationRequest request,
  ) async => CheckoutCancellationResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCheckoutCancel(merchantId, cartId),
      body: request.toJson(),
      idempotent: true,
    ),
  );
}
