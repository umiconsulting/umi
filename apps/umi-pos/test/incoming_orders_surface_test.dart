import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/cart/incoming_orders_controller.dart';
import 'package:umi_pos/features/cart/incoming_orders_surface.dart';

const Map<String, Object?> _orderJson = {
  'orderId': '00000000-0000-4000-8000-0000000000a1',
  'channel': 'whatsapp',
  'status': 'placed',
  'reference': 'wa-1',
  'customerName': 'Ana',
  'itemCount': 2,
  'totalMinorUnits': 12000,
  'placedAt': null,
};

Cart _cart() => const Cart(
  id: '00000000-0000-4000-8000-000000000001',
  merchantId: '00000000-0000-4000-8000-000000000002',
  locationId: '00000000-0000-4000-8000-000000000003',
  operatorSessionId: '00000000-0000-4000-8000-000000000004',
  status: 'draft',
  version: 3,
  items: [],
  totals: {
    'subtotal': {'minorUnits': 0, 'currency': 'MXN'},
    'tax': {'minorUnits': 0, 'currency': 'MXN'},
    'discounts': {
      'total': {'minorUnits': 0, 'currency': 'MXN'},
      'entries': <Object?>[],
    },
    'grandTotal': {'minorUnits': 0, 'currency': 'MXN'},
    'businessDate': '2026-07-28',
  },
  checkoutEnabled: false,
  checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
  updatedAt: '2026-07-28T12:00:00.000Z',
);

final class _Repo implements CartRepository {
  BindCartOriginRequest? lastBind;

  @override
  Future<PosIncomingOrders> incomingOrders(
    String merchantId,
    CartQuery query,
  ) async => const PosIncomingOrders(orders: [_orderJson]);

  @override
  Future<Cart> bindOrigin(String merchantId, BindCartOriginRequest input) async {
    lastBind = input;
    return _cart();
  }

  @override
  Future<Cart> create(String merchantId, CreateCartRequest request) async =>
      throw UnimplementedError();
  @override
  Future<Cart> read(String merchantId, CartQuery query) async =>
      throw UnimplementedError();
  @override
  Future<Cart> add(String merchantId, CartLineInput input) async =>
      throw UnimplementedError();
  @override
  Future<Cart> update(String merchantId, String lineId, CartLineInput input) async =>
      throw UnimplementedError();
  @override
  Future<Cart> remove(
    String merchantId,
    String lineId,
    RemoveCartLineRequest input,
  ) async => throw UnimplementedError();
  @override
  Future<Cart> prepare(String merchantId, PrepareSaleRequest input) async =>
      throw UnimplementedError();
  @override
  Future<Cart> clear(String merchantId, ClearCartRequest input) async =>
      throw UnimplementedError();
}

const _telemetry = SafeTelemetry(
  enabled: false,
  context: TelemetryContext(
    environment: 'test',
    appVersion: 'test',
    platform: 'test',
  ),
  exporter: NoopTelemetryExporter(),
);

void main() {
  testWidgets('lists an incoming order and picks it up into the cart', (
    tester,
  ) async {
    final repo = _Repo();
    final incoming = IncomingOrdersController(
      repository: repo,
      telemetry: _telemetry,
    );
    final cart = CartController(repository: repo, telemetry: _telemetry)
      ..restore(_cart());

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
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => showIncomingOrders(
                context,
                incoming: incoming,
                cart: cart,
                merchantId: 'm',
                locationId: 'l',
                operatorSessionId: 'o',
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    expect(find.text('Ana'), findsOneWidget);
    expect(find.text('Atender'), findsOneWidget);

    await tester.tap(find.text('Atender'));
    await tester.pumpAndSettle();

    // The cart was bound to the picked order, and the sheet closed.
    expect(repo.lastBind, isNotNull);
    expect(repo.lastBind!.cartId, '00000000-0000-4000-8000-000000000001');
    expect(repo.lastBind!.originOrderId, '00000000-0000-4000-8000-0000000000a1');
    expect(find.text('Atender'), findsNothing);
  });
}
