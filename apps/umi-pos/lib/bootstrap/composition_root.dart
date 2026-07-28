import '../core/config/app_config.dart';
import '../core/contracts/contract_gateway.dart';
import '../core/feature_flags/feature_flags.dart';
import '../core/network/api_client.dart';
import '../core/observability/telemetry.dart';
import '../core/platform/platform_adapters.dart';
import '../core/security/credential_vault.dart';
import '../core/storage/storage.dart';
import '../features/cart/cart_controller.dart';
import '../features/cart/cart_repository.dart';
import '../features/catalog/catalog_controller.dart';
import '../features/catalog/catalog_repository.dart';
import '../features/checkout/checkout_controller.dart';
import '../features/checkout/checkout_repository.dart';
import '../features/entry/entry_controller.dart';
import '../features/entry/entry_gateway.dart';
import '../features/offline/connectivity_controller.dart';
import '../features/offline/offline_journal.dart';
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
    required this.credentials,
    required this.entry,
    required this.catalog,
    required this.cart,
    required this.checkout,
    required this.connectivity,
    required this.offlineJournal,
  });

  factory AppCompositionRoot.production() {
    final config = AppConfig.fromEnvironment();
    final telemetry = SafeTelemetry(
      enabled: config.telemetryEnabled,
      context: TelemetryContext.current(config),
      exporter: const NoopTelemetryExporter(),
    );
    const secureStorage = FlutterSecureKeyValueStorage();
    final credentials = CredentialVault(secureStorage);
    const preferences = SharedPreferencesStore();
    const localDatabase = UnsupportedLocalDatabase();
    const platform = PlatformAdapters.unsupported();
    final apiClient = BoundedApiClient(
      config: config,
      telemetry: telemetry,
      tokenProvider: credentials,
      deviceCredentialProvider: credentials,
    );
    final connectivity = ConnectivityController();
    final offlineJournal = EncryptedOfflineJournal(
      PlatformJournalCipherStore(preferences, secureStorage),
    );
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
      credentials: credentials,
      entry: EntryController(
        gateway: ApiEntryGateway(apiClient, credentials),
        vault: credentials,
        telemetry: telemetry,
      ),
      catalog: CatalogController(
        repository: ApiCatalogRepository(apiClient),
        cache: CatalogCache(),
        telemetry: telemetry,
      ),
      cart: CartController(
        repository: ApiCartRepository(apiClient),
        telemetry: telemetry,
      ),
      checkout: CheckoutController(
        repository: ApiCheckoutRepository(apiClient),
        telemetry: telemetry,
      ),
      connectivity: connectivity,
      offlineJournal: offlineJournal,
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
  final CredentialVault credentials;
  final EntryController entry;
  final CatalogController catalog;
  final CartController cart;
  final CheckoutController checkout;
  final ConnectivityController connectivity;
  final EncryptedOfflineJournal offlineJournal;

  void dispose() {
    controller.dispose();
    entry.dispose();
    catalog.dispose();
    cart.dispose();
    checkout.dispose();
    connectivity.dispose();
    apiClient.dispose();
  }
}
