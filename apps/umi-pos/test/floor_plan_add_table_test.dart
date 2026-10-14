import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/features/tables/floor_plan_controller.dart';

const _query = PosFloorPlanQuery(
  locationId: 'branch',
  operatorSessionId: 'operator',
);
PublishedFloorPlan _plan({int version = 3, String location = 'branch'}) =>
    PublishedFloorPlan(
      locationId: location,
      publishedVersion: version,
      publishedAt: null,
      published: {'schemaVersion': 1, 'areas': <Map<String, Object?>>[]},
    );

class _Repository implements AdditionalFloorPlanRepository {
  PublishedFloorPlan current = _plan();
  final requests = <AddPosTableRequest>[];
  final writes = <Completer<PublishedFloorPlan>>[];
  int reads = 0;
  Object? loadError;
  @override
  Future<PublishedFloorPlan> load(
    String merchantId,
    PosFloorPlanQuery query,
  ) async {
    reads++;
    if (loadError != null) throw loadError!;
    return current;
  }

  @override
  Future<PublishedFloorPlan> addTable(
    String merchantId,
    AddPosTableRequest request,
  ) {
    requests.add(request);
    final pending = Completer<PublishedFloorPlan>();
    writes.add(pending);
    return pending.future;
  }
}

Future<PublishedFloorPlan?> _add(
  FloorPlanController controller, {
  String label = 'Mesa 2',
}) => controller.addTable(
  'merchant',
  _query,
  areaId: 'area',
  label: label,
  capacity: 4,
);

const _conflict = AppException(
  category: AppErrorCategory.conflict,
  code: 'OPTIMISTIC_VERSION_CONFLICT',
  recoverable: true,
);

void main() {
  test(
    'lost response retries the same addition with the original key and version',
    () async {
      final repository = _Repository();
      final controller = FloorPlanController(repository);
      addTearDown(controller.dispose);
      await controller.load('merchant', _query);
      final first = _add(controller);
      repository.writes.last.completeError(TimeoutException('response lost'));
      expect(await first, isNull);
      repository.current = _plan(version: 8);
      await controller.load('merchant', _query);
      final retry = _add(controller);
      expect(
        repository.requests.last.idempotencyKey,
        repository.requests.first.idempotencyKey,
      );
      expect(repository.requests.last.expectedPublishedVersion, 3);
      repository.writes.last.complete(_plan(version: 9));
      expect((await retry)?.publishedVersion, 9);
      expect(controller.loading, isFalse);
      expect(controller.failed, isFalse);
      final next = _add(controller, label: 'Mesa 3');
      expect(
        repository.requests.last.idempotencyKey,
        isNot(repository.requests.first.idempotencyKey),
      );
      expect(repository.requests.last.expectedPublishedVersion, 9);
      repository.writes.last.complete(_plan(version: 10));
      await next;
    },
  );

  test(
    'pending addition ignores repeated taps and a changed label starts a new command',
    () async {
      final repository = _Repository();
      final controller = FloorPlanController(repository);
      addTearDown(controller.dispose);
      await controller.load('merchant', _query);
      final first = _add(controller);
      expect(await _add(controller), isNull);
      expect(repository.requests, hasLength(1));
      repository.writes.last.completeError(TimeoutException('response lost'));
      await first;
      final changed = _add(controller, label: 'Terraza extra');
      expect(repository.requests.last.label, 'Terraza extra');
      expect(
        repository.requests.last.idempotencyKey,
        isNot(repository.requests.first.idempotencyKey),
      );
      repository.writes.last.complete(_plan(version: 4));
      await changed;
    },
  );

  test(
    'version conflict refreshes the plan before an explicit retry with a new key',
    () async {
      final repository = _Repository();
      final controller = FloorPlanController(repository);
      addTearDown(controller.dispose);
      await controller.load('merchant', _query);
      final write = _add(controller);
      repository.current = _plan(version: 7);
      repository.writes.last.completeError(_conflict);
      expect(await write, isNull);
      expect(repository.requests, hasLength(1));
      expect(controller.plan?.publishedVersion, 7);
      expect(controller.errorCode, 'OPTIMISTIC_VERSION_CONFLICT');
      expect(controller.failed, isTrue);
      final retry = _add(controller);
      expect(repository.requests.last.expectedPublishedVersion, 7);
      expect(
        repository.requests.last.idempotencyKey,
        isNot(repository.requests.first.idempotencyKey),
      );
      repository.writes.last.complete(_plan(version: 8));
      await retry;
      expect(controller.errorCode, isNull);
    },
  );

  test(
    'conflict refresh failure preserves the original command for retry',
    () async {
      final repository = _Repository();
      final controller = FloorPlanController(repository);
      addTearDown(controller.dispose);
      await controller.load('merchant', _query);
      final write = _add(controller);
      repository.loadError = TimeoutException('refresh lost');
      repository.writes.last.completeError(_conflict);
      expect(await write, isNull);
      expect(controller.plan?.publishedVersion, 3);
      final retry = _add(controller);
      expect(
        repository.requests.last.idempotencyKey,
        repository.requests.first.idempotencyKey,
      );
      expect(repository.requests.last.expectedPublishedVersion, 3);
      repository.writes.last.complete(_plan(version: 4));
      await retry;
    },
  );

  test('a late addition cannot replace the newly selected branch', () async {
    final repository = _Repository();
    final controller = FloorPlanController(repository);
    addTearDown(controller.dispose);
    await controller.load('merchant', _query);
    final write = _add(controller);
    const nextQuery = PosFloorPlanQuery(
      locationId: 'next-branch',
      operatorSessionId: 'next-operator',
    );
    repository.current = _plan(location: 'next-branch', version: 12);
    await controller.load('merchant', nextQuery);
    repository.writes.last.complete(_plan(version: 4));
    expect(await write, isNull);
    expect(controller.plan?.locationId, 'next-branch');
    expect(controller.plan?.publishedVersion, 12);
    expect(controller.loading, isFalse);
    expect(controller.failed, isFalse);
    final next = controller.addTable(
      'merchant',
      nextQuery,
      areaId: 'next-area',
      label: 'Mesa 2',
      capacity: 4,
    );
    expect(repository.requests.last.locationId, 'next-branch');
    expect(repository.requests.last.expectedPublishedVersion, 12);
    expect(
      repository.requests.last.idempotencyKey,
      isNot(repository.requests.first.idempotencyKey),
    );
    repository.writes.last.complete(
      _plan(location: 'next-branch', version: 13),
    );
    await next;
  });

  test(
    'an addition or conflict refresh from another branch is rejected',
    () async {
      final repository = _Repository();
      final controller = FloorPlanController(repository);
      addTearDown(controller.dispose);
      await controller.load('merchant', _query);
      final original = controller.plan;
      final write = _add(controller);
      repository.writes.last.complete(
        _plan(location: 'wrong-branch', version: 99),
      );
      expect(await write, isNull);
      expect(controller.plan, same(original));
      expect(controller.failed, isTrue);
      final retry = _add(controller);
      repository.current = _plan(location: 'wrong-branch', version: 99);
      repository.writes.last.completeError(_conflict);
      expect(await retry, isNull);
      expect(controller.plan, same(original));
      expect(controller.loading, isFalse);
    },
  );
}
