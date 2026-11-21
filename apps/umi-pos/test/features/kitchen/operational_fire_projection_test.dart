import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/storage/local_working_copy.dart';
import 'package:umi_pos/features/kitchen/lan_kds_store.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';
import 'package:umi_pos/features/offline/operational_fire.dart';

const _merchant = '00000000-0000-4000-8000-000000000001';
const _location = '00000000-0000-4000-8000-000000000002';
const _operator = '00000000-0000-4000-8000-000000000003';
const _device = '00000000-0000-4000-8000-000000000004';
const _cart = '00000000-0000-4000-8000-000000000005';
const _command = '00000000-0000-4000-8000-000000000006';
const _line = '00000000-0000-4000-8000-000000000007';

Map<String, Object?> _operational() => {
  'schema': 1,
  'cartId': _cart,
  'cartVersion': 3,
  'firedAt': '2026-11-17T18:00:00.000Z',
  'fulfillmentType': 'dine_in',
  'publicReference': 'Mesa 4',
  'businessDate': '2026-11-17',
  'firedThroughCourse': 1,
  'items': [
    {
      'id': _line,
      'productName': 'Americano',
      'variantName': null,
      'modifiers': <Object?>[],
      'quantity': 2,
      'preparationNote': null,
      'displayOrder': 0,
      'courseNumber': 1,
      'fired': true,
    },
  ],
};

Future<({_MemoryLocal local, EncryptedOfflineJournal journal})> _fire({
  bool hubOwned = false,
  String commandId = _command,
}) async {
  final local = _MemoryLocal();
  final journal = EncryptedOfflineJournal(_MemoryCipher(), web: false);
  await OperationalFireStore(local).record(
    merchantId: _merchant,
    locationId: _location,
    commandId: commandId,
    operational: _operational(),
  );
  await journal.append(
    commandId: commandId,
    deviceId: _device,
    credentialVersion: 1,
    merchantId: _merchant,
    locationId: _location,
    operatorSessionId: _operator,
    idempotencyKey: commandId,
    commandType: 'pos.cart.fire',
    hubOwned: hubOwned,
    originDeviceId: hubOwned ? '00000000-0000-4000-8000-000000000008' : null,
    payload: {
      'cartId': _cart,
      'locationId': _location,
      'operatorSessionId': _operator,
      'expectedVersion': 3,
      'idempotencyKey': commandId,
    },
  );
  return (local: local, journal: journal);
}

void main() {
  test('a durable fire yields one recoverable kitchen ticket', () async {
    final seeded = await _fire();
    final store = LanKdsStore(seeded.local, journal: seeded.journal);

    final first = await store.snapshot(_merchant, _location);
    expect(first, hasLength(1));
    expect(first.single['sourceOrderId'], _cart);
    expect(first.single['publicReference'], 'Mesa 4');
    expect(
      (first.single['items']! as List<Map<String, Object?>>)
          .single['productName'],
      'Americano',
    );
    final delivery = first.single['delivery']! as Map<String, Object?>;
    expect(delivery['commandId'], _command);
    expect(delivery['state'], 'local_durable');

    // A restart builds the same ticket from the journal alone: no second write,
    // no second identity.
    final restarted = LanKdsStore(seeded.local, journal: seeded.journal);
    final again = await restarted.snapshot(_merchant, _location);
    expect(again, hasLength(1));
    expect(again.single['sourceOrderId'], _cart);
    expect(
      (again.single['delivery']! as Map<String, Object?>)['deviceSequence'],
      1,
    );
  });

  test('a forwarded peer fire is a host ticket exactly once', () async {
    final seeded = await _fire(hubOwned: true);
    final journal = seeded.journal;
    final store = LanKdsStore(seeded.local, journal: journal);
    final tickets = await store.snapshot(_merchant, _location);
    expect(tickets, hasLength(1));
    expect(
      (tickets.single['delivery']! as Map<String, Object?>)['state'],
      'host_queued',
    );

    // Re-forwarding the same command identity must not append or project twice.
    await journal.append(
      commandId: _command,
      deviceId: _device,
      credentialVersion: 1,
      merchantId: _merchant,
      locationId: _location,
      operatorSessionId: _operator,
      idempotencyKey: _command,
      commandType: 'pos.cart.fire',
      hubOwned: true,
      originDeviceId: '00000000-0000-4000-8000-000000000008',
      payload: {
        'cartId': _cart,
        'locationId': _location,
        'operatorSessionId': _operator,
        'expectedVersion': 3,
        'idempotencyKey': _command,
      },
    );
    expect((await journal.load()).entries, hasLength(1));
    expect(await store.snapshot(_merchant, _location), hasLength(1));
  });

  test(
    'cloud reconciliation replaces the local ticket, not adds one',
    () async {
      final seeded = await _fire();
      final journal = seeded.journal;
      final local = seeded.local;
      final store = LanKdsStore(local, journal: journal);
      final officialId = '00000000-0000-4000-8000-0000000000f1';
      await store.saveCloudBoard(_merchant, _location, [
        {
          'id': officialId,
          'sourceOrderId': officialId,
          'publicReference': 'pos-cart:$_cart',
          'merchantId': _merchant,
          'locationId': _location,
          'stationId': '00000000-0000-4000-8000-0000000000f2',
          'source': 'pos',
          'fulfillmentType': 'dine_in',
          'status': 'queued',
          'priority': 'normal',
          'businessDate': '2026-11-17',
          'queuedAt': '2026-11-17T18:00:01.000Z',
          'preparationStartedAt': null,
          'updatedAt': '2026-11-17T18:00:01.000Z',
          'version': 1,
          'lastEventSequence': 0,
          'firedThroughCourse': 1,
          'items': <Object?>[],
        },
      ]);

      final tickets = await store.snapshot(_merchant, _location);
      expect(tickets, hasLength(1));
      expect(tickets.single['sourceOrderId'], officialId);
    },
  );

  test(
    'a bump before reconciliation does not duplicate the official card',
    () async {
      final seeded = await _fire();
      final store = LanKdsStore(seeded.local, journal: seeded.journal);
      final ticket = (await store.snapshot(_merchant, _location)).single;
      await store.applyCommand(
        _merchant,
        _location,
        KitchenCommandRequest(
          action: 'command',
          commandId: '00000000-0000-4000-8000-0000000000b1',
          idempotencyKey: '00000000-0000-4000-8000-0000000000b2',
          correlationId: '00000000-0000-4000-8000-0000000000b3',
          expectedVersion: 1,
          kitchenOrderId: ticket['id']! as String,
          commandType: 'mark_item_ready',
          itemIds: [_line],
        ),
      );

      final officialId = '00000000-0000-4000-8000-0000000000f1';
      await store.saveCloudBoard(_merchant, _location, [
        {
          'id': officialId,
          'sourceOrderId': officialId,
          'publicReference': 'pos-cart:$_cart',
          'merchantId': _merchant,
          'locationId': _location,
          'stationId': '00000000-0000-4000-8000-0000000000f2',
          'source': 'pos',
          'fulfillmentType': 'dine_in',
          'status': 'queued',
          'priority': 'normal',
          'businessDate': '2026-11-17',
          'queuedAt': '2026-11-17T18:00:01.000Z',
          'preparationStartedAt': null,
          'updatedAt': '2026-11-17T18:00:01.000Z',
          'version': 1,
          'lastEventSequence': 0,
          'firedThroughCourse': 1,
          'items': <Object?>[],
        },
      ]);

      final tickets = await store.snapshot(_merchant, _location);
      expect(tickets, hasLength(1));
      expect(tickets.single['sourceOrderId'], officialId);
      expect(tickets.single['status'], 'ready');
    },
  );

  test('a bump on a journal-only ticket is ordered and visible', () async {
    final seeded = await _fire();
    final store = LanKdsStore(seeded.local, journal: seeded.journal);
    final ticket = (await store.snapshot(_merchant, _location)).single;
    final result = await store.applyCommand(
      _merchant,
      _location,
      KitchenCommandRequest(
        action: 'command',
        commandId: '00000000-0000-4000-8000-0000000000a1',
        idempotencyKey: '00000000-0000-4000-8000-0000000000a2',
        correlationId: '00000000-0000-4000-8000-0000000000a3',
        expectedVersion: 1,
        kitchenOrderId: ticket['id']! as String,
        commandType: 'mark_item_ready',
        itemIds: [_line],
      ),
    );
    expect(result['status'], 'ready');
    final after = await store.snapshot(_merchant, _location);
    expect(after.single['status'], 'ready');
    expect(after.single['version'], 2);
  });
}

final class _MemoryCipher implements JournalCipherStore {
  String? _ciphertext;
  String? _key;

  @override
  Future<String?> readCiphertext() async => _ciphertext;

  @override
  Future<String?> readKey() async => _key;

  @override
  Future<void> writeCiphertext(String value) async => _ciphertext = value;

  @override
  Future<void> writeKey(String value) async => _key = value;
}

final class _MemoryLocal implements LocalWorkingCopy {
  final Map<String, Map<String, Object?>> _documents = {};

  @override
  Future<Map<String, Object?>?> readDocument(
    String namespace,
    String scopeKey,
    String id,
  ) async {
    final value = _documents['$namespace|$scopeKey|$id'];
    return value == null
        ? null
        : jsonDecode(jsonEncode(value)) as Map<String, Object?>;
  }

  @override
  Future<void> writeDocument({
    required String namespace,
    required String scopeKey,
    required String id,
    required Map<String, Object?> payload,
    String syncState = 'synced',
  }) async {
    _documents['$namespace|$scopeKey|$id'] =
        jsonDecode(jsonEncode(payload)) as Map<String, Object?>;
  }

  @override
  Future<List<LocalDocument>> readDocuments(
    String namespace,
    String scopeKey,
  ) async => [
    for (final entry in _documents.entries)
      if (entry.key.startsWith('$namespace|$scopeKey|'))
        LocalDocument(
          id: entry.key.split('|').last,
          payload: entry.value,
          updatedAt: DateTime.now().toUtc().toIso8601String(),
          syncState: 'synced',
        ),
  ];

  @override
  Future<void> deleteDocument(
    String namespace,
    String scopeKey,
    String id,
  ) async {
    _documents.remove('$namespace|$scopeKey|$id');
  }

  @override
  Future<List<Cart>> readFiredCarts(
    String merchantId,
    String locationId,
  ) async => const [];

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError(invocation.memberName.toString());
}
