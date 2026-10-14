import 'dart:async';

import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
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
  firedOrderId: null,
  fulfillmentType: 'dine_in',
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
  bool failNextLoad = false;
  Completer<PosIncomingOrders>? pending;

  @override
  Future<PosIncomingOrders> incomingOrders(
    String merchantId,
    CartQuery query,
  ) async {
    if (failNextLoad) {
      failNextLoad = false;
      throw const AppException(
        category: AppErrorCategory.transport,
        code: "NETWORK_UNAVAILABLE",
        recoverable: true,
      );
    }
    if (pending != null) return pending!.future;
    return const PosIncomingOrders(orders: [_orderJson]);
  }

  @override
  Future<Cart> bindOrigin(
    String merchantId,
    BindCartOriginRequest input,
  ) async {
    lastBind = input;
    return _cart();
  }

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
  Future<Cart> update(
    String merchantId,
    String lineId,
    CartLineInput input,
  ) async => throw UnimplementedError();
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
      PosApp(
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,

          GlobalWidgetsLocalizations.delegate,
        ],
        home: PosPage(
          body: Builder(
            builder: (context) => PosButton(
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
    expect(
      repo.lastBind!.originOrderId,
      '00000000-0000-4000-8000-0000000000a1',
    );
    expect(find.text('Atender'), findsNothing);
  });
  for (final scale in [1.0, 2.0]) {
    testWidgets(
      'incoming refusal recovers without replacing the cart at phone scale $scale',
      (tester) async {
        tester.view.physicalSize = const Size(375, 812);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final repo = _Repo()..failNextLoad = true;
        final incoming = IncomingOrdersController(
          repository: repo,
          telemetry: _telemetry,
        );
        final original = _cart();
        final cart = CartController(repository: repo, telemetry: _telemetry)
          ..restore(original);
        addTearDown(incoming.dispose);
        addTearDown(cart.dispose);
        await tester.pumpWidget(
          PosApp(
            locale: const Locale('es'),
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
            ],
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(scale)),
              child: child!,
            ),
            home: PosPage(
              body: Builder(
                builder: (context) => PosButton(
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
        expect(find.text('No se pudieron cargar los pedidos.'), findsOneWidget);
        await tester.ensureVisible(find.text('Reintentar'));
        await tester.tap(find.text('Reintentar'));
        await tester.pumpAndSettle();
        expect(find.text('Ana'), findsOneWidget);
        expect(cart.state.cart, same(original));
        expect(repo.lastBind, isNull);
        await tester.ensureVisible(find.text('Atender'));
        final rect = tester.getRect(find.text('Atender'));
        expect(rect.right, lessThanOrEqualTo(375));
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'loading identifies the pending query instead of presenting an empty result',
    (tester) async {
      final repo = _Repo()..pending = Completer<PosIncomingOrders>();
      final incoming = IncomingOrdersController(
        repository: repo,
        telemetry: _telemetry,
      );
      final cart = CartController(repository: repo, telemetry: _telemetry)
        ..restore(_cart());
      await tester.pumpWidget(
        PosApp(
          locale: const Locale('es'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
          ],
          home: PosPage(
            body: Builder(
              builder: (context) => PosButton(
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
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Consultando pedidos entrantes…'), findsOneWidget);
      expect(find.text('No hay pedidos entrantes.'), findsNothing);
      repo.pending!.complete(const PosIncomingOrders(orders: []));
      await tester.pumpAndSettle();
      expect(find.text('No hay pedidos entrantes.'), findsOneWidget);
      expect(find.text('Consultando pedidos entrantes…'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      incoming.dispose();
      cart.dispose();
    },
  );
}
