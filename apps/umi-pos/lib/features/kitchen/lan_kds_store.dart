import 'package:umi_contract/umi_contract.dart';

import '../../core/storage/local_working_copy.dart';
import '../../shared/business_day.dart';
import '../offline/offline_journal.dart';

/// The kitchen work a LAN peer can read while the uplink is down.
///
/// Server projections and local fired carts are merged into one board. A local
/// KDS command is applied here at once, then journalled by the hub and replayed
/// to the cloud later.
final class LanKdsStore {
  LanKdsStore(this._local, {EncryptedOfflineJournal? journal})
    : _journal = journal;

  static const namespace = 'kds';
  static const clockNamespace = 'lan_clock';
  static const _placeholderStation = '00000000-0000-4000-8000-000000000000';

  final LocalWorkingCopy _local;
  final EncryptedOfflineJournal? _journal;

  String _scope(String merchantId, String locationId) =>
      '$merchantId:$locationId';

  Future<void> saveCloudBoard(
    String merchantId,
    String locationId,
    List<Map<String, Object?>> orders,
  ) => _local.writeDocument(
    namespace: namespace,
    scopeKey: _scope(merchantId, locationId),
    id: 'board',
    payload: {'orders': orders, 'cachedAt': _now()},
  );

  Future<void> saveStations(
    String merchantId,
    String locationId,
    List<KitchenStation> stations,
  ) => _local.writeDocument(
    namespace: namespace,
    scopeKey: _scope(merchantId, locationId),
    id: 'stations',
    payload: {'stations': stations.map((station) => station.toJson()).toList()},
  );

  Future<List<Map<String, Object?>>> stations(
    String merchantId,
    String locationId,
  ) async {
    final document = await _local.readDocument(
      namespace,
      _scope(merchantId, locationId),
      'stations',
    );
    return (document?['stations'] as List<Object?>? ?? const [])
        .whereType<Map<String, Object?>>()
        .map((station) => Map<String, Object?>.from(station))
        .toList(growable: false);
  }

  Future<List<Map<String, Object?>>> snapshot(
    String merchantId,
    String locationId,
  ) async {
    final state = await _state(merchantId, locationId);
    return state.orders
        .where(
          (order) =>
              order['status'] != 'completed' && order['status'] != 'cancelled',
        )
        .toList(growable: false);
  }

  Future<List<Map<String, Object?>>> events(
    String merchantId,
    String locationId, {
    required int afterSequence,
    required int limit,
  }) async {
    final state = await _state(merchantId, locationId);
    return state.events
        .where((event) => (event['sequence'] as num? ?? 0) > afterSequence)
        .take(limit)
        .toList(growable: false);
  }

  Future<Map<String, Object?>> applyCommand(
    String merchantId,
    String locationId,
    KitchenCommandRequest request,
  ) async {
    final state = await _state(merchantId, locationId);
    final index = state.orders.indexWhere(
      (order) =>
          order['id'] == request.kitchenOrderId ||
          order['sourceOrderId'] == request.kitchenOrderId,
    );
    if (index < 0) {
      throw const LanKdsRefusal('KITCHEN_ORDER_NOT_FOUND', 404);
    }
    final current = Map<String, Object?>.from(state.orders[index]);
    if ((current['version'] as num?)?.toInt() != request.expectedVersion) {
      throw const LanKdsRefusal('KITCHEN_VERSION_CONFLICT', 409);
    }
    final now = _now();
    final items = (current['items'] as List<Object?>? ?? const [])
        .whereType<Map<String, Object?>>()
        .map((item) => Map<String, Object?>.from(item))
        .toList();
    final selected = (request.itemIds ?? const <String>[]).toSet();
    var nextStatus = current['status'] as String? ?? 'queued';
    switch (request.commandType) {
      case 'start_preparation':
        nextStatus = 'in_preparation';
        current['preparationStartedAt'] = now;
        for (final item in items) {
          if (item['status'] == 'queued') item['status'] = 'preparing';
        }
      case 'mark_item_ready':
        for (final item in items) {
          if (selected.isEmpty || selected.contains(item['id'])) {
            item['status'] = 'ready';
          }
        }
        final active = items.where((item) => item['status'] != 'cancelled');
        nextStatus =
            active.isNotEmpty &&
                active.every((item) => item['status'] == 'ready')
            ? 'ready'
            : 'partially_ready';
      case 'mark_order_ready':
        nextStatus = 'ready';
        for (final item in items) {
          if (item['status'] != 'cancelled') item['status'] = 'ready';
        }
      case 'complete':
        nextStatus = 'completed';
        for (final item in items) {
          if (item['status'] != 'cancelled') item['status'] = 'ready';
        }
      case 'recall':
        nextStatus = 'in_preparation';
        for (final item in items) {
          if (selected.isEmpty || selected.contains(item['id'])) {
            if (item['status'] == 'ready') item['status'] = 'preparing';
          }
        }
      case 'cancel_ack':
        for (final item in items) {
          if (selected.isEmpty || selected.contains(item['id'])) {
            item['status'] = 'cancelled';
          }
        }
        final active = items.where((item) => item['status'] != 'cancelled');
        nextStatus = active.isEmpty
            ? 'cancelled'
            : active.every((item) => item['status'] == 'ready')
            ? 'ready'
            : 'in_preparation';
      case 'change_priority':
        nextStatus = current['status'] as String? ?? 'queued';
        if (request.priority != null) current['priority'] = request.priority;
      case 'fire_course':
        nextStatus = current['status'] as String? ?? 'queued';
        final through = request.courseNumber ?? 1;
        current['firedThroughCourse'] = through;
        for (final item in items) {
          if ((item['courseNumber'] as num? ?? 1) <= through) {
            item['fired'] = true;
          }
        }
    }
    final version = request.expectedVersion + 1;
    final sequence = state.nextSequence;
    current
      ..['items'] = items
      ..['status'] = nextStatus
      ..['version'] = version
      ..['updatedAt'] = now
      ..['lastEventSequence'] = sequence;
    final event = <String, Object?>{
      'sequence': sequence,
      'kitchenOrderId': current['id'],
      'sourceOrderId': current['sourceOrderId'],
      'merchantId': merchantId,
      'locationId': locationId,
      'stationId': current['stationId'],
      'kind': _eventKind(request.commandType),
      'aggregateVersion': version,
      'status': nextStatus,
      'occurredAt': now,
      'correlationId': request.correlationId,
      'source': 'umi_api',
      'payload': {
        'commandType': request.commandType,
        'itemIds': request.itemIds,
      },
    };
    final overlay = [...state.orders];
    overlay[index] = current;
    await _saveOverlay(merchantId, locationId, overlay);
    await _saveEvents(merchantId, locationId, [
      ...state.events,
      event,
    ], sequence + 1);
    return {
      'kitchenOrderId': current['id'],
      'status': nextStatus,
      'version': version,
      'sequence': sequence,
      'updatedAt': now,
    };
  }

  Future<Map<String, Object?>?> commandResult(
    String merchantId,
    String locationId,
    String kitchenOrderId,
  ) async {
    final state = await _state(merchantId, locationId);
    for (final order in state.orders) {
      if (order['id'] == kitchenOrderId ||
          order['sourceOrderId'] == kitchenOrderId) {
        return {
          'kitchenOrderId': order['id'],
          'status': order['status'],
          'version': order['version'],
          'sequence': order['lastEventSequence'] ?? 0,
          'updatedAt': order['updatedAt'],
        };
      }
    }
    return null;
  }

  /// The server-side order reference for a locally fired cart. The main
  /// station writes the order with `pos-cart:<cartId>` as its external ref.
  Future<String?> sourceReferenceFor(
    String merchantId,
    String locationId,
    String kitchenOrderId,
  ) async {
    for (final cart in await _local.readFiredCarts(merchantId, locationId)) {
      if ((cart.firedOrderId ?? cart.id) == kitchenOrderId) {
        return 'pos-cart:${cart.id}';
      }
    }
    return null;
  }

  /// The order the cook sees each local ticket item at.
  ///
  /// A ticket fired while the WAN is down is built from cart lines, so its
  /// item ids are local cart-line ids. The API creates its own kitchen-order
  /// item ids when it replays the fire. This map is the bridge: it lets the
  /// replay resolve the item the cook actually bumped instead of writing a
  /// kitchen command against an id the server has never seen.
  Future<Map<String, int>?> itemOrderFor(
    String merchantId,
    String locationId,
    String kitchenOrderId,
    List<String> itemIds,
  ) async {
    if (itemIds.isEmpty) return null;
    final state = await _state(merchantId, locationId);
    final orderIndex = state.orders.indexWhere(
      (order) =>
          order['id'] == kitchenOrderId ||
          order['sourceOrderId'] == kitchenOrderId,
    );
    if (orderIndex < 0) return null;
    final items =
        (state.orders[orderIndex]['items'] as List<Object?>? ?? const [])
            .whereType<Map<String, Object?>>()
            .toList(growable: false);
    final result = <String, int>{};
    for (final itemId in itemIds) {
      final itemIndex = items.indexWhere((item) => item['id'] == itemId);
      if (itemIndex < 0) return null;
      result[itemId] =
          (items[itemIndex]['displayOrder'] as num?)?.toInt() ?? itemIndex;
    }
    return result;
  }

  Future<void> recordClockOffset(String peerKey, int offsetMilliseconds) =>
      _local.writeDocument(
        namespace: clockNamespace,
        scopeKey: 'hub',
        id: peerKey,
        payload: {
          'offsetMilliseconds': offsetMilliseconds,
          'recordedAt': _now(),
        },
      );

  Future<_KdsState> _state(String merchantId, String locationId) async {
    final scope = _scope(merchantId, locationId);
    final documents = {
      for (final document in await _local.readDocuments(namespace, scope))
        document.id: document.payload,
    };
    final stations =
        (documents['stations']?['stations'] as List<Object?>? ?? const [])
            .whereType<Map<String, Object?>>()
            .map(KitchenStation.fromJson)
            .toList(growable: false);
    final base = (documents['board']?['orders'] as List<Object?>? ?? const [])
        .whereType<Map<String, Object?>>()
        .map((order) => Map<String, Object?>.from(order))
        .toList(growable: true);
    final overlay =
        (documents['overlay']?['orders'] as List<Object?>? ?? const [])
            .whereType<Map<String, Object?>>()
            .map((order) => Map<String, Object?>.from(order))
            .toList(growable: false);
    final carts = await _local.readFiredCarts(merchantId, locationId);
    final officialSourceByLocal = {
      for (final cart in carts)
        if (cart.firedOrderId != null) cart.id: cart.firedOrderId!,
    };
    final localSources = {
      for (final cart in carts) cart.firedOrderId ?? cart.id,
    };
    final officialTypes = <String, Object?>{
      for (final order in base)
        if (order['sourceOrderId'] case final String source)
          source: order['fulfillmentType'],
    };
    final merged = <String, Map<String, Object?>>{
      for (final order in base)
        if (order['sourceOrderId'] case final String source) source: order,
    };
    for (final order in overlay) {
      var source = order['sourceOrderId'];
      if (source is! String) continue;
      final official = officialSourceByLocal[source];
      if (official != null) {
        if (order['id'] == source) order['id'] = official;
        order['sourceOrderId'] = official;
        source = official;
      }
      final server = merged[source];
      if (server == null) {
        // A local command overlay is not a copy of active work. Once a cloud
        // refresh omits the order, another terminal has completed or cancelled
        // it. Keep overlays only for carts this terminal fired and the cloud
        // has not acknowledged yet; otherwise the old card survives for ever.
        if (localSources.contains(source)) merged[source] = order;
        continue;
      }
      if ((order['version'] as num? ?? 0) > (server['version'] as num? ?? 0)) {
        merged[source] = {...order, 'fulfillmentType': officialTypes[source]};
      }
    }
    final localOnly = <Map<String, Object?>>[];
    for (final cart in carts) {
      final source = cart.firedOrderId ?? cart.id;
      final existing = merged[source];
      if (existing != null) {
        if (!officialTypes.containsKey(source)) {
          existing['fulfillmentType'] = cart.fulfillmentType;
        }
        continue;
      }
      localOnly.add(
        _ticketFromCart(
          merchantId,
          locationId,
          cart,
          stations.isEmpty ? null : stations.first,
        ),
      );
    }
    final orders = [...localOnly, ...merged.values];
    await _applyPendingFulfillment(merchantId, locationId, carts, orders);
    final events =
        (documents['events']?['events'] as List<Object?>? ?? const [])
            .whereType<Map<String, Object?>>()
            .map((event) => Map<String, Object?>.from(event))
            .toList(growable: false);
    final next = documents['events']?['nextSequence'] as num?;
    return _KdsState(
      // A ticket fired while the uplink is down is new work. Put that work at
      // the front of the rail, where a cook who opens the board can see it,
      // instead of below a long server backlog.
      orders: orders,
      events: events,
      nextSequence:
          next?.toInt() ??
          (events.isEmpty
              ? 1
              : (events.last['sequence'] as num? ?? 0).toInt() + 1),
    );
  }

  /// Only an explicit pending choice can replace an official order type.
  Future<void> _applyPendingFulfillment(
    String merchantId,
    String locationId,
    List<Cart> carts,
    List<Map<String, Object?>> orders,
  ) async {
    final journal = _journal;
    if (journal == null || !journal.supportsSecureOffline || carts.isEmpty) {
      return;
    }
    final OfflineJournalSnapshot snapshot;
    try {
      snapshot = await journal.load();
    } on OfflineJournalException {
      // Keep the official snapshot when local intent cannot be read safely.
      return;
    }
    String? resolveCartId(String id) {
      final visited = <String>{};
      while (visited.add(id)) {
        final next = snapshot.mappings[id];
        if (next == null) return id;
        id = next;
      }
      return null;
    }

    final sources = <String, String>{};
    for (final cart in carts) {
      final id = resolveCartId(cart.id);
      if (id != null) sources[id] = cart.firedOrderId ?? cart.id;
    }
    final entries =
        snapshot.entries.where((entry) {
          final command = entry.command;
          return command.merchantId == merchantId &&
              command.locationId == locationId &&
              (command.commandType == 'pos.cart.fulfillment.set' ||
                  command.commandType == 'pos.cart.table.set') &&
              (entry.status == JournalStatus.pending ||
                  entry.status == JournalStatus.replaying ||
                  entry.status == JournalStatus.unknown);
        }).toList()..sort(
          (a, b) =>
              a.command.deviceSequence.compareTo(b.command.deviceSequence),
        );
    for (final entry in entries) {
      final command = entry.command;
      final cartId = command.payload['cartId'];
      if (cartId is! String) continue;
      final source = sources[resolveCartId(cartId)];
      if (source == null) continue;
      final type = command.commandType == 'pos.cart.table.set'
          ? 'dine_in'
          : command.payload['fulfillmentType'];
      if (type != 'dine_in' && type != 'takeout') continue;
      for (final order in orders) {
        if (order['sourceOrderId'] == source) order['fulfillmentType'] = type;
      }
    }
  }

  Future<void> _saveOverlay(
    String merchantId,
    String locationId,
    List<Map<String, Object?>> orders,
  ) => _local.writeDocument(
    namespace: namespace,
    scopeKey: _scope(merchantId, locationId),
    id: 'overlay',
    payload: {'orders': orders},
  );

  Future<void> _saveEvents(
    String merchantId,
    String locationId,
    List<Map<String, Object?>> events,
    int nextSequence,
  ) => _local.writeDocument(
    namespace: namespace,
    scopeKey: _scope(merchantId, locationId),
    id: 'events',
    payload: {
      'events': events.length > 1000
          ? events.sublist(events.length - 1000)
          : events,
      'nextSequence': nextSequence,
    },
  );

  Map<String, Object?> _ticketFromCart(
    String merchantId,
    String locationId,
    Cart cart,
    KitchenStation? station,
  ) {
    final sourceOrderId = cart.firedOrderId ?? cart.id;
    final now = cart.updatedAt;
    final firedItems = cart.items
        .where((item) => item['fired'] == true)
        .toList(growable: false);
    final courses = firedItems.map(
      (item) => (item['courseNumber'] as num? ?? 1).toInt(),
    );
    return {
      'id': sourceOrderId,
      'sourceOrderId': sourceOrderId,
      'publicReference':
          cart.tableName ??
          cart.accountName ??
          'Cuenta ${cart.id.substring(0, 4).toUpperCase()}',
      'merchantId': merchantId,
      'locationId': locationId,
      'stationId': station?.id ?? _placeholderStation,
      if (station != null) 'stationName': station.name,
      'source': 'pos',
      'fulfillmentType': cart.fulfillmentType,
      'status': 'queued',
      'priority': 'normal',
      'businessDate':
          cart.totals['businessDate'] as String? ??
          operationalDayStart(
            DateTime.now(),
          ).toIso8601String().substring(0, 10),
      'queuedAt': now,
      'preparationStartedAt': null,
      'updatedAt': now,
      'version': 1,
      'lastEventSequence': 0,
      'firedThroughCourse': courses.isEmpty
          ? 1
          : courses.reduce((left, right) => left > right ? left : right),
      'items': [
        for (var index = 0; index < firedItems.length; index++)
          _itemFromCart(firedItems[index], index),
      ],
    };
  }

  Map<String, Object?> _itemFromCart(Map<String, Object?> item, int index) {
    final variant = item['variant'];
    final modifiers = (item['modifiers'] as List<Object?>? ?? const [])
        .whereType<Map<String, Object?>>()
        .map((modifier) => modifier['name'])
        .whereType<String>()
        .toList(growable: false);
    return {
      'id': item['id'],
      'status': 'queued',
      'productName': item['productName'],
      'variantName': variant is Map<String, Object?> ? variant['name'] : null,
      'allergens': const <Object?>[],
      'modifiers': modifiers,
      'quantity': item['quantity'],
      'preparationNote': item['note'],
      'displayOrder': index,
      'targetSeconds': null,
      'courseNumber': item['courseNumber'] ?? 1,
      'fired': true,
      'version': 1,
    };
  }

  String _eventKind(String commandType) => switch (commandType) {
    'recall' => 'order_recalled',
    'change_priority' => 'priority_changed',
    'cancel_ack' => 'order_cancelled',
    'mark_item_ready' => 'item_updated',
    _ => 'order_updated',
  };

  String _now() => DateTime.now().toUtc().toIso8601String();
}

final class LanKdsRefusal implements Exception {
  const LanKdsRefusal(this.code, this.status);
  final String code;
  final int status;
}

final class _KdsState {
  const _KdsState({
    required this.orders,
    required this.events,
    required this.nextSequence,
  });

  final List<Map<String, Object?>> orders;
  final List<Map<String, Object?>> events;
  final int nextSequence;
}
