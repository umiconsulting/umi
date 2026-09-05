import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

abstract interface class CashRepository {
  Future<CashCenterSnapshot> center(String merchantId, CashCenterQuery query);
  Future<CashCommandRecoveryResult> commandRecovery(
    String merchantId,
    CashCommandRecoveryQuery query,
  );
  Future<OpenCashShiftResult> open(
    String merchantId,
    OpenCashShiftRequest request,
  );
  Future<CashMovement> movement(
    String merchantId,
    String shiftId,
    CashMovementRequest request,
  );
  Future<CashShift> transition(
    String merchantId,
    String shiftId,
    ShiftTransitionRequest request, {
    required bool suspend,
  });
  Future<ShiftHandoff> handoff(
    String merchantId,
    String shiftId,
    ShiftHandoffRequest request,
  );
  Future<AdoptCashShiftResult> adopt(
    String merchantId,
    String shiftId,
    AdoptCashShiftRequest request,
  );
  Future<CashCountSummary> count(
    String merchantId,
    String shiftId,
    SubmitBlindCountRequest request,
  );
  Future<CashShift> recount(
    String merchantId,
    String shiftId,
    RecountRequest request,
  );
  Future<CashVarianceResolution> resolve(
    String merchantId,
    String shiftId,
    ResolveCashVarianceRequest request,
  );
  Future<ShiftReconciliation> reconcile(
    String merchantId,
    String shiftId,
    ReconcileCashShiftRequest request,
  );
  Future<ShiftCloseResult> close(
    String merchantId,
    String shiftId,
    ShiftCloseRequest request,
  );
  Future<NoSaleDrawerEvent> noSale(
    String merchantId,
    String shiftId,
    NoSaleDrawerRequest request,
  );
  Future<ElevationGrantView> approve(ManagerApprovalRequest request);
}

final class ApiCashRepository implements CashRepository {
  ApiCashRepository(this._api);
  final ApiClient _api;

  @override
  Future<CashCenterSnapshot> center(
    String merchantId,
    CashCenterQuery query,
  ) async => CashCenterSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posCashCenter(merchantId),
        queryParameters: {
          'locationId': query.locationId,
          'operatorSessionId': query.operatorSessionId,
        },
      ).toString(),
    ),
  );

  @override
  Future<CashCommandRecoveryResult> commandRecovery(
    String merchantId,
    CashCommandRecoveryQuery query,
  ) async => CashCommandRecoveryResult.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posCashCommand(merchantId, query.commandId),
        queryParameters: {
          'locationId': query.locationId,
          'operatorSessionId': query.operatorSessionId,
          'commandId': query.commandId,
          'idempotencyKey': query.idempotencyKey,
        },
      ).toString(),
    ),
  );

  @override
  Future<OpenCashShiftResult> open(
    String merchantId,
    OpenCashShiftRequest request,
  ) async => OpenCashShiftResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashShifts(merchantId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<CashMovement> movement(
    String merchantId,
    String shiftId,
    CashMovementRequest request,
  ) async => CashMovement.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashMovement(merchantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<CashShift> transition(
    String merchantId,
    String shiftId,
    ShiftTransitionRequest request, {
    required bool suspend,
  }) async => CashShift.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: suspend
          ? UmiRoutes.posCashSuspend(merchantId, shiftId)
          : UmiRoutes.posCashResume(merchantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<AdoptCashShiftResult> adopt(
    String merchantId,
    String shiftId,
    AdoptCashShiftRequest request,
  ) async => AdoptCashShiftResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashAdopt(merchantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<ShiftHandoff> handoff(
    String merchantId,
    String shiftId,
    ShiftHandoffRequest request,
  ) async => ShiftHandoff.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashHandoff(merchantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<CashCountSummary> count(
    String merchantId,
    String shiftId,
    SubmitBlindCountRequest request,
  ) async => CashCountSummary.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashCount(merchantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<CashShift> recount(
    String merchantId,
    String shiftId,
    RecountRequest request,
  ) async => CashShift.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashRecount(merchantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<CashVarianceResolution> resolve(
    String merchantId,
    String shiftId,
    ResolveCashVarianceRequest request,
  ) async => CashVarianceResolution.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashVariance(merchantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<ShiftReconciliation> reconcile(
    String merchantId,
    String shiftId,
    ReconcileCashShiftRequest request,
  ) async => ShiftReconciliation.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashReconcile(merchantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<ShiftCloseResult> close(
    String merchantId,
    String shiftId,
    ShiftCloseRequest request,
  ) async => ShiftCloseResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashClose(merchantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<NoSaleDrawerEvent> noSale(
    String merchantId,
    String shiftId,
    NoSaleDrawerRequest request,
  ) async => NoSaleDrawerEvent.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashNoSale(merchantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<ElevationGrantView> approve(ManagerApprovalRequest request) async =>
      ElevationGrantView.fromJson(
        await _api.request(
          method: ApiMethod.post,
          path: UmiRoutes.managerApproval,
          body: request.toJson(),
        ),
      );
}
