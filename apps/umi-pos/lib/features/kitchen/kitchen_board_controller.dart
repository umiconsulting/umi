import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

/// The whole-location kitchen board, served to the POS-role device's unified KDS
/// mode by `GET /api/v1/pos/merchants/:merchantId/kitchen/board`.
abstract interface class KitchenBoardRepository {
  Future<List<KitchenOrderProjection>> snapshot(
    String merchantId,
    PosKitchenOrderQuery query,
  );
}

final class ApiKitchenBoardRepository implements KitchenBoardRepository {
  const ApiKitchenBoardRepository(this._api);

  final ApiClient _api;

  @override
  Future<List<KitchenOrderProjection>> snapshot(
    String merchantId,
    PosKitchenOrderQuery query,
  ) async {
    final response = await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path:
            '/api/v1/pos/merchants/${Uri.encodeComponent(merchantId)}/kitchen/board',
        queryParameters: query.toJson().map(
          (key, value) => MapEntry(key, value.toString()),
        ),
      ).toString(),
    );
    final data = (response['data'] as List<Object?>? ?? const <Object?>[])
        .cast<Map<String, Object?>>();
    return data.map(KitchenOrderProjection.fromJson).toList(growable: false);
  }
}

enum KitchenBoardPhase { idle, loading, ready, failure }

@immutable
final class KitchenBoardState {
  const KitchenBoardState({
    this.phase = KitchenBoardPhase.idle,
    this.orders = const [],
    this.errorCode,
  });
  final KitchenBoardPhase phase;
  final List<KitchenOrderProjection> orders;
  final String? errorCode;
}

/// Loads and refreshes the kitchen board for the KDS mode. Read-only for now —
/// ticket commands (start / ready / complete) stay on the device path until the
/// unified device identity lands (see the KDS+POS unification ADR).
final class KitchenBoardController extends ChangeNotifier {
  KitchenBoardController(this._repository);

  final KitchenBoardRepository _repository;
  KitchenBoardState _state = const KitchenBoardState();
  KitchenBoardState get state => _state;

  Future<void> load(String merchantId, PosKitchenOrderQuery query) async {
    _state = KitchenBoardState(
      phase: KitchenBoardPhase.loading,
      orders: _state.orders,
    );
    notifyListeners();
    try {
      final orders = await _repository.snapshot(merchantId, query);
      _state = KitchenBoardState(
        phase: KitchenBoardPhase.ready,
        orders: orders,
      );
    } catch (error) {
      _state = KitchenBoardState(
        phase: KitchenBoardPhase.failure,
        orders: _state.orders,
        errorCode: '$error',
      );
    }
    notifyListeners();
  }
}
