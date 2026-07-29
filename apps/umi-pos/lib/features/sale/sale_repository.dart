import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

abstract interface class SaleRepository {
  Future<SaleSnapshot> start(String tenantId, SaleContextRequest request);
  Future<SaleSnapshot> current(String tenantId, SaleHistoryQuery query);
  Future<SaleHistoryPage> history(String tenantId, SaleHistoryQuery query);
  Future<SaleSnapshot> suspend(
    String tenantId,
    String saleId,
    SuspendSaleRequest request,
  );
  Future<SaleSnapshot> resume(
    String tenantId,
    String saleId,
    ResumeSaleRequest request,
  );
  Future<SaleSnapshot> rename(
    String tenantId,
    String saleId,
    RenameSuspendedSaleRequest request,
  );
  Future<SaleSnapshot> cancel(
    String tenantId,
    String saleId,
    CancelSaleRequest request,
  );
  Future<SaleSnapshot> attachCustomer(
    String tenantId,
    String saleId,
    AttachSaleCustomerRequest request,
  );
  Future<SaleSnapshot> detachCustomer(
    String tenantId,
    String saleId,
    SaleMutationRequest request,
  );
  Future<PosCustomerSearchResult> customers(
    String tenantId,
    PosCustomerSearchQuery query,
  );
  Future<SaleReceiptResult> receipt(
    String tenantId,
    String saleId,
    SaleHistoryQuery query,
  );
}

final class ApiSaleRepository implements SaleRepository {
  ApiSaleRepository(this._api);
  final ApiClient _api;

  @override
  Future<SaleSnapshot> start(
    String tenantId,
    SaleContextRequest request,
  ) async => SaleSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posSales(tenantId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<SaleSnapshot> current(String tenantId, SaleHistoryQuery query) async =>
      SaleSnapshot.fromJson(
        await _api.request(
          method: ApiMethod.get,
          path: _query(UmiRoutes.posCurrentSale(tenantId), query),
        ),
      );

  @override
  Future<SaleHistoryPage> history(
    String tenantId,
    SaleHistoryQuery query,
  ) async => SaleHistoryPage.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: _query(UmiRoutes.posSales(tenantId), query),
    ),
  );

  @override
  Future<SaleSnapshot> suspend(
    String tenantId,
    String saleId,
    SuspendSaleRequest request,
  ) async => SaleSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posSaleSuspend(tenantId, saleId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<SaleSnapshot> resume(
    String tenantId,
    String saleId,
    ResumeSaleRequest request,
  ) async => SaleSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posSaleResume(tenantId, saleId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<SaleSnapshot> rename(
    String tenantId,
    String saleId,
    RenameSuspendedSaleRequest request,
  ) async => SaleSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posSaleRename(tenantId, saleId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<SaleSnapshot> cancel(
    String tenantId,
    String saleId,
    CancelSaleRequest request,
  ) async => SaleSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posSaleCancel(tenantId, saleId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<SaleSnapshot> attachCustomer(
    String tenantId,
    String saleId,
    AttachSaleCustomerRequest request,
  ) async => SaleSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posSaleCustomer(tenantId, saleId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<SaleSnapshot> detachCustomer(
    String tenantId,
    String saleId,
    SaleMutationRequest request,
  ) async => SaleSnapshot.fromJson(
    await _api.request(
      method: ApiMethod.delete,
      path: UmiRoutes.posSaleCustomer(tenantId, saleId),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<PosCustomerSearchResult> customers(
    String tenantId,
    PosCustomerSearchQuery query,
  ) async => PosCustomerSearchResult.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posSaleCustomers(tenantId),
        queryParameters: {
          'branchId': query.branchId,
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
    String tenantId,
    String saleId,
    SaleHistoryQuery query,
  ) async => SaleReceiptResult.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: _query(UmiRoutes.posSaleReceipt(tenantId, saleId), query),
    ),
  );

  String _query(String path, SaleHistoryQuery query) => Uri(
    path: path,
    queryParameters: {
      'branchId': query.branchId,
      'operatorSessionId': query.operatorSessionId,
      if (query.state != null) 'state': query.state!,
      if (query.search != null) 'search': query.search!,
      if (query.sort != null) 'sort': query.sort!,
      if (query.cursor != null) 'cursor': query.cursor!,
      if (query.limit != null) 'limit': '${query.limit}',
    },
  ).toString();
}
