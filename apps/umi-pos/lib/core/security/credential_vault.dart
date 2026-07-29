import 'dart:math';

import '../network/api_client.dart';
import '../storage/storage.dart';

final class DeviceIdentity {
  const DeviceIdentity({
    required this.installationId,
    this.deviceId,
    this.publicId,
    this.credential,
    this.credentialVersion,
    this.tenantId,
    this.branchId,
    this.state,
  });
  final String installationId;
  final String? deviceId;
  final String? publicId;
  final String? credential;
  final int? credentialVersion;
  final String? tenantId;
  final String? branchId;
  final String? state;
  bool get isEnrolled =>
      deviceId != null && publicId != null && credential != null;
}

final class PairingIdentity {
  const PairingIdentity({
    required this.sessionId,
    required this.pollingCredential,
    required this.expiresAt,
  });
  final String sessionId;
  final String pollingCredential;
  final DateTime expiresAt;
}

final class CredentialVault
    implements AccessTokenProvider, DeviceCredentialProvider {
  CredentialVault(this._storage);
  final SecureKeyValueStorage _storage;

  static const _installation = 'device.installation_id';
  static const _deviceId = 'device.id';
  static const _publicId = 'device.public_id';
  static const _credential = 'device.credential';
  static const _credentialVersion = 'device.credential_version';
  static const _deviceTenant = 'device.tenant_id';
  static const _deviceBranch = 'device.branch_id';
  static const _tenant = 'context.tenant_id';
  static const _branch = 'context.branch_id';
  static const _deviceState = 'device.state';
  static const _access = 'session.access_token';
  static const _refresh = 'session.refresh_token';
  static const _operator = 'operator.session_id';
  static const _pairingSession = 'device.pairing_session_id';
  static const _pollingCredential = 'device.polling_credential';
  static const _pairingExpires = 'device.pairing_expires_at';

  Future<DeviceIdentity> deviceIdentity() async {
    var installationId = await _storage.read(_installation);
    if (installationId == null) {
      installationId = _uuid();
      await _storage.write(_installation, installationId);
    }
    final deviceId = await _storage.read(_deviceId);
    final publicId = await _storage.read(_publicId);
    final credential = await _storage.read(_credential);
    var tenantId = await _storage.read(_deviceTenant);
    var branchId = await _storage.read(_deviceBranch);
    if (deviceId != null && publicId != null && credential != null) {
      tenantId ??= await _storage.read(_tenant);
      branchId ??= await _storage.read(_branch);
      if (tenantId != null) await _storage.write(_deviceTenant, tenantId);
      if (branchId != null) await _storage.write(_deviceBranch, branchId);
    }
    return DeviceIdentity(
      installationId: installationId,
      deviceId: deviceId,
      publicId: publicId,
      credential: credential,
      credentialVersion: int.tryParse(
        await _storage.read(_credentialVersion) ?? '',
      ),
      tenantId: tenantId,
      branchId: branchId,
      state: await _storage.read(_deviceState),
    );
  }

  Future<void> saveDevice({
    required String id,
    required String publicId,
    required String credential,
    required int credentialVersion,
    required String state,
    String? tenantId,
    String? branchId,
  }) async {
    await _storage.write(_deviceId, id);
    await _storage.write(_publicId, publicId);
    await _storage.write(_credential, credential);
    await _storage.write(_credentialVersion, '$credentialVersion');
    await _storage.write(_deviceState, state);
    if (tenantId != null) {
      await _storage.write(_deviceTenant, tenantId);
      await _storage.write(_tenant, tenantId);
    }
    if (branchId != null) {
      await _storage.write(_deviceBranch, branchId);
      await _storage.write(_branch, branchId);
    }
  }

  Future<void> saveTokens(String accessToken, String refreshToken) async {
    await _storage.write(_access, accessToken);
    await _storage.write(_refresh, refreshToken);
  }

  Future<PairingIdentity?> pairingIdentity() async {
    final sessionId = await _storage.read(_pairingSession);
    final pollingCredential = await _storage.read(_pollingCredential);
    final expiresAt = DateTime.tryParse(
      await _storage.read(_pairingExpires) ?? '',
    );
    if (sessionId == null || pollingCredential == null || expiresAt == null) {
      return null;
    }
    return PairingIdentity(
      sessionId: sessionId,
      pollingCredential: pollingCredential,
      expiresAt: expiresAt,
    );
  }

  Future<void> savePairing({
    required String sessionId,
    required String pollingCredential,
    required String expiresAt,
  }) async {
    await _storage.write(_pairingSession, sessionId);
    await _storage.write(_pollingCredential, pollingCredential);
    await _storage.write(_pairingExpires, expiresAt);
  }

  Future<void> clearPairing() async {
    for (final key in [_pairingSession, _pollingCredential, _pairingExpires]) {
      await _storage.delete(key);
    }
  }

  Future<String?> refreshToken() => _storage.read(_refresh);
  Future<void> saveOperatorSession(String id) => _storage.write(_operator, id);

  Future<void> selectTenant(String tenantId) async {
    await _storage.write(_tenant, tenantId);
    await _storage.delete(_branch);
    await _storage.delete(_operator);
  }

  Future<void> selectBranch(String branchId) async {
    await _storage.write(_branch, branchId);
    await _storage.delete(_operator);
  }

  Future<void> clearSession() async {
    for (final key in [_access, _refresh, _tenant, _branch, _operator]) {
      await _storage.delete(key);
    }
  }

  Future<void> clearDeviceTrust() async {
    await clearSession();
    await clearPairing();
    for (final key in [
      _deviceId,
      _publicId,
      _credential,
      _credentialVersion,
      _deviceTenant,
      _deviceBranch,
      _deviceState,
    ]) {
      await _storage.delete(key);
    }
  }

  @override
  Future<String?> accessToken() => _storage.read(_access);

  @override
  Future<Map<String, String>> deviceHeaders() async {
    final identity = await deviceIdentity();
    if (!identity.isEnrolled) return {};
    return {
      'x-umi-device-id': identity.deviceId!,
      'x-umi-device-public-id': identity.publicId!,
      'x-umi-device-credential': identity.credential!,
      'x-umi-installation-id': identity.installationId,
    };
  }

  String _uuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes.map((v) => v.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }
}
