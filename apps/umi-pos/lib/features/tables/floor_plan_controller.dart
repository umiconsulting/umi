import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/network/api_client.dart';

abstract interface class FloorPlanRepository {
  Future<PublishedFloorPlan> load(String merchantId, PosFloorPlanQuery query);
}

final class ApiFloorPlanRepository implements FloorPlanRepository {
  const ApiFloorPlanRepository(this._api);
  final ApiClient _api;

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
  FloorPlanController(this._repository);
  final FloorPlanRepository _repository;
  PublishedFloorPlan? plan;
  bool loading = false;
  bool failed = false;
  DateTime? refreshedAt;
  String? _scope;
  int _generation = 0;
  bool _disposed = false;

  void clear() {
    _generation++;
    _scope = null;
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
    loading = true;
    failed = false;
    notifyListeners();
    try {
      final result = await _repository.load(merchantId, query);
      if (_disposed || generation != _generation) return;
      if (result.locationId != query.locationId) {
        throw const FormatException('Location mismatch');
      }
      plan = result;
      refreshedAt = DateTime.now();
    } catch (error) {
      if (_disposed || generation != _generation) return;
      failed = true;
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

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}
