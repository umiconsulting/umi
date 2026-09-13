import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/observability/telemetry.dart';
import 'cart_repository.dart';

enum IncomingOrdersPhase { idle, loading, ready, failure }

final class IncomingOrdersState {
  const IncomingOrdersState({
    this.phase = IncomingOrdersPhase.idle,
    this.orders = const [],
    this.errorCode,
    this.binding = false,
  });
  final IncomingOrdersPhase phase;
  final List<PosIncomingOrder> orders;
  final String? errorCode;

  /// True while a pick-up (bind) request is in flight, so the UI can disable the row.
  final bool binding;
}

/// The POS "incoming orders" surface: the WhatsApp / web orders a till can pick up, and the
/// pick-up action that binds the active cart to one so the committed sale freezes the channel
/// (ADR 2026-09-13-pos-channel-attribution, Approach B). Listing is read-only; the operator
/// still rings the items, so the POS ring-up stays the receipt money-truth.
final class IncomingOrdersController extends ChangeNotifier {
  IncomingOrdersController({
    required CartRepository repository,
    required Telemetry telemetry,
  }) : _repository = repository,
       _telemetry = telemetry;
  final CartRepository _repository;
  final Telemetry _telemetry;
  IncomingOrdersState _state = const IncomingOrdersState();
  IncomingOrdersState get state => _state;
  String? _merchantId;
  String? _locationId;
  String? _operatorSessionId;

  Future<void> load(
    String merchantId,
    String locationId,
    String operatorSessionId,
  ) async {
    _merchantId = merchantId;
    _locationId = locationId;
    _operatorSessionId = operatorSessionId;
    _set(const IncomingOrdersState(phase: IncomingOrdersPhase.loading));
    try {
      final result = await _repository.incomingOrders(
        merchantId,
        CartQuery(locationId: locationId, operatorSessionId: operatorSessionId),
      );
      _set(
        IncomingOrdersState(
          phase: IncomingOrdersPhase.ready,
          // The generated PosIncomingOrders carries raw JSON maps; type them for the UI.
          orders: result.orders.map(PosIncomingOrder.fromJson).toList(),
        ),
      );
      _event('incoming_orders_loaded');
    } on AppException catch (error) {
      _failure(error);
    }
  }

  /// Bind [cart] to [order] and return the updated cart so the caller can adopt it
  /// (CartController.restore). Returns null on failure; the phase then carries the error code.
  Future<Cart?> pickUp(Cart cart, PosIncomingOrder order) async {
    if (_merchantId == null ||
        _locationId == null ||
        _operatorSessionId == null) {
      return null;
    }
    _set(
      IncomingOrdersState(
        phase: _state.phase,
        orders: _state.orders,
        binding: true,
      ),
    );
    try {
      final updated = await _repository.bindOrigin(
        _merchantId!,
        BindCartOriginRequest(
          cartId: cart.id,
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          originOrderId: order.orderId,
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
        ),
      );
      _set(
        IncomingOrdersState(
          phase: IncomingOrdersPhase.ready,
          orders: _state.orders,
        ),
      );
      _event('cart_origin_bound');
      return updated;
    } on AppException catch (error) {
      _failure(error);
      return null;
    }
  }

  void _failure(AppException error) {
    _event('incoming_orders_failed');
    _set(
      IncomingOrdersState(
        phase: IncomingOrdersPhase.failure,
        orders: _state.orders,
        errorCode: error.code,
      ),
    );
  }

  void _event(String name) =>
      _telemetry.event(ClientEvent(name: name, values: const {}));

  void _set(IncomingOrdersState value) {
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
