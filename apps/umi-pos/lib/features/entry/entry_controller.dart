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
  EntryState _state = const EntryState(EntryPhase.checkingDevice);
  EntryState get state => _state;
  TrustedEntryStage get navigationStage => switch (_state.phase) {
    EntryPhase.enrollmentRequired ||
    EntryPhase.enrollmentPending => TrustedEntryStage.enrollment,
    EntryPhase.authenticationRequired ||
    EntryPhase.authenticating => TrustedEntryStage.authentication,
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
      _set(const EntryState(EntryPhase.enrollmentRequired));
      return;
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
      _set(EntryState(EntryPhase.authenticationRequired, device: device));
      if (await _vault.refreshToken() != null) {
        await restoreSession();
      }
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

  Future<void> enroll(String challengeId, String code) async {
    _set(const EntryState(EntryPhase.enrollmentPending));
    try {
      final result = await _gateway.completeEnrollment(challengeId, code);
      final device = DeviceSummary.fromJson(result.device);
      await _vault.saveDevice(
        id: device.id,
        publicId: device.publicId,
        credential: result.credential,
        credentialVersion: device.credentialVersion,
        state: device.state,
        tenantId: device.tenantId,
        branchId: device.branchId,
      );
      _event('device.enrollment_completed');
      _set(EntryState(EntryPhase.authenticationRequired, device: device));
    } on AppException catch (error) {
      _event('device.enrollment_failed', error.code);
      _set(EntryState(EntryPhase.enrollmentRequired, errorCode: error.code));
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

  Future<void> restoreSession() async {
    try {
      final response = await _gateway.refresh();
      await _saveSession(response);
      _event('session.renewed');
      await _resolveContext();
    } catch (_) {
      await _vault.clearSession();
      _set(
        EntryState(EntryPhase.authenticationRequired, device: _state.device),
      );
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
    await _gateway.lockOperator(operator.id);
    _event('operator.locked');
    _set(
      EntryState(
        EntryPhase.operatorRequired,
        device: _state.device,
        selectedTenant: _state.selectedTenant,
        selectedBranch: _state.selectedBranch,
      ),
    );
  }

  Future<void> logout() async {
    final operator = _state.operator;
    if (operator != null) await _gateway.endOperator(operator.id);
    await _gateway.logout();
    await _vault.clearSession();
    _event('session.ended');
    _set(EntryState(EntryPhase.authenticationRequired, device: _state.device));
  }

  Future<void> globalLogout() async {
    await _gateway.globalLogout();
    await _vault.clearSession();
    _event('session.global_logout');
    _set(EntryState(EntryPhase.authenticationRequired, device: _state.device));
  }

  Future<void> _saveSession(PosSessionResponse response) async {
    final tokens = PosSessionTokens.fromJson(response.tokens);
    await _vault.saveTokens(tokens.accessToken, tokens.refreshToken);
  }

  Future<void> _resolveContext() async {
    final response = await _gateway.entryContext();
    final tenants = response.tenants.map(EntryTenant.fromJson).toList();
    if (tenants.isEmpty) {
      _set(
        EntryState(
          EntryPhase.tenantRequired,
          tenants: tenants,
          errorCode: 'NO_ACCESS',
        ),
      );
    } else if (tenants.length == 1) {
      _set(EntryState(EntryPhase.tenantRequired, tenants: tenants));
      await selectTenant(tenants.single);
    } else {
      _set(EntryState(EntryPhase.tenantRequired, tenants: tenants));
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
