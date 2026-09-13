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
}
