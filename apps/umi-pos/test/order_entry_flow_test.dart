import 'dart:async';

import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/catalog/catalog_controller.dart';
import 'package:umi_pos/features/catalog/catalog_repository.dart';
import 'package:umi_pos/features/catalog/catalog_surface.dart';
import 'package:umi_pos/features/checkout/checkout_controller.dart';
import 'package:umi_pos/features/checkout/checkout_repository.dart';
import 'package:umi_pos/features/checkout/partial_checkout_surface.dart';
import 'package:umi_pos/features/entry/entry_controller.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';
import 'package:umi_pos/features/exception/exception_controller.dart';
import 'package:umi_pos/features/exception/exception_recovery_store.dart';
import 'package:umi_pos/features/exception/exception_repository.dart';
import 'package:umi_pos/features/sale/sale_lifecycle_controller.dart';
import 'package:umi_pos/features/sale/sale_repository.dart';
import 'package:umi_pos/features/tables/floor_plan_controller.dart';
import 'package:umi_pos/features/tables/order_table_picker.dart';

import 'support/fakes.dart';

final class _EmptyCatalogRepo implements CatalogRepository {
  const _EmptyCatalogRepo({this.withProduct = false});
  final bool withProduct;
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
  }) async => CatalogPage(
    items: withProduct
        ? [
            const CatalogProductSummary(
              id: 'latte',
              name: 'Latte',
              description: null,
              sku: null,
              hasBarcode: false,
              category: null,
              price: {'minorUnits': 6500, 'currency': 'MXN'},
              taxRateBasisPoints: 0,
              saleAction: 'merchandise',
              availability: 'enabled',
              availableFrom: null,
              primaryMedia: null,
              hasVariants: false,
              hasModifiers: false,
              updatedAt: '2026-10-13T00:00:00Z',
            ).toJson(),
          ]
        : [],
    nextCursor: null,
    catalogVersion: 'v1',
    updatedAt: '2026-10-07T00:00:00Z',
  );

  @override
  Future<CatalogProductDetail> detail(
    CatalogPartition partition,
    String productId,
  ) async => const CatalogProductDetail(
    id: 'latte',
    name: 'Latte',
    description: null,
    sku: null,
    hasBarcode: false,
    category: null,
    price: {'minorUnits': 6500, 'currency': 'MXN'},
    taxRateBasisPoints: 0,
    saleAction: 'merchandise',
    availability: 'enabled',
    availableFrom: null,
    primaryMedia: null,
    hasVariants: false,
    hasModifiers: false,
    updatedAt: '2026-10-13T00:00:00Z',
    barcode: null,
    media: [],
    variants: [],
    optionGroups: [],
  );

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

Cart _cartWithLines(int count) => Cart(
  id: '00000000-0000-4000-8000-0000000000c1',
  merchantId: 'merchant',
  locationId: 'location',
  operatorSessionId: 'operator',
  status: 'draft',
  version: 1,
  firedOrderId: null,
  fulfillmentType: 'dine_in',
  items: [
    for (var i = 0; i < count; i++)
      {
        'id': '00000000-0000-4000-8000-00000000000$i',
        'productId': '00000000-0000-4000-8000-0000000000d2',
        'productName': 'Latte $i',
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
    'subtotal': {'minorUnits': 39000, 'currency': 'MXN'},
    'tax': {'minorUnits': 6000, 'currency': 'MXN'},
    'discounts': {
      'total': {'minorUnits': 0, 'currency': 'MXN'},
      'entries': <Object?>[],
    },
    'grandTotal': {'minorUnits': 39000, 'currency': 'MXN'},
    'businessDate': '2026-10-07',
  },
  checkoutEnabled: false,
  checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
  updatedAt: '2026-10-07T11:00:00.000Z',
);

final class _Gateway implements EntryGateway {
  _Gateway(this.mobility, {this.saleManagement = false});
  final bool saleManagement;
  final String mobility;
  @override
  Future<DeviceSummary> deviceStatus() async => DeviceSummary(
    id: 'device',
    publicId: 'public',
    merchantId: 'merchant',
    locationId: 'location',
    displayName: 'Test POS',
    type: 'pos_terminal',
    platform: 'android',
    mobility: mobility,
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
      'user': {'displayName': 'Ana'},
    },
    tokens: {'accessToken': 'access', 'refreshToken': 'refresh'},
  );
  @override
  Future<EntryContextResponse> entryContext() async => EntryContextResponse(
    merchants: [
      {
        'id': 'merchant',
        'name': 'Café',
        'roles': [],
        'permissions': [],
        'entitlements': [],
        'locations': [
          {
            'id': 'location',
            'merchantId': 'merchant',
            'name': 'Local',
            'status': 'active',
            'deviceAllowed': true,
            'operatorAllowed': true,
          },
        ],
      },
    ],
  );
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
    permissions: [
      'cart.write',
      'checkout.commit',
      'order.fire',
      if (saleManagement) 'sale.lifecycle',
    ],
    entitlements: const [],
    startedAt: '2026-10-12T00:00:00Z',
    lastActivityAt: '2026-10-12T00:00:00Z',
    expiresAt: '2026-10-13T00:00:00Z',
  );
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw StateError('Unexpected entry call: ${invocation.memberName}');
}

final class _CartRepo
    implements
        CartRepository,
        OpenAccountCartRepository,
        AccountDetailsCartRepository {
  _CartRepo(this.cart);
  Cart cart;
  int fulfillmentWrites = 0;
  int tableOpens = 0;
  int assignments = 0;
  int creations = 0;
  int startAttempts = 0;
  int additions = 0;
  CartLineInput? lastAdd;
  Cart? listedAccount;
  int resumes = 0;
  int currentReads = 0;

  @override
  Future<List<Cart>> openAccounts(String merchantId, CartQuery query) async =>
      listedAccount == null ? [] : [listedAccount!];

  @override
  Future<Cart> resumeAccount(
    String merchantId, {
    required Cart cart,
    required CartQuery query,
    required String idempotencyKey,
  }) async {
    resumes++;
    return this.cart = Cart.fromJson({
      ...cart.toJson(),
      'lifecycleState': 'building_cart',
      'operatorSessionId': query.operatorSessionId,
      'version': cart.version + 1,
    });
  }

  @override
  Future<Cart> add(String merchantId, CartLineInput input) async {
    additions++;
    lastAdd = input;
    return cart = Cart.fromJson({
      ...cart.toJson(),
      'items': [...cart.items, _cartWithLines(1).items.first],
      'version': cart.version + 1,
    });
  }

  @override
  Future<Cart> create(String merchantId, CreateCartRequest request) async {
    creations++;
    return cart = Cart.fromJson({
      ...cart.toJson(),
      'id': '00000000-0000-4000-8000-0000000000c2',
      'operatorSessionId': request.operatorSessionId,
      'lifecycleState': 'building_cart',
      'version': cart.version + 1,
    });
  }

  @override
  Future<Cart> read(String merchantId, CartQuery query) async => cart;
  @override
  Future<Cart> account(
    String merchantId,
    String cartId,
    CartQuery query,
  ) async => cart;
  @override
  Future<Cart> setFulfillment(
    String merchantId,
    SetCartFulfillmentRequest request,
  ) async {
    fulfillmentWrites++;
    return cart = Cart.fromJson({
      ...cart.toJson(),
      'fulfillmentType': request.fulfillmentType,
      'version': cart.version + 1,
    });
  }

  @override
  Future<Cart> suspendAccount(
    String merchantId, {
    required Cart cart,
    required CartQuery query,
    required String idempotencyKey,
    String? accountName,
    bool updateName = false,
  }) async => this.cart = Cart.fromJson({
    ...cart.toJson(),
    'lifecycleState': 'suspended',
    'version': cart.version + 1,
  });
  @override
  Future<Cart> openTableAccount(
    String merchantId, {
    required CartQuery query,
    required String tableId,
    int? partySize,
    required String idempotencyKey,
  }) async {
    tableOpens++;
    return cart = Cart.fromJson({
      ...cart.toJson(),
      'id': 'table-account',
      'tableId': tableId,
      'tableName': 'Mesa 1',
      'lifecycleState': 'building_cart',
      'version': cart.version + 1,
    });
  }

  @override
  Future<Cart> assignAccountTable(
    String merchantId,
    String cartId,
    AssignCartTableRequest request,
  ) async {
    assignments++;
    return cart = Cart.fromJson({
      ...cart.toJson(),
      'tableId': request.tableId,
      'tableName': 'Mesa 1',
      'version': cart.version + 1,
    });
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw StateError('Unexpected cart call: ${invocation.memberName}');
}

final class _Sales implements SaleRepository {
  _Sales(
    this.repo, {
    this.initialNoCart = false,
    this.resumeCancelFlow = false,
    this.currentGate,
  });
  final bool initialNoCart;
  final bool resumeCancelFlow;
  final Completer<void>? currentGate;
  final _CartRepo repo;
  int cancels = 0;
  @override
  Future<SaleSnapshot> start(
    String merchantId,
    SaleContextRequest request,
  ) async {
    repo.startAttempts++;
    repo.creations++;
    if (resumeCancelFlow) {
      repo.cart = Cart.fromJson({
        ..._cartWithLines(0).toJson(),
        'id': '00000000-0000-4000-8000-0000000000c2',
        'accountFolio': 'Cuenta 202',
      });
    }
    return _snapshot();
  }

  @override
  Future<SaleSnapshot> cancel(
    String merchantId,
    String saleId,
    CancelSaleRequest request,
  ) async {
    cancels++;
    return _snapshot(state: 'cancelled');
  }

  @override
  Future<SaleSnapshot> current(
    String merchantId,
    SaleHistoryQuery query,
  ) async {
    repo.currentReads++;
    final gate = currentGate;
    if (gate != null) await gate.future;
    if (initialNoCart &&
        repo.creations == 0 &&
        repo.tableOpens == 0 &&
        repo.resumes == 0) {
      throw const AppException(
        category: AppErrorCategory.server,
        code: 'RESOURCE_NOT_FOUND',
        recoverable: true,
      );
    }
    return _snapshot();
  }

  SaleSnapshot _snapshot({String state = 'building_cart'}) => SaleSnapshot(
    id: repo.cart.id,
    state: state,
    cart: repo.cart.toJson(),
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
    updatedAt: repo.cart.updatedAt,
  );
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw StateError('Unexpected sale call: ${invocation.memberName}');
}

final class _DeferredRecoveryStore implements SaleExceptionRecoveryStore {
  final pending = Completer<PendingSaleException?>();
  bool requested = false;
  @override
  Future<PendingSaleException?> load(String merchantId, String locationId) {
    requested = true;
    return pending.future;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw StateError('Unexpected recovery write');
}

abstract base class _CheckoutBase implements CheckoutRepository {
  int recoveries = 0;
  @override
  Future<CheckoutRecoverySnapshot> recovery(
    String merchantId,
    String cartId,
    CheckoutRecoveryQuery query,
  ) async {
    recoveries++;
    return CheckoutRecoverySnapshot(
      checkoutId: 'checkout',
      cartId: cartId,
      checkoutVersion: 1,
      state: 'draft',
      tenderDrafts: const [],
      tipDraft: null,
      discountDrafts: const [],
      receiptDelivery: const {},
      paymentSummary: null,
      paymentOutcome: null,
      result: null,
      recoveryState: 'none',
      checkoutFingerprint: null,
      updatedAt: '2026-10-12T00:00:00Z',
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw StateError('Unexpected checkout call: ${invocation.memberName}');
}

final class _Checkout extends _CheckoutBase
    implements PartialPaymentRepository {
  int policyLoads = 0;
  int partialReads = 0;
  Completer<void>? partialReadGate;

  @override
  Future<CheckoutPolicy> policy(
    String merchantId,
    PosCheckoutPolicyQuery query,
  ) async {
    policyLoads++;
    return CheckoutPolicy.fromJson({
      'version': 'test',
      'manualTerminalEnabled': false,
      'bankTransferEnabled': true,
      'bankTransferDetails': <String, Object?>{
        'holderName': 'ONCA DEMO',
        'bankName': 'Banco de prueba',
        'clabe': '012345678901234567',
        'accountNumber': null,
      },
      'merchantLogoUrl': null,
      'mixedTenderEnabled': false,
      'maximumTenderLines': 1,
      'manualTerminalApprovalThreshold': {
        'minorUnits': 50000,
        'currency': 'MXN',
      },
      'manualTerminalApprovalPermission': 'checkout.terminal.approve',
      'tip': {
        'enabled': true,
        'presetBasisPoints': <int>[],
        'customPercentageEnabled': false,
        'customFixedEnabled': true,
        'maximumTip': {'minorUnits': 5000, 'currency': 'MXN'},
        'requiredPermission': null,
        'version': 'test',
      },
      'discount': {
        'enabled': false,
        'maximumBasisPoints': 0,
        'maximumAmount': {'minorUnits': 0, 'currency': 'MXN'},
        'cashierThreshold': {'minorUnits': 0, 'currency': 'MXN'},
        'customRequiresApproval': false,
        'requiredPermission': 'checkout.discount.apply',
        'approvalPermission': 'checkout.discount.approve',
        'version': 'test',
      },
    });
  }

  @override
  Future<CheckoutPartialPaymentResult> partialPayments(
    String merchantId,
    String cartId,
    CheckoutPartialPaymentQuery query,
  ) async {
    if (partialReadGate != null) await partialReadGate!.future;
    partialReads++;
    throw const AppException(
      category: AppErrorCategory.unknown,
      code: 'RESOURCE_NOT_FOUND',
      recoverable: false,
    );
  }

  @override
  Future<CheckoutPartialPaymentResult> collectPartialPayment(
    String merchantId,
    String cartId,
    CheckoutPartialPaymentRequest request,
  ) {
    throw StateError('The account split test does not collect payment.');
  }
}

final class _NoPartialCheckout extends _CheckoutBase {}

class _Plan implements FloorPlanRepository {
  int loads = 0;
  @override
  Future<PublishedFloorPlan> load(
    String merchantId,
    PosFloorPlanQuery query,
  ) async {
    loads++;
    return PublishedFloorPlan.fromJson({
      'locationId': 'location',
      'publishedVersion': 1,
      'publishedAt': '2026-10-12T00:00:00Z',
      'published': {
        'schemaVersion': 1,
        'areas': [
          {
            'id': 'area',
            'name': 'Salón',
            'width': 1200,
            'height': 800,
            'elements': [
              {
                'id': 'table',
                'kind': 'table',
                'shape': 'square',
                'label': 'Mesa 1',
                'capacity': 4,
                'x': 100,
                'y': 100,
                'width': 100,
                'height': 100,
                'rotation': 0,
              },
            ],
          },
        ],
      },
    });
  }
}

final class _EmptyPlan extends _Plan implements BootstrapFloorPlanRepository {
  final requests = <InitializePosTablesRequest>[];
  PublishedFloorPlan persisted = PublishedFloorPlan.fromJson({
    'locationId': 'location',
    'publishedVersion': 0,
    'publishedAt': null,
    'published': null,
  });
  @override
  Future<PublishedFloorPlan> load(
    String merchantId,
    PosFloorPlanQuery query,
  ) async {
    loads++;
    return persisted;
  }

  @override
  Future<PublishedFloorPlan> bootstrapTables(
    String merchantId,
    InitializePosTablesRequest request,
  ) async {
    requests.add(request);
    return persisted = PublishedFloorPlan.fromJson({
      'locationId': 'location',
      'publishedVersion': 1,
      'publishedAt': '2026-10-12T00:00:00Z',
      'published': {
        'schemaVersion': 1,
        'areas': [
          {
            'id': 'area',
            'name': 'Salón',
            'width': 1200,
            'height': 800,
            'elements': [
              for (var i = 0; i < request.slots.length; i++)
                {
                  'id': 'created-table-${i + 1}',
                  'kind': 'table',
                  'shape': 'square',
                  'label': 'Mesa ${i + 1}',
                  'capacity': 4,
                  'x': (request.slots[i] % 4) * 220,
                  'y': (request.slots[i] ~/ 4) * 180,
                  'width': 100,
                  'height': 100,
                  'rotation': 0,
                },
            ],
          },
        ],
      },
    });
  }
}

Future<
  ({
    Widget surface,
    CartController cart,
    _CartRepo repo,
    _Plan plan,
    _CheckoutBase checkoutRepo,
    VoidCallback dispose,
  })
>
_fixture({
  String mobility = 'static',
  int lines = 0,
  String type = 'dine_in',
  bool emptyPlan = false,
  bool initialNoCart = false,
  bool resumeCancelFlow = false,
  bool startWithoutCart = false,
  Completer<void>? currentGate,
  bool withProduct = false,
  bool partialPayments = true,
  _DeferredRecoveryStore? lateRecovery,
}) async {
  final root = testRoot();
  final exceptions = lateRecovery == null
      ? root.exceptions
      : SaleExceptionController(
          repository: ApiSaleExceptionRepository(TestApiClient()),
          recoveryStore: lateRecovery,
        );
  if (lateRecovery != null) {
    root.connectivity.apiReachable(authorityValid: true);
    root.connectivity.apiReachable(authorityValid: true);
  }
  final vault = CredentialVault(MemorySecureStorage());
  await vault.saveDevice(
    id: 'device',
    publicId: 'public',
    credential: 'credential',
    credentialVersion: 1,
    state: 'active',
    merchantId: 'merchant',
    locationId: 'location',
  );
  final entry = EntryController(
    gateway: _Gateway(mobility, saleManagement: initialNoCart),
    vault: vault,
    telemetry: root.telemetry,
  );
  await entry.initialize();
  await entry.loginWithPin('1111');
  final repo = _CartRepo(
    Cart.fromJson({..._cartWithLines(lines).toJson(), 'fulfillmentType': type}),
  );
  if (resumeCancelFlow) {
    repo.listedAccount = Cart.fromJson({
      ..._cartWithLines(1).toJson(),
      'accountFolio': 'Cuenta 201',
      'lifecycleState': 'suspended',
    });
  }
  final cart = CartController(repository: repo, telemetry: root.telemetry);
  if (!initialNoCart && !startWithoutCart) cart.restore(repo.cart);
  final sales = SaleLifecycleController(
    repository: _Sales(
      repo,
      initialNoCart: initialNoCart,
      resumeCancelFlow: resumeCancelFlow,
      currentGate: currentGate,
    ),
    cart: cart,
    telemetry: root.telemetry,
  );
  final catalog = CatalogController(
    repository: _EmptyCatalogRepo(withProduct: withProduct),
    cache: CatalogCache(),
    telemetry: root.telemetry,
  );
  final checkoutRepo = partialPayments ? _Checkout() : _NoPartialCheckout();
  final checkout = CheckoutController(
    repository: checkoutRepo,
    telemetry: root.telemetry,
  );
  final plan = emptyPlan ? _EmptyPlan() : _Plan();
  final floorPlan = FloorPlanController(plan);
  return (
    surface: CatalogSurface(
      entry: entry,
      catalog: catalog,
      cart: cart,
      cash: root.cash,
      checkout: checkout,
      sales: sales,
      exceptions: exceptions,
      connectivity: root.connectivity,
      telemetry: root.telemetry,
      floorPlan: floorPlan,
    ),
    cart: cart,
    repo: repo,
    plan: plan,
    checkoutRepo: checkoutRepo,
    dispose: () {
      if (exceptions != root.exceptions) exceptions.dispose();
      checkout.dispose();
      catalog.dispose();
      sales.dispose();
      cart.dispose();
      floorPlan.dispose();
      entry.dispose();
      root.dispose();
    },
  );
}

Future<void> _mount(
  WidgetTester tester,
  Widget surface, {
  Size size = const Size(1440, 1000),
  bool settle = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    PosApp(
      locale: const Locale('es'),
      theme: UmiTheme.light(),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      home: surface,
    ),
  );
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
}

void main() {
  testWidgets('fresh mobile account asks for type immediately and once', (
    tester,
  ) async {
    final f = await _fixture(mobility: 'mobile');
    addTearDown(f.dispose);
    await _mount(tester, f.surface);
    expect(find.text('¿Dónde se sirve este pedido?'), findsOneWidget);
    await tester.pump();
    expect(find.text('¿Dónde se sirve este pedido?'), findsOneWidget);
    expect(f.repo.fulfillmentWrites, 0);
    await tester.tap(find.text('Cancelar'));
    await tester.pumpAndSettle();
    await f.cart.refresh();
    await tester.pumpAndSettle();
    expect(find.text('¿Dónde se sirve este pedido?'), findsNothing);
  });
  testWidgets('fixed fresh account starts without a type dialog', (
    tester,
  ) async {
    final f = await _fixture();
    addTearDown(f.dispose);
    await _mount(tester, f.surface);
    expect(find.text('¿Dónde se sirve este pedido?'), findsNothing);
    expect(f.repo.fulfillmentWrites, 0);
    expect(f.plan.loads, 0);
  });
  testWidgets(
    'startup leaves an existing account in Accounts instead of opening it',
    (tester) async {
      final f = await _fixture(startWithoutCart: true);
      addTearDown(f.dispose);
      await _mount(tester, f.surface, size: const Size(1920, 1014));

      expect(find.text('Cuenta 018'), findsNothing);
      expect(find.text('Recuperando tu cuenta…'), findsNothing);
      expect(find.widgetWithText(PosButton, 'Iniciar pedido'), findsOneWidget);
      expect(f.cart.state.cart, isNull);
      expect(f.repo.currentReads, 0);
      expect(f.repo.creations, 0);
      expect(f.repo.startAttempts, 0);
    },
  );
  testWidgets(
    'cancelled resumed account does not lend Save and leave to a new account',
    (tester) async {
      final f = await _fixture(
        initialNoCart: true,
        resumeCancelFlow: true,
        withProduct: true,
      );
      addTearDown(f.dispose);
      await _mount(tester, f.surface, size: const Size(1920, 1014));

      await tester.tap(find.text('Cuentas').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Lista'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cuenta 201').first);
      await tester.pumpAndSettle();
      expect(f.repo.resumes, 1);
      expect(find.text('Guardar y salir'), findsOneWidget);

      tester
          .widget<PosMenuButton<String>>(
            find.byType(PosMenuButton<String>).first,
          )
          .onSelected
          ?.call('cancel');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Otro motivo'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.descendant(
          of: find.byType(PosAlertDialog),
          matching: find.byType(PosField),
        ),
        'Cuenta de prueba',
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(PosButton, 'Cancelar venta'));
      await tester.pumpAndSettle();
      expect(f.cart.state.cart, isNull);
      expect(find.text('Guardar y salir'), findsNothing);

      await tester.tap(find.widgetWithText(PosButton, 'Iniciar pedido'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(
          of: find.byType(PosAlertDialog),
          matching: find.text('Para llevar'),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Latte'));
      await tester.pumpAndSettle();
      expect(f.repo.creations, 1);
      expect(f.cart.state.cart?.id, '00000000-0000-4000-8000-0000000000c2');
      expect(find.text('Guardar y salir'), findsNothing);
    },
  );
  testWidgets('restored mobile account with products does not ask again', (
    tester,
  ) async {
    final f = await _fixture(mobility: 'mobile', lines: 1);
    addTearDown(f.dispose);
    await _mount(tester, f.surface);
    await f.cart.refresh();
    await tester.pumpAndSettle();
    expect(find.text('¿Dónde se sirve este pedido?'), findsNothing);
    expect(f.cart.state.cart!.items, hasLength(1));
    expect(f.repo.fulfillmentWrites, 0);
  });
  testWidgets(
    'mobile takeout choice persists across refresh without another dialog',
    (tester) async {
      final f = await _fixture(mobility: 'mobile');
      addTearDown(f.dispose);
      await _mount(tester, f.surface);
      await tester.tap(
        find.descendant(
          of: find.byType(PosAlertDialog),
          matching: find.text('Para llevar'),
        ),
      );
      await tester.pumpAndSettle();
      expect(f.repo.fulfillmentWrites, 1);
      expect(f.repo.cart.fulfillmentType, 'takeout');
      await f.cart.refresh();
      await tester.pumpAndSettle();
      expect(f.cart.state.cart!.fulfillmentType, 'takeout');
      expect(find.text('¿Dónde se sirve este pedido?'), findsNothing);
      expect(f.plan.loads, 1);
    },
  );
  testWidgets('mobile dine in starts tableless and keeps serving the order', (
    tester,
  ) async {
    final f = await _fixture(mobility: 'mobile');
    addTearDown(f.dispose);
    await _mount(tester, f.surface);
    await tester.tap(
      find.descendant(
        of: find.byType(PosAlertDialog),
        matching: find.text('Comer aquí'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(OrderTablePicker), findsNothing);
    expect(f.repo.tableOpens, 0);
    expect(f.cart.state.cart!.tableId, isNull);
    expect(f.cart.state.cart!.fulfillmentType, 'dine_in');
    expect(find.text('¿Dónde se sirve este pedido?'), findsNothing);
  });
  testWidgets(
    'fixed dine in checkout cancel keeps the account and never opens checkout',
    (tester) async {
      final f = await _fixture(lines: 1);
      addTearDown(f.dispose);
      await _mount(tester, f.surface);
      final before = f.cart.state.cart!.toJson();
      await tester.tap(find.text('Cobrar'));
      await tester.pumpAndSettle();
      expect(find.byType(OrderTablePicker), findsOneWidget);
      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();
      expect(f.cart.state.cart!.toJson(), before);
      expect(f.repo.assignments, 0);
      expect(find.byType(OrderTablePicker), findsNothing);
      expect(f.checkoutRepo.recoveries, 0);
    },
  );
  testWidgets('takeout checkout skips table selection', (tester) async {
    final f = await _fixture(lines: 1, type: 'takeout');
    addTearDown(f.dispose);
    await _mount(tester, f.surface);
    await tester.tap(find.text('Cobrar'));
    await tester.pumpAndSettle();
    expect(find.byType(OrderTablePicker), findsNothing);
    expect(f.plan.loads, 0);
    expect(f.repo.assignments, 0);
    expect(f.cart.state.cart!.fulfillmentType, 'takeout');
    expect(f.checkoutRepo.recoveries, 1);
    expect(find.byType(PartialCheckoutSurface), findsNothing);
    // The checkout route is visible after the preserved account is recovered.
    expect(find.byType(CatalogSurface), findsNothing);
  });
  testWidgets('sending a dine-in order asks for its table last', (
    tester,
  ) async {
    final f = await _fixture(lines: 1);
    addTearDown(f.dispose);
    await _mount(tester, f.surface);

    await tester.tap(find.text('Enviar a cocina'));
    await tester.pumpAndSettle();

    expect(find.byType(OrderTablePicker), findsOneWidget);
    expect(f.cart.state.cart!.items, hasLength(1));
    expect(f.cart.state.cart!.tableId, isNull);
  });
  testWidgets('account split check opens the one-account ledger directly', (
    tester,
  ) async {
    final f = await _fixture(lines: 1, type: 'takeout');
    addTearDown(f.dispose);
    final ledgerGate = Completer<void>();
    (f.checkoutRepo as _Checkout).partialReadGate = ledgerGate;
    await _mount(tester, f.surface);
    final split = find.byKey(const ValueKey('account-split-check'));
    expect(split, findsOneWidget);
    expect(find.text('Dividir cuenta'), findsOneWidget);
    await tester.tap(split);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(
      find.byKey(const ValueKey('checkout-surface')),
      findsNothing,
      reason: 'Split check must not mount checkout before the split ledger.',
    );
    expect(find.byType(PartialCheckoutSurface), findsOneWidget);
    expect(find.text('MXN 390.00'), findsWidgets);
    expect(find.byType(PosSpinner), findsNothing);
    ledgerGate.complete();
    await tester.pumpAndSettle();
    expect(find.byType(PartialCheckoutSurface), findsOneWidget);
    expect(find.byKey(const ValueKey('checkout-surface')), findsNothing);
    expect((f.checkoutRepo as _Checkout).partialReads, greaterThan(0));
  });
  testWidgets('split check is absent when the checkout cannot split', (
    tester,
  ) async {
    final f = await _fixture(lines: 1, type: 'takeout', partialPayments: false);
    addTearDown(f.dispose);
    await _mount(tester, f.surface);
    expect(find.byKey(const ValueKey('account-split-check')), findsNothing);
    expect(find.text('Dividir cuenta'), findsNothing);
  });
  testWidgets('repeat adds one more of the same cart line', (tester) async {
    final f = await _fixture(lines: 1);
    addTearDown(f.dispose);
    await _mount(tester, f.surface);
    final line = CartItem.fromJson(f.cart.state.cart!.items.single);
    await tester.tap(find.byKey(ValueKey('repeat-cart-line-${line.id}')));
    await tester.pumpAndSettle();
    expect(f.repo.additions, 1);
    expect(f.repo.lastAdd?.productId, line.productId);
    expect(f.repo.lastAdd?.quantity, line.quantity);
    expect(f.cart.state.cart!.items, hasLength(2));
  });
  testWidgets(
    'mobile dine in creates three tables when the table is requested',
    (tester) async {
      final f = await _fixture(mobility: 'mobile', emptyPlan: true);
      addTearDown(f.dispose);
      await _mount(tester, f.surface);
      await tester.tap(
        find.descendant(
          of: find.byType(PosAlertDialog),
          matching: find.text('Comer aquí'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(OrderTablePicker), findsNothing);
      expect(f.cart.state.cart!.tableId, isNull);
      await tester.tap(find.text('Agregar mesa'));
      await tester.pumpAndSettle();
      expect(find.text('Agrega tus mesas'), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('table-count')), '3');
      await tester.pump();
      expect(find.byKey(const ValueKey('table-count')), findsOneWidget);
      await tester.tap(find.text('Guardar mesas'));
      await tester.pumpAndSettle();
      final plan = f.plan as _EmptyPlan;
      expect(plan.requests, hasLength(1));
      expect(plan.requests.single.slots, [0, 1, 2]);
      expect(plan.requests.single.expectedPublishedVersion, 0);
      expect(plan.requests.single.operatorSessionId, 'operator');
      expect(plan.persisted.publishedVersion, 1);
      expect(find.text('Elige una mesa'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey('floor-plan-element-created-table-2')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('confirm-table')));
      await tester.pumpAndSettle();
      expect(f.repo.assignments, 1);
      expect(f.cart.state.cart!.tableId, 'created-table-2');
      expect(find.byType(OrderTablePicker), findsNothing);
      expect(find.byType(CatalogSurface), findsOneWidget);
      expect(f.checkoutRepo.recoveries, 0);
      await f.cart.refresh();
      await tester.pumpAndSettle();
      expect(f.cart.state.cart!.tableId, 'created-table-2');
      expect(find.text('¿Dónde se sirve este pedido?'), findsNothing);
    },
  );
  testWidgets(
    'fixed dine in checkout creates three tables and opens checkout without charging',
    (tester) async {
      final f = await _fixture(lines: 1, emptyPlan: true);
      addTearDown(f.dispose);
      await _mount(tester, f.surface);
      final accountId = f.cart.state.cart!.id;
      final products = f.cart.state.cart!.items;
      await tester.tap(find.text('Cobrar'));
      await tester.pumpAndSettle();
      expect(find.text('Agrega tus mesas'), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('table-count')), '3');
      await tester.pump();
      await tester.tap(find.text('Guardar mesas'));
      await tester.pumpAndSettle();
      final plan = f.plan as _EmptyPlan;
      expect(plan.requests, hasLength(1));
      expect(plan.requests.single.slots, [0, 1, 2]);
      expect(plan.persisted.publishedVersion, 1);
      expect(f.checkoutRepo.recoveries, 0);
      await tester.tap(
        find.byKey(const ValueKey('floor-plan-element-created-table-3')),
      );
      await tester.pumpAndSettle();
      expect(f.repo.assignments, 0);
      await tester.tap(find.byKey(const ValueKey('confirm-table')));
      await tester.pumpAndSettle();
      expect(f.cart.state.cart!.id, accountId);
      expect(f.cart.state.cart!.items, products);
      expect(f.cart.state.cart!.tableId, 'created-table-3');
      expect(f.repo.assignments, 1);
      expect(f.repo.tableOpens, 0);
      expect(f.checkoutRepo.recoveries, 1);
      expect(find.byType(OrderTablePicker), findsNothing);
      expect(find.byType(CatalogSurface), findsNothing);
      // _Checkout throws on any charge call, so a payment cannot pass unnoticed.
    },
  );
  testWidgets(
    'mobile chooses takeout without a folio and starts on first product',
    (tester) async {
      final f = await _fixture(
        mobility: 'mobile',
        initialNoCart: true,
        withProduct: true,
      );
      addTearDown(f.dispose);
      expect(f.cart.state.cart, isNull);
      await _mount(tester, f.surface);
      expect(find.text('¿Dónde se sirve este pedido?'), findsNothing);
      expect(f.repo.creations, 0);
      await tester.tap(find.text('Latte').first);
      await tester.pumpAndSettle();
      expect(find.text('¿Dónde se sirve este pedido?'), findsOneWidget);
      expect(f.cart.state.cart, isNull);
      expect(f.repo.creations, 0);
      await tester.tap(
        find.descendant(
          of: find.byType(PosAlertDialog),
          matching: find.text('Para llevar'),
        ),
      );
      await tester.pumpAndSettle();
      expect(f.repo.startAttempts, 0);
      expect(f.repo.creations, 1);
      expect(f.repo.additions, 1);
      expect(f.cart.state.cart!.fulfillmentType, 'takeout');
      expect(f.cart.state.cart!.items, hasLength(1));
      expect(find.text('¿Dónde se sirve este pedido?'), findsNothing);
    },
  );
  testWidgets(
    'mobile dine in takes the order first and asks for the table when sending it',
    (tester) async {
      final f = await _fixture(
        mobility: 'mobile',
        initialNoCart: true,
        withProduct: true,
      );
      addTearDown(f.dispose);
      await _mount(tester, f.surface);
      expect(f.repo.creations, 0);
      await tester.tap(find.text('Latte').first);
      await tester.pumpAndSettle();
      expect(f.repo.creations, 0);
      await tester.tap(
        find.descendant(
          of: find.byType(PosAlertDialog),
          matching: find.text('Comer aquí'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(OrderTablePicker), findsNothing);
      expect(f.repo.tableOpens, 0);
      expect(f.repo.creations, 1);
      expect(f.repo.additions, 1);
      expect(f.cart.state.cart?.tableId, isNull);
      expect(f.cart.state.cart?.fulfillmentType, 'dine_in');
      expect(f.cart.state.cart?.items, hasLength(1));

      await tester.tap(find.text('Cobrar'));
      await tester.pumpAndSettle();
      expect(find.byType(OrderTablePicker), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('floor-plan-element-table')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('confirm-table')));
      await tester.pumpAndSettle();
      expect(f.repo.assignments, 1);
      expect(f.cart.state.cart?.tableId, 'table');
    },
  );
  testWidgets('fixed without a local cart starts through the order chooser', (
    tester,
  ) async {
    final f = await _fixture(initialNoCart: true);
    addTearDown(f.dispose);
    await _mount(tester, f.surface);
    expect(f.cart.state.cart, isNull);
    expect(f.repo.startAttempts, 0);
    expect(f.repo.creations, 0);
    expect(find.text('¿Dónde se sirve este pedido?'), findsNothing);
    await tester.pump();
    expect(f.repo.startAttempts, 0);
    await tester.tap(find.text('Iniciar pedido').first);
    await tester.pumpAndSettle();
    expect(find.text('¿Dónde se sirve este pedido?'), findsOneWidget);
    await tester.tap(find.text('Cancelar'));
    await tester.pumpAndSettle();
    expect(f.repo.startAttempts, 0);
    expect(f.cart.state.cart, isNull);
    expect(find.text('¿Dónde se sirve este pedido?'), findsNothing);
  });
  testWidgets(
    'mobile startup requests a frame after its last async task finishes while idle',
    (tester) async {
      final recovery = _DeferredRecoveryStore();
      final f = await _fixture(mobility: 'mobile', lateRecovery: recovery);
      addTearDown(f.dispose);
      await _mount(tester, f.surface);
      expect(recovery.requested, isTrue);
      expect(find.text('¿Dónde se sirve este pedido?'), findsNothing);
      expect(tester.binding.hasScheduledFrame, isFalse);
      recovery.pending.complete(null);
      // Flush async completion without supplying a frame or an operator gesture.
      await tester.idle();
      expect(tester.binding.hasScheduledFrame, isTrue);
      await tester.pumpAndSettle();
      expect(find.text('¿Dónde se sirve este pedido?'), findsOneWidget);
      expect(f.repo.tableOpens, 0);
      expect(f.repo.fulfillmentWrites, 0);
    },
  );
}
