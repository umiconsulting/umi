import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

abstract interface class SaleRepository {
  Future<SaleSnapshot> start(String merchantId, SaleContextRequest request);
  Future<SaleSnapshot> current(String merchantId, SaleHistoryQuery query);
  Future<SaleHistoryPage> history(String merchantId, SaleHistoryQuery query);
  Future<SaleSnapshot> suspend(
    String merchantId,
    String saleId,
    SuspendSaleRequest request,
  );
  Future<SaleSnapshot> resume(
    String merchantId,
    String saleId,
    ResumeSaleRequest request,
  );
  Future<SaleSnapshot> rename(
    String merchantId,
    String saleId,
    RenameSuspendedSaleRequest request,
  );
  Future<SaleSnapshot> cancel(
    String merchantId,
    String saleId,
    CancelSaleRequest request,
  );
  Future<SaleSnapshot> attachCustomer(
    String merchantId,
    String saleId,
    AttachSaleCustomerRequest request,
  );
  Future<SaleSnapshot> detachCustomer(
    String merchantId,
    String saleId,
    SaleMutationRequest request,
  );
  Future<PosCustomerSearchResult> customers(
    String merchantId,
    PosCustomerSearchQuery query,
  );
  Future<SaleReceiptResult> receipt(
    String merchantId,
    String saleId,
    SaleHistoryQuery query,
  );
}

final class ApiSaleRepository implements SaleRepository {
  ApiSaleRepository(this._api);
  final ApiClient _api;

  @override
  Future<SaleSnapshot> start(
    String merchantId,
    SaleContextRequest request,
  ) async => SaleSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posSales(merchantId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<SaleSnapshot> current(
    String merchantId,
    SaleHistoryQuery query,
  ) async => SaleSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: _query(UmiRoutes.posCurrentSale(merchantId), query),
    ),
  );

  @override
  Future<SaleHistoryPage> history(
    String merchantId,
    SaleHistoryQuery query,
  ) async => SaleHistoryPage.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: _query(UmiRoutes.posSales(merchantId), query),
    ),
  );

  @override
  Future<SaleSnapshot> suspend(
    String merchantId,
    String saleId,
    SuspendSaleRequest request,
  ) async => SaleSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posSaleSuspend(merchantId, saleId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<SaleSnapshot> resume(
    String merchantId,
    String saleId,
    ResumeSaleRequest request,
  ) async => SaleSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posSaleResume(merchantId, saleId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<SaleSnapshot> rename(
    String merchantId,
    String saleId,
    RenameSuspendedSaleRequest request,
  ) async => SaleSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posSaleRename(merchantId, saleId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<SaleSnapshot> cancel(
    String merchantId,
    String saleId,
    CancelSaleRequest request,
  ) async => SaleSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posSaleCancel(merchantId, saleId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<SaleSnapshot> attachCustomer(
    String merchantId,
    String saleId,
    AttachSaleCustomerRequest request,
  ) async => SaleSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posSaleCustomerAttach(merchantId, saleId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<SaleSnapshot> detachCustomer(
    String merchantId,
    String saleId,
    SaleMutationRequest request,
  ) async => SaleSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.delete,
      path: UmiRoutes.posSaleCustomerDetach(merchantId, saleId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<PosCustomerSearchResult> customers(
    String merchantId,
    PosCustomerSearchQuery query,
  ) async => PosCustomerSearchResult.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posSaleCustomers(merchantId),
        queryParameters: {
          'locationId': query.locationId,
          'operatorSessionId': query.operatorSessionId,
          'search': query.search ?? '',
          'recent': '${query.recent ?? false}',
          'limit': '${query.limit ?? 12}',
        },
      ).toString(),
    ),
  );

  @override
  Future<SaleReceiptResult> receipt(
    String merchantId,
    String saleId,
    SaleHistoryQuery query,
  ) async => SaleReceiptResult.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: _query(UmiRoutes.posSaleReceipt(merchantId, saleId), query),
    ),
  );

  String _query(String path, SaleHistoryQuery query) => Uri(
    path: path,
    queryParameters: {
      'locationId': query.locationId,
      'operatorSessionId': query.operatorSessionId,
      if (query.state != null) 'state': query.state!,
      if (query.search != null) 'search': query.search!,
      if (query.sort != null) 'sort': query.sort!,
      if (query.cursor != null) 'cursor': query.cursor!,
      if (query.limit != null) 'limit': '${query.limit}',
    },
  ).toString();
}
