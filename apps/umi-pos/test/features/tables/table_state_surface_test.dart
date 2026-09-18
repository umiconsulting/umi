import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/features/entry/entry_controller.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';
import 'package:umi_pos/features/tables/floor_plan_controller.dart';
import 'package:umi_pos/features/tables/floor_plan_surface.dart';
import 'package:umi_pos/features/tables/table_state_controller.dart';
import 'package:umi_pos/features/tables/table_state_repository.dart';

import '../../support/fakes.dart';

const merchantId = 'merchant';
const locationId = 'location';
const operatorSessionId = 'operator';
const t1 = '00000000-0000-4000-8000-000000000001';
const t2 = '00000000-0000-4000-8000-000000000002';
const groupId = '00000000-0000-4000-8000-0000000000ff';
const serverClock = '2026-09-16T18:00:00.000Z';

class SessionGateway implements EntryGateway {
  @override
  Future<OperatorSessionView> startOperator(
    String merchantId,
    String locationId,
  ) async => OperatorSessionView(
    id: operatorSessionId,
    userId: 'user',
    staffId: 'staff',
    merchantId: merchantId,
    locationId: locationId,
    deviceId: 'device',
    state: 'active',
    permissions: const ['sale.lifecycle'],
    entitlements: const [],
    startedAt: '2026-09-13T00:00:00Z',
    lastActivityAt: '2026-09-13T00:00:00Z',
    expiresAt: '2026-09-14T00:00:00Z',
  );
  @override
  Future<void> lockOperator(String id) async {}
  @override
  Future<void> logout() async {}
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

/// The published layout: two tables, one of them big enough for four.
class PlanRepository implements FloorPlanRepository {
  @override
  Future<PublishedFloorPlan> load(
    String merchantId,
    PosFloorPlanQuery query,
  ) async => PublishedFloorPlan.fromJson({
    'locationId': locationId,
    'publishedVersion': 1,
    'publishedAt': '2026-09-13T00:00:00Z',
    'published': {
      'schemaVersion': 1,
      'areas': [
        {
          'id': 'dining',
          'name': 'Dining room',
          'width': 1200,
          'height': 800,
          'elements': [
            {
              'id': t1,
              'kind': 'table',
              'shape': 'round',
              'label': 'T1',
              'capacity': 4,
              'x': 300,
              'y': 300,
              'width': 200,
              'height': 200,
              'rotation': 0,
            },
            {
              'id': t2,
              'kind': 'table',
              'shape': 'square',
              'label': 'T2',
              'capacity': 2,
              'x': 800,
              'y': 300,
              'width': 180,
              'height': 180,
              'rotation': 0,
            },
          ],
        },
      ],
    },
  });
}

Map<String, Object?> entryJson(
  String tableId,
  String state, {
  String? seatedAt,
  int? partySize,
  String? group,
}) => {
  'tableId': tableId,
  'state': state,
  'seatedAt': seatedAt,
  'partySize': partySize,
  'groupId': group,
};

final class RoomRepository implements TableStateRepository {
  RoomRepository({List<Map<String, Object?>> states = const []})
    : map = TableStateMap(
        locationId: locationId,
        serverTime: serverClock,
        states: states,
      );

  TableStateMap map;
  Object? commandFailure;
  SeatTableRequest? seated;
  MovePartyRequest? moved;
  MergeTablesRequest? merged;
  SplitPartyRequest? splitRequest;
  ClearTableRequest? cleared;
  MarkTableOrderedRequest? ordered;
  MarkTableServedRequest? served;
  MarkTableAwaitingPaymentRequest? awaitingPayment;

  @override
  Future<TableStateMap> read(String merchantId, PosTableStateQuery query) async =>
      map;

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
      // Two minutes ago on the server's clock, so the turn timer has something
      // to draw.
      seatedAt: '2026-09-16T17:58:00.000Z',
      partySize: request.partySize,
    );
    return _install([entry]);
  }

  @override
  Future<TableStateChangeResult> move(
    String merchantId,
    MovePartyRequest request,
  ) async {
    moved = request;
    _refuse();
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
    return _install([released, target]);
  }

  @override
  Future<TableStateChangeResult> merge(
    String merchantId,
    MergeTablesRequest request,
  ) async {
    merged = request;
    _refuse();
    final entries = [
      for (final id in request.tableIds)
        entryJson(
          id,
          tableStateSeated,
          seatedAt: serverClock,
          partySize: request.partySize,
          group: groupId,
        ),
    ];
    return _install(entries);
  }

  @override
  Future<TableStateChangeResult> split(
    String merchantId,
    SplitPartyRequest request,
  ) async {
    splitRequest = request;
    _refuse();
    final entries = [
      entryJson(
        request.tableId,
        tableStateSeated,
        seatedAt: serverClock,
        partySize: 4,
      ),
      entryJson(t2, tableStateDirty),
    ];
    return _install(entries);
  }

  @override
  Future<TableStateChangeResult> clear(
    String merchantId,
    ClearTableRequest request,
  ) async {
    cleared = request;
    _refuse();
    return _install([entryJson(request.tableId, tableStateDirty)]);
  }

  @override
  Future<TableStateChangeResult> markReady(
    String merchantId,
    OpenTableRequest request,
  ) async => _install([entryJson(request.tableId, tableStateOpen)]);

  @override
  Future<TableStateChangeResult> markOrdered(
    String merchantId,
    MarkTableOrderedRequest request,
  ) async {
    ordered = request;
    _refuse();
    return _install([_restate(request.tableId, tableStateOrdered)]);
  }

  @override
  Future<TableStateChangeResult> markServed(
    String merchantId,
    MarkTableServedRequest request,
  ) async {
    served = request;
    _refuse();
    return _install([_restate(request.tableId, tableStateServed)]);
  }

  @override
  Future<TableStateChangeResult> markAwaitingPayment(
    String merchantId,
    MarkTableAwaitingPaymentRequest request,
  ) async {
    awaitingPayment = request;
    _refuse();
    return _install([_restate(request.tableId, tableStateAwaitingPayment)]);
  }

  /// The server changes the state column and nothing else: the turn timer and
  /// the party come back as they went in.
  Map<String, Object?> _restate(String tableId, String state) {
    final current = map.states.firstWhere(
      (item) => item['tableId'] == tableId,
      orElse: () => entryJson(tableId, tableStateOpen),
    );
    return entryJson(
      tableId,
      state,
      seatedAt: current['seatedAt'] as String?,
      partySize: current['partySize'] as int?,
      group: current['groupId'] as String?,
    );
  }

  void _refuse() {
    final failure = commandFailure;
    if (failure == null) return;
    commandFailure = null;
    throw failure;
  }

  TableStateChangeResult _install(List<Map<String, Object?>> changed) {
    final merged = <String, Map<String, Object?>>{
      for (final state in map.states) state['tableId']! as String: state,
    };
    for (final state in changed) {
      merged[state['tableId']! as String] = state;
    }
    map = TableStateMap(
      locationId: locationId,
      serverTime: serverClock,
      states: merged.values.toList(),
    );
    return TableStateChangeResult(
      locationId: locationId,
      commandId: '00000000-0000-4000-8000-0000000000c0',
      changed: changed,
      serverTime: serverClock,
    );
  }
}

Future<EntryController> readyEntryController() async {
  final entry = EntryController(
    gateway: SessionGateway(),
    vault: CredentialVault(MemorySecureStorage()),
    telemetry: SafeTelemetry(
      enabled: false,
      context: TelemetryContext.current(testConfig),
      exporter: RecordingExporter(),
    ),
    idleTimeout: const Duration(seconds: 30),
  );
  await entry.selectTenant(
    EntryMerchant.fromJson({
      'id': merchantId,
      'name': 'Test cafe',
      'roles': [],
      'permissions': [],
      'entitlements': [],
      'locations': [
        {
          'id': locationId,
          'merchantId': merchantId,
          'name': 'Test location',
          'status': 'active',
          'deviceAllowed': true,
          'operatorAllowed': true,
        },
      ],
    }),
  );
  return entry;
}

final class SurfaceHarness {
  SurfaceHarness({
    required this.entry,
    required this.room,
    required this.plan,
    required this.tableState,
  });

  final EntryController entry;
  final RoomRepository room;
  final FloorPlanController plan;
  final TableStateController tableState;

  Future<void> dispose(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    plan.dispose();
    tableState.dispose();
    entry.dispose();
  }
}

Future<SurfaceHarness> pumpSurface(
  WidgetTester tester, {
  RoomRepository? repository,
}) async {
  final entry = await readyEntryController();
  final room = repository ?? RoomRepository();
  final plan = FloorPlanController(PlanRepository());
  final tableState = TableStateController(
    room,
    clock: () => DateTime.parse(serverClock),
  );
  late BuildContext entryContext;
  await tester.pumpWidget(
    MaterialApp(
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Builder(
        builder: (context) {
          entryContext = context;
          return const Scaffold(body: Text('Catalog'));
        },
      ),
    ),
  );
  unawaited(
    showFloorPlan(
      entryContext,
      controller: plan,
      entry: entry,
      tableState: tableState,
    ),
  );
  await tester.pumpAndSettle();
  return SurfaceHarness(
    entry: entry,
    room: room,
    plan: plan,
    tableState: tableState,
  );
}

void main() {
  testWidgets('a free table can start a party (defect D27)', (tester) async {
    final harness = await pumpSurface(tester);
    expect(find.text('T1'), findsOneWidget);
    await tester.tap(find.text('T1'));
    await tester.pumpAndSettle();
    // The sheet used to offer nothing but "Close".
    expect(find.text('Seat'), findsOneWidget);
    await tester.tap(find.text('Seat'));
    await tester.pumpAndSettle();
    expect(find.text('Seat table T1'), findsOneWidget);
    await tester.tap(find.text('Confirm'));
    await tester.pumpAndSettle();
    final request = harness.room.seated!;
    expect(request.tableId, t1);
    expect(request.partySize, 2);
    expect(request.locationId, locationId);
    expect(request.operatorSessionId, operatorSessionId);
    expect(request.idempotencyKey.length, 36);
    expect(tester.takeException(), isNull);
    await harness.dispose(tester);
  });

  testWidgets('a seated table draws its state, a filled marker and a timer', (
    tester,
  ) async {
    final harness = await pumpSurface(
      tester,
      repository: RoomRepository(
        states: [
          entryJson(
            t1,
            tableStateSeated,
            seatedAt: '2026-09-16T17:58:00.000Z',
            partySize: 2,
          ),
        ],
      ),
    );
    // The turn timer, from the server's clock rather than the device's.
    expect(find.text('2 min'), findsOneWidget);
    // The state is carried by a glyph as well as by colour.
    expect(find.byIcon(Icons.event_seat), findsOneWidget);
    final dots = tester.widgetList<FloorPlanSeatDots>(
      find.byType(FloorPlanSeatDots),
    );
    expect(dots.any((dots) => dots.filled), isTrue);
    expect(tester.takeException(), isNull);
    await harness.dispose(tester);
  });

  testWidgets('a dirty table is marked for clearing, and can be made ready', (
    tester,
  ) async {
    final harness = await pumpSurface(
      tester,
      repository: RoomRepository(
        states: [entryJson(t1, tableStateDirty)],
      ),
    );
    expect(find.byIcon(Icons.cleaning_services), findsOneWidget);
    await tester.tap(find.text('T1'));
    await tester.pumpAndSettle();
    expect(find.text('Needs cleaning'), findsOneWidget);
    await tester.tap(find.text('Mark ready'));
    await tester.pumpAndSettle();
    expect(harness.room.map.states.first['state'], tableStateOpen);
    expect(tester.takeException(), isNull);
    await harness.dispose(tester);
  });

  testWidgets('two free tables merge into one bounded region, and split', (
    tester,
  ) async {
    final harness = await pumpSurface(tester);
    await tester.tap(find.text('T1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Select'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('T2'));
    await tester.pumpAndSettle();
    expect(find.text('2 selected'), findsOneWidget);
    await tester.tap(find.text('Merge'));
    await tester.pumpAndSettle();
    expect(find.text('Merge tables'), findsOneWidget);
    await tester.tap(find.text('Confirm'));
    await tester.pumpAndSettle();
    expect(harness.room.merged!.tableIds, [t1, t2]);
    expect(harness.room.merged!.partySize, 6);
    // One party is one bounded region, named by the server's group id.
    expect(find.byKey(const ValueKey('floor-plan-group-$groupId')), findsOneWidget);
    // And the group can be dissolved from the same table.
    await tester.tap(find.text('T1'));
    await tester.pumpAndSettle();
    expect(find.text('Split'), findsOneWidget);
    await tester.tap(find.text('Split'));
    await tester.pumpAndSettle();
    expect(harness.room.splitRequest!.tableId, t1);
    expect(tester.takeException(), isNull);
    await harness.dispose(tester);
  });

  testWidgets('moving a party keeps its timer and frees the old table', (
    tester,
  ) async {
    final harness = await pumpSurface(
      tester,
      repository: RoomRepository(
        states: [
          entryJson(
            t1,
            tableStateSeated,
            seatedAt: '2026-09-16T17:30:00.000Z',
            partySize: 2,
          ),
        ],
      ),
    );
    await tester.tap(find.text('T1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Move'));
    await tester.pumpAndSettle();
    expect(find.text('Moving T1. Tap a free table.'), findsOneWidget);
    await tester.tap(find.text('T2'));
    await tester.pumpAndSettle();
    expect(harness.room.moved!.fromTableId, t1);
    expect(harness.room.moved!.toTableId, t2);
    // The origin did not restart: the destination inherits the seated time.
    expect(
      harness.tableState.stateOf(t2).seatedAt,
      '2026-09-16T17:30:00.000Z',
    );
    expect(harness.tableState.elapsedOf(t2), const Duration(minutes: 30));
    expect(tester.takeException(), isNull);
    await harness.dispose(tester);
  });

  testWidgets('a table with a party offers the three service actions', (
    tester,
  ) async {
    final harness = await pumpSurface(
      tester,
      repository: RoomRepository(
        states: [
          entryJson(
            t1,
            tableStateSeated,
            seatedAt: '2026-09-16T17:58:00.000Z',
            partySize: 2,
          ),
        ],
      ),
    );
    await tester.tap(find.text('T1'));
    await tester.pumpAndSettle();
    // The three states the surface could draw but never set.
    expect(find.text('Order sent'), findsOneWidget);
    expect(find.text('Mark served'), findsOneWidget);
    expect(find.text('Bill requested'), findsOneWidget);

    await tester.tap(find.text('Order sent'));
    await tester.pumpAndSettle();
    expect(harness.room.ordered!.tableId, t1);
    expect(harness.room.ordered!.locationId, locationId);
    expect(harness.room.ordered!.operatorSessionId, operatorSessionId);
    expect(harness.room.ordered!.idempotencyKey.length, 36);
    expect(harness.tableState.stateOf(t1).state, tableStateOrdered);

    // No fixed sequence: ordered straight on to served. The action is worded
    // apart from the state heading, so a tap cannot hit the wrong one.
    await tester.tap(find.text('T1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mark served'));
    await tester.pumpAndSettle();
    expect(harness.room.served!.tableId, t1);
    expect(harness.tableState.stateOf(t1).state, tableStateServed);

    await tester.tap(find.text('T1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Bill requested'));
    await tester.pumpAndSettle();
    expect(harness.room.awaitingPayment!.tableId, t1);
    expect(harness.tableState.stateOf(t1).state, tableStateAwaitingPayment);
    // The turn clock ran through all three untouched.
    expect(harness.tableState.elapsedOf(t1), const Duration(minutes: 2));
    expect(tester.takeException(), isNull);
    await harness.dispose(tester);
  });

  testWidgets('a target too small refuses locally with a recovery to read', (
    tester,
  ) async {
    final harness = await pumpSurface(
      tester,
      repository: RoomRepository(
        states: [
          entryJson(
            t1,
            tableStateSeated,
            seatedAt: '2026-09-16T17:30:00.000Z',
            partySize: 4,
          ),
        ],
      ),
    );
    await tester.tap(find.text('T1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Move'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('T2'));
    await tester.pumpAndSettle();
    expect(harness.room.moved, isNull);
    expect(find.text('That table cannot seat 4 guests.'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await harness.dispose(tester);
  });

  testWidgets('a server refusal shows a typed message with a recovery action', (
    tester,
  ) async {
    final harness = await pumpSurface(tester);
    harness.room.commandFailure = const AppException(
      category: AppErrorCategory.conflict,
      code: 'TABLE_ALREADY_OCCUPIED',
      recoverable: false,
    );
    await tester.tap(find.text('T1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Seat'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Confirm'));
    await tester.pumpAndSettle();
    expect(find.textContaining('already has a party'), findsWidgets);
    expect(find.textContaining('Pick another table'), findsOneWidget);
    expect(find.text('Refresh map'), findsOneWidget);
    // The surface is not wedged by the refusal.
    expect(harness.tableState.busy, isFalse);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    expect(harness.tableState.errorCode, isNull);
    expect(tester.takeException(), isNull);
    await harness.dispose(tester);
  });
}
