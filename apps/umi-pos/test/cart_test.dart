import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';

final class _CartRepository implements CartRepository {
  Cart cart = _cart();
  CartLineInput? lastAdded;
  int creates = 0;
  int reads = 0;

  @override
  Future<Cart> create(String tenantId, CreateCartRequest request) async {
    creates++;
    return cart;
  }

  @override
  Future<Cart> read(String tenantId, CartQuery query) async {
    reads++;
    return cart;
  }

  @override
  Future<Cart> add(String tenantId, CartLineInput input) async {
    lastAdded = input;
    return cart;
  }

  @override
  Future<Cart> update(
    String tenantId,
    String lineId,
    CartLineInput input,
  ) async => cart;
  @override
  Future<Cart> remove(
    String tenantId,
    String lineId,
    RemoveCartLineRequest input,
  ) async => cart;
  @override
  Future<Cart> prepare(String tenantId, PrepareSaleRequest input) async => cart;
  @override
  Future<Cart> clear(String tenantId, ClearCartRequest input) async => cart;
}

Cart _cart() => const Cart(
  id: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  branchId: '00000000-0000-4000-8000-000000000003',
  operatorSessionId: '00000000-0000-4000-8000-000000000004',
  status: 'draft',
  version: 1,
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

void main() {
  test('cart open creates or restores without an expected 404 read', () async {
    final repository = _CartRepository();
    final controller = CartController(
      repository: repository,
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

    await controller.open(
      repository.cart.tenantId,
      repository.cart.branchId,
      repository.cart.operatorSessionId,
    );

    expect(repository.creates, 1);
    expect(repository.reads, 0);
    expect(controller.state.cart, repository.cart);
  });

  test(
    'cart uses server snapshot and preserves partition across navigation',
    () async {
      final repository = _CartRepository();
      final controller = CartController(
        repository: repository,
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
      await controller.open(
        repository.cart.tenantId,
        repository.cart.branchId,
        repository.cart.operatorSessionId,
      );
      await controller.add(
        productId: '00000000-0000-4000-8000-000000000005',
        quantity: 2,
        note: '  sin azúcar  ',
      );
      expect(controller.state.cart?.totals, repository.cart.totals);
      expect(repository.lastAdded?.note, 'sin azúcar');
      expect(repository.lastAdded?.quantity, 2);
    },
  );

  test('cart cleanup drops all presentation state', () async {
    final repository = _CartRepository();
    final controller = CartController(
      repository: repository,
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
    await controller.open(
      repository.cart.tenantId,
      repository.cart.branchId,
      repository.cart.operatorSessionId,
    );
    controller.clearLocal();
    expect(controller.state.phase, CartPhase.idle);
    expect(controller.state.cart, isNull);
  });
}
