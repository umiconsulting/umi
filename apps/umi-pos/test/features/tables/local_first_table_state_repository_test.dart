import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/storage/local_working_copy.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';
import 'package:umi_pos/features/tables/local_first_table_state_repository.dart';
import 'package:umi_pos/features/tables/table_state_repository.dart';

const _merchant = '00000000-0000-4000-8000-000000000001';
const _location = '00000000-0000-4000-8000-000000000002';
const _operator = '00000000-0000-4000-8000-000000000003';
const _device = '00000000-0000-4000-8000-000000000004';
const _table = '00000000-0000-4000-8000-000000000005';

void main() {
  test('an offline room reads the cached map instead of blanking', () async {
    final local = _MemoryLocal();
    final cloud = _Cloud(_room('open'));
    final repository = _repository(local, cloud);

    final online = await repository.read(_merchant, _query());
    expect(online.states.single['state'], 'open');

    cloud.fail = true;
    final offline = await repository.read(_merchant, _query());
    expect(offline.states.single['state'], 'open');
  });

  test('seating paints locally and commits one replayable command', () async {
    final local = _MemoryLocal();
    final cloud = _Cloud(_room('open'));
    final journal = EncryptedOfflineJournal(_MemoryCipher(), web: false);
    final repository = _repository(local, cloud, journal: journal);
    await repository.read(_merchant, _query());

    cloud.fail = true;
    final result = await repository.seat(
      _merchant,
      SeatTableRequest(
        locationId: _location,
        operatorSessionId: _operator,
        idempotencyKey: _uuid(10),
        tableId: _table,
        partySize: 2,
      ),
    );

    expect(result.changed.single['state'], 'seated');
    final cached = await repository.read(_merchant, _query());
    expect(cached.states.single['state'], 'seated');
    final pending = await journal.load();
    expect(pending.pendingCount, 1);
    expect(pending.entries.single.command.commandType, 'pos.table.command');
    expect(pending.entries.single.command.payload['action'], 'seat');
  });

  test(
    'an online read shows another device account with a pending local command',
    () async {
      final local = _MemoryLocal();
      final cloud = _Cloud(_room('open'));
      final journal = EncryptedOfflineJournal(_MemoryCipher(), web: false);
      final repository = _repository(local, cloud, journal: journal);
      await repository.read(_merchant, _query());

      cloud.fail = true;
      await repository.seat(
        _merchant,
        SeatTableRequest(
          locationId: _location,
          operatorSessionId: _operator,
          idempotencyKey: _uuid(13),
          tableId: _table,
          partySize: 2,
        ),
      );

      cloud
        ..fail = false
        ..map = _room(
          'seated',
          seatedAt: '2026-10-18T09:00:00.000Z',
          partySize: 2,
          openAccountId: _uuid(14),
          openAccountFolio: '002',
        );

      final online = await repository.read(_merchant, _query());

      expect(_stateOf(online, _table), 'seated');
      expect(online.states.single['openAccountFolio'], '002');
      expect((await journal.load()).pendingCount, 1);
    },
  );

  test(
    'serving advances every table in the party without a round trip',
    () async {
      final local = _MemoryLocal();
      final cloud = _Cloud(
        TableStateMap(
          locationId: _location,
          serverTime: '2026-10-18T09:00:00.000Z',
          states: [
            <String, Object?>{
              'tableId': _table,
              'state': 'seated',
              'seatedAt': '2026-10-18T09:00:00.000Z',
              'partySize': 2,
              'groupId': null,
              'openAccountId': null,
              'openAccountFolio': null,
              'openAccountTableId': null,
            },
          ],
        ),
      );
      final repository = _repository(local, cloud);
      await repository.read(_merchant, _query());
      cloud.fail = true;

      final result = await repository.markServed(
        _merchant,
        MarkTableServedRequest(
          locationId: _location,
          operatorSessionId: _operator,
          idempotencyKey: _uuid(11),
          tableId: _table,
        ),
      );

      expect(result.changed.single['state'], 'served');
      expect(result.changed.single['seatedAt'], '2026-10-18T09:00:00.000Z');
    },
  );

  test('a peer table command is marked for the hub writer', () async {
    final local = _MemoryLocal();
    final cloud = _Cloud(_room('open'));
    final journal = EncryptedOfflineJournal(_MemoryCipher(), web: false);
    final repository = _repository(
      local,
      cloud,
      journal: journal,
      hubOwned: true,
    );
    await repository.read(_merchant, _query());

    await repository.seat(
      _merchant,
      SeatTableRequest(
        locationId: _location,
        operatorSessionId: _operator,
        idempotencyKey: _uuid(12),
        tableId: _table,
        partySize: 2,
      ),
    );

    expect((await journal.load()).entries.single.command.hubOwned, isTrue);
  });

  test('an account claim projects the seat without a second command', () async {
    final local = _MemoryLocal();
    final cloud = _Cloud(_room('open'));
    final journal = EncryptedOfflineJournal(_MemoryCipher(), web: false);
    final repository = _repository(local, cloud, journal: journal);
    await repository.read(_merchant, _query());

    final projected = await repository.projectSeat(
      _merchant,
      _location,
      _table,
      2,
    );

    expect(_stateOf(projected, _table), 'seated');
    cloud.fail = true;
    expect(
      _stateOf(await repository.read(_merchant, _query()), _table),
      'seated',
    );
    expect((await journal.load()).entries, isEmpty);
  });
}

String _stateOf(TableStateMap map, String tableId) =>
    map.states.firstWhere((entry) => entry['tableId'] == tableId)['state']!
        as String;

LocalFirstTableStateRepository _repository(
  _MemoryLocal local,
  _Cloud cloud, {
  EncryptedOfflineJournal? journal,
  bool hubOwned = false,
}) => LocalFirstTableStateRepository(
  cloud: cloud,
  local: local,
  journal: journal ?? EncryptedOfflineJournal(_MemoryCipher(), web: false),
  identity: () =>
      const TableDeviceIdentity(deviceId: _device, credentialVersion: 1),
  replay: (_) async {},
  hubOwned: hubOwned,
);

PosTableStateQuery _query() => const PosTableStateQuery(
  locationId: _location,
  operatorSessionId: _operator,
);

TableStateMap _room(
  String state, {
  String? seatedAt,
  int? partySize,
  String? openAccountId,
  String? openAccountFolio,
}) => TableStateMap(
  locationId: _location,
  serverTime: '2026-10-18T09:00:00.000Z',
  states: [
    <String, Object?>{
      'tableId': _table,
      'state': state,
      'seatedAt': seatedAt,
      'partySize': partySize,
      'groupId': null,
      'openAccountId': openAccountId,
      'openAccountFolio': openAccountFolio,
      'openAccountTableId': openAccountId == null ? null : _table,
    },
  ],
);

String _uuid(int value) =>
    '00000000-0000-4000-8000-${value.toString().padLeft(12, '0')}';

final class _Cloud implements TableStateRepository {
  _Cloud(this.map);
  TableStateMap map;
  bool fail = false;

  @override
  Future<TableStateMap> read(
    String merchantId,
    PosTableStateQuery query,
  ) async {
    if (fail) throw StateError('offline');
    return map;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError(invocation.memberName.toString());
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
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError(invocation.memberName.toString());
}

final class _MemoryCipher implements JournalCipherStore {
  String? _ciphertext;
  String? _key;

  @override
  Future<String?> readCiphertext() async => _ciphertext;

  @override
  Future<String?> readKey() async => _key;

  @override
  Future<void> writeCiphertext(String value) async {
    _ciphertext = value;
  }

  @override
  Future<void> writeKey(String value) async {
    _key = value;
  }
}
