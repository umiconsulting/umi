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

  /// The incoming commercial orders (WhatsApp, web, …) this till can pick up.
  Future<PosIncomingOrders> incomingOrders(String merchantId, CartQuery query);

  /// Bind the active cart to the incoming order it settles, so the committed sale
  /// freezes the channel. Pass [BindCartOriginRequest.originOrderId] = null to detach.
  Future<Cart> bindOrigin(String merchantId, BindCartOriginRequest input);

  /// Send the cart to the kitchen before the money — the fired order of
  /// `docs/architecture/2026-10-07-pos-fired-order-adr.md`. Firing writes the
  /// order and its kitchen ticket; the checkout later settles that same order.
  Future<FireOrderResult> fire(String merchantId, FireOrderRequest request);

  /// Set how the order leaves the counter (plan §8.2 F3, decision D5). The cart
  /// carries the operator's choice so the fire and the checkout write the same
  /// type onto the order.
  Future<Cart> setFulfillment(
    String merchantId,
    SetCartFulfillmentRequest input,
  );
}

/// Persistent accounts are available on servers that publish the account routes.
abstract interface class OpenAccountCartRepository {
  Future<List<Cart>> openAccounts(String merchantId, CartQuery query);
  Future<Cart> account(String merchantId, String cartId, CartQuery query);
  Future<Cart> openTableAccount(
    String merchantId, {
    required CartQuery query,
    required String tableId,
    int? partySize,
    required String idempotencyKey,
  });
  Future<Cart> suspendAccount(
    String merchantId, {
    required Cart cart,
    required CartQuery query,
    required String idempotencyKey,
    String? accountName,
    bool updateName = false,
  });
  Future<Cart> resumeAccount(
    String merchantId, {
    required Cart cart,
    required CartQuery query,
    required String idempotencyKey,
  });
}

abstract interface class SentCartLineRepository {
  Future<Cart> cancelSentLine(
    String merchantId,
    String lineId,
    RemoveSentCartLineRequest request,
  );
}

abstract interface class AccountDetailsCartRepository {
  Future<Cart> setAccountDetails(
    String merchantId,
    String cartId,
    SetCartAccountDetailsRequest request,
  );
  Future<Cart> assignAccountTable(
    String merchantId,
    String cartId,
    AssignCartTableRequest request,
  );
}

final class ApiCartRepository
    implements
        CartRepository,
        OpenAccountCartRepository,
        AccountDetailsCartRepository,
        SentCartLineRepository {
  ApiCartRepository(this._api);
  final ApiClient _api;

  @override
  Future<Cart> setAccountDetails(
    String merchantId,
    String cartId,
    SetCartAccountDetailsRequest request,
  ) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCartAccountDetails(merchantId, cartId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<Cart> assignAccountTable(
    String merchantId,
    String cartId,
    AssignCartTableRequest request,
  ) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCartAccountAssignTable(merchantId, cartId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<Cart> cancelSentLine(
    String merchantId,
    String lineId,
    RemoveSentCartLineRequest request,
  ) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCartSentLineRemove(merchantId, lineId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  String _accountQuery(String path, CartQuery query) => Uri(
    path: path,
    queryParameters: {
      'locationId': query.locationId,
      'operatorSessionId': query.operatorSessionId,
    },
  ).toString();

  @override
  Future<List<Cart>> openAccounts(String merchantId, CartQuery query) async {
    final response = await _api.request(
      method: ApiMethod.get,
      path: _accountQuery(
        '${UmiRoutes.posCart(merchantId)}/open-accounts',
        query,
      ),
    );
    return OpenCartAccounts.fromJson(
      response,
    ).accounts.map(Cart.fromJson).toList(growable: false);
  }

  @override
  Future<Cart> account(
    String merchantId,
    String cartId,
    CartQuery query,
  ) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: _accountQuery(
        '${UmiRoutes.posCart(merchantId)}/accounts/${Uri.encodeComponent(cartId)}',
        query,
      ),
    ),
  );

  @override
  Future<Cart> openTableAccount(
    String merchantId, {
    required CartQuery query,
    required String tableId,
    int? partySize,
    required String idempotencyKey,
  }) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCartTable(merchantId),
      body: OpenTableAccountRequest(
        locationId: query.locationId,
        operatorSessionId: query.operatorSessionId,
        tableId: tableId,
        partySize: partySize,
        idempotencyKey: idempotencyKey,
      ).toJson()..remove('expectedVersion'),
      idempotent: true,
    ),
  );

  @override
  Future<Cart> suspendAccount(
    String merchantId, {
    required Cart cart,
    required CartQuery query,
    required String idempotencyKey,
    String? accountName,
    bool updateName = false,
  }) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCartSuspend(merchantId),
      body: SuspendCartRequest(
        cartId: cart.id,
        locationId: query.locationId,
        operatorSessionId: query.operatorSessionId,
        expectedVersion: cart.version,
        idempotencyKey: idempotencyKey,
        accountName: accountName,
      ).toJson()..removeWhere((key, _) => key == 'accountName' && !updateName),
      idempotent: true,
    ),
  );

  @override
  Future<Cart> resumeAccount(
    String merchantId, {
    required Cart cart,
    required CartQuery query,
    required String idempotencyKey,
  }) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCartAccountResume(merchantId, cart.id),
      body: ResumeCartAccountRequest(
        locationId: query.locationId,
        operatorSessionId: query.operatorSessionId,
        expectedVersion: cart.version,
        idempotencyKey: idempotencyKey,
      ).toJson(),
      idempotent: true,
    ),
  );

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
  Future<Cart> add(String merchantId, CartLineInput input) async =>
      Cart.fromJson(
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

  @override
  Future<PosIncomingOrders> incomingOrders(
    String merchantId,
    CartQuery query,
  ) async => PosIncomingOrders.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posCartIncomingOrders(merchantId),
        queryParameters: {
          'locationId': query.locationId,
          'operatorSessionId': query.operatorSessionId,
        },
      ).toString(),
    ),
  );

  @override
  Future<Cart> bindOrigin(
    String merchantId,
    BindCartOriginRequest input,
  ) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCartBindOrigin(merchantId),
      body: input.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<FireOrderResult> fire(
    String merchantId,
    FireOrderRequest request,
  ) async => FireOrderResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posOrderFire(merchantId),
      body: request.toJson(),
      // Idempotent on the client key: a retry after a lost answer returns
      // the order this cart already owns instead of writing a second one.
      idempotent: true,
    ),
  );

  @override
  Future<Cart> setFulfillment(
    String merchantId,
    SetCartFulfillmentRequest input,
  ) async => Cart.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCartFulfillment(merchantId),
      body: input.toJson(),
      idempotent: true,
    ),
  );
}
