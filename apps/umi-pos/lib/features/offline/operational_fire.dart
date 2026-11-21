import 'package:umi_contract/umi_contract.dart';

import '../../core/storage/local_working_copy.dart';

/// A bounded, non-financial description of the work a fire command creates.
///
/// The journal is the durable record of intent. A kitchen ticket is an
/// operational view of that intent, not a second copy of the sale: it needs the
/// lines a cook must prepare and a stable way to point back at the command that
/// created them. Prices, tenders, payment attempts and customer value are
/// deliberately absent.
///
/// Replay strips [operationalFireKey] before any fire payload reaches the API,
/// whose `FireOrderRequest` is strict.
const operationalFireKey = 'operational';

/// The command payload sent to the API, without the local operational view.
///
/// Keeping this in one place stops a local read model from becoming a wire
/// contract by accident.
Map<String, Object?> wireCommandPayload(
  String commandType,
  Map<String, Object?> payload,
) {
  if (commandType != 'pos.cart.fire' ||
      !payload.containsKey(operationalFireKey)) {
    return payload;
  }
  return Map<String, Object?>.from(payload)..remove(operationalFireKey);
}

/// Builds the kitchen-safe snapshot for one fire.
///
/// [cart] is the cart after the optimistic fire prediction, so every line that
/// belongs on the ticket carries `fired: true`. A second fire therefore
/// re-projects the whole ticket instead of inventing a second one; the journal
/// command sequence decides which snapshot is newer.
Map<String, Object?> fireOperationalSnapshot(
  Cart cart, {
  required String firedAt,
}) {
  final fired = cart.items
      .where((item) => item['fired'] == true)
      .toList(growable: false);
  final courses = fired.map(
    (item) => (item['courseNumber'] as num? ?? 1).toInt(),
  );
  return {
    'schema': 1,
    'cartId': cart.id,
    'cartVersion': cart.version,
    'firedAt': firedAt,
    'fulfillmentType': cart.fulfillmentType,
    'publicReference':
        cart.tableName ??
        cart.accountName ??
        'Cuenta ${cart.id.substring(0, 4).toUpperCase()}',
    'tableId': cart.tableId,
    'tableName': cart.tableName,
    'businessDate':
        cart.totals['businessDate'] as String? ?? firedAt.substring(0, 10),
    'firedThroughCourse': courses.isEmpty
        ? 1
        : courses.reduce((left, right) => left > right ? left : right),
    'items': [
      for (var index = 0; index < fired.length; index++)
        _operationalItem(fired[index], index),
    ],
  };
}

Map<String, Object?> _operationalItem(Map<String, Object?> item, int index) {
  final variant = item['variant'];
  final modifiers = (item['modifiers'] as List<Object?>? ?? const [])
      .whereType<Map<String, Object?>>()
      .map((modifier) => modifier['name'])
      .whereType<String>()
      .toList(growable: false);
  return {
    'id': item['id'],
    'productName': item['productName'],
    'variantName': variant is Map<String, Object?> ? variant['name'] : null,
    'modifiers': modifiers,
    'quantity': item['quantity'],
    'preparationNote': item['note'],
    'displayOrder': index,
    'courseNumber': item['courseNumber'] ?? 1,
    'fired': true,
  };
}

/// Durable operational snapshots, separate from the replayable command.
///
/// Keeping this out of the command payload is a rollback requirement: an older
/// build that reads this journal must still send a wire-clean `FireOrderRequest`
/// to a strict API. The journal owns the command identity; this store owns what
/// the kitchen needs to draw it. A snapshot without a journal command is an
/// orphan from a crash before append and is never shown.
final class OperationalFireStore {
  const OperationalFireStore(this._local);

  static const namespace = 'pos_ops';

  final LocalWorkingCopy _local;

  String _scope(String merchantId, String locationId) =>
      '$merchantId:$locationId';

  Future<void> record({
    required String merchantId,
    required String locationId,
    required String commandId,
    required Map<String, Object?> operational,
  }) => _local.writeDocument(
    namespace: namespace,
    scopeKey: _scope(merchantId, locationId),
    id: 'fire:$commandId',
    payload: {
      'commandId': commandId,
      'operational': operational,
      'recordedAt': DateTime.now().toUtc().toIso8601String(),
    },
  );

  Future<void> forget({
    required String merchantId,
    required String locationId,
    required String commandId,
  }) => _local.deleteDocument(
    namespace,
    _scope(merchantId, locationId),
    'fire:$commandId',
  );

  Future<List<Map<String, Object?>>> read(
    String merchantId,
    String locationId,
  ) async => [
    for (final document in await _local.readDocuments(
      namespace,
      _scope(merchantId, locationId),
    ))
      document.payload,
  ];
}
