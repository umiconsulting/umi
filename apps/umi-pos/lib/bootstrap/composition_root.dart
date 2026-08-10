import 'dart:async';

import 'package:flutter/foundation.dart';

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
import '../features/customer_value/customer_value_controller.dart';
import '../features/customer_value/customer_value_repository.dart';
import '../features/entry/entry_controller.dart';
import '../features/entry/entry_gateway.dart';
import '../features/exception/exception_controller.dart';
import '../features/exception/exception_recovery_store.dart';
import '../features/exception/exception_repository.dart';
import '../features/hardware/hardware_recovery_store.dart';
import '../features/hardware/hardware_repository.dart';
import '../features/hardware/hardware_runtime.dart';
import '../features/hardware/hardware_service.dart';
import '../features/hardware/pilot_hardware_adapters.dart';
import '../features/inventory/inventory_controller.dart';
import '../features/inventory/inventory_repository.dart';
import '../features/kitchen/kitchen_status_repository.dart';
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
    this.kitchenStatus,
    this.customerValue,
    required this.connectivity,
    required this.offlineJournal,
    this.inventory,
    this.hardware,
    this.offlineRecovery,
  }) {
    if (!kIsWeb && hardware != null) {
      entry.addListener(_scheduleHardwareRelay);
      _hardwareRelayTimer = Timer.periodic(
        const Duration(seconds: 10),
        (_) => _scheduleHardwareRelay(),
      );
      _scheduleHardwareRelay();
    }
  }

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
    final hardwareLab = PilotHardwareLab();
    final hardware = HardwareService(
      repository: ApiHardwareRepository(apiClient),
      coordinator: HardwareCoordinator(adapters: const {}, devices: const []),
      recovery: SecureHardwareRecoveryStore(secureStorage),
      adapterResolver: hardwareLab,
    );
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
    final entry = EntryController(
      gateway: ApiEntryGateway(apiClient, credentials),
      vault: credentials,
      telemetry: telemetry,
    );
    final cash = CashController(
      repository: ApiCashRepository(apiClient),
      recoveryStore: SecureCashRecoveryStore(secureStorage),
      afterCommit: (action) async {
        final state = entry.state;
        final merchant = state.selectedTenant;
        final location = state.selectedBranch;
        final operator = state.operator;
        final posDevice = state.device;
        if (merchant == null ||
            location == null ||
            operator == null ||
            posDevice == null) {
          return;
        }
        await hardware.afterCashAction(
          HardwareScope(
            merchantId: merchant.id,
            locationId: location.id,
            operatorSessionId: operator.id,
            deviceId: posDevice.id,
            credentialVersion: posDevice.credentialVersion,
            permissions: operator.permissions.toSet(),
            registerId: action.registerId,
          ),
          reason: action.reason,
          reference: action.reference,
        );
      },
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
      entry: entry,
      exceptions: SaleExceptionController(
        repository: ApiSaleExceptionRepository(apiClient),
        recoveryStore: SecureSaleExceptionRecoveryStore(secureStorage),
        afterCommit: (result) async {
          final state = entry.state;
          final merchant = state.selectedTenant;
          final location = state.selectedBranch;
          final operator = state.operator;
          final posDevice = state.device;
          if (merchant == null ||
              location == null ||
              operator == null ||
              posDevice == null) {
            return;
          }
          await hardware.afterRefundCompleted(
            HardwareScope(
              merchantId: merchant.id,
              locationId: location.id,
              operatorSessionId: operator.id,
              deviceId: posDevice.id,
              credentialVersion: posDevice.credentialVersion,
              permissions: operator.permissions.toSet(),
              registerId: cash.activeRegisterId,
            ),
            result,
          );
        },
      ),
      catalog: CatalogController(
        repository: ApiCatalogRepository(apiClient),
        cache: CatalogCache(),
        telemetry: telemetry,
      ),
      cart: cart,
      cash: cash,
      sales: SaleLifecycleController(
        repository: ApiSaleRepository(apiClient),
        cart: cart,
        telemetry: telemetry,
      ),
      kitchenStatus: ApiKitchenStatusRepository(apiClient),
      customerValue: CustomerValueController(
        ApiCustomerValueRepository(apiClient),
      ),
      checkout: CheckoutController(
        repository: ApiCheckoutRepository(apiClient),
        offlineCheckout: offlineCheckout,
        connectivity: connectivity,
        telemetry: telemetry,
        afterCommit: (result) async {
          final state = entry.state;
          final merchant = state.selectedTenant;
          final location = state.selectedBranch;
          final operator = state.operator;
          final posDevice = state.device;
          if (merchant == null ||
              location == null ||
              operator == null ||
              posDevice == null) {
            return;
          }
          await hardware.afterCheckoutCompleted(
            HardwareScope(
              merchantId: merchant.id,
              locationId: location.id,
              operatorSessionId: operator.id,
              deviceId: posDevice.id,
              credentialVersion: posDevice.credentialVersion,
              permissions: operator.permissions.toSet(),
              registerId: cash.activeRegisterId,
            ),
            result,
          );
        },
        afterOfflineCommit: (receipt) async {
          final state = entry.state;
          final merchant = state.selectedTenant;
          final location = state.selectedBranch;
          final operator = state.operator;
          final posDevice = state.device;
          if (merchant == null ||
              location == null ||
              operator == null ||
              posDevice == null) {
            return;
          }
          await hardware.afterOfflineCheckoutCompleted(
            HardwareScope(
              merchantId: merchant.id,
              locationId: location.id,
              operatorSessionId: operator.id,
              deviceId: posDevice.id,
              credentialVersion: posDevice.credentialVersion,
              permissions: operator.permissions.toSet(),
              registerId: cash.activeRegisterId,
            ),
            receipt,
          );
        },
      ),
      connectivity: connectivity,
      offlineJournal: offlineJournal,
      inventory: InventoryController(ApiInventoryRepository(apiClient)),
      hardware: hardware,
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
  final KitchenStatusRepository? kitchenStatus;
  final CustomerValueController? customerValue;
  final ConnectivityController connectivity;
  final EncryptedOfflineJournal offlineJournal;
  final InventoryController? inventory;
  final HardwareService? hardware;
  final OfflineRecoveryController? offlineRecovery;
  Timer? _hardwareRelayTimer;
  bool _hardwareRelayBusy = false;

  void _scheduleHardwareRelay() {
    if (_hardwareRelayBusy) return;
    _hardwareRelayBusy = true;
    unawaited(_drainHardwareRelay().whenComplete(() => _hardwareRelayBusy = false));
  }

  Future<void> _drainHardwareRelay() async {
    final service = hardware;
    final state = entry.state;
    final merchant = state.selectedTenant;
    final location = state.selectedBranch;
    final operator = state.operator;
    final device = state.device;
    if (service == null || merchant == null || location == null || operator == null || device == null) {
      return;
    }
    final scope = HardwareScope(
      merchantId: merchant.id,
      locationId: location.id,
      operatorSessionId: operator.id,
      deviceId: device.id,
      credentialVersion: device.credentialVersion,
      permissions: operator.permissions.toSet(),
      registerId: cash.activeRegisterId,
    );
    try {
      await service.snapshot(scope);
      for (var index = 0; index < 4; index++) {
        if (await service.executeNextRemoteCommand(scope) == null) break;
      }
    } catch (_) {
      // The next bounded poll recovers the relay. Financial state is unchanged.
    }
  }

  void dispose() {
    _hardwareRelayTimer?.cancel();
    entry.removeListener(_scheduleHardwareRelay);
    controller.dispose();
    entry.dispose();
    exceptions.dispose();
    catalog.dispose();
    cart.dispose();
    cash.dispose();
    checkout.dispose();
    sales.dispose();
    customerValue?.dispose();
    connectivity.dispose();
    offlineRecovery?.dispose();
    inventory?.dispose();
    final hardwareDispose = hardware?.dispose();
    if (hardwareDispose != null) unawaited(hardwareDispose);
    apiClient.dispose();
  }
}
