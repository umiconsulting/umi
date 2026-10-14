import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';

final class _CartRepository implements CartRepository {
  Cart cart = _cart();
  CartLineInput? lastAdded;
  FireOrderRequest? lastFired;
  String? lastFulfillment;
  int fulfillmentWrites = 0;
  int fires = 0;
  Object? fireFailure;

  /// What `add` should do instead of taking the line: the API's refusal, which the
  /// controller has to ANSWER rather than absorb.
  Object? addFailure;

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
    final failure = addFailure;
    if (failure != null) throw failure;
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

  @override
  Future<FireOrderResult> fire(
    String merchantId,
    FireOrderRequest request,
  ) async {
    final failure = fireFailure;
    if (failure != null) throw failure;
    fires += 1;
    lastFired = request;
    final orderId = '00000000-0000-4000-8000-0000000000f1';
    cart = _withFired(cart, orderId);
    return FireOrderResult(
      cartId: request.cartId,
      cartVersion: cart.version,
      orderId: orderId,
      reference: 'A-101',
      lineCount: 1,
      firedAt: '2026-07-28T12:05:00.000Z',
    );
  }

  @override
  Future<Cart> setFulfillment(
    String merchantId,
    SetCartFulfillmentRequest input,
  ) async {
    lastFulfillment = input.fulfillmentType;
    fulfillmentWrites += 1;
    cart = _withFulfillment(cart, input.fulfillmentType);
    return cart;
  }
}

Cart _cart() => Cart(
  id: '00000000-0000-4000-8000-000000000001',
  merchantId: '00000000-0000-4000-8000-000000000002',
  locationId: '00000000-0000-4000-8000-000000000003',
  operatorSessionId: '00000000-0000-4000-8000-000000000004',
  status: 'draft',
  version: 1,
  firedOrderId: null,
  fulfillmentType: 'dine_in',
  items: [_item()],
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

Cart _withFired(Cart base, String orderId) => Cart(
  id: base.id,
  merchantId: base.merchantId,
  locationId: base.locationId,
  operatorSessionId: base.operatorSessionId,
  status: base.status,
  version: base.version + 1,
  firedOrderId: orderId,
  fulfillmentType: base.fulfillmentType,
  items: _fired(base.items),
  totals: base.totals,
  checkoutEnabled: base.checkoutEnabled,
  checkoutMessageCode: base.checkoutMessageCode,
  updatedAt: '2026-07-28T12:05:00.000Z',
);

/// One cart line, as the API returns it: a line the kitchen does not have yet.
Map<String, Object?> _item({
  String id = '00000000-0000-4000-8000-0000000000c1',
  bool fired = false,
}) => {
  'id': id,
  'productId': '00000000-0000-4000-8000-000000000005',
  'productName': 'Flan',
  'saleAction': 'merchandise',
  'quantity': 1,
  'courseNumber': 1,
  'variant': null,
  'modifiers': <Object?>[],
  'note': null,
  'fired': fired,
  'price': {
    'unitPrice': {'minorUnits': 4500, 'currency': 'MXN'},
    'lineSubtotal': {'minorUnits': 4500, 'currency': 'MXN'},
    'tax': {'minorUnits': 700, 'currency': 'MXN'},
    'lineTotal': {'minorUnits': 4500, 'currency': 'MXN'},
    'taxRateBasisPoints': 1600,
  },
};

/// The same lines, the way the server answers after a fire: every one of them is
/// on the ticket.
List<Map<String, Object?>> _fired(List<Map<String, Object?>> items) => [
  for (final item in items) {...item, 'fired': true},
];

/// A cart that fired once and then gained a line: the second round the kitchen
/// does not have yet (plan §8.2 F6).
Cart _cartWithSecondRound() {
  final base = _withFired(_cart(), '00000000-0000-4000-8000-0000000000f1');
  return Cart(
    id: base.id,
    merchantId: base.merchantId,
    locationId: base.locationId,
    operatorSessionId: base.operatorSessionId,
    status: base.status,
    version: base.version + 1,
    firedOrderId: base.firedOrderId,
    fulfillmentType: base.fulfillmentType,
    items: [
      ...base.items,
      _item(id: '00000000-0000-4000-8000-0000000000c2'),
    ],
    totals: base.totals,
    checkoutEnabled: base.checkoutEnabled,
    checkoutMessageCode: base.checkoutMessageCode,
    updatedAt: '2026-07-28T12:07:00.000Z',
  );
}

Cart _withFulfillment(Cart base, String type) => Cart(
  id: base.id,
  merchantId: base.merchantId,
  locationId: base.locationId,
  operatorSessionId: base.operatorSessionId,
  status: base.status,
  version: base.version + 1,
  firedOrderId: base.firedOrderId,
  fulfillmentType: type,
  items: base.items,
  totals: base.totals,
  checkoutEnabled: base.checkoutEnabled,
  checkoutMessageCode: base.checkoutMessageCode,
  updatedAt: '2026-07-28T12:06:00.000Z',
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
  fired: false,
  price: const {
    'lineTotal': {'minorUnits': 4500, 'currency': 'MXN'},
  },
);

void main() {
  test(
    'a refused add answers false and keeps the reason — the rail counts adds, not taps',
    () async {
      // Measured on the iMin D3-504, 2026-10-11: the API refused 28 adds for one
      // product whose availability date had passed, `add` returned normally, and the
      // device-local "most ordered" rail counted every one of them.
      final repository = _CartRepository();
      final controller = _controller(repository);
      await controller.open(
        repository.cart.merchantId,
        repository.cart.locationId,
        repository.cart.operatorSessionId,
      );

      repository.addFailure = const AppException(
        category: AppErrorCategory.conflict,
        code: 'CART_VALIDATION_FAILED',
        recoverable: true,
      );

      expect(
        await controller.add(productId: '00000000-0000-4000-8000-000000000005'),
        isFalse,
      );
      expect(repository.lastAdded, isNull);
      expect(controller.state.errorCode, 'CART_VALIDATION_FAILED');

      repository.addFailure = null;
      expect(
        await controller.add(productId: '00000000-0000-4000-8000-000000000005'),
        isTrue,
      );
      expect(repository.lastAdded, isNotNull);
      controller.dispose();
    },
  );

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

  // The fired order (ADR 2026-10-07-pos-fired-order). Firing writes the order
  // and its kitchen ticket with no payment, and the cart carries the fact after.

  test('fire sends the cart, re-reads it and marks it fired', () async {
    final repository = _CartRepository();
    final controller = _controller(repository);
    await controller.open(
      repository.cart.merchantId,
      repository.cart.locationId,
      repository.cart.operatorSessionId,
    );

    final result = await controller.fire();

    expect(result, isNotNull);
    expect(repository.lastFired?.cartId, repository.cart.id);
    expect(result!.reference, 'A-101');
    // The state is the server's re-read, not the client's memory of one call:
    // the cart now carries the order it created, which is the freeze the edits
    // and the marker both read.
    expect(controller.state.phase, CartPhase.ready);
    expect(controller.state.cart?.firedOrderId, isNotNull);
    // Firing an already-fired cart is a no-op, not a second order.
    expect(await controller.fire(), isNull);
  });

  test('the order type is a cart fact, set once', () async {
    final repository = _CartRepository();
    final controller = _controller(repository);
    await controller.open(
      repository.cart.merchantId,
      repository.cart.locationId,
      repository.cart.operatorSessionId,
    );

    await controller.setFulfillment('takeout');

    expect(repository.lastFulfillment, 'takeout');
    expect(controller.state.cart?.fulfillmentType, 'takeout');
    // The cart already carries the value, so the same choice is a no-op rather
    // than a version bump nobody asked for.
    await controller.setFulfillment('takeout');
    expect(repository.fulfillmentWrites, 1);
  });

  test('a cart that gained a line after the fire sends only that', () async {
    final repository = _CartRepository()..cart = _cartWithSecondRound();
    final controller = _controller(repository);
    await controller.open(
      repository.cart.merchantId,
      repository.cart.locationId,
      repository.cart.operatorSessionId,
    );

    final result = await controller.fire();

    // The first round is already on the ticket; this fire is the second one, and
    // the server appends it to the order the cart owns (plan §8.2 F6).
    expect(result, isNotNull);
    expect(repository.fires, 1);
    expect(repository.lastFired?.cartId, repository.cart.id);
  });

  test('a refused fire keeps the cart and reports the code', () async {
    final repository = _CartRepository()
      ..fireFailure = const AppException(
        category: AppErrorCategory.permission,
        code: 'PERMISSION_DENIED',
        recoverable: false,
      );
    final controller = _controller(repository);
    await controller.open(
      repository.cart.merchantId,
      repository.cart.locationId,
      repository.cart.operatorSessionId,
    );

    expect(await controller.fire(), isNull);
    expect(controller.state.errorCode, 'PERMISSION_DENIED');
    expect(controller.state.cart?.firedOrderId, isNull);
  });
}
