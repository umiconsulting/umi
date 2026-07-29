import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/observability/telemetry.dart';
import '../cart/cart_controller.dart';
import 'sale_repository.dart';

enum SalePhase {
  idle,
  loading,
  buildingCart,
  suspended,
  readyForCheckout,
  checkingOut,
  committed,
  cancelled,
  recovered,
  failure,
}

final class SaleLifecycleState {
  const SaleLifecycleState({
    this.phase = SalePhase.idle,
    this.sale,
    this.history = const [],
    this.customers = const [],
    this.receipt,
    this.errorCode,
    this.readyForNextCustomer = false,
  });

  final SalePhase phase;
  final SaleSnapshot? sale;
  final List<SaleSnapshot> history;
  final List<SaleCustomerSummary> customers;
  final SaleReceiptResult? receipt;
  final String? errorCode;
  final bool readyForNextCustomer;
}

final class SaleLifecycleController extends ChangeNotifier {
  SaleLifecycleController({
    required SaleRepository repository,
    required CartController cart,
    required Telemetry telemetry,
  }) : _repository = repository,
       _cart = cart,
       _telemetry = telemetry;

  final SaleRepository _repository;
  final CartController _cart;
  final Telemetry _telemetry;
  SaleLifecycleState _state = const SaleLifecycleState();
  SaleLifecycleState get state => _state;
  bool get canResumeSuspendedSale => _isTerminalOrMissing && !_mutationActive;
  bool get canLoadMoreHistory => _historyNextCursor != null;
  bool get historyLoading => _historyLoading;
  String? _tenantId;
  String? _branchId;
  String? _operatorSessionId;
  bool _mutationActive = false;
  bool _historyLoading = false;
  String? _historyNextCursor;
  String? _historyState;
  String _historySearch = '';
  String _historySort = 'newest';

  Future<void> open(
    String tenantId,
    String branchId,
    String operatorSessionId,
  ) async {
    final sameScope =
        _tenantId == tenantId &&
        _branchId == branchId &&
        _operatorSessionId == operatorSessionId;
    if (sameScope && _state.sale != null) return;
    _tenantId = tenantId;
    _branchId = branchId;
    _operatorSessionId = operatorSessionId;
    _set(const SaleLifecycleState(phase: SalePhase.loading));
    try {
      final recovered = await _repository.current(tenantId, _query());
      _apply(recovered);
      _event('sale_restored');
    } on AppException catch (error) {
      if (error.code != 'SALE_NOT_FOUND' &&
          error.code != 'RESOURCE_NOT_FOUND') {
        _failure(error);
        return;
      }
      await _start(readyForNextCustomer: false);
    }
  }

  Future<void> newSale() async {
    if (_mutationActive || !_isTerminalOrMissing) return;
    await _start(readyForNextCustomer: false);
  }

  Future<void> suspend(String? label) async {
    final sale = _state.sale;
    final cart = _cart.state.cart;
    if (_mutationActive ||
        sale == null ||
        cart == null ||
        !_isEditable(_state.phase)) {
      return;
    }
    await _mutation(
      () => _repository.suspend(
        _tenantId!,
        sale.id,
        SuspendSaleRequest(
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
          idempotencyKey: _uuid(),
          expectedVersion: cart.version,
          label: label?.trim().isEmpty ?? true ? null : label!.trim(),
        ),
      ),
      'sale_suspended',
    );
  }

  Future<void> resume(SaleSnapshot suspended) async {
    if (_mutationActive ||
        !_isTerminalOrMissing ||
        suspended.state != 'suspended') {
      return;
    }
    final suspendedCart = Cart.fromJson(suspended.cart);
    await _mutation(
      () => _repository.resume(
        _tenantId!,
        suspended.id,
        ResumeSaleRequest(
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
          idempotencyKey: _uuid(),
          expectedVersion: suspendedCart.version,
        ),
      ),
      'sale_resumed',
    );
  }

  Future<void> renameSuspended(SaleSnapshot suspended, String label) async {
    final safeLabel = label.trim();
    if (_mutationActive ||
        suspended.state != 'suspended' ||
        safeLabel.isEmpty) {
      return;
    }
    final suspendedCart = Cart.fromJson(suspended.cart);
    final previous = _state;
    _mutationActive = true;
    try {
      await _repository.rename(
        _tenantId!,
        suspended.id,
        RenameSuspendedSaleRequest(
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
          idempotencyKey: _uuid(),
          expectedVersion: suspendedCart.version,
          label: safeLabel,
        ),
      );
      _event('sale_suspended_renamed');
    } on AppException catch (error) {
      _failure(error, fallbackPhase: previous.phase);
    } finally {
      _mutationActive = false;
    }
    if (_state.errorCode == null) {
      await loadHistory(state: 'suspended');
    }
  }

  Future<void> cancel(String reason) async {
    final sale = _state.sale;
    final cart = _cart.state.cart;
    final safeReason = reason.trim();
    if (_mutationActive ||
        sale == null ||
        cart == null ||
        safeReason.isEmpty ||
        !_isEditable(_state.phase)) {
      return;
    }
    await _mutation(
      () => _repository.cancel(
        _tenantId!,
        sale.id,
        CancelSaleRequest(
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
          idempotencyKey: _uuid(),
          expectedVersion: cart.version,
          reason: safeReason,
        ),
      ),
      'sale_cancelled',
    );
  }

  Future<void> attachCustomer(SaleCustomerSummary customer) async {
    final sale = _state.sale;
    final cart = _cart.state.cart;
    if (_mutationActive ||
        sale == null ||
        cart == null ||
        !_isEditable(_state.phase)) {
      return;
    }
    await _mutation(
      () => _repository.attachCustomer(
        _tenantId!,
        sale.id,
        AttachSaleCustomerRequest(
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
          idempotencyKey: _uuid(),
          expectedVersion: cart.version,
          customerId: customer.id,
        ),
      ),
      'sale_customer_attached',
    );
  }

  Future<void> detachCustomer() async {
    final sale = _state.sale;
    final cart = _cart.state.cart;
    if (_mutationActive ||
        sale == null ||
        cart == null ||
        sale.customer == null) {
      return;
    }
    await _mutation(
      () => _repository.detachCustomer(
        _tenantId!,
        sale.id,
        SaleMutationRequest(
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
          idempotencyKey: _uuid(),
          expectedVersion: cart.version,
        ),
      ),
      'sale_customer_detached',
    );
  }

  Future<void> loadHistory({
    String? state,
    String search = '',
    String sort = 'newest',
  }) async {
    _historyState = state;
    _historySearch = search;
    _historySort = sort;
    _historyNextCursor = null;
    await _loadHistoryPage(append: false);
  }

  Future<void> loadMoreHistory() async {
    if (_historyNextCursor == null) return;
    await _loadHistoryPage(append: true);
  }

  Future<void> _loadHistoryPage({required bool append}) async {
    if (_tenantId == null || _historyLoading) return;
    _historyLoading = true;
    notifyListeners();
    try {
      final page = await _repository.history(
        _tenantId!,
        SaleHistoryQuery(
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
          state: _historyState,
          search: _historySearch,
          sort: _historySort,
          cursor: append ? _historyNextCursor : null,
          limit: 50,
        ),
      );
      _historyNextCursor = page.nextCursor;
      final items = page.items.map(SaleSnapshot.fromJson).toList();
      _set(
        SaleLifecycleState(
          phase: _state.phase,
          sale: _state.sale,
          history: append ? [..._state.history, ...items] : items,
          customers: _state.customers,
          receipt: _state.receipt,
        ),
      );
    } on AppException catch (error) {
      _failure(error);
    } finally {
      _historyLoading = false;
      notifyListeners();
    }
  }

  Future<void> searchCustomers(String search, {bool recent = false}) async {
    if (_tenantId == null) return;
    try {
      final result = await _repository.customers(
        _tenantId!,
        PosCustomerSearchQuery(
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
          search: search,
          recent: recent,
          limit: 20,
        ),
      );
      _set(
        SaleLifecycleState(
          phase: _state.phase,
          sale: _state.sale,
          history: _state.history,
          customers: result.items.map(SaleCustomerSummary.fromJson).toList(),
          receipt: _state.receipt,
        ),
      );
    } on AppException catch (error) {
      _failure(error);
    }
  }

  void checkoutStarted() {
    if (!_isEditable(_state.phase)) return;
    _set(
      SaleLifecycleState(
        phase: SalePhase.checkingOut,
        sale: _state.sale,
        history: _state.history,
        customers: _state.customers,
      ),
    );
  }

  void checkoutStopped() {
    if (_state.phase != SalePhase.checkingOut || _state.sale == null) return;
    _set(
      SaleLifecycleState(
        phase: _cart.state.cart?.status == 'prepared'
            ? SalePhase.readyForCheckout
            : SalePhase.buildingCart,
        sale: _state.sale,
        history: _state.history,
        customers: _state.customers,
        receipt: _state.receipt,
      ),
    );
  }

  Future<void> checkoutCommitted() async {
    if (_mutationActive ||
        _state.sale == null ||
        _state.phase != SalePhase.checkingOut) {
      return;
    }
    _set(
      SaleLifecycleState(
        phase: SalePhase.committed,
        sale: _state.sale,
        history: _state.history,
        customers: _state.customers,
      ),
    );
    await _start(readyForNextCustomer: true);
  }

  Future<bool> prepareForOperatorExit() async {
    if (!_isEditable(_state.phase)) return true;
    final cart = _cart.state.cart;
    if (cart == null) return true;
    if (cart.items.isEmpty) {
      await cancel('operator_session_ended');
      return _state.phase == SalePhase.cancelled;
    }
    await suspend(null);
    return _state.phase == SalePhase.suspended;
  }

  Future<void> openReceipt(SaleSnapshot sale) async {
    try {
      final receipt = await _repository.receipt(_tenantId!, sale.id, _query());
      _set(
        SaleLifecycleState(
          phase: _state.phase,
          sale: _state.sale,
          history: _state.history,
          customers: _state.customers,
          receipt: receipt,
        ),
      );
    } on AppException catch (error) {
      _failure(error);
    }
  }

  void clear() {
    _tenantId = null;
    _branchId = null;
    _operatorSessionId = null;
    _cart.clearLocal();
    _set(const SaleLifecycleState());
  }

  Future<void> _start({required bool readyForNextCustomer}) async {
    if (_mutationActive || _tenantId == null) return;
    _mutationActive = true;
    _set(const SaleLifecycleState(phase: SalePhase.loading));
    try {
      final sale = await _repository.start(
        _tenantId!,
        SaleContextRequest(
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
          idempotencyKey: _uuid(),
        ),
      );
      _apply(sale, readyForNextCustomer: readyForNextCustomer);
      _event(readyForNextCustomer ? 'next_sale_ready' : 'sale_started');
    } on AppException catch (error) {
      _failure(error);
    } finally {
      _mutationActive = false;
    }
  }

  Future<void> _mutation(
    Future<SaleSnapshot> Function() operation,
    String event,
  ) async {
    if (_mutationActive) return;
    final previous = _state;
    _mutationActive = true;
    _set(
      SaleLifecycleState(
        phase: SalePhase.loading,
        sale: _state.sale,
        history: _state.history,
        customers: _state.customers,
      ),
    );
    try {
      _apply(await operation());
      _event(event);
    } on AppException catch (error) {
      _failure(error, fallbackPhase: previous.phase);
    } finally {
      _mutationActive = false;
    }
  }

  void _apply(SaleSnapshot sale, {bool readyForNextCustomer = false}) {
    final cart = Cart.fromJson(sale.cart);
    _cart.restore(cart);
    _set(
      SaleLifecycleState(
        phase: _phase(sale.state),
        sale: sale,
        history: _state.history,
        customers: _state.customers,
        receipt: _state.receipt,
        readyForNextCustomer: readyForNextCustomer,
      ),
    );
  }

  void _failure(
    AppException error, {
    SalePhase fallbackPhase = SalePhase.failure,
  }) {
    _set(
      SaleLifecycleState(
        phase: fallbackPhase,
        sale: _state.sale,
        history: _state.history,
        customers: _state.customers,
        errorCode: error.code,
      ),
    );
  }

  SaleHistoryQuery _query() => SaleHistoryQuery(
    branchId: _branchId!,
    operatorSessionId: _operatorSessionId!,
    search: '',
    sort: 'newest',
    limit: 50,
  );

  bool get _isTerminalOrMissing =>
      _state.sale == null ||
      _state.phase == SalePhase.suspended ||
      _state.phase == SalePhase.committed ||
      _state.phase == SalePhase.cancelled;

  bool _isEditable(SalePhase phase) =>
      phase == SalePhase.buildingCart ||
      phase == SalePhase.readyForCheckout ||
      phase == SalePhase.recovered;

  SalePhase _phase(String value) => switch (value) {
    'building_cart' => SalePhase.buildingCart,
    'suspended' => SalePhase.suspended,
    'ready_for_checkout' => SalePhase.readyForCheckout,
    'committed' => SalePhase.committed,
    'cancelled' => SalePhase.cancelled,
    'recovered' => SalePhase.recovered,
    _ => SalePhase.failure,
  };

  void _event(String name) =>
      _telemetry.event(ClientEvent(name: name, values: const {}));

  void _set(SaleLifecycleState value) {
    _state = value;
    notifyListeners();
  }

  String _uuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }
}
