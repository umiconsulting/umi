import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

abstract interface class CheckoutRepository {
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

final class ApiCheckoutRepository implements CheckoutRepository {
  ApiCheckoutRepository(this._api);
  final ApiClient _api;

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
