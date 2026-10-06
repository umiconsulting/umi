import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

abstract interface class InventoryRepository {
  Future<InventoryOverview> overview(String merchantId, InventoryQuery query);
  Future<InventoryHistoryResult> history(
    String merchantId,
    InventoryQuery query,
  );
  Future<InventoryMutationResult> adjust(
    String merchantId,
    InventoryAdjustment command,
  );
  Future<InventoryMutationResult> waste(String merchantId, WasteRecord command);
  Future<InventoryMutationResult> damage(
    String merchantId,
    DamageRecord command,
  );
  Future<InventoryMutationResult> quarantine(
    String merchantId,
    QuarantineRecord command,
  );
  Future<InventoryMutationResult> restock(
    String merchantId,
    RestockCommand command,
  );
  Future<ProductionResult> produce(String merchantId, ProductionRecord command);
  Future<InventoryRecoveryResult> recover(
    String merchantId,
    String commandId,
    InventoryRecoveryQuery query,
  );
  Future<InventoryCountResult> createCount(
    String merchantId,
    CreateInventoryCountRequest command,
  );
  Future<InventoryCountResult> submitCount(
    String merchantId,
    SubmitInventoryCountRequest command,
  );
  Future<InventoryCountResult> reconcileCount(
    String merchantId,
    InventoryReconciliation command,
  );

  /// The prep list: what the kitchen must make today (§8.4).
  Future<PrepList> prepList(String merchantId, PosPrepListQuery query);
}

/// The one prep-list request, next to the route it reads.
///
/// The kitchen board and the inventory surface both need this read, so the
/// request and its parse live once. The server coerces any query text to a
/// boolean, so `includeAbovePar` is absent when it is false; its default is
/// already false.
Future<PrepList> requestPrepList(
  ApiClient api,
  String merchantId,
  PosPrepListQuery query,
) async {
  // BOTH ARE REQUIRED AND BOTH TRAVEL. The POS guard resolves the operator session and
  // the branch before it answers a stock read, so a prep request without them is
  // refused with PERMISSION_DENIED rather than answered for the wrong scope.
  final queryParameters = <String, String>{
    'locationId': query.locationId,
    'operatorSessionId': query.operatorSessionId,
  };
  // The server coerces any query text to a boolean, so a false flag stays out
  // of the request: its default is already false.
  if (query.includeAbovePar == true) queryParameters['includeAbovePar'] = 'true';
  return PrepList.fromJson(
    await api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posInventoryPrepList(merchantId),
        queryParameters: queryParameters,
      ).toString(),
    ),
  );
}

final class ApiInventoryRepository implements InventoryRepository {
  const ApiInventoryRepository(this._api);
  final ApiClient _api;

  String _query(String path, InventoryQuery query) => Uri(
    path: path,
    queryParameters: {
      'locationId': query.locationId,
      'operatorSessionId': query.operatorSessionId,
      if (query.inventoryLocationId != null)
        'inventoryLocationId': query.inventoryLocationId!,
      if (query.itemId != null) 'itemId': query.itemId!,
      if (query.cursor != null) 'cursor': query.cursor!,
      if (query.limit != null) 'limit': '${query.limit}',
    },
  ).toString();

  @override
  Future<InventoryOverview> overview(
    String merchantId,
    InventoryQuery query,
  ) async => InventoryOverview.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: _query(UmiRoutes.posInventoryOverview(merchantId), query),
    ),
  );

  @override
  Future<InventoryHistoryResult> history(
    String merchantId,
    InventoryQuery query,
  ) async => InventoryHistoryResult.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: _query(UmiRoutes.posInventoryHistory(merchantId), query),
    ),
  );

  @override
  Future<InventoryMutationResult> adjust(
    String merchantId,
    InventoryAdjustment command,
  ) =>
      _mutation(UmiRoutes.posInventoryAdjustment(merchantId), command.toJson());

  @override
  Future<InventoryMutationResult> waste(
    String merchantId,
    WasteRecord command,
  ) => _mutation(UmiRoutes.posInventoryWaste(merchantId), command.toJson());

  @override
  Future<InventoryMutationResult> damage(
    String merchantId,
    DamageRecord command,
  ) => _mutation(UmiRoutes.posInventoryDamage(merchantId), command.toJson());

  @override
  Future<InventoryMutationResult> quarantine(
    String merchantId,
    QuarantineRecord command,
  ) =>
      _mutation(UmiRoutes.posInventoryQuarantine(merchantId), command.toJson());

  @override
  Future<InventoryMutationResult> restock(
    String merchantId,
    RestockCommand command,
  ) => _mutation(UmiRoutes.posInventoryRestock(merchantId), command.toJson());

  @override
  Future<ProductionResult> produce(
    String merchantId,
    ProductionRecord command,
  ) async => ProductionResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posInventoryProduction(merchantId),
      body: command.toJson(),
    ),
  );

  @override
  Future<InventoryRecoveryResult> recover(
    String merchantId,
    String commandId,
    InventoryRecoveryQuery query,
  ) async => InventoryRecoveryResult.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posInventoryCommand(merchantId, commandId),
        queryParameters: {
          'locationId': query.locationId,
          'operatorSessionId': query.operatorSessionId,
        },
      ).toString(),
    ),
  );

  @override
  Future<InventoryCountResult> createCount(
    String merchantId,
    CreateInventoryCountRequest command,
  ) async => InventoryCountResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posInventoryCounts(merchantId),
      body: command.toJson(),
    ),
  );

  @override
  Future<InventoryCountResult> submitCount(
    String merchantId,
    SubmitInventoryCountRequest command,
  ) async => InventoryCountResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posInventoryCountSubmit(merchantId, command.countId),
      body: command.toJson(),
    ),
  );

  @override
  Future<InventoryCountResult> reconcileCount(
    String merchantId,
    InventoryReconciliation command,
  ) async => InventoryCountResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posInventoryCountReconcile(merchantId, command.countId),
      body: command.toJson(),
    ),
  );

  @override
  Future<PrepList> prepList(String merchantId, PosPrepListQuery query) =>
      requestPrepList(_api, merchantId, query);

  Future<InventoryMutationResult> _mutation(
    String path,
    Map<String, Object?> body,
  ) async => InventoryMutationResult.fromJson(
    await _api.request(method: ApiMethod.post, path: path, body: body),
  );
}
