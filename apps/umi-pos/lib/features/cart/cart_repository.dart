import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

abstract interface class CartRepository {
  Future<Cart> create(String tenantId, CreateCartRequest request);
  Future<Cart> read(String tenantId, CartQuery query);
  Future<Cart> add(String tenantId, CartLineInput input);
  Future<Cart> update(String tenantId, String lineId, CartLineInput input);
  Future<Cart> remove(
    String tenantId,
    String lineId,
    RemoveCartLineRequest input,
  );
  Future<Cart> prepare(String tenantId, PrepareSaleRequest input);
  Future<Cart> clear(String tenantId, ClearCartRequest input);
}

final class ApiCartRepository implements CartRepository {
  ApiCartRepository(this._api);
  final ApiClient _api;

  @override
  Future<Cart> create(String tenantId, CreateCartRequest request) async =>
      Cart.fromJson(
        await _api.request(
          method: ApiMethod.post,
          path: UmiRoutes.posCart(tenantId),
          body: request.toJson(),
        ),
      );

  @override
  Future<Cart> read(String tenantId, CartQuery query) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posCart(tenantId),
        queryParameters: {
          'branchId': query.branchId,
          'operatorSessionId': query.operatorSessionId,
        },
      ).toString(),
    ),
  );

  @override
  Future<Cart> add(String tenantId, CartLineInput input) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCartLines(tenantId),
      body: input.toJson(),
    ),
  );

  @override
  Future<Cart> update(
    String tenantId,
    String lineId,
    CartLineInput input,
  ) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.patch,
      path: UmiRoutes.posCartLine(tenantId, lineId),
      body: input.toJson(),
    ),
  );

  @override
  Future<Cart> remove(
    String tenantId,
    String lineId,
    RemoveCartLineRequest input,
  ) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.delete,
      path: UmiRoutes.posCartLine(tenantId, lineId),
      body: input.toJson(),
    ),
  );

  @override
  Future<Cart> prepare(String tenantId, PrepareSaleRequest input) async =>
      Cart.fromJson(
        await _api.request(
          method: ApiMethod.post,
          path: UmiRoutes.posCartPrepare(tenantId),
          body: input.toJson(),
        ),
      );

  @override
  Future<Cart> clear(String tenantId, ClearCartRequest input) async =>
      Cart.fromJson(
        await _api.request(
          method: ApiMethod.post,
          path: UmiRoutes.posCartClear(tenantId),
          body: input.toJson(),
          idempotent: true,
        ),
      );
}
