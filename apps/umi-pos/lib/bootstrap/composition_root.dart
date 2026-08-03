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
import '../features/cash/cash_controller.dart';
import '../features/cash/cash_recovery_store.dart';
import '../features/cash/cash_repository.dart';
import '../features/catalog/catalog_controller.dart';
import '../features/catalog/catalog_repository.dart';
import '../features/checkout/checkout_controller.dart';
import '../features/checkout/checkout_repository.dart';
import '../features/entry/entry_controller.dart';
import '../features/entry/entry_gateway.dart';
import '../features/exception/exception_controller.dart';
import '../features/exception/exception_recovery_store.dart';
import '../features/exception/exception_repository.dart';
import '../features/offline/connectivity_controller.dart';
import '../features/offline/offline_checkout_service.dart';
import '../features/offline/offline_journal.dart';
import '../features/offline/offline_policy.dart';
import '../features/offline/replay_engine.dart';
import '../features/sale/sale_lifecycle_controller.dart';
import '../features/sale/sale_repository.dart';
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
    required this.exceptions,
    required this.catalog,
    required this.cart,
    required this.cash,
    required this.checkout,
    required this.sales,
    required this.connectivity,
    required this.offlineJournal,
    this.offlineRecovery,
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
    final policyCache = OfflinePolicyCache(offlineJournal);
    final offlineCheckout = OfflineCheckoutService(
      journal: offlineJournal,
      policyCache: policyCache,
      eligibility: const OfflineCheckoutEligibilityEngine(),
    );
    final offlineRecovery = OfflineRecoveryController(
      journal: offlineJournal,
      gateway: ApiReplayGateway(apiClient),
      connectivity: connectivity,
    );
    final controller = BootstrapController(
      config: config,
      contracts: const GeneratedContractGateway(),
      secureStorage: secureStorage,
      telemetry: telemetry,
    );
    final cart = CartController(
      repository: ApiCartRepository(apiClient),
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
      exceptions: SaleExceptionController(
        repository: ApiSaleExceptionRepository(apiClient),
        recoveryStore: SecureSaleExceptionRecoveryStore(secureStorage),
      ),
      catalog: CatalogController(
        repository: ApiCatalogRepository(apiClient),
        cache: CatalogCache(),
        telemetry: telemetry,
      ),
      cart: cart,
      cash: CashController(
        repository: ApiCashRepository(apiClient),
        recoveryStore: SecureCashRecoveryStore(secureStorage),
      ),
      sales: SaleLifecycleController(
        repository: ApiSaleRepository(apiClient),
        cart: cart,
        telemetry: telemetry,
      ),
      checkout: CheckoutController(
        repository: ApiCheckoutRepository(apiClient),
        offlineCheckout: offlineCheckout,
        connectivity: connectivity,
        telemetry: telemetry,
      ),
      connectivity: connectivity,
      offlineJournal: offlineJournal,
      offlineRecovery: offlineRecovery,
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
  final SaleExceptionController exceptions;
  final CatalogController catalog;
  final CartController cart;
  final CashController cash;
  final CheckoutController checkout;
  final SaleLifecycleController sales;
  final ConnectivityController connectivity;
  final EncryptedOfflineJournal offlineJournal;
  final OfflineRecoveryController? offlineRecovery;

  void dispose() {
    controller.dispose();
    entry.dispose();
    exceptions.dispose();
    catalog.dispose();
    cart.dispose();
    cash.dispose();
    checkout.dispose();
    sales.dispose();
    connectivity.dispose();
    offlineRecovery?.dispose();
    apiClient.dispose();
  }
}
