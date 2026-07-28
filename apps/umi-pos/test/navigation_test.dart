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
    );
    expect(result, AppRoute.authentication);
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
