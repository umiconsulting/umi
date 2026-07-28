import '../errors/app_error.dart';

enum AppEnvironment { development, staging, production }

enum FeatureBootstrapMode { disabled, localSafeDefaults }

final class AppConfig {
  const AppConfig({
    required this.environment,
    required this.apiBaseUri,
    required this.telemetryEnabled,
    required this.developmentDiagnostics,
    required this.featureBootstrapMode,
  });

  factory AppConfig.fromEnvironment() {
    const environmentValue = String.fromEnvironment(
      'UMIPOS_ENVIRONMENT',
      defaultValue: 'development',
    );
    const apiValue = String.fromEnvironment('UMIPOS_API_BASE_URL');
    const telemetry = bool.fromEnvironment('UMIPOS_TELEMETRY_ENABLED');
    const diagnostics = bool.fromEnvironment(
      'UMIPOS_DEVELOPMENT_DIAGNOSTICS',
      defaultValue: true,
    );
    const flags = String.fromEnvironment(
      'UMIPOS_FEATURE_BOOTSTRAP',
      defaultValue: 'disabled',
    );
    return AppConfig(
      environment: AppEnvironment.values.firstWhere(
        (value) => value.name == environmentValue,
        orElse: () => AppEnvironment.development,
      ),
      apiBaseUri: Uri.tryParse(apiValue),
      telemetryEnabled: telemetry,
      developmentDiagnostics: diagnostics,
      featureBootstrapMode: flags == 'localSafeDefaults'
          ? FeatureBootstrapMode.localSafeDefaults
          : FeatureBootstrapMode.disabled,
    );
  }

  final AppEnvironment environment;
  final Uri? apiBaseUri;
  final bool telemetryEnabled;
  final bool developmentDiagnostics;
  final FeatureBootstrapMode featureBootstrapMode;

  AppException? validate() {
    final uri = apiBaseUri;
    if (uri == null || !uri.hasScheme || !uri.hasAuthority) {
      return const AppException(
        category: AppErrorCategory.configuration,
        code: 'CONFIGURATION_INVALID',
        recoverable: false,
      );
    }
    if (environment != AppEnvironment.development && uri.scheme != 'https') {
      return const AppException(
        category: AppErrorCategory.configuration,
        code: 'TLS_REQUIRED',
        recoverable: false,
      );
    }
    if (environment == AppEnvironment.production &&
        (developmentDiagnostics ||
            featureBootstrapMode != FeatureBootstrapMode.disabled)) {
      return const AppException(
        category: AppErrorCategory.configuration,
        code: 'PRODUCTION_CONFIGURATION_UNSAFE',
        recoverable: false,
      );
    }
    return null;
  }

  Map<String, Object?> safeSummary() => {
    'environment': environment.name,
    'apiScheme': apiBaseUri?.scheme,
    'telemetryEnabled': telemetryEnabled,
    'developmentDiagnostics': developmentDiagnostics,
    'featureBootstrapMode': featureBootstrapMode.name,
  };
}
