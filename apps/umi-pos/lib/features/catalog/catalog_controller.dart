import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/network/api_client.dart';
import '../../core/observability/telemetry.dart';
import '../../core/storage/local_working_copy.dart';
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
    LocalWorkingCopy? workingCopy,
  }) : _repository = repository,
       _cache = cache,
       _telemetry = telemetry,
       _workingCopy = workingCopy;
  final CatalogRepository _repository;
  final CatalogCache _cache;
  final Telemetry _telemetry;
  final LocalWorkingCopy? _workingCopy;
  CatalogPartition? _partition;
  CancellationToken? _request;
  CancellationToken? _warmRequest;
  Timer? _searchTimer;
  CatalogState _state = const CatalogState();
  bool _disposed = false;
  CatalogState get state => _state;

  Future<void> open(CatalogPartition partition) async {
    if (_partition?.key == partition.key && _state.phase != CatalogPhase.idle) {
      return;
    }
    _partition = partition;
    _request?.cancel();
    _warmRequest?.cancel();
    _request = CancellationToken();
    _event('catalog_opened');
    final local = await _readLocal(partition);
    if (local != null) {
      _publish(local);
      unawaited(_refreshApi(partition, _request!));
      return;
    }
    await _refreshApi(partition, _request!);
  }

  Future<void> refresh() async {
    final partition = _partition;
    if (partition == null) return;
    _request?.cancel();
    _request = CancellationToken();
    await _refreshApi(partition, _request!);
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
    final local = await _readLocalPage(partition, barcode: value);
    if (local != null) {
      _publish(local, search: value);
      unawaited(_refreshBarcode(partition, value, _request!));
      _event(
        local.products.isEmpty ? 'barcode_unknown' : 'barcode_lookup_succeeded',
      );
      return local.products;
    }
    try {
      final page = await _repository.products(
        partition,
        barcode: value,
        cancellation: _request,
      );
      final products = page.items.map(CatalogProductSummary.fromJson).toList();
      unawaited(_persistPage(partition, page, barcode: value));
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
      unawaited(
        _persistPage(
          partition,
          page,
          categoryId: _state.selectedCategoryId,
          search: _state.search.isEmpty ? null : _state.search,
          append: true,
        ),
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

  Future<CatalogProductDetail> detail(String id) async {
    final partition = _partition;
    if (partition == null) throw StateError('catalog partition unavailable');
    _event('product_opened');
    final local = await _readLocalDetail(partition, id);
    if (local != null) {
      unawaited(_refreshDetail(partition, id));
      return local;
    }
    final detail = await _repository.detail(partition, id);
    unawaited(_persistDetail(partition, detail));
    return detail;
  }

  /// Fetch the option sheets a shift is likely to need, while there is a link.
  ///
  /// A product without variants is added from the grid with no network at all,
  /// but one with options needs its detail — sizes, milks, extras — and that
  /// only came from the API on first tap. So a barista opening the till with no
  /// uplink could sell a plain espresso and not a cappuccino. This warms the
  /// detail cache for the products that need it, once, in the background, and
  /// skips everything already cached.
  ///
  /// Bounded on purpose: a fixed ceiling keeps sign-in cheap on a large menu,
  /// and the rest fill in as they are opened or as the till scrolls.
  Future<void> warmDetails({int limit = 25}) async {
    final partition = _partition;
    if (partition == null) return;
    var fetched = 0;
    for (final product in _state.products) {
      if (fetched >= limit) return;
      if (!product.hasVariants && !product.hasModifiers) continue;
      if (await _readLocalDetail(partition, product.id) != null) continue;
      try {
        final detail = await _repository.detail(partition, product.id);
        await _persistDetail(partition, detail);
        fetched++;
      } on AppException {
        // One product failing is not a reason to keep hammering the API.
        return;
      }
    }
  }

  Future<void> _loadFilter({String? categoryId, String search = ''}) async {
    final partition = _partition;
    if (partition == null) return;
    _request?.cancel();
    _request = CancellationToken();
    _event('search_started');
    final local = await _readLocalPage(
      partition,
      categoryId: categoryId,
      search: search.isEmpty ? null : search,
    );
    if (local != null) {
      _publish(local, categoryId: categoryId, search: search);
      unawaited(
        _refreshFilter(
          partition,
          _request!,
          categoryId: categoryId,
          search: search,
        ),
      );
      return;
    }
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
      unawaited(
        _persistPage(
          partition,
          page,
          categoryId: categoryId,
          search: search.isEmpty ? null : search,
        ),
      );
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

  Future<LocalCatalogSnapshot?> _readLocal(CatalogPartition partition) async {
    final workingCopy = _workingCopy;
    if (workingCopy == null) return null;
    try {
      return await workingCopy.readCatalog(_scopeOf(partition));
    } catch (_) {
      _event('local_store_read_failed');
      return null;
    }
  }

  Future<LocalCatalogSnapshot?> _readLocalPage(
    CatalogPartition partition, {
    String? categoryId,
    String? search,
    String? barcode,
  }) async {
    final workingCopy = _workingCopy;
    if (workingCopy == null) return null;
    try {
      return await workingCopy.readCatalogPage(
        _scopeOf(partition),
        categoryId: categoryId,
        search: search,
        barcode: barcode,
      );
    } catch (_) {
      _event('local_store_read_failed');
      return null;
    }
  }

  Future<CatalogProductDetail?> _readLocalDetail(
    CatalogPartition partition,
    String productId,
  ) async {
    final workingCopy = _workingCopy;
    if (workingCopy == null) return null;
    try {
      return await workingCopy.readProductDetail(
        _scopeOf(partition),
        productId,
      );
    } catch (_) {
      _event('local_store_read_failed');
      return null;
    }
  }

  Future<void> _refreshApi(
    CatalogPartition partition,
    CancellationToken cancellation,
  ) async {
    if (_state.phase == CatalogPhase.idle &&
        _state.categories.isEmpty &&
        _state.products.isEmpty) {
      _set(const CatalogState(phase: CatalogPhase.loading));
    }
    try {
      final results = await Future.wait([
        _repository.categories(partition),
        _repository.products(partition, cancellation: cancellation),
      ]);
      if (_disposed || cancellation.isCancelled) return;
      final categoriesResponse = results[0] as CatalogCategoriesResponse;
      final page = results[1] as CatalogPage;
      final categories = categoriesResponse.items
          .map(CatalogCategory.fromJson)
          .toList(growable: false);
      final products = page.items
          .map(CatalogProductSummary.fromJson)
          .toList(growable: false);
      final selected = _state.selectedCategoryId;
      final search = _state.search;
      if (selected == null && search.isEmpty) {
        _cache.write(partition, page.catalogVersion, products);
        _set(
          CatalogState(
            phase: products.isEmpty ? CatalogPhase.empty : CatalogPhase.ready,
            categories: categories,
            products: products,
            nextCursor: page.nextCursor,
          ),
        );
      } else {
        _set(
          CatalogState(
            phase: _state.phase,
            categories: categories,
            products: _state.products,
            selectedCategoryId: selected,
            search: search,
            nextCursor: _state.nextCursor,
          ),
        );
      }
      unawaited(_persistCategories(partition, categoriesResponse));
      unawaited(_persistPage(partition, page));
      unawaited(_warmCatalogue(partition, categories));
      if (products.isEmpty && selected == null && search.isEmpty) {
        _event('empty_catalog');
      }
    } on AppException catch (error) {
      _reportFailure(error);
    }
  }

  Future<void> _refreshFilter(
    CatalogPartition partition,
    CancellationToken cancellation, {
    String? categoryId,
    required String search,
  }) async {
    try {
      final page = await _repository.products(
        partition,
        categoryId: categoryId,
        search: search.isEmpty ? null : search,
        cancellation: cancellation,
      );
      if (_disposed || cancellation.isCancelled) return;
      if (_state.selectedCategoryId != categoryId || _state.search != search) {
        return;
      }
      final products = page.items
          .map(CatalogProductSummary.fromJson)
          .toList(growable: false);
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
      unawaited(
        _persistPage(
          partition,
          page,
          categoryId: categoryId,
          search: search.isEmpty ? null : search,
        ),
      );
      _event('search_completed');
    } on AppException catch (error) {
      _reportFailure(error);
    }
  }

  Future<void> _refreshBarcode(
    CatalogPartition partition,
    String barcode,
    CancellationToken cancellation,
  ) async {
    try {
      final page = await _repository.products(
        partition,
        barcode: barcode,
        cancellation: cancellation,
      );
      if (_disposed || cancellation.isCancelled || _state.search != barcode) {
        return;
      }
      final products = page.items
          .map(CatalogProductSummary.fromJson)
          .toList(growable: false);
      _set(
        CatalogState(
          phase: products.isEmpty ? CatalogPhase.noResults : CatalogPhase.ready,
          categories: _state.categories,
          products: products,
          search: barcode,
          nextCursor: null,
        ),
      );
      unawaited(_persistPage(partition, page, barcode: barcode));
    } on AppException {
      // The cached answer stays painted. Recovery keeps this read off the tap.
    }
  }

  Future<void> _refreshDetail(
    CatalogPartition partition,
    String productId,
  ) async {
    try {
      final detail = await _repository.detail(partition, productId);
      await _persistDetail(partition, detail);
    } on AppException {
      // The local detail remains usable until a later refresh succeeds.
    }
  }

  Future<void> _warmCatalogue(
    CatalogPartition partition,
    List<CatalogCategory> categories,
  ) async {
    final workingCopy = _workingCopy;
    if (workingCopy == null) return;
    _warmRequest?.cancel();
    final cancellation = _warmRequest = CancellationToken();
    for (final category in categories.where((category) => category.enabled)) {
      if (_disposed || cancellation.isCancelled) return;
      try {
        final cached = await workingCopy.readCatalogPage(
          _scopeOf(partition),
          categoryId: category.id,
        );
        if (cached != null) continue;
        String? cursor;
        var pages = 0;
        do {
          final page = await _repository.products(
            partition,
            categoryId: category.id,
            cursor: cursor,
            cancellation: cancellation,
          );
          await workingCopy.writeCatalogPage(
            _scopeOf(partition),
            page,
            categoryId: category.id,
            append: cursor != null,
          );
          cursor = page.nextCursor;
          pages += 1;
        } while (cursor != null && pages < 20);
      } on AppException {
        return;
      } catch (_) {
        // A local storage failure must not stop the next category.
      }
    }
  }

  Future<void> _persistCategories(
    CatalogPartition partition,
    CatalogCategoriesResponse response,
  ) async {
    try {
      await _workingCopy?.writeCategories(_scopeOf(partition), response);
    } catch (_) {
      _event('local_store_write_failed');
    }
  }

  Future<void> _persistPage(
    CatalogPartition partition,
    CatalogPage page, {
    String? categoryId,
    String? search,
    String? barcode,
    bool append = false,
  }) async {
    try {
      await _workingCopy?.writeCatalogPage(
        _scopeOf(partition),
        page,
        categoryId: categoryId,
        search: search,
        barcode: barcode,
        append: append,
      );
    } catch (_) {
      _event('local_store_write_failed');
    }
  }

  Future<void> _persistDetail(
    CatalogPartition partition,
    CatalogProductDetail detail,
  ) async {
    try {
      await _workingCopy?.writeProductDetail(_scopeOf(partition), detail);
    } catch (_) {
      _event('local_store_write_failed');
    }
  }

  void _publish(
    LocalCatalogSnapshot snapshot, {
    String? categoryId,
    String? search = '',
  }) {
    _set(
      CatalogState(
        phase: snapshot.products.isEmpty
            ? ((search ?? '').isEmpty
                  ? CatalogPhase.empty
                  : CatalogPhase.noResults)
            : CatalogPhase.ready,
        categories: snapshot.categories,
        products: snapshot.products,
        selectedCategoryId: categoryId,
        search: search ?? '',
        nextCursor: snapshot.nextCursor,
      ),
    );
  }

  LocalCatalogScope _scopeOf(CatalogPartition partition) => LocalCatalogScope(
    partition.merchantId,
    partition.locationId,
    partition.locale,
  );

  void _reportFailure(AppException error) {
    if (_state.categories.isNotEmpty || _state.products.isNotEmpty) {
      _event('catalog_refresh_failed');
      return;
    }
    _failure(error);
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
    if (_disposed) return;
    _state = value;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _searchTimer?.cancel();
    _request?.cancel();
    _warmRequest?.cancel();
    super.dispose();
  }
}
