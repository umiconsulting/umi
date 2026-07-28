import 'package:umi_pos/bootstrap/bootstrap_controller.dart';
import 'package:umi_pos/bootstrap/composition_root.dart';
import 'package:umi_pos/core/config/app_config.dart';
import 'package:umi_pos/core/contracts/contract_gateway.dart';
import 'package:umi_pos/core/feature_flags/feature_flags.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/platform/platform_adapters.dart';
import 'package:umi_pos/core/storage/storage.dart';

final testConfig = AppConfig(
  environment: AppEnvironment.development,
  apiBaseUri: Uri.parse('https://api.example.test'),
  telemetryEnabled: true,
  developmentDiagnostics: true,
  featureBootstrapMode: FeatureBootstrapMode.localSafeDefaults,
);

final class TestContracts implements ContractGateway {
  const TestContracts({this.compatible = true});
  final bool compatible;
  @override
  String get contentHash => 'test-hash';
  @override
  bool get isCompatible => compatible;
  @override
  String get version => '1.0.0';
}

final class MemorySecureStorage implements SecureKeyValueStorage {
  MemorySecureStorage({this.available = true});
  final bool available;
  final Map<String, String> values = {};
  @override
  Future<void> delete(String key) async => values.remove(key);
  @override
  Future<void> deleteAll() async => values.clear();
  @override
  Future<StorageHealth> healthCheck() async => StorageHealth(
    available: available,
    category: available ? 'available' : 'unavailable',
  );
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
}

final class TestPreferences implements PreferencesStore {
  final Map<String, String> values = {};
  @override
  Future<void> delete(String key) async => values.remove(key);
  @override
  Future<String?> readString(String key) async => values[key];
  @override
  Future<void> writeString(String key, String value) async =>
      values[key] = value;
}

final class RecordingExporter implements TelemetryExporter {
  final List<ClientEvent> events = [];
  @override
  void export(ClientEvent event) => events.add(event);
}

final class TestApiClient implements ApiClient {
  @override
  void dispose() {}
  @override
  Future<Map<String, Object?>> request({
    required ApiMethod method,
    required String path,
    Map<String, Object?>? body,
    CancellationToken? cancellation,
    bool idempotent = false,
  }) async => {};
}

AppCompositionRoot testRoot({
  MemorySecureStorage? storage,
  ContractGateway contracts = const TestContracts(),
}) {
  final secureStorage = storage ?? MemorySecureStorage();
  final exporter = RecordingExporter();
  final telemetry = SafeTelemetry(
    enabled: true,
    context: TelemetryContext.current(testConfig),
    exporter: exporter,
  );
  return AppCompositionRoot(
    config: testConfig,
    controller: BootstrapController(
      config: testConfig,
      contracts: contracts,
      secureStorage: secureStorage,
      telemetry: telemetry,
    ),
    telemetry: telemetry,
    secureStorage: secureStorage,
    preferences: TestPreferences(),
    localDatabase: const UnsupportedLocalDatabase(),
    platform: const PlatformAdapters.unsupported(),
    apiClient: TestApiClient(),
    features: FeatureFlags.bootstrap(FeatureBootstrapMode.localSafeDefaults),
  );
}
