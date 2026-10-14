import 'package:umi_contract/umi_contract.dart';

/// Estado visible de los ítems enviados a esta estación; conserva el estado global del pedido.
String kitchenStationStatus(KitchenOrderProjection order) {
  if (order.status == 'cancelled') return 'cancelled';
  final items = order.items
      .map(KitchenOrderItem.fromJson)
      .where((item) => item.status != 'cancelled')
      .toList();
  if (items.isEmpty) return 'cancelled';
  if (items.any((item) => item.status == 'exception')) return 'exception';
  if (items.every((item) => item.status == 'ready')) return 'ready';
  if (items.any((item) => item.status == 'ready')) return 'partially_ready';
  if (items.any((item) => item.status == 'preparing')) return 'in_preparation';
  return 'queued';
}

bool kitchenOrderOverdue(KitchenOrderProjection order, DateTime now) {
  if (![
    'queued',
    'in_preparation',
    'partially_ready',
    'exception',
  ].contains(order.status)) {
    return false;
  }
  final queued = DateTime.tryParse(order.queuedAt);
  if (queued == null) return false;
  final age = now.difference(queued).inSeconds;
  final stationTarget =
      order.overdueSeconds ??
      (order.stationName?.toLowerCase() == 'barra' ? 300 : 900);
  return order.items
      .map(KitchenOrderItem.fromJson)
      .any(
        (item) =>
            item.fired &&
            ['queued', 'preparing'].contains(item.status) &&
            age >= (item.targetSeconds ?? stationTarget),
      );
}

/// Cada evento suena una vez. La primera lectura sólo establece la referencia.
final class KitchenAlertTracker {
  final _seen = <String>{};
  final _overdue = <String>{};
  bool _initialized = false;

  List<String> observe(
    List<KitchenOrderProjection> orders,
    DateTime now, {
    String? stationId,
    bool muted = false,
  }) {
    final sounds = <String>[];
    for (final order in orders) {
      final key = '${order.id}:${order.stationId}';
      final arrived = _seen.add(key);
      final late = kitchenOrderOverdue(order, now) && _overdue.add(key);
      if (!_initialized ||
          order.status == 'cancelled' ||
          muted ||
          order.soundsEnabled == false ||
          (stationId != null && order.stationId != stationId)) {
        continue;
      }
      if (arrived) sounds.add(order.arrivalSound ?? 'arrival');
      if (late) sounds.add(order.overdueSound ?? 'overdue');
    }
    _initialized = true;
    return sounds.toSet().toList();
  }
}

final class KitchenReadyTracker {
  String? _scope;
  Set<String>? _ready;
  List<String> observe(
    String scope,
    List<Map<String, Object?>> items, {
    bool muted = false,
  }) {
    final next = {for (final item in items) item['id'] as String};
    final sounds = <String>[];
    if (_scope == scope && _ready != null && !muted) {
      for (final item in items) {
        if (!_ready!.contains(item['id']) && item['sound'] is String) {
          sounds.add(item['sound'] as String);
        }
      }
    }
    _scope = scope;
    _ready = next;
    return sounds.toSet().toList();
  }
}
