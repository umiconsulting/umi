import 'dart:collection';

import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

final class CatalogPartition {
  const CatalogPartition(this.merchantId, this.locationId, this.locale);
  final String merchantId;
  final String locationId;
  final String locale;
  String get key => '$merchantId:$locationId:$locale';
}

final class CatalogCache {
  CatalogCache({this.maxPartitions = 8, this.maxProductsPerPartition = 240});
  final int maxPartitions;
  final int maxProductsPerPartition;
  final LinkedHashMap<String, List<CatalogProductSummary>> _products =
      LinkedHashMap();
  final Map<String, String> _versions = {};

  List<CatalogProductSummary>? read(
    CatalogPartition partition,
    String version,
  ) {
    if (_versions[partition.key] != version) return null;
    final value = _products.remove(partition.key);
    if (value != null) _products[partition.key] = value;
    return value;
  }

  void write(
    CatalogPartition partition,
    String version,
    List<CatalogProductSummary> products,
  ) {
    _products.remove(partition.key);
    _products[partition.key] = List.unmodifiable(
      products.take(maxProductsPerPartition),
    );
    _versions[partition.key] = version;
    while (_products.length > maxPartitions) {
      final oldest = _products.keys.first;
      _products.remove(oldest);
      _versions.remove(oldest);
    }
  }

  void clearPartition(String merchantId, String locationId) {
    final prefix = '$merchantId:$locationId:';
    for (final key
        in _products.keys.where((key) => key.startsWith(prefix)).toList()) {
      _products.remove(key);
      _versions.remove(key);
    }
  }
}

abstract interface class CatalogRepository {
  Future<CatalogCategoriesResponse> categories(CatalogPartition partition);
  Future<CatalogPage> products(
    CatalogPartition partition, {
    String? categoryId,
    String? search,
    String? barcode,
    String? cursor,
    CancellationToken? cancellation,
  });
  Future<CatalogProductDetail> detail(
    CatalogPartition partition,
    String productId,
  );
}

final class ApiCatalogRepository implements CatalogRepository {
  ApiCatalogRepository(this._api);
  final ApiClient _api;

  @override
  Future<CatalogCategoriesResponse> categories(
    CatalogPartition partition,
  ) async => CatalogCategoriesResponse.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: _path(UmiRoutes.posCatalogCategories(partition.merchantId), {
        'locationId': partition.locationId,
        'locale': partition.locale,
      }),
    ),
  );

  @override
  Future<CatalogPage> products(
    CatalogPartition partition, {
    String? categoryId,
    String? search,
    String? barcode,
    String? cursor,
    CancellationToken? cancellation,
  }) async => CatalogPage.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: _path(UmiRoutes.posCatalogProducts(partition.merchantId), {
        'locationId': partition.locationId,
        'locale': partition.locale,
        'limit': '40',
        // ignore: use_null_aware_elements
        if (categoryId != null) 'categoryId': categoryId,
        if (search != null && search.isNotEmpty) 'search': search,
        if (barcode != null && barcode.isNotEmpty) 'barcode': barcode,
        // ignore: use_null_aware_elements
        if (cursor != null) 'cursor': cursor,
      }),
      cancellation: cancellation,
    ),
  );

  @override
  Future<CatalogProductDetail> detail(
    CatalogPartition partition,
    String productId,
  ) async => CatalogProductDetail.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: _path(
        UmiRoutes.posCatalogProduct(partition.merchantId, productId),
        {'locationId': partition.locationId, 'locale': partition.locale},
      ),
    ),
  );

  String _path(String path, Map<String, String> query) =>
      Uri(path: path, queryParameters: query).toString();
}
