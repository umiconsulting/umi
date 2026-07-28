import '../core/config/app_config.dart';
import '../core/contracts/contract_gateway.dart';
import '../core/feature_flags/feature_flags.dart';
import '../core/network/api_client.dart';
import '../core/observability/telemetry.dart';
import '../core/platform/platform_adapters.dart';
import '../core/storage/storage.dart';
import 'bootstrap_controller.dart';

final class AppCompositionRoot {
  AppCompositionRoot({
    required this.config,
    required this.controller,
    required this.telemetry,
    required this.secureStorage,
    required this.preferences,
    required this.localDatabase,
    required this.platform,
    required this.apiClient,
    required this.features,
  });

  factory AppCompositionRoot.production() {
    final config = AppConfig.fromEnvironment();
    final telemetry = SafeTelemetry(
      enabled: config.telemetryEnabled,
      context: TelemetryContext.current(config),
      exporter: const NoopTelemetryExporter(),
    );
    const secureStorage = FlutterSecureKeyValueStorage();
    const preferences = SharedPreferencesStore();
    const localDatabase = UnsupportedLocalDatabase();
    const platform = PlatformAdapters.unsupported();
    final apiClient = BoundedApiClient(config: config, telemetry: telemetry);
    final controller = BootstrapController(
      config: config,
      contracts: const GeneratedContractGateway(),
      secureStorage: secureStorage,
      telemetry: telemetry,
    );
    return AppCompositionRoot(
      config: config,
      controller: controller,
      telemetry: telemetry,
      secureStorage: secureStorage,
      preferences: preferences,
      localDatabase: localDatabase,
      platform: platform,
      apiClient: apiClient,
      features: FeatureFlags.bootstrap(config.featureBootstrapMode),
    );
  }

  final AppConfig config;
  final BootstrapController controller;
  final Telemetry telemetry;
  final SecureKeyValueStorage secureStorage;
  final PreferencesStore preferences;
  final LocalDatabase localDatabase;
  final PlatformAdapters platform;
  final ApiClient apiClient;
  final FeatureFlags features;

  void dispose() {
    controller.dispose();
    apiClient.dispose();
  }
}
