import '../../bootstrap/bootstrap_state.dart';
import '../config/app_config.dart';
import '../feature_flags/feature_flags.dart';

enum AppRoute {
  bootstrap,
  authentication,
  enrollment,
  tenantSelection,
  branchSelection,
  operatorSession,
  mainShell,
  recoverableError,
  diagnostics,
  unknown,
}

abstract final class NavigationGuard {
  static AppRoute resolve({
    required AppRoute requested,
    required BootstrapState bootstrap,
    required AppConfig config,
    required FeatureFlags flags,
  }) {
    if (bootstrap.phase == BootstrapPhase.initializing) {
      return AppRoute.bootstrap;
    }
    if (bootstrap.phase == BootstrapPhase.recoverableFailure ||
        bootstrap.phase == BootstrapPhase.configurationInvalid ||
        bootstrap.phase == BootstrapPhase.storageUnavailable) {
      return AppRoute.recoverableError;
    }
    if (bootstrap.phase == BootstrapPhase.unrecoverableFailure ||
        bootstrap.phase == BootstrapPhase.sdkUnavailable) {
      return AppRoute.recoverableError;
    }
    if (requested == AppRoute.diagnostics &&
        config.developmentDiagnostics &&
        flags.diagnostics) {
      return AppRoute.diagnostics;
    }
    // Authentication and later route groups remain closed until their gates.
    return AppRoute.authentication;
  }
}
