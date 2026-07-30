import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

abstract interface class CheckoutRepository {
  Future<CheckoutResult> checkout(String tenantId, CheckoutCommand command);
  Future<PaymentOutcome> paymentStatus(
    String tenantId,
    String paymentId,
    PaymentStatusQuery query,
  );
  Future<CheckoutRecoverySnapshot> recovery(
    String tenantId,
    String cartId,
    CheckoutRecoveryQuery query,
  );
  Future<CheckoutCancellationResult> cancel(
    String tenantId,
    String cartId,
    CheckoutCancellationRequest request,
  );
}

final class ApiCheckoutRepository implements CheckoutRepository {
  ApiCheckoutRepository(this._api);
  final ApiClient _api;

  @override
  Future<CheckoutResult> checkout(
    String tenantId,
    CheckoutCommand command,
  ) async => CheckoutResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCheckout(tenantId),
      body: command.toJson(),
    ),
  );

  @override
  Future<PaymentOutcome> paymentStatus(
    String tenantId,
    String paymentId,
    PaymentStatusQuery query,
  ) async => PaymentOutcome.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posCheckoutPayment(tenantId, paymentId),
        queryParameters: {
          'branchId': query.branchId,
          'operatorSessionId': query.operatorSessionId,
        },
      ).toString(),
    ),
  );

  @override
  Future<CheckoutRecoverySnapshot> recovery(
    String tenantId,
    String cartId,
    CheckoutRecoveryQuery query,
  ) async => CheckoutRecoverySnapshot.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posCheckoutRecovery(tenantId, cartId),
        queryParameters: {
          'branchId': query.branchId,
          'operatorSessionId': query.operatorSessionId,
        },
      ).toString(),
    ),
  );

  @override
  Future<CheckoutCancellationResult> cancel(
    String tenantId,
    String cartId,
    CheckoutCancellationRequest request,
  ) async => CheckoutCancellationResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCheckoutCancel(tenantId, cartId),
      body: request.toJson(),
      idempotent: true,
    ),
  );
}
