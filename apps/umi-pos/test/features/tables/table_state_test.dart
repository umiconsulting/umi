import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations_en.dart';
import 'package:umi_pos/core/localization/app_localizations_es.dart';
import 'package:umi_pos/features/tables/floor_plan_surface.dart';
import 'package:umi_pos/features/tables/table_state_controller.dart';
import 'package:umi_pos/features/tables/table_state_repository.dart';

const merchantId = 'merchant';
const locationId = 'location';
const operatorSessionId = 'operator';
const t1 = '00000000-0000-4000-8000-000000000001';
const t2 = '00000000-0000-4000-8000-000000000002';
const t3 = '00000000-0000-4000-8000-000000000003';
const serverClock = '2026-09-16T18:00:00.000Z';

Map<String, Object?> entryJson(
  String tableId,
  String state, {
  String? seatedAt,
  int? partySize,
  String? groupId,
}) => {
  'tableId': tableId,
  'state': state,
  'seatedAt': seatedAt,
  'partySize': partySize,
  'groupId': groupId,
};

TableStateMap room(List<Map<String, Object?>> states, {String? at}) =>
    TableStateMap(
      locationId: locationId,
      serverTime: at ?? serverClock,
      states: states,
    );

final class _FakeTableStateRepository implements TableStateRepository {
  TableStateMap map = room(const []);
  int reads = 0;
  Object? readFailure;
  Object? commandFailure;

  SeatTableRequest? seated;
  MovePartyRequest? moved;
  MergeTablesRequest? merged;
  SplitPartyRequest? splitRequest;
  ClearTableRequest? cleared;
  OpenTableRequest? opened;
  MarkTableOrderedRequest? ordered;
  MarkTableServedRequest? served;
  MarkTableAwaitingPaymentRequest? awaitingPayment;

  @override
  Future<TableStateMap> read(String merchantId, PosTableStateQuery query) async {
    reads += 1;
    final failure = readFailure;
    if (failure != null) throw failure;
    return map;
  }

  @override
  Future<TableStateChangeResult> seat(
    String merchantId,
    SeatTableRequest request,
  ) async {
    seated = request;
    _refuse();
    final entry = entryJson(
      request.tableId,
      tableStateSeated,
      seatedAt: serverClock,
      partySize: request.partySize,
    );
    _replace([entry]);
    return _change([entry]);
  }

  @override
  Future<TableStateChangeResult> move(
    String merchantId,
    MovePartyRequest request,
  ) async {
    moved = request;
    _refuse();
    // The server carries `seated_at` and `party_size` across verbatim: a move
    // cannot restart the turn timer.
    final source = map.states.firstWhere(
      (state) => state['tableId'] == request.fromTableId,
    );
    final released = entryJson(request.fromTableId, tableStateOpen);
    final target = entryJson(
      request.toTableId,
      tableStateSeated,
      seatedAt: source['seatedAt'] as String?,
      partySize: source['partySize'] as int?,
    );
    _replace([released, target]);
    return _change([released, target]);
  }

  @override
  Future<TableStateChangeResult> merge(
    String merchantId,
    MergeTablesRequest request,
  ) async {
    merged = request;
    _refuse();
    final groupId = '00000000-0000-4000-8000-0000000000ff';
    final entries = [
      for (final id in request.tableIds)
        entryJson(
          id,
          tableStateSeated,
          seatedAt: serverClock,
          partySize: request.partySize,
          groupId: groupId,
        ),
    ];
    _replace(entries);
    return _change(entries);
  }

  @override
  Future<TableStateChangeResult> split(
    String merchantId,
    SplitPartyRequest request,
  ) async {
    splitRequest = request;
    _refuse();
    final group = map.states
        .where(
          (state) =>
              state['groupId'] != null &&
              state['groupId'] ==
                  map.states
                      .firstWhere(
                        (item) => item['tableId'] == request.tableId,
                      )['groupId'],
        )
        .toList();
    final entries = [
      for (final state in group)
        state['tableId'] == request.tableId
            ? entryJson(
                request.tableId,
                tableStateSeated,
                seatedAt: state['seatedAt'] as String?,
                partySize: state['partySize'] as int?,
              )
            : entryJson(state['tableId']! as String, tableStateDirty),
    ];
    _replace(entries);
    return _change(entries);
  }

  @override
  Future<TableStateChangeResult> clear(
    String merchantId,
    ClearTableRequest request,
  ) async {
    cleared = request;
    _refuse();
    final entry = entryJson(request.tableId, tableStateDirty);
    _replace([entry]);
    return _change([entry]);
  }

  @override
  Future<TableStateChangeResult> markReady(
    String merchantId,
    OpenTableRequest request,
  ) async {
    opened = request;
    _refuse();
    final entry = entryJson(request.tableId, tableStateOpen);
    _replace([entry]);
    return _change([entry]);
  }

  @override
  Future<TableStateChangeResult> markOrdered(
    String merchantId,
    MarkTableOrderedRequest request,
  ) async {
    ordered = request;
    _refuse();
    return _restate(request.tableId, tableStateOrdered);
  }

  @override
  Future<TableStateChangeResult> markServed(
    String merchantId,
    MarkTableServedRequest request,
  ) async {
    served = request;
    _refuse();
    return _restate(request.tableId, tableStateServed);
  }

  @override
  Future<TableStateChangeResult> markAwaitingPayment(
    String merchantId,
    MarkTableAwaitingPaymentRequest request,
  ) async {
    awaitingPayment = request;
    _refuse();
    return _restate(request.tableId, tableStateAwaitingPayment);
  }

  /// The three service commands move the state column alone: the turn timer and
  /// the party identity come back exactly as they went in.
  TableStateChangeResult _restate(String tableId, String state) {
    final current = map.states.firstWhere(
      (item) => item['tableId'] == tableId,
      orElse: () => entryJson(tableId, tableStateOpen),
    );
    final entry = entryJson(
      tableId,
      state,
      seatedAt: current['seatedAt'] as String?,
      partySize: current['partySize'] as int?,
      groupId: current['groupId'] as String?,
    );
    _replace([entry]);
    return _change([entry]);
  }

  void _refuse() {
    final failure = commandFailure;
    if (failure == null) return;
    commandFailure = null;
    throw failure;
  }

  void _replace(List<Map<String, Object?>> changed) {
    final merged = <String, Map<String, Object?>>{
      for (final state in map.states) state['tableId']! as String: state,
    };
    for (final state in changed) {
      merged[state['tableId']! as String] = state;
    }
    map = room(merged.values.toList());
  }

  TableStateChangeResult _change(List<Map<String, Object?>> changed) =>
      TableStateChangeResult(
        locationId: locationId,
        commandId: '00000000-0000-4000-8000-0000000000c0',
        changed: changed,
        serverTime: serverClock,
      );
}

void main() {
  late _FakeTableStateRepository repository;
  late TableStateController controller;

  setUp(() async {
    repository = _FakeTableStateRepository();
    // A device clock pinned to the server's own instant, so every turn time in
    // these tests is exact.
    controller = TableStateController(
      repository,
      clock: () => DateTime.parse(serverClock),
    );
    await controller.load(merchantId, locationId, operatorSessionId);
  });

  tearDown(() => controller.dispose());

  test('a table the room has never seen is open, not unknown', () async {
    expect(controller.map, isNotNull);
    final entry = controller.stateOf(t1);
    expect(entry.state, tableStateOpen);
    expect(entry.seatedAt, isNull);
    expect(entry.groupId, isNull);
    expect(tableIsFree(entry.state), isTrue);
    expect(controller.partyPresent(t1), isFalse);
  });

  test('seating a party carries the session and a fresh idempotency key', () async {
    final readsBefore = repository.reads;
    expect(await controller.seat(t1, 4), isTrue);
    final request = repository.seated!;
    expect(request.tableId, t1);
    expect(request.partySize, 4);
    expect(request.locationId, locationId);
    expect(request.operatorSessionId, operatorSessionId);
    expect(request.idempotencyKey.length, 36);
    expect(request.idempotencyKey[14], '4');
    // Every write is followed by a read of the room.
    expect(repository.reads, greaterThan(readsBefore));
    expect(controller.stateOf(t1).state, tableStateSeated);
    expect(controller.partyPresent(t1), isTrue);
    expect(controller.busy, isFalse);
    expect(controller.errorCode, isNull);
  });

  test('two commands never reuse one idempotency key', () async {
    await controller.seat(t1, 2);
    final first = repository.seated!.idempotencyKey;
    await controller.seat(t2, 2);
    final second = repository.seated!.idempotencyKey;
    expect(second, isNot(first));
    await controller.markReady(t1);
    expect(repository.opened!.idempotencyKey, isNot(first));
    expect(repository.opened!.idempotencyKey, isNot(second));
  });

  test('a move keeps the turn timer: the origin does not restart', () async {
    final seatedAt = '2026-09-16T17:30:00.000Z';
    repository.map = room([
      entryJson(t1, tableStateSeated, seatedAt: seatedAt, partySize: 4),
    ]);
    await controller.load(merchantId, locationId, operatorSessionId);
    expect(controller.elapsedOf(t1), const Duration(minutes: 30));
    expect(controller.stateOf(t1).seatedAt, seatedAt);

    expect(await controller.move(fromTableId: t1, toTableId: t2), isTrue);
    expect(repository.moved!.fromTableId, t1);
    expect(repository.moved!.toTableId, t2);
    expect(repository.moved!.locationId, locationId);
    expect(repository.moved!.operatorSessionId, operatorSessionId);
    // The party arrived with the clock it left with, and the seat it left is free.
    expect(controller.stateOf(t2).seatedAt, seatedAt);
    expect(controller.elapsedOf(t2), const Duration(minutes: 30));
    expect(controller.stateOf(t1).state, tableStateOpen);
    expect(controller.partyPresent(t1), isFalse);
  });

  test('a merge writes every selected table with one group and a party size', () async {
    expect(
      await controller.merge(tableIds: [t1, t2, t3], partySize: 6),
      isTrue,
    );
    expect(repository.merged!.tableIds, [t1, t2, t3]);
    expect(repository.merged!.partySize, 6);
    final group = controller.stateOf(t1).groupId;
    expect(group, isNotNull);
    expect(controller.stateOf(t2).groupId, group);
    expect(controller.group(group!).length, 3);
  });

  test('a split keeps the party on the named table and dirties the rest', () async {
    await controller.merge(tableIds: [t1, t2], partySize: 4);
    expect(await controller.split(t1), isTrue);
    expect(repository.splitRequest!.tableId, t1);
    expect(controller.stateOf(t1).state, tableStateSeated);
    expect(controller.stateOf(t1).groupId, isNull);
    expect(controller.stateOf(t2).state, tableStateDirty);
    expect(controller.partyPresent(t2), isFalse);
  });

  test('clearing a table marks it dirty and marking it ready opens it', () async {
    await controller.seat(t1, 2);
    expect(await controller.clearTable(t1), isTrue);
    expect(repository.cleared!.tableId, t1);
    expect(repository.cleared!.operatorSessionId, operatorSessionId);
    expect(controller.stateOf(t1).state, tableStateDirty);
    expect(tableIsFree(controller.stateOf(t1).state), isTrue);
    expect(await controller.markReady(t1), isTrue);
    expect(repository.opened!.tableId, t1);
    expect(controller.stateOf(t1).state, tableStateOpen);
  });

  test('marking a table ordered sends the food-in state and draws it', () async {
    await controller.seat(t1, 2);
    final readsBefore = repository.reads;
    expect(await controller.markOrdered(t1), isTrue);
    final request = repository.ordered!;
    expect(request.tableId, t1);
    expect(request.locationId, locationId);
    expect(request.operatorSessionId, operatorSessionId);
    expect(request.idempotencyKey.length, 36);
    expect(request.idempotencyKey[14], '4');
    // Every write is followed by a read of the room.
    expect(repository.reads, greaterThan(readsBefore));
    expect(controller.stateOf(t1).state, tableStateOrdered);
    expect(controller.partyPresent(t1), isTrue);
    expect(controller.busy, isFalse);
    expect(controller.errorCode, isNull);
  });

  test('marking a table served sends the food-out state and draws it', () async {
    await controller.seat(t1, 2);
    expect(await controller.markServed(t1), isTrue);
    final request = repository.served!;
    expect(request.tableId, t1);
    expect(request.locationId, locationId);
    expect(request.operatorSessionId, operatorSessionId);
    expect(request.idempotencyKey.length, 36);
    expect(controller.stateOf(t1).state, tableStateServed);
    expect(controller.partyPresent(t1), isTrue);
    expect(controller.busy, isFalse);
    expect(controller.errorCode, isNull);
  });

  test('asking for the bill sends the awaiting-payment state', () async {
    await controller.seat(t1, 4);
    expect(await controller.markAwaitingPayment(t1), isTrue);
    final request = repository.awaitingPayment!;
    expect(request.tableId, t1);
    expect(request.locationId, locationId);
    expect(request.operatorSessionId, operatorSessionId);
    expect(request.idempotencyKey.length, 36);
    expect(controller.stateOf(t1).state, tableStateAwaitingPayment);
    expect(controller.partyPresent(t1), isTrue);
    expect(controller.busy, isFalse);
    expect(controller.errorCode, isNull);
  });

  test('any party-present state can reach any of the three', () async {
    final seatedAt = '2026-09-16T17:30:00.000Z';
    repository.map = room([
      entryJson(t1, tableStateServed, seatedAt: seatedAt, partySize: 3),
    ]);
    await controller.load(merchantId, locationId, operatorSessionId);
    // Served straight back to ordered, then to the bill: no fixed sequence.
    expect(await controller.markOrdered(t1), isTrue);
    expect(controller.stateOf(t1).state, tableStateOrdered);
    expect(await controller.markAwaitingPayment(t1), isTrue);
    expect(controller.stateOf(t1).state, tableStateAwaitingPayment);
    // None of them moved the turn clock or the party.
    expect(controller.stateOf(t1).seatedAt, seatedAt);
    expect(controller.stateOf(t1).partySize, 3);
    expect(controller.elapsedOf(t1), const Duration(minutes: 30));
    // And each command carried its own fresh key.
    expect(
      repository.ordered!.idempotencyKey,
      isNot(repository.awaitingPayment!.idempotencyKey),
    );
  });

  test('a service command with no party on the table is refused by name', () async {
    repository.commandFailure = const AppException(
      category: AppErrorCategory.conflict,
      code: 'TABLE_NOT_OCCUPIED',
      recoverable: false,
    );
    expect(await controller.markServed(t1), isFalse);
    expect(controller.errorCode, 'TABLE_NOT_OCCUPIED');
    expect(controller.stateOf(t1).state, tableStateOpen);
    expect(controller.busy, isFalse);
  });

  test('an AppException refusal is kept as a typed code', () async {
    repository.commandFailure = const AppException(
      category: AppErrorCategory.conflict,
      code: 'TABLE_ALREADY_OCCUPIED',
      recoverable: false,
    );
    expect(await controller.seat(t1, 2), isFalse);
    expect(controller.errorCode, 'TABLE_ALREADY_OCCUPIED');
    expect(controller.busy, isFalse);
    controller.dismissError();
    expect(controller.errorCode, isNull);
  });

  test('a failure that is not an AppException still releases the surface', () async {
    repository.commandFailure = const FormatException('a bigint arrived as text');
    expect(await controller.seat(t1, 2), isFalse);
    expect(controller.busy, isFalse);
    expect(controller.errorCode, 'TABLE_OPERATION_FAILED');
    // And the surface can still take the next command.
    expect(await controller.seat(t1, 2), isTrue);
    expect(controller.errorCode, isNull);
  });

  test('a failed read keeps the last room and says it is stale', () async {
    await controller.seat(t1, 2);
    repository.readFailure = Exception('offline');
    await controller.load(merchantId, locationId, operatorSessionId);
    expect(controller.stale, isTrue);
    expect(controller.stateOf(t1).state, tableStateSeated);
    repository.readFailure = null;
    await controller.load(merchantId, locationId, operatorSessionId);
    expect(controller.stale, isFalse);
  });

  test('the turn timer follows the server clock, not the device clock', () async {
    var deviceNow = DateTime.parse('2019-01-01T00:00:00Z');
    final anchored = TableStateController(repository, clock: () => deviceNow);
    repository.map = room(
      [
        entryJson(
          t1,
          tableStateSeated,
          seatedAt: '2026-09-16T17:30:00.000Z',
          partySize: 2,
        ),
      ],
      at: serverClock,
    );
    await anchored.load(merchantId, locationId, operatorSessionId);
    // The device believes it is 2019; the room says the party sat down 30
    // minutes ago, and that is what the surface must draw.
    expect(anchored.elapsedOf(t1), const Duration(minutes: 30));
    deviceNow = deviceNow.add(const Duration(minutes: 5));
    expect(anchored.elapsedOf(t1), const Duration(minutes: 35));
    anchored.dispose();
  });

  test('the six states are the contract values and nothing else', () {
    expect(tablePartyStates, {
      'seated',
      'ordered',
      'served',
      'awaiting_payment',
    });
    expect(
      [
        tableStateOpen,
        tableStateSeated,
        tableStateOrdered,
        tableStateServed,
        tableStateAwaitingPayment,
        tableStateDirty,
      ],
      ['open', 'seated', 'ordered', 'served', 'awaiting_payment', 'dirty'],
    );
    for (final state in [
      tableStateOpen,
      tableStateSeated,
      tableStateOrdered,
      tableStateServed,
      tableStateAwaitingPayment,
      tableStateDirty,
    ]) {
      expect(tableStateGlyph(state), isNotNull);
    }
  });

  test('every failure code becomes a typed message with a recovery action', () {
    final spanish = AppLocalizationsEs();
    final english = AppLocalizationsEn();
    const codes = [
      'TABLE_ALREADY_OCCUPIED',
      'TABLE_CAPACITY_EXCEEDED',
      'TABLE_NOT_OCCUPIED',
      'TABLE_NOT_GROUPED',
      'TABLE_NOT_IN_PLAN',
      'IDEMPOTENCY_CONFLICT',
      'PERMISSION_DENIED',
      'FLOOR_PLAN_NOT_PUBLISHED',
      'SOMETHING_THE_SERVER_LEARNED_LATER',
    ];
    final messages = <String>{};
    for (final code in codes) {
      for (final l10n in [spanish, english]) {
        final failure = describeTableStateFailure(code, l10n);
        expect(failure.title, isNotEmpty);
        expect(failure.message, isNotEmpty);
        expect(failure.recovery, isNotEmpty);
      }
      messages.add(describeTableStateFailure(code, english).message);
    }
    // The known codes are distinct, and only the unknown one shares a message.
    expect(messages.length, codes.length);
    expect(
      describeTableStateFailure(
        'TABLE_ALREADY_OCCUPIED',
        spanish,
      ).message,
      isNot(describeTableStateFailure('TABLE_ALREADY_OCCUPIED', english).message),
    );
    expect(
      describeTableStateFailure('TABLE_NOT_OCCUPIED', english).recovery,
      isNot(describeTableStateFailure('TABLE_NOT_GROUPED', english).recovery),
    );
  });

  test('a turn time reads as hours, minutes, or seconds', () {
    expect(formatTableTurn(const Duration(seconds: 45)), '45 s');
    expect(formatTableTurn(const Duration(minutes: 12)), '12 min');
    expect(formatTableTurn(const Duration(minutes: 65)), '1:05 h');
    expect(formatTableTurn(const Duration(seconds: -30)), '0 s');
  });
}
