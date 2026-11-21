import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/features/cart/cart_command_queue.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_optimism.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/offline/connectivity_controller.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';

const _merchantId = '00000000-0000-4000-8000-000000000002';
const _locationId = '00000000-0000-4000-8000-000000000003';
const _operatorSessionId = '00000000-0000-4000-8000-000000000004';
const _deviceId = '00000000-0000-4000-8000-000000000005';
const _cartId = '00000000-0000-4000-8000-000000000010';
const _chaiProductId = '00000000-0000-4000-8000-0000000000aa';

Map<String, Object?> _money(int value) => {
  'minorUnits': value,
  'currency': 'MXN',
};

Map<String, Object?> _lineJson({
  required String id,
  required String productId,
  required int quantity,
  String? variantId,
  List<Map<String, Object?>> modifiers = const [],
  String? note,
}) => {
  'id': id,
  'productId': productId,
  'productName': 'Chai',
  'saleAction': 'merchandise',
  'quantity': quantity,
  'courseNumber': 1,
  'variant': variantId == null
      ? null
      : {'id': variantId, 'name': variantId, 'price': _money(6500)},
  'modifiers': modifiers,
  'note': note,
  'fired': false,
  'price': {
    'unitPrice': _money(6500),
    'lineSubtotal': _money(6500 * quantity),
    'tax': _money(897 * quantity),
    'lineTotal': _money(6500 * quantity),
    'taxRateBasisPoints': 1600,
  },
};

Cart _cart(int version, List<Map<String, Object?>> items) => Cart(
  id: _cartId,
  merchantId: _merchantId,
  locationId: _locationId,
  operatorSessionId: _operatorSessionId,
  status: 'draft',
  version: version,
  firedOrderId: null,
  fulfillmentType: 'dine_in',
  items: items,
  totals: const {
    'subtotal': {'minorUnits': 0, 'currency': 'MXN'},
    'tax': {'minorUnits': 0, 'currency': 'MXN'},
    'discounts': {
      'total': {'minorUnits': 0, 'currency': 'MXN'},
      'entries': <Map<String, Object?>>[],
    },
    'grandTotal': {'minorUnits': 0, 'currency': 'MXN'},
    'businessDate': '2026-11-20',
  },
  checkoutEnabled: false,
  checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
  updatedAt: '2026-11-20T12:00:00Z',
);

final class _MemJournalStore implements JournalCipherStore {
  String? _key;
  String? _ciphertext;

  @override
  Future<String?> readKey() async => _key;

  @override
  Future<void> writeKey(String value) async => _key = value;

  @override
  Future<String?> readCiphertext() async => _ciphertext;

  @override
  Future<void> writeCiphertext(String value) async => _ciphertext = value;
}

final class _FakeAliasCartRepository implements CartRepository {
  Cart current = _cart(1, const []);
  int _nextLineNumber = 1;
  final List<Completer<Cart>> pendingAdds = [];
  final List<String> updatedLineIds = [];

  @override
  Future<Cart> read(String merchantId, CartQuery query) async => current;

  @override
  Future<Cart> create(String merchantId, CreateCartRequest request) async =>
      current;

  @override
  Future<Cart> add(String merchantId, CartLineInput input) async {
    final completer = Completer<Cart>();
    pendingAdds.add(completer);
    return completer.future.then((cart) {
      current = cart;
      return cart;
    });
  }

  void completeNextAdd({
    required String productId,
    required List<Map<String, Object?>> modifiers,
    required String? note,
  }) {
    final serverLineId = 'server-line-${_nextLineNumber++}';
    final next = _cart(current.version + 1, [
      ...current.items,
      _lineJson(
        id: serverLineId,
        productId: productId,
        quantity: 1,
        modifiers: modifiers,
        note: note,
      ),
    ]);
    pendingAdds.removeAt(0).complete(next);
  }

  @override
  Future<Cart> update(
    String merchantId,
    String lineId,
    CartLineInput input,
  ) async {
    updatedLineIds.add(lineId);
    current = _cart(current.version + 1, [
      for (final raw in current.items)
        if (raw['id'] == lineId) {...raw, 'quantity': input.quantity} else raw,
    ]);
    return current;
  }

  @override
  Future<Cart> remove(
    String merchantId,
    String lineId,
    RemoveCartLineRequest input,
  ) async => current;

  @override
  Future<Cart> prepare(String merchantId, PrepareSaleRequest input) async =>
      current;

  @override
  Future<Cart> clear(String merchantId, ClearCartRequest input) async =>
      current;

  @override
  Future<Cart> bindOrigin(
    String merchantId,
    BindCartOriginRequest input,
  ) async => current;

  @override
  Future<FireOrderResult> fire(String merchantId, FireOrderRequest input) =>
      throw UnimplementedError();

  @override
  Future<PosIncomingOrders> incomingOrders(
    String merchantId,
    CartQuery query,
  ) => throw UnimplementedError();

  @override
  Future<Cart> setFulfillment(
    String merchantId,
    SetCartFulfillmentRequest input,
  ) async => current;
}

void main() {
  test(
    'two same-product lines with different modifiers/notes never alias on update',
    () async {
      final repo = _FakeAliasCartRepository();
      final connectivity = ConnectivityController();
      addTearDown(connectivity.dispose);
      final controller = CartController(
        repository: repo,
        telemetry: const SafeTelemetry(
          enabled: false,
          context: TelemetryContext(
            environment: 'test',
            appVersion: 'test',
            platform: 'test',
          ),
          exporter: NoopTelemetryExporter(),
        ),
        offlineJournal: EncryptedOfflineJournal(_MemJournalStore(), web: false),
        deviceIdentity: () =>
            const CartDeviceIdentity(deviceId: _deviceId, credentialVersion: 1),
        connectivity: connectivity,
      );
      addTearDown(controller.dispose);

      await controller.open(_merchantId, _locationId, _operatorSessionId);

      const chaiProvisional = ProvisionalLine(
        productId: _chaiProductId,
        productName: 'Chai',
        saleAction: 'merchandise',
        unitMinorUnits: 6500,
        currency: 'MXN',
        taxRateBasisPoints: 1600,
      );

      // Enqueue two distinct same-product lines while the server adds are still in flight.
      expect(
        await controller.add(
          productId: _chaiProductId,
          quantity: 1,
          modifiers: const [
            {'modifierId': 'milk-oat', 'quantity': 1, 'name': 'Oat'},
          ],
          note: 'extra hot',
          provisional: chaiProvisional,
        ),
        isTrue,
      );
      expect(
        await controller.add(
          productId: _chaiProductId,
          quantity: 1,
          modifiers: const [
            {'modifierId': 'milk-almond', 'quantity': 1, 'name': 'Almond'},
          ],
          note: 'iced',
          provisional: chaiProvisional,
        ),
        isTrue,
      );

      final provisionalItems = controller.state.cart!.items;
      expect(provisionalItems, hasLength(2));
      final secondProvisionalLine = CartItem.fromJson(provisionalItems[1]);

      // Increment the SECOND provisional line (Almond Milk, iced) before server replies.
      await controller.quantity(secondProvisionalLine, 2);

      // Complete both adds on the server in order.
      repo.completeNextAdd(
        productId: _chaiProductId,
        modifiers: const [
          {'modifierId': 'milk-oat', 'quantity': 1, 'name': 'Oat'},
        ],
        note: 'extra hot',
      );
      await Future<void>.delayed(const Duration(milliseconds: 20));
      repo.completeNextAdd(
        productId: _chaiProductId,
        modifiers: const [
          {'modifierId': 'milk-almond', 'quantity': 1, 'name': 'Almond'},
        ],
        note: 'iced',
      );
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(repo.updatedLineIds, ['server-line-2']);
      final line1 = controller.state.cart!.items.firstWhere(
        (item) => item['id'] == 'server-line-1',
      );
      final line2 = controller.state.cart!.items.firstWhere(
        (item) => item['id'] == 'server-line-2',
      );
      expect(line1['quantity'], 1);
      expect(line2['quantity'], 2);
    },
  );
}
