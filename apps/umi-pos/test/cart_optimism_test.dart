import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_optimism.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';

/// What a tap on a drink should feel like.
///
/// The till used to leave the state in `loading` and publish nothing until the API
/// answered — a 130–200 ms floor per tap from a café to Boston. These tests pin the
/// two halves of the replacement: the line is painted from a locally computed price,
/// and the server's answer, when it comes, is still the one that counts.

const _merchantId = '00000000-0000-4000-8000-000000000002';
const _locationId = '00000000-0000-4000-8000-000000000003';
const _operatorSessionId = '00000000-0000-4000-8000-000000000004';
const _currency = 'MXN';

Map<String, Object?> _money(int minorUnits) => {
  'minorUnits': minorUnits,
  'currency': _currency,
};

Map<String, Object?> _line({
  String id = '00000000-0000-4000-8000-0000000000c1',
  String productName = 'Americano',
  int quantity = 1,
  int unitMinorUnits = 4500,
  int taxRateBasisPoints = 1600,
}) {
  final lineTotal = unitMinorUnits * quantity;
  final tax = ((lineTotal * taxRateBasisPoints) / (10000 + taxRateBasisPoints))
      .round();
  return {
    'id': id,
    'productId': '00000000-0000-4000-8000-000000000005',
    'productName': productName,
    'saleAction': 'merchandise',
    'quantity': quantity,
    'courseNumber': 1,
    'variant': null,
    'modifiers': <Object?>[],
    'note': null,
    'fired': false,
    'price': {
      'unitPrice': _money(unitMinorUnits),
      'lineSubtotal': _money(lineTotal),
      'tax': _money(tax),
      'lineTotal': _money(lineTotal),
      'taxRateBasisPoints': taxRateBasisPoints,
    },
  };
}

Cart _cart({List<Map<String, Object?>>? items}) => Cart.fromJson({
  'id': '00000000-0000-4000-8000-000000000001',
  'merchantId': _merchantId,
  'locationId': _locationId,
  'operatorSessionId': _operatorSessionId,
  'status': 'draft',
  'version': 7,
  'firedOrderId': null,
  'fulfillmentType': 'dine_in',
  'items': items ?? [_line()],
  'totals': {
    'subtotal': _money(4500),
    'tax': _money(621),
    'discounts': {'total': _money(0), 'entries': <Object?>[]},
    'grandTotal': _money(4500),
    'businessDate': '2026-10-15',
  },
  'checkoutEnabled': false,
  'checkoutMessageCode': 'CHECKOUT_GATE_NOT_AVAILABLE',
  'updatedAt': '2026-10-15T12:00:00.000Z',
});

int _minorUnits(Map<String, Object?> money) =>
    (money['minorUnits'] as num).toInt();

TotalsPreview _totals(Cart cart) => TotalsPreview.fromJson(cart.totals);

void main() {
  group('the predicted line is priced the way the server prices it', () {
    test('gross line total, tax extracted from inside it', () {
      final predicted = optimisticAddLine(
        _cart(),
        lineId: '00000000-0000-4000-8000-0000000000c9',
        line: const ProvisionalLine(
          productId: '00000000-0000-4000-8000-000000000005',
          productName: 'Latte',
          saleAction: 'merchandise',
          unitMinorUnits: 5800,
          currency: _currency,
          taxRateBasisPoints: 1600,
        ),
        quantity: 2,
        courseNumber: 1,
      );

      final line = CartItem.fromJson(predicted.items.last);
      final price = PriceSnapshot.fromJson(line.price);
      // 5800 × 2 = 11600 gross; the tax is the 16% inside it, not on top of it.
      expect(_minorUnits(price.lineTotal), 11600);
      expect(_minorUnits(price.lineSubtotal), 11600);
      expect(_minorUnits(price.tax), (11600 * 1600 / 11600).round());
      expect(line.quantity, 2);
      expect(line.productName, 'Latte');
      // The kitchen does not have it yet, and the till must not claim otherwise.
      expect(line.fired, isFalse);
    });

    test(
      'the totals are the sum of the lines, gross, like the server sums them',
      () {
        final predicted = optimisticAddLine(
          _cart(),
          lineId: '00000000-0000-4000-8000-0000000000c9',
          line: const ProvisionalLine(
            productId: '00000000-0000-4000-8000-000000000005',
            productName: 'Latte',
            saleAction: 'merchandise',
            unitMinorUnits: 5800,
            currency: _currency,
            taxRateBasisPoints: 1600,
          ),
          quantity: 1,
          courseNumber: 1,
        );

        final totals = _totals(predicted);
        expect(_minorUnits(totals.subtotal), 4500 + 5800);
        expect(_minorUnits(totals.grandTotal), 4500 + 5800);
        expect(_minorUnits(totals.tax), 621 + 800);
        expect(totals.businessDate, '2026-10-15');
      },
    );

    test('a quantity change rescales the line it is addressed to', () {
      final predicted = optimisticSetQuantity(
        _cart(),
        '00000000-0000-4000-8000-0000000000c1',
        3,
      )!;

      final price = PriceSnapshot.fromJson(
        CartItem.fromJson(predicted.items.single).price,
      );
      expect(_minorUnits(price.unitPrice), 4500);
      expect(_minorUnits(price.lineTotal), 13500);
      expect(_minorUnits(_totals(predicted).grandTotal), 13500);
    });

    test('a quantity of zero is a removal, not a zero-quantity line', () {
      final predicted = optimisticSetQuantity(
        _cart(),
        '00000000-0000-4000-8000-0000000000c1',
        0,
      )!;

      expect(predicted.items, isEmpty);
      expect(_minorUnits(_totals(predicted).grandTotal), 0);
    });

    test('a line the cart does not hold predicts nothing', () {
      expect(
        optimisticSetQuantity(
          _cart(),
          '00000000-0000-4000-8000-0000000000ff',
          2,
        ),
        isNull,
      );
      expect(
        optimisticRemoveLine(_cart(), '00000000-0000-4000-8000-0000000000ff'),
        isNull,
      );
    });

    test('the account name is the till\'s own fact, and empty clears it', () {
      expect(optimisticRenameAccount(_cart(), 'Mesa 4').accountName, 'Mesa 4');
      expect(optimisticRenameAccount(_cart(), '   ').accountName, isNull);
      expect(optimisticRenameAccount(_cart(), null).accountName, isNull);
    });
  });

  group('the controller paints before it confirms', () {
    test(
      'a tap with a provisional price shows the line while the wire is out',
      () async {
        final repository = _GatedRepository();
        final controller = _controller(repository);
        await controller.open(_merchantId, _locationId, _operatorSessionId);

        final pending = controller.add(
          productId: '00000000-0000-4000-8000-000000000005',
          provisional: const ProvisionalLine(
            productId: '00000000-0000-4000-8000-000000000005',
            productName: 'Latte',
            saleAction: 'merchandise',
            unitMinorUnits: 5800,
            currency: _currency,
            taxRateBasisPoints: 1600,
          ),
        );
        // Nothing has answered yet, and the line is already on the screen.
        await Future<void>.delayed(Duration.zero);
        expect(controller.state.cart!.items, hasLength(2));
        expect(
          CartItem.fromJson(controller.state.cart!.items.last).productName,
          'Latte',
        );
        expect(controller.state.phase, CartPhase.ready);
        expect(controller.isWriting, isTrue);

        repository.settle();
        expect(await pending, isTrue);
        // The server's answer replaces the prediction, which is the whole point: the
        // prediction is provisional, the answer is the record.
        expect(controller.state.cart!.items, hasLength(1));
        expect(controller.isWriting, isFalse);
      },
    );

    test('a refusal takes the painted line back off the screen', () async {
      final repository = _GatedRepository();
      final controller = _controller(repository);
      await controller.open(_merchantId, _locationId, _operatorSessionId);

      final before = controller.state.cart!;
      repository.refuse = const AppException(
        category: AppErrorCategory.conflict,
        code: 'CART_LINE_NOT_ORDERABLE',
        recoverable: true,
      );
      final pending = controller.add(
        productId: '00000000-0000-4000-8000-000000000005',
        provisional: const ProvisionalLine(
          productId: '00000000-0000-4000-8000-000000000005',
          productName: 'Latte',
          saleAction: 'merchandise',
          unitMinorUnits: 5800,
          currency: _currency,
          taxRateBasisPoints: 1600,
        ),
      );
      // The line is painted first — otherwise there would be nothing to take back.
      await Future<void>.delayed(Duration.zero);
      expect(controller.state.cart!.items, hasLength(before.items.length + 1));

      repository.settle();
      expect(await pending, isFalse);
      expect(controller.state.cart!.items, hasLength(before.items.length));
      expect(controller.state.errorCode, 'CART_LINE_NOT_ORDERABLE');
    });

    test(
      'a line the till cannot price keeps the old waiting behaviour',
      () async {
        final repository = _GatedRepository();
        final controller = _controller(repository);
        await controller.open(_merchantId, _locationId, _operatorSessionId);

        final pending = controller.add(
          productId: '00000000-0000-4000-8000-000000000005',
        );
        await Future<void>.delayed(Duration.zero);
        // No price, no prediction: the cart says it is working, and nothing is
        // invented on the screen.
        expect(controller.state.phase, CartPhase.loading);
        expect(controller.state.cart!.items, hasLength(1));

        repository.settle();
        expect(await pending, isTrue);
        expect(controller.state.phase, CartPhase.ready);
      },
    );

    test('a second write is refused while the first is on the wire', () async {
      final repository = _GatedRepository();
      final controller = _controller(repository);
      await controller.open(_merchantId, _locationId, _operatorSessionId);

      final first = controller.add(
        productId: '00000000-0000-4000-8000-000000000005',
        provisional: const ProvisionalLine(
          productId: '00000000-0000-4000-8000-000000000005',
          productName: 'Latte',
          saleAction: 'merchandise',
          unitMinorUnits: 5800,
          currency: _currency,
          taxRateBasisPoints: 1600,
        ),
      );
      await Future<void>.delayed(Duration.zero);

      // One writer per account: the second tap does not race the first to the
      // server's version check.
      expect(
        await controller.add(productId: '00000000-0000-4000-8000-000000000005'),
        isFalse,
      );
      repository.settle();
      expect(await first, isTrue);
    });

    test(
      'repeat adds the same configured line from its confirmed price',
      () async {
        final repository = _GatedRepository();
        final controller = _controller(repository);
        await controller.open(_merchantId, _locationId, _operatorSessionId);
        final item = CartItem.fromJson({
          ..._line(quantity: 2),
          'variant': {
            'variantId': '00000000-0000-4000-8000-000000000006',
            'name': 'Grande',
          },
          'modifiers': [
            {
              'modifierId': '00000000-0000-4000-8000-000000000007',
              'name': 'Avena',
              'quantity': 2,
            },
          ],
          'note': 'Sin hielo',
          'courseNumber': 2,
        });

        final pending = controller.repeat(item);
        await Future<void>.delayed(Duration.zero);

        expect(repository.lastAdd?.productId, item.productId);
        expect(
          repository.lastAdd?.variantId,
          '00000000-0000-4000-8000-000000000006',
        );
        expect(repository.lastAdd?.modifierSelections, item.modifiers);
        expect(repository.lastAdd?.quantity, 2);
        expect(repository.lastAdd?.note, 'Sin hielo');
        expect(repository.lastAdd?.courseNumber, 2);
        final painted = CartItem.fromJson(controller.state.cart!.items.last);
        expect(painted.productName, 'Americano');
        expect(
          _minorUnits(PriceSnapshot.fromJson(painted.price).unitPrice),
          4500,
        );

        repository.settle();
        expect(await pending, isTrue);
      },
    );
  });
}

/// A repository whose `add` answers only when the test says so, which is what makes
/// the gap between "painted" and "confirmed" observable.
final class _GatedRepository implements CartRepository {
  final Cart cart = _cart();
  Completer<void>? _gate;
  Object? refuse;
  CartLineInput? lastAdd;

  void settle() {
    _gate?.complete();
    _gate = null;
  }

  @override
  Future<Cart> create(String merchantId, CreateCartRequest request) async =>
      cart;

  @override
  Future<Cart> add(String merchantId, CartLineInput input) async {
    lastAdd = input;
    _gate = Completer<void>();
    await _gate!.future;
    final failure = refuse;
    if (failure != null) {
      refuse = null;
      throw failure;
    }
    return cart;
  }

  @override
  Future<Cart> read(String merchantId, CartQuery query) async => cart;
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
  ) => throw UnimplementedError();
  @override
  Future<Cart> bindOrigin(String merchantId, BindCartOriginRequest input) =>
      throw UnimplementedError();
  @override
  Future<FireOrderResult> fire(String merchantId, FireOrderRequest request) =>
      throw UnimplementedError();
  @override
  Future<Cart> setFulfillment(
    String merchantId,
    SetCartFulfillmentRequest input,
  ) async => cart;
}

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
