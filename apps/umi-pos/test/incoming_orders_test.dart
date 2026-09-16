import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/cart/incoming_orders_controller.dart';

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
  int incomingCalls = 0;

  @override
  Future<PosIncomingOrders> incomingOrders(
    String merchantId,
    CartQuery query,
  ) async {
    incomingCalls++;
    return const PosIncomingOrders(orders: [_orderJson]);
  }

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
  test('load lists the incoming orders as typed rows', () async {
    final repo = _Repo();
    final controller = IncomingOrdersController(
      repository: repo,
      telemetry: _telemetry,
    );

    await controller.load('m', 'l', 'o');

    expect(repo.incomingCalls, 1);
    expect(controller.state.phase, IncomingOrdersPhase.ready);
    expect(controller.state.orders, hasLength(1));
    expect(controller.state.orders.first.channel, 'whatsapp');
    expect(
      controller.state.orders.first.orderId,
      '00000000-0000-4000-8000-0000000000a1',
    );
  });

  test('pickUp binds the active cart to the order and returns the bound cart', () async {
    final repo = _Repo();
    final controller = IncomingOrdersController(
      repository: repo,
      telemetry: _telemetry,
    );
    await controller.load('m', 'l', 'o');

    final cart = _cart();
    final bound = await controller.pickUp(cart, controller.state.orders.first);

    expect(bound, isNotNull);
    expect(repo.lastBind, isNotNull);
    expect(repo.lastBind!.cartId, cart.id);
    expect(repo.lastBind!.originOrderId, '00000000-0000-4000-8000-0000000000a1');
    expect(repo.lastBind!.expectedVersion, cart.version);
    expect(controller.state.phase, IncomingOrdersPhase.ready);
    expect(controller.state.binding, isFalse);
  });
}
