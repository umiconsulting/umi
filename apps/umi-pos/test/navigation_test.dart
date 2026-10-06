import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/bootstrap/bootstrap_state.dart';
import 'package:umi_pos/core/config/app_config.dart';
import 'package:umi_pos/core/feature_flags/feature_flags.dart';
import 'package:umi_pos/core/navigation/app_navigation.dart';

import 'support/fakes.dart';

void main() {
  test('future business routes remain guarded', () {
    final result = NavigationGuard.resolve(
      requested: AppRoute.mainShell,
      bootstrap: const BootstrapState(BootstrapPhase.readyForAuthentication),
      config: testConfig,
      flags: FeatureFlags.bootstrap(FeatureBootstrapMode.localSafeDefaults),
      entryStage: TrustedEntryStage.authentication,
    );
    expect(result, AppRoute.authentication);
  });

  test('trusted entry stages cannot deep-link past missing context', () {
    final stages = {
      TrustedEntryStage.enrollment: AppRoute.enrollment,
      TrustedEntryStage.authentication: AppRoute.authentication,
      TrustedEntryStage.tenant: AppRoute.tenantSelection,
      TrustedEntryStage.branch: AppRoute.branchSelection,
      TrustedEntryStage.operator: AppRoute.operatorSession,
      TrustedEntryStage.ready: AppRoute.mainShell,
    };
    for (final entry in stages.entries) {
      expect(
        NavigationGuard.resolve(
          requested: AppRoute.mainShell,
          bootstrap: const BootstrapState(
            BootstrapPhase.readyForAuthentication,
          ),
          config: testConfig,
          flags: FeatureFlags.bootstrap(FeatureBootstrapMode.localSafeDefaults),
          entryStage: entry.key,
        ),
        entry.value,
      );
    }
  });

  test('initialization cannot be bypassed', () {
    final result = NavigationGuard.resolve(
      requested: AppRoute.diagnostics,
      bootstrap: const BootstrapState.initializing(),
      config: testConfig,
      flags: FeatureFlags.bootstrap(FeatureBootstrapMode.localSafeDefaults),
    );
    expect(result, AppRoute.bootstrap);
  });
}
