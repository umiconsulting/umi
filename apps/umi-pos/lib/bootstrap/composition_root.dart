import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../core/config/app_config.dart';
import '../core/contracts/contract_gateway.dart';
import '../core/errors/app_error.dart';
import '../core/feature_flags/feature_flags.dart';
import '../core/network/api_client.dart';
import '../core/network/lan_discovery.dart';
import '../core/network/lan_node_identity.dart';
import '../core/observability/telemetry.dart';
import '../core/platform/connectivity_plus_adapter.dart';
import '../core/platform/platform_adapters.dart';
import '../core/release/release_compatibility.dart';
import '../core/security/credential_vault.dart';
import '../core/security/device_key.dart';
import '../core/security/keystore_device_key.dart';
import '../core/security/operator_permissions.dart';
import '../core/security/tpm_backend.dart';
import '../core/security/tpm_device_key.dart';
import '../core/storage/local_working_copy.dart';
import '../core/storage/sealing_backend.dart';
import '../core/storage/storage.dart';
import '../core/storage/tpm_sealed_storage.dart';
import '../core/update/desktop_updater.dart';
import '../features/cart/cart_command_queue.dart';
import '../features/cart/cart_controller.dart';
import '../features/cart/cart_repository.dart';
import '../features/cart/incoming_orders_controller.dart';
import '../features/cash/cash_controller.dart';
import '../features/cash/cash_recovery_store.dart';
import '../features/cash/cash_repository.dart';
import '../features/catalog/catalog_controller.dart';
import '../features/catalog/catalog_repository.dart';
import '../features/checkout/checkout_controller.dart';
import '../features/checkout/checkout_repository.dart';
import '../features/customer_value/customer_value_controller.dart';
import '../features/customer_value/customer_value_repository.dart';
import '../features/entry/device_channel_socket_client.dart';
import '../features/entry/entry_controller.dart';
import '../features/entry/entry_gateway.dart';
import '../features/entry/pairing_socket_client.dart';
import '../features/exception/exception_controller.dart';
import '../features/exception/exception_recovery_store.dart';
import '../features/exception/exception_repository.dart';
import '../features/hardware/hardware_recovery_store.dart';
import '../features/hardware/hardware_repository.dart';
import '../features/hardware/hardware_runtime.dart';
import '../features/hardware/hardware_service.dart';
import '../features/hardware/pilot_hardware_adapters.dart';
import '../features/hardware/thermal_logo.dart';
import '../features/inventory/inventory_controller.dart';
import '../features/inventory/inventory_repository.dart';
import '../features/kitchen/hub_command_forwarder.dart';
import '../features/kitchen/kitchen_board_controller.dart';
import '../features/kitchen/kitchen_status_repository.dart';
import '../features/kitchen/lan_kds_board_repository.dart';
import '../features/kitchen/lan_kds_bridge.dart';
import '../features/kitchen/lan_kds_node.dart';
import '../features/kitchen/lan_kds_store.dart';
import '../features/kitchen/lan_mdns_advertiser.dart';
import '../features/kitchen/lan_peer_registration.dart';
import '../features/offline/connectivity_controller.dart';
import '../features/offline/offline_checkout_service.dart';
import '../features/offline/offline_journal.dart';
import '../features/offline/offline_policy.dart';
import '../features/offline/replay_engine.dart';
import '../features/sale/sale_lifecycle_controller.dart';
import '../features/sale/sale_repository.dart';
import '../features/tables/floor_plan_controller.dart';
import '../features/tables/local_first_table_state_repository.dart';
import '../features/tables/table_state_controller.dart';
import '../features/tables/table_state_repository.dart';
import '../shared/approvals/manager_approval_repository.dart';
import 'bootstrap_controller.dart';

final class HardwareRelayAccess {
  const HardwareRelayAccess({required this.canRead, required this.canExecute});

  factory HardwareRelayAccess.fromPermissions(Iterable<String> permissions) {
    final access = OperatorPermissions(permissions);
    return HardwareRelayAccess(
      canRead: access.allows('hardware.read'),
      canExecute: access.allows('hardware.command.execute'),
    );
  }

  final bool canRead;
  final bool canExecute;

  bool get isEnabled => canRead || canExecute;
}

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
    required this.incomingOrders,
    required this.cash,
    required this.checkout,
    required this.sales,
    this.kitchenStatus,
    this.kitchenBoard,
    this.floorPlan,
    this.tableState,
    this.customerValue,
    this.deviceChannel,
    required this.connectivity,
    required this.offlineJournal,
    this.inventory,
    this.hardware,
    this.offlineRecovery,
    this.updater = const NoopDesktopUpdater(),
    this.connectivityHeartbeat = true,
    this.lanKdsNode,
    this.lanKdsBridge,
    this.lanMdnsAdvertiser,
    this.lanPeerRegistration,
    this.hubCommandForwarder,
  }) {
    if (!kIsWeb && hardware != null) {
      entry.addListener(_scheduleHardwareRelay);
      _hardwareRelayTimer = Timer.periodic(
        const Duration(seconds: 10),
        (_) => _scheduleHardwareRelay(),
      );
      _scheduleHardwareRelay();
    }
    // Widget tests drive their own clock and assert that nothing is left
    // ticking; the probe is for a till in the field, not for a test harness.
    if (connectivityHeartbeat) _startConnectivityHeartbeat();
    unawaited(lanKdsNode?.start());
    unawaited(lanMdnsAdvertiser?.start());
    lanKdsBridge?.start();
    lanPeerRegistration?.start();
    hubCommandForwarder?.start();
    _observeInterface();
  }

  factory AppCompositionRoot.production() {
    final config = AppConfig.fromEnvironment();
    final telemetry = SafeTelemetry(
      enabled: config.telemetryEnabled,
      context: TelemetryContext.current(config),
      exporter: const NoopTelemetryExporter(),
    );
    // The vault backend. Default is the platform credential service. The
    // opt-in `UMIPOS_SECURE_STORAGE=tpm` build seals the vault to the TPM 2.0,
    // so a counter terminal never shows a keyring prompter.
    final SecureKeyValueStorage secureStorage = config.useTpmSealedStorage
        ? TpmSealedStorage(createSealingBackend())
        : const FlutterSecureKeyValueStorage();
    final credentials = CredentialVault(secureStorage);
    // One device key for the whole app. Default is the software Ed25519 key that
    // runs everywhere. Opt-in hardware builds: UMIPOS_DEVICE_KEY=tpm (desktop
    // TPM, backend selected web-safely by `tpm_backend.dart`) or =keystore
    // (mobile Android Keystore / iOS Secure Enclave over a MethodChannel).
    final DeviceKey deviceKey;
    if (config.useTpmDeviceKey) {
      deviceKey = TpmDeviceKey(createTpmBackend());
    } else if (config.useKeystoreDeviceKey) {
      deviceKey = KeystoreDeviceKey(MethodChannelKeystore());
    } else {
      deviceKey = SoftwareDeviceKey(secureStorage);
    }
    const preferences = SharedPreferencesStore();
    final localDatabase = SqliteLocalDatabase.openDefault();
    // The till's own view of the wire is the OS interface watch. Device
    // identity and app lifecycle stay unsupported until something needs them
    // (§8K step 1); an adapter that cannot watch leaves connectivity exactly as
    // it was, driven by the requests the till is making anyway.
    const platform = PlatformAdapters(
      connectivity: ConnectivityPlusConnectivity(),
      deviceIdentity: UnsupportedDeviceIdentity(),
      lifecycle: UnsupportedAppLifecycle(),
    );
    final apiClient = BoundedApiClient(
      config: config,
      telemetry: telemetry,
      tokenProvider: credentials,
      deviceCredentialProvider: ProvingDeviceCredentials(
        credentials,
        deviceKey,
      ),
      lanHubResolver: config.lanNodeEnabled
          ? FixedLanHubResolver(Uri.parse('http://127.0.0.1:$lanNodePort'))
          : MdnsLanHubResolver(fallback: config.lanHubUri),
    );
    final connectivity = ConnectivityController();
    apiClient.preferLanRoute = (path) {
      // The hub holds every cart this station fired, including carts the
      // cloud has not received yet. Send KDS work there first. A failed read
      // falls back to the cloud in BoundedApiClient.
      if (path.startsWith('/api/kds/command') ||
          path.contains('/kitchen/command')) {
        return true;
      }
      if (config.lanNodeEnabled) return false;
      return path.startsWith('/api/kds/board') ||
          path.contains('/kitchen/board') ||
          path.contains('/kitchen/stations');
    };
    final hardwareLab = PilotHardwareLab(
      allowSimulator: config.hardwareSimulatorEnabled,
      // The café's mark lives on the API, and a receipt freezes its URL with the
      // address that was current when the sale committed. Handing the lab the base
      // the till is configured with is what repairs a frozen loopback address at
      // print time instead of leaving the ticket without its mark.
      apiBaseUri: config.apiBaseUri,
      // A receipt printed after a cold start used to download, decode and
      // rasterise the same mark again: 1.31 s against 388 ms for the next copy
      // measured on the iMin. The one-bit image the head draws is durable, so
      // every later process can start from the bytes it already proved printable.
      logoSource: CachedThermalLogoSource(
        HttpThermalLogoSource(apiBaseUri: config.apiBaseUri),
        localDatabase,
      ),
    );
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
    final hubGateway = !config.lanNodeEnabled && config.lanHubUri != null
        ? ApiHubCommandGateway(apiClient)
        : null;
    final replayGateway = hubGateway == null
        ? ApiReplayGateway(apiClient)
        : HubAwareReplayGateway(
            delegate: ApiReplayGateway(apiClient),
            journal: offlineJournal,
            hub: hubGateway,
          );
    final offlineRecovery = OfflineRecoveryController(
      journal: offlineJournal,
      gateway: replayGateway,
      connectivity: connectivity,
    );
    final hubCommandForwarder = hubGateway == null
        ? null
        : HubCommandForwarder(journal: offlineJournal, gateway: hubGateway);
    final controller = BootstrapController(
      config: config,
      contracts: const GeneratedContractGateway(),
      releaseCompatibility: ApiReleaseCompatibilityGateway(
        api: apiClient,
        config: config,
      ),
      secureStorage: secureStorage,
      preferences: preferences,
      telemetry: telemetry,
    );
    // Null unless the build asks for the realtime nudge and knows where the API
    // is. `EntryController.dispose` cancels the watch, and cancelling the stream
    // closes the socket, so this needs no separate teardown here.
    final apiBaseUri = config.apiBaseUri;
    final pairingSocket = config.realtimeEnrollmentEnabled && apiBaseUri != null
        ? SocketIoPairingClient(baseUri: apiBaseUri)
        : null;
    // The till's own nudge — Phase 3 step 3 — under the SAME opt-in as the pairing
    // one, because it is the same capability: a deployment whose socket path
    // works. It is inert without a device credential (the handshake is the
    // credential the REST calls carry) and the poll stays the delivery path, so
    // switching this off restores the previous behaviour exactly.
    final deviceChannel = config.realtimeEnrollmentEnabled && apiBaseUri != null
        ? SocketIoDeviceChannelClient(
            baseUri: apiBaseUri,
            deviceIdentity: credentials.deviceIdentity,
          )
        : null;
    final entry = EntryController(
      gateway: ApiEntryGateway(
        apiClient,
        credentials,
        socketClient: pairingSocket,
        deviceKey: deviceKey,
        deviceKind: config.deviceKind,
      ),
      vault: credentials,
      telemetry: telemetry,
      idleTimeout: const Duration(minutes: 30),
    );
    Future<LanNodeIdentity?> lanIdentity() async {
      final state = entry.state;
      final merchant = state.selectedTenant;
      final location = state.selectedBranch;
      final operator = state.operator;
      final device = state.device;
      if (merchant == null ||
          location == null ||
          operator == null ||
          device == null) {
        return null;
      }
      return LanNodeIdentity(
        merchantId: merchant.id,
        locationId: location.id,
        operatorSessionId: operator.id,
        deviceId: device.id,
        credentialVersion: device.credentialVersion,
      );
    }

    // Let any request renew an expired access token once and retry, so a long
    // shift is not interrupted by the 30-minute access-token lifetime. The
    // renewal itself opts out of this path, so a dead session fails cleanly.
    apiClient.sessionRefresh = entry.renewAccessToken;
    final cash = CashController(
      repository: ApiCashRepository(apiClient),
      recoveryStore: SecureCashRecoveryStore(secureStorage),
      openShiftCache: SecureOpenShiftCache(secureStorage),
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
          // Nothing to ask: there is no device to ask it of. That is not a
          // drawer that failed to answer.
          return true;
        }
        final results = await hardware.afterCashAction(
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
        // The runtime answers with one entry per command: the command result, or
        // the error that stopped it. Anything that is not a command result is a
        // drawer the operator is waiting on.
        return results.every((result) => result is HardwareCommandResult);
      },
    );
    final cartRepository = ApiCartRepository(apiClient);
    final cart = CartController(
      repository: cartRepository,
      // The manager's PIN, asked for when the cart must void a line the kitchen already
      // started. It is the same elevation route the cash surfaces use — one call, one
      // place — and only the permission and the fingerprint differ.
      approvals: ApiManagerApprovalRepository(apiClient),
      telemetry: telemetry,
      workingCopy: localDatabase,
      offlineJournal: offlineJournal,
      deviceIdentity: () {
        final device = entry.state.device;
        return device == null
            ? null
            : CartDeviceIdentity(
                deviceId: device.id,
                credentialVersion: device.credentialVersion,
              );
      },
      connectivity: connectivity,
      recovery: offlineRecovery,
      hub: hubCommandForwarder,
    );
    final incomingOrders = IncomingOrdersController(
      repository: cartRepository,
      telemetry: telemetry,
    );
    final cloudKitchen = ApiKitchenBoardRepository(apiClient);
    final lanStore = LanKdsStore(localDatabase, journal: offlineJournal);
    final lanNode = config.lanNodeEnabled && config.apiBaseUri != null
        ? LanKdsNode(
            local: localDatabase,
            journal: offlineJournal,
            store: lanStore,
            identity: lanIdentity,
            cloudBase: config.apiBaseUri!,
            resolveConflict: (commandId) async {
              final identity = await lanIdentity();
              if (identity == null) return 0;
              final scope = ReplayScope(
                deviceId: identity.deviceId,
                merchantId: identity.merchantId,
                locationId: identity.locationId,
                operatorSessionId: identity.operatorSessionId,
                credentialVersion: identity.credentialVersion,
              );
              final retried = await offlineRecovery.resolveConflict(
                scope,
                commandId,
              );
              await offlineRecovery.recover(scope);
              return retried;
            },
          )
        : null;
    final lanBridge = config.lanNodeEnabled
        ? LanKdsBridge(
            repository: cloudKitchen,
            store: lanStore,
            identity: lanIdentity,
          )
        : null;
    final lanAdvertiser = config.lanNodeEnabled ? LanMdnsAdvertiser() : null;
    final lanPeerRegistration = config.lanNodeEnabled
        ? null
        : LanPeerRegistration(api: apiClient, identity: lanIdentity);
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
        workingCopy: localDatabase,
      ),
      cart: cart,
      incomingOrders: incomingOrders,
      cash: cash,
      sales: SaleLifecycleController(
        repository: ApiSaleRepository(apiClient),
        cart: cart,
        telemetry: telemetry,
        localFirstFastPathEnabled: config.localFirstFastPathEnabled,
      ),
      floorPlan: FloorPlanController(
        ApiFloorPlanRepository(apiClient),
        workingCopy: localDatabase,
      ),
      tableState: TableStateController(
        LocalFirstTableStateRepository(
          cloud: ApiTableStateRepository(apiClient),
          local: localDatabase,
          journal: offlineJournal,
          identity: () {
            final device = entry.state.device;
            return device == null
                ? null
                : TableDeviceIdentity(
                    deviceId: device.id,
                    credentialVersion: device.credentialVersion,
                  );
          },
          replay: offlineRecovery.recover,
          hubOwned: hubCommandForwarder != null,
        ),
      ),
      kitchenStatus: ApiKitchenStatusRepository(apiClient),
      kitchenBoard: KitchenBoardController(
        config.lanNodeEnabled && lanNode != null
            ? LanKdsBoardRepository(store: lanStore, cloud: cloudKitchen)
            : cloudKitchen,
        // The board reads on the operator session and writes on the till's own
        // POS command route, so the cook can bump a dish without the screen it
        // was read from going away (§8H step 3). That route authenticates with
        // the session the ApiClient already carries — no separate header.
        commands: ApiKitchenStatusRepository(apiClient),
        // The board is the busiest API client on a kitchen till, so its own
        // traffic is what keeps the till's connectivity state honest.
        connectivity: connectivity,
      ),
      customerValue: CustomerValueController(
        ApiCustomerValueRepository(apiClient),
      ),
      deviceChannel: deviceChannel,
      checkout: CheckoutController(
        repository: ApiCheckoutRepository(apiClient),
        offlineCheckout: offlineCheckout,
        connectivity: connectivity,
        recovery: offlineRecovery,
        localFirstFastPathEnabled: config.localFirstFastPathEnabled,
        pendingLocalCommands: () => cart.hasPendingForCurrentCart,
        preserveLocalCommands: cart.preservePendingCommands,
        refreshOfflinePolicy: () async {
          final state = entry.state;
          final tenant = state.selectedTenant;
          final branch = state.selectedBranch;
          final operator = state.operator;
          final device = state.device;
          if (tenant == null ||
              branch == null ||
              operator == null ||
              device == null ||
              !OperatorPermissions(
                operator.permissions,
              ).allows('offline.replay')) {
            return;
          }
          await offlineRecovery.refreshPolicy(
            ReplayScope(
              deviceId: device.id,
              merchantId: tenant.id,
              locationId: branch.id,
              operatorSessionId: operator.id,
              credentialVersion: device.credentialVersion,
            ),
          );
        },
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
            return null;
          }
          final outcome = await hardware.afterCheckoutCompleted(
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
          // The drawer's pulse is the one result the cashier cannot get any
          // other way. When it does not
          // answer, the receipt screen says so (plan §8.2 F5).
          return outcome.drawerAnswered ? null : 'DRAWER_UNANSWERED';
        },
        afterOfflineCommit: (commit) async {
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
          await hardware.afterOfflineCashSale(
            HardwareScope(
              merchantId: merchant.id,
              locationId: location.id,
              operatorSessionId: operator.id,
              deviceId: posDevice.id,
              credentialVersion: posDevice.credentialVersion,
              permissions: operator.permissions.toSet(),
              registerId: cash.activeRegisterId,
            ),
            commit,
          );
        },
      ),
      connectivity: connectivity,
      offlineJournal: offlineJournal,
      inventory: InventoryController(ApiInventoryRepository(apiClient)),
      hardware: hardware,
      offlineRecovery: offlineRecovery,
      updater: createDesktopUpdater(
        owner: config.updateGithubOwner,
        repo: config.updateGithubRepo,
        currentVersion: config.release.version,
      ),
      lanKdsNode: lanNode,
      lanKdsBridge: lanBridge,
      lanMdnsAdvertiser: lanAdvertiser,
      lanPeerRegistration: lanPeerRegistration,
      hubCommandForwarder: hubCommandForwarder,
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
  final IncomingOrdersController incomingOrders;
  final CashController cash;
  final CheckoutController checkout;
  final SaleLifecycleController sales;
  final KitchenStatusRepository? kitchenStatus;
  final KitchenBoardController? kitchenBoard;
  final FloorPlanController? floorPlan;
  final TableStateController? tableState;
  final CustomerValueController? customerValue;
  final DeviceChannelSocketClient? deviceChannel;
  final ConnectivityController connectivity;
  final EncryptedOfflineJournal offlineJournal;
  final InventoryController? inventory;
  final HardwareService? hardware;
  final OfflineRecoveryController? offlineRecovery;
  final LanKdsNode? lanKdsNode;
  final LanKdsBridge? lanKdsBridge;
  final LanMdnsAdvertiser? lanMdnsAdvertiser;
  final LanPeerRegistration? lanPeerRegistration;
  final HubCommandForwarder? hubCommandForwarder;

  /// Whether this root owns the standing reachability probe.
  ///
  /// Off in widget tests: a periodic timer would outlive `pumpWidget` and every
  /// "no pending timers" assertion would fail for a reason unrelated to what
  /// the test is about.
  final bool connectivityHeartbeat;

  /// Desktop self-updater. A no-op unless the build runs as a Linux AppImage
  /// with an update repo configured.
  final DesktopUpdater updater;
  Timer? _hardwareRelayTimer;
  bool _hardwareRelayBusy = false;
  Timer? _connectivityHeartbeat;
  bool _heartbeatInFlight = false;
  bool _hubProbeInFlight = false;
  // Long-lived by design: the root holds this watch for its whole life and
  // cancels it in `dispose`, which is where every other teardown for the root
  // lives. The lint only reads one method, so it cannot follow the handle.
  // ignore: cancel_subscriptions
  StreamSubscription<bool>? _interfaceWatch;
  bool _disposed = false;

  /// Feed the controller from the operating system's interface state.
  ///
  /// The OS source is earlier than the request path: a dropped interface is a
  /// fact here at once, where requests only report it once they have failed.
  /// The direction of each signal is decided in the controller, not here — a
  /// gone interface goes straight to offline, a returning interface only to
  /// `recovering`, because an interface being up is not the API answering.
  void _observeInterface() {
    // Idempotent: a second call replaces the watch rather than adding one.
    _cancelInterfaceWatch();
    final watch = platform.connectivity.watch();
    if (watch != null) {
      _interfaceWatch = watch.listen(
        _interfaceChanged,
        // An adapter that throws on its own stream is a broken source, not a
        // down interface. Take no position rather than guess, and keep the
        // subscription so a later transition still arrives.
        onError: (Object _) {},
      );
    }
    unawaited(_readInterfaceOnce());
  }

  /// Detach the interface watch, if one is attached.
  ///
  /// The field is cleared *before* the cancel is awaited, and the handle is
  /// taken to a local first. An `await` between reading the field and clearing
  /// it would let this microtask land after the next `listen` and null out the
  /// subscription that replaced it, which leaks the watch this exists to stop.
  void _cancelInterfaceWatch() {
    final previous = _interfaceWatch;
    _interfaceWatch = null;
    if (previous != null) unawaited(previous.cancel());
  }

  void _interfaceChanged(bool present) {
    if (_disposed) return;
    if (present) {
      connectivity.networkUp();
    } else {
      connectivity.networkDown();
    }
  }

  /// The one-shot boot read ([ConnectivityAdapter.isOnline]).
  ///
  /// Only the negative answer is authoritative: "there is no interface" is a
  /// fact a platform can assert, while "an interface is up" says nothing at all
  /// about the API. So a positive read changes no state — it would be the exact
  /// guess this design exists to avoid — and it is never awaited on the boot
  /// path, because the till must start whether or not the watcher answers.
  Future<void> _readInterfaceOnce() async {
    final CapabilityResult<bool> read;
    try {
      read = await platform.connectivity.isOnline();
    } on Object {
      return;
    }
    if (_disposed) return;
    if (read.status == CapabilityStatus.ready && read.value == false) {
      connectivity.networkDown();
    }
  }

  void _scheduleHardwareRelay() {
    if (_hardwareRelayBusy) return;
    _hardwareRelayBusy = true;
    unawaited(
      _drainHardwareRelay().whenComplete(() => _hardwareRelayBusy = false),
    );
  }

  /// Ask the API whether it is there, on a clock the operator can feel.
  ///
  /// Local-first removed the thing that used to answer this question by
  /// accident: every tap made a request, so every tap refreshed the
  /// reachability counters. Once taps stop touching the network, a till whose
  /// backend dies keeps the last positive answer on screen for the rest of the
  /// shift — the header says "En línea" while nothing is reachable, and because
  /// [OfflineRecoveryController] only replays on a transition, a pending sale
  /// never drains when the backend comes back. Both failures have one cause and
  /// one fix: a standing probe with a short deadline.
  ///
  /// The probe is `GET /health/live` with auth refresh disabled. It answers
  /// reachability only; credential validity is still decided by the operations
  /// themselves, which is why a blocked till stays blocked in
  /// [ConnectivityController.apiReachable]. The deadline is shorter than the
  /// client's 15 s request timeout on purpose: a till must decide "I am offline"
  /// in seconds, not in the length of a queue that builds while it waits.
  void _startConnectivityHeartbeat() {
    _connectivityHeartbeat = Timer.periodic(connectivityHeartbeatInterval, (_) {
      _beat();
      _probeHub();
    });
    _beat();
    _probeHub();
  }

  static const connectivityHeartbeatInterval = Duration(seconds: 10);
  static const connectivityHeartbeatDeadline = Duration(seconds: 4);

  Future<void> _beat() async {
    if (_disposed || _heartbeatInFlight) return;
    _heartbeatInFlight = true;
    try {
      final answer = await apiClient
          .request(
            method: ApiMethod.get,
            path: '/health/live',
            idempotent: true,
            authRefresh: false,
          )
          .timeout(connectivityHeartbeatDeadline);
      if (answer['lanNode'] == true) {
        connectivity.apiFailure();
        return;
      }
      connectivity.apiReachable(authorityValid: true);
      // Level-triggered: even without a connectivity edge, a sale waiting in the
      // journal drains as soon as the API is proven reachable.
      await offlineRecovery?.replayIfPending();
    } on AppException catch (error) {
      // The server answered. It refused because its budget is full, which is
      // the opposite of an unreachable API: marking it offline would hide the
      // "online" tools and make the request storm worse.
      if (error.code == 'RATE_LIMITED') {
        connectivity.apiReachable(authorityValid: true);
        return;
      }
      connectivity.apiFailure();
    } on Object {
      connectivity.apiFailure();
    } finally {
      _heartbeatInFlight = false;
    }
  }

  Future<void> _probeHub() async {
    if (_disposed || _hubProbeInFlight) return;
    final probe = apiClient;
    if (probe is! BoundedApiClient) {
      connectivity.hubNotConfigured();
      return;
    }
    _hubProbeInFlight = true;
    try {
      final answer = await probe.probeLanHub();
      if (_disposed) return;
      if (answer == null) {
        connectivity.hubNotConfigured();
      } else if (answer) {
        connectivity.hubReachable(selfHost: config.lanNodeEnabled);
      } else {
        connectivity.hubUnreachable();
      }
    } finally {
      _hubProbeInFlight = false;
    }
  }

  Future<void> _drainHardwareRelay() async {
    final service = hardware;
    final state = entry.state;
    final merchant = state.selectedTenant;
    final location = state.selectedBranch;
    final operator = state.operator;
    final device = state.device;
    if (service == null ||
        merchant == null ||
        location == null ||
        operator == null ||
        device == null) {
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
    final access = HardwareRelayAccess.fromPermissions(operator.permissions);
    if (!access.isEnabled) return;
    try {
      // THE READING IS THE EXPENSIVE PART OF THE RELAY, AND THE CLAIM IS NOT.
      //
      // One read carries the queue of the whole location, and the till asked for it
      // every ten seconds whether or not a screen showed the hardware (measured
      // 2026-10-12: 8,600 reads and 8,000 claims each day for one till). The read now
      // waits for the cadence the service states, and a screen at the hardware keeps
      // the fast one. The claim is the delivery path for a remote command: it stays at
      // ten seconds.
      // Refresh the registry and remote-command queue without putting a USB
      // status query in front of a receipt. A hardware screen asks for the
      // measured state itself; this background read carries the last measurement.
      if (access.canRead && service.runtimeReadDue) {
        await service.snapshot(scope, probeHealth: false);
      }
      if (access.canExecute) {
        for (var index = 0; index < 4; index++) {
          if (await service.executeNextRemoteCommand(scope) == null) break;
        }
      }
    } catch (_) {
      // The next bounded poll recovers the relay. Financial state is unchanged.
    }
  }

  void dispose() {
    _disposed = true;
    _cancelInterfaceWatch();
    _hardwareRelayTimer?.cancel();
    _connectivityHeartbeat?.cancel();
    lanKdsBridge?.stop();
    lanPeerRegistration?.stop();
    hubCommandForwarder?.dispose();
    final lanNodeStop = lanKdsNode?.stop();
    if (lanNodeStop != null) unawaited(lanNodeStop);
    final mdnsStop = lanMdnsAdvertiser?.stop();
    if (mdnsStop != null) unawaited(mdnsStop);
    entry.removeListener(_scheduleHardwareRelay);
    controller.dispose();
    entry.dispose();
    exceptions.dispose();
    catalog.dispose();
    cart.dispose();
    cash.dispose();
    checkout.dispose();
    sales.dispose();
    kitchenBoard?.dispose();
    floorPlan?.dispose();
    tableState?.dispose();
    customerValue?.dispose();
    final deviceChannelClose = deviceChannel?.close();
    if (deviceChannelClose != null) unawaited(deviceChannelClose);
    connectivity.dispose();
    offlineRecovery?.dispose();
    inventory?.dispose();
    final hardwareDispose = hardware?.dispose();
    if (hardwareDispose != null) unawaited(hardwareDispose);
    apiClient.dispose();
  }
}
