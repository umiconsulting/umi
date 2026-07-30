import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/navigation/app_navigation.dart';
import '../../core/observability/telemetry.dart';
import '../../core/security/credential_vault.dart';
import 'entry_gateway.dart';

enum EntryPhase {
  checkingDevice,
  enrollmentRequired,
  enrollmentPending,
  pinRequired,
  pinAuthenticating,
  authenticationRequired,
  authenticating,
  tenantRequired,
  branchRequired,
  operatorRequired,
  ready,
  deviceRevoked,
  rotationRequired,
  recoverableFailure,
  storageFailure,
}

final class EntryState {
  const EntryState(
    this.phase, {
    this.device,
    this.tenants = const [],
    this.selectedTenant,
    this.selectedBranch,
    this.operator,
    this.errorCode,
  });
  final EntryPhase phase;
  final DeviceSummary? device;
  final List<EntryTenant> tenants;
  final EntryTenant? selectedTenant;
  final BranchAccess? selectedBranch;
  final OperatorSessionView? operator;
  final String? errorCode;
}

final class EntryController extends ChangeNotifier {
  EntryController({
    required EntryGateway gateway,
    required CredentialVault vault,
    required Telemetry telemetry,
  }) : _gateway = gateway,
       _vault = vault,
       _telemetry = telemetry;

  final EntryGateway _gateway;
  final CredentialVault _vault;
  final Telemetry _telemetry;
  int _pairingGeneration = 0;
  EntryState _state = const EntryState(EntryPhase.checkingDevice);
  EntryState get state => _state;
  TrustedEntryStage get navigationStage => switch (_state.phase) {
    EntryPhase.enrollmentRequired ||
    EntryPhase.enrollmentPending => TrustedEntryStage.enrollment,
    EntryPhase.authenticationRequired ||
    EntryPhase.authenticating ||
    EntryPhase.pinRequired ||
    EntryPhase.pinAuthenticating => TrustedEntryStage.authentication,
    EntryPhase.tenantRequired => TrustedEntryStage.tenant,
    EntryPhase.branchRequired => TrustedEntryStage.branch,
    EntryPhase.operatorRequired => TrustedEntryStage.operator,
    EntryPhase.ready => TrustedEntryStage.ready,
    EntryPhase.checkingDevice => TrustedEntryStage.authentication,
    _ => TrustedEntryStage.blocked,
  };

  Future<void> initialize() async {
    _set(const EntryState(EntryPhase.checkingDevice));
    final identity = await _vault.deviceIdentity();
    if (!identity.isEnrolled) {
      final pairing = await _vault.pairingIdentity();
      if (pairing != null && pairing.expiresAt.isAfter(DateTime.now())) {
        _set(const EntryState(EntryPhase.enrollmentPending));
        final generation = ++_pairingGeneration;
        unawaited(_pollPairing(pairing, generation));
        return;
      }
      if (pairing != null) await _vault.clearPairing();
      _set(const EntryState(EntryPhase.enrollmentRequired));
      return;
    }
    final pendingAcknowledgement = await _vault.pairingIdentity();
    if (pendingAcknowledgement != null && identity.credential != null) {
      try {
        await _gateway.acknowledgePairing(
          pendingAcknowledgement,
          identity.credential!,
        );
        await _vault.clearPairing();
      } catch (_) {
        // Device authentication remains safe. The next bootstrap retries this
        // acknowledgement with the same persisted pairing session.
      }
    }
    try {
      final device = await _gateway.deviceStatus();
      if (device.state == 'revoked' || device.state == 'replaced') {
        await _vault.clearDeviceTrust();
        _set(EntryState(EntryPhase.deviceRevoked, device: device));
        return;
      }
      if (device.rotationRequired) {
        _set(EntryState(EntryPhase.rotationRequired, device: device));
        return;
      }
      // A durable server session can survive an application restart. The POS
      // still requires a personal PIN before it restores operator access.
      if (await _vault.refreshToken() != null) {
        try {
          await _gateway.logout();
        } catch (_) {
          // Local access still fails closed. Server expiry and device
          // revocation remain authoritative when logout cannot reach the API.
        }
      }
      await _vault.clearSession();
      _set(EntryState(EntryPhase.pinRequired, device: device));
    } on AppException catch (error) {
      if (error.code == 'DEVICE_REVOKED' ||
          error.code == 'DEVICE_CREDENTIAL_INVALID') {
        await _vault.clearDeviceTrust();
        _set(EntryState(EntryPhase.deviceRevoked, errorCode: error.code));
      } else {
        _set(EntryState(EntryPhase.recoverableFailure, errorCode: error.code));
      }
    }
  }

  Future<void> enroll(String code) async {
    _set(const EntryState(EntryPhase.enrollmentPending));
    try {
      final result = await _gateway.claimPairing(code);
      await _vault.savePairing(
        sessionId: result.pairingSessionId,
        pollingCredential: result.pollingCredential,
        expiresAt: result.expiresAt,
      );
      _event('device.enrollment_claimed');
      final pairing = await _vault.pairingIdentity();
      if (pairing == null) throw StateError('pairing persistence failed');
      final generation = ++_pairingGeneration;
      unawaited(_pollPairing(pairing, generation));
    } on AppException catch (error) {
      _event('device.enrollment_failed', error.code);
      _set(EntryState(EntryPhase.enrollmentRequired, errorCode: error.code));
    }
  }

  Future<void> cancelPairing() async {
    _pairingGeneration++;
    await _vault.clearPairing();
    _set(const EntryState(EntryPhase.enrollmentRequired));
  }

  Future<void> retryPairing() async {
    final pairing = await _vault.pairingIdentity();
    if (pairing == null) {
      _set(const EntryState(EntryPhase.enrollmentRequired));
      return;
    }
    _set(const EntryState(EntryPhase.enrollmentPending));
    final generation = ++_pairingGeneration;
    unawaited(_pollPairing(pairing, generation));
  }

  Future<void> _pollPairing(PairingIdentity pairing, int generation) async {
    while (generation == _pairingGeneration &&
        pairing.expiresAt.isAfter(DateTime.now())) {
      try {
        final response = await _gateway.pollPairing(pairing);
        if (generation != _pairingGeneration) return;
        if (response.state == 'awaiting_approval') {
          _set(const EntryState(EntryPhase.enrollmentPending));
          await Future<void>.delayed(
            Duration(seconds: response.pollAfterSeconds),
          );
          continue;
        }
        if (response.state == 'denied' ||
            response.state == 'expired' ||
            response.state == 'cancelled') {
          await _vault.clearPairing();
          _set(
            EntryState(
              EntryPhase.enrollmentRequired,
              errorCode: response.state == 'denied'
                  ? 'ENROLLMENT_REJECTED'
                  : 'ENROLLMENT_EXPIRED',
            ),
          );
          return;
        }
        if (response.device != null && response.credential != null) {
          final device = DeviceSummary.fromJson(response.device!);
          await _vault.saveDevice(
            id: device.id,
            publicId: device.publicId,
            credential: response.credential!,
            credentialVersion: device.credentialVersion,
            state: device.state,
            tenantId: device.tenantId,
            branchId: device.branchId,
          );
          try {
            await _gateway.acknowledgePairing(pairing, response.credential!);
            await _vault.clearPairing();
          } catch (_) {
            // Keep the pairing session. Bootstrap retries the same
            // acknowledgement without issuing a second credential.
          }
          _event('device.enrollment_completed');
          _set(EntryState(EntryPhase.pinRequired, device: device));
          return;
        }
        await Future<void>.delayed(
          Duration(seconds: response.pollAfterSeconds),
        );
      } on AppException catch (error) {
        if (error.code == 'ENROLLMENT_REJECTED') {
          await _vault.clearPairing();
          _set(
            EntryState(EntryPhase.enrollmentRequired, errorCode: error.code),
          );
          return;
        }
        _set(EntryState(EntryPhase.enrollmentPending, errorCode: error.code));
        await Future<void>.delayed(const Duration(seconds: 3));
      }
    }
    if (generation == _pairingGeneration) {
      await _vault.clearPairing();
      _set(
        const EntryState(
          EntryPhase.enrollmentRequired,
          errorCode: 'ENROLLMENT_EXPIRED',
        ),
      );
    }
  }

  Future<void> login(String username, String password) async {
    _set(EntryState(EntryPhase.authenticating, device: _state.device));
    try {
      final response = await _gateway.login(username, password);
      await _saveSession(response);
      _event('authentication.succeeded');
      await _resolveContext();
    } on AppException catch (error) {
      _event('authentication.failed', error.code);
      _set(
        EntryState(
          EntryPhase.authenticationRequired,
          device: _state.device,
          errorCode: error.code,
        ),
      );
    }
  }

  Future<void> loginWithPin(String pin) async {
    final device = _state.device;
    final tenantId = device?.tenantId;
    final branchId = device?.branchId;
    if (tenantId == null || branchId == null) {
      _set(
        EntryState(
          EntryPhase.pinRequired,
          device: device,
          errorCode: 'BRANCH_NOT_FOUND',
        ),
      );
      return;
    }
    _set(EntryState(EntryPhase.pinAuthenticating, device: device));
    try {
      final response = await _gateway.pinLogin(
        pin: pin,
        tenantId: tenantId,
        branchId: branchId,
      );
      await _saveSession(response);
      _event('authentication.pin_succeeded');
      await _resolveContext();
      if (_state.phase == EntryPhase.operatorRequired) {
        await startOperator();
      }
    } on AppException catch (error) {
      _event('authentication.pin_failed', error.code);
      _set(
        EntryState(
          EntryPhase.pinRequired,
          device: device,
          errorCode: error.code,
        ),
      );
    }
  }

  Future<void> restoreSession() async {
    try {
      final response = await _gateway.refresh();
      await _saveSession(response);
      _event('session.renewed');
      await _resolveContext();
    } catch (_) {
      await _vault.clearSession();
      _set(EntryState(EntryPhase.pinRequired, device: _state.device));
    }
  }

  Future<void> selectTenant(EntryTenant tenant) async {
    await _vault.selectTenant(tenant.id);
    _event('tenant.selected');
    final branches = tenant.branches
        .map(BranchAccess.fromJson)
        .where((b) => b.deviceAllowed && b.operatorAllowed)
        .toList();
    if (branches.length == 1) {
      await selectBranch(tenant, branches.single);
    } else {
      _set(
        EntryState(
          EntryPhase.branchRequired,
          device: _state.device,
          tenants: _state.tenants,
          selectedTenant: tenant,
        ),
      );
    }
  }

  Future<void> selectBranch(EntryTenant tenant, BranchAccess branch) async {
    if (branch.tenantId != tenant.id ||
        branch.status != 'active' ||
        !branch.deviceAllowed ||
        !branch.operatorAllowed) {
      _set(
        EntryState(EntryPhase.branchRequired, errorCode: 'BRANCH_NOT_FOUND'),
      );
      return;
    }
    await _vault.selectBranch(branch.id);
    _event('branch.selected');
    _set(
      EntryState(
        EntryPhase.operatorRequired,
        device: _state.device,
        tenants: _state.tenants,
        selectedTenant: tenant,
        selectedBranch: branch,
      ),
    );
  }

  Future<void> startOperator() async {
    final tenant = _state.selectedTenant;
    final branch = _state.selectedBranch;
    if (tenant == null || branch == null) return;
    try {
      final operator = await _gateway.startOperator(tenant.id, branch.id);
      await _vault.saveOperatorSession(operator.id);
      _event('operator.started');
      _set(
        EntryState(
          EntryPhase.ready,
          device: _state.device,
          tenants: _state.tenants,
          selectedTenant: tenant,
          selectedBranch: branch,
          operator: operator,
        ),
      );
    } on AppException catch (error) {
      _set(EntryState(EntryPhase.operatorRequired, errorCode: error.code));
    }
  }

  Future<void> lock() async {
    final operator = _state.operator;
    if (operator == null) return;
    try {
      await _gateway.lockOperator(operator.id);
    } on AppException catch (error) {
      _event('operator.lock_sync_failed', error.code);
    } catch (_) {
      _event('operator.lock_sync_failed', 'UNEXPECTED_FAILURE');
    }
    try {
      await _gateway.logout();
    } catch (_) {
      // The local lock remains authoritative for the presentation state.
      // Server session expiry and the next PIN authentication fail closed.
    }
    await _vault.clearSession();
    _event('operator.locked');
    _set(EntryState(EntryPhase.pinRequired, device: _state.device));
  }

  Future<void> reselectBranch() async {
    final operator = _state.operator;
    if (operator != null) await _gateway.endOperator(operator.id);
    final tenant = _state.selectedTenant;
    if (tenant == null) {
      await _vault.clearSession();
      _set(EntryState(EntryPhase.pinRequired, device: _state.device));
      return;
    }
    await _vault.selectTenant(tenant.id);
    _event('branch.reselection_requested');
    _set(
      EntryState(
        EntryPhase.branchRequired,
        device: _state.device,
        tenants: _state.tenants,
        selectedTenant: tenant,
      ),
    );
  }

  Future<bool> requestRecoveryManagerReview(String managerPin) async {
    final operator = _state.operator;
    final tenant = _state.selectedTenant;
    final branch = _state.selectedBranch;
    if (operator == null || tenant == null || branch == null) return false;
    try {
      await _gateway.requestManagerApproval(
        operatorSessionId: operator.id,
        managerPin: managerPin,
        permission: 'offline.recovery.review',
        tenantId: tenant.id,
        branchId: branch.id,
      );
      _event('offline.recovery.manager_review_granted');
      return true;
    } on AppException catch (error) {
      _event('offline.recovery.manager_review_denied', error.code);
      return false;
    }
  }

  Future<String?> requestCheckoutApproval({
    required String managerPin,
    required String permission,
    required String commandFingerprint,
  }) async {
    final operator = _state.operator;
    final tenant = _state.selectedTenant;
    final branch = _state.selectedBranch;
    if (operator == null || tenant == null || branch == null) return null;
    try {
      final grant = await _gateway.requestManagerApproval(
        operatorSessionId: operator.id,
        managerPin: managerPin,
        permission: permission,
        tenantId: tenant.id,
        branchId: branch.id,
        commandFingerprint: commandFingerprint,
      );
      _event('checkout.approval_granted');
      return grant.elevationId;
    } on AppException catch (error) {
      _event('checkout.approval_denied', error.code);
      return null;
    }
  }

  Future<void> logout() async {
    final operator = _state.operator;
    if (operator != null) await _gateway.endOperator(operator.id);
    await _gateway.logout();
    await _vault.clearSession();
    _event('session.ended');
    _set(EntryState(EntryPhase.pinRequired, device: _state.device));
  }

  Future<void> globalLogout() async {
    await _gateway.globalLogout();
    await _vault.clearSession();
    _event('session.global_logout');
    _set(EntryState(EntryPhase.pinRequired, device: _state.device));
  }

  Future<void> _saveSession(PosSessionResponse response) async {
    final tokens = PosSessionTokens.fromJson(response.tokens);
    await _vault.saveTokens(tokens.accessToken, tokens.refreshToken);
  }

  Future<void> _resolveContext() async {
    final device = _state.device;
    final response = await _gateway.entryContext();
    final tenants = response.tenants.map(EntryTenant.fromJson).toList();
    if (tenants.isEmpty) {
      _set(
        EntryState(
          EntryPhase.tenantRequired,
          device: device,
          tenants: tenants,
          errorCode: 'NO_ACCESS',
        ),
      );
    } else if (tenants.length == 1) {
      _set(
        EntryState(EntryPhase.tenantRequired, device: device, tenants: tenants),
      );
      await selectTenant(tenants.single);
    } else {
      _set(
        EntryState(EntryPhase.tenantRequired, device: device, tenants: tenants),
      );
    }
  }

  void _event(String name, [String? reason]) {
    _telemetry.event(
      ClientEvent(
        name: name,
        values: reason == null ? const {} : {'reason': reason},
      ),
    );
  }

  void _set(EntryState next) {
    _state = next;
    notifyListeners();
  }
}
