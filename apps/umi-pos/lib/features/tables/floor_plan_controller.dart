import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/network/api_client.dart';
import '../../core/storage/local_working_copy.dart';

abstract interface class FloorPlanRepository {
  Future<PublishedFloorPlan> load(String merchantId, PosFloorPlanQuery query);
}

abstract interface class BootstrapFloorPlanRepository
    implements FloorPlanRepository {
  Future<PublishedFloorPlan> bootstrapTables(
    String merchantId,
    InitializePosTablesRequest request,
  );
}

abstract interface class AdditionalFloorPlanRepository
    implements FloorPlanRepository {
  Future<PublishedFloorPlan> addTable(
    String merchantId,
    AddPosTableRequest request,
  );
}

final class ApiFloorPlanRepository
    implements BootstrapFloorPlanRepository, AdditionalFloorPlanRepository {
  const ApiFloorPlanRepository(this._api);
  final ApiClient _api;

  @override
  Future<PublishedFloorPlan> addTable(
    String merchantId,
    AddPosTableRequest request,
  ) async => PublishedFloorPlan.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posFloorPlanAddTable(merchantId),
      body: request.toJson(),
    ),
  );

  @override
  Future<PublishedFloorPlan> bootstrapTables(
    String merchantId,
    InitializePosTablesRequest request,
  ) async => PublishedFloorPlan.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posFloorPlanBootstrapTables(merchantId),
      body: request.toJson(),
    ),
  );

  @override
  Future<PublishedFloorPlan> load(
    String merchantId,
    PosFloorPlanQuery query,
  ) async => PublishedFloorPlan.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posFloorPlan(merchantId),
        queryParameters: query.toJson().map(
          (key, value) => MapEntry(key, value.toString()),
        ),
      ).toString(),
    ),
  );
}

final class FloorPlanController extends ChangeNotifier {
  FloorPlanController(this._repository, {LocalWorkingCopy? workingCopy})
    : _workingCopy = workingCopy;
  final FloorPlanRepository _repository;
  final LocalWorkingCopy? _workingCopy;
  PublishedFloorPlan? plan;
  bool loading = false;
  bool failed = false;
  DateTime? refreshedAt;
  String? _scope;
  int _generation = 0;
  bool _disposed = false;
  InitializePosTablesRequest? _bootstrapRequest;
  String? _bootstrapScope;
  AddPosTableRequest? _addRequest;
  String? _addScope;
  String? errorCode;

  bool get supportsBootstrap => _repository is BootstrapFloorPlanRepository;
  bool get supportsAdditionalTables =>
      _repository is AdditionalFloorPlanRepository;

  Future<PublishedFloorPlan?> addTable(
    String merchantId,
    PosFloorPlanQuery query, {
    required String areaId,
    required String label,
    required int capacity,
  }) async {
    final repository = _repository;
    if (repository is! AdditionalFloorPlanRepository || loading) return null;
    final scope = '$merchantId:${query.locationId}:${query.operatorSessionId}';
    final previous = _addRequest;
    if (_addScope != scope ||
        previous == null ||
        previous.areaId != areaId ||
        previous.label != label ||
        previous.capacity != capacity) {
      _addScope = scope;
      _addRequest = AddPosTableRequest(
        locationId: query.locationId,
        operatorSessionId: query.operatorSessionId,
        expectedPublishedVersion: plan?.publishedVersion ?? 0,
        idempotencyKey: _uuid(),
        areaId: areaId,
        label: label,
        capacity: capacity,
      );
    }
    loading = true;
    failed = false;
    errorCode = null;
    final generation = ++_generation;
    notifyListeners();
    try {
      final result = await repository.addTable(merchantId, _addRequest!);
      if (_disposed || generation != _generation) return null;
      if (result.locationId != query.locationId || result.published == null) {
        throw const FormatException('Location mismatch');
      }
      plan = result;
      refreshedAt = DateTime.now();
      _addRequest = null;
      unawaited(_persist(merchantId, query, result));
      return result;
    } catch (error) {
      if (_disposed || generation != _generation) return null;
      failed = true;
      errorCode = error is AppException ? error.code : null;
      if (errorCode == 'OPTIMISTIC_VERSION_CONFLICT') {
        try {
          final current = await repository.load(merchantId, query);
          if (!_disposed &&
              generation == _generation &&
              current.locationId == query.locationId) {
            plan = current;
            refreshedAt = DateTime.now();
            _addRequest = null;
          }
        } catch (_) {
          // Preserve the command until a retry can establish its outcome.
        }
      }
      return null;
    } finally {
      if (!_disposed && generation == _generation) {
        loading = false;
        notifyListeners();
      }
    }
  }

  Future<PublishedFloorPlan?> bootstrapTables(
    String merchantId,
    PosFloorPlanQuery query,
    List<int> slots,
  ) async {
    final repository = _repository;
    if (repository is! BootstrapFloorPlanRepository || loading) return null;
    final scope = '$merchantId:${query.locationId}:${query.operatorSessionId}';
    final ordered = List<int>.of(slots)..sort();
    final previous = _bootstrapRequest;
    if (_bootstrapScope != scope ||
        previous == null ||
        !listEquals(previous.slots, ordered)) {
      _bootstrapScope = scope;
      _bootstrapRequest = InitializePosTablesRequest(
        locationId: query.locationId,
        operatorSessionId: query.operatorSessionId,
        expectedPublishedVersion: plan?.publishedVersion ?? 0,
        idempotencyKey: _uuid(),
        slots: ordered,
      );
    }
    loading = true;
    failed = false;
    final generation = ++_generation;
    notifyListeners();
    try {
      final result = await repository.bootstrapTables(
        merchantId,
        _bootstrapRequest!,
      );
      if (_disposed || generation != _generation) return null;
      if (result.locationId != query.locationId || result.published == null) {
        throw const FormatException('Location mismatch');
      }
      plan = result;
      refreshedAt = DateTime.now();
      _bootstrapRequest = null;
      unawaited(_persist(merchantId, query, result));
      return result;
    } on AppException catch (error) {
      if (_disposed || generation != _generation) return null;
      if (error.code == 'FLOOR_PLAN_ALREADY_CONFIGURED' ||
          error.code == 'OPTIMISTIC_VERSION_CONFLICT') {
        try {
          final current = await repository.load(merchantId, query);
          if (_disposed || generation != _generation) return null;
          if (current.locationId == query.locationId) {
            plan = current;
            refreshedAt = DateTime.now();
            _bootstrapRequest = null;
          }
          final document = current.published;
          if (current.locationId == query.locationId &&
              document != null &&
              FloorPlanDocument.fromJson(document).areas
                  .map(FloorPlanArea.fromJson)
                  .any(
                    (area) => area.elements.any(
                      (element) => element['kind'] == 'table',
                    ),
                  )) {
            plan = current;
            refreshedAt = DateTime.now();
            _bootstrapRequest = null;
            return current;
          }
        } catch (_) {
          // A failed refresh preserves the request for retry.
        }
      }
      failed = true;
      return null;
    } catch (_) {
      if (!_disposed && generation == _generation) failed = true;
      return null;
    } finally {
      if (!_disposed && generation == _generation) {
        loading = false;
        notifyListeners();
      }
    }
  }

  void clear() {
    _generation++;
    _scope = null;
    _bootstrapRequest = null;
    _bootstrapScope = null;
    _addScope = null;
    _addRequest = null;
    errorCode = null;
    plan = null;
    refreshedAt = null;
    loading = false;
    failed = false;
    if (!_disposed) notifyListeners();
  }

  Future<void> load(String merchantId, PosFloorPlanQuery query) async {
    final scope = '$merchantId:${query.locationId}:${query.operatorSessionId}';
    if (_scope == scope && loading) return;
    if (_scope != scope) clear();
    _scope = scope;
    final generation = ++_generation;
    failed = false;
    if (_workingCopy == null) {
      loading = true;
      notifyListeners();
      await _refresh(merchantId, query, generation, preserveOnFailure: false);
      return;
    }
    final local = await _readLocal(merchantId, query);
    if (_disposed || generation != _generation) return;
    if (local != null) {
      plan = local;
      refreshedAt = DateTime.now();
      loading = false;
      notifyListeners();
      unawaited(
        _refresh(merchantId, query, generation, preserveOnFailure: true),
      );
      return;
    }
    loading = true;
    notifyListeners();
    await _refresh(merchantId, query, generation, preserveOnFailure: false);
  }

  Future<void> _refresh(
    String merchantId,
    PosFloorPlanQuery query,
    int generation, {
    required bool preserveOnFailure,
  }) async {
    try {
      final result = await _repository.load(merchantId, query);
      if (_disposed || generation != _generation) return;
      if (result.locationId != query.locationId) {
        throw const FormatException('Location mismatch');
      }
      plan = result;
      refreshedAt = DateTime.now();
      unawaited(_persist(merchantId, query, result));
    } catch (error) {
      if (_disposed || generation != _generation) return;
      failed = !preserveOnFailure;
      if (error is AppException &&
          (error.category == AppErrorCategory.authentication ||
              error.category == AppErrorCategory.permission)) {
        plan = null;
        refreshedAt = null;
      }
    } finally {
      if (!_disposed && generation == _generation) {
        loading = false;
        notifyListeners();
      }
    }
  }

  Future<PublishedFloorPlan?> _readLocal(
    String merchantId,
    PosFloorPlanQuery query,
  ) async {
    final workingCopy = _workingCopy;
    if (workingCopy == null) return null;
    try {
      return await workingCopy.readFloorPlan(merchantId, query);
    } catch (_) {
      return null;
    }
  }

  Future<void> _persist(
    String merchantId,
    PosFloorPlanQuery query,
    PublishedFloorPlan plan,
  ) async {
    try {
      await _workingCopy?.writeFloorPlan(merchantId, query, plan);
    } catch (_) {
      // The server answer is already painted. A failed local write does not
      // turn a successful floor-plan read into a user-visible failure.
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}

String _uuid() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  final hex = bytes
      .map((value) => value.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
