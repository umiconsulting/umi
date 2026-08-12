import '../errors/app_error.dart';

enum AppEnvironment { invalid, development, test, staging, pilot, production }

enum FeatureBootstrapMode { disabled, localSafeDefaults }

final class AppConfig {
  const AppConfig({
    required this.environment,
    required this.apiBaseUri,
    required this.telemetryEnabled,
    required this.developmentDiagnostics,
    required this.featureBootstrapMode,
    required this.hardwareSimulatorEnabled,
    required this.release,
  });

  factory AppConfig.fromEnvironment() {
    const environmentValue = String.fromEnvironment(
      'UMIPOS_ENVIRONMENT',
      defaultValue: '',
    );
    const apiValue = String.fromEnvironment('UMIPOS_API_BASE_URL');
    const telemetry = bool.fromEnvironment('UMIPOS_TELEMETRY_ENABLED');
    const diagnostics = bool.fromEnvironment(
      'UMIPOS_DEVELOPMENT_DIAGNOSTICS',
      defaultValue: false,
    );
    const flags = String.fromEnvironment(
      'UMIPOS_FEATURE_BOOTSTRAP',
      defaultValue: 'disabled',
    );
    const simulator = bool.fromEnvironment(
      'UMIPOS_HARDWARE_SIMULATOR_ENABLED',
      defaultValue: false,
    );
    return AppConfig(
      environment: AppEnvironment.values.firstWhere(
        (value) => value.name == environmentValue,
        orElse: () => AppEnvironment.invalid,
      ),
      apiBaseUri: Uri.tryParse(apiValue),
      telemetryEnabled: telemetry,
      developmentDiagnostics: diagnostics,
      featureBootstrapMode: flags == 'localSafeDefaults'
          ? FeatureBootstrapMode.localSafeDefaults
          : FeatureBootstrapMode.disabled,
      hardwareSimulatorEnabled: simulator,
      release: ReleaseIdentity.fromEnvironment(),
    );
  }

  final AppEnvironment environment;
  final Uri? apiBaseUri;
  final bool telemetryEnabled;
  final bool developmentDiagnostics;
  final FeatureBootstrapMode featureBootstrapMode;
  final bool hardwareSimulatorEnabled;
  final ReleaseIdentity release;

  AppException? validate() {
    if (environment == AppEnvironment.invalid) {
      return const AppException(
        category: AppErrorCategory.configuration,
        code: 'ENVIRONMENT_INVALID',
        recoverable: false,
      );
    }
    final uri = apiBaseUri;
    if (uri == null || !uri.hasScheme || !uri.hasAuthority) {
      return const AppException(
        category: AppErrorCategory.configuration,
        code: 'CONFIGURATION_INVALID',
        recoverable: false,
      );
    }
    if (!{
          AppEnvironment.development,
          AppEnvironment.test,
        }.contains(environment) &&
        uri.scheme != 'https') {
      return const AppException(
        category: AppErrorCategory.configuration,
        code: 'TLS_REQUIRED',
        recoverable: false,
      );
    }
    if ({
          AppEnvironment.staging,
          AppEnvironment.pilot,
          AppEnvironment.production,
        }.contains(environment) &&
        (developmentDiagnostics ||
            featureBootstrapMode != FeatureBootstrapMode.disabled ||
            hardwareSimulatorEnabled)) {
      return const AppException(
        category: AppErrorCategory.configuration,
        code: 'PILOT_CONFIGURATION_UNSAFE',
        recoverable: false,
      );
    }
    if ({
          AppEnvironment.staging,
          AppEnvironment.pilot,
          AppEnvironment.production,
        }.contains(environment) &&
        !release.isValid) {
      return const AppException(
        category: AppErrorCategory.configuration,
        code: 'RELEASE_IDENTITY_INVALID',
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
    'hardwareSimulatorEnabled': hardwareSimulatorEnabled,
    'release': release.safeSummary(),
  };
}

final class ReleaseIdentity {
  const ReleaseIdentity({
    required this.application,
    required this.version,
    required this.gitCommit,
    required this.buildTimestamp,
    required this.contractVersion,
    required this.configurationSchemaVersion,
  });

  factory ReleaseIdentity.fromEnvironment() => const ReleaseIdentity(
    application: 'umi-pos',
    version: String.fromEnvironment('UMIPOS_RELEASE_VERSION'),
    gitCommit: String.fromEnvironment('UMIPOS_RELEASE_GIT_COMMIT'),
    buildTimestamp: String.fromEnvironment('UMIPOS_RELEASE_BUILD_TIMESTAMP'),
    contractVersion: String.fromEnvironment('UMIPOS_CONTRACT_VERSION'),
    configurationSchemaVersion: String.fromEnvironment(
      'UMIPOS_CONFIG_SCHEMA_VERSION',
      defaultValue: '1',
    ),
  );

  final String application;
  final String version;
  final String gitCommit;
  final String buildTimestamp;
  final String contractVersion;
  final String configurationSchemaVersion;

  bool get isValid =>
      application == 'umi-pos' &&
      RegExp(r'^[0-9A-Za-z][0-9A-Za-z.+-]{0,79}$').hasMatch(version) &&
      RegExp(r'^[0-9a-f]{40}$').hasMatch(gitCommit) &&
      DateTime.tryParse(buildTimestamp)?.isUtc == true &&
      RegExp(r'^\d+\.\d+\.\d+$').hasMatch(contractVersion) &&
      RegExp(r'^\d+$').hasMatch(configurationSchemaVersion);

  Map<String, Object?> safeSummary() => {
    'application': application,
    'version': version,
    'gitCommit': gitCommit,
    'buildTimestamp': buildTimestamp,
    'contractVersion': contractVersion,
    'configurationSchemaVersion': configurationSchemaVersion,
  };
}
