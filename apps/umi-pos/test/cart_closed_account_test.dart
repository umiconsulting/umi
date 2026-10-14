import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';

/// A refusal the server answers for two different reasons.
///
/// `CART_VALIDATION_FAILED` is what the API says when a product cannot be ordered at
/// this branch — which the operator fixes by looking at the screen — and also when the
/// account is no longer one the till may write to, because it was suspended or closed
/// somewhere else. Measured on the iMin D3-504, 2026-10-13: the account was suspended
/// from the sales screen while the comanda kept it, and add, remove, clear and save were
/// all answered `409` with the sentence about an unavailable product. The panel looked
/// frozen and the only way out was restarting the app.
///
/// These tests pin the two halves of the answer: let go of the account when the server's
/// own read says it is not the till's to write, and leave it alone when it still is.
final class _CartRepository implements CartRepository {
  Cart cart = _cart();
  Object? addFailure;
  Object? readFailure;
  int reads = 0;

  @override
  Future<Cart> create(String merchantId, CreateCartRequest request) async =>
      cart;

  @override
  Future<Cart> read(String merchantId, CartQuery query) async {
    reads += 1;
    final failure = readFailure;
    if (failure != null) throw failure;
    return cart;
  }

  @override
  Future<Cart> add(String merchantId, CartLineInput input) async {
    final failure = addFailure;
    if (failure != null) throw failure;
    return cart;
  }

  @override
  Future<Cart> update(
    String merchantId,
    String lineId,
    CartLineInput input,
  ) async => cart;

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
  ) async => throw UnimplementedError();

  @override
  Future<Cart> setFulfillment(
    String merchantId,
    SetCartFulfillmentRequest input,
  ) async => cart;
}

Cart _cart({String? lifecycleState = 'building_cart'}) => Cart(
  id: '00000000-0000-4000-8000-000000000001',
  merchantId: '00000000-0000-4000-8000-000000000002',
  locationId: '00000000-0000-4000-8000-000000000003',
  operatorSessionId: '00000000-0000-4000-8000-000000000004',
  status: 'draft',
  lifecycleState: lifecycleState,
  version: 1,
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
    'businessDate': '2026-10-13',
  },
  checkoutEnabled: false,
  checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
  updatedAt: '2026-10-13T12:00:00.000Z',
);

const _refused = AppException(
  category: AppErrorCategory.conflict,
  code: 'CART_VALIDATION_FAILED',
  recoverable: true,
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

Future<CartController> _open(_CartRepository repository) async {
  final controller = _controller(repository);
  await controller.open(
    repository.cart.merchantId,
    repository.cart.locationId,
    repository.cart.operatorSessionId,
  );
  return controller;
}

void main() {
  test(
    'an account suspended elsewhere is let go, and the till says why',
    () async {
      final repository = _CartRepository();
      final controller = await _open(repository);

      // The sales screen suspended the account; this panel is holding the copy it read
      // before that happened.
      repository.cart = _cart(lifecycleState: 'suspended');
      repository.addFailure = _refused;

      expect(
        await controller.add(productId: '00000000-0000-4000-8000-000000000005'),
        isFalse,
      );
      await pumpEventQueue();

      expect(controller.state.cart, isNull);
      expect(controller.state.phase, CartPhase.idle);
      expect(controller.state.errorCode, 'CART_ACCOUNT_CLOSED');
      controller.dispose();
    },
  );

  test('an account the till still owns keeps its place', () async {
    final repository = _CartRepository();
    final controller = await _open(repository);

    // The ordinary refusal: the product is not orderable right now. The cart did not
    // move, so the till must not drop it.
    repository.addFailure = _refused;

    expect(
      await controller.add(productId: '00000000-0000-4000-8000-000000000005'),
      isFalse,
    );
    await pumpEventQueue();

    expect(controller.state.cart, isNotNull);
    expect(controller.state.errorCode, 'CART_VALIDATION_FAILED');
    controller.dispose();
  });

  test('an account that is no longer there is let go too', () async {
    final repository = _CartRepository();
    final controller = await _open(repository);

    repository.addFailure = _refused;
    repository.readFailure = const AppException(
      category: AppErrorCategory.conflict,
      code: 'CART_NOT_FOUND',
      recoverable: false,
    );

    expect(
      await controller.add(productId: '00000000-0000-4000-8000-000000000005'),
      isFalse,
    );
    await pumpEventQueue();

    expect(controller.state.cart, isNull);
    expect(controller.state.errorCode, 'CART_ACCOUNT_CLOSED');
    controller.dispose();
  });
}
