import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/features/entry/entry_controller.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';

import 'support/fakes.dart';

final class _OfflineGateway implements EntryGateway {
  @override
  Future<DeviceSummary> deviceStatus() async => throw const AppException(
    category: AppErrorCategory.server,
    code: 'UPSTREAM_UNAVAILABLE',
    recoverable: true,
  );

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

void main() {
  test('offline reopen keeps a valid operator session past the PIN window', () async {
    final storage = MemorySecureStorage();
    final vault = CredentialVault(storage);
    final now = DateTime.now().toUtc();
    const merchantId = 'merchant';
    const locationId = 'location';
    const deviceId = 'device';
    await vault.saveDevice(
      id: deviceId,
      publicId: 'public',
      credential: 'credential',
      credentialVersion: 1,
      state: 'active',
      merchantId: merchantId,
      locationId: locationId,
    );
    await vault.saveTokens('access', 'refresh');
    storage.values['session.activity_at'] = now
        .subtract(const Duration(minutes: 30))
        .toIso8601String();

    final device = DeviceSummary(
      id: deviceId,
      publicId: 'public',
      merchantId: merchantId,
      locationId: locationId,
      displayName: 'Caja iMin',
      type: 'pos_terminal',
      platform: 'android',
      mobility: 'static',
      state: 'active',
      credentialVersion: 1,
      lastSeenAt: now.toIso8601String(),
      rotationRequired: false,
      revokedAt: null,
      replacementDeviceId: null,
    );
    final tenant = EntryMerchant.fromJson({
      'id': merchantId,
      'name': 'ONCA',
      'roles': <Object?>[],
      'permissions': <Object?>[],
      'entitlements': <Object?>[],
      'locations': [
        {
          'id': locationId,
          'merchantId': merchantId,
          'name': 'Local',
          'status': 'active',
          'deviceAllowed': true,
          'operatorAllowed': true,
        },
      ],
    });
    final branch = LocationAccess.fromJson({
      'id': locationId,
      'merchantId': merchantId,
      'name': 'Local',
      'status': 'active',
      'deviceAllowed': true,
      'operatorAllowed': true,
    });
    final operator = OperatorSessionView.fromJson({
      'id': 'operator',
      'userId': 'user',
      'staffId': 'staff',
      'merchantId': merchantId,
      'locationId': locationId,
      'deviceId': deviceId,
      'state': 'active',
      'permissions': ['cart.write', 'order.fire'],
      'entitlements': <Object?>[],
      'startedAt': now.subtract(const Duration(hours: 1)).toIso8601String(),
      'lastActivityAt': now.toIso8601String(),
      'expiresAt': now.add(const Duration(hours: 7)).toIso8601String(),
    });
    await vault.saveEntrySnapshot({
      'device': device.toJson(),
      'tenant': tenant.toJson(),
      'branch': branch.toJson(),
      'operator': operator.toJson(),
      'operatorName': 'Admin ONCA',
      'savedAt': now.toIso8601String(),
    });

    final entry = EntryController(
      gateway: _OfflineGateway(),
      vault: vault,
      telemetry: SafeTelemetry(
        enabled: false,
        context: TelemetryContext.current(testConfig),
        exporter: RecordingExporter(),
      ),
    );

    await entry.initialize();

    expect(entry.state.phase, EntryPhase.ready);
    expect(entry.state.operator?.id, 'operator');
    expect(entry.state.selectedTenant?.id, merchantId);
    expect(entry.state.selectedBranch?.id, locationId);
    entry.dispose();
  });

  test('background revocation replaces a locally admitted till', () async {
    final storage = MemorySecureStorage();
    final vault = CredentialVault(storage);
    final now = DateTime.now().toUtc();
    const deviceId = '00000000-0000-4000-8000-000000000011';
    const merchantId = '00000000-0000-4000-8000-000000000022';
    const locationId = '00000000-0000-4000-8000-000000000033';
    await vault.saveDevice(
      id: deviceId,
      publicId: '00000000-0000-4000-8000-000000000044',
      credential: 'credential',
      credentialVersion: 1,
      state: 'active',
      merchantId: merchantId,
      locationId: locationId,
    );
    await vault.saveTokens('expired-or-offline-access', 'refresh-token');
    storage.values['session.activity_at'] = now.toIso8601String();
    final device = DeviceSummary(
      id: deviceId,
      publicId: '00000000-0000-4000-8000-000000000044',
      merchantId: merchantId,
      locationId: locationId,
      displayName: 'Caja iMin',
      type: 'pos_terminal',
      platform: 'android',
      mobility: 'static',
      state: 'active',
      credentialVersion: 1,
      lastSeenAt: now.toIso8601String(),
      rotationRequired: false,
      revokedAt: null,
      replacementDeviceId: null,
    );
    final tenant = EntryMerchant.fromJson({
      'id': merchantId,
      'name': 'ONCA',
      'roles': ['admin'],
      'permissions': <Object?>[],
      'entitlements': <Object?>[],
      'locations': [
        {
          'id': locationId,
          'merchantId': merchantId,
          'name': 'Local',
          'status': 'active',
          'deviceAllowed': true,
          'operatorAllowed': true,
        },
      ],
    });
    final branch = LocationAccess.fromJson({
      'id': locationId,
      'merchantId': merchantId,
      'name': 'Local',
      'status': 'active',
      'deviceAllowed': true,
      'operatorAllowed': true,
    });
    final operator = OperatorSessionView.fromJson({
      'id': 'operator',
      'userId': 'user',
      'staffId': 'staff',
      'merchantId': merchantId,
      'locationId': locationId,
      'deviceId': deviceId,
      'state': 'active',
      'permissions': ['cart.write', 'order.fire'],
      'entitlements': <Object?>[],
      'startedAt': now.subtract(const Duration(hours: 1)).toIso8601String(),
      'lastActivityAt': now.toIso8601String(),
      'expiresAt': now.add(const Duration(hours: 7)).toIso8601String(),
    });
    await vault.saveEntrySnapshot({
      'device': device.toJson(),
      'tenant': tenant.toJson(),
      'branch': branch.toJson(),
      'operator': operator.toJson(),
      'operatorName': 'Admin ONCA',
      'savedAt': now.toIso8601String(),
    });

    final entry = EntryController(
      gateway: _RevokedGateway(
        deviceId: deviceId,
        merchantId: merchantId,
        locationId: locationId,
      ),
      vault: vault,
      telemetry: SafeTelemetry(
        enabled: false,
        context: TelemetryContext.current(testConfig),
        exporter: RecordingExporter(),
      ),
    );

    await entry.initialize();
    await Future<void>.delayed(const Duration(milliseconds: 20));

    expect(entry.state.phase, EntryPhase.deviceRevoked);
    entry.dispose();
  });
}

final class _RevokedGateway implements EntryGateway {
  _RevokedGateway({
    required this.deviceId,
    required this.merchantId,
    required this.locationId,
  });

  final String deviceId;
  final String merchantId;
  final String locationId;

  @override
  Future<DeviceSummary> deviceStatus() async => DeviceSummary(
    id: deviceId,
    publicId: '00000000-0000-4000-8000-000000000044',
    merchantId: merchantId,
    locationId: locationId,
    displayName: 'Caja iMin',
    type: 'pos_terminal',
    platform: 'android',
    mobility: 'static',
    state: 'revoked',
    credentialVersion: 1,
    lastSeenAt: DateTime.now().toUtc().toIso8601String(),
    rotationRequired: false,
    revokedAt: DateTime.now().toUtc().toIso8601String(),
    replacementDeviceId: null,
  );

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}
