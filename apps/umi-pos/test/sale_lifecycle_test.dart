import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/operator_permissions.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/sale/sale_lifecycle_controller.dart';
import 'package:umi_pos/features/sale/sale_repository.dart';
import 'package:umi_pos/features/sale/sale_surface.dart';

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
  cancellationReason: null,
  committedSaleId: null,
  receiptId: null,
  receiptRef: null,
  updatedAt: '2026-07-29T12:00:00.000Z',
);

final class _Sales implements SaleRepository {
  SaleSnapshot? currentSale = sale();
  int starts = 0;
  int suspends = 0;
  int resumes = 0;
  int cancels = 0;
  int renames = 0;
  int detaches = 0;
  int receipts = 0;
  AppException? suspendFailure;
  SaleHistoryQuery? lastHistoryQuery;
  String? historyNextCursor;

  @override
  Future<SaleSnapshot> current(
    String merchantId,
    SaleHistoryQuery query,
  ) async {
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
    cancels++;
    currentSale = sale(
      state: 'cancelled',
      version: request.expectedVersion + 1,
    );
    return currentSale!;
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
    final item = query.cursor == null
        ? currentSale
        : sale(id: '00000000-0000-4000-8000-000000000099', state: 'committed');
    return SaleHistoryPage(
      items: item == null ? const [] : [item.toJson()],
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
      receipt: null,
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
}

CartController _cartController() => CartController(
  repository: _Carts(),
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
}) => SaleLifecycleController(
  repository: sales,
  cart: cartController ?? _cartController(),
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

void main() {
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

  test('startup creates one sale only when no active sale exists', () async {
    final sales = _Sales()..currentSale = null;
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    expect(sales.starts, 1);
    await lifecycle.open(merchantId, locationId, operatorId);
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

  test('successful checkout starts the next sale once', () async {
    final sales = _Sales();
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    lifecycle.checkoutStarted();
    await lifecycle.checkoutCommitted();
    await lifecycle.checkoutCommitted();
    expect(sales.starts, 1);
    expect(lifecycle.state.phase, SalePhase.buildingCart);
    expect(lifecycle.state.readyForNextCustomer, isTrue);
  });

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

  test('rapid new sale actions create one editable sale', () async {
    final sales = _Sales()..currentSale = sale(state: 'cancelled');
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    await Future.wait([lifecycle.newSale(), lifecycle.newSale()]);
    expect(sales.starts, 1);
    expect(lifecycle.state.phase, SalePhase.buildingCart);
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

  testWidgets('sale center exposes localized accessible actions', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    final sales = _Sales();
    final lifecycle = _controller(sales);
    await lifecycle.open(merchantId, locationId, operatorId);
    sales.currentSale = sale(state: 'suspended');
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: Builder(
          builder: (context) => Scaffold(
            body: FilledButton(
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
    expect(
      find.byTooltip('Cambiar nombre de venta suspendida'),
      findsOneWidget,
    );
    expect(find.text('Reanudar venta'), findsOneWidget);
    semantics.dispose();
  });
}
