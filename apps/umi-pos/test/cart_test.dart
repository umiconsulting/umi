import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';

final class _CartRepository implements CartRepository {
  Cart cart = _cart();
  CartLineInput? lastAdded;

  /// The line an update was addressed to, and what it carried. Both are read by
  /// the course tests: a course change has to reach the SAME line, or the dish is
  /// written twice instead of moved.
  String? lastUpdatedLineId;
  CartLineInput? lastUpdated;
  int creates = 0;
  int reads = 0;

  @override
  Future<Cart> create(String merchantId, CreateCartRequest request) async {
    creates++;
    return cart;
  }

  @override
  Future<Cart> read(String merchantId, CartQuery query) async {
    reads++;
    return cart;
  }

  @override
  Future<Cart> add(String merchantId, CartLineInput input) async {
    lastAdded = input;
    return cart;
  }

  @override
  Future<Cart> update(
    String merchantId,
    String lineId,
    CartLineInput input,
  ) async {
    lastUpdatedLineId = lineId;
    lastUpdated = input;
    return cart;
  }

  @override
  Future<Cart> remove(
    String merchantId,
    String lineId,
    RemoveCartLineRequest input,
  ) async => cart;
  @override
  Future<Cart> prepare(String merchantId, PrepareSaleRequest input) async =>
      cart;
  @override
  Future<Cart> clear(String merchantId, ClearCartRequest input) async => cart;

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
}

Cart _cart() => const Cart(
  id: '00000000-0000-4000-8000-000000000001',
  merchantId: '00000000-0000-4000-8000-000000000002',
  locationId: '00000000-0000-4000-8000-000000000003',
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

CartController _controller(CartRepository repository) => CartController(
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

/// One line of the cart, as the API returns it: every line carries its course.
CartItem _line({required int courseNumber}) => CartItem(
  id: '00000000-0000-4000-8000-0000000000c1',
  productId: '00000000-0000-4000-8000-000000000005',
  productName: 'Flan',
  saleAction: 'add',
  quantity: 1,
  courseNumber: courseNumber,
  variant: null,
  modifiers: const [],
  note: null,
  price: const {
    'lineTotal': {'minorUnits': 4500, 'currency': 'MXN'},
  },
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
      repository.cart.merchantId,
      repository.cart.locationId,
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
        repository.cart.merchantId,
        repository.cart.locationId,
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

  test('a course set while adding a line reaches the request', () async {
    final repository = _CartRepository();
    final controller = _controller(repository);
    await controller.open(
      repository.cart.merchantId,
      repository.cart.locationId,
      repository.cart.operatorSessionId,
    );

    await controller.add(
      productId: '00000000-0000-4000-8000-000000000005',
      courseNumber: 3,
    );

    // The course is the till's own intent, so it has to be on the line the API
    // is asked to write — not merely remembered on screen (§8H step 4).
    expect(repository.lastAdded?.courseNumber, 3);
  });

  test('an ordinary line defaults to the first course', () async {
    final repository = _CartRepository();
    final controller = _controller(repository);
    await controller.open(
      repository.cart.merchantId,
      repository.cart.locationId,
      repository.cart.operatorSessionId,
    );

    await controller.add(productId: '00000000-0000-4000-8000-000000000005');

    // A single-course sale must not have to say anything about courses, and it
    // still has to be explicit: the server's default is 1 and so is the till's.
    expect(repository.lastAdded?.courseNumber, 1);
  });

  test('moving an existing line to another course rewrites that line', () async {
    final repository = _CartRepository();
    final controller = _controller(repository);
    await controller.open(
      repository.cart.merchantId,
      repository.cart.locationId,
      repository.cart.operatorSessionId,
    );
    final line = _line(courseNumber: 1);

    await controller.edit(
      item: line,
      variantId: null,
      modifiers: const [],
      quantity: 1,
      note: null,
      courseNumber: 2,
    );

    // The SAME line id travels, which is what makes the server's
    // `ON CONFLICT (cart_id, identity_key)` rewrite the line: the course is
    // deliberately not part of the identity key, so a dish moved to course 2 is
    // one dish moved rather than a second dessert ordered.
    expect(repository.lastUpdatedLineId, line.id);
    expect(repository.lastUpdated?.productId, line.productId);
    expect(repository.lastUpdated?.courseNumber, 2);
    expect(repository.lastUpdated?.quantity, 1);
  });

  test('changing a quantity keeps the line on its course', () async {
    final repository = _CartRepository();
    final controller = _controller(repository);
    await controller.open(
      repository.cart.merchantId,
      repository.cart.locationId,
      repository.cart.operatorSessionId,
    );

    // A quantity tap rewrites the whole line, so a course left out of it would
    // silently drop a dessert back into the starters.
    await controller.quantity(_line(courseNumber: 3), 2);

    expect(repository.lastUpdated?.courseNumber, 3);
    expect(repository.lastUpdated?.quantity, 2);
  });

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
      repository.cart.merchantId,
      repository.cart.locationId,
      repository.cart.operatorSessionId,
    );
    controller.clearLocal();
    expect(controller.state.phase, CartPhase.idle);
    expect(controller.state.cart, isNull);
  });
}
