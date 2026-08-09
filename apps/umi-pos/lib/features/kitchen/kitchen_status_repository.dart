import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

abstract interface class KitchenStatusRepository {
  Future<PosKitchenStatusResult> status(
    String merchantId,
    String sourceOrderId,
    PosKitchenOrderQuery query,
  );
}

final class ApiKitchenStatusRepository implements KitchenStatusRepository {
  const ApiKitchenStatusRepository(this._api);

  final ApiClient _api;

  @override
  Future<PosKitchenStatusResult> status(
    String merchantId,
    String sourceOrderId,
    PosKitchenOrderQuery query,
  ) async => PosKitchenStatusResult.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posKitchenOrder(merchantId, sourceOrderId),
        queryParameters: query.toJson().map(
          (key, value) => MapEntry(key, value.toString()),
        ),
      ).toString(),
    ),
  );
}
