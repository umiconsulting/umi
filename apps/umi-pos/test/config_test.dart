import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/config/app_config.dart';

void main() {
  test('production configuration fails closed without TLS', () {
    final config = AppConfig(
      environment: AppEnvironment.production,
      apiBaseUri: Uri.parse('http://api.example.test'),
      telemetryEnabled: true,
      developmentDiagnostics: false,
      featureBootstrapMode: FeatureBootstrapMode.disabled,
      hardwareSimulatorEnabled: false,
      realtimeEnrollmentEnabled: false,
      release: testReleaseIdentity,
    );
    expect(config.validate()?.code, 'TLS_REQUIRED');
  });

  test('production configuration rejects development controls', () {
    final config = AppConfig(
      environment: AppEnvironment.production,
      apiBaseUri: Uri.parse('https://api.example.test'),
      telemetryEnabled: true,
      developmentDiagnostics: true,
      featureBootstrapMode: FeatureBootstrapMode.localSafeDefaults,
      hardwareSimulatorEnabled: true,
      realtimeEnrollmentEnabled: false,
      release: testReleaseIdentity,
    );
    expect(config.validate()?.code, 'PILOT_CONFIGURATION_UNSAFE');
  });

  test('pilot rejects diagnostics and hardware simulator defaults', () {
    final config = AppConfig(
      environment: AppEnvironment.pilot,
      apiBaseUri: Uri.parse('https://pilot.example.com'),
      telemetryEnabled: true,
      developmentDiagnostics: true,
      featureBootstrapMode: FeatureBootstrapMode.disabled,
      hardwareSimulatorEnabled: true,
      realtimeEnrollmentEnabled: false,
      release: testReleaseIdentity,
    );
    expect(config.validate()?.code, 'PILOT_CONFIGURATION_UNSAFE');
  });

  test('a web build is refused as a production POS', () {
    final config = AppConfig(
      environment: AppEnvironment.production,
      apiBaseUri: Uri.parse('https://api.example.test'),
      telemetryEnabled: true,
      developmentDiagnostics: false,
      featureBootstrapMode: FeatureBootstrapMode.disabled,
      hardwareSimulatorEnabled: false,
      realtimeEnrollmentEnabled: false,
      release: testReleaseIdentity,
      runningOnWeb: true,
    );
    expect(config.validate()?.code, 'WEB_POS_UNSUPPORTED');
  });

  test('a web build is refused as a pilot POS', () {
    final config = AppConfig(
      environment: AppEnvironment.pilot,
      apiBaseUri: Uri.parse('https://pilot.example.com'),
      telemetryEnabled: true,
      developmentDiagnostics: false,
      featureBootstrapMode: FeatureBootstrapMode.disabled,
      hardwareSimulatorEnabled: false,
      realtimeEnrollmentEnabled: false,
      release: testReleaseIdentity,
      runningOnWeb: true,
    );
    expect(config.validate()?.code, 'WEB_POS_UNSUPPORTED');
  });

  test('a web build is allowed as a development preview', () {
    final config = AppConfig(
      environment: AppEnvironment.development,
      apiBaseUri: Uri.parse('http://127.0.0.1:4001'),
      telemetryEnabled: false,
      developmentDiagnostics: true,
      featureBootstrapMode: FeatureBootstrapMode.disabled,
      hardwareSimulatorEnabled: true,
      realtimeEnrollmentEnabled: false,
      release: testReleaseIdentity,
      runningOnWeb: true,
    );
    expect(config.validate(), isNull);
  });

  test('invalid environment fails closed', () {
    final config = AppConfig(
      environment: AppEnvironment.invalid,
      apiBaseUri: Uri.parse('https://pilot.example.com'),
      telemetryEnabled: false,
      developmentDiagnostics: false,
      featureBootstrapMode: FeatureBootstrapMode.disabled,
      hardwareSimulatorEnabled: false,
      realtimeEnrollmentEnabled: false,
      release: testReleaseIdentity,
    );
    expect(config.validate()?.code, 'ENVIRONMENT_INVALID');
  });
}

const testReleaseIdentity = ReleaseIdentity(
  application: 'umi-pos',
  version: '6.0.0-pilot.1',
  gitCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  buildTimestamp: '2026-08-11T12:00:00.000Z',
  contractVersion: '2.12.0',
  configurationSchemaVersion: '1',
);
