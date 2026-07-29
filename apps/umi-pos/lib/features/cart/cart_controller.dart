import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/observability/telemetry.dart';
import 'cart_repository.dart';

enum CartPhase { idle, loading, ready, validationFailure, failure }

final class CartState {
  const CartState({this.phase = CartPhase.idle, this.cart, this.errorCode});
  final CartPhase phase;
  final Cart? cart;
  final String? errorCode;
}

final class CartController extends ChangeNotifier {
  CartController({
    required CartRepository repository,
    required Telemetry telemetry,
  }) : _repository = repository,
       _telemetry = telemetry;
  final CartRepository _repository;
  final Telemetry _telemetry;
  CartState _state = const CartState();
  CartState get state => _state;
  String? _tenantId;
  String? _branchId;
  String? _operatorSessionId;

  Future<void> open(
    String tenantId,
    String branchId,
    String operatorSessionId,
  ) async {
    final key = '$tenantId:$branchId:$operatorSessionId';
    if ('$_tenantId:$_branchId:$_operatorSessionId' == key &&
        _state.cart != null) {
      return;
    }
    clearLocal();
    _tenantId = tenantId;
    _branchId = branchId;
    _operatorSessionId = operatorSessionId;
    _set(const CartState(phase: CartPhase.loading));
    try {
      final cart = await _repository.create(
        tenantId,
        CreateCartRequest(
          branchId: branchId,
          operatorSessionId: operatorSessionId,
          idempotencyKey: _uuid(),
        ),
      );
      _set(CartState(phase: CartPhase.ready, cart: cart));
    } on AppException catch (error) {
      _failure(error);
    }
    _event('cart_opened');
  }

  void restore(Cart cart) {
    _tenantId = cart.tenantId;
    _branchId = cart.branchId;
    _operatorSessionId = cart.operatorSessionId;
    _set(CartState(phase: CartPhase.ready, cart: cart));
  }

  Future<void> add({
    required String productId,
    String? variantId,
    List<Map<String, Object?>> modifiers = const [],
    int quantity = 1,
    String? note,
  }) async {
    final cart = _state.cart;
    if (cart == null ||
        _tenantId == null ||
        _branchId == null ||
        _operatorSessionId == null) {
      return;
    }
    await _mutation(
      () => _repository.add(
        _tenantId!,
        CartLineInput(
          cartId: cart.id,
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
          productId: productId,
          variantId: variantId,
          modifierSelections: modifiers,
          quantity: quantity,
          note: (note?.trim().isEmpty ?? true) ? null : note!.trim(),
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
        ),
      ),
      'product_added',
    );
  }

  Future<void> quantity(CartItem item, int quantity) async {
    if (quantity <= 0) {
      return remove(item);
    }
    final cart = _state.cart;
    if (cart == null) return;
    await _mutation(
      () => _repository.update(
        _tenantId!,
        item.id,
        CartLineInput(
          cartId: cart.id,
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
          productId: item.productId,
          variantId: item.variant?['variantId'] as String?,
          modifierSelections: item.modifiers
              .map(
                (value) => {
                  'modifierId': value['modifierId']!,
                  'quantity': value['quantity']!,
                },
              )
              .toList(),
          quantity: quantity.clamp(1, 999).toInt(),
          note: item.note,
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
        ),
      ),
      'quantity_changed',
    );
  }

  Future<void> remove(CartItem item) async {
    final cart = _state.cart;
    if (cart == null) return;
    await _mutation(
      () => _repository.remove(
        _tenantId!,
        item.id,
        RemoveCartLineRequest(
          cartId: cart.id,
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
        ),
      ),
      'product_removed',
    );
  }

  Future<void> clear() async {
    final cart = _state.cart;
    if (cart == null || cart.items.isEmpty) return;
    await _mutation(
      () => _repository.clear(
        _tenantId!,
        ClearCartRequest(
          cartId: cart.id,
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
        ),
      ),
      'cart_cleared',
    );
  }

  Future<void> edit({
    required CartItem item,
    required String? variantId,
    required List<Map<String, Object?>> modifiers,
    required int quantity,
    required String? note,
  }) async {
    final cart = _state.cart;
    if (cart == null) return;
    await _mutation(
      () => _repository.update(
        _tenantId!,
        item.id,
        CartLineInput(
          cartId: cart.id,
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
          productId: item.productId,
          variantId: variantId,
          modifierSelections: modifiers,
          quantity: quantity.clamp(1, 999).toInt(),
          note: (note?.trim().isEmpty ?? true) ? null : note!.trim(),
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
        ),
      ),
      'cart_line_edited',
    );
  }

  Future<void> prepare() async {
    final cart = _state.cart;
    if (cart == null || cart.items.isEmpty) return;
    await _mutation(
      () => _repository.prepare(
        _tenantId!,
        PrepareSaleRequest(
          cartId: cart.id,
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
        ),
      ),
      'totals_loaded',
    );
  }

  void clearLocal() {
    if (_state.phase == CartPhase.idle &&
        _state.cart == null &&
        _tenantId == null &&
        _branchId == null &&
        _operatorSessionId == null) {
      return;
    }
    _tenantId = null;
    _branchId = null;
    _operatorSessionId = null;
    _state = const CartState();
    notifyListeners();
  }

  Future<void> _mutation(Future<Cart> Function() action, String event) async {
    _set(CartState(phase: CartPhase.loading, cart: _state.cart));
    try {
      final cart = await action();
      _set(CartState(phase: CartPhase.ready, cart: cart));
      _event(event);
    } on AppException catch (error) {
      _failure(error);
    }
  }

  void _failure(AppException error) {
    _event('validation_failed');
    _set(
      CartState(
        phase: error.code == 'CART_VALIDATION_FAILED'
            ? CartPhase.validationFailure
            : CartPhase.failure,
        cart: _state.cart,
        errorCode: error.code,
      ),
    );
  }

  void _event(String name) =>
      _telemetry.event(ClientEvent(name: name, values: const {}));
  void _set(CartState value) {
    _state = value;
    notifyListeners();
  }

  String _uuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
        '${hex.substring(16, 20)}-${hex.substring(20)}';
  }
}
