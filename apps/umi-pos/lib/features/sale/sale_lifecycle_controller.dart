import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/observability/telemetry.dart';
import '../cart/account_details_surface.dart' show accountIsBare;
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
  bool get isRestoringCurrent => _opening;

  /// Whether the sale on screen can take a command right now.
  ///
  /// Six commands guard on the same three things — not mid-mutation, a sale to
  /// name, a cart to version — and each wrote the condition out again, so a
  /// control offering them had no way to ask. They share this getter now, and the
  /// customer centre asks it: `Adjuntar a la venta` with no editable sale behind
  /// it used to look ready and answer a tap with a silent `return` — no request,
  /// no message, the screen unchanged. A control that cannot be honoured stands
  /// down and says why instead.
  bool get canEditSale =>
      !_opening &&
      !_mutationActive &&
      _state.sale != null &&
      _cart.state.cart != null &&
      _isEditable(_state.phase);
  bool get historyLoading => _historyLoading;
  bool get historyRefreshing => _historyLoading && !_historyAppending;
  String? get historyErrorCode => _historyErrorCode;
  bool get historyRefreshFailed =>
      _historyErrorCode != null && !_historyAppending;
  String? _merchantId;
  bool _useCartAuthority = false;
  String? _locationId;
  String? _operatorSessionId;
  bool _opening = false;
  bool _mutationActive = false;
  bool _resumingFromHistory = false;
  bool _historyLoading = false;
  bool _historyAppending = false;
  bool _disposed = false;
  int _historyGeneration = 0;
  String? _historyErrorCode;
  String? _historyNextCursor;
  String? _historyState;
  String _historySearch = '';
  String _historySort = 'newest';

  Future<void> open(
    String merchantId,
    String locationId,
    String operatorSessionId, {
    bool useCartAuthority = false,
    bool restoreCurrent = true,
  }) async {
    final sameScope =
        _merchantId == merchantId &&
        _locationId == locationId &&
        _operatorSessionId == operatorSessionId;
    // A fresh operator entry starts at the till, not inside whichever account
    // that operator session happened to leave active. The account remains
    // available in Cuentas and is resumed only after an explicit tap. Silent
    // restoration made an empty Comanda immediately turn into yesterday's or
    // another operator's work, with no way to tell whether that was intended.
    //
    // The scope still has to be bound here: `newSale` and the account commands
    // need merchant, branch and operator before the operator chooses anything.
    if (!restoreCurrent) {
      _historyGeneration++;
      _historyLoading = false;
      _historyNextCursor = null;
      _historyErrorCode = null;
      _merchantId = merchantId;
      _useCartAuthority = useCartAuthority;
      _locationId = locationId;
      _operatorSessionId = operatorSessionId;
      _opening = false;
      _set(const SaleLifecycleState());
      _event('sale_startup_ready_without_current');
      return;
    }
    if (sameScope && _state.sale != null) return;
    if (!sameScope) {
      _historyGeneration++;
      _historyLoading = false;
      _historyNextCursor = null;
      _historyErrorCode = null;
    }
    _merchantId = merchantId;
    _useCartAuthority = useCartAuthority;
    _locationId = locationId;
    _operatorSessionId = operatorSessionId;
    _opening = true;
    _set(const SaleLifecycleState(phase: SalePhase.loading));
    try {
      final recovered = await _repository.current(merchantId, _query());
      _apply(recovered);
      _event('sale_restored');
    } on AppException catch (error) {
      if (error.code != 'SALE_NOT_FOUND' &&
          error.code != 'RESOURCE_NOT_FOUND') {
        // No answer is not a failure to sell. The cart queue is the authority
        // for the sale being built and it works from the journal, so a cold
        // start with no uplink used to paint "we could not complete the sale
        // safely" over a till that could sell perfectly well. Reachability has
        // its own indicator; this screen stays neutral and the next successful
        // read fills it in.
        if (error.category == AppErrorCategory.transport ||
            error.category == AppErrorCategory.timeout ||
            error.category == AppErrorCategory.server) {
          _set(const SaleLifecycleState(phase: SalePhase.idle));
          _event('sale_offline_unknown');
          return;
        }
        _failure(error);
        return;
      }
      // A new operator has no account yet. Keep the menu ready and allocate a
      // folio only when the operator starts an order.
      _set(const SaleLifecycleState());
    } catch (_) {
      // A malformed current-sale answer must not stop the catalogue from
      // loading. Treat it like an unknown answer, not a refusal: the menu and
      // the local cart stay usable, and the next explicit action reads again.
      _set(const SaleLifecycleState());
      _event('sale_restore_unavailable');
    } finally {
      _opening = false;
      if (!_disposed) notifyListeners();
    }
  }

  /// Refresh the lifecycle after the server selects an account for this operator.
  Future<bool> refreshCurrent({required String expectedCartId}) async {
    if (_merchantId == null || _opening || _mutationActive) return false;
    try {
      final sale = await _repository.current(_merchantId!, _query());
      if (sale.id != expectedCartId) {
        throw const AppException(
          category: AppErrorCategory.conflict,
          code: 'CART_VERSION_CONFLICT',
          recoverable: true,
        );
      }
      _apply(sale);
      return true;
    } on AppException catch (error) {
      _failure(error);
      return false;
    }
  }

  void accountSaved() {
    _set(
      SaleLifecycleState(
        phase: SalePhase.suspended,
        history: _state.history,
        customers: _state.customers,
      ),
    );
  }

  /// Start a fresh sale.
  ///
  /// [abandonCurrent] is the operator saying "discard what is on screen". Without
  /// it this refuses while a sale is in progress, and refusing used to be silent:
  /// pressing `Nueva venta` with a cart on screen did NOTHING AT ALL, which the
  /// plan's own defect table records (`Nueva venta` does nothing with 180.00 in
  /// the cart). That silence is more expensive than it looks, because this button
  /// is the only way out of a checkout whose draft carries a payment claim — the
  /// cart cannot be paid and cannot be cancelled, so a button that quietly does
  /// nothing leaves the operator with no exit but killing the app.
  ///
  /// The confirmation belongs to the surface; abandoning belongs here. The old
  /// sale is left behind rather than erased: `cancel` marks the cart abandoned and
  /// its checkout draft, claim and all, stays for whoever reconciles it. A cancel
  /// that does not take leaves the phase where it was, and starting anyway would
  /// put a second editable sale beside the one that refused to go.
  Future<bool> newSale({bool abandonCurrent = false}) async {
    if (_opening || _mutationActive || _resumingFromHistory) return false;
    if (!_isTerminalOrMissing) {
      if (!abandonCurrent) return false;
      final sale = _state.sale;
      final cart = _cart.state.cart;
      if (sale == null || cart == null || !_isEditable(_state.phase)) {
        return false;
      }
      await cancel('other', note: 'Operator started a new order.');
      if (_state.phase != SalePhase.cancelled) return false;
    }
    await _start(readyForNextCustomer: false);
    return true;
  }

  Future<void> suspend(String? label) async {
    final sale = _state.sale;
    final cart = _cart.state.cart;
    if (!canEditSale || sale == null || cart == null) return;
    await _mutation(
      () => _repository.suspend(
        _merchantId!,
        sale.id,
        SuspendSaleRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          idempotencyKey: _uuid(),
          expectedVersion: cart.version,
          label: label?.trim().isEmpty ?? true ? null : label!.trim(),
        ),
      ),
      'sale_suspended',
    );
  }

  bool get canResumeFromHistory =>
      !_resumingFromHistory &&
      !_mutationActive &&
      (_isTerminalOrMissing ||
          (_isEditable(_state.phase) &&
              _cart.state.phase == CartPhase.ready &&
              _cart.state.cart?.items.isEmpty == true));

  Future<void> resumeFromHistory(SaleSnapshot suspended) async {
    if (!canResumeFromHistory || suspended.state != 'suspended') return;
    _resumingFromHistory = true;
    notifyListeners();
    try {
      if (!_isTerminalOrMissing) {
        await cancel(
          'other',
          note: 'Empty order replaced with a suspended order.',
        );
        if (_state.phase != SalePhase.cancelled) return;
      }
      await resume(suspended);
    } finally {
      _resumingFromHistory = false;
      notifyListeners();
    }
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
        _merchantId!,
        suspended.id,
        ResumeSaleRequest(
          locationId: _locationId!,
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
        _merchantId!,
        suspended.id,
        RenameSuspendedSaleRequest(
          locationId: _locationId!,
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

  /// Cancel the open sale.
  ///
  /// The reason is TYPED (plan §8.3): the legacy till took free text, and 16 of its
  /// 17 cancellations said "prueba" — a history nobody can measure. [note] is the
  /// operator's optional comment, never the reason itself.
  Future<void> cancel(String reasonCode, {String? note}) async {
    final sale = _state.sale;
    final cart = _cart.state.cart;
    final safeReason = reasonCode.trim();
    if (!canEditSale || sale == null || cart == null || safeReason.isEmpty) {
      return;
    }
    await _mutation(
      () => _repository.cancel(
        _merchantId!,
        sale.id,
        CancelSaleRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          idempotencyKey: _uuid(),
          expectedVersion: cart.version,
          reasonCode: safeReason,
          reason: (note?.trim().isEmpty ?? true) ? null : note!.trim(),
        ),
      ),
      'sale_cancelled',
    );
  }

  /// Void selected accounts from previous business days in one server command.
  Future<void> cancelCarriedOver(List<Cart> accounts) async {
    final repository = _repository;
    if (repository is! CarriedOverSaleRepository ||
        _merchantId == null ||
        _locationId == null ||
        _operatorSessionId == null ||
        accounts.isEmpty) {
      throw const AppException(
        category: AppErrorCategory.unsupported,
        code: 'SALE_CONTEXT_REQUIRED',
        recoverable: true,
      );
    }
    await (repository as CarriedOverSaleRepository).cancelCarriedOver(
      _merchantId!,
      CancelCarriedOverAccountsRequest(
        locationId: _locationId!,
        operatorSessionId: _operatorSessionId!,
        idempotencyKey: _uuid(),
        accounts: [
          for (final account in accounts)
            {'cartId': account.id, 'expectedVersion': account.version},
        ],
        reasonCode: 'other',
        reason: 'Anulada desde Días anteriores',
      ),
    );
    final currentId = _cart.state.cart?.id;
    if (currentId != null &&
        accounts.any((account) => account.id == currentId)) {
      _cart.clearLocal();
      _set(const SaleLifecycleState());
    }
    _event('carried_over_accounts_cancelled');
  }

  Future<void> attachCustomer(SaleCustomerSummary customer) async {
    final sale = _state.sale;
    final cart = _cart.state.cart;
    if (!canEditSale || sale == null || cart == null) return;
    await _mutation(
      () => _repository.attachCustomer(
        _merchantId!,
        sale.id,
        AttachSaleCustomerRequest(
          locationId: _locationId!,
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
        _merchantId!,
        sale.id,
        SaleMutationRequest(
          locationId: _locationId!,
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
    if (_disposed) return;
    _historyGeneration++;
    _historyState = state;
    _historySearch = search;
    _historySort = sort;
    _historyNextCursor = null;
    await _loadHistoryPage(append: false);
  }

  Future<void> loadMoreHistory() async {
    if (_historyNextCursor == null || _historyLoading || _disposed) return;
    await _loadHistoryPage(append: true);
  }

  Future<void> _loadHistoryPage({required bool append}) async {
    if (_merchantId == null || _disposed) return;
    final generation = _historyGeneration;
    bool isCurrent() => !_disposed && generation == _historyGeneration;
    _historyLoading = true;
    _historyAppending = append;
    _historyErrorCode = null;
    notifyListeners();
    try {
      final page = await _repository.history(
        _merchantId!,
        SaleHistoryQuery(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          state: _historyState,
          search: _historySearch,
          sort: _historySort,
          cursor: append ? _historyNextCursor : null,
          limit: 50,
        ),
      );
      if (!isCurrent()) return;
      _historyNextCursor = page.nextCursor;
      final items = page.items.map(SaleSnapshot.fromJson).toList();
      _set(
        SaleLifecycleState(
          phase: _state.phase,
          sale: _state.sale,
          history: append ? [..._state.history, ...items] : items,
          customers: _state.customers,
          receipt: _state.receipt,
          errorCode: _state.errorCode,
          readyForNextCustomer: _state.readyForNextCustomer,
        ),
      );
    } on AppException catch (error) {
      if (isCurrent()) _historyErrorCode = error.code;
    } finally {
      if (isCurrent()) {
        _historyLoading = false;
        notifyListeners();
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _historyGeneration++;
    super.dispose();
  }

  Future<void> searchCustomers(String search, {bool recent = false}) async {
    if (_merchantId == null) return;
    try {
      final result = await _repository.customers(
        _merchantId!,
        PosCustomerSearchQuery(
          locationId: _locationId!,
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
        readyForNextCustomer: true,
      ),
    );
  }

  /// Release the paid account when its receipt screen closes. The receipt still
  /// needs the paid cart while it is visible.
  void finishCheckoutPresentation({bool force = false}) {
    if (!force && _state.phase != SalePhase.committed) return;
    _cart.clearLocal();
    _set(
      SaleLifecycleState(
        history: _state.history,
        customers: _state.customers,
        readyForNextCustomer: true,
      ),
    );
  }

  /// Leave the till ready after a cancelled account without allocating a new folio.
  /// The next product or explicit new-account action starts that account.
  bool finishCancellationPresentation() {
    if (_state.phase != SalePhase.cancelled || !_cart.supportsOpenAccounts) {
      return false;
    }
    _cart.clearLocal();
    _set(
      SaleLifecycleState(history: _state.history, customers: _state.customers),
    );
    return true;
  }

  Future<bool> prepareForOperatorExit({bool useCartAuthority = false}) async {
    if (_resumingFromHistory) return false;
    final current = _cart.state.cart;
    if (_cart.supportsOpenAccounts &&
        _isEditable(_state.phase) &&
        current != null &&
        accountIsBare(current)) {
      // La API retoma el borrador del mismo operador al volver a entrar.
      // Anularlo aquí crea otra cuenta vacía y otro folio en cada sesión.
      return true;
    }
    if (_cart.supportsOpenAccounts && _cart.state.cart != null) {
      final saved = await _cart.saveAccount();
      if (saved) {
        accountSaved();
      } else {
        _failure(
          AppException(
            category: AppErrorCategory.conflict,
            code: _cart.state.errorCode ?? 'CART_VERSION_CONFLICT',
            recoverable: true,
          ),
        );
      }
      return saved;
    }
    if (!_isEditable(_state.phase)) return true;
    final cart = _cart.state.cart;
    if (cart == null) return true;
    if (cart.items.isEmpty) {
      await cancel(
        'other',
        note: 'Empty order closed when the operator session ended.',
      );
      return _state.phase == SalePhase.cancelled;
    }
    await suspend(null);
    return _state.phase == SalePhase.suspended;
  }

  Future<void> openReceipt(SaleSnapshot sale) async {
    try {
      final receipt = await _repository.receipt(
        _merchantId!,
        sale.id,
        _query(),
      );
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
    _merchantId = null;
    _locationId = null;
    _operatorSessionId = null;
    _cart.clearLocal();
    _set(const SaleLifecycleState());
  }

  Future<void> _start({required bool readyForNextCustomer}) async {
    if (_opening || _mutationActive || _merchantId == null) return;
    _mutationActive = true;
    _set(const SaleLifecycleState(phase: SalePhase.loading));
    try {
      final SaleSnapshot sale;
      if (_useCartAuthority) {
        _cart.clearLocal();
        await _cart.open(_merchantId!, _locationId!, _operatorSessionId!);
        final created = _cart.state.cart;
        if (created == null) {
          throw AppException(
            category: AppErrorCategory.conflict,
            code: _cart.state.errorCode ?? 'CART_VALIDATION_FAILED',
            recoverable: true,
          );
        }
        try {
          sale = await _repository.current(_merchantId!, _query());
        } on AppException catch (error) {
          if (_canContinueWithLocalCart(error)) {
            _set(const SaleLifecycleState(phase: SalePhase.buildingCart));
            _event('sale_started_local');
            return;
          }
          rethrow;
        }
        if (sale.id != created.id) {
          throw const AppException(
            category: AppErrorCategory.conflict,
            code: 'CART_VERSION_CONFLICT',
            recoverable: true,
          );
        }
      } else {
        sale = await _repository.start(
          _merchantId!,
          SaleContextRequest(
            locationId: _locationId!,
            operatorSessionId: _operatorSessionId!,
            idempotencyKey: _uuid(),
          ),
        );
      }
      _apply(sale, readyForNextCustomer: readyForNextCustomer);
      _event(readyForNextCustomer ? 'next_sale_ready' : 'sale_started');
    } on AppException catch (error) {
      _failure(error);
    } finally {
      _mutationActive = false;
    }
  }

  bool _canContinueWithLocalCart(AppException error) =>
      _cart.state.cart != null &&
      (error.category == AppErrorCategory.transport ||
          error.category == AppErrorCategory.timeout ||
          error.category == AppErrorCategory.server ||
          error.category == AppErrorCategory.unknown);

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
    _cart.restore(cart, operatorSessionId: _operatorSessionId);
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
    locationId: _locationId!,
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
