import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/bootstrap/bootstrap_state.dart';
import 'package:umi_pos/core/config/app_config.dart';
import 'package:umi_pos/core/release/release_compatibility.dart';
import 'package:umi_pos/core/security/credential_vault.dart';

import 'support/fakes.dart';

final class _HangingReleaseCompatibility
    implements ReleaseCompatibilityGateway {
  final Completer<ReleaseCompatibility> _never =
      Completer<ReleaseCompatibility>();

  @override
  Future<ReleaseCompatibility> check() => _never.future;
}

final class _DeferredReleaseCompatibility
    implements ReleaseCompatibilityGateway {
  final Completer<ReleaseCompatibility> completer =
      Completer<ReleaseCompatibility>();

  @override
  Future<ReleaseCompatibility> check() => completer.future;
}

void main() {
  test(
    'bootstrap reaches ready-for-authentication without authenticating',
    () async {
      final root = testRoot();
      await root.controller.initialize();
      expect(
        root.controller.state.phase,
        BootstrapPhase.readyForAuthentication,
      );
      root.dispose();
    },
  );

  test(
    'a proven release does not wait on a hung compatibility probe',
    () async {
      final preferences = TestPreferences();
      final online = testRoot(preferences: preferences);
      await online.controller.initialize();
      expect(
        online.controller.state.phase,
        BootstrapPhase.readyForAuthentication,
      );
      online.dispose();

      final stopwatch = Stopwatch()..start();
      final offline = testRoot(
        preferences: preferences,
        releaseCompatibility: _HangingReleaseCompatibility(),
      );
      await offline.controller.initialize();
      stopwatch.stop();

      expect(
        offline.controller.state.phase,
        BootstrapPhase.readyForAuthentication,
      );
      expect(stopwatch.elapsed, lessThan(const Duration(seconds: 9)));
      offline.dispose();
    },
  );

  test(
    'a background incompatible answer revokes a locally admitted start',
    () async {
      final preferences = TestPreferences();
      final online = testRoot(preferences: preferences);
      await online.controller.initialize();
      online.dispose();

      final deferred = _DeferredReleaseCompatibility();
      final offline = testRoot(
        preferences: preferences,
        releaseCompatibility: deferred,
      );
      await offline.controller.initialize();
      expect(
        offline.controller.state.phase,
        BootstrapPhase.readyForAuthentication,
      );

      deferred.completer.complete(ReleaseCompatibility.upgradeRequired);
      await Future<void>.delayed(const Duration(milliseconds: 20));

      expect(
        offline.controller.state.phase,
        BootstrapPhase.unrecoverableFailure,
      );
      expect(offline.controller.state.diagnosticCategory, 'upgradeRequired');
      offline.dispose();
    },
  );

  test('pilot bootstrap fails safely when the API is unreachable', () async {
    final root = testRoot(
      config: pilotTestConfig,
      releaseCompatibility: const TestReleaseCompatibility(
        ReleaseCompatibility.apiUnavailable,
      ),
    );
    await root.controller.initialize();
    expect(root.controller.state.phase, BootstrapPhase.recoverableFailure);
    expect(root.controller.state.diagnosticCategory, 'apiUnavailable');
    root.dispose();
  });

  test(
    'a proven release starts offline after secure storage is replaced',
    () async {
      final preferences = TestPreferences();
      final online = testRoot(preferences: preferences);
      await online.controller.initialize();
      expect(
        online.controller.state.phase,
        BootstrapPhase.readyForAuthentication,
      );
      online.dispose();

      final offline = testRoot(
        preferences: preferences,
        storage: MemorySecureStorage(),
        releaseCompatibility: const TestReleaseCompatibility(
          ReleaseCompatibility.apiUnavailable,
        ),
      );
      await offline.controller.initialize();
      expect(
        offline.controller.state.phase,
        BootstrapPhase.readyForAuthentication,
      );
      offline.dispose();
    },
  );

  test('a recent enrolled session opens without the proof marker', () async {
    final storage = MemorySecureStorage();
    storage.values[CredentialVault.entrySnapshotKey] = jsonEncode({
      'savedAt': DateTime.now().toUtc().toIso8601String(),
    });
    final root = testRoot(
      storage: storage,
      releaseCompatibility: const TestReleaseCompatibility(
        ReleaseCompatibility.apiUnavailable,
      ),
    );

    await root.controller.initialize();

    expect(root.controller.state.phase, BootstrapPhase.readyForAuthentication);
    root.dispose();
  });

  test('pilot bootstrap rejects an incompatible release', () async {
    final root = testRoot(
      config: pilotTestConfig,
      releaseCompatibility: const TestReleaseCompatibility(
        ReleaseCompatibility.upgradeRequired,
      ),
    );
    await root.controller.initialize();
    expect(root.controller.state.phase, BootstrapPhase.unrecoverableFailure);
    expect(root.controller.state.diagnosticCategory, 'upgradeRequired');
    root.dispose();
  });

  test('invalid release identity reports its exact build defect', () async {
    final invalidRelease = AppConfig(
      environment: AppEnvironment.production,
      apiBaseUri: Uri.parse('https://api.example.test'),
      telemetryEnabled: true,
      developmentDiagnostics: false,
      featureBootstrapMode: FeatureBootstrapMode.disabled,
      hardwareSimulatorEnabled: false,
      realtimeEnrollmentEnabled: false,
      release: const ReleaseIdentity(
        application: 'umi-pos',
        version: '1.0.0',
        gitCommit: '',
        buildTimestamp: '',
        contractVersion: '2.45.0',
        configurationSchemaVersion: '1',
      ),
    );
    final root = testRoot(config: invalidRelease);

    await root.controller.initialize();

    expect(root.controller.state.phase, BootstrapPhase.configurationInvalid);
    expect(root.controller.state.diagnosticCategory, 'configuration');
    expect(root.controller.state.diagnosticCode, 'RELEASE_IDENTITY_INVALID');
    root.dispose();
  });

  test(
    'bootstrap fails safely when encrypted storage is unavailable',
    () async {
      final root = testRoot(storage: MemorySecureStorage(available: false));
      await root.controller.initialize();
      expect(root.controller.state.phase, BootstrapPhase.storageUnavailable);
      expect(root.controller.state.canRetry, isTrue);
      root.dispose();
    },
  );
}
