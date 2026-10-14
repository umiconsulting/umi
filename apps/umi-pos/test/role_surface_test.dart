import 'dart:async';

import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/cash/cash_controller.dart';
import 'package:umi_pos/features/cash/cash_repository.dart';
import 'package:umi_pos/features/catalog/catalog_controller.dart';
import 'package:umi_pos/features/catalog/catalog_repository.dart';
import 'package:umi_pos/features/catalog/catalog_surface.dart';
import 'package:umi_pos/features/entry/entry_controller.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';
import 'package:umi_pos/features/hardware/hardware_recovery_store.dart';
import 'package:umi_pos/features/hardware/hardware_repository.dart';
import 'package:umi_pos/features/hardware/hardware_runtime.dart';
import 'package:umi_pos/features/hardware/hardware_service.dart';
import 'package:umi_pos/features/kitchen/kitchen_board_controller.dart';
import 'package:umi_pos/features/kitchen/kitchen_board_surface.dart';
import 'package:umi_pos/features/kitchen/kitchen_push_notifications.dart';
import 'package:umi_pos/features/kitchen/kitchen_status_repository.dart';
import 'package:umi_pos/features/sale/sale_lifecycle_controller.dart';
import 'package:umi_pos/features/sale/sale_repository.dart';
import 'package:umi_pos/features/sale/sale_surface.dart';

import 'support/fakes.dart';

/// F1 of the integrated-operation plan: the till looks like the role that
/// signed in. The shell is driven end to end here — the same `CatalogSurface`
/// the app mounts — so the tab that an operator sees is proven, not inferred
/// from the permission model alone.

final class _SessionGateway implements EntryGateway {
  _SessionGateway(this.permissions);

  final List<String> permissions;

  @override
  Future<OperatorSessionView> startOperator(
    String merchantId,
    String locationId,
  ) async => OperatorSessionView(
    id: 'operator',
    userId: 'user',
    staffId: 'staff',
    merchantId: merchantId,
    locationId: locationId,
    deviceId: 'device',
    state: 'active',
    permissions: permissions,
    entitlements: const [],
    startedAt: '2026-10-07T00:00:00Z',
    lastActivityAt: '2026-10-07T00:00:00Z',
    expiresAt: '2026-10-08T00:00:00Z',
  );

  @override
  Future<void> lockOperator(String id) async {}

  @override
  Future<void> logout() async {}

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

/// An enrolled device the owner marked as a KDS, with an operator who may sell.
/// The device kind is the gate under test (plan §7 D6): the same operator sells
/// on a till and cannot on this one.
final class _KdsEntryGateway implements EntryGateway {
  _KdsEntryGateway({this.deviceType = 'kds', this.permissions});
  final String deviceType;
  final List<String>? permissions;
  static const _deviceId = '00000000-0000-4000-8000-0000000000d1';

  static Map<String, Object?> _merchant() => {
    'id': 'merchant',
    'name': 'Test café',
    'roles': <Object?>[],
    'permissions': <Object?>[],
    'entitlements': <Object?>[],
    'locations': [
      {
        'id': 'location',
        'merchantId': 'merchant',
        'name': 'Test location',
        'status': 'active',
        'deviceAllowed': true,
        'operatorAllowed': true,
      },
    ],
  };

  @override
  Future<DeviceSummary> deviceStatus() async => DeviceSummary(
    id: _deviceId,
    publicId: '00000000-0000-4000-8000-0000000000d2',
    merchantId: 'merchant',
    locationId: 'location',
    displayName: 'Kitchen screen',
    type: deviceType,
    platform: 'android',
    mobility: 'static',
    state: 'active',
    credentialVersion: 1,
    lastSeenAt: null,
    rotationRequired: false,
    revokedAt: null,
    replacementDeviceId: null,
  );

  @override
  Future<PosSessionResponse> pinLogin({
    required String pin,
    required String merchantId,
    required String locationId,
  }) async => const PosSessionResponse(
    session: {
      'user': {'displayName': 'Cook'},
    },
    tokens: {'accessToken': 'access', 'refreshToken': 'refresh'},
  );

  @override
  Future<EntryContextResponse> entryContext() async =>
      EntryContextResponse(merchants: [_merchant()]);

  @override
  Future<OperatorSessionView> startOperator(
    String merchantId,
    String locationId,
  ) async => OperatorSessionView(
    id: 'operator',
    userId: 'user',
    staffId: 'staff',
    merchantId: 'merchant',
    locationId: 'location',
    deviceId: _deviceId,
    state: 'active',
    permissions:
        permissions ??
        const [
          'cart.write',
          'cash.shift.read',
          'sale.lifecycle',
          'order.fire',
          'kitchen.read',
          'kitchen.prepare',
        ],
    entitlements: [],
    startedAt: '2026-10-07T00:00:00Z',
    lastActivityAt: '2026-10-07T00:00:00Z',
    expiresAt: '2026-10-08T00:00:00Z',
  );

  @override
  Future<void> lockOperator(String id) async {}

  @override
  Future<void> logout() async {}

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

/// A device enrolled by the server as a KDS, driven to `ready` the way the app
/// does it: initialize (device status) then the PIN.
Future<EntryController> _readyKdsEntry({
  String deviceType = 'kds',
  List<String>? permissions,
}) async {
  final vault = CredentialVault(MemorySecureStorage());
  await vault.saveDevice(
    id: _KdsEntryGateway._deviceId,
    publicId: '00000000-0000-4000-8000-0000000000d2',
    credential: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
    credentialVersion: 1,
    state: 'active',
    merchantId: 'merchant',
    locationId: 'location',
  );
  final entry = EntryController(
    gateway: _KdsEntryGateway(deviceType: deviceType, permissions: permissions),
    vault: vault,
    telemetry: SafeTelemetry(
      enabled: false,
      context: TelemetryContext.current(testConfig),
      exporter: RecordingExporter(),
    ),
    idleTimeout: const Duration(seconds: 30),
  );
  await entry.initialize();
  await entry.loginWithPin('1234');
  return entry;
}

Future<EntryController> _readyEntry(List<String> permissions) async {
  final entry = EntryController(
    gateway: _SessionGateway(permissions),
    vault: CredentialVault(MemorySecureStorage()),
    telemetry: SafeTelemetry(
      enabled: false,
      context: TelemetryContext.current(testConfig),
      exporter: RecordingExporter(),
    ),
    idleTimeout: const Duration(seconds: 30),
  );
  await entry.selectTenant(
    EntryMerchant.fromJson({
      'id': 'merchant',
      'name': 'Test café',
      'roles': [],
      'permissions': [],
      'entitlements': [],
      'locations': [
        {
          'id': 'location',
          'merchantId': 'merchant',
          'name': 'Test location',
          'status': 'active',
          'deviceAllowed': true,
          'operatorAllowed': true,
        },
      ],
    }),
  );
  return entry;
}

final class _EmptyCatalogRepository implements CatalogRepository {
  @override
  Future<CatalogCategoriesResponse> categories(
    CatalogPartition partition,
  ) async => const CatalogCategoriesResponse(
    items: [],
    catalogVersion: 'v1',
    updatedAt: '2026-10-07T00:00:00Z',
  );

  @override
  Future<CatalogPage> products(
    CatalogPartition partition, {
    String? categoryId,
    String? search,
    String? barcode,
    String? cursor,
    CancellationToken? cancellation,
  }) async => const CatalogPage(
    items: [],
    nextCursor: null,
    catalogVersion: 'v1',
    updatedAt: '2026-10-07T00:00:00Z',
  );

  @override
  Future<CatalogProductDetail> detail(
    CatalogPartition partition,
    String productId,
  ) => throw UnimplementedError();
}

CatalogController _catalog() => CatalogController(
  repository: _EmptyCatalogRepository(),
  cache: CatalogCache(),
  telemetry: SafeTelemetry(
    enabled: false,
    context: TelemetryContext.current(testConfig),
    exporter: RecordingExporter(),
  ),
);

/// A board repository whose watch holds, like the server's held request, so the
/// board parks instead of scheduling its retry timer.
final class _BoardRepository implements KitchenBoardRepository {
  @override
  Future<List<KitchenOrderProjection>> snapshot(
    String merchantId,
    PosKitchenOrderQuery query,
  ) async => const [];

  @override
  Future<KitchenAllDayCounts> allDay(
    String merchantId,
    PosKitchenAllDayQuery query,
  ) async => (businessDate: '2026-10-07', items: const <KitchenAllDayItem>[]);

  @override
  Future<bool> watch(String merchantId, PosKitchenOrderQuery query) =>
      Completer<bool>().future;

  @override
  Future<List<KitchenStation>> stations(
    String merchantId,
    PosKitchenOrderQuery query,
  ) async => const [];

  @override
  Future<PrepList> prepList(String merchantId, PosPrepListQuery query) =>
      throw UnimplementedError();
}

final class _CommandRepository implements KitchenCommandRepository {
  @override
  Future<KitchenCommandResult> command(
    String merchantId,
    PosKitchenCommandRequest request,
  ) => throw UnimplementedError();
}

/// A cart with one line, and a fire that marks it as the server would.
final class _SellerCartRepository implements CartRepository {
  _SellerCartRepository(this.cart);
  Cart cart;
  FireOrderRequest? lastFired;
  String? lastFulfillment;
  int addCalls = 0;

  @override
  Future<Cart> read(String merchantId, CartQuery query) async => cart;

  @override
  Future<Cart> create(String merchantId, CreateCartRequest request) async =>
      cart;

  @override
  Future<FireOrderResult> fire(
    String merchantId,
    FireOrderRequest request,
  ) async {
    lastFired = request;
    cart = Cart(
      id: cart.id,
      merchantId: cart.merchantId,
      locationId: cart.locationId,
      operatorSessionId: cart.operatorSessionId,
      status: cart.status,
      version: cart.version + 1,
      firedOrderId: '00000000-0000-4000-8000-0000000000f1',
      fulfillmentType: cart.fulfillmentType,
      // The server stamps the lines it sent; the till only reads them back.
      items: [
        for (final item in cart.items) {...item, 'fired': true},
      ],
      totals: cart.totals,
      checkoutEnabled: cart.checkoutEnabled,
      checkoutMessageCode: cart.checkoutMessageCode,
      updatedAt: '2026-10-07T12:00:00.000Z',
    );
    return FireOrderResult(
      cartId: request.cartId,
      cartVersion: cart.version,
      orderId: cart.firedOrderId!,
      reference: 'A-101',
      lineCount: 1,
      firedAt: '2026-10-07T12:00:00.000Z',
    );
  }

  @override
  Future<Cart> add(String merchantId, CartLineInput input) async {
    addCalls += 1;
    return cart;
  }

  @override
  Future<Cart> update(String merchantId, String lineId, CartLineInput input) =>
      throw UnimplementedError();

  @override
  Future<Cart> remove(
    String merchantId,
    String lineId,
    RemoveCartLineRequest input,
  ) => throw UnimplementedError();

  @override
  Future<Cart> prepare(String merchantId, PrepareSaleRequest input) =>
      throw UnimplementedError();

  @override
  Future<Cart> clear(String merchantId, ClearCartRequest input) =>
      throw UnimplementedError();

  @override
  Future<PosIncomingOrders> incomingOrders(
    String merchantId,
    CartQuery query,
  ) => throw UnimplementedError();

  @override
  Future<Cart> bindOrigin(String merchantId, BindCartOriginRequest input) =>
      throw UnimplementedError();

  @override
  Future<Cart> setFulfillment(
    String merchantId,
    SetCartFulfillmentRequest input,
  ) async {
    lastFulfillment = input.fulfillmentType;
    cart = Cart(
      id: cart.id,
      merchantId: cart.merchantId,
      locationId: cart.locationId,
      operatorSessionId: cart.operatorSessionId,
      status: cart.status,
      version: cart.version + 1,
      firedOrderId: cart.firedOrderId,
      fulfillmentType: input.fulfillmentType,
      items: cart.items,
      totals: cart.totals,
      checkoutEnabled: cart.checkoutEnabled,
      checkoutMessageCode: cart.checkoutMessageCode,
      updatedAt: '2026-10-07T11:30:00.000Z',
    );
    return cart;
  }
}

final class _LineKitchenStatus implements KitchenStatusRepository {
  String itemStatus = 'queued';

  @override
  Future<PosKitchenStatusResult> status(
    String merchantId,
    String sourceOrderId,
    PosKitchenOrderQuery query,
  ) async => PosKitchenStatusResult(
    kitchenOrderId: '00000000-0000-4000-8000-0000000000f2',
    sourceOrderId: sourceOrderId,
    publicReference: 'Cuenta 101',
    status: itemStatus == 'ready' ? 'ready' : 'queued',
    priority: 'normal',
    version: itemStatus == 'ready' ? 2 : 1,
    stationIds: const [],
    items: [
      {
        'sourceOrderItemId': '00000000-0000-4000-8000-0000000000d3',
        'status': itemStatus,
      },
    ],
    readyItems: itemStatus == 'ready'
        ? const [
            {'id': '00000000-0000-4000-8000-0000000000d4', 'sound': null},
          ]
        : const [],
    updatedAt: '2026-10-14T18:00:00.000Z',
  );
}

Cart _openCart() => Cart(
  id: '00000000-0000-4000-8000-0000000000c1',
  merchantId: 'merchant',
  locationId: 'location',
  operatorSessionId: 'operator',
  status: 'draft',
  version: 1,
  firedOrderId: null,
  fulfillmentType: 'dine_in',
  items: const [
    {
      'id': '00000000-0000-4000-8000-0000000000d1',
      'productId': '00000000-0000-4000-8000-0000000000d2',
      'productName': 'Latte',
      'saleAction': 'merchandise',
      'quantity': 1,
      'courseNumber': 1,
      'variant': null,
      'modifiers': <Object?>[],
      'note': null,
      'fired': false,
      'price': {
        'unitPrice': {'minorUnits': 6500, 'currency': 'MXN'},
        'lineSubtotal': {'minorUnits': 6500, 'currency': 'MXN'},
        'tax': {'minorUnits': 1000, 'currency': 'MXN'},
        'lineTotal': {'minorUnits': 6500, 'currency': 'MXN'},
        'taxRateBasisPoints': 1600,
      },
    },
  ],
  totals: const {
    'subtotal': {'minorUnits': 6500, 'currency': 'MXN'},
    'tax': {'minorUnits': 1000, 'currency': 'MXN'},
    'discounts': {
      'total': {'minorUnits': 0, 'currency': 'MXN'},
      'entries': <Object?>[],
    },
    'grandTotal': {'minorUnits': 6500, 'currency': 'MXN'},
    'businessDate': '2026-10-07',
  },
  checkoutEnabled: false,
  checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
  updatedAt: '2026-10-07T11:00:00.000Z',
);

Widget _app(
  Widget child, {
  TextScaler? textScaler,
  Locale locale = const Locale('es'),
}) => PosApp(
  locale: locale,
  theme: UmiTheme.light(),
  supportedLocales: AppLocalizations.supportedLocales,
  localizationsDelegates: const [
    AppLocalizations.delegate,

    GlobalWidgetsLocalizations.delegate,
  ],
  builder: textScaler == null
      ? null
      : (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: textScaler),
          child: child!,
        ),
  home: child,
);

Finder _navLabel(String text) =>
    find.descendant(of: find.byType(PosNavigation), matching: find.text(text));

final class _HistoryRepository implements SaleRepository {
  final queries = <SaleHistoryQuery>[];

  @override
  Future<SaleHistoryPage> history(
    String merchantId,
    SaleHistoryQuery query,
  ) async {
    queries.add(query);
    return const SaleHistoryPage(items: [], nextCursor: null);
  }

  @override
  Future<SaleSnapshot> current(
    String merchantId,
    SaleHistoryQuery query,
  ) async => SaleSnapshot(
    id: _openCart().id,
    state: 'building_cart',
    cart: _openCart().toJson(),
    label: null,
    customer: null,
    originalOperatorSessionId: 'operator',
    currentOperatorSessionId: 'operator',
    suspendedAt: null,
    cancelledAt: null,
    cancellationReasonCode: null,
    cancellationReason: null,
    committedSaleId: null,
    sourceOrderId: null,
    receiptId: null,
    receiptRef: null,
    updatedAt: '2026-10-07T11:00:00.000Z',
  );

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

final class _CashRepository implements CashRepository {
  @override
  Future<CashCenterSnapshot> center(
    String merchantId,
    CashCenterQuery query,
  ) async => const CashCenterSnapshot(
    businessDate: '2026-10-08',
    policy: {
      'version': 'cash-v1',
      'currency': 'MXN',
      'openingFloatRequired': true,
      'maximumOpeningFloat': {'minorUnits': 100000, 'currency': 'MXN'},
    },
    registers: [
      {
        'id': 'register',
        'displayName': 'Caja principal',
        'currency': 'MXN',
        'version': 1,
      },
    ],
    ledger: [],
    adoptableShift: null,
    currentShift: null,
    expectedCash: null,
    latestCount: null,
    varianceResolution: null,
    reconciliation: null,
    recoveryState: 'shift_required',
    allowedActions: ['open_shift'],
    summary: null,
  );
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

final class _ScanCatalogRepository implements CatalogRepository {
  final _empty = _EmptyCatalogRepository();
  Completer<CatalogPage>? pending;
  int barcodeCalls = 0;

  CatalogPage get matches => const CatalogPage(
    items: [
      {
        'id': 'scan-product',
        'name': 'Café',
        'description': null,
        'sku': 'CAF-1',
        'hasBarcode': true,
        'category': null,
        'price': {'minorUnits': 4500, 'currency': 'MXN'},
        'taxRateBasisPoints': 1600,
        'saleAction': 'merchandise',
        'availability': 'enabled',
        'availableFrom': null,
        'primaryMedia': null,
        'hasVariants': false,
        'hasModifiers': false,
        'updatedAt': '2026-10-08T00:00:00Z',
      },
    ],
    nextCursor: null,
    catalogVersion: 'v1',
    updatedAt: '2026-10-08T00:00:00Z',
  );

  @override
  Future<CatalogCategoriesResponse> categories(CatalogPartition partition) =>
      _empty.categories(partition);
  @override
  Future<CatalogPage> products(
    CatalogPartition partition, {
    String? categoryId,
    String? search,
    String? barcode,
    String? cursor,
    CancellationToken? cancellation,
  }) async {
    if (barcode == null) return _empty.products(partition);
    barcodeCalls += 1;
    return pending?.future ?? Future.value(matches);
  }

  @override
  Future<CatalogProductDetail> detail(CatalogPartition partition, String id) =>
      throw UnimplementedError();
}

final class _ScanHardwareRepository implements HardwareRepository {
  @override
  Future<HardwareRuntimeSnapshot> snapshot(
    String merchantId,
    HardwareRegistryQuery query,
  ) async => HardwareRuntimeSnapshot(
    merchantId: merchantId,
    locationId: query.locationId,
    registerId: null,
    devices: const [],
    printJobs: const [],
    recoveryStates: const [],
    pendingJobs: 0,
    retryableJobs: 0,
    unknownCommands: 0,
    capturedAt: '2026-10-08T00:00:00Z',
  );
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

void main() {
  for (final language in ['es', 'en']) {
    testWidgets(
      'new sale advertises focus before any key after a hidden $language text change',
      (tester) async {
        tester.view.physicalSize = const Size(1280, 1000);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final semantics = tester.ensureSemantics();
        final root = testRoot();
        final entry = await _readyEntry(['cart.write', 'sale.lifecycle']);
        final catalog = _catalog();
        final cart = CartController(
          repository: _SellerCartRepository(_openCart()),
          telemetry: root.telemetry,
        )..restore(_openCart());
        final surface = CatalogSurface(
          entry: entry,
          catalog: catalog,
          cart: cart,
          cash: root.cash,
          checkout: root.checkout,
          sales: root.sales,
          exceptions: root.exceptions,
          connectivity: root.connectivity,
          telemetry: root.telemetry,
        );
        try {
          await tester.pumpWidget(
            _app(
              surface,
              locale: Locale(language),
              textScaler: TextScaler.linear(1),
            ),
          );
          await tester.pumpAndSettle();
          await tester.tap(
            _navLabel(language == 'es' ? 'Ajustes' : 'Settings'),
          );
          await tester.pumpAndSettle();
          await tester.pumpWidget(
            _app(
              surface,
              locale: Locale(language),
              textScaler: TextScaler.linear(2),
            ),
          );
          await tester.pumpAndSettle();
          await tester.tap(_navLabel(language == 'es' ? 'Comanda' : 'Order'));
          await tester.pumpAndSettle();
          final label = language == 'es' ? 'Nueva venta' : 'New sale';
          final icon = find
              .descendant(
                of: find.descendant(
                  of: find.byType(PosHeader),
                  matching: find.byTooltip(label),
                ),
                matching: find.byType(PosIcon),
              )
              .first;
          expect(
            tester.getSemantics(icon),
            isSemantics(
              label: label,
              isButton: true,
              isEnabled: true,
              isFocusable: true,
              hasTapAction: true,
              hasFocusAction: true,
            ),
          );
          expect(cart.state.cart?.version, 1);
          expect(tester.takeException(), isNull);
        } finally {
          await tester.pumpWidget(const SizedBox());
          semantics.dispose();
          catalog.dispose();
          cart.dispose();
          entry.dispose();
          root.dispose();
        }
      },
    );
  }

  testWidgets(
    'header does not restore an action removed from the permitted surface',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final permissions = ['cart.write', 'sale.lifecycle'];
      final root = testRoot();
      final entry = await _readyEntry(permissions);
      final catalog = _catalog();
      final cart = CartController(
        repository: _SellerCartRepository(_openCart()),
        telemetry: root.telemetry,
      )..restore(_openCart());
      try {
        await tester.pumpWidget(
          _app(
            CatalogSurface(
              entry: entry,
              catalog: catalog,
              cart: cart,
              cash: root.cash,
              checkout: root.checkout,
              sales: root.sales,
              exceptions: root.exceptions,
              connectivity: root.connectivity,
              telemetry: root.telemetry,
            ),
          ),
        );
        await tester.pumpAndSettle();
        final action = find.descendant(
          of: find.byType(PosHeader),
          matching: find.text('Nueva venta'),
        );
        final original = Focus.of(tester.element(action));
        original.requestFocus();
        await tester.pump();
        // Controlled session data; this is not a server authorization assertion.
        permissions.remove('sale.lifecycle');
        tester.view.physicalSize = const Size(812, 375);
        await tester.pumpAndSettle();
        expect(find.text('Nueva venta'), findsNothing);
        expect(find.byTooltip('Nueva venta'), findsNothing);
        expect(FocusManager.instance.primaryFocus, isNot(same(original)));
        expect(cart.state.cart?.id, _openCart().id);
        expect(cart.state.cart?.version, 1);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        catalog.dispose();
        cart.dispose();
        entry.dispose();
        root.dispose();
      }
    },
  );

  for (final locale in ['es', 'en']) {
    for (final action in ['newSale', 'overflow', 'account']) {
      testWidgets(
        'header retains $action focus across $locale layout and text changes',
        (tester) async {
          tester.view.physicalSize = const Size(1280, 1000);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          final root = testRoot();
          final entry = await _readyEntry([
            'cart.write',
            'cash.shift.read',
            'sale.lifecycle',
          ]);
          final catalog = _catalog();
          final cart = CartController(
            repository: _SellerCartRepository(_openCart()),
            telemetry: root.telemetry,
          )..restore(_openCart());
          final surface = CatalogSurface(
            entry: entry,
            catalog: catalog,
            cart: cart,
            cash: root.cash,
            checkout: root.checkout,
            sales: root.sales,
            exceptions: root.exceptions,
            connectivity: root.connectivity,
            telemetry: root.telemetry,
          );
          Finder target(bool compact, String language) {
            final spanish = language == 'es';
            final header = find.byType(PosHeader);
            if (action == 'newSale' && !compact) {
              return find.descendant(
                of: header,
                matching: find.text(spanish ? 'Nueva venta' : 'New sale'),
              );
            }
            final label = switch (action) {
              'newSale' => spanish ? 'Nueva venta' : 'New sale',
              'overflow' => spanish ? 'Más' : 'More',
              _ => spanish ? 'Cuenta' : 'Account',
            };
            return find
                .descendant(
                  of: find.descendant(
                    of: header,
                    matching: find.byTooltip(label),
                  ),
                  matching: find.byType(PosIcon),
                )
                .first;
          }

          try {
            await tester.pumpWidget(
              _app(
                surface,
                locale: Locale(locale),
                textScaler: TextScaler.linear(1),
              ),
            );
            await tester.pumpAndSettle();
            final original = Focus.of(tester.element(target(false, locale)));
            original.requestFocus();
            await tester.pump();
            tester.view.physicalSize = const Size(812, 375);
            await tester.pumpAndSettle();
            expect(
              FocusManager.instance.primaryFocus,
              same(original),
              reason:
                  'the action intent must survive entering the scroll and changing its presentation',
            );
            expect(target(true, locale).hitTestable(), findsOneWidget);
            tester.view.physicalSize = const Size(1280, 1000);
            await tester.pumpAndSettle();
            expect(FocusManager.instance.primaryFocus, same(original));
            await tester.pumpWidget(
              _app(
                surface,
                locale: Locale(locale),
                textScaler: TextScaler.linear(2),
              ),
            );
            await tester.pumpAndSettle();
            expect(
              FocusManager.instance.primaryFocus,
              same(original),
              reason: 'large text changes the action presentation too',
            );
            final other = locale == 'es' ? 'en' : 'es';
            await tester.pumpWidget(
              _app(
                surface,
                locale: Locale(other),
                textScaler: TextScaler.linear(2),
              ),
            );
            await tester.pumpAndSettle();
            expect(FocusManager.instance.primaryFocus, same(original));
            expect(target(true, other).hitTestable(), findsOneWidget);
            expect(cart.state.cart?.id, _openCart().id);
            expect(cart.state.cart?.version, 1);
            expect(find.byType(PosAlertDialog), findsNothing);
            expect(
              ModalRoute.of(tester.element(target(true, other)))?.isFirst,
              isTrue,
            );
            expect(tester.takeException(), isNull);
          } finally {
            await tester.pumpWidget(const SizedBox());
            catalog.dispose();
            cart.dispose();
            entry.dispose();
            root.dispose();
          }
        },
      );
    }
  }

  testWidgets(
    'scanner respects the active destination and cancels an old lookup',
    (tester) async {
      tester.view.physicalSize = const Size(1400, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final root = testRoot();
      final entry = await _readyKdsEntry(
        deviceType: 'pos',
        permissions: const [
          'cart.write',
          'cash.shift.read',
          'sale.lifecycle',
          'hardware.scanner.use',
        ],
      );
      final repository = _ScanCatalogRepository();
      final catalog = CatalogController(
        repository: repository,
        cache: CatalogCache(),
        telemetry: root.telemetry,
      );
      final cartRepository = _SellerCartRepository(_openCart());
      final cart = CartController(
        repository: cartRepository,
        telemetry: root.telemetry,
      )..restore(_openCart());
      final sales = SaleLifecycleController(
        repository: _HistoryRepository(),
        cart: cart,
        telemetry: root.telemetry,
      );
      final cash = CashController(repository: _CashRepository());
      final scanner = ScannerSimulatorAdapter();
      final hardware = HardwareService(
        repository: _ScanHardwareRepository(),
        coordinator: HardwareCoordinator(adapters: const {}, devices: const []),
        recovery: MemoryHardwareRecoveryStore(),
        scannerSimulator: scanner,
      );
      try {
        await tester.pumpWidget(
          _app(
            CatalogSurface(
              entry: entry,
              catalog: catalog,
              cart: cart,
              cash: cash,
              checkout: root.checkout,
              sales: sales,
              exceptions: root.exceptions,
              connectivity: root.connectivity,
              telemetry: root.telemetry,
              hardware: hardware,
            ),
          ),
        );
        await tester.pump();
        for (final destination in ['Ventas', 'Caja']) {
          await tester.tap(_navLabel(destination));
          await tester.pump();
          scanner.emit('hidden-$destination');
          await tester.pump();
          expect(repository.barcodeCalls, 0, reason: destination);
          expect(cartRepository.addCalls, 0, reason: destination);
        }
        await tester.tap(_navLabel('Comanda'));
        await tester.pump();
        scanner.emit('visible-order');
        await tester.pump();
        expect(repository.barcodeCalls, 1);
        expect(cartRepository.addCalls, 1);
        repository.pending = Completer<CatalogPage>();
        scanner.emit('delayed-order');
        await tester.pump();
        expect(repository.barcodeCalls, 2);
        scanner.emit('queued-order');
        await tester.pump();
        await tester.tap(_navLabel('Ventas'));
        await tester.pump();
        await tester.tap(_navLabel('Comanda'));
        await tester.pump();
        repository.pending!.complete(repository.matches);
        await tester.pump();
        expect(cartRepository.addCalls, 1);
        expect(repository.barcodeCalls, 2);
        repository.pending = null;
        scanner.emit('current-order');
        await tester.pump();
        expect(cartRepository.addCalls, 2);
        final routeContext = tester.element(find.byType(PosNavigation));
        final dialog = showPosDialog<void>(
          context: routeContext,
          builder: (_) => const PosAlertDialog(
            title: Text('Confirmar'),
            content: Text('Acción temporal'),
          ),
        );
        await tester.pump(const Duration(milliseconds: 300));
        scanner.emit('covered-order');
        await tester.pump();
        expect(cartRepository.addCalls, 2);
        Navigator.of(routeContext).pop();
        await tester.pump(const Duration(milliseconds: 300));
        await dialog;
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        await tester.runAsync(hardware.dispose);
        catalog.dispose();
        sales.dispose();
        cash.dispose();
        cart.dispose();
        entry.dispose();
        root.dispose();
      }
    },
  );

  testWidgets('primary destinations retain navigation and the current order', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final root = testRoot();
    final entry = await _readyEntry(const [
      'cart.write',
      'cash.shift.read',
      'sale.lifecycle',
    ]);
    final catalog = _catalog();
    final cart = CartController(
      repository: _SellerCartRepository(_openCart()),
      telemetry: root.telemetry,
    )..restore(_openCart());
    final historyRepository = _HistoryRepository();
    final sales = SaleLifecycleController(
      repository: historyRepository,
      cart: cart,
      telemetry: root.telemetry,
    );
    final cash = CashController(repository: _CashRepository());
    await sales.open('merchant', 'location', 'operator');
    try {
      await tester.pumpWidget(
        _app(
          CatalogSurface(
            entry: entry,
            catalog: catalog,
            cart: cart,
            cash: cash,
            checkout: root.checkout,
            sales: sales,
            exceptions: root.exceptions,
            connectivity: root.connectivity,
            telemetry: root.telemetry,
          ),
        ),
      );
      await tester.pump();
      final search = find.descendant(
        of: find.byKey(const ValueKey('hardware-barcode-search')),
        matching: find.byType(EditableText),
      );
      await tester.enterText(search, 'espresso');
      Focus.of(tester.element(_navLabel('Ventas'))).requestFocus();
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(
        Focus.of(tester.element(_navLabel('Ventas'))).hasPrimaryFocus,
        isTrue,
        reason: 'keyboard activation must allow continuing through navigation',
      );
      final route = ModalRoute.of(tester.element(find.byType(PosNavigation)));
      expect(route?.isCurrent, isTrue);
      expect(route?.isFirst, isTrue);
      expect(
        tester.widget<PosNavigation>(find.byType(PosNavigation)).selectedIndex,
        // The rail lists only the surfaces this composition holds — no floor plan, so
        // no Cuentas — and after the owner's order (Comanda first, cash after sales,
        // 2026-10-12) Ventas is the second of them.
        1,
      );
      expect(_navLabel('Comanda').hitTestable(), findsOneWidget);
      expect(find.text('Latte'), findsNothing);
      expect(cart.state.cart?.items.single['productName'], 'Latte');
      expect(cart.state.cart?.version, 1);
      await tester.tap(_navLabel('Comanda'));
      await tester.pump();
      expect(find.text('Latte'), findsOneWidget);
      expect(tester.widget<EditableText>(search).controller.text, 'espresso');
      expect(
        tester.widget<PosNavigation>(find.byType(PosNavigation)).selectedIndex,
        0,
      );
      expect(tester.takeException(), isNull);
      await tester.tap(_navLabel('Caja'));
      await tester.pump();
      await tester.tap(find.byTooltip('Aumentar cantidad de MXN 50.00'));
      await tester.pump();
      await tester.tap(find.byTooltip('Aumentar cantidad de MXN 20.00'));
      await tester.pump();
      void expectCountedNotes() {
        for (final amount in ['50.00', '20.00']) {
          final field = find.byWidgetPredicate(
            (widget) =>
                widget is PosField &&
                widget.semanticLabel == 'Cantidad de MXN $amount',
          );
          expect(field, findsOneWidget);
          expect(tester.widget<PosField>(field).controller?.text, '1');
          expect(find.text('= MXN $amount'), findsOneWidget);
        }
      }

      expect(find.text('MXN 70.00'), findsOneWidget);
      expectCountedNotes();
      await tester.tap(_navLabel('Ventas'));
      await tester.pump();
      await tester.tap(_navLabel('Caja'));
      await tester.pump();
      expect(find.text('MXN 70.00'), findsOneWidget);
      expectCountedNotes();
      tester.view.physicalSize = const Size(1024, 768);
      await tester.pump();
      expect(find.text('MXN 70.00'), findsOneWidget);
      expectCountedNotes();
      tester.view.physicalSize = const Size(375, 812);
      await tester.pump();
      expect(find.text('MXN 70.00'), findsOneWidget);
      expectCountedNotes();
      await tester.tap(_navLabel('Ventas'));
      await tester.pump();
      await tester.tap(find.text('Todas las ventas'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ventas suspendidas'));
      await tester.pumpAndSettle();
      final historySearch = find.descendant(
        of: find.byType(SaleCenterSurface),
        matching: find.byType(PosField),
      );
      await tester.enterText(historySearch, 'croissant');
      await tester.pump();
      await tester.tap(find.text('Recientes'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Antiguas'));
      await tester.pumpAndSettle();
      tester.view.physicalSize = const Size(1280, 720);
      await tester.pumpAndSettle();
      final filter = find.ancestor(
        of: find.text('Ventas suspendidas'),
        matching: find.byType(PosTapRegion),
      );
      expect(tester.widget<PosTapRegion>(filter).selected, isTrue);
      await tester.tap(_navLabel('Caja'));
      await tester.pump();
      expect(find.text('MXN 70.00'), findsOneWidget);
      expectCountedNotes();
      await tester.tap(find.byTooltip('Disminuir cantidad de MXN 20.00'));
      await tester.pump();
      expect(find.text('MXN 50.00'), findsNWidgets(2));
      expect(find.text('= MXN 20.00'), findsNothing);
      await tester.tap(_navLabel('Ventas'));
      await tester.pumpAndSettle();
      expect(tester.widget<PosTapRegion>(filter).selected, isTrue);
      expect(
        tester.widget<PosField>(historySearch).controller?.text,
        'croissant',
      );
      expect(historyRepository.queries.last.state, 'suspended');
      expect(historyRepository.queries.last.search, 'croissant');
      expect(historyRepository.queries.last.sort, 'oldest');
      expect(tester.takeException(), isNull);
    } finally {
      await tester.pumpWidget(const SizedBox());
      catalog.dispose();
      sales.dispose();
      cash.dispose();
      cart.dispose();
      entry.dispose();
      root.dispose();
    }
  });

  testWidgets('mobile overflow names the current destination', (tester) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    var selected = 0;
    await tester.pumpWidget(
      _app(
        StatefulBuilder(
          builder: (_, update) => PosPage(
            bottomNavigationBar: PosNavigation(
              selectedIndex: selected,
              onDestinationSelected: (index) => update(() => selected = index),
              destinations: [
                for (final label in [
                  'Comanda',
                  'Caja',
                  'Ventas',
                  'Mesas',
                  'KDS',
                  'Pedidos',
                  'Ajustes',
                ])
                  PosDestination(
                    icon: const PosIcon(PosGlyphs.receiptOutlined),
                    label: label,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Más'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('KDS'));
    await tester.pumpAndSettle();
    expect(selected, 4);
    expect(find.text('KDS'), findsOneWidget);
    expect(find.text('Más'), findsNothing);
    expect(find.byTooltip('KDS, más secciones'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'a seller lands on the comanda with its tabs and not the kitchen',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1400, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final root = testRoot();
      final entry = await _readyEntry(const [
        'cart.write',
        'cash.shift.read',
        'sale.lifecycle',
        'offline.replay',
      ]);
      await tester.pumpWidget(
        _app(
          CatalogSurface(
            entry: entry,
            catalog: _catalog(),
            cart: root.cart,
            cash: root.cash,
            checkout: root.checkout,
            sales: root.sales,
            exceptions: root.exceptions,
            connectivity: root.connectivity,
            telemetry: root.telemetry,
          ),
        ),
      );
      await tester.pump();

      expect(_navLabel('Comanda'), findsOneWidget);
      expect(_navLabel('Caja'), findsOneWidget);
      expect(_navLabel('Ventas'), findsOneWidget);
      expect(_navLabel('KDS'), findsNothing);

      await tester.pumpWidget(const SizedBox());
      await tester.pump();
      entry.dispose();
      root.dispose();
    },
  );

  testWidgets('a cook lands on the kitchen and is never shown the comanda', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1400, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final root = testRoot();
    final entry = await _readyEntry(const ['kitchen.read', 'kitchen.prepare']);
    final board = KitchenBoardController(
      _BoardRepository(),
      commands: _CommandRepository(),
      connectivity: root.connectivity,
    );
    await tester.pumpWidget(
      _app(
        CatalogSurface(
          entry: entry,
          catalog: _catalog(),
          cart: root.cart,
          cash: root.cash,
          checkout: root.checkout,
          sales: root.sales,
          exceptions: root.exceptions,
          connectivity: root.connectivity,
          telemetry: root.telemetry,
          kitchenBoard: board,
        ),
      ),
    );
    await tester.pump();

    // The cook's home is the kitchen board, embedded under the tab bar; the
    // tabs that would refuse are not there at all (finding 6), and the order
    // surface that painted the red banner is not mounted (findings 4 and 5).
    expect(find.byType(KitchenBoardSurface), findsOneWidget);
    expect(
      tester
          .widget<KitchenBoardSurface>(find.byType(KitchenBoardSurface))
          .embedded,
      isTrue,
    );
    expect(_navLabel('KDS'), findsOneWidget);
    expect(_navLabel('Ajustes'), findsOneWidget);
    expect(_navLabel('Comanda'), findsNothing);
    expect(_navLabel('Caja'), findsNothing);
    expect(_navLabel('Ventas'), findsNothing);

    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    board.dispose();
    entry.dispose();
    root.dispose();
  });

  testWidgets('a KDS device does not offer the sale surface to a seller', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final root = testRoot();
    final entry = await _readyKdsEntry();
    expect(entry.state.device?.type, 'kds');
    // The operator holds the seller permissions — the device is what removes the
    // till, which is what "the device declares what it is" means (D6).
    expect(entry.state.operator?.permissions, contains('cart.write'));
    final board = KitchenBoardController(
      _BoardRepository(),
      commands: _CommandRepository(),
      connectivity: root.connectivity,
    );
    await tester.pumpWidget(
      _app(
        CatalogSurface(
          entry: entry,
          catalog: _catalog(),
          cart: root.cart,
          cash: root.cash,
          checkout: root.checkout,
          sales: root.sales,
          exceptions: root.exceptions,
          connectivity: root.connectivity,
          telemetry: root.telemetry,
          kitchenBoard: board,
        ),
      ),
    );
    await tester.pump();

    expect(find.byType(KitchenBoardSurface), findsOneWidget);
    expect(_navLabel('KDS'), findsOneWidget);
    expect(_navLabel('Comanda'), findsNothing);
    expect(_navLabel('Caja'), findsNothing);
    expect(_navLabel('Ventas'), findsNothing);

    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    board.dispose();
    entry.dispose();
    root.dispose();
  });

  testWidgets('a seller fires the cart and the marker replaces the button', (
    tester,
  ) async {
    // The wide till is what shows the cart beside the grid, with the fire
    // action in the reachable band. The view API is what MediaQuery reads.
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final root = testRoot();
    final entry = await _readyEntry(const [
      'cart.write',
      'order.fire',
      'cash.shift.read',
      'sale.lifecycle',
    ]);
    final cartRepository = _SellerCartRepository(_openCart());
    final cart = CartController(
      repository: cartRepository,
      telemetry: root.telemetry,
    );
    cart.restore(cartRepository.cart);
    await tester.pumpWidget(
      _app(
        CatalogSurface(
          entry: entry,
          catalog: _catalog(),
          cart: cart,
          cash: root.cash,
          checkout: root.checkout,
          sales: root.sales,
          exceptions: root.exceptions,
          connectivity: root.connectivity,
          telemetry: root.telemetry,
        ),
      ),
    );
    await tester.pump();

    // The pinned row shows the verb; the tooltip carries the whole phrase, so
    // the accessible name is unchanged.
    expect(find.byTooltip('Enviar a cocina'), findsOneWidget);
    await tester.tap(find.byTooltip('Enviar a cocina'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 10));

    expect(cartRepository.lastFired, isNotNull);
    expect(cart.state.cart?.firedOrderId, isNotNull);
    expect(find.text('Enviado · Cuenta abierta'), findsOneWidget);
    expect(find.byTooltip('Enviar a cocina'), findsNothing);

    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    cart.dispose();
    entry.dispose();
    root.dispose();
  });

  testWidgets('the top-bar order type reaches the cart', (tester) async {
    final loader = FontLoader('IBM Plex Sans');
    for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
      loader.addFont(rootBundle.load('assets/fonts/IBMPlexSans-$weight.ttf'));
    }
    await loader.load();
    final headings = FontLoader('Bricolage Grotesque');
    for (final weight in ['SemiBold', 'Bold']) {
      headings.addFont(
        rootBundle.load('assets/fonts/BricolageGrotesque12pt-$weight.ttf'),
      );
    }
    await headings.load();
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final root = testRoot();
    final entry = await _readyEntry(const [
      'cart.write',
      'cash.shift.read',
      'sale.lifecycle',
    ]);
    final cartRepository = _SellerCartRepository(_openCart());
    final cart = CartController(
      repository: cartRepository,
      telemetry: root.telemetry,
    );
    cart.restore(cartRepository.cart);
    await tester.pumpWidget(
      _app(
        CatalogSurface(
          entry: entry,
          catalog: _catalog(),
          cart: cart,
          cash: root.cash,
          checkout: root.checkout,
          sales: root.sales,
          exceptions: root.exceptions,
          connectivity: root.connectivity,
          telemetry: root.telemetry,
        ),
      ),
    );
    await tester.pump();

    // The choice in the top bar is screen state AND a cart fact: it has to reach
    // the server, or a fired takeaway order would still be written as dine-in.
    await tester.tap(find.text('Para llevar'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 10));

    expect(cartRepository.lastFulfillment, 'takeout');
    expect(cart.state.cart?.fulfillmentType, 'takeout');

    final surface = tester.widget<CatalogSurface>(find.byType(CatalogSurface));
    tester.view.physicalSize = const Size(375, 812);
    await tester.pumpWidget(_app(surface, textScaler: TextScaler.linear(2)));
    await tester.pumpAndSettle();
    expect(cart.state.cart?.fulfillmentType, 'takeout');
    expect(find.byType(PosSelect<String>), findsOneWidget);
    await tester.tap(find.text('Para llevar'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Comer aquí'));
    await tester.pumpAndSettle();
    expect(cartRepository.lastFulfillment, 'dine_in');
    expect(cart.state.cart?.fulfillmentType, 'dine_in');
    expect(cart.state.cart?.id, _openCart().id);
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    cart.dispose();
    entry.dispose();
    root.dispose();
  });

  testWidgets('a line added after the fire brings the send button back', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final root = testRoot();
    final entry = await _readyEntry(const [
      'cart.write',
      'order.fire',
      'cash.shift.read',
      'sale.lifecycle',
    ]);
    final base = _openCart();
    final sent = base.items.first;
    // One line the kitchen has, one the operator just rang: the second round.
    final cartRepository = _SellerCartRepository(
      Cart(
        id: base.id,
        merchantId: base.merchantId,
        locationId: base.locationId,
        operatorSessionId: base.operatorSessionId,
        status: base.status,
        version: 2,
        firedOrderId: '00000000-0000-4000-8000-0000000000f1',
        fulfillmentType: base.fulfillmentType,
        items: [
          {...sent, 'fired': true},
          {...sent, 'id': '00000000-0000-4000-8000-0000000000d9'},
        ],
        totals: base.totals,
        checkoutEnabled: base.checkoutEnabled,
        checkoutMessageCode: base.checkoutMessageCode,
        updatedAt: base.updatedAt,
      ),
    );
    final cart = CartController(
      repository: cartRepository,
      telemetry: root.telemetry,
    );
    cart.restore(cartRepository.cart);
    await tester.pumpWidget(
      _app(
        CatalogSurface(
          entry: entry,
          catalog: _catalog(),
          cart: cart,
          cash: root.cash,
          checkout: root.checkout,
          sales: root.sales,
          exceptions: root.exceptions,
          connectivity: root.connectivity,
          telemetry: root.telemetry,
        ),
      ),
    );
    await tester.pump();

    // The fired line says so, and the button is back for the line the kitchen
    // does not have (plan §8.2 F6).
    expect(find.text('Enviada'), findsOneWidget);
    expect(find.byTooltip('Enviar a cocina'), findsOneWidget);
    expect(find.text('Enviada a cocina'), findsNothing);

    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    cart.dispose();
    entry.dispose();
    root.dispose();
  });

  testWidgets(
    'the comanda changes a fired line to Listo after kitchen marks it ready',
    (tester) async {
      tester.view.physicalSize = const Size(1400, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final root = testRoot();
      final entry = await _readyEntry(const ['cart.write', 'order.fire']);
      final base = _openCart();
      final kitchen = _LineKitchenStatus();
      final sent = Cart(
        id: base.id,
        merchantId: base.merchantId,
        locationId: base.locationId,
        operatorSessionId: base.operatorSessionId,
        status: base.status,
        version: 2,
        firedOrderId: '00000000-0000-4000-8000-0000000000f1',
        fulfillmentType: base.fulfillmentType,
        items: [
          {
            ...base.items.single,
            'fired': true,
            'firedOrderItemId': '00000000-0000-4000-8000-0000000000d3',
          },
        ],
        totals: base.totals,
        checkoutEnabled: base.checkoutEnabled,
        checkoutMessageCode: base.checkoutMessageCode,
        updatedAt: base.updatedAt,
      );
      final cart = CartController(
        repository: _SellerCartRepository(sent),
        telemetry: root.telemetry,
      )..restore(sent);
      await tester.pumpWidget(
        _app(
          CatalogSurface(
            entry: entry,
            catalog: _catalog(),
            cart: cart,
            cash: root.cash,
            checkout: root.checkout,
            sales: root.sales,
            kitchenStatus: kitchen,
            exceptions: root.exceptions,
            connectivity: root.connectivity,
            telemetry: root.telemetry,
          ),
        ),
      );
      await tester.pump(const Duration(seconds: 5));
      await tester.pump();
      expect(find.text('En cola'), findsOneWidget);

      kitchen.itemStatus = 'ready';
      await tester.pump(const Duration(seconds: 5));
      await tester.pump();
      expect(find.text('Listo'), findsOneWidget);
      expect(find.text('Enviada'), findsNothing);

      await tester.pumpWidget(const SizedBox());
      await tester.pump();
      cart.dispose();
      entry.dispose();
      root.dispose();
    },
  );

  testWidgets('opening a ready push shows the updated comanda on a phone', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1280);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final root = testRoot();
    final entry = await _readyEntry(const ['cart.write', 'order.fire']);
    final base = _openCart();
    final sent = Cart(
      id: base.id,
      merchantId: base.merchantId,
      locationId: base.locationId,
      operatorSessionId: base.operatorSessionId,
      status: base.status,
      version: 2,
      firedOrderId: '00000000-0000-4000-8000-0000000000f1',
      fulfillmentType: base.fulfillmentType,
      items: [
        {
          ...base.items.single,
          'fired': true,
          'firedOrderItemId': '00000000-0000-4000-8000-0000000000d3',
        },
      ],
      totals: base.totals,
      checkoutEnabled: base.checkoutEnabled,
      checkoutMessageCode: base.checkoutMessageCode,
      updatedAt: base.updatedAt,
    );
    final cart = CartController(
      repository: _SellerCartRepository(sent),
      telemetry: root.telemetry,
    )..restore(sent);
    final kitchen = _LineKitchenStatus()..itemStatus = 'ready';
    final notice = ValueNotifier<KitchenPushNotice?>(null);
    await tester.pumpWidget(
      _app(
        CatalogSurface(
          entry: entry,
          catalog: _catalog(),
          cart: cart,
          cash: root.cash,
          checkout: root.checkout,
          sales: root.sales,
          kitchenStatus: kitchen,
          notificationOpen: notice,
          exceptions: root.exceptions,
          connectivity: root.connectivity,
          telemetry: root.telemetry,
        ),
      ),
    );

    notice.value = const KitchenPushNotice(
      type: 'kitchen_order_ready',
      sourceOrderId: '00000000-0000-4000-8000-0000000000f1',
    );
    await tester.pumpAndSettle();
    expect(find.text('Listo'), findsOneWidget);
    expect(find.text('Enviada'), findsNothing);
    expect(find.byType(PosSheet), findsOneWidget);

    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    notice.dispose();
    cart.dispose();
    entry.dispose();
    root.dispose();
  });
}
