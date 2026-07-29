import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/features/entry/entry_controller.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';
import 'package:umi_pos/features/entry/entry_surface.dart';

import 'support/fakes.dart';

const _installationId = '00000000-0000-4000-8000-000000000001';
const _sessionId = '00000000-0000-4000-8000-000000000002';
const _deviceId = '00000000-0000-4000-8000-000000000003';
const _publicId = '00000000-0000-4000-8000-000000000004';
const _tenantId = '00000000-0000-4000-8000-000000000005';
const _branchId = '00000000-0000-4000-8000-000000000006';
const _secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

void main() {
  test(
    'pairing credentials persist in secure storage and clear safely',
    () async {
      final storage = MemorySecureStorage();
      final vault = CredentialVault(storage);
      storage.values['device.installation_id'] = _installationId;

      await vault.savePairing(
        sessionId: _sessionId,
        pollingCredential: _secret,
        expiresAt: DateTime.now()
            .add(const Duration(minutes: 5))
            .toIso8601String(),
      );

      final restored = await vault.pairingIdentity();
      expect(restored?.sessionId, _sessionId);
      expect(restored?.pollingCredential, _secret);

      await vault.clearPairing();
      expect(await vault.pairingIdentity(), isNull);
    },
  );

  test(
    'approved pairing stores one credential and acknowledges delivery',
    () async {
      final storage = MemorySecureStorage();
      storage.values['device.installation_id'] = _installationId;
      final vault = CredentialVault(storage);
      final gateway = _PairingGateway();
      final controller = _controller(gateway, vault);

      await controller.enroll('ABCDEFGH');
      await Future<void>.delayed(const Duration(milliseconds: 20));

      expect(controller.state.phase, EntryPhase.pinRequired);
      expect((await vault.deviceIdentity()).credential, _secret);
      expect(gateway.claimedCode, 'ABCDEFGH');
      expect(gateway.acknowledgements, 1);
      expect(await vault.pairingIdentity(), isNull);
    },
  );

  test('bootstrap resumes a persisted pairing session after restart', () async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    await vault.savePairing(
      sessionId: _sessionId,
      pollingCredential: _secret,
      expiresAt: DateTime.now()
          .add(const Duration(minutes: 5))
          .toIso8601String(),
    );
    final gateway = _PairingGateway();
    final controller = _controller(gateway, vault);

    await controller.initialize();
    await Future<void>.delayed(const Duration(milliseconds: 20));

    expect(controller.state.phase, EntryPhase.pinRequired);
    expect((await vault.deviceIdentity()).publicId, _publicId);
    expect(gateway.polls, 1);
  });

  testWidgets('enrollment asks for one setup code and no challenge id', (
    tester,
  ) async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    final controller = _controller(_PairingGateway(), vault);
    await controller.initialize();

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: EntrySurface(controller: controller),
      ),
    );

    expect(find.byType(TextField), findsOneWidget);
    expect(find.text('Challenge ID'), findsNothing);
    expect(find.text('Enrollment code'), findsOneWidget);
  });

  testWidgets('a four-digit operator PIN is not sent as a setup code', (
    tester,
  ) async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    final gateway = _PairingGateway();
    final controller = _controller(gateway, vault);
    await controller.initialize();

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: EntrySurface(controller: controller),
      ),
    );

    await tester.enterText(find.byType(TextField), '2468');
    await tester.tap(find.text('Continue'));
    await tester.pump();

    expect(gateway.claimedCode, isNull);
    expect(controller.state.phase, EntryPhase.enrollmentRequired);
  });

  testWidgets('a rejected setup code shows an inline field error', (
    tester,
  ) async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    final gateway = _PairingGateway()..failClaim = true;
    final controller = _controller(gateway, vault);
    await controller.initialize();

    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('es'),
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: ListenableBuilder(
          listenable: controller,
          builder: (context, _) => EntrySurface(controller: controller),
        ),
      ),
    );

    await tester.enterText(find.byType(TextField), 'BADCODE1');
    await tester.tap(find.text('Continuar'));
    await tester.pumpAndSettle();

    expect(controller.state.phase, EntryPhase.enrollmentRequired);
    expect(
      find.text(
        'El código de registro no es válido o caducó. Solicita un código nuevo al administrador.',
      ),
      findsOneWidget,
    );
    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.decoration?.errorText, isNotNull);
  });

  testWidgets('trusted device uses the personal PIN and loads cashier access', (
    tester,
  ) async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    await vault.saveDevice(
      id: _deviceId,
      publicId: _publicId,
      credential: _secret,
      credentialVersion: 1,
      state: 'active',
      tenantId: _tenantId,
      branchId: _branchId,
    );
    final gateway = _PairingGateway();
    final controller = _controller(gateway, vault);
    await controller.initialize();

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: EntrySurface(controller: controller),
      ),
    );

    expect(find.text('Enter your operator PIN'), findsOneWidget);
    expect(find.text('Email'), findsNothing);
    expect(find.text('Use 4 to 8 digits.'), findsOneWidget);
    expect(find.text('0/8'), findsNothing);
    await tester.enterText(find.byType(TextField), '2468');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(gateway.authenticatedPin, '2468');
    expect(controller.state.phase, EntryPhase.ready);
    expect(controller.state.operator?.permissions, contains('catalog.read'));
  });

  test(
    'restart revokes the previous local session and requires the PIN',
    () async {
      final storage = MemorySecureStorage();
      storage.values['device.installation_id'] = _installationId;
      final vault = CredentialVault(storage);
      await vault.saveDevice(
        id: _deviceId,
        publicId: _publicId,
        credential: _secret,
        credentialVersion: 1,
        state: 'active',
        tenantId: _tenantId,
        branchId: _branchId,
      );
      await vault.saveTokens('old-access', 'old-refresh');
      final gateway = _PairingGateway();
      final controller = _controller(gateway, vault);

      await controller.initialize();

      expect(controller.state.phase, EntryPhase.pinRequired);
      expect(gateway.logouts, 1);
      expect(await vault.refreshToken(), isNull);
    },
  );

  test('operator lock preserves the device branch for the next PIN', () async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    await vault.saveDevice(
      id: _deviceId,
      publicId: _publicId,
      credential: _secret,
      credentialVersion: 1,
      state: 'active',
      tenantId: _tenantId,
      branchId: _branchId,
    );
    final gateway = _PairingGateway();
    final controller = _controller(gateway, vault);
    await controller.initialize();
    await controller.loginWithPin('2468');
    expect(controller.state.phase, EntryPhase.ready);

    await controller.lock();

    final identity = await vault.deviceIdentity();
    expect(identity.tenantId, _tenantId);
    expect(identity.branchId, _branchId);
    expect(controller.state.phase, EntryPhase.pinRequired);
    expect(controller.state.errorCode, isNull);

    await controller.loginWithPin('2468');

    expect(controller.state.phase, EntryPhase.ready);
    expect(controller.state.errorCode, isNull);
  });

  test(
    'operator lock fails locally closed without exposing a network error',
    () async {
      final storage = MemorySecureStorage();
      storage.values['device.installation_id'] = _installationId;
      final vault = CredentialVault(storage);
      await vault.saveDevice(
        id: _deviceId,
        publicId: _publicId,
        credential: _secret,
        credentialVersion: 1,
        state: 'active',
        tenantId: _tenantId,
        branchId: _branchId,
      );
      final gateway = _PairingGateway()..failLock = true;
      final controller = _controller(gateway, vault);
      await controller.initialize();
      await controller.loginWithPin('2468');

      await controller.lock();

      expect(controller.state.phase, EntryPhase.pinRequired);
      expect(controller.state.errorCode, isNull);
    },
  );
}

EntryController _controller(EntryGateway gateway, CredentialVault vault) {
  return EntryController(
    gateway: gateway,
    vault: vault,
    telemetry: SafeTelemetry(
      enabled: false,
      context: TelemetryContext.current(testConfig),
      exporter: RecordingExporter(),
    ),
  );
}

final class _PairingGateway implements EntryGateway {
  String? claimedCode;
  int polls = 0;
  int acknowledgements = 0;
  int logouts = 0;
  String? authenticatedPin;
  bool failLock = false;
  bool failClaim = false;

  @override
  Future<DevicePairingSession> claimPairing(String code) async {
    claimedCode = code;
    if (failClaim) {
      throw const AppException(
        category: AppErrorCategory.authentication,
        code: 'ENROLLMENT_REJECTED',
        recoverable: false,
      );
    }
    return DevicePairingSession(
      pairingSessionId: _sessionId,
      pollingCredential: _secret,
      state: 'awaiting_approval',
      expiresAt: DateTime.now()
          .add(const Duration(minutes: 5))
          .toIso8601String(),
      pollAfterSeconds: 1,
    );
  }

  @override
  Future<DevicePairingPollResponse> pollPairing(PairingIdentity pairing) async {
    polls++;
    return DevicePairingPollResponse(
      pairingSessionId: pairing.sessionId,
      state: 'credential_delivered',
      expiresAt: pairing.expiresAt.toIso8601String(),
      pollAfterSeconds: 1,
      device: {
        'id': _deviceId,
        'publicId': _publicId,
        'tenantId': _tenantId,
        'branchId': _branchId,
        'displayName': 'Front register',
        'type': 'pos_terminal',
        'platform': 'web',
        'state': 'active',
        'credentialVersion': 1,
        'lastSeenAt': null,
        'rotationRequired': false,
        'revokedAt': null,
        'replacementDeviceId': null,
      },
      credential: _secret,
    );
  }

  @override
  Future<void> acknowledgePairing(
    PairingIdentity pairing,
    String deviceCredential,
  ) async {
    acknowledgements++;
  }

  @override
  Future<DeviceSummary> deviceStatus() async => const DeviceSummary(
    id: _deviceId,
    publicId: _publicId,
    tenantId: _tenantId,
    branchId: _branchId,
    displayName: 'Front register',
    type: 'pos_terminal',
    platform: 'web',
    state: 'active',
    credentialVersion: 1,
    lastSeenAt: null,
    rotationRequired: false,
    revokedAt: null,
    replacementDeviceId: null,
  );
  @override
  Future<PosSessionResponse> login(String username, String password) =>
      throw UnimplementedError();
  @override
  Future<PosSessionResponse> pinLogin({
    required String pin,
    required String tenantId,
    required String branchId,
  }) async {
    authenticatedPin = pin;
    return const PosSessionResponse(
      session: {'id': 'session'},
      tokens: {'accessToken': 'access', 'refreshToken': 'refresh'},
    );
  }

  @override
  Future<PosSessionResponse> refresh() => throw UnimplementedError();
  @override
  Future<void> logout() async {
    logouts++;
  }

  @override
  Future<void> globalLogout() => throw UnimplementedError();
  @override
  Future<EntryContextResponse> entryContext() async =>
      const EntryContextResponse(
        tenants: [
          {
            'id': _tenantId,
            'name': 'Local business',
            'roles': ['cashier'],
            'permissions': ['catalog.read', 'cart.write', 'checkout.commit'],
            'branches': [
              {
                'id': _branchId,
                'tenantId': _tenantId,
                'name': 'Local branch',
                'status': 'active',
                'deviceAllowed': true,
                'operatorAllowed': true,
              },
            ],
            'entitlements': [
              {'key': 'pos', 'enabled': true},
            ],
          },
        ],
      );
  @override
  Future<OperatorSessionView> startOperator(String tenantId, String branchId) =>
      Future.value(
        OperatorSessionView(
          id: _sessionId,
          userId: '00000000-0000-4000-8000-000000000007',
          staffId: '00000000-0000-4000-8000-000000000008',
          tenantId: tenantId,
          branchId: branchId,
          deviceId: _deviceId,
          state: 'active',
          permissions: const ['catalog.read', 'cart.write', 'checkout.commit'],
          entitlements: const [
            {'key': 'pos', 'enabled': true},
          ],
          startedAt: '2026-07-28T00:00:00.000Z',
          lastActivityAt: '2026-07-28T00:00:00.000Z',
          expiresAt: '2026-07-28T08:00:00.000Z',
        ),
      );
  @override
  Future<void> lockOperator(String id) async {
    if (failLock) {
      throw const AppException(
        category: AppErrorCategory.transport,
        code: 'TRANSPORT_FAILURE',
        recoverable: true,
      );
    }
  }

  @override
  Future<void> endOperator(String id) => throw UnimplementedError();
  @override
  Future<ElevationGrantView> verifyPin({
    required String pin,
    required String permission,
    required String tenantId,
    required String branchId,
  }) => throw UnimplementedError();
  @override
  Future<ElevationGrantView> requestManagerApproval({
    required String operatorSessionId,
    required String managerPin,
    required String permission,
    required String tenantId,
    required String branchId,
  }) => throw UnimplementedError();
}
