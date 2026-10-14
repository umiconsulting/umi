import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/features/tables/floor_plan_controller.dart';

const _query = PosFloorPlanQuery(
  locationId: 'branch',
  operatorSessionId: 'operator',
);

PublishedFloorPlan _plan({
  int version = 3,
  bool tables = false,
  String location = 'branch',
}) => PublishedFloorPlan(
  locationId: location,
  publishedVersion: version,
  publishedAt: null,
  published: {
    'schemaVersion': 1,
    'areas': <Map<String, Object?>>[
      {
        'id': 'area',
        'name': 'Sala',
        'width': 640,
        'height': 480,
        'elements': <Map<String, Object?>>[
          if (tables)
            {
              'id': 'existing-table',
              'kind': 'table',
              'label': 'Mesa existente',
              'shape': 'square',
              'capacity': 4,
              'x': 0,
              'y': 0,
              'width': 80,
              'height': 80,
              'rotation': 0,
            },
        ],
      },
    ],
  },
);

class _Repository implements BootstrapFloorPlanRepository {
  PublishedFloorPlan current = _plan();
  final requests = <InitializePosTablesRequest>[];
  final writes = <Completer<PublishedFloorPlan>>[];
  int reads = 0;

  @override
  Future<PublishedFloorPlan> load(
    String merchantId,
    PosFloorPlanQuery query,
  ) async {
    reads++;
    return current;
  }

  @override
  Future<PublishedFloorPlan> bootstrapTables(
    String merchantId,
    InitializePosTablesRequest request,
  ) {
    requests.add(request);
    final result = Completer<PublishedFloorPlan>();
    writes.add(result);
    return result.future;
  }
}

void main() {
  test('conflict refresh rejects a plan from another branch', () async {
    final repository = _Repository();
    final controller = FloorPlanController(repository);
    addTearDown(controller.dispose);
    await controller.load('merchant', _query);
    final original = controller.plan;
    repository.current = _plan(location: 'wrong-branch', tables: true);
    final write = controller.bootstrapTables('merchant', _query, [0]);
    repository.writes.last.completeError(
      const AppException(
        category: AppErrorCategory.conflict,
        code: 'FLOOR_PLAN_ALREADY_CONFIGURED',
        recoverable: true,
      ),
    );
    expect(await write, isNull);
    expect(controller.plan, same(original));
    expect(controller.failed, isTrue);
    expect(controller.loading, isFalse);
  });
  test(
    'timeout retry keeps key and original expected version for same slots',
    () async {
      final repository = _Repository();
      final controller = FloorPlanController(repository);
      addTearDown(controller.dispose);
      await controller.load('merchant', _query);
      final first = controller.bootstrapTables('merchant', _query, [5, 0]);
      repository.writes.single.completeError(TimeoutException('response lost'));
      expect(await first, isNull);
      expect(controller.failed, isTrue);
      repository.current = _plan(version: 8);
      await controller.load('merchant', _query);
      final retry = controller.bootstrapTables('merchant', _query, [0, 5]);
      expect(
        repository.requests.last.idempotencyKey,
        repository.requests.first.idempotencyKey,
      );
      expect(repository.requests.last.expectedPublishedVersion, 3);
      expect(repository.requests.last.slots, [0, 5]);
      final saved = _plan(version: 9, tables: true);
      repository.writes.last.complete(saved);
      expect(await retry, same(saved));
      expect(controller.failed, isFalse);
      expect(controller.loading, isFalse);
    },
  );

  test(
    'changed slots use a new key and the current expected version',
    () async {
      final repository = _Repository();
      final controller = FloorPlanController(repository);
      addTearDown(controller.dispose);
      await controller.load('merchant', _query);
      final first = controller.bootstrapTables('merchant', _query, [0]);
      repository.writes.last.completeError(TimeoutException('lost'));
      await first;
      final changed = controller.bootstrapTables('merchant', _query, [0, 1]);
      expect(
        repository.requests.last.idempotencyKey,
        isNot(repository.requests.first.idempotencyKey),
      );
      expect(repository.requests.last.expectedPublishedVersion, 3);
      repository.writes.last.complete(_plan(version: 4, tables: true));
      await changed;
    },
  );

  test(
    'scope clear prevents a late write response from replacing the new branch',
    () async {
      final repository = _Repository();
      final controller = FloorPlanController(repository);
      addTearDown(controller.dispose);
      await controller.load('merchant', _query);
      final old = controller.bootstrapTables('merchant', _query, [0]);
      controller.clear();
      final next = _plan(location: 'other-branch', version: 12);
      repository.current = next;
      await controller.load(
        'merchant',
        const PosFloorPlanQuery(
          locationId: 'other-branch',
          operatorSessionId: 'other-operator',
        ),
      );
      repository.writes.last.complete(_plan(version: 4, tables: true));
      expect(await old, isNull);
      expect(controller.plan, same(next));
      expect(controller.loading, isFalse);
      expect(controller.failed, isFalse);
    },
  );

  test(
    'already configured conflict loads existing tables without another write',
    () async {
      final repository = _Repository();
      final controller = FloorPlanController(repository);
      addTearDown(controller.dispose);
      await controller.load('merchant', _query);
      final existing = _plan(version: 4, tables: true);
      repository.current = existing;
      final write = controller.bootstrapTables('merchant', _query, [0, 1]);
      repository.writes.last.completeError(
        const AppException(
          category: AppErrorCategory.conflict,
          code: 'FLOOR_PLAN_ALREADY_CONFIGURED',
          recoverable: true,
        ),
      );
      expect(await write, same(existing));
      expect(repository.requests, hasLength(1));
      expect(repository.reads, 2);
      expect(controller.plan, same(existing));
      expect(controller.failed, isFalse);
    },
  );
}
