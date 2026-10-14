import 'package:flutter/rendering.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/cart/account_details_surface.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/catalog/catalog_controller.dart';
import 'package:umi_pos/features/catalog/catalog_repository.dart';
import 'package:umi_pos/features/catalog/catalog_surface.dart';
import 'package:umi_pos/features/entry/entry_controller.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';
import 'package:umi_pos/features/sale/sale_lifecycle_controller.dart';
import 'package:umi_pos/features/sale/sale_repository.dart';

import 'receipt_document_test.dart' show fonts;
import 'support/fakes.dart';

/// The cart on a short viewport.
///
/// Plan §2.1 finding 8: with the keyboard up, the till overflowed the cart with a
/// debug stripe over the sale. The reproduction is a phone-sized surface with the
/// keyboard inset — the panel and the messages must scroll, not overflow.

final class _Gateway implements EntryGateway {
  _Gateway({this.permissions = const ['cart.write', 'order.fire']});
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

class _CartRepo implements CartRepository {
  _CartRepo(this.cart);
  Cart cart;

  /// What `add` answers instead of taking the line. The API's refusal is the same
  /// code for a product that is not orderable and for an account the till may no
  /// longer write; which one it is comes from [read], never from the code.
  Object? addFailure;
  Object? createFailure;

  /// How many accounts this till opened. `Nueva cuenta` on an empty account must
  /// leave this at zero: an account nobody can recognize is not worth a row.
  int creates = 0;

  @override
  Future<Cart> read(String merchantId, CartQuery query) async => cart;

  @override
  Future<Cart> add(String merchantId, CartLineInput input) async {
    final failure = addFailure;
    if (failure != null) throw failure;
    return cart;
  }

  @override
  Future<Cart> create(String merchantId, CreateCartRequest request) async {
    creates += 1;
    final failure = createFailure;
    if (failure != null) throw failure;
    return cart;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

class _AccountCartRepo extends _CartRepo implements OpenAccountCartRepository {
  _AccountCartRepo(super.cart);

  /// How many records this till put aside. The defect the owner reported on
  /// 2026-10-13 — "solo se acumulan si spamean el botón" — was this counter
  /// climbing once per tap on a cart that held nothing.
  int suspends = 0;

  @override
  Future<Cart> suspendAccount(
    String merchantId, {
    required Cart cart,
    required CartQuery query,
    required String idempotencyKey,
    String? accountName,
    bool updateName = false,
  }) async {
    suspends += 1;
    return this.cart = Cart.fromJson({
      ...cart.toJson(),
      'version': cart.version + 1,
      'lifecycleState': 'suspended',
    });
  }
}

final class _DetailedAccountCartRepo extends _AccountCartRepo
    implements AccountDetailsCartRepository {
  _DetailedAccountCartRepo(super.cart);
  bool failRenameOnce = false;
  int renameAttempts = 0;
  @override
  Future<Cart> setAccountDetails(
    String merchantId,
    String cartId,
    SetCartAccountDetailsRequest request,
  ) async {
    if (++renameAttempts == 1 && failRenameOnce) {
      throw const AppException(
        category: AppErrorCategory.conflict,
        code: 'CART_VERSION_CONFLICT',
        recoverable: true,
      );
    }
    return cart = Cart.fromJson({
      ...cart.toJson(),
      'accountName': request.accountName,
      'version': request.expectedVersion + 1,
    });
  }
}

final class _AccountSales implements SaleRepository {
  _AccountSales(this.repository, {this.missingOnce = false});
  final _CartRepo repository;
  bool missingOnce;
  @override
  Future<SaleSnapshot> current(
    String merchantId,
    SaleHistoryQuery query,
  ) async {
    if (missingOnce || repository.createFailure != null) {
      missingOnce = false;
      throw const AppException(
        category: AppErrorCategory.conflict,
        code: 'SALE_NOT_FOUND',
        recoverable: true,
      );
    }
    final cart = repository.cart;
    return SaleSnapshot(
      id: cart.id,
      state: 'building_cart',
      cart: cart.toJson(),
      label: cart.accountName,
      customer: null,
      originalOperatorSessionId: cart.operatorSessionId,
      currentOperatorSessionId: query.operatorSessionId,
      suspendedAt: null,
      cancelledAt: null,
      cancellationReasonCode: null,
      cancellationReason: null,
      committedSaleId: null,
      sourceOrderId: null,
      receiptId: null,
      receiptRef: null,
      updatedAt: cart.updatedAt,
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw StateError('Unexpected sale command');
}

/// A branch with no products: the till shows its message, and the cart holds
/// enough lines to be taller than the space left above the keyboard.
final class _EmptyCatalogRepo implements CatalogRepository {
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

final class _PopulatedCatalogRepo implements CatalogRepository {
  @override
  Future<CatalogCategoriesResponse> categories(CatalogPartition partition) =>
      _EmptyCatalogRepo().categories(partition);

  @override
  Future<CatalogPage> products(
    CatalogPartition partition, {
    String? categoryId,
    String? search,
    String? barcode,
    String? cursor,
    CancellationToken? cancellation,
  }) async => CatalogPage(
    items: [
      for (var i = 0; i < 12; i++)
        {
          'id': 'product-$i',
          'name': 'Producto $i',
          'description': null,
          'sku': 'P-$i',
          'hasBarcode': false,
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
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

Future<
  ({
    CatalogSurface surface,
    CartController cart,
    SaleLifecycleController sales,
    _CartRepo repository,
    Cart Function() persistedCart,
    VoidCallback dispose,
  })
>
_fixture({
  bool openAccounts = false,
  String? accountName,
  String? tableName,
  bool renameFailsOnce = false,
  bool accountInitiallyMissing = false,
  bool waiterMode = false,
  int lines = 6,
  String? accountFolio,
}) async {
  final root = testRoot();
  final entry = EntryController(
    gateway: _Gateway(
      permissions: [
        'cart.write',
        'order.fire',
        if (!waiterMode) 'checkout.commit',
        if (!waiterMode) 'sale.lifecycle',
      ],
    ),
    vault: CredentialVault(MemorySecureStorage()),
    telemetry: root.telemetry,
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
          'name': 'Local',
          'status': 'active',
          'deviceAllowed': true,
          'operatorAllowed': true,
        },
      ],
    }),
  );
  final initialCart = accountName == null
      ? (accountFolio == null
            ? _cartWithLines(lines)
            : Cart.fromJson({
                ..._cartWithLines(lines).toJson(),
                'accountFolio': accountFolio,
              }))
      : Cart.fromJson({
          ..._cartWithLines(6).toJson(),
          'accountName': accountName,
          'accountFolio': 'Cuenta 024',
          'createdAt': '2026-10-12T00:00:00Z',
          'operatorName': 'Ana López',
          if (tableName != null) 'tableId': 'table',
          'tableName': ?tableName,
        });
  final repository = accountName != null
      ? _DetailedAccountCartRepo(initialCart)
      : openAccounts
      ? _AccountCartRepo(initialCart)
      : _CartRepo(initialCart);
  final cart = CartController(repository: repository, telemetry: root.telemetry)
    ..restore(initialCart);
  if (repository is _DetailedAccountCartRepo) {
    repository.failRenameOnce = renameFailsOnce;
  }
  final sales = accountName == null
      ? root.sales
      : SaleLifecycleController(
          repository: _AccountSales(
            repository,
            missingOnce: accountInitiallyMissing,
          ),
          cart: cart,
          telemetry: root.telemetry,
        );
  final catalog = CatalogController(
    repository: _PopulatedCatalogRepo(),
    cache: CatalogCache(),
    telemetry: root.telemetry,
  );
  return (
    surface: CatalogSurface(
      entry: entry,
      catalog: catalog,
      cart: cart,
      cash: root.cash,
      checkout: root.checkout,
      sales: sales,
      exceptions: root.exceptions,
      connectivity: root.connectivity,
      telemetry: root.telemetry,
    ),
    cart: cart,
    sales: sales,
    repository: repository,
    persistedCart: () => repository.cart,
    dispose: () {
      if (sales != root.sales) sales.dispose();
      catalog.dispose();
      cart.dispose();
      entry.dispose();
      root.dispose();
    },
  );
}

Widget _scaledApp(Widget home, String locale, double scale) => PosApp(
  locale: Locale(locale),
  theme: UmiTheme.light(),
  supportedLocales: AppLocalizations.supportedLocales,
  localizationsDelegates: const [
    AppLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ],
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
    child: child!,
  ),
  home: home,
);

void _completeText(WidgetTester tester, String label) {
  final target = find.text(label).hitTestable();
  expect(target, findsOneWidget, reason: label);
  final render = tester.renderObject<RenderParagraph>(target);
  final boxes = render.getBoxesForSelection(
    TextSelection(baseOffset: 0, extentOffset: label.length),
  );
  expect(boxes, hasLength(1), reason: label);
  expect(
    boxes.single.right,
    lessThanOrEqualTo(render.size.width + 1),
    reason: label,
  );
  expect(render.didExceedMaxLines, isFalse, reason: label);
}

void main() {
  testWidgets('the open mobile cart sheet follows authoritative cart changes', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1340);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await fonts();
    final fixture = await _fixture(lines: 2, waiterMode: true);
    try {
      await tester.pumpWidget(_scaledApp(fixture.surface, 'es', 1));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(PosOrderButton));
      await tester.pumpAndSettle();
      expect(find.text('Latte 1'), findsOneWidget);
      fixture.cart.restore(_cartWithLines(1));
      await tester.pumpAndSettle();
      expect(find.text('Latte 1'), findsNothing);
      expect(find.text('Latte 0'), findsOneWidget);
      expect(find.text('Guardar y salir'), findsNothing);
      expect(tester.takeException(), isNull);
    } finally {
      await tester.pumpWidget(const SizedBox());
      fixture.dispose();
    }
  });
  testWidgets(
    'going takeout on a table account warns that the table is emptied',
    (tester) async {
      tester.view.physicalSize = const Size(1920, 1014);
      tester.view.devicePixelRatio = 1.375;
      addTearDown(tester.view.reset);
      await fonts();
      final fixture = await _fixture(
        accountName: 'Ana terraza',
        tableName: 'Mesa 2',
      );
      try {
        await tester.pumpWidget(_scaledApp(fixture.surface, 'es', 1));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Para llevar'));
        await tester.pumpAndSettle();
        // The question is asked before the table is given up, and it names it.
        expect(find.text('Cambiar a para llevar'), findsWidgets);
        expect(find.textContaining('Mesa 2'), findsWidgets);
        expect(find.textContaining('la mesa quedará vacía'), findsOneWidget);
        await tester.tap(find.text('Cancelar'));
        await tester.pumpAndSettle();
        expect(find.text('Cambiar a para llevar'), findsNothing);
        expect(fixture.cart.state.cart!.fulfillmentType, 'dine_in');
        expect(fixture.cart.state.cart!.tableName, 'Mesa 2');
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        fixture.dispose();
      }
    },
  );

  testWidgets(
    'assigned account leads with its folio and keeps table and name secondary',
    (tester) async {
      tester.view.physicalSize = const Size(1920, 1014);
      tester.view.devicePixelRatio = 1.375;
      addTearDown(tester.view.reset);
      await fonts();
      final fixture = await _fixture(
        accountName: 'Ana terraza',
        tableName: 'Mesa 2',
      );
      try {
        await tester.pumpWidget(_scaledApp(fixture.surface, 'es', 1));
        await tester.pumpAndSettle();
        expect(find.text('Cuenta 024'), findsOneWidget);
        expect(find.text('Mesa 2'), findsOneWidget);
        expect(find.text('Ana terraza'), findsOneWidget);
        expect(find.byTooltip('Cuenta 024 · Ana López'), findsOneWidget);
        expect(find.text('Asignar mesa'), findsNothing);
        expect(find.text('Agregar mesa'), findsNothing);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        fixture.dispose();
      }
    },
  );

  // The rename test that stood here went with the button. The owner struck the
  // account name from the comanda (2026-10-12): the folio identifies the account
  // and the table says where the food goes, so the till no longer offers to name
  // one. `showAccountNameDialog` and `CartController.renameAccount` are still in
  // the tree, and `open_accounts_test` still covers the dialog's own two answers.

  testWidgets(
    '120 character account name keeps the actions reachable on iMin at 200%',
    (tester) async {
      tester.view.physicalSize = const Size(1920, 1014);
      tester.view.devicePixelRatio = 1.375;
      addTearDown(tester.view.reset);
      await fonts();
      final fixture = await _fixture(
        accountName: List.filled(12, 'Cuenta Ana').join(),
      );
      try {
        await tester.pumpWidget(_scaledApp(fixture.surface, 'es', 2));
        await tester.pumpAndSettle();
        expect(find.text('Cuenta 024'), findsOneWidget);
        // A name set before this change can still be on an open account. It is no
        // longer typed here and no longer identifies the account, but it must not
        // push the actions the cart does offer out of reach.
        expect(find.text('Cobrar').hitTestable(), findsOneWidget);
        expect(find.text('Enviar a cocina').hitTestable(), findsOneWidget);
        expect(find.text('Guardar y salir'), findsNothing);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        fixture.dispose();
      }
    },
  );

  testWidgets(
    'the ordinary cart offers no save-and-leave and keeps its actions reachable',
    (tester) async {
      tester.view.physicalSize = const Size(1920, 1014);
      tester.view.devicePixelRatio = 1.375;
      addTearDown(tester.view.reset);
      await fonts();
      final fixture = await _fixture(openAccounts: true);
      try {
        await tester.pumpWidget(_scaledApp(fixture.surface, 'es', 2));
        await tester.pumpAndSettle();
        // The owner struck it from the ordinary cart (2026-10-12): starting a sale
        // saves the account anyway, so the button asked a question the screen had
        // already answered. The lines stay with the cart and the actions the cart
        // does offer stay reachable.
        expect(find.text('Guardar y salir'), findsNothing);
        final checkout = find.text('Cobrar').hitTestable();
        expect(checkout, findsOneWidget);
        expect(
          tester.getRect(checkout).bottom,
          lessThanOrEqualTo(1014 / 1.375),
        );
        expect(
          fixture.cart.state.cart!.items.every(
            (line) => line['fired'] == false,
          ),
          isTrue,
        );
        expect(fixture.cart.state.cart, isNotNull);
        expect(fixture.persistedCart().items, hasLength(6));
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        fixture.dispose();
      }
    },
  );

  for (final locale in ['es', 'en']) {
    // THE TILL'S OWN GEOMETRY. 1920x1080 device pixels at 220 dpi is a device pixel ratio of 1.375,
    // and the navigation bar leaves the app a 1014-pixel-tall window: 1396 x 737 LOGICAL pixels.
    // The case above renders 1280x1000 logical — a canvas a third taller than the till — so it can
    // report an action as reachable that the hardware clips (that is exactly how the sign-in screen
    // hid its `Continuar` at `Muy grande`; see docs/reports/2026-10-11-imin-device-retest.md).
    testWidgets('cart actions stay on the till screen at 200% in $locale', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1920, 1014);
      tester.view.devicePixelRatio = 1.375;
      addTearDown(tester.view.reset);
      await fonts();
      final fixture = await _fixture();
      try {
        await tester.pumpWidget(_scaledApp(fixture.surface, locale, 2));
        await tester.pumpAndSettle();
        final windowHeight =
            tester.view.physicalSize.height / tester.view.devicePixelRatio;
        for (final label
            in locale == 'es'
                ? ['Enviar a cocina', 'Cobrar']
                : ['Send to kitchen', 'Checkout']) {
          final target = find.text(label);
          expect(target, findsOneWidget, reason: label);
          expect(
            tester.getRect(target).bottom,
            lessThanOrEqualTo(windowHeight),
            reason: '$label sits below the till window at 200 % text',
          );
          expect(
            target.hitTestable(),
            findsOneWidget,
            reason: '$label is not tappable where it stands at 200 % text',
          );
        }
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        fixture.dispose();
      }
    });

    testWidgets('cart action words remain complete at 200% in $locale', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1280, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await fonts();
      final fixture = await _fixture();
      try {
        await tester.pumpWidget(_scaledApp(fixture.surface, locale, 2));
        await tester.pumpAndSettle();
        for (final label
            in locale == 'es'
                ? ['Enviar a cocina', 'Cobrar']
                : ['Send to kitchen', 'Checkout']) {
          _completeText(tester, label);
        }
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        fixture.dispose();
      }
    });
    for (final scale in [1.0, 2.0]) {
      testWidgets(
        'short $locale viewport reveals editor, last product and cart actions at $scale',
        (tester) async {
          tester.view.physicalSize = const Size(1280, 1000);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          await fonts();
          final fixture = await _fixture();
          try {
            await tester.pumpWidget(_scaledApp(fixture.surface, locale, scale));
            await tester.pumpAndSettle();
            final field = find.byKey(const ValueKey('hardware-barcode-search'));
            final editor = find.descendant(
              of: field,
              matching: find.byType(EditableText),
            );
            await tester.enterText(editor, 'croissant');
            await tester.pumpAndSettle();
            tester.view.physicalSize = const Size(812, 375);
            await tester.pumpAndSettle();
            expect(
              tester.widget<EditableText>(editor).focusNode.hasPrimaryFocus,
              isTrue,
            );
            expect(
              tester.widget<EditableText>(editor).controller.text,
              'croissant',
            );
            final viewport = tester.getRect(
              find.ancestor(of: field, matching: find.byType(Scrollable)).first,
            );
            final rect = tester.getRect(field);
            expect(rect.top, greaterThanOrEqualTo(viewport.top - 1));
            expect(
              rect.bottom,
              lessThanOrEqualTo(viewport.bottom + 1),
              reason:
                  'the whole editor must be visible, not just its focused border',
            );
            final catalogScroll = find
                .descendant(
                  of: find.byKey(const PageStorageKey('catalog-grid')),
                  matching: find.byType(Scrollable),
                )
                .first;
            await tester.scrollUntilVisible(
              find.text('Producto 11'),
              180,
              scrollable: catalogScroll,
              maxScrolls: 40,
            );
            await tester.pumpAndSettle();
            expect(find.text('Producto 11').hitTestable(), findsOneWidget);
            final order = find.byType(PosOrderButton);
            expect(order.hitTestable(), findsOneWidget);
            await tester.tap(order);
            await tester.pumpAndSettle();
            final options = find.byTooltip(
              locale == 'es' ? 'Opciones de cuenta' : 'Account options',
            );
            expect(options.hitTestable(), findsOneWidget);
            await tester.tap(options);
            await tester.pumpAndSettle();
            final clear = find.text(
              locale == 'es' ? 'Vaciar cuenta' : 'Clear account',
            );
            _completeText(
              tester,
              locale == 'es' ? 'Vaciar cuenta' : 'Clear account',
            );
            await tester.tap(clear);
            await tester.pumpAndSettle();
            expect(find.byType(PosAlertDialog), findsOneWidget);
            await tester.tap(
              find.descendant(
                of: find.byType(PosAlertDialog),
                matching: find.byType(PosTextButton),
              ),
            );
            await tester.pumpAndSettle();
            expect(fixture.cart.state.cart?.items.length, 6);
            final checkout = find.text(locale == 'es' ? 'Cobrar' : 'Checkout');
            if (checkout.hitTestable().evaluate().isEmpty) {
              final scroll = find
                  .descendant(
                    of: find.byType(PosCard),
                    matching: find.byType(Scrollable),
                  )
                  .first;
              await tester.scrollUntilVisible(
                checkout,
                120,
                scrollable: scroll,
              );
              await tester.pumpAndSettle();
            }
            expect(checkout.hitTestable(), findsOneWidget);
            _completeText(tester, locale == 'es' ? 'Cobrar' : 'Checkout');
            expect(find.text('MXN 390.00').hitTestable(), findsWidgets);
            final close = find.byTooltip(
              locale == 'es' ? 'Cerrar comanda' : 'Close order',
            );
            expect(close.hitTestable(), findsOneWidget);
            await tester.tap(close);
            await tester.pumpAndSettle();
            expect(fixture.cart.state.cart?.items.length, 6);
            expect(tester.takeException(), isNull);
          } finally {
            await tester.pumpWidget(const SizedBox());
            fixture.dispose();
          }
        },
      );
    }
  }

  testWidgets('the cart opens on a short viewport without overflowing', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 600);
    tester.view.devicePixelRatio = 1.0;
    // The keyboard is up: 300 logical pixels of the bottom are gone.
    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    addTearDown(tester.view.reset);

    final root = testRoot();
    final entry = EntryController(
      gateway: _Gateway(),
      vault: CredentialVault(MemorySecureStorage()),
      telemetry: SafeTelemetry(
        enabled: false,
        context: TelemetryContext.current(testConfig),
        exporter: RecordingExporter(),
      ),
    );
    await entry.selectTenant(
      EntryMerchant.fromJson({
        'id': 'merchant',
        'name': 'Test café',
        'roles': <Object?>[],
        'permissions': <Object?>[],
        'entitlements': <Object?>[],
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
      }),
    );
    final cartRepository = _CartRepo(_cartWithLines(6));
    final cart = CartController(
      repository: cartRepository,
      telemetry: root.telemetry,
    )..restore(cartRepository.cart);

    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        theme: UmiTheme.light(),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,

          GlobalWidgetsLocalizations.delegate,
        ],
        home: CatalogSurface(
          entry: entry,
          catalog: CatalogController(
            repository: _EmptyCatalogRepo(),
            cache: CatalogCache(),
            telemetry: root.telemetry,
          ),
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

    // The cart is behind the FAB on a narrow till.
    await tester.tap(find.text('Comanda'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    // An overflow is reported as a test exception; separately, nothing else blew
    // up while the cart laid out.
    expect(tester.takeException(), isNull);
    expect(find.text('Latte 0'), findsOneWidget);
    // And the actions are pinned below the panel's scroll, inside the space the
    // keyboard leaves — the point of the scroll is that they are not pushed off
    // with a debug stripe, and the point of pinning them is that they are there
    // without hunting for them.
    final fire = find.byTooltip('Enviar a cocina');
    expect(fire, findsOneWidget);
    expect(
      tester.getRect(fire).bottom,
      lessThanOrEqualTo(600 - 300),
      reason: 'the pinned actions must sit above the keyboard inset',
    );
    expect(tester.takeException(), isNull);

    final close = find.byTooltip('Cerrar comanda');
    expect(close, findsOneWidget);
    expect(tester.getRect(close).width, greaterThanOrEqualTo(48));
    expect(tester.getRect(close).height, greaterThanOrEqualTo(48));
    await tester.tap(close);
    await tester.pumpAndSettle();
    expect(find.text('Latte 0'), findsNothing);
    expect(cart.state.cart?.items.length, 6);

    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    cart.dispose();
    entry.dispose();
    root.dispose();
  });

  testWidgets(
    'a failed account open explains the conflict and can recover the account',
    (tester) async {
      tester.view.physicalSize = const Size(1340, 800);
      tester.view.devicePixelRatio = 213 / 160;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final fixture = await _fixture(
        accountName: 'Cuenta 096',
        tableName: 'Mesa 10',
        accountInitiallyMissing: true,
        waiterMode: true,
      );
      fixture.cart.clearLocal();
      fixture.repository.createFailure = const AppException(
        category: AppErrorCategory.conflict,
        code: 'CART_ACTOR_BUSY',
        recoverable: true,
      );
      await fixture.sales.open(
        'merchant',
        'location',
        'operator',
        useCartAuthority: true,
      );
      await fixture.sales.newSale();
      await tester.pumpWidget(_scaledApp(fixture.surface, 'es', 1));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Ya tienes otra cuenta abierta'),
        findsWidgets,
      );
      expect(
        find.text('La comanda no está disponible temporalmente.'),
        findsNothing,
      );
      fixture.repository.createFailure = null;
      final attempts = fixture.repository.creates;
      await tester.tap(find.text('Reintentar'));
      await tester.pumpAndSettle();
      expect(fixture.cart.state.cart?.id, fixture.repository.cart.id);
      expect(fixture.cart.state.cart?.items, fixture.repository.cart.items);
      expect(fixture.repository.creates, attempts + 1);
      expect(
        find.textContaining('Ya tienes otra cuenta abierta'),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
      fixture.dispose();
    },
  );

  testWidgets('the bar about a closed account clears once the till is working again', (
    tester,
  ) async {
    // Measured on the iMin D3-504, 2026-10-13: the till released a suspended account
    // and opened a fresh one, and the sentence about the closed account stayed over an
    // empty, healthy comanda. The bar is meant to stay "until the operator does
    // something else" — the widget's own contract — and opening an account and taking
    // a write IS that something else.
    final fixture = await _fixture();
    await tester.pumpWidget(_scaledApp(fixture.surface, 'es', 1));
    await tester.pump();

    fixture.repository.addFailure = const AppException(
      category: AppErrorCategory.conflict,
      code: 'CART_VALIDATION_FAILED',
      recoverable: true,
    );
    fixture.repository.cart = Cart.fromJson({
      ..._cartWithLines(6).toJson(),
      'lifecycleState': 'suspended',
    });
    await fixture.cart.add(productId: '00000000-0000-4000-8000-0000000000d2');
    await tester.pump();
    await tester.pump();
    expect(
      find.textContaining('Esta cuenta ya se guardó'),
      findsOneWidget,
      reason: 'the refusal has to be said, in words that name the real cause',
    );
    expect(fixture.cart.state.cart, isNull);

    // The operator opens a fresh account: the cart is ready and carries no error.
    fixture.repository.addFailure = null;
    fixture.repository.cart = _cartWithLines(6);
    fixture.cart.restore(fixture.repository.cart);
    await tester.pump();
    await tester.pump();
    expect(
      find.textContaining('Esta cuenta ya se guardó'),
      findsNothing,
      reason:
          'a bar that outlives its refusal reads as a till that is still broken',
    );
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    fixture.dispose();
  });

  testWidgets('Nueva cuenta stands down on an empty account and writes nothing', (
    tester,
  ) async {
    // Measured in `merchant.pos_cart` on 2026-10-13: accounts 71 to 77 were empty
    // drafts, and eight of them were opened inside 25 seconds (04:00:16 to
    // 04:00:41) — one record and one account number per tap of `Nueva cuenta` on a
    // cart that held nothing. The owner read the same thing on screen: "solo se
    // acumulan si spamean el botón".
    tester.view.physicalSize = const Size(1920, 1014);
    tester.view.devicePixelRatio = 1.375;
    addTearDown(tester.view.reset);
    await fonts();
    final fixture = await _fixture(
      openAccounts: true,
      lines: 0,
      accountFolio: 'Cuenta 077',
    );
    await tester.pumpWidget(_scaledApp(fixture.surface, 'es', 1));
    await tester.pump();

    final account = fixture.cart.state.cart!;
    expect(account.items, isEmpty);
    final action = find.byTooltip(
      'Ya estás en una cuenta vacía (Cuenta 077). Agrega un producto para usarla.',
    );
    expect(
      action,
      findsOneWidget,
      reason: 'a control that cannot be honoured says why, it does not lie',
    );
    expect(
      tester
          .widget<PosIconButton>(
            find.ancestor(of: action, matching: find.byType(PosIconButton)),
          )
          .onPressed,
      isNull,
      reason: 'the control stands down; it does not answer a tap with nothing',
    );
    expect(
      tester
          .widget<Text>(
            find.descendant(of: action, matching: find.byType(Text)),
          )
          .style
          ?.color,
      PosTheme.of(tester.element(action)).colorScheme.onSurfaceVariant,
      reason: 'a control that stands down paints its word as off',
    );
    await tester.tap(action, warnIfMissed: false);
    await tester.pumpAndSettle();
    expect((fixture.repository as _AccountCartRepo).suspends, 0);
    expect(fixture.repository.creates, 0);
    expect(
      fixture.cart.state.cart?.id,
      account.id,
      reason: 'the tap keeps the account the operator already has',
    );
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    fixture.dispose();
  });

  test('an account is bare only when nothing identifies it', () {
    // The four facts the API asks before it lists an account as open
    // (`openAccountIds`, apps/umi-api/src/modules/pos-cart/pos-cart.repository.ts) and
    // the four the till asks before it decides that putting it aside would write a
    // record nobody can charge.
    expect(accountIsBare(_cartWithLines(0)), isTrue);
    expect(accountIsBare(_cartWithLines(1)), isFalse);
    expect(
      accountIsBare(
        Cart.fromJson({
          ..._cartWithLines(0).toJson(),
          'tableId': '00000000-0000-4000-8000-0000000000a1',
          'tableName': 'Mesa 3',
        }),
      ),
      isFalse,
      reason: 'a table is who the account is for',
    );
    expect(
      accountIsBare(
        Cart.fromJson({..._cartWithLines(0).toJson(), 'accountName': 'Ana'}),
      ),
      isFalse,
      reason: 'a name is who the account is for',
    );
    expect(
      accountIsBare(
        Cart.fromJson({
          ..._cartWithLines(0).toJson(),
          'firedOrderId': '00000000-0000-4000-8000-0000000000f1',
        }),
      ),
      isFalse,
      reason: 'a fired order is work the kitchen already started',
    );
  });
}
