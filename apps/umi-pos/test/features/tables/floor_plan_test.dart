import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/features/entry/entry_controller.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';
import 'package:umi_pos/features/tables/floor_plan_controller.dart';
import 'package:umi_pos/features/tables/floor_plan_surface.dart';

import '../../support/fakes.dart';

class SessionGateway implements EntryGateway {
  @override
  Future<OperatorSessionView> startOperator(
    String merchantId,
    String locationId,
  ) async => OperatorSessionView(
    id: 'operator',
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

class Repository implements FloorPlanRepository {
  final requests = <Completer<PublishedFloorPlan>>[];
  @override
  Future<PublishedFloorPlan> load(String merchantId, PosFloorPlanQuery query) {
    final request = Completer<PublishedFloorPlan>();
    requests.add(request);
    return request.future;
  }
}

PublishedFloorPlan plan(String location) => PublishedFloorPlan.fromJson({
  'locationId': location,
  'publishedVersion': 0,
  'published': null,
  'publishedAt': null,
});
PosFloorPlanQuery query(String location) => PosFloorPlanQuery.fromJson({
  'locationId': location,
  'operatorSessionId': 'operator',
});

FloorPlanArea areaFixture(
  String id,
  String name,
  List<Map<String, Object?>> elements,
) => FloorPlanArea.fromJson({
  'id': id,
  'name': name,
  'width': 1200,
  'height': 800,
  'elements': elements,
});

Map<String, Object?> tableElement({
  required String id,
  required String label,
  required int capacity,
  String kind = 'table',
  String shape = 'square',
  num x = 600,
  num y = 400,
  num width = 200,
  num height = 200,
  num rotation = 0,
}) => {
  'id': id,
  'kind': kind,
  'shape': shape,
  'label': label,
  'capacity': capacity,
  'x': x,
  'y': y,
  'width': width,
  'height': height,
  'rotation': rotation,
};

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
      'id': 'merchant',
      'name': 'Test café',
      'roles': [],
      'permissions': [],
      'entitlements': [],
      'locations': [
        {
          'id': 'location',
          'merchantId': 'merchant',
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

void main() {
  testWidgets(
    'idle lock closes the map and its table dialog and clears the layout',
    (tester) async {
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
          'id': 'merchant',
          'name': 'Test café',
          'roles': [],
          'permissions': [],
          'entitlements': [],
          'locations': [
            {
              'id': 'location',
              'merchantId': 'merchant',
              'name': 'Test location',
              'status': 'active',
              'deviceAllowed': true,
              'operatorAllowed': true,
            },
          ],
        }),
      );
      expect(entry.state.phase, EntryPhase.ready);
      final repository = Repository();
      final controller = FloorPlanController(repository);
      late BuildContext entryContext;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              entryContext = context;
              return AnimatedBuilder(
                animation: entry,
                builder: (_, _) => Scaffold(
                  body: Text(
                    entry.state.phase == EntryPhase.ready
                        ? 'Catalog'
                        : 'Operator PIN',
                  ),
                ),
              );
            },
          ),
        ),
      );
      final route = showFloorPlan(
        entryContext,
        controller: controller,
        entry: entry,
      );
      await tester.pump();
      repository.requests.single.complete(
        PublishedFloorPlan.fromJson({
          'locationId': 'location',
          'publishedVersion': 1,
          'publishedAt': '2026-09-13T00:00:00Z',
          'published': {
            'schemaVersion': 1,
            'areas': [
              {
                'id': 'area',
                'name': 'Dining room',
                'width': 1200,
                'height': 800,
                'elements': [
                  {
                    'id': 'table',
                    'kind': 'table',
                    'shape': 'round',
                    'label': 'T1',
                    'capacity': 4,
                    'x': 600,
                    'y': 400,
                    'width': 100,
                    'height': 100,
                    'rotation': 0,
                  },
                ],
              },
            ],
          },
        }),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('T1'));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);
      await tester.pump(const Duration(seconds: 31));
      await tester.pumpAndSettle();
      await route;
      expect(entry.state.phase, EntryPhase.pinRequired);
      expect(find.text('Operator PIN'), findsOneWidget);
      expect(find.byType(FloorPlanSurface), findsNothing);
      expect(find.byType(AlertDialog), findsNothing);
      expect(controller.plan, isNull);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      controller.dispose();
      entry.dispose();
    },
  );
  testWidgets('returns to entry when the operator context is missing', (
    tester,
  ) async {
    final root = testRoot();
    final repository = Repository();
    final controller = FloorPlanController(repository);
    late BuildContext entryContext;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            entryContext = context;
            return const Scaffold(body: Text('Operator PIN'));
          },
        ),
      ),
    );
    final route = showFloorPlan(
      entryContext,
      controller: controller,
      entry: root.entry,
    );
    await tester.pumpAndSettle();
    await route;
    expect(find.text('Operator PIN'), findsOneWidget);
    expect(find.byType(FloorPlanSurface), findsNothing);
    expect(repository.requests, isEmpty);
    expect(tester.takeException(), isNull);
    controller.dispose();
    root.dispose();
  });
  test(
    'ignores a response from a previous location and clears on logout',
    () async {
      final repo = Repository();
      final controller = FloorPlanController(repo);
      final first = controller.load('merchant', query('first'));
      final second = controller.load('merchant', query('second'));
      repo.requests[1].complete(plan('second'));
      await second;
      repo.requests[0].complete(plan('first'));
      await first;
      expect(controller.plan?.locationId, 'second');
      final pending = controller.load('merchant', query('second'));
      controller.clear();
      repo.requests[2].complete(plan('second'));
      await pending;
      expect(controller.plan, isNull);
      controller.dispose();
    },
  );
  test(
    'retains the last response on network failure and clears it on denied access',
    () async {
      final repo = Repository();
      final controller = FloorPlanController(repo);
      var pending = controller.load('merchant', query('first'));
      repo.requests.last.complete(plan('first'));
      await pending;
      pending = controller.load('merchant', query('first'));
      repo.requests.last.completeError(Exception('offline'));
      await pending;
      expect(controller.failed, isTrue);
      expect(controller.plan, isNotNull);
      pending = controller.load('merchant', query('first'));
      repo.requests.last.completeError(
        const AppException(
          category: AppErrorCategory.permission,
          code: 'PERMISSION_DENIED',
          recoverable: false,
        ),
      );
      await pending;
      expect(controller.plan, isNull);
      expect(controller.refreshedAt, isNull);
      controller.dispose();
    },
  );
  testWidgets(
    'renders a published table and returns its stable identity on tap',
    (tester) async {
      final area = FloorPlanArea.fromJson({
        'id': 'area',
        'name': 'Dining room',
        'width': 1200,
        'height': 800,
        'elements': [
          {
            'id': 'table',
            'kind': 'table',
            'shape': 'round',
            'label': 'T1',
            'capacity': 4,
            'x': 600,
            'y': 400,
            'width': 100,
            'height': 100,
            'rotation': 45,
          },
        ],
      });
      String? selected;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: FloorPlanMap(
              area: area,
              onTableTap: (element) => selected = element.id,
            ),
          ),
        ),
      );
      await tester.tap(find.text('T1'));
      expect(selected, 'table');
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('area selector lists each area with its table count', (
    tester,
  ) async {
    final areas = [
      areaFixture('dining', 'Dining room', [
        tableElement(id: 'a', label: '1', capacity: 4),
        tableElement(id: 'b', label: '2', capacity: 2, shape: 'round'),
      ]),
      areaFixture('terrace', 'Terrace', [
        tableElement(id: 'c', label: '3', capacity: 6),
        tableElement(
          id: 'bar',
          label: 'Bar',
          capacity: 0,
          kind: 'counter',
          shape: 'rectangle',
        ),
      ]),
    ];
    String? selected;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: FloorPlanAreaSelector(
            areas: areas,
            selectedAreaId: 'dining',
            onSelect: (id) => selected = id,
          ),
        ),
      ),
    );
    expect(find.text('Dining room'), findsOneWidget);
    expect(find.text('2 tables'), findsOneWidget);
    expect(find.text('Terrace'), findsOneWidget);
    // A counter is not a table.
    expect(find.text('1 table'), findsOneWidget);
    await tester.tap(find.text('Terrace'));
    expect(selected, 'terrace');
    expect(tester.takeException(), isNull);
  });
  testWidgets('area selector counts follow the active locale', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => Localizations.override(
              context: context,
              locale: const Locale('es'),
              child: FloorPlanAreaSelector(
                areas: [
                  areaFixture('dining', 'Salón', [
                    tableElement(id: 'a', label: '1', capacity: 4),
                    tableElement(id: 'b', label: '2', capacity: 2),
                  ]),
                ],
                selectedAreaId: 'dining',
                onSelect: (_) {},
              ),
            ),
          ),
        ),
      ),
    );
    expect(find.text('Salón'), findsOneWidget);
    expect(find.text('2 mesas'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('tables render a bold label, a divider, and seat dots', (
    tester,
  ) async {
    final area = areaFixture('dining', 'Dining room', [
      tableElement(
        id: 'big',
        label: 'T1',
        capacity: 4,
        shape: 'round',
        x: 300,
        width: 200,
        height: 200,
      ),
      // 40 px at this scale stays below the detail threshold.
      tableElement(
        id: 'tiny',
        label: 'T2',
        capacity: 2,
        x: 900,
        width: 40,
        height: 40,
      ),
    ]);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: FloorPlanMap(area: area, onTableTap: (_) {}),
        ),
      ),
    );
    expect(find.text('T1'), findsOneWidget);
    expect(
      tester.widget<Text>(find.text('T1')).style?.fontWeight,
      FontWeight.w700,
    );
    expect(
      find.byKey(const ValueKey('floor-plan-divider-big')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('floor-plan-seats-big')), findsOneWidget);
    expect(
      tester.widget<FloorPlanSeatDots>(find.byType(FloorPlanSeatDots)).count,
      4,
    );
    expect(
      tester
          .widget<Material>(
            find.byKey(const ValueKey('floor-plan-element-big')),
          )
          .shape,
      isA<CircleBorder>(),
    );
    expect(
      tester
          .widget<Material>(
            find.byKey(const ValueKey('floor-plan-element-big')),
          )
          .color,
      Colors.white,
    );
    expect(find.text('T2'), findsOneWidget);
    expect(find.byKey(const ValueKey('floor-plan-divider-tiny')), findsNothing);
    expect(find.byKey(const ValueKey('floor-plan-seats-tiny')), findsNothing);
    expect(tester.takeException(), isNull);
  });
  testWidgets('surface shows area tabs and switches the rendered area', (
    tester,
  ) async {
    final entry = await readyEntryController();
    expect(entry.state.phase, EntryPhase.ready);
    final repository = Repository();
    final controller = FloorPlanController(repository);
    late BuildContext entryContext;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            entryContext = context;
            return const Scaffold(body: Text('Catalog'));
          },
        ),
      ),
    );
    unawaited(
      showFloorPlan(entryContext, controller: controller, entry: entry),
    );
    await tester.pump();
    repository.requests.single.complete(
      PublishedFloorPlan.fromJson({
        'locationId': 'location',
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
                tableElement(id: 'a', label: 'T1', capacity: 4),
                tableElement(
                  id: 'b',
                  label: 'T2',
                  capacity: 2,
                  shape: 'round',
                  x: 300,
                  width: 200,
                  height: 200,
                ),
              ],
            },
            {
              'id': 'terrace',
              'name': 'Terrace',
              'width': 1200,
              'height': 800,
              'elements': [tableElement(id: 'c', label: 'T9', capacity: 6)],
            },
          ],
        },
      }),
    );
    await tester.pumpAndSettle();
    expect(find.byType(DropdownButton<String>), findsNothing);
    expect(find.byType(FloorPlanAreaSelector), findsOneWidget);
    expect(find.text('Dining room'), findsOneWidget);
    expect(find.text('2 tables'), findsOneWidget);
    expect(find.text('Terrace'), findsOneWidget);
    expect(find.text('1 table'), findsOneWidget);
    expect(find.text('T1'), findsOneWidget);
    expect(find.text('T9'), findsNothing);
    await tester.tap(find.text('Terrace'));
    await tester.pumpAndSettle();
    expect(find.text('T9'), findsOneWidget);
    expect(find.text('T1'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
    entry.dispose();
  });
}
