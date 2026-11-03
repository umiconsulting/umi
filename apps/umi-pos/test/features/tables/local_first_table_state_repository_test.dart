import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/storage/local_working_copy.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';
import 'package:umi_pos/features/tables/local_first_table_state_repository.dart';
import 'package:umi_pos/features/tables/table_state_controller.dart';
import 'package:umi_pos/features/tables/table_state_repository.dart';

const _merchant = '00000000-0000-4000-8000-000000000001';
const _location = '00000000-0000-4000-8000-000000000002';
const _operator = '00000000-0000-4000-8000-000000000003';
const _device = '00000000-0000-4000-8000-000000000004';
const _table = '00000000-0000-4000-8000-000000000005';

void main() {
  test('a failed account projection can retry the same account', () async {
    final local = _MemoryLocal();
    final controller = TableStateController(
      _repository(
        local,
        _Cloud(
          _room('served', seatedAt: '2026-10-18T09:00:00.000Z', partySize: 2),
        ),
      ),
    );
    addTearDown(controller.dispose);
    await controller.load(_merchant, _location, _operator);
    local.failWrites = true;
    await expectLater(
      controller.reconcileAccount(_uuid(70), tableId: _table),
      throwsStateError,
    );
    expect(controller.stateOf(_table).openAccountId, isNull);
    local.failWrites = false;
    await controller.reconcileAccount(_uuid(70), tableId: _table);
    expect(controller.stateOf(_table).openAccountId, _uuid(70));
  });

  test(
    'a cart without a cached room does not invent a table projection',
    () async {
      final local = _MemoryLocal();
      final controller = TableStateController(
        _repository(local, _Cloud(_room('open'))),
      );
      addTearDown(controller.dispose);
      await controller.reconcileAccount(
        _uuid(66),
        merchantId: _merchant,
        locationId: _location,
      );
      await controller.reconcileAccount(
        _uuid(66),
        tableId: _table,
        merchantId: _merchant,
        locationId: _location,
      );
      expect(controller.map, isNull);
      expect(local._documents, isEmpty);
    },
  );

  test(
    'account reconciliation persists while the map view is closed',
    () async {
      final cloud = _Cloud(
        _room(
          'served',
          seatedAt: '2026-10-18T09:00:00.000Z',
          partySize: 2,
          paidAt: '2026-10-18T09:10:00.000Z',
          openAccountId: _uuid(65),
        ),
      );
      final controller = TableStateController(
        _repository(_MemoryLocal(), cloud),
      );
      addTearDown(controller.dispose);
      await controller.load(_merchant, _location, _operator);
      cloud.fail = true;
      controller.clear();
      await controller.reconcileAccount(
        _uuid(65),
        merchantId: _merchant,
        locationId: _location,
      );
      expect(controller.hasContext, isFalse);
      await controller.load(_merchant, _location, _operator);
      expect(controller.isPaidAndOccupied(_table), isTrue);
      expect(controller.partyPresent(_table), isTrue);
      controller.clear();
      await controller.reconcileAccount(
        _uuid(65),
        tableId: _table,
        merchantId: _merchant,
        locationId: _location,
      );
      expect(controller.hasContext, isFalse);
      await controller.load(_merchant, _location, _operator);
      expect(controller.isPaidAndOccupied(_table), isFalse);
      expect(controller.stateOf(_table).openAccountId, _uuid(65));
    },
  );

  test('a rejected takeout restores the account on the paid visit', () async {
    final cloud = _Cloud(
      _room(
        'served',
        seatedAt: '2026-10-18T09:00:00.000Z',
        partySize: 2,
        paidAt: '2026-10-18T09:10:00.000Z',
        openAccountId: _uuid(60),
        openAccountFolio: '004',
      ),
    );
    final repository = _repository(_MemoryLocal(), cloud);
    final controller = TableStateController(repository);
    addTearDown(controller.dispose);
    await controller.load(_merchant, _location, _operator);
    cloud.fail = true;
    await controller.reconcileAccount(_uuid(60));
    expect(controller.isPaidAndOccupied(_table), isTrue);
    await controller.reconcileAccount(
      _uuid(60),
      tableId: _table,
      accountFolio: '004',
    );
    expect(controller.isPaidAndOccupied(_table), isFalse);
    expect(controller.stateOf(_table).openAccountId, _uuid(60));
    await Future.wait([
      controller.reconcileAccount(_uuid(60)),
      controller.reconcileAccount(
        _uuid(60),
        tableId: _table,
        accountFolio: '004',
      ),
    ]);
    expect(controller.stateOf(_table).openAccountId, _uuid(60));
    expect(controller.partyPresent(_table), isTrue);
  });

  test(
    'a new local account masks paid status for every table of the visit',
    () async {
      final initial = _room(
        'served',
        seatedAt: '2026-10-18T09:00:00.000Z',
        partySize: 2,
        paidAt: '2026-10-18T09:10:00.000Z',
      );
      final cloud = _Cloud(
        TableStateMap(
          locationId: _location,
          serverTime: initial.serverTime,
          states: [
            for (final id in [_table, _uuid(51)])
              {...initial.states.single, 'tableId': id, 'groupId': _uuid(52)},
          ],
        ),
      );
      final journal = EncryptedOfflineJournal(_MemoryCipher(), web: false);
      final repository = _repository(_MemoryLocal(), cloud, journal: journal);
      var clock = DateTime.utc(2026, 10, 18, 9);
      final controller = TableStateController(repository, clock: () => clock);
      addTearDown(controller.dispose);
      await controller.load(_merchant, _location, _operator);
      expect(controller.isPaidAndOccupied(_table), isTrue);
      cloud.fail = true;
      clock = clock.add(const Duration(minutes: 30));
      await controller.adoptOpenAccount(_table, _uuid(53), 'Cuenta 003');
      expect(controller.elapsedOf(_table), const Duration(minutes: 30));
      expect(controller.isPaidAndOccupied(_table), isFalse);
      expect(controller.isPaidAndOccupied(_uuid(51)), isFalse);
      final cached = await repository.read(_merchant, _query());
      for (final member in cached.states) {
        expect(member['openAccountId'], _uuid(53));
        expect(member['openAccountTableId'], _table);
        expect(member['paidAt'], '2026-10-18T09:10:00.000Z');
        expect(member['seatedAt'], '2026-10-18T09:00:00.000Z');
      }
      expect((await journal.load()).entries, isEmpty);
    },
  );

  test('an accepted table result survives a failed refresh', () async {
    final cloud = _Cloud(
      _room('seated', seatedAt: '2026-10-18T09:00:00.000Z', partySize: 2),
    );
    final repository = _repository(_MemoryLocal(), cloud);
    await repository.read(_merchant, _query());
    cloud.reply = TableStateChangeResult(
      locationId: _location,
      commandId: _uuid(40),
      serverTime: '2026-10-18T09:15:00.000Z',
      changed: [
        {
          ...cloud.map.states.single,
          'state': 'served',
          'paidAt': '2026-10-18T09:10:00.000Z',
          'openAccountId': _uuid(41),
          'openAccountFolio': '003',
          'openAccountTableId': _table,
        },
      ],
    );
    await repository.markServed(
      _merchant,
      MarkTableServedRequest(
        locationId: _location,
        operatorSessionId: _operator,
        idempotencyKey: _uuid(40),
        tableId: _table,
      ),
    );
    cloud.fail = true;
    final cached = await repository.read(_merchant, _query());
    expect(cached.states.single['paidAt'], '2026-10-18T09:10:00.000Z');
    expect(cached.states.single['openAccountId'], _uuid(41));
  });

  test('an offline table with a new open account cannot be cleared', () async {
    final cloud = _Cloud(
      _room(
        'ordered',
        seatedAt: '2026-10-18T09:00:00.000Z',
        partySize: 2,
        paidAt: '2026-10-18T09:10:00.000Z',
        openAccountId: _uuid(42),
      ),
    );
    final repository = _repository(_MemoryLocal(), cloud);
    await repository.read(_merchant, _query());
    cloud.fail = true;
    await expectLater(
      repository.clear(
        _merchant,
        ClearTableRequest(
          locationId: _location,
          operatorSessionId: _operator,
          idempotencyKey: _uuid(43),
          tableId: _table,
        ),
      ),
      throwsA(
        isA<AppException>().having(
          (error) => error.code,
          'code',
          'TABLE_HAS_OPEN_ACCOUNT',
        ),
      ),
    );
    expect(
      _stateOf(await repository.read(_merchant, _query()), _table),
      'ordered',
    );
  });

  test(
    'an offline paid visit moves with its payment and clears it on departure',
    () async {
      final local = _MemoryLocal();
      const paidAt = '2026-10-18T09:10:00.000Z';
      final cloud = _Cloud(
        _room(
          'served',
          seatedAt: '2026-10-18T09:00:00.000Z',
          partySize: 2,
          paidAt: paidAt,
        ),
      );
      final repository = _repository(local, cloud);
      await repository.read(_merchant, _query());
      cloud.fail = true;
      final destination = _uuid(20);
      final moved = await repository.move(
        _merchant,
        MovePartyRequest(
          locationId: _location,
          operatorSessionId: _operator,
          idempotencyKey: _uuid(21),
          fromTableId: _table,
          toTableId: destination,
        ),
      );
      expect(
        moved.changed.firstWhere(
          (entry) => entry['tableId'] == destination,
        )['paidAt'],
        paidAt,
      );
      expect(
        moved.changed.firstWhere(
          (entry) => entry['tableId'] == _table,
        )['paidAt'],
        isNull,
      );
      final served = await repository.markServed(
        _merchant,
        MarkTableServedRequest(
          locationId: _location,
          operatorSessionId: _operator,
          idempotencyKey: _uuid(22),
          tableId: destination,
        ),
      );
      expect(served.changed.single['paidAt'], paidAt);
      final cleared = await repository.clear(
        _merchant,
        ClearTableRequest(
          locationId: _location,
          operatorSessionId: _operator,
          idempotencyKey: _uuid(23),
          tableId: destination,
        ),
      );
      expect(cleared.changed.single['paidAt'], isNull);
      expect(cleared.changed.single['state'], 'dirty');
      final reseated = await repository.seat(
        _merchant,
        SeatTableRequest(
          locationId: _location,
          operatorSessionId: _operator,
          idempotencyKey: _uuid(24),
          tableId: destination,
          partySize: 1,
        ),
      );
      expect(reseated.changed.single['paidAt'], isNull);
    },
  );

  test(
    'an offline move preserves the new account on a previously paid visit',
    () async {
      final local = _MemoryLocal();
      final account = _uuid(30);
      final cloud = _Cloud(
        _room(
          'ordered',
          seatedAt: '2026-10-18T09:00:00.000Z',
          partySize: 2,
          paidAt: '2026-10-18T09:10:00.000Z',
          openAccountId: account,
          openAccountFolio: '002',
        ),
      );
      final repository = _repository(local, cloud);
      await repository.read(_merchant, _query());
      cloud.fail = true;
      final destination = _uuid(31);
      final moved = await repository.move(
        _merchant,
        MovePartyRequest(
          locationId: _location,
          operatorSessionId: _operator,
          idempotencyKey: _uuid(32),
          fromTableId: _table,
          toTableId: destination,
        ),
      );
      final entry = moved.changed.firstWhere(
        (entry) => entry['tableId'] == destination,
      );
      expect(entry['openAccountId'], account);
      expect(entry['openAccountTableId'], destination);
    },
  );

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

  test(
    'detaching a second account restores the paid visit without releasing it',
    () async {
      final cloud = _Cloud(
        _room(
          'served',
          seatedAt: '2026-10-18T09:00:00.000Z',
          partySize: 2,
          paidAt: '2026-10-18T09:10:00.000Z',
          openAccountId: _uuid(55),
          openAccountFolio: '003',
        ),
      );
      final repository = _repository(_MemoryLocal(), cloud);
      final controller = TableStateController(repository);
      addTearDown(controller.dispose);
      await controller.load(_merchant, _location, _operator);
      cloud.fail = true;
      await controller.releaseAccount(_uuid(55));
      expect(controller.isPaidAndOccupied(_table), isTrue);
      expect(controller.partyPresent(_table), isTrue);
      final cached = await repository.read(_merchant, _query());
      expect(cached.states.single['openAccountId'], isNull);
      expect(cached.states.single['paidAt'], '2026-10-18T09:10:00.000Z');
      expect(cached.states.single['seatedAt'], '2026-10-18T09:00:00.000Z');
    },
  );
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
  String? paidAt,
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
      'paidAt': paidAt,
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
  TableStateChangeResult? reply;

  @override
  Future<TableStateChangeResult> markServed(
    String merchantId,
    MarkTableServedRequest request,
  ) async {
    if (reply case final result?) return result;
    throw StateError('offline');
  }

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
  bool failWrites = false;

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
    if (failWrites) throw StateError('storage unavailable');
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
