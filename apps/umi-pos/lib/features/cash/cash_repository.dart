import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

abstract interface class CashRepository {
  Future<CashCenterSnapshot> center(String tenantId, CashCenterQuery query);
  Future<CashCommandRecoveryResult> commandRecovery(
    String tenantId,
    CashCommandRecoveryQuery query,
  );
  Future<OpenCashShiftResult> open(
    String tenantId,
    OpenCashShiftRequest request,
  );
  Future<CashMovement> movement(
    String tenantId,
    String shiftId,
    CashMovementRequest request,
  );
  Future<CashShift> transition(
    String tenantId,
    String shiftId,
    ShiftTransitionRequest request, {
    required bool suspend,
  });
  Future<ShiftHandoff> handoff(
    String tenantId,
    String shiftId,
    ShiftHandoffRequest request,
  );
  Future<CashCountSummary> count(
    String tenantId,
    String shiftId,
    SubmitBlindCountRequest request,
  );
  Future<CashShift> recount(
    String tenantId,
    String shiftId,
    RecountRequest request,
  );
  Future<CashVarianceResolution> resolve(
    String tenantId,
    String shiftId,
    ResolveCashVarianceRequest request,
  );
  Future<ShiftReconciliation> reconcile(
    String tenantId,
    String shiftId,
    ReconcileCashShiftRequest request,
  );
  Future<ShiftCloseResult> close(
    String tenantId,
    String shiftId,
    ShiftCloseRequest request,
  );
  Future<NoSaleDrawerEvent> noSale(
    String tenantId,
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
    String tenantId,
    CashCenterQuery query,
  ) async => CashCenterSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posCashCenter(tenantId),
        queryParameters: {
          'branchId': query.branchId,
          'operatorSessionId': query.operatorSessionId,
        },
      ).toString(),
    ),
  );

  @override
  Future<CashCommandRecoveryResult> commandRecovery(
    String tenantId,
    CashCommandRecoveryQuery query,
  ) async => CashCommandRecoveryResult.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posCashCommand(tenantId, query.commandId),
        queryParameters: {
          'branchId': query.branchId,
          'operatorSessionId': query.operatorSessionId,
          'commandId': query.commandId,
          'idempotencyKey': query.idempotencyKey,
        },
      ).toString(),
    ),
  );

  @override
  Future<OpenCashShiftResult> open(
    String tenantId,
    OpenCashShiftRequest request,
  ) async => OpenCashShiftResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashShifts(tenantId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<CashMovement> movement(
    String tenantId,
    String shiftId,
    CashMovementRequest request,
  ) async => CashMovement.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashMovement(tenantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<CashShift> transition(
    String tenantId,
    String shiftId,
    ShiftTransitionRequest request, {
    required bool suspend,
  }) async => CashShift.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: suspend
          ? UmiRoutes.posCashSuspend(tenantId, shiftId)
          : UmiRoutes.posCashResume(tenantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<ShiftHandoff> handoff(
    String tenantId,
    String shiftId,
    ShiftHandoffRequest request,
  ) async => ShiftHandoff.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashHandoff(tenantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<CashCountSummary> count(
    String tenantId,
    String shiftId,
    SubmitBlindCountRequest request,
  ) async => CashCountSummary.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashCount(tenantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<CashShift> recount(
    String tenantId,
    String shiftId,
    RecountRequest request,
  ) async => CashShift.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashRecount(tenantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<CashVarianceResolution> resolve(
    String tenantId,
    String shiftId,
    ResolveCashVarianceRequest request,
  ) async => CashVarianceResolution.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashVariance(tenantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<ShiftReconciliation> reconcile(
    String tenantId,
    String shiftId,
    ReconcileCashShiftRequest request,
  ) async => ShiftReconciliation.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashReconcile(tenantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<ShiftCloseResult> close(
    String tenantId,
    String shiftId,
    ShiftCloseRequest request,
  ) async => ShiftCloseResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashClose(tenantId, shiftId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<NoSaleDrawerEvent> noSale(
    String tenantId,
    String shiftId,
    NoSaleDrawerRequest request,
  ) async => NoSaleDrawerEvent.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCashNoSale(tenantId, shiftId),
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
