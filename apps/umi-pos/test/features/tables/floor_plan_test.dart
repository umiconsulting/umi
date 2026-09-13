import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/features/tables/floor_plan_controller.dart';
import 'package:umi_pos/features/tables/floor_plan_surface.dart';

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
