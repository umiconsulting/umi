import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

abstract interface class CartRepository {
  Future<Cart> create(String merchantId, CreateCartRequest request);
  Future<Cart> read(String merchantId, CartQuery query);
  Future<Cart> add(String merchantId, CartLineInput input);
  Future<Cart> update(String merchantId, String lineId, CartLineInput input);
  Future<Cart> remove(
    String merchantId,
    String lineId,
    RemoveCartLineRequest input,
  );
  Future<Cart> prepare(String merchantId, PrepareSaleRequest input);
  Future<Cart> clear(String merchantId, ClearCartRequest input);
}

final class ApiCartRepository implements CartRepository {
  ApiCartRepository(this._api);
  final ApiClient _api;

  @override
  Future<Cart> create(String merchantId, CreateCartRequest request) async =>
      Cart.fromJson(
        await _api.request(
          method: ApiMethod.post,
          path: UmiRoutes.posCart(merchantId),
          body: request.toJson(),
        ),
      );

  @override
  Future<Cart> read(String merchantId, CartQuery query) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posCart(merchantId),
        queryParameters: {
          'locationId': query.locationId,
          'operatorSessionId': query.operatorSessionId,
        },
      ).toString(),
    ),
  );

  @override
  Future<Cart> add(String merchantId, CartLineInput input) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCartLines(merchantId),
      body: input.toJson(),
    ),
  );

  @override
  Future<Cart> update(
    String merchantId,
    String lineId,
    CartLineInput input,
  ) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.patch,
      path: UmiRoutes.posCartLine(merchantId, lineId),
      body: input.toJson(),
    ),
  );

  @override
  Future<Cart> remove(
    String merchantId,
    String lineId,
    RemoveCartLineRequest input,
  ) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.delete,
      path: UmiRoutes.posCartLine(merchantId, lineId),
      body: input.toJson(),
    ),
  );

  @override
  Future<Cart> prepare(String merchantId, PrepareSaleRequest input) async =>
      Cart.fromJson(
        await _api.request(
          method: ApiMethod.post,
          path: UmiRoutes.posCartPrepare(merchantId),
          body: input.toJson(),
        ),
      );

  @override
  Future<Cart> clear(String merchantId, ClearCartRequest input) async =>
      Cart.fromJson(
        await _api.request(
          method: ApiMethod.post,
          path: UmiRoutes.posCartClear(merchantId),
          body: input.toJson(),
          idempotent: true,
        ),
      );
}
