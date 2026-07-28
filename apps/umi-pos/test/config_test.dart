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
    );
    expect(config.validate()?.code, 'PRODUCTION_CONFIGURATION_UNSAFE');
  });
}
