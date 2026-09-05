import 'dart:async';

import 'package:fake_async/fake_async.dart';
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
const _merchantId = '00000000-0000-4000-8000-000000000005';
const _locationId = '00000000-0000-4000-8000-000000000006';
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

  group('realtime pairing nudge', () {
    Future<(_PairingGateway, CredentialVault, EntryController)> waiting() async {
      final storage = MemorySecureStorage();
      storage.values['device.installation_id'] = _installationId;
      final vault = CredentialVault(storage);
      final gateway = _PairingGateway()..pollState = 'awaiting_approval';
      addTearDown(gateway.dispose);
      final controller = _controller(gateway, vault);
      addTearDown(controller.dispose);

      await controller.enroll('ABCDEFGH');
      await Future<void>.delayed(const Duration(milliseconds: 20));

      // One poll happened, it reported awaiting_approval, and the loop is now
      // asleep for 30 s. Anything that follows can only come from the nudge.
      expect(controller.state.phase, EntryPhase.enrollmentPending);
      expect(gateway.polls, 1);
      return (gateway, vault, controller);
    }

    test('a nudge collects the credential without waiting for the poll', () async {
      final (gateway, vault, controller) = await waiting();

      gateway.pollState = 'credential_delivered';
      gateway.nudges.add(null);
      await Future<void>.delayed(const Duration(milliseconds: 20));

      expect(controller.state.phase, EntryPhase.pinRequired);
      expect(gateway.polls, 2, reason: 'one from the loop, one from the nudge');
      expect(gateway.acknowledgements, 1, reason: 'the credential is stored once');
      expect((await vault.deviceIdentity()).credential, _secret);
      expect(await vault.pairingIdentity(), isNull);
    });

    test('a burst of nudges still stores the credential once', () async {
      final (gateway, _, controller) = await waiting();

      gateway.pollState = 'credential_delivered';
      gateway.nudges..add(null)..add(null)..add(null);
      await Future<void>.delayed(const Duration(milliseconds: 40));

      expect(controller.state.phase, EntryPhase.pinRequired);
      expect(gateway.acknowledgements, 1);
    });

    test('a nudge after cancel does nothing', () async {
      final (gateway, _, controller) = await waiting();

      await controller.cancelPairing();
      final pollsAtCancel = gateway.polls;
      gateway.pollState = 'credential_delivered';
      gateway.nudges.add(null);
      await Future<void>.delayed(const Duration(milliseconds: 20));

      expect(controller.state.phase, EntryPhase.enrollmentRequired);
      expect(gateway.polls, pollsAtCancel);
      expect(gateway.acknowledgements, 0);
    });

    test('a failing nudge channel leaves the poll loop in charge', () async {
      final storage = MemorySecureStorage();
      storage.values['device.installation_id'] = _installationId;
      final vault = CredentialVault(storage);
      final gateway = _PairingGateway();
      addTearDown(gateway.dispose);
      final controller = _controller(gateway, vault);
      addTearDown(controller.dispose);

      await controller.enroll('ABCDEFGH');
      gateway.nudges.addError(
        const AppException(
          category: AppErrorCategory.transport,
          code: 'TRANSPORT_FAILURE',
          recoverable: true,
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 20));

      // Identical to the baseline with no realtime channel at all.
      expect(controller.state.phase, EntryPhase.pinRequired);
      expect(gateway.polls, 1);
      expect(gateway.acknowledgements, 1);
    });
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
    await tester.pump();
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

  testWidgets('a setup code timeout shows an inline recovery error', (
    tester,
  ) async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    final gateway = _PairingGateway()..claimFailureCode = 'REQUEST_TIMEOUT';
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

    await tester.enterText(find.byType(TextField), 'ABCDEFGH');
    await tester.pump();
    await tester.tap(find.text('Continuar'));
    await tester.pumpAndSettle();

    expect(controller.state.phase, EntryPhase.enrollmentRequired);
    expect(
      find.text(
        'UmiPOS no puede verificar este código ahora. Revisa la conexión e inténtalo de nuevo.',
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
      merchantId: _merchantId,
      locationId: _locationId,
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
    await tester.pump();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(gateway.authenticatedPin, '2468');
    expect(controller.state.phase, EntryPhase.ready);
    expect(controller.state.operator?.permissions, contains('catalog.read'));
  });

  test(
    'restart within the grace window restores the operator without a PIN',
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
        merchantId: _merchantId,
        locationId: _locationId,
      );
      // saveTokens stamps the last-proven time to now, inside the window.
      await vault.saveTokens('old-access', 'old-refresh');
      final gateway = _PairingGateway();
      final controller = _controller(gateway, vault);

      await controller.initialize();

      expect(gateway.refreshes, 1);
      expect(gateway.logouts, 0);
      expect(controller.state.phase, EntryPhase.ready);
      expect(await vault.refreshToken(), 'refresh2');
    },
  );

  test('restart with a failed refresh falls back to the PIN', () async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    await vault.saveDevice(
      id: _deviceId,
      publicId: _publicId,
      credential: _secret,
      credentialVersion: 1,
      state: 'active',
      merchantId: _merchantId,
      locationId: _locationId,
    );
    await vault.saveTokens('old-access', 'old-refresh');
    final gateway = _PairingGateway()..failRefresh = true;
    final controller = _controller(gateway, vault);

    await controller.initialize();

    expect(gateway.refreshes, 1);
    expect(controller.state.phase, EntryPhase.pinRequired);
    expect(await vault.refreshToken(), isNull);
  });

  test('restart after the grace window requires the PIN', () async {
    final storage = MemorySecureStorage();
    storage.values['device.installation_id'] = _installationId;
    final vault = CredentialVault(storage);
    await vault.saveDevice(
      id: _deviceId,
      publicId: _publicId,
      credential: _secret,
      credentialVersion: 1,
      state: 'active',
      merchantId: _merchantId,
      locationId: _locationId,
    );
    await vault.saveTokens('old-access', 'old-refresh');
    // Move the last-proven time outside the restore window.
    storage.values['session.activity_at'] = DateTime.now()
        .toUtc()
        .subtract(const Duration(minutes: 10))
        .toIso8601String();
    final gateway = _PairingGateway();
    final controller = _controller(gateway, vault);

    await controller.initialize();

    expect(gateway.refreshes, 0);
    expect(controller.state.phase, EntryPhase.pinRequired);
    expect(await vault.refreshToken(), isNull);
  });

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
      merchantId: _merchantId,
      locationId: _locationId,
    );
    final gateway = _PairingGateway();
    final controller = _controller(gateway, vault);
    await controller.initialize();
    await controller.loginWithPin('2468');
    expect(controller.state.phase, EntryPhase.ready);

    await controller.lock();

    final identity = await vault.deviceIdentity();
    expect(identity.merchantId, _merchantId);
    expect(identity.locationId, _locationId);
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
        merchantId: _merchantId,
        locationId: _locationId,
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

  test('an idle ready session locks itself and asks for the PIN', () {
    fakeAsync((async) {
      final storage = MemorySecureStorage();
      storage.values['device.installation_id'] = _installationId;
      final vault = CredentialVault(storage);
      unawaited(
        vault.saveDevice(
          id: _deviceId,
          publicId: _publicId,
          credential: _secret,
          credentialVersion: 1,
          state: 'active',
          merchantId: _merchantId,
          locationId: _locationId,
        ),
      );
      async.flushMicrotasks();
      final gateway = _PairingGateway();
      final controller = EntryController(
        gateway: gateway,
        vault: vault,
        telemetry: SafeTelemetry(
          enabled: false,
          context: TelemetryContext.current(testConfig),
          exporter: RecordingExporter(),
        ),
        idleTimeout: const Duration(minutes: 30),
      );

      // No saved tokens, so the cold start lands on the PIN, not a restore.
      unawaited(controller.initialize());
      async.flushMicrotasks();
      expect(controller.state.phase, EntryPhase.pinRequired);

      unawaited(controller.loginWithPin('2468'));
      async.flushMicrotasks();
      expect(controller.state.phase, EntryPhase.ready);

      // A short interaction keeps it open; a long silence locks it.
      controller.noteActivity();
      async.elapse(const Duration(minutes: 20));
      async.flushMicrotasks();
      expect(controller.state.phase, EntryPhase.ready);

      async.elapse(const Duration(minutes: 31));
      async.flushMicrotasks();
      expect(controller.state.phase, EntryPhase.pinRequired);

      controller.dispose();
    });
  });
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
  int refreshes = 0;
  bool failRefresh = false;
  String? authenticatedPin;
  bool failLock = false;
  bool failClaim = false;
  String? claimFailureCode;

  /// Drives the realtime nudge channel. A test adds to it to imitate the API
  /// announcing that the pairing state moved.
  final StreamController<void> nudges = StreamController<void>.broadcast();

  /// What the next poll reports. Tests flip it to 'credential_delivered' to
  /// imitate an administrator approving the request.
  String pollState = 'credential_delivered';

  @override
  Stream<void> watchPairing(PairingIdentity pairing) => nudges.stream;

  /// Closes the nudge channel. Tests register this with `addTearDown`.
  Future<void> dispose() => nudges.close();

  @override
  Future<DevicePairingSession> claimPairing(String code) async {
    claimedCode = code;
    if (failClaim || claimFailureCode != null) {
      throw AppException(
        category: AppErrorCategory.authentication,
        code: claimFailureCode ?? 'ENROLLMENT_REJECTED',
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
    if (pollState != 'credential_delivered') {
      return DevicePairingPollResponse(
        pairingSessionId: pairing.sessionId,
        state: pollState,
        expiresAt: pairing.expiresAt.toIso8601String(),
        pollAfterSeconds: 30,
        device: null,
        credential: null,
      );
    }
    return DevicePairingPollResponse(
      pairingSessionId: pairing.sessionId,
      state: 'credential_delivered',
      expiresAt: pairing.expiresAt.toIso8601String(),
      pollAfterSeconds: 1,
      device: {
        'id': _deviceId,
        'publicId': _publicId,
        'merchantId': _merchantId,
        'locationId': _locationId,
        'displayName': 'Front register',
        'type': 'pos_terminal',
        'platform': 'web',
        'mobility': 'static',
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
    merchantId: _merchantId,
    locationId: _locationId,
    displayName: 'Front register',
    type: 'pos_terminal',
    platform: 'web',
    mobility: 'static',
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
    required String merchantId,
    required String locationId,
  }) async {
    authenticatedPin = pin;
    return const PosSessionResponse(
      session: {'id': 'session'},
      tokens: {'accessToken': 'access', 'refreshToken': 'refresh'},
    );
  }

  @override
  Future<PosSessionResponse> refresh() async {
    refreshes++;
    if (failRefresh) {
      throw AppException(
        category: AppErrorCategory.authentication,
        code: 'SESSION_EXPIRED',
        recoverable: false,
      );
    }
    return const PosSessionResponse(
      session: {'id': 'session'},
      tokens: {'accessToken': 'access2', 'refreshToken': 'refresh2'},
    );
  }
  @override
  Future<void> logout() async {
    logouts++;
  }

  @override
  Future<void> globalLogout() => throw UnimplementedError();
  @override
  Future<EntryContextResponse> entryContext() async =>
      const EntryContextResponse(
        merchants: [
          {
            'id': _merchantId,
            'name': 'Local business',
            'roles': ['cashier'],
            'permissions': ['catalog.read', 'cart.write', 'checkout.commit'],
            'locations': [
              {
                'id': _locationId,
                'merchantId': _merchantId,
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
  Future<OperatorSessionView> startOperator(
    String merchantId,
    String locationId,
  ) => Future.value(
    OperatorSessionView(
      id: _sessionId,
      userId: '00000000-0000-4000-8000-000000000007',
      staffId: '00000000-0000-4000-8000-000000000008',
      merchantId: merchantId,
      locationId: locationId,
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
    required String merchantId,
    required String locationId,
  }) => throw UnimplementedError();
  @override
  Future<ElevationGrantView> requestManagerApproval({
    required String operatorSessionId,
    required String managerPin,
    required String permission,
    required String merchantId,
    required String locationId,
    String? commandFingerprint,
  }) => throw UnimplementedError();
}
