import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

abstract interface class SaleExceptionRepository {
  Future<SaleExceptionEligibility> eligibility(
    String merchantId,
    String saleId,
    SaleExceptionEligibilityQuery query,
  );
  Future<RefundPreview> preview(
    String merchantId,
    String saleId,
    RefundPreviewRequest request,
  );
  Future<RefundApprovalResult> approve(
    String merchantId,
    String saleId,
    RefundApprovalRequest request,
  );
  Future<ManualTerminalRefundOutcomeResult> terminalOutcome(
    String merchantId,
    String saleId,
    String previewId,
    ManualTerminalRefundOutcomeRequest request,
  );
  Future<SaleExceptionResult> commit(
    String merchantId,
    String saleId,
    SaleExceptionCommand command,
  );
  Future<ExceptionHistory> history(
    String merchantId,
    String saleId,
    SaleExceptionEligibilityQuery query,
  );
  Future<ExceptionCommandRecoveryResult> recover(
    String merchantId,
    ExceptionCommandRecoveryQuery query,
  );
}

final class ApiSaleExceptionRepository implements SaleExceptionRepository {
  const ApiSaleExceptionRepository(this._api);
  final ApiClient _api;

  String _query(String path, String locationId, String operatorSessionId) =>
      Uri(
        path: path,
        queryParameters: {
          'locationId': locationId,
          'operatorSessionId': operatorSessionId,
        },
      ).toString();

  @override
  Future<SaleExceptionEligibility> eligibility(
    String merchantId,
    String saleId,
    SaleExceptionEligibilityQuery query,
  ) async => SaleExceptionEligibility.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: _query(
        UmiRoutes.posExceptionEligibility(merchantId, saleId),
        query.locationId,
        query.operatorSessionId,
      ),
    ),
  );

  @override
  Future<RefundPreview> preview(
    String merchantId,
    String saleId,
    RefundPreviewRequest request,
  ) async => RefundPreview.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posExceptionPreview(merchantId, saleId),
      body: request.toJson(),
    ),
  );

  @override
  Future<RefundApprovalResult> approve(
    String merchantId,
    String saleId,
    RefundApprovalRequest request,
  ) async => RefundApprovalResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posExceptionApproval(merchantId, saleId),
      body: request.toJson(),
    ),
  );

  @override
  Future<ManualTerminalRefundOutcomeResult> terminalOutcome(
    String merchantId,
    String saleId,
    String previewId,
    ManualTerminalRefundOutcomeRequest request,
  ) async => ManualTerminalRefundOutcomeResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posExceptionTerminalOutcome(
        merchantId,
        saleId,
        previewId,
      ),
      body: request.toJson(),
    ),
  );

  @override
  Future<SaleExceptionResult> commit(
    String merchantId,
    String saleId,
    SaleExceptionCommand command,
  ) async => SaleExceptionResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posExceptionCommit(merchantId, saleId),
      body: command.toJson(),
    ),
  );

  @override
  Future<ExceptionHistory> history(
    String merchantId,
    String saleId,
    SaleExceptionEligibilityQuery query,
  ) async => ExceptionHistory.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: _query(
        UmiRoutes.posExceptionHistory(merchantId, saleId),
        query.locationId,
        query.operatorSessionId,
      ),
    ),
  );

  @override
  Future<ExceptionCommandRecoveryResult> recover(
    String merchantId,
    ExceptionCommandRecoveryQuery query,
  ) async => ExceptionCommandRecoveryResult.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posExceptionCommand(merchantId, query.commandId),
        queryParameters: {
          'locationId': query.locationId,
          'operatorSessionId': query.operatorSessionId,
          'commandId': query.commandId,
          'idempotencyKey': query.idempotencyKey,
        },
      ).toString(),
    ),
  );
}
