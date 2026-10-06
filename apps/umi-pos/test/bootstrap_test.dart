import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/bootstrap/bootstrap_state.dart';
import 'package:umi_pos/core/release/release_compatibility.dart';

import 'support/fakes.dart';

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
