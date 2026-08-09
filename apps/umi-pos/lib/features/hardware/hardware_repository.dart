import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

abstract interface class HardwareRepository {
  Future<HardwareDevice> register(
    String merchantId,
    RegisterHardwareRequest request,
  );
  Future<HardwareDevice> update(
    String merchantId,
    String hardwareId,
    UpdateHardwareRequest request,
  );
  Future<HardwareDevice> assign(
    String merchantId,
    String hardwareId,
    AssignHardwareRequest request,
  );
  Future<HardwareRuntimeSnapshot> snapshot(
    String merchantId,
    HardwareRegistryQuery query,
  );
  Future<HardwareCommandResult> createCommand(
    String merchantId,
    HardwareCommandRequest command,
  );
  Future<HardwareCommandResult> transition(
    String merchantId,
    String commandId,
    HardwareCommandTransitionRequest transition,
  );
  Future<HardwareDiagnosticResult> diagnostic(
    String merchantId,
    HardwareDiagnosticRequest request,
  );
  Future<ControlledReprintResult> controlledReprint(
    String merchantId,
    String jobId,
    ControlledReprintRequest request,
  );
}

final class ApiHardwareRepository implements HardwareRepository {
  const ApiHardwareRepository(this._api);
  final ApiClient _api;

  @override
  Future<HardwareRuntimeSnapshot> snapshot(
    String merchantId,
    HardwareRegistryQuery query,
  ) async => HardwareRuntimeSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posHardwareRuntime(merchantId),
        queryParameters: {
          'locationId': query.locationId,
          'operatorSessionId': query.operatorSessionId,
          if (query.registerId != null) 'registerId': query.registerId!,
          'includeDisabled': '${query.includeDisabled ?? false}',
        },
      ).toString(),
    ),
  );

  @override
  Future<HardwareCommandResult> createCommand(
    String merchantId,
    HardwareCommandRequest command,
  ) async => HardwareCommandResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posHardwareCommand(merchantId),
      body: command.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<HardwareCommandResult> transition(
    String merchantId,
    String commandId,
    HardwareCommandTransitionRequest transition,
  ) async => HardwareCommandResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posHardwareCommandTransition(merchantId, commandId),
      body: transition.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<HardwareDiagnosticResult> diagnostic(
    String merchantId,
    HardwareDiagnosticRequest request,
  ) async => HardwareDiagnosticResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posHardwareDiagnostic(merchantId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<ControlledReprintResult> controlledReprint(
    String merchantId,
    String jobId,
    ControlledReprintRequest request,
  ) async => ControlledReprintResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posHardwareReprint(merchantId, jobId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<HardwareDevice> register(
    String merchantId,
    RegisterHardwareRequest request,
  ) async => HardwareDevice.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posHardwareRegister(merchantId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<HardwareDevice> update(
    String merchantId,
    String hardwareId,
    UpdateHardwareRequest request,
  ) async => HardwareDevice.fromJson(
    await _api.request(
      method: ApiMethod.patch,
      path: UmiRoutes.posHardwareUpdate(merchantId, hardwareId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<HardwareDevice> assign(
    String merchantId,
    String hardwareId,
    AssignHardwareRequest request,
  ) async => HardwareDevice.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posHardwareAssign(merchantId, hardwareId),
      body: request.toJson(),
      idempotent: true,
    ),
  );
}
