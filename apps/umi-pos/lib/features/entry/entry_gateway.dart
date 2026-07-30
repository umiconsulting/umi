import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';
import '../../core/security/credential_vault.dart';

abstract interface class EntryGateway {
  Future<DevicePairingSession> claimPairing(String code);
  Future<DevicePairingPollResponse> pollPairing(PairingIdentity pairing);
  Future<void> acknowledgePairing(
    PairingIdentity pairing,
    String deviceCredential,
  );
  Future<DeviceSummary> deviceStatus();
  Future<PosSessionResponse> login(String username, String password);
  Future<PosSessionResponse> pinLogin({
    required String pin,
    required String tenantId,
    required String branchId,
  });
  Future<PosSessionResponse> refresh();
  Future<void> logout();
  Future<void> globalLogout();
  Future<EntryContextResponse> entryContext();
  Future<OperatorSessionView> startOperator(String tenantId, String branchId);
  Future<void> lockOperator(String id);
  Future<void> endOperator(String id);
  Future<ElevationGrantView> verifyPin({
    required String pin,
    required String permission,
    required String tenantId,
    required String branchId,
  });
  Future<ElevationGrantView> requestManagerApproval({
    required String operatorSessionId,
    required String managerPin,
    required String permission,
    required String tenantId,
    required String branchId,
    String? commandFingerprint,
  });
}

final class ApiEntryGateway implements EntryGateway {
  ApiEntryGateway(this._api, this._vault);
  final ApiClient _api;
  final CredentialVault _vault;

  @override
  Future<DevicePairingSession> claimPairing(String code) async {
    final identity = await _vault.deviceIdentity();
    final setupCode = code.replaceAll(RegExp('[^A-Za-z0-9]'), '').toUpperCase();
    return DevicePairingSession.fromJson(
      await _api.request(
        method: ApiMethod.post,
        path: UmiRoutes.devicePairingClaim,
        body: ClaimDevicePairingRequest(
          setupCode: setupCode,
          installationId: identity.installationId,
          platform: kIsWeb ? 'web' : defaultTargetPlatform.name,
          deviceType: 'pos_terminal',
        ).toJson(),
      ),
    );
  }

  @override
  Future<DevicePairingPollResponse> pollPairing(PairingIdentity pairing) async {
    final identity = await _vault.deviceIdentity();
    return DevicePairingPollResponse.fromJson(
      await _api.request(
        method: ApiMethod.post,
        path: UmiRoutes.devicePairingPoll(pairing.sessionId),
        body: PollDevicePairingRequest(
          pollingCredential: pairing.pollingCredential,
          installationId: identity.installationId,
        ).toJson(),
        idempotent: true,
      ),
    );
  }

  @override
  Future<void> acknowledgePairing(
    PairingIdentity pairing,
    String deviceCredential,
  ) async {
    final identity = await _vault.deviceIdentity();
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.devicePairingAcknowledge(pairing.sessionId),
      body: AcknowledgeDeviceCredentialRequest(
        pollingCredential: pairing.pollingCredential,
        installationId: identity.installationId,
        deviceCredential: deviceCredential,
      ).toJson(),
      idempotent: true,
    );
  }

  @override
  Future<DeviceSummary> deviceStatus() async => DeviceSummary.fromJson(
    await _api.request(method: ApiMethod.get, path: UmiRoutes.deviceStatus),
  );

  @override
  Future<PosSessionResponse> login(String username, String password) async {
    final identity = await _vault.deviceIdentity();
    return PosSessionResponse.fromJson(
      await _api.request(
        method: ApiMethod.post,
        path: UmiRoutes.posLogin,
        body: PosLoginRequest(
          username: username,
          password: password,
          remember: true,
          installationId: identity.installationId,
        ).toJson(),
      ),
    );
  }

  @override
  Future<PosSessionResponse> pinLogin({
    required String pin,
    required String tenantId,
    required String branchId,
  }) async {
    final identity = await _vault.deviceIdentity();
    return PosSessionResponse.fromJson(
      await _api.request(
        method: ApiMethod.post,
        path: UmiRoutes.posPinLogin,
        body: PosPinLoginRequest(
          pin: pin,
          tenantId: tenantId,
          branchId: branchId,
          installationId: identity.installationId,
        ).toJson(),
      ),
    );
  }

  @override
  Future<PosSessionResponse> refresh() async {
    final refresh = await _vault.refreshToken();
    final identity = await _vault.deviceIdentity();
    if (refresh == null) throw StateError('refresh token unavailable');
    return PosSessionResponse.fromJson(
      await _api.request(
        method: ApiMethod.post,
        path: UmiRoutes.posRefresh,
        body: PosRefreshRequest(
          refreshToken: refresh,
          installationId: identity.installationId,
        ).toJson(),
      ),
    );
  }

  @override
  Future<void> logout() async {
    final refresh = await _vault.refreshToken();
    final identity = await _vault.deviceIdentity();
    if (refresh == null) return;
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posLogout,
      body: PosRefreshRequest(
        refreshToken: refresh,
        installationId: identity.installationId,
      ).toJson(),
      idempotent: true,
    );
  }

  @override
  Future<void> globalLogout() async {
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.globalLogout,
      body: const GlobalLogoutRequest(exceptCurrent: false).toJson(),
      idempotent: true,
    );
  }

  @override
  Future<EntryContextResponse> entryContext() async =>
      EntryContextResponse.fromJson(
        await _api.request(
          method: ApiMethod.get,
          path: UmiRoutes.posEntryContext,
        ),
      );

  @override
  Future<OperatorSessionView> startOperator(
    String tenantId,
    String branchId,
  ) async => OperatorSessionView.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.operatorSessions,
      body: StartOperatorSessionRequest(
        tenantId: tenantId,
        branchId: branchId,
      ).toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<void> lockOperator(String id) async {
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.operatorLock(id),
      idempotent: true,
    );
  }

  @override
  Future<void> endOperator(String id) async {
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.operatorEnd(id),
      idempotent: true,
    );
  }

  @override
  Future<ElevationGrantView> verifyPin({
    required String pin,
    required String permission,
    required String tenantId,
    required String branchId,
  }) async => ElevationGrantView.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.operatorPin,
      body: VerifyOperatorPinRequest(
        pin: pin,
        permission: permission,
        tenantId: tenantId,
        branchId: branchId,
      ).toJson(),
    ),
  );

  @override
  Future<ElevationGrantView> requestManagerApproval({
    required String operatorSessionId,
    required String managerPin,
    required String permission,
    required String tenantId,
    required String branchId,
    String? commandFingerprint,
  }) async => ElevationGrantView.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.managerApproval,
      body: ManagerApprovalRequest(
        operatorSessionId: operatorSessionId,
        managerPin: managerPin,
        permission: permission,
        tenantId: tenantId,
        branchId: branchId,
        commandFingerprint: commandFingerprint,
      ).toJson(),
    ),
  );
}
