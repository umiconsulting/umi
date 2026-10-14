import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
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
import 'package:umi_pos/features/entry/entry_controller.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';

import '../support/fakes.dart';

/// Renders the ORDER screen — the catalog plus the cart — at any viewport, so a
/// human can read what the operator sees on a phone.
///
/// This file is deliberately **not** named `*_test.dart`: it writes PNGs, which
/// a CI suite must not do on its own. Run it by name:
///
///   RENDER_VIEWPORT=390x844 RENDER_THEME=dark \
///     flutter test test/render/order_surface_render.dart --update-goldens
///
/// The images land in `test/render/shots/`. `RENDER_VIEWPORT` takes `WxH` and
/// defaults to `390x844`, the logical size of an iPhone 15-class screen in
/// portrait. `RENDER_THEME` is `light` or `dark`. `RENDER_TEXT_SCALE` mirrors
/// the design language's 200 % requirement.
///
/// The screen is driven to a READY operator session through a fake
/// [EntryGateway], because the cart affordances on a narrow viewport are gated
/// on `cart.write`, and an empty permission set would photograph a screen that
/// no operator ever sees.
void main() {
  final themeName = Platform.environment['RENDER_THEME'] ?? 'dark';
  final textScale =
      double.tryParse(Platform.environment['RENDER_TEXT_SCALE'] ?? '') ?? 1.0;
  final viewport = _parseViewport(
    Platform.environment['RENDER_VIEWPORT'] ?? '390x844',
  );
  // An empty value means "no cart lines": the empty-cart state is a screen of
  // its own and it is worth a picture.
  final lines = int.tryParse(Platform.environment['RENDER_LINES'] ?? '') ?? 3;
  // `RENDER_CART=1` opens the cart sheet on top of the order screen, because on
  // a phone the cart is a sheet and not a panel, and the sheet is the screen the
  // operator reads most often.
  final openCart = Platform.environment['RENDER_CART'] == '1';
  final suffixName = Platform.environment['RENDER_SUFFIX'] ?? '';

  testWidgets('render order $viewport', (tester) async {
    final fontBytes = File(
      '/usr/share/fonts/noto/NotoSans-Regular.ttf',
    ).readAsBytesSync();
    await (FontLoader(
      'PreviewSans',
    )..addFont(Future.value(ByteData.view(fontBytes.buffer)))).load();

    final base = themeName == 'dark' ? UmiTheme.dark() : UmiTheme.light();
    final theme = base.copyWith(
      textTheme: base.textTheme.apply(fontFamily: 'PreviewSans'),
    );

    final root = testRoot();
    addTearDown(root.dispose);

    // A device that already holds a proven session: the cold start restores the
    // operator silently, which is the same path a till takes after a relaunch.
    await root.credentials.saveDevice(
      id: _deviceId,
      publicId: _publicId,
      credential: 'preview-credential',
      credentialVersion: 1,
      state: 'active',
      merchantId: _merchantId,
      locationId: _locationId,
    );
    await root.credentials.saveTokens('preview-access', 'preview-refresh');

    final entry = EntryController(
      gateway: _PreviewEntryGateway(),
      vault: root.credentials,
      telemetry: root.telemetry,
    );
    addTearDown(entry.dispose);
    await entry.initialize();
    if (entry.state.phase != EntryPhase.ready) {
      throw StateError('entry did not reach ready: ${entry.state.phase}');
    }

    final catalog = CatalogController(
      repository: _PreviewCatalogRepository(),
      cache: CatalogCache(),
      telemetry: root.telemetry,
    );
    addTearDown(catalog.dispose);
    await catalog.open(_partition);

    final cart = CartController(
      repository: _PreviewCartRepository(),
      telemetry: root.telemetry,
    );
    addTearDown(cart.dispose);
    cart.restore(_cart(lines));

    tester.view.physicalSize = viewport;
    tester.view.devicePixelRatio = 1.0;
    tester.platformDispatcher.textScaleFactorTestValue = textScale;
    addTearDown(tester.view.reset);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

    await tester.pumpWidget(
      RepaintBoundary(
        // `PosApp`, not a bare `MaterialApp`: the surfaces read their colours and
        // metrics from `PosTheme`, and a harness that hands the theme to Material
        // instead renders a screen no till can produce. Same shape as the sibling
        // `cash_centro_render.dart`.
        child: PosApp(
          theme: theme,
          locale: const Locale('es'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: CatalogSurface(
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
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    if (openCart) {
      await tester.tap(find.byType(FloatingActionButton));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
    }

    final suffix = textScale == 1.0
        ? ''
        : '-text${textScale.toStringAsFixed(0)}';
    final sheet = openCart ? '-cart' : '';
    final empty = lines == 0 ? '-empty' : '';
    Directory('test/render/shots').createSync(recursive: true);
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'shots/order$suffixName-$themeName-'
        '${viewport.width.toInt()}x${viewport.height.toInt()}'
        '$suffix$empty$sheet.png',
      ),
    );
  });
}

Size _parseViewport(String raw) {
  final parts = raw.split('x');
  if (parts.length != 2) {
    throw FormatException('RENDER_VIEWPORT must be WxH, got "$raw"');
  }
  return Size(double.parse(parts[0]), double.parse(parts[1]));
}

const _partition = CatalogPartition('tenant-a', 'branch-a', 'es');
const _merchantId = '00000000-0000-4000-8000-000000000002';
const _locationId = '00000000-0000-4000-8000-000000000003';
const _deviceId = '00000000-0000-4000-8000-000000000004';
const _publicId = '00000000-0000-4000-8000-000000000005';
const _sessionId = '00000000-0000-4000-8000-000000000006';
const _operatorId = '00000000-0000-4000-8000-000000000007';

/// The full permission set a barista till actually carries, so the narrow
/// layout publishes its cart button, its new-sale action and its tabs.
const _permissions = <String>[
  'cart.write',
  'checkout.commit',
  'sale.lifecycle',
  'cash.shift.read',
  'kitchen.read',
  'inventory.read',
  'sale.exception.read',
  'customer.search',
  'hardware.read',
];

Map<String, Object?> _money(int minorUnits) => {
  'minorUnits': minorUnits,
  'currency': 'MXN',
};

Cart _cart(int lines) {
  final items = <Map<String, Object?>>[
    _line('1', 'Capuchino', 2, 5800),
    _line('2', 'Croissant', 1, 4200),
    _line('3', 'Latte', 1, 6200),
    _line('4', 'Agua mineral', 1, 2500),
  ].take(lines).toList(growable: false);
  final subtotal = items.fold<int>(0, (sum, item) {
    final price = item['price']! as Map<String, Object?>;
    return sum +
        ((price['lineTotal']! as Map<String, Object?>)['minorUnits'] as int);
  });
  final tax = (subtotal * 0.16).round();
  return Cart(
    id: '00000000-0000-4000-8000-000000000001',
    merchantId: _merchantId,
    locationId: _locationId,
    operatorSessionId: _operatorId,
    status: 'draft',
    version: 4,
    // A counter sale that was never sent to the kitchen, which is what the
    // harness draws.
    firedOrderId: null,
    fulfillmentType: 'dine_in',
    items: items,
    totals: {
      'subtotal': _money(subtotal),
      'tax': _money(tax),
      'discounts': {'total': _money(0), 'entries': <Object?>[]},
      'grandTotal': _money(subtotal + tax),
      'businessDate': '2026-10-04',
    },
    checkoutEnabled: true,
    checkoutMessageCode: 'OK',
    updatedAt: '2026-10-04T12:00:00.000Z',
  );
}

Map<String, Object?> _line(
  String id,
  String name,
  int quantity,
  int unitPrice,
) => {
  'id': 'line-$id',
  'productId': 'product-$id',
  'productName': name,
  'saleAction': 'merchandise',
  'quantity': quantity,
  'courseNumber': 1,
  'variant': null,
  'modifiers': <Object?>[],
  'note': null,
  'price': {
    'unitPrice': _money(unitPrice),
    'lineSubtotal': _money(unitPrice * quantity),
    'tax': _money((unitPrice * quantity * 0.16).round()),
    'lineTotal': _money(unitPrice * quantity),
    'taxRateBasisPoints': 1600,
  },
};

/// Reaches the ready phase the same way the app does, so the rendered surface
/// carries the permissions a real operator session carries.
final class _PreviewEntryGateway implements EntryGateway {
  @override
  Future<DeviceSummary> deviceStatus() async => const DeviceSummary(
    id: _deviceId,
    publicId: _publicId,
    merchantId: _merchantId,
    locationId: _locationId,
    displayName: 'Caja 1',
    type: 'pos_terminal',
    platform: 'ios',
    mobility: 'mobile',
    state: 'active',
    credentialVersion: 1,
    lastSeenAt: null,
    rotationRequired: false,
    revokedAt: null,
    replacementDeviceId: null,
  );

  @override
  Future<PosSessionResponse> refresh() async => const PosSessionResponse(
    session: {
      'id': _sessionId,
      'user': {'displayName': 'Ana R.'},
    },
    tokens: {'accessToken': 'access', 'refreshToken': 'refresh'},
  );

  @override
  Future<EntryContextResponse> entryContext() async =>
      const EntryContextResponse(
        merchants: [
          {
            'id': _merchantId,
            'name': 'Café Centro',
            'roles': <Object?>['cashier'],
            'permissions': _permissions,
            'locations': [
              {
                'id': _locationId,
                'merchantId': _merchantId,
                'name': 'Caja 1',
                'status': 'active',
                'deviceAllowed': true,
                'operatorAllowed': true,
              },
            ],
            'entitlements': <Object?>[],
          },
        ],
      );

  @override
  Future<OperatorSessionView> startOperator(
    String merchantId,
    String locationId,
  ) async => const OperatorSessionView(
    id: _operatorId,
    userId: '00000000-0000-4000-8000-000000000008',
    staffId: '00000000-0000-4000-8000-000000000009',
    merchantId: _merchantId,
    locationId: _locationId,
    deviceId: _deviceId,
    state: 'active',
    permissions: _permissions,
    entitlements: <Map<String, Object?>>[],
    startedAt: '2026-10-04T11:00:00.000Z',
    lastActivityAt: '2026-10-04T12:00:00.000Z',
    expiresAt: '2026-10-04T20:00:00.000Z',
  );

  @override
  Stream<void> watchPairing(PairingIdentity pairing) => const Stream.empty();
  @override
  Future<DevicePairingSession> claimPairing(String code) =>
      throw UnimplementedError();
  @override
  Future<DevicePairingPollResponse> pollPairing(PairingIdentity pairing) =>
      throw UnimplementedError();
  @override
  Future<void> acknowledgePairing(
    PairingIdentity pairing,
    String deviceCredential,
  ) async {}
  @override
  Future<PosSessionResponse> login(String username, String password) =>
      throw UnimplementedError();
  @override
  Future<PosSessionResponse> pinLogin({
    required String pin,
    required String merchantId,
    required String locationId,
  }) => throw UnimplementedError();
  @override
  Future<void> logout() async {}
  @override
  Future<void> globalLogout() async {}
  @override
  Future<void> lockOperator(String id) async {}
  @override
  Future<void> endOperator(String id) async {}
  @override
  Future<ElevationGrantView> verifyPin({
    required String pin,
    required String permission,
    required String merchantId,
    required String locationId,
  }) => throw UnimplementedError();
  @override
  Future<ElevationGrantView> requestManagerApproval({
    required String operatorSessionId,
    required String managerPin,
    required String permission,
    required String merchantId,
    required String locationId,
    String? commandFingerprint,
  }) => throw UnimplementedError();
}

/// A short café menu. The names and the prices come from the design probe, so a
/// render here and a render there can be compared line by line.
final class _PreviewCatalogRepository implements CatalogRepository {
  static const _categories = <List<Object?>>[
    ['cafe', 'Café', 0],
    ['panaderia', 'Panadería', 1],
    ['bebidas', 'Bebidas', 2],
  ];
  static const _products = <List<Object?>>[
    ['Espresso', 'cafe', 3800, false],
    ['Americano', 'cafe', 4500, false],
    ['Capuchino', 'cafe', 5800, true],
    ['Latte', 'cafe', 6200, true],
    ['Té chai', 'cafe', 5500, true],
    ['Croissant', 'panaderia', 4200, false],
    ['Pan de chocolate', 'panaderia', 4800, false],
    ['Concha', 'panaderia', 2800, false],
    ['Agua mineral', 'bebidas', 2500, false],
    ['Jugo de naranja', 'bebidas', 4500, false],
  ];

  @override
  Future<CatalogCategoriesResponse> categories(
    CatalogPartition partition,
  ) async => CatalogCategoriesResponse(
    items: [
      for (final entry in _categories)
        {
          'id': entry[0],
          'name': entry[1],
          'displayOrder': entry[2],
          'enabled': true,
          'color': null,
        },
    ],
    catalogVersion: 'v1',
    updatedAt: '2026-10-04T00:00:00Z',
  );

  @override
  Future<CatalogPage> products(
    CatalogPartition partition, {
    String? categoryId,
    String? search,
    String? barcode,
    String? cursor,
    CancellationToken? cancellation,
  }) async {
    final query = search?.toLowerCase().trim();
    final items = <Map<String, Object?>>[
      for (final product in _products)
        if ((categoryId == null || product[1] == categoryId) &&
            (query == null ||
                query.isEmpty ||
                (product[0]! as String).toLowerCase().contains(query)))
          {
            'id': 'product-${product[0]}',
            'name': product[0],
            'description': null,
            'sku': 'SKU-${product[0]}',
            'hasBarcode': product[3],
            'category': {
              'id': product[1],
              'name': _categories.firstWhere(
                (entry) => entry[0] == product[1],
              )[1],
              'displayOrder': 0,
              'enabled': true,
              'color': null,
            },
            'price': _money(product[2]! as int),
            'taxRateBasisPoints': 1600,
            'saleAction': 'merchandise',
            'availability': 'enabled',
            'availableFrom': null,
            'primaryMedia': null,
            'hasVariants': false,
            'hasModifiers': false,
            'updatedAt': '2026-10-04T00:00:00Z',
          },
    ];
    return CatalogPage(
      items: items,
      nextCursor: null,
      catalogVersion: 'v1',
      updatedAt: '2026-10-04T00:00:00Z',
    );
  }

  @override
  Future<CatalogProductDetail> detail(
    CatalogPartition partition,
    String productId,
  ) => throw UnimplementedError();
}

/// The cart arrives through [CartController.restore], so every write path here
/// is deliberately unimplemented: a render must not mutate anything.
final class _PreviewCartRepository implements CartRepository {
  @override
  Future<Cart> create(String merchantId, CreateCartRequest request) =>
      throw UnimplementedError();
  @override
  Future<Cart> read(String merchantId, CartQuery query) =>
      throw UnimplementedError();
  @override
  Future<Cart> add(String merchantId, CartLineInput input) =>
      throw UnimplementedError();
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
  Future<FireOrderResult> fire(String merchantId, FireOrderRequest request) =>
      throw UnimplementedError();
  @override
  Future<Cart> setFulfillment(String merchantId, SetCartFulfillmentRequest input) =>
      throw UnimplementedError();
}
