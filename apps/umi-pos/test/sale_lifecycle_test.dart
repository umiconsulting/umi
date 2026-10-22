import 'dart:async';

import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/operator_permissions.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/cart/cart_command_queue.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';
import 'package:umi_pos/features/sale/sale_lifecycle_controller.dart';
import 'package:umi_pos/features/sale/sale_repository.dart';
import 'package:umi_pos/features/sale/sale_surface.dart';
import 'package:umi_pos/shared/widgets/receipt_document.dart';

import 'support/receipt_fixture.dart';

const merchantId = '00000000-0000-4000-8000-000000000001';
const locationId = '00000000-0000-4000-8000-000000000002';
const operatorId = '00000000-0000-4000-8000-000000000003';
const saleId = '00000000-0000-4000-8000-000000000004';

Cart cart({String id = saleId, int version = 1}) => Cart(
  id: id,
  merchantId: merchantId,
  locationId: locationId,
  operatorSessionId: operatorId,
  status: 'draft',
  version: version,
  firedOrderId: null,
  fulfillmentType: 'dine_in',
  items: const [],
  totals: const {
    'subtotal': {'minorUnits': 0, 'currency': 'MXN'},
    'tax': {'minorUnits': 0, 'currency': 'MXN'},
    'discounts': {
      'total': {'minorUnits': 0, 'currency': 'MXN'},
      'entries': <Object?>[],
    },
    'grandTotal': {'minorUnits': 0, 'currency': 'MXN'},
    'businessDate': '2026-07-29',
  },
  checkoutEnabled: false,
  checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
  updatedAt: '2026-07-29T12:00:00.000Z',
);

SaleSnapshot sale({
  String id = saleId,
  String state = 'building_cart',
  int version = 1,
  Map<String, Object?>? customer,
}) => SaleSnapshot(
  id: id,
  state: state,
  cart: cart(id: id, version: version).toJson(),
  label: null,
  customer: customer,
  originalOperatorSessionId: operatorId,
  currentOperatorSessionId: operatorId,
  suspendedAt: null,
  cancelledAt: null,
  cancellationReasonCode: null,
  cancellationReason: null,
  committedSaleId: null,
  sourceOrderId: null,
  receiptId: null,
  receiptRef: null,
  updatedAt: '2026-07-29T12:00:00.000Z',
);

final class _Sales implements SaleRepository, CarriedOverSaleRepository {
  SaleSnapshot? currentSale = sale();
  Completer<SaleSnapshot>? currentGate;
  int currentReads = 0;
  int starts = 0;
  int suspends = 0;
  SuspendSaleRequest? lastSuspend;
  int resumes = 0;
  int cancels = 0;
  CancelSaleRequest? lastCancel;
  CancelCarriedOverAccountsRequest? lastCarriedOverCancel;
  int renames = 0;
  int detaches = 0;
  int receipts = 0;
  ReceiptSnapshot? receiptSnapshot;
  AppException? suspendFailure;
  AppException? cancelFailure;
  AppException? resumeFailure;
  List<SaleSnapshot>? historyItems;
  SaleHistoryQuery? lastHistoryQuery;
  String? historyNextCursor;
  bool deferHistory = false;
  final historyQueries = <SaleHistoryQuery>[];
  final pendingHistory = <Completer<SaleHistoryPage>>[];

  @override
  Future<SaleSnapshot> current(
    String merchantId,
    SaleHistoryQuery query,
  ) async {
    currentReads++;
    final gate = currentGate;
    if (gate != null) return gate.future;
    if (currentSale == null) {
      throw const AppException(
        category: AppErrorCategory.unknown,
        code: 'SALE_NOT_FOUND',
        recoverable: false,
      );
    }
    return currentSale!;
  }

  @override
  Future<SaleSnapshot> start(
    String merchantId,
    SaleContextRequest request,
  ) async {
    starts++;
    currentSale = sale(
      id: '00000000-0000-4000-8000-000000000010',
      version: starts,
    );
    return currentSale!;
  }

  @override
  Future<SaleSnapshot> suspend(
    String merchantId,
    String saleId,
    SuspendSaleRequest request,
  ) async {
    if (suspendFailure != null) throw suspendFailure!;
    suspends++;
    lastSuspend = request;
    currentSale = sale(
      state: 'suspended',
      version: request.expectedVersion + 1,
    );
    return currentSale!;
  }

  @override
  Future<SaleSnapshot> resume(
    String merchantId,
    String saleId,
    ResumeSaleRequest request,
  ) async {
    resumes++;
    if (resumeFailure != null) throw resumeFailure!;
    currentSale = sale(
      state: 'recovered',
      version: request.expectedVersion + 1,
    );
    return currentSale!;
  }

  @override
  Future<SaleSnapshot> rename(
    String merchantId,
    String saleId,
    RenameSuspendedSaleRequest request,
  ) async {
    renames++;
    currentSale = sale(
      state: 'suspended',
      version: request.expectedVersion + 1,
    );
    return currentSale!;
  }

  @override
  Future<SaleSnapshot> cancel(
    String merchantId,
    String saleId,
    CancelSaleRequest request,
  ) async {
    if (![
      'customer_changed',
      'operator_mistake',
      'duplicate',
      'other',
    ].contains(request.reasonCode)) {
      throw const AppException(
        category: AppErrorCategory.unknown,
        code: 'INVALID_REASON',
        recoverable: false,
      );
    }
    if (cancelFailure != null) throw cancelFailure!;
    cancels++;
    lastCancel = request;
    currentSale = sale(
      state: 'cancelled',
      version: request.expectedVersion + 1,
    );
    return currentSale!;
  }

  @override
  Future<CancelCarriedOverAccountsResult> cancelCarriedOver(
    String merchantId,
    CancelCarriedOverAccountsRequest request,
  ) async {
    lastCarriedOverCancel = request;
    return CancelCarriedOverAccountsResult(
      cancelled: [
        for (final _ in request.accounts) sale(state: 'cancelled').toJson(),
      ],
    );
  }

  @override
  Future<SaleSnapshot> attachCustomer(
    String merchantId,
    String saleId,
    AttachSaleCustomerRequest request,
  ) async {
    currentSale = sale(
      version: request.expectedVersion + 1,
      customer: {
        'id': request.customerId,
        'displayName': 'Ana',
        'contactHint': '••••1234',
      },
    );
    return currentSale!;
  }

  @override
  Future<SaleSnapshot> detachCustomer(
    String merchantId,
    String saleId,
    SaleMutationRequest request,
  ) async {
    detaches++;
    currentSale = sale(version: request.expectedVersion + 1);
    return currentSale!;
  }

  @override
  Future<SaleHistoryPage> history(
    String merchantId,
    SaleHistoryQuery query,
  ) async {
    lastHistoryQuery = query;
    historyQueries.add(query);
    if (deferHistory) {
      final pending = Completer<SaleHistoryPage>();
      pendingHistory.add(pending);
      return pending.future;
    }
    final item = query.cursor == null
        ? currentSale
        : sale(id: '00000000-0000-4000-8000-000000000099', state: 'committed');
    return SaleHistoryPage(
      items:
          historyItems?.map((sale) => sale.toJson()).toList() ??
          (item == null ? const [] : [item.toJson()]),
      nextCursor: query.cursor == null ? historyNextCursor : null,
    );
  }

  @override
  Future<PosCustomerSearchResult> customers(
    String merchantId,
    PosCustomerSearchQuery query,
  ) async => const PosCustomerSearchResult(items: []);

  @override
  Future<SaleReceiptResult> receipt(
    String merchantId,
    String saleId,
    SaleHistoryQuery query,
  ) async {
    receipts++;
    return SaleReceiptResult(
      saleId: saleId,
      kind: 'official',
      provisionalReference: null,
      receipt: receiptSnapshot?.toJson(),
    );
  }
}

final class _Carts implements CartRepository {
  @override
  Future<Cart> create(String merchantId, CreateCartRequest request) async =>
      cart();
  @override
  Future<Cart> read(String merchantId, CartQuery query) async => cart();
  @override
  Future<Cart> add(String merchantId, CartLineInput input) async => cart();
  @override
  Future<Cart> update(
    String merchantId,
    String lineId,
    CartLineInput input,
  ) async => cart();
  @override
  Future<Cart> remove(
    String merchantId,
    String lineId,
    RemoveCartLineRequest input,
  ) async => cart();
  @override
  Future<Cart> prepare(String merchantId, PrepareSaleRequest input) async =>
      cart();
  @override
  Future<Cart> clear(String merchantId, ClearCartRequest input) async => cart();

  @override
  Future<PosIncomingOrders> incomingOrders(
    String merchantId,
    CartQuery query,
  ) async => throw UnimplementedError();

  @override
  Future<Cart> bindOrigin(
    String merchantId,
    BindCartOriginRequest input,
  ) async => throw UnimplementedError();

  @override
  Future<FireOrderResult> fire(
    String merchantId,
    FireOrderRequest request,
  ) async => throw UnimplementedError();

  @override
  Future<Cart> setFulfillment(
    String merchantId,
    SetCartFulfillmentRequest input,
  ) async => throw UnimplementedError();
}

final class _BlockedCarts extends _Carts {
  _BlockedCarts(this.gate);

  final Completer<Cart> gate;

  @override
  Future<Cart> create(String merchantId, CreateCartRequest request) =>
      gate.future;
}

final class _AccountCarts extends _Carts implements OpenAccountCartRepository {
  int saves = 0;

  @override
  Future<Cart> suspendAccount(
    String merchantId, {
    required Cart cart,
    required CartQuery query,
    required String idempotencyKey,
    String? accountName,
    bool updateName = false,
  }) async {
    saves++;
    return cart;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

CartController _cartController([CartRepository? repository]) => CartController(
  repository: repository ?? _Carts(),
  telemetry: const SafeTelemetry(
    enabled: false,
    context: TelemetryContext(
      environment: 'test',
      appVersion: 'test',
      platform: 'test',
    ),
    exporter: NoopTelemetryExporter(),
  ),
);

CartController _cartControllerWithLocalQueue(CartRepository repository) =>
    CartController(
      repository: repository,
      offlineJournal: EncryptedOfflineJournal(_JournalStore(), web: false),
      deviceIdentity: () => const CartDeviceIdentity(
        deviceId: '00000000-0000-4000-8000-000000000010',
        credentialVersion: 1,
      ),
      telemetry: const SafeTelemetry(
        enabled: false,
        context: TelemetryContext(
          environment: 'test',
          appVersion: 'test',
          platform: 'test',
        ),
        exporter: NoopTelemetryExporter(),
      ),
    );

SaleLifecycleController _controller(
  _Sales sales, {
  CartController? cartController,
  bool localFirstFastPathEnabled = false,
}) => SaleLifecycleController(
  repository: sales,
  cart: cartController ?? _cartController(),
  localFirstFastPathEnabled: localFirstFastPathEnabled,
  telemetry: const SafeTelemetry(
    enabled: false,
    context: TelemetryContext(
      environment: 'test',
      appVersion: 'test',
      platform: 'test',
    ),
    exporter: NoopTelemetryExporter(),
  ),
);

final class _JournalStore implements JournalCipherStore {
  String? value;
  String? key;

  @override
  Future<String?> readCiphertext() async => value;

  @override
  Future<String?> readKey() async => key;

  @override
  Future<void> writeCiphertext(String next) async => value = next;

  @override
  Future<void> writeKey(String next) async => key = next;
}

Map<String, Object?> _historyTestCart() => {
  ...cart().toJson(),
  'items': [
    {
      'id': '00000000-0000-4000-8000-000000000030',
      'productId': '00000000-0000-4000-8000-000000000031',
      'productName': 'Cappuccino',
      'saleAction': 'merchandise',
      'quantity': 1,
      'courseNumber': 1,
      'variant': null,
      'modifiers': <Object?>[],
      'note': null,
      'fired': false,
      'price': {
        'unitPrice': {'minorUnits': 6200, 'currency': 'MXN'},
        'lineSubtotal': {'minorUnits': 6200, 'currency': 'MXN'},
        'tax': {'minorUnits': 855, 'currency': 'MXN'},
        'lineTotal': {'minorUnits': 6200, 'currency': 'MXN'},
        'taxRateBasisPoints': 1600,
      },
    },
  ],
  'totals': {
    ...cart().totals,
    'grandTotal': {'minorUnits': 18100, 'currency': 'MXN'},
  },
};

Future<void> _loadPosFonts() async {
  for (final (family, prefix, weights) in [
    ('IBM Plex Sans', 'IBMPlexSans', ['Regular', 'Medium', 'SemiBold', 'Bold']),
    ('Bricolage Grotesque', 'BricolageGrotesque12pt', ['SemiBold', 'Bold']),
  ]) {
    final loader = FontLoader(family);
    for (final weight in weights) {
      loader.addFont(rootBundle.load('assets/fonts/$prefix-$weight.ttf'));
    }
    await loader.load();
  }
}

Widget _scaledHistoryApp(
  Widget surface,
  double scale, {
  String locale = 'es',
}) => PosApp(
  locale: Locale(locale),
  theme: UmiTheme.light(),
  supportedLocales: AppLocalizations.supportedLocales,
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
    child: child!,
  ),
  home: PosPage(
    body: surface,
    bottomNavigationBar: PosNavigation(
      selectedIndex: 2,
      destinations: [
        for (final label
            in (locale == 'es'
                ? [
                    'Comanda',
                    'Caja',
                    'Ventas',
                    'Mesas',
                    'Cocina',
                    'Pedidos',
                    'Ajustes',
                  ]
                : [
                    'Order',
                    'Cash',
                    'Sales',
                    'Tables',
                    'Kitchen',
                    'Orders',
                    'Settings',
                  ]))
          PosDestination(
            icon: const PosIcon(PosGlyphs.receiptOutlined),
            label: label,
          ),
      ],
    ),
  ),
);

void main() {
  for (final state in ['suspended', 'cancelled']) {
    testWidgets('$state uses a thick plain glyph inside its history tile', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1280, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final sales = _Sales()..historyItems = [sale(state: state)];
      final lifecycle = _controller(sales);
      await lifecycle.open(merchantId, locationId, operatorId);
      await tester.pumpWidget(
        _scaledHistoryApp(
          SaleCenterSurface(
            lifecycle: lifecycle,
            embedded: true,
            permissions: OperatorPermissions(['sale.lifecycle']),
          ),
          1,
        ),
      );
      await tester.pumpAndSettle();
      final glyph = tester.widget<PosIcon>(
        find.descendant(
          of: find.byKey(const ValueKey('sale-state-badge')),
          matching: find.byType(PosIcon),
        ),
      );
      expect(
        glyph.icon,
        state == 'suspended' ? PosGlyphs.pause : PosGlyphs.close,
      );
      expect(glyph.strokeWidth, 3);
      expect(glyph.size, 16);
      expect(const PosIcon(PosGlyphs.check).strokeWidth, 1.65);
    });
  }
  test(
    'startup recovers the active server sale without creating another',
    () async {
      final sales = _Sales();
      final lifecycle = _controller(sales);
      await lifecycle.open(merchantId, locationId, operatorId);
      expect(lifecycle.state.phase, SalePhase.buildingCart);
      expect(lifecycle.state.sale?.id, saleId);
      expect(sales.starts, 0);
    },
  );

  test(
    'a fresh operator entry can bind the till without adopting the sale',
    () async {
      final sales = _Sales();
      final lifecycle = _controller(sales);

      await lifecycle.open(
        merchantId,
        locationId,
        operatorId,
        restoreCurrent: false,
      );

      expect(lifecycle.state.phase, SalePhase.idle);
      expect(lifecycle.state.sale, isNull);
      expect(sales.currentReads, 0);

      expect(await lifecycle.newSale(), isTrue);
      expect(sales.starts, 1);
    },
  );

  test('first login leaves the menu ready without an empty sale', () async {
    final sales = _Sales()..currentSale = null;
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    expect(sales.starts, 0);
    expect(lifecycle.state.phase, SalePhase.idle);
    expect(lifecycle.state.sale, isNull);
    await lifecycle.open(merchantId, locationId, operatorId);
    expect(sales.starts, 0);
    expect(await lifecycle.newSale(), isTrue);
    expect(sales.starts, 1);
  });

  test('suspending the same sale twice creates one transition', () async {
    final sales = _Sales();
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    await lifecycle.suspend('Mesa 4');
    await lifecycle.suspend('Mesa 4');
    expect(sales.suspends, 1);
    expect(lifecycle.state.phase, SalePhase.suspended);
  });

  testWidgets(
    'suspend shows the account and contents without asking for a name',
    (tester) async {
      final sales = _Sales()
        ..currentSale = SaleSnapshot.fromJson({
          ...sale().toJson(),
          'cart': {..._historyTestCart(), 'accountFolio': 'Cuenta 195'},
        });
      final lifecycle = _controller(sales);
      await lifecycle.open(merchantId, locationId, operatorId);
      await tester.pumpWidget(
        PosApp(
          locale: const Locale('es'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: Builder(
            builder: (context) => PosPage(
              body: PosButton(
                onPressed: () => showSuspendSaleDialog(context, lifecycle),
                child: const Text('Abrir'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Abrir'));
      await tester.pumpAndSettle();
      expect(find.text('Cuenta 195 · Cappuccino'), findsOneWidget);
      expect(find.byType(PosField), findsNothing);
      await tester.tap(find.widgetWithText(PosButton, 'Suspender venta'));
      await tester.pumpAndSettle();
      expect(sales.lastSuspend?.label, isNull);
      expect(sales.suspends, 1);
    },
  );

  test(
    'canEditSale follows the sale on screen, so a control can stand down',
    () async {
      // `attachCustomer` and its siblings return in silence when there is no
      // editable sale, so a control that looks ready leaves the operator
      // tapping at nothing. The surface asks this getter; the commands guard on
      // it.
      final sales = _Sales();
      final lifecycle = _controller(sales);
      expect(lifecycle.canEditSale, isFalse, reason: 'nothing is open yet');

      await lifecycle.open(merchantId, locationId, operatorId);
      expect(lifecycle.canEditSale, isTrue);

      await lifecycle.suspend('Mesa 4');
      expect(
        lifecycle.canEditSale,
        isFalse,
        reason: 'a parked sale cannot take a customer change',
      );
    },
  );

  test(
    'checkout waits for an explicit next order before creating a sale',
    () async {
      final sales = _Sales();
      final lifecycle = _controller(sales);
      await lifecycle.open(merchantId, locationId, operatorId);
      lifecycle.checkoutStarted();
      await lifecycle.checkoutCommitted();
      await lifecycle.checkoutCommitted();
      expect(sales.starts, 0);
      expect(lifecycle.state.phase, SalePhase.committed);
      expect(lifecycle.state.readyForNextCustomer, isTrue);
      lifecycle.finishCheckoutPresentation();
      expect(lifecycle.state.phase, SalePhase.idle);
      expect(lifecycle.state.sale, isNull);
      expect(await lifecycle.newSale(), isTrue);
      expect(sales.starts, 1);
    },
  );

  test(
    'a completed checkout clears the paid cart even when the lifecycle phase was missed',
    () async {
      final carts = _cartController();
      await carts.open(merchantId, locationId, operatorId);
      expect(carts.state.cart, isNotNull);
      final lifecycle = _controller(_Sales(), cartController: carts);
      await lifecycle.open(merchantId, locationId, operatorId);

      // Split payment completed in CheckoutController, but the sale controller
      // never observed `checkingOut`. The payment still proves this cart is no
      // longer editable, so closing the receipt must clear it.
      lifecycle.finishCheckoutPresentation(force: true);
      expect(carts.state.cart, isNull);
      expect(lifecycle.state.phase, SalePhase.idle);
    },
  );

  test('resume cannot replace an active editable sale', () async {
    final sales = _Sales();
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    await lifecycle.resume(sale(state: 'suspended'));
    expect(sales.resumes, 0);
    expect(lifecycle.state.phase, SalePhase.buildingCart);
  });

  test('cancel is blocked while checkout owns the transition', () async {
    final sales = _Sales();
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    lifecycle.checkoutStarted();
    await lifecycle.cancel('No debe aplicarse');
    expect(sales.cancels, 0);
    expect(lifecycle.state.phase, SalePhase.checkingOut);
  });

  test('operator exit cancels one empty sale and does not orphan it', () async {
    final sales = _Sales();
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    expect(await lifecycle.prepareForOperatorExit(), isTrue);
    expect(sales.cancels, 1);
    expect(lifecycle.state.phase, SalePhase.cancelled);
  });

  for (final cartAuthority in [false, true]) {
    test(
      'empty account survives repeated exits with cart authority $cartAuthority',
      () async {
        final sales = _Sales();
        final repository = _AccountCarts();
        final carts = _cartController(repository);
        final lifecycle = _controller(sales, cartController: carts);
        await lifecycle.open(merchantId, locationId, operatorId);
        final before = carts.state.cart!;
        for (var exit = 0; exit < 3; exit++) {
          expect(
            await lifecycle.prepareForOperatorExit(
              useCartAuthority: cartAuthority,
            ),
            isTrue,
          );
        }
        expect(carts.state.cart?.id, before.id);
        expect(carts.state.cart?.version, before.version);
        expect(sales.cancels, 0);
        expect(sales.suspends, 0);
        expect(repository.saves, 0);
        expect(lifecycle.state.phase, SalePhase.buildingCart);
        lifecycle.dispose();
        carts.dispose();
      },
    );

    for (final content in [
      {'accountName': 'Ana'},
      {
        'tableId': '00000000-0000-4000-8000-000000000080',
        'tableName': 'Mesa 8',
      },
      {'firedOrderId': '00000000-0000-4000-8000-000000000081'},
      {'items': _historyTestCart()['items']},
    ]) {
      test(
        'identified account is preserved on exit $content with cart authority $cartAuthority',
        () async {
          final sales = _Sales();
          final repository = _AccountCarts();
          final carts = _cartController(repository);
          final lifecycle = _controller(sales, cartController: carts);
          await lifecycle.open(merchantId, locationId, operatorId);
          carts.restore(Cart.fromJson({...cart().toJson(), ...content}));
          expect(
            await lifecycle.prepareForOperatorExit(
              useCartAuthority: cartAuthority,
            ),
            isTrue,
          );
          expect(repository.saves, 1);
          expect(sales.suspends + sales.cancels, 0);
          lifecycle.dispose();
          carts.dispose();
        },
      );
    }
  }

  testWidgets(
    'a committed sale is titled by its account and wears the blue check',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final historical = SaleSnapshot.fromJson({
        ...sale(state: 'committed').toJson(),
        'cart': {..._historyTestCart(), 'accountFolio': 'Cuenta 001'},
      });
      final sales = _Sales()..historyItems = [historical];
      final lifecycle = _controller(sales);
      await lifecycle.open(merchantId, locationId, operatorId);
      await tester.pumpWidget(
        _scaledHistoryApp(
          SaleCenterSurface(
            lifecycle: lifecycle,
            embedded: true,
            permissions: OperatorPermissions(['sale.lifecycle']),
          ),
          1,
        ),
      );
      await tester.pumpAndSettle();

      // THE TITLE IS THE ACCOUNT, AND IT SAYS WHAT WAS ORDERED.
      expect(find.text('Cuenta 001 · Cappuccino'), findsOneWidget);

      // AND THE MARK IS A FILLED TILE OF THE PALETTE'S BLUE WITH A WHITE CHECK —
      // a rounded square, not a disc: the owner asked the marks to stop being circles.
      final tile = find.byKey(const ValueKey('sale-state-badge'));
      expect(tile, findsOneWidget);
      final palette = PosTheme.of(tester.element(tile));
      expect(
        (tester.widget<DecoratedBox>(tile).decoration as BoxDecoration).color,
        palette.colorScheme.primary,
      );
      final check = find.descendant(
        of: tile,
        matching: find.byWidgetPredicate(
          (widget) => widget is PosIcon && widget.color == PosColors.white,
        ),
      );
      expect(check, findsOneWidget);
    },
  );

  test('history recovery closes only an empty draft before resume', () async {
    final sales = _Sales();
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    await Future.wait([
      lifecycle.resumeFromHistory(sale(state: 'suspended')),
      lifecycle.resumeFromHistory(sale(state: 'suspended')),
    ]);
    expect(sales.cancels, 1);
    expect(sales.resumes, 1);
    expect(sales.lastCancel?.reasonCode, 'other');
    expect(lifecycle.state.phase, SalePhase.recovered);
  });
  test('failed empty-draft cancellation never resumes another order', () async {
    final sales = _Sales()
      ..cancelFailure = const AppException(
        category: AppErrorCategory.unknown,
        code: 'CART_VERSION_CONFLICT',
        recoverable: false,
      );
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    await lifecycle.resumeFromHistory(sale(state: 'suspended'));
    expect(sales.resumes, 0);
    expect(lifecycle.state.errorCode, 'CART_VERSION_CONFLICT');
  });
  test('failed resume after an empty replacement remains retryable', () async {
    final sales = _Sales()
      ..resumeFailure = const AppException(
        category: AppErrorCategory.unknown,
        code: 'CART_VERSION_CONFLICT',
        recoverable: true,
      );
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    await lifecycle.resumeFromHistory(sale(state: 'suspended'));
    expect(sales.cancels, 1);
    expect(sales.resumes, 1);
    expect(lifecycle.state.phase, SalePhase.cancelled);
    expect(lifecycle.canResumeFromHistory, isTrue);
    sales.resumeFailure = null;
    await lifecycle.resumeFromHistory(sale(state: 'suspended'));
    expect(sales.cancels, 1);
    expect(sales.resumes, 2);
    expect(lifecycle.state.phase, SalePhase.recovered);
  });

  for (final locale in ['es', 'en']) {
    for (final scale in [1.5, 2.0]) {
      testWidgets(
        'large history keeps name, amount and action reachable in $locale at $scale',
        (tester) async {
          tester.view.physicalSize = const Size(375, 812);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          await _loadPosFonts();
          final snapshot = _historyTestCart();
          final historical = SaleSnapshot.fromJson({
            ...sale(state: 'suspended').toJson(),
            'label': 'Pedido de Lucía',
            'cart': snapshot,
          });
          final sales = _Sales()
            ..currentSale = SaleSnapshot.fromJson({
              ...sale().toJson(),
              'cart': snapshot,
            })
            ..historyItems = [historical];
          final lifecycle = _controller(sales);
          await lifecycle.open(merchantId, locationId, operatorId);
          final surface = SaleCenterSurface(
            lifecycle: lifecycle,
            embedded: true,
            permissions: OperatorPermissions(const ['sale.lifecycle']),
          );
          try {
            await tester.pumpWidget(
              _scaledHistoryApp(surface, scale, locale: locale),
            );
            await tester.pumpAndSettle();
            if (find.byType(CustomScrollView).evaluate().isNotEmpty) {
              await tester.drag(
                find.byType(CustomScrollView),
                const Offset(0, -400),
              );
              await tester.pumpAndSettle();
            }
            await tester.ensureVisible(find.text('Pedido de Lucía'));
            await tester.pumpAndSettle();
            final viewport = tester.getRect(
              find
                  .ancestor(
                    of: find.text('Pedido de Lucía'),
                    matching: find.byType(Scrollable),
                  )
                  .first,
            );
            for (final label in ['Pedido de Lucía', 'MXN 181.00']) {
              final rect = tester.getRect(find.text(label));
              expect(
                rect.top,
                greaterThanOrEqualTo(viewport.top - 1),
                reason: label,
              );
              expect(
                rect.bottom,
                lessThanOrEqualTo(viewport.bottom + 1),
                reason: label,
              );
            }
            final action = find.widgetWithText(
              PosButton,
              locale == 'es' ? 'Reanudar venta' : 'Resume sale',
            );
            await tester.ensureVisible(action);
            await tester.pumpAndSettle();
            final actionRect = tester.getRect(action);
            expect(actionRect.top, greaterThanOrEqualTo(viewport.top - 1));
            expect(actionRect.bottom, lessThanOrEqualTo(viewport.bottom + 1));
            expect(tester.widget<PosButton>(action).onPressed, isNull);
            expect(sales.resumes, 0);
            if (find.byType(CustomScrollView).evaluate().isNotEmpty) {
              await tester.drag(
                find.byType(CustomScrollView),
                const Offset(0, 1500),
              );
              await tester.pumpAndSettle();
            }
            final field = find.byType(EditableText);
            await tester.ensureVisible(field);
            await tester.pumpAndSettle();
            await tester.enterText(field, 'croissant');
            await tester.pumpWidget(
              _scaledHistoryApp(surface, 1, locale: locale),
            );
            await tester.pumpAndSettle();
            expect(
              tester.widget<EditableText>(field).controller.text,
              'croissant',
            );
            expect(
              tester.widget<EditableText>(field).focusNode.hasFocus,
              isTrue,
            );
            await tester.testTextInput.receiveAction(TextInputAction.done);
            await tester.pumpAndSettle();
            expect(sales.lastHistoryQuery?.search, 'croissant');
            expect(tester.takeException(), isNull);
          } finally {
            await tester.pumpWidget(const SizedBox());
            lifecycle.dispose();
          }
        },
      );
    }
  }

  for (final locale in ['es', 'en']) {
    for (final canPrint in [false, true]) {
      testWidgets(
        'receipt view requires explicit printing and permission in $locale: $canPrint',
        (tester) async {
          tester.view.physicalSize = const Size(375, 812);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          await _loadPosFonts();
          final receipt = receiptTestSnapshot();
          const receiptId = '00000000-0000-4000-8000-000000000030';
          final historical = SaleSnapshot.fromJson({
            ...sale(state: 'committed').toJson(),
            'cart': _historyTestCart(),
            'receiptId': receiptId,
            'receiptRef': receipt.receiptRef,
          });
          final sales = _Sales()
            ..historyItems = [historical]
            ..receiptSnapshot = receipt;
          final lifecycle = _controller(sales);
          await lifecycle.open(merchantId, locationId, operatorId);
          var prints = 0;
          final surface = SaleCenterSurface(
            lifecycle: lifecycle,
            embedded: true,
            permissions: OperatorPermissions([
              'sale.lifecycle',
              if (canPrint) 'hardware.printer.print',
            ]),
            onPrint: (id, snapshot) async {
              expect(id, receiptId);
              // The request now carries the snapshot itself: the dialogue is shared with
              // the sale's completion screen, and that screen has no `SaleReceiptResult`
              // in hand — only the receipt the checkout already returned.
              expect(snapshot, receipt.toJson());
              prints++;
            },
          );
          await tester.pumpWidget(
            _scaledHistoryApp(surface, 2, locale: locale),
          );
          await tester.pumpAndSettle();
          final scrolling = find
              .descendant(
                of: find.byType(CustomScrollView),
                matching: find.byType(Scrollable),
              )
              .first;
          final menu = find.byType(PosMenuButton<String>);
          await tester.scrollUntilVisible(menu, 250, scrollable: scrolling);
          await tester.pumpAndSettle();
          await tester.tap(menu);
          await tester.pumpAndSettle();
          expect(
            find.text(locale == 'es' ? 'Abrir recibo' : 'Open receipt'),
            findsOneWidget,
          );
          await tester.sendKeyEvent(LogicalKeyboardKey.end);
          await tester.sendKeyEvent(LogicalKeyboardKey.enter);
          await tester.pumpAndSettle();
          expect(sales.receipts, 1);
          expect(prints, 0);
          expect(find.byType(ReceiptDocument), findsOneWidget);
          final print = find.widgetWithText(
            PosButton,
            locale == 'es' ? 'Imprimir recibo' : 'Print receipt',
          );
          expect(print, canPrint ? findsOneWidget : findsNothing);
          if (canPrint) {
            await tester.tap(print);
            await tester.pumpAndSettle();
            expect(prints, 1);
            // Printing leaves the sheet where it is: the paper feeding again is
            // the only thing that tells the operator the copy came out, so the
            // dialog closes when they are done, not when the command returns.
            expect(find.byType(ReceiptDocument), findsOneWidget);
            await tester.sendKeyEvent(LogicalKeyboardKey.escape);
            await tester.pumpAndSettle();
          } else {
            await tester.sendKeyEvent(LogicalKeyboardKey.escape);
            await tester.pumpAndSettle();
            expect(prints, 0);
          }
          expect(find.byType(ReceiptDocument), findsNothing);
          var returned = false;
          FocusManager.instance.primaryFocus!.context!.visitAncestorElements((
            element,
          ) {
            if (element.widget is PosMenuButton<String>) returned = true;
            return true;
          });
          expect(returned, isTrue);
          expect(sales.resumes, 0);
          expect(sales.cancels, 0);
          expect(sales.suspends, 0);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox());
          lifecycle.dispose();
        },
      );
    }
  }

  for (final locale in ['es', 'en']) {
    testWidgets(
      'backward keyboard reveals offscreen history controls in $locale',
      (tester) async {
        tester.view.physicalSize = const Size(375, 812);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await _loadPosFonts();
        final historical = SaleSnapshot.fromJson({
          ...sale(state: 'committed').toJson(),
          'cart': _historyTestCart(),
        });
        final sales = _Sales()..historyItems = [historical];
        final lifecycle = _controller(sales);
        await lifecycle.open(merchantId, locationId, operatorId);
        final surface = SaleCenterSurface(
          lifecycle: lifecycle,
          embedded: true,
          permissions: OperatorPermissions(const ['sale.lifecycle']),
        );
        await tester.pumpWidget(_scaledHistoryApp(surface, 2, locale: locale));
        await tester.pumpAndSettle();
        final field = find.byType(EditableText);
        await tester.enterText(field, 'latte');
        final searchFocus = tester.widget<EditableText>(field).focusNode;
        final scrolling = find
            .descendant(
              of: find.byType(CustomScrollView),
              matching: find.byType(Scrollable),
            )
            .first;
        final menu = find.byType(PosMenuButton<String>);
        await tester.scrollUntilVisible(menu, 250, scrollable: scrolling);
        await tester.pumpAndSettle();
        await tester.tap(menu);
        await tester.pumpAndSettle();
        await tester.sendKeyEvent(LogicalKeyboardKey.escape);
        await tester.pumpAndSettle();
        await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
        try {
          for (final label in [
            locale == 'es' ? 'Recientes' : 'Newest',
            locale == 'es' ? 'Todas las ventas' : 'All sales',
          ]) {
            await tester.sendKeyEvent(LogicalKeyboardKey.tab);
            await tester.pumpAndSettle();
            final focused = FocusManager.instance.primaryFocus!.context!;
            expect(
              find.descendant(
                of: find.byElementPredicate((el) => el == focused),
                matching: find.text(label),
              ),
              findsOneWidget,
            );
            final bounds = tester.getRect(
              find.byElementPredicate((el) => el == focused),
            );
            final viewport = tester.getRect(scrolling);
            expect(bounds.top, greaterThanOrEqualTo(viewport.top - 1));
            expect(bounds.bottom, lessThanOrEqualTo(viewport.bottom + 1));
          }
          await tester.sendKeyEvent(LogicalKeyboardKey.tab);
          await tester.pumpAndSettle();
          expect(searchFocus.hasFocus, isTrue);
          expect(
            tester.widget<EditableText>(find.byType(EditableText)).focusNode,
            same(searchFocus),
          );
          expect(
            tester
                .widget<EditableText>(find.byType(EditableText))
                .controller
                .text,
            'latte',
          );
          final bounds = tester.getRect(find.byType(PosField));
          final viewport = tester.getRect(scrolling);
          expect(bounds.top, greaterThanOrEqualTo(viewport.top - 1));
          expect(bounds.bottom, lessThanOrEqualTo(viewport.bottom + 1));
          expect(sales.receipts, 0);
          expect(sales.resumes, 0);
          expect(tester.takeException(), isNull);
        } finally {
          await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
          await tester.pumpWidget(const SizedBox());
          lifecycle.dispose();
        }
      },
    );
  }

  testWidgets('phone history identifies orders and keeps server totals', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final orderedCart = _historyTestCart();
    final suspended = SaleSnapshot.fromJson({
      ...sale(state: 'suspended').toJson(),
      'label': 'Mesa 7 · Lucía',
      'cart': orderedCart,
    });
    final completed = SaleSnapshot.fromJson({
      ...sale(state: 'committed').toJson(),
      'cart': orderedCart,
      'receiptRef': 'POS-0042',
    });
    final sales = _Sales()
      ..currentSale = SaleSnapshot.fromJson({
        ...sale().toJson(),
        'cart': orderedCart,
      })
      ..historyItems = [suspended, completed];
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    final semantics = tester.ensureSemantics();
    try {
      await tester.pumpWidget(
        PosApp(
          locale: const Locale('es'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: MediaQuery(
            data: const MediaQueryData(
              size: Size(375, 812),
              textScaler: TextScaler.linear(1.4),
            ),
            child: Builder(
              builder: (context) => PosPage(
                body: PosButton(
                  onPressed: () => showSaleCenter(
                    context,
                    lifecycle,
                    OperatorPermissions(const ['sale.lifecycle']),
                  ),
                  child: const Text('abrir'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('abrir'));
      await tester.pumpAndSettle();
      expect(find.text('Mesa 7 · Lucía'), findsOneWidget);
      expect(find.text('MXN 181.00'), findsWidgets);
      expect(find.textContaining('suspende o termina'), findsOneWidget);
      expect(
        tester
            .widget<PosButton>(find.widgetWithText(PosButton, 'Reanudar venta'))
            .onPressed,
        isNull,
      );
      await tester.tap(find.text('Todas las ventas'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ventas suspendidas'));
      await tester.pumpAndSettle();
      expect(sales.lastHistoryQuery?.state, 'suspended');
      expect(
        tester.getSemantics(find.text('Ventas suspendidas')),
        isSemantics(
          label: 'Ventas suspendidas',
          isButton: true,
          hasEnabledState: true,
          isEnabled: true,
          isFocusable: true,
          hasTapAction: true,
          hasFocusAction: true,
        ),
      );
      expect(tester.takeException(), isNull);
    } finally {
      semantics.dispose();
    }
  });
  test(
    'history recovery cannot clear an order with lines or active checkout',
    () async {
      final sales = _Sales();
      final carts = _cartController();
      final lifecycle = _controller(sales, cartController: carts);
      await lifecycle.open(merchantId, locationId, operatorId);
      carts.restore(
        Cart.fromJson({
          ...cart().toJson(),
          'items': [
            {
              'id': '00000000-0000-4000-8000-000000000030',
              'productId': '00000000-0000-4000-8000-000000000031',
              'productName': 'Café',
              'quantity': 1,
              'variant': null,
              'modifiers': <Object?>[],
              'note': null,
              'price': {
                'unit': {'minorUnits': 4500, 'currency': 'MXN'},
                'line': {'minorUnits': 4500, 'currency': 'MXN'},
              },
            },
          ],
        }),
      );
      expect(lifecycle.canResumeFromHistory, isFalse);
      await lifecycle.resumeFromHistory(sale(state: 'suspended'));
      expect(sales.cancels, 0);
      expect(sales.resumes, 0);
      carts.restore(cart());
      lifecycle.checkoutStarted();
      await lifecycle.resumeFromHistory(sale(state: 'suspended'));
      expect(sales.cancels, 0);
      expect(sales.resumes, 0);
    },
  );
  // Plan §8.3: a cancellation asks for a TYPED reason, not free text. The legacy
  // till's free text produced 16 of 17 cancellations saying "prueba".

  test('a cancellation carries a typed reason and an optional note', () async {
    final sales = _Sales();
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);

    await lifecycle.cancel('customer_changed', note: '  cambiaron de idea  ');

    expect(sales.lastCancel?.reasonCode, 'customer_changed');
    expect(sales.lastCancel?.reason, 'cambiaron de idea');
  });

  test('an empty note stays null: the reason is the fact', () async {
    final sales = _Sales();
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);

    await lifecycle.cancel('operator_mistake');

    expect(sales.lastCancel?.reasonCode, 'operator_mistake');
    expect(sales.lastCancel?.reason, isNull);
  });

  test(
    'old account cancellation sends versions and clears a selected current sale',
    () async {
      final sales = _Sales();
      final carts = _cartController();
      final lifecycle = _controller(sales, cartController: carts);
      await lifecycle.open(merchantId, locationId, operatorId);
      expect(carts.state.cart?.id, saleId);

      await lifecycle.cancelCarriedOver([cart(version: 4)]);

      final request = sales.lastCarriedOverCancel;
      expect(request?.accounts, [
        {'cartId': saleId, 'expectedVersion': 4},
      ]);
      expect(request?.reasonCode, 'other');
      expect(request?.reason, 'Anulada desde Días anteriores');
      expect(carts.state.cart, isNull);
      expect(lifecycle.state.sale, isNull);
    },
  );

  testWidgets('the cancel dialog will not cancel until a reason is chosen', (
    tester,
  ) async {
    final sales = _Sales();
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        home: Builder(
          builder: (context) => PosPage(
            body: Center(
              child: PosButton(
                onPressed: () => showCancelSaleDialog(context, lifecycle),
                child: const Text('abrir'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();

    final confirm = find.widgetWithText(PosButton, 'Cancelar venta');
    expect(tester.widget<PosButton>(confirm).onPressed, isNull);

    await tester.tap(find.text('Error del operador'));
    await tester.pumpAndSettle();
    await tester.tap(confirm);
    await tester.pumpAndSettle();

    expect(sales.lastCancel?.reasonCode, 'operator_mistake');
    // The comanda is closed AND the till is left ready for the next one.
    // Cancelling used to leave the abandoned order on screen: the cart read
    // answered 404, the panel kept its lines, and the next `Cobrar` was refused
    // with a 409 that took over the whole screen (iMin D3-504, 2026-10-11).
    expect(lifecycle.state.phase, SalePhase.buildingCart);
    expect(sales.starts, 1);
  });

  testWidgets('cancelling an account does not allocate an empty next folio', (
    tester,
  ) async {
    final sales = _Sales();
    final carts = _cartController(_AccountCarts());
    final lifecycle = _controller(sales, cartController: carts);
    await lifecycle.open(
      merchantId,
      locationId,
      operatorId,
      useCartAuthority: true,
    );
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        home: Builder(
          builder: (context) => PosPage(
            body: Center(
              child: PosButton(
                onPressed: () => showCancelSaleDialog(context, lifecycle),
                child: const Text('abrir'),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Otro motivo'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(PosField), 'Cuenta creada por error');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(PosButton, 'Cancelar venta'));
    await tester.pumpAndSettle();

    expect(sales.cancels, 1);
    expect(sales.starts, 0);
    expect(lifecycle.state.phase, SalePhase.idle);
    expect(carts.state.cart, isNull);
  });

  testWidgets('only Other accepts a written cancellation reason', (
    tester,
  ) async {
    final sales = _Sales();
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        home: Builder(
          builder: (context) => PosPage(
            body: PosButton(
              onPressed: () => showCancelSaleDialog(context, lifecycle),
              child: const Text('abrir'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();
    expect(find.text('Describe el motivo'), findsNothing);
    await tester.tap(find.text('Otro motivo'));
    await tester.pumpAndSettle();
    expect(find.text('Describe el motivo'), findsOneWidget);
    final confirm = find.widgetWithText(PosButton, 'Cancelar venta');
    expect(tester.widget<PosButton>(confirm).onPressed, isNull);
    await tester.enterText(find.byType(PosField), 'Motivo especial');
    await tester.pumpAndSettle();
    expect(tester.widget<PosButton>(confirm).onPressed, isNotNull);

    await tester.tap(find.text('Error del operador'));
    await tester.pumpAndSettle();
    expect(find.text('Describe el motivo'), findsNothing);
    await tester.tap(confirm);
    await tester.pumpAndSettle();
    expect(sales.lastCancel?.reasonCode, 'operator_mistake');
    expect(sales.lastCancel?.reason, isNull);
  });

  testWidgets('Other sends its written cancellation reason', (tester) async {
    final sales = _Sales();
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        home: Builder(
          builder: (context) => PosPage(
            body: PosButton(
              onPressed: () => showCancelSaleDialog(context, lifecycle),
              child: const Text('abrir'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Otro motivo'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(PosField), '  Motivo especial  ');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(PosButton, 'Cancelar venta'));
    await tester.pumpAndSettle();
    expect(sales.lastCancel?.reasonCode, 'other');
    expect(sales.lastCancel?.reason, 'Motivo especial');
  });

  testWidgets('admin cancellation does not allocate an empty next folio', (
    tester,
  ) async {
    final sales = _Sales();
    final carts = _cartController(_AccountCarts());
    final lifecycle = _controller(sales, cartController: carts);
    await lifecycle.open(merchantId, locationId, operatorId);
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        home: Builder(
          builder: (context) => PosPage(
            body: Center(
              child: PosButton(
                onPressed: () => showCancelSaleDialog(context, lifecycle),
                child: const Text('abrir'),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Otro motivo'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(PosField), 'Cuenta creada por error');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(PosButton, 'Cancelar venta'));
    await tester.pumpAndSettle();

    expect(sales.cancels, 1);
    expect(sales.starts, 0);
    expect(lifecycle.state.phase, SalePhase.idle);
    expect(carts.state.cart, isNull);
  });

  test(
    'customer attachment stays in the authoritative sale snapshot',
    () async {
      final sales = _Sales();
      final lifecycle = _controller(sales);
      await lifecycle.open(merchantId, locationId, operatorId);
      await lifecycle.attachCustomer(
        const SaleCustomerSummary(
          id: '00000000-0000-4000-8000-000000000020',
          displayName: 'Ana',
          contactHint: '••••1234',
        ),
      );
      expect(lifecycle.state.sale?.customer?['displayName'], 'Ana');
    },
  );

  test('a new sale abandons a cart in progress only when it is asked to', () async {
    final sales = _Sales()..currentSale = sale(state: 'building_cart');
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);

    // The old behaviour, kept for the case nobody confirmed: a cart on screen is
    // not thrown away by a button press that did not mean it.
    await lifecycle.newSale();
    expect(sales.cancels, 0);
    expect(sales.starts, 0);
    expect(lifecycle.state.phase, SalePhase.buildingCart);

    // Asked for, it abandons the sale on screen and starts a fresh one. This is the
    // escape from a cart whose checkout draft carries a payment claim: that cart
    // can be neither paid nor cancelled, and the button used to do nothing at all
    // while a sale was in progress (the plan's own D36 defect).
    await lifecycle.newSale(abandonCurrent: true);
    expect(sales.cancels, 1);
    expect(sales.starts, 1);
    expect(lifecycle.state.phase, SalePhase.buildingCart);
    expect(lifecycle.state.sale?.id, '00000000-0000-4000-8000-000000000010');
  });

  test('rapid new sale actions create one editable sale', () async {
    final sales = _Sales()..currentSale = sale(state: 'cancelled');
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    await Future.wait([lifecycle.newSale(), lifecycle.newSale()]);
    expect(sales.starts, 1);
    expect(lifecycle.state.phase, SalePhase.buildingCart);
  });

  test(
    'the local fast path starts the first account without listing sales',
    () async {
      final sales = _Sales()..currentSale = null;
      final createGate = Completer<Cart>();
      final carts = _cartControllerWithLocalQueue(_BlockedCarts(createGate));
      final lifecycle = _controller(
        sales,
        cartController: carts,
        localFirstFastPathEnabled: true,
      );
      await lifecycle.open(merchantId, locationId, operatorId);
      final currentReads = sales.currentReads;

      expect(await lifecycle.newSale(), isTrue);
      expect(sales.starts, 0);
      expect(sales.currentReads, currentReads);
      expect(carts.state.cart, isNotNull);
      expect(lifecycle.state.phase, SalePhase.buildingCart);
      expect(carts.supportsLocalWrites, isTrue);
      createGate.complete(cart());
      await Future<void>.delayed(Duration.zero);
      lifecycle.dispose();
      carts.dispose();
    },
  );

  test('local writes require the encrypted queue', () async {
    final sales = _Sales()..currentSale = null;
    final carts = _cartController(_Carts());
    final lifecycle = _controller(
      sales,
      cartController: carts,
      localFirstFastPathEnabled: true,
    );
    await lifecycle.open(merchantId, locationId, operatorId);

    expect(await lifecycle.newSale(), isTrue);
    expect(sales.starts, 1);
    expect(carts.supportsLocalWrites, isFalse);
    lifecycle.dispose();
    carts.dispose();
  });

  test('new sale waits for the current account restore', () async {
    final gate = Completer<SaleSnapshot>();
    final sales = _Sales()..currentGate = gate;
    final lifecycle = _controller(sales);

    final opening = lifecycle.open(merchantId, locationId, operatorId);
    await Future<void>.delayed(Duration.zero);
    expect(lifecycle.isRestoringCurrent, isTrue);
    expect(await lifecycle.newSale(), isFalse);
    expect(sales.starts, 0);

    gate.complete(sale());
    await opening;
    expect(lifecycle.isRestoringCurrent, isFalse);
    expect(lifecycle.state.sale?.id, saleId);
    expect(sales.starts, 0);
  });

  test('a cancelled sale cannot be resumed', () async {
    final sales = _Sales()..currentSale = sale(state: 'cancelled');
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    await lifecycle.resume(sale(state: 'cancelled'));
    expect(sales.resumes, 0);
    expect(lifecycle.state.phase, SalePhase.cancelled);
  });

  test('operator exit suspends a nonempty sale', () async {
    final sales = _Sales();
    final carts = _cartController();
    final lifecycle = _controller(sales, cartController: carts);
    await lifecycle.open(merchantId, locationId, operatorId);
    carts.restore(
      Cart(
        id: saleId,
        merchantId: merchantId,
        locationId: locationId,
        operatorSessionId: operatorId,
        status: 'draft',
        version: 2,
        firedOrderId: null,
        fulfillmentType: 'dine_in',
        items: const [
          {
            'id': '00000000-0000-4000-8000-000000000030',
            'productId': '00000000-0000-4000-8000-000000000031',
            'productName': 'Café',
            'quantity': 1,
            'variant': null,
            'modifiers': <Object?>[],
            'note': null,
            'price': {
              'unit': {'minorUnits': 4500, 'currency': 'MXN'},
              'line': {'minorUnits': 4500, 'currency': 'MXN'},
            },
          },
        ],
        totals: const {
          'subtotal': {'minorUnits': 4500, 'currency': 'MXN'},
          'tax': {'minorUnits': 0, 'currency': 'MXN'},
          'discounts': {
            'total': {'minorUnits': 0, 'currency': 'MXN'},
            'entries': <Object?>[],
          },
          'grandTotal': {'minorUnits': 4500, 'currency': 'MXN'},
          'businessDate': '2026-07-29',
        },
        checkoutEnabled: true,
        checkoutMessageCode: 'CHECKOUT_READY',
        updatedAt: '2026-07-29T12:00:00.000Z',
      ),
    );
    expect(await lifecycle.prepareForOperatorExit(), isTrue);
    expect(sales.suspends, 1);
    expect(sales.cancels, 0);
  });

  test(
    'a network failure preserves the editable sale and permits retry',
    () async {
      final sales = _Sales()
        ..suspendFailure = const AppException(
          category: AppErrorCategory.transport,
          code: 'NETWORK_UNAVAILABLE',
          recoverable: true,
        );
      final lifecycle = _controller(sales);
      await lifecycle.open(merchantId, locationId, operatorId);
      await lifecycle.suspend('Mesa 4');
      expect(lifecycle.state.phase, SalePhase.buildingCart);
      expect(lifecycle.state.sale?.id, saleId);
      expect(lifecycle.state.errorCode, 'NETWORK_UNAVAILABLE');
      sales.suspendFailure = null;
      await lifecycle.suspend('Mesa 4');
      expect(sales.suspends, 1);
      expect(lifecycle.state.phase, SalePhase.suspended);
    },
  );

  test(
    'rename, detach, history query, and receipt navigation stay typed',
    () async {
      final sales = _Sales();
      final lifecycle = _controller(sales);
      await lifecycle.open(merchantId, locationId, operatorId);
      await lifecycle.attachCustomer(
        const SaleCustomerSummary(
          id: '00000000-0000-4000-8000-000000000020',
          displayName: 'Ana',
          contactHint: '••••1234',
        ),
      );
      await lifecycle.detachCustomer();
      expect(sales.detaches, 1);
      await lifecycle.suspend('Mesa 4');
      final suspended = lifecycle.state.sale!;
      await lifecycle.renameSuspended(suspended, 'Mostrador');
      expect(sales.renames, 1);
      await lifecycle.loadHistory(
        state: 'suspended',
        search: 'Mostrador',
        sort: 'oldest',
      );
      expect(sales.lastHistoryQuery?.search, 'Mostrador');
      expect(sales.lastHistoryQuery?.sort, 'oldest');
      await lifecycle.openReceipt(sale(state: 'committed'));
      expect(sales.receipts, 1);
    },
  );

  test(
    'sale history loads the next cursor without losing the first page',
    () async {
      final sales = _Sales()..historyNextCursor = 'cursor-2';
      final lifecycle = _controller(sales);
      await lifecycle.open(merchantId, locationId, operatorId);
      await lifecycle.loadHistory(state: 'committed');
      expect(lifecycle.canLoadMoreHistory, isTrue);
      await lifecycle.loadMoreHistory();
      expect(lifecycle.state.history.map((item) => item.id).toSet(), {
        saleId,
        '00000000-0000-4000-8000-000000000099',
      });
      expect(sales.lastHistoryQuery?.cursor, 'cursor-2');
      expect(lifecycle.canLoadMoreHistory, isFalse);
    },
  );

  test(
    'latest history query wins when responses arrive out of order',
    () async {
      final sales = _Sales()..deferHistory = true;
      final lifecycle = _controller(sales);
      await lifecycle.open(merchantId, locationId, operatorId);
      final old = lifecycle.loadHistory(
        state: 'suspended',
        search: 'cappuccino',
      );
      final latest = lifecycle.loadHistory(
        state: 'committed',
        search: 'latte',
        sort: 'oldest',
      );
      try {
        expect(sales.pendingHistory, hasLength(2));
        expect(sales.historyQueries.last.search, 'latte');
        sales.pendingHistory[1].complete(
          SaleHistoryPage(
            items: [sale(id: 'latest', state: 'committed').toJson()],
            nextCursor: 'latest-cursor',
          ),
        );
        await latest;
        expect(lifecycle.state.history.single.id, 'latest');
        expect(lifecycle.historyLoading, isFalse);
        sales.pendingHistory[0].complete(
          SaleHistoryPage(
            items: [sale(id: 'obsolete', state: 'suspended').toJson()],
            nextCursor: null,
          ),
        );
        await old;
        expect(lifecycle.state.history.single.id, 'latest');
        expect(lifecycle.canLoadMoreHistory, isTrue);
      } finally {
        for (final pending in sales.pendingHistory) {
          if (!pending.isCompleted) {
            pending.complete(
              const SaleHistoryPage(items: [], nextCursor: null),
            );
          }
        }
        await Future.wait([old, latest]);
        lifecycle.dispose();
      }
    },
  );

  test(
    'obsolete history failure cannot end loading or change the sale',
    () async {
      final sales = _Sales()..deferHistory = true;
      final lifecycle = _controller(sales);
      await lifecycle.open(merchantId, locationId, operatorId);
      final old = lifecycle.loadHistory(search: 'old');
      final latest = lifecycle.loadHistory(search: 'latest');
      try {
        expect(sales.pendingHistory, hasLength(2));
        sales.pendingHistory[0].completeError(
          const AppException(
            category: AppErrorCategory.transport,
            code: 'NETWORK_UNAVAILABLE',
            recoverable: true,
          ),
        );
        await old;
        expect(lifecycle.historyLoading, isTrue);
        expect(lifecycle.state.phase, SalePhase.buildingCart);
        expect(lifecycle.state.errorCode, isNull);
        sales.pendingHistory[1].complete(
          const SaleHistoryPage(items: [], nextCursor: null),
        );
        await latest;
        expect(lifecycle.historyLoading, isFalse);
        expect(lifecycle.state.errorCode, isNull);
      } finally {
        for (final pending in sales.pendingHistory) {
          if (!pending.isCompleted) {
            pending.complete(
              const SaleHistoryPage(items: [], nextCursor: null),
            );
          }
        }
        await Future.wait([old, latest]);
        lifecycle.dispose();
      }
    },
  );

  test(
    'a new history query discards a pending append and its cursor',
    () async {
      final sales = _Sales()..historyNextCursor = 'page-two';
      final lifecycle = _controller(sales);
      await lifecycle.open(merchantId, locationId, operatorId);
      await lifecycle.loadHistory(state: 'committed');
      sales.deferHistory = true;
      final append = lifecycle.loadMoreHistory();
      final latest = lifecycle.loadHistory(
        state: 'suspended',
        search: 'croissant',
      );
      try {
        expect(sales.pendingHistory, hasLength(2));
        expect(
          sales.historyQueries[sales.historyQueries.length - 2].cursor,
          'page-two',
        );
        expect(sales.historyQueries.last.cursor, isNull);
        sales.pendingHistory[1].complete(
          SaleHistoryPage(
            items: [sale(id: 'fresh', state: 'suspended').toJson()],
            nextCursor: null,
          ),
        );
        await latest;
        sales.pendingHistory[0].complete(
          SaleHistoryPage(
            items: [sale(id: 'old-page', state: 'committed').toJson()],
            nextCursor: 'obsolete-cursor',
          ),
        );
        await append;
        expect(lifecycle.state.history.map((item) => item.id), ['fresh']);
        expect(lifecycle.canLoadMoreHistory, isFalse);
      } finally {
        for (final pending in sales.pendingHistory) {
          if (!pending.isCompleted) {
            pending.complete(
              const SaleHistoryPage(items: [], nextCursor: null),
            );
          }
        }
        await Future.wait([append, latest]);
        lifecycle.dispose();
      }
    },
  );

  test(
    'a history failure preserves the active commercial sale phase',
    () async {
      final sales = _Sales()..deferHistory = true;
      final lifecycle = _controller(sales);
      await lifecycle.open(merchantId, locationId, operatorId);
      final history = lifecycle.loadHistory(search: 'croissant');
      sales.pendingHistory.single.completeError(
        const AppException(
          category: AppErrorCategory.transport,
          code: 'NETWORK_UNAVAILABLE',
          recoverable: true,
        ),
      );
      await history;
      expect(lifecycle.state.phase, SalePhase.buildingCart);
      expect(lifecycle.state.sale?.id, saleId);
      expect(lifecycle.state.errorCode, isNull);
      lifecycle.dispose();
    },
  );

  test(
    'disposing the controller discards a pending history response',
    () async {
      final sales = _Sales()..deferHistory = true;
      final lifecycle = _controller(sales);
      await lifecycle.open(merchantId, locationId, operatorId);
      final pending = lifecycle.loadHistory(search: 'croissant');
      lifecycle.dispose();
      sales.pendingHistory.single.complete(
        SaleHistoryPage(
          items: [sale(id: 'obsolete').toJson()],
          nextCursor: 'old',
        ),
      );
      await pending;
      expect(lifecycle.state.history, isEmpty);
      expect(lifecycle.canLoadMoreHistory, isFalse);
    },
  );

  test('changing location invalidates a pending history response', () async {
    final sales = _Sales()..deferHistory = true;
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    final pending = lifecycle.loadHistory(search: 'croissant');
    await lifecycle.open(merchantId, 'another-location', operatorId);
    sales.pendingHistory.single.complete(
      SaleHistoryPage(
        items: [sale(id: 'wrong-location').toJson()],
        nextCursor: 'old',
      ),
    );
    await pending;
    expect(lifecycle.state.history, isEmpty);
    expect(lifecycle.canLoadMoreHistory, isFalse);
    expect(lifecycle.historyLoading, isFalse);
    lifecycle.dispose();
  });

  for (final scale in [1.0, 2.0]) {
    testWidgets('history page retry preserves rows and cursor at $scale', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(375, 812);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await _loadPosFonts();
      final first = SaleSnapshot.fromJson({
        ...sale(state: 'suspended').toJson(),
        'label': 'Pedido de Lucía',
        'cart': _historyTestCart(),
      });
      final sales = _Sales()
        ..historyItems = [first]
        ..historyNextCursor = 'page-two';
      final lifecycle = _controller(sales);
      await lifecycle.open(merchantId, locationId, operatorId);
      await tester.pumpWidget(
        _scaledHistoryApp(
          SaleCenterSurface(
            lifecycle: lifecycle,
            embedded: true,
            permissions: OperatorPermissions(const ['sale.lifecycle']),
          ),
          scale,
        ),
      );
      await tester.pumpAndSettle();
      final scrolling = find
          .descendant(
            of: find.byType(SaleCenterSurface),
            matching: find.byType(Scrollable),
          )
          .first;
      await tester.scrollUntilVisible(
        find.text('Cargar más ventas'),
        250,
        scrollable: scrolling,
      );
      await tester.pumpAndSettle();
      sales.deferHistory = true;
      await tester.tap(find.text('Cargar más ventas'));
      await tester.pump();
      expect(lifecycle.state.history.single.id, first.id);
      expect(
        tester
            .widget<PosButton>(
              find.widgetWithText(PosButton, 'Cargar más ventas'),
            )
            .onPressed,
        isNull,
      );
      expect(sales.historyQueries.last.cursor, 'page-two');
      sales.pendingHistory.single.completeError(
        const AppException(
          category: AppErrorCategory.transport,
          code: 'NETWORK_UNAVAILABLE',
          recoverable: true,
        ),
      );
      await tester.pumpAndSettle();
      expect(lifecycle.state.history.single.id, first.id);
      expect(find.text('No hay ventas para esta vista.'), findsNothing);
      await tester.ensureVisible(find.text('Reintentar'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Reintentar'));
      await tester.pump();
      expect(sales.historyQueries.last.cursor, 'page-two');
      expect(sales.pendingHistory, hasLength(2));
      final second = sale(
        id: '00000000-0000-4000-8000-000000000020',
        state: 'suspended',
      );
      sales.pendingHistory.last.complete(
        SaleHistoryPage(items: [second.toJson()], nextCursor: null),
      );
      await tester.pumpAndSettle();
      expect(lifecycle.state.history.map((item) => item.id), [
        first.id,
        second.id,
      ]);
      expect(find.text('Reintentar'), findsNothing);
      expect(lifecycle.canLoadMoreHistory, isFalse);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      lifecycle.dispose();
    });
  }

  for (final scale in [1.0, 2.0]) {
    testWidgets(
      'history distinguishes pending, failure, retry and no matches at $scale',
      (tester) async {
        tester.view.physicalSize = const Size(375, 812);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await _loadPosFonts();
        final sales = _Sales()..deferHistory = true;
        final lifecycle = _controller(sales);
        await lifecycle.open(merchantId, locationId, operatorId);
        await tester.pumpWidget(
          _scaledHistoryApp(
            SaleCenterSurface(
              lifecycle: lifecycle,
              embedded: true,
              permissions: OperatorPermissions(const ['sale.lifecycle']),
            ),
            scale,
          ),
        );
        await tester.pump();
        expect(find.text('Buscando ventas…'), findsOneWidget);
        expect(find.text('No hay ventas para esta vista.'), findsNothing);
        sales.pendingHistory.single.completeError(
          const AppException(
            category: AppErrorCategory.transport,
            code: 'NETWORK_UNAVAILABLE',
            recoverable: true,
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('No se pudo cargar el historial.'), findsOneWidget);
        expect(find.text('Reintentar'), findsOneWidget);
        expect(find.text('No hay ventas para esta vista.'), findsNothing);
        expect(lifecycle.state.phase, SalePhase.buildingCart);
        await tester.ensureVisible(find.text('Reintentar'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Reintentar'));
        await tester.pump();
        expect(sales.pendingHistory, hasLength(2));
        expect(find.text('Buscando ventas…'), findsOneWidget);
        sales.pendingHistory.last.complete(
          const SaleHistoryPage(items: [], nextCursor: null),
        );
        await tester.pumpAndSettle();
        expect(find.text('No hay ventas para esta vista.'), findsOneWidget);
        await tester.ensureVisible(find.byType(EditableText));
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(EditableText), 'croissant');
        await tester.testTextInput.receiveAction(TextInputAction.done);
        await tester.pump();
        expect(find.text('Buscando ventas…'), findsOneWidget);
        expect(
          find.text('No hay ventas que coincidan con esta búsqueda.'),
          findsNothing,
        );
        sales.pendingHistory.last.complete(
          const SaleHistoryPage(items: [], nextCursor: null),
        );
        await tester.pumpAndSettle();
        expect(
          find.text('No hay ventas que coincidan con esta búsqueda.'),
          findsOneWidget,
        );
        await tester.pumpWidget(const SizedBox());
        lifecycle.dispose();
      },
    );
  }

  testWidgets('sale center exposes localized accessible actions', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    final sales = _Sales();
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    sales.currentSale = sale(state: 'suspended');
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,

          GlobalWidgetsLocalizations.delegate,
        ],
        home: Builder(
          builder: (context) => PosPage(
            body: PosButton(
              onPressed: () => showSaleCenter(
                context,
                lifecycle,
                OperatorPermissions(const ['sale.lifecycle']),
              ),
              child: const Text('abrir'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();
    expect(find.text('Ventas'), findsWidgets);
    expect(find.text('suspended'), findsNothing);
    // Every row is named "Venta". A sale is identified by the moment it
    // happened, so the rename control is gone from the list.
    expect(find.text('Venta'), findsWidgets);
    expect(find.byTooltip('Cambiar nombre de venta suspendida'), findsNothing);
    expect(find.text('Reanudar venta'), findsOneWidget);
    semantics.dispose();
  });
}
