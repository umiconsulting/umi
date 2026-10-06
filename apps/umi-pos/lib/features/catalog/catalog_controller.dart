import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/network/api_client.dart';
import '../../core/observability/telemetry.dart';
import 'catalog_repository.dart';

enum CatalogPhase {
  idle,
  loading,
  ready,
  empty,
  noResults,
  permissionDenied,
  networkFailure,
  failure,
}

final class CatalogState {
  const CatalogState({
    this.phase = CatalogPhase.idle,
    this.categories = const [],
    this.products = const [],
    this.selectedCategoryId,
    this.search = '',
    this.nextCursor,
    this.loadingMore = false,
    this.errorCode,
  });
  final CatalogPhase phase;
  final List<CatalogCategory> categories;
  final List<CatalogProductSummary> products;
  final String? selectedCategoryId;
  final String search;
  final String? nextCursor;
  final bool loadingMore;
  final String? errorCode;
}

final class CatalogController extends ChangeNotifier {
  CatalogController({
    required CatalogRepository repository,
    required CatalogCache cache,
    required Telemetry telemetry,
  }) : _repository = repository,
       _cache = cache,
       _telemetry = telemetry;
  final CatalogRepository _repository;
  final CatalogCache _cache;
  final Telemetry _telemetry;
  CatalogPartition? _partition;
  CancellationToken? _request;
  Timer? _searchTimer;
  CatalogState _state = const CatalogState();
  CatalogState get state => _state;

  Future<void> open(CatalogPartition partition) async {
    if (_partition?.key == partition.key && _state.phase != CatalogPhase.idle) {
      return;
    }
    _partition = partition;
    _event('catalog_opened');
    await refresh();
  }

  Future<void> refresh() async {
    final partition = _partition;
    if (partition == null) return;
    _request?.cancel();
    _request = CancellationToken();
    _set(const CatalogState(phase: CatalogPhase.loading));
    try {
      final results = await Future.wait([
        _repository.categories(partition),
        _repository.products(partition, cancellation: _request),
      ]);
      final categories = (results[0] as CatalogCategoriesResponse).items
          .map(CatalogCategory.fromJson)
          .toList();
      final page = results[1] as CatalogPage;
      final products = page.items.map(CatalogProductSummary.fromJson).toList();
      _cache.write(partition, page.catalogVersion, products);
      _set(
        CatalogState(
          phase: products.isEmpty ? CatalogPhase.empty : CatalogPhase.ready,
          categories: categories,
          products: products,
          nextCursor: page.nextCursor,
        ),
      );
      if (products.isEmpty) {
        _event('empty_catalog');
      }
    } on AppException catch (error) {
      _failure(error);
    }
  }

  void search(String value) {
    _searchTimer?.cancel();
    _searchTimer = Timer(
      const Duration(milliseconds: 280),
      () => _loadFilter(search: value.trim()),
    );
  }

  Future<List<CatalogProductSummary>> lookupBarcode(String value) async {
    final partition = _partition;
    if (partition == null) return const [];
    _searchTimer?.cancel();
    _request?.cancel();
    _request = CancellationToken();
    _event('barcode_lookup_started');
    try {
      final page = await _repository.products(
        partition,
        barcode: value,
        cancellation: _request,
      );
      final products = page.items.map(CatalogProductSummary.fromJson).toList();
      _set(
        CatalogState(
          phase: products.isEmpty ? CatalogPhase.noResults : CatalogPhase.ready,
          categories: _state.categories,
          products: products,
          search: value,
          nextCursor: null,
        ),
      );
      _event(products.isEmpty ? 'barcode_unknown' : 'barcode_lookup_succeeded');
      return products;
    } on AppException catch (error) {
      _failure(error);
      return const [];
    }
  }

  Future<void> selectCategory(String? id) async {
    _event('category_selected');
    await _loadFilter(categoryId: id, search: _state.search);
  }

  Future<void> loadMore() async {
    final partition = _partition;
    if (partition == null || _state.nextCursor == null || _state.loadingMore) {
      return;
    }
    _set(
      CatalogState(
        phase: _state.phase,
        categories: _state.categories,
        products: _state.products,
        selectedCategoryId: _state.selectedCategoryId,
        search: _state.search,
        nextCursor: _state.nextCursor,
        loadingMore: true,
      ),
    );
    try {
      final page = await _repository.products(
        partition,
        categoryId: _state.selectedCategoryId,
        search: _state.search.isEmpty ? null : _state.search,
        cursor: _state.nextCursor,
      );
      final known = _state.products.map((item) => item.id).toSet();
      final more = page.items
          .map(CatalogProductSummary.fromJson)
          .where((item) => known.add(item.id))
          .toList();
      _set(
        CatalogState(
          phase: CatalogPhase.ready,
          categories: _state.categories,
          products: [..._state.products, ...more],
          selectedCategoryId: _state.selectedCategoryId,
          search: _state.search,
          nextCursor: page.nextCursor,
        ),
      );
      _event('pagination_loaded');
    } on AppException catch (error) {
      _failure(error);
    }
  }

  Future<CatalogProductDetail> detail(String id) {
    final partition = _partition;
    if (partition == null) throw StateError('catalog partition unavailable');
    _event('product_opened');
    return _repository.detail(partition, id);
  }

  Future<void> _loadFilter({String? categoryId, String search = ''}) async {
    final partition = _partition;
    if (partition == null) return;
    _request?.cancel();
    _request = CancellationToken();
    _event('search_started');
    _set(
      CatalogState(
        phase: CatalogPhase.loading,
        categories: _state.categories,
        selectedCategoryId: categoryId,
        search: search,
      ),
    );
    try {
      final page = await _repository.products(
        partition,
        categoryId: categoryId,
        search: search.isEmpty ? null : search,
        cancellation: _request,
      );
      final products = page.items.map(CatalogProductSummary.fromJson).toList();
      _set(
        CatalogState(
          phase: products.isEmpty
              ? (search.isEmpty ? CatalogPhase.empty : CatalogPhase.noResults)
              : CatalogPhase.ready,
          categories: _state.categories,
          products: products,
          selectedCategoryId: categoryId,
          search: search,
          nextCursor: page.nextCursor,
        ),
      );
      _event('search_completed');
      if (products.isEmpty) {
        _event(search.isEmpty ? 'empty_catalog' : 'empty_search');
      }
    } on AppException catch (error) {
      _failure(error);
    }
  }

  void _failure(AppException error) {
    final phase = switch (error.code) {
      'PERMISSION_DENIED' => CatalogPhase.permissionDenied,
      'REQUEST_TIMEOUT' || 'TRANSPORT_FAILURE' => CatalogPhase.networkFailure,
      _ => CatalogPhase.failure,
    };
    _event(
      phase == CatalogPhase.permissionDenied
          ? 'permission_denied'
          : 'network_failure',
    );
    _set(
      CatalogState(
        phase: phase,
        categories: _state.categories,
        errorCode: error.code,
      ),
    );
  }

  void _event(String name) =>
      _telemetry.event(ClientEvent(name: name, values: const {}));
  void _set(CatalogState value) {
    _state = value;
    notifyListeners();
  }

  @override
  void dispose() {
    _searchTimer?.cancel();
    _request?.cancel();
    super.dispose();
  }
}
