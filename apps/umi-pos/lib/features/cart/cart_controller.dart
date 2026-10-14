import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/observability/telemetry.dart';
import '../../shared/approvals/manager_approval_repository.dart';
import 'cart_repository.dart';

enum CartPhase { idle, loading, ready, validationFailure, failure }

/// The string a manager's elevation is bound to when it authorizes cancelling a line the
/// kitchen ALREADY started.
///
/// The API's twin is `voidAfterPreparationFingerprint` in
/// `apps/umi-api/src/shared/orders/void-after-preparation-fingerprint.ts`: the same six
/// fields, joined with ':' in this order and hashed as sha256 hex. The elevation is
/// granted against one value and spent against the other, so a change to this order is a
/// change to both files or the approval stops matching the act it authorized — which is
/// what `test/void_after_preparation_fingerprint_test.dart` and the API's own spec pin
/// down with the same expected hash.
String voidAfterPreparationFingerprint({
  required String merchantId,
  required String locationId,
  required String cartId,
  required String lineId,
  required String reasonCode,
  required int expectedVersion,
}) => sha256
    .convert(
      utf8.encode(
        [
          merchantId,
          locationId,
          cartId,
          lineId,
          reasonCode,
          expectedVersion,
        ].join(':'),
      ),
    )
    .toString();

final class CartState {
  const CartState({
    this.phase = CartPhase.idle,
    this.cart,
    this.errorCode,
    this.errorDetails,
  });
  final CartPhase phase;
  final Cart? cart;
  final String? errorCode;
  final Map<String, Object?>? errorDetails;
}

final class CartController extends ChangeNotifier {
  CartController({
    required CartRepository repository,
    required Telemetry telemetry,
    ManagerApprovalRepository? approvals,
  }) : _repository = repository,
       _approvals = approvals,
       _telemetry = telemetry;
  final CartRepository _repository;
  final ManagerApprovalRepository? _approvals;
  final Telemetry _telemetry;
  CartState _state = const CartState();
  CartState get state => _state;
  String? _merchantId;
  String? _locationId;
  String? _operatorSessionId;

  /// The lifecycles the server still accepts writes on.
  ///
  /// The API's twin is the guard every cart write carries —
  /// `AND lifecycle_state IN ('building_cart','ready_for_checkout','recovered')`
  /// in `bump()` of `pos-cart.repository.ts`. A cart outside that list answers every
  /// command with `CART_VALIDATION_FAILED`, so a till holding one has no move left:
  /// add, remove, clear and save all refuse. Measured on the iMin D3-504 on
  /// 2026-10-13: the account was suspended from the sales screen, the comanda panel
  /// kept showing it, and twelve minutes of taps were answered `409` while the panel
  /// looked frozen.
  static const _writableLifecycles = {
    'building_cart',
    'ready_for_checkout',
    'recovered',
  };

  /// One verification at a time, so two refused writes do not race to release the
  /// same account and the second read is not about a cart already let go.
  bool _verifyingRelease = false;

  bool get supportsOpenAccounts => _repository is OpenAccountCartRepository;
  bool get supportsAccountDetails =>
      _repository is AccountDetailsCartRepository;

  Future<bool> renameAccount(String? name) async {
    final cart = _state.cart;
    final repository = _repository;
    if (cart == null ||
        repository is! AccountDetailsCartRepository ||
        _state.phase == CartPhase.loading) {
      return false;
    }
    final cleanName = name?.trim();
    return _mutation(
      () => (repository as AccountDetailsCartRepository).setAccountDetails(
        _merchantId!,
        cart.id,
        SetCartAccountDetailsRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
          accountName: cleanName == null || cleanName.isEmpty
              ? null
              : cleanName,
        ),
      ),
      'account_renamed',
    );
  }

  Future<bool> assignAccountTable(String tableId) async {
    final cart = _state.cart;
    final repository = _repository;
    if (cart == null ||
        repository is! AccountDetailsCartRepository ||
        _state.phase == CartPhase.loading) {
      return false;
    }
    return _mutation(
      () => (repository as AccountDetailsCartRepository).assignAccountTable(
        _merchantId!,
        cart.id,
        AssignCartTableRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
          tableId: tableId,
        ),
      ),
      'account_table_assigned',
    );
  }

  bool get supportsSentLineCancellation =>
      _repository is SentCartLineRepository;

  /// Whether this till can ask a manager to authorize the cancel of a line the kitchen
  /// already started. It is a separate capability from cancelling one the kitchen has
  /// not: the first needs an approval repository, the second needs none.
  bool get supportsVoidAfterPreparationApproval => _approvals != null;

  /// Ask a manager for the PIN that authorizes voiding a line the kitchen started.
  ///
  /// Returns the elevation the server granted, together with the fingerprint it was
  /// granted against — the caller hands BOTH back to [cancelSentLine], which is what
  /// makes the approval cover this cancel and not the next one. A refusal arrives as an
  /// [AppException] the surface shows, exactly as the cash approvals do.
  Future<({String approvalId, String fingerprint})?>
  approveVoidAfterPreparation({
    required CartItem item,
    required String reasonCode,
    required String managerPin,
  }) async {
    final cart = _state.cart;
    final approvals = _approvals;
    if (cart == null || approvals == null || !item.fired) return null;
    final fingerprint = voidAfterPreparationFingerprint(
      merchantId: _merchantId!,
      locationId: _locationId!,
      cartId: cart.id,
      lineId: item.id,
      reasonCode: reasonCode,
      expectedVersion: cart.version,
    );
    final grant = await approvals.approve(
      ManagerApprovalRequest(
        operatorSessionId: _operatorSessionId!,
        managerPin: managerPin,
        merchantId: _merchantId!,
        locationId: _locationId!,
        permission: voidAfterPreparationPermission,
        commandFingerprint: fingerprint,
      ),
    );
    return (approvalId: grant.elevationId, fingerprint: fingerprint);
  }

  /// The permission the approver must hold to authorize this cancel. It is its OWN key,
  /// not the sale-exception one: the owner's rule is that only an admin authorizes a dish
  /// the kitchen already made, and `sale.void.create` belongs to four roles. The API names
  /// the permission back in the refusal's field errors, so this constant and that answer
  /// cannot drift silently.
  static const String voidAfterPreparationPermission =
      'order.void_after_preparation.approve';

  Future<bool> cancelSentLine(
    CartItem item,
    String reasonCode, {
    String? approvalId,
    String? actionFingerprint,
  }) async {
    final cart = _state.cart;
    final repository = _repository;
    if (cart == null ||
        !item.fired ||
        repository is! SentCartLineRepository ||
        _state.phase == CartPhase.loading) {
      return false;
    }
    return _mutation(
      () => (repository as SentCartLineRepository).cancelSentLine(
        _merchantId!,
        item.id,
        RemoveSentCartLineRequest(
          cartId: cart.id,
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
          reasonCode: reasonCode,
          approvalId: approvalId,
          approvalFingerprint: actionFingerprint,
        ),
      ),
      'sent_line_cancelled',
    );
  }

  CartQuery get _query => CartQuery(
    locationId: _locationId!,
    operatorSessionId: _operatorSessionId!,
  );

  /// Save the account on the server without a kitchen command.
  Future<bool> saveAccount({
    String? accountName,
    bool updateName = false,
  }) async {
    final cart = _state.cart;
    final repository = _repository;
    if (cart == null ||
        repository is! OpenAccountCartRepository ||
        _merchantId == null ||
        _state.phase == CartPhase.loading) {
      return false;
    }
    return _mutation(
      () => (repository as OpenAccountCartRepository).suspendAccount(
        _merchantId!,
        cart: cart,
        query: _query,
        idempotencyKey: _uuid(),
        accountName: accountName?.trim().isEmpty == true
            ? null
            : accountName?.trim(),
        updateName: updateName,
      ),
      'account_saved',
    );
  }

  Future<List<Cart>> openAccounts(
    String merchantId,
    String locationId,
    String operatorSessionId,
  ) async {
    final repository = _repository;
    if (repository is! OpenAccountCartRepository) return const [];
    return (repository as OpenAccountCartRepository).openAccounts(
      merchantId,
      CartQuery(locationId: locationId, operatorSessionId: operatorSessionId),
    );
  }

  /// Read another account without claiming it or replacing the current cart.
  Future<Cart> readAccount(Cart account, String operatorSessionId) {
    return (_repository as OpenAccountCartRepository).account(
      account.merchantId,
      account.id,
      CartQuery(
        locationId: account.locationId,
        operatorSessionId: operatorSessionId,
      ),
    );
  }

  /// Open or recover the table's account. Save the current account first.
  Future<bool> openTableAccount({
    required String merchantId,
    required String locationId,
    required String operatorSessionId,
    required String tableId,
  }) async {
    final repository = _repository;
    if (repository is! OpenAccountCartRepository ||
        _state.phase == CartPhase.loading) {
      return false;
    }
    var current = _state.cart;
    if (current?.tableId != null &&
        current!.tableId != tableId &&
        _merchantId == merchantId &&
        _locationId == locationId &&
        _operatorSessionId == operatorSessionId) {
      // Moving a table changes the account version and table in the API.
      // Read that account before deciding whether this is another account.
      await refresh();
      if (_state.phase != CartPhase.ready) return false;
      current = _state.cart;
    }
    if (current?.tableId == tableId &&
        _merchantId == merchantId &&
        _locationId == locationId &&
        _operatorSessionId == operatorSessionId) {
      return true;
    }
    if (current != null && !await saveAccount()) return false;
    if (current != null) clearLocal();
    _merchantId = merchantId;
    _locationId = locationId;
    _operatorSessionId = operatorSessionId;
    return _mutation(
      () => (repository as OpenAccountCartRepository).openTableAccount(
        merchantId,
        query: _query,
        tableId: tableId,
        idempotencyKey: _uuid(),
      ),
      'table_account_opened',
    );
  }

  Future<Cart> _readSelected() {
    final repository = _repository;
    final cart = _state.cart!;
    return repository is OpenAccountCartRepository
        ? (repository as OpenAccountCartRepository).account(
            _merchantId!,
            cart.id,
            _query,
          )
        : _repository.read(_merchantId!, _query);
  }

  Future<bool> resumeAccount({
    required Cart account,
    required String operatorSessionId,
  }) async {
    final repository = _repository;
    if (repository is! OpenAccountCartRepository ||
        _state.phase == CartPhase.loading) {
      return false;
    }
    if (_state.cart?.id == account.id &&
        _operatorSessionId == operatorSessionId) {
      return true;
    }
    if (_state.cart != null && !await saveAccount()) return false;
    clearLocal();
    _merchantId = account.merchantId;
    _locationId = account.locationId;
    _operatorSessionId = operatorSessionId;
    return _mutation(
      () => (repository as OpenAccountCartRepository).resumeAccount(
        _merchantId!,
        cart: account,
        query: _query,
        idempotencyKey: _uuid(),
      ),
      'account_resumed',
    );
  }

  Future<void> open(
    String merchantId,
    String locationId,
    String operatorSessionId,
  ) async {
    final key = '$merchantId:$locationId:$operatorSessionId';
    if ('$_merchantId:$_locationId:$_operatorSessionId' == key &&
        _state.cart != null) {
      return;
    }
    clearLocal();
    _merchantId = merchantId;
    _locationId = locationId;
    _operatorSessionId = operatorSessionId;
    _set(const CartState(phase: CartPhase.loading));
    try {
      final cart = await _repository.create(
        merchantId,
        CreateCartRequest(
          locationId: locationId,
          operatorSessionId: operatorSessionId,
          idempotencyKey: _uuid(),
        ),
      );
      _set(CartState(phase: CartPhase.ready, cart: cart));
    } on AppException catch (error) {
      _failure(error);
    }
    _event('cart_opened');
  }

  void restore(Cart cart, {String? operatorSessionId}) {
    _merchantId = cart.merchantId;
    _locationId = cart.locationId;
    _operatorSessionId = operatorSessionId ?? cart.operatorSessionId;
    _set(CartState(phase: CartPhase.ready, cart: cart));
  }

  /// Re-read the cart so its version is the server's.
  ///
  /// The version is the optimistic guard every cart write and the checkout
  /// commit carry. Anything that moves the cart server-side without the till
  /// seeing the answer — a cancelled checkout bumps it — leaves the till a
  /// write behind, and a commit anchored on that copy is refused forever.
  Future<void> refresh() async {
    final cart = _state.cart;
    if (cart == null ||
        _merchantId == null ||
        _locationId == null ||
        _operatorSessionId == null) {
      return;
    }
    try {
      final refreshed = await _readSelected();
      _set(CartState(phase: CartPhase.ready, cart: refreshed));
    } on AppException catch (error) {
      _failure(error);
    }
  }

  /// Returns true only when the server took the line. A refusal lands in the cart's
  /// own error state — and the caller MUST read this answer before treating the add
  /// as done, because the counter on the frequent-products rail is fed from here
  /// (audit F9). It used to count every tap on a product the API had refused.
  Future<bool> add({
    required String productId,
    String? variantId,
    List<Map<String, Object?>> modifiers = const [],
    int quantity = 1,
    String? note,
    int courseNumber = 1,
  }) async {
    // TEMPORARY INSTRUMENT — remove once the phantom line is named.
    //
    // The owner reports a cart line appearing when nobody is using the till
    // ("se añade un americano solo", 2026-10-12). Every path that puts a line in a
    // cart comes through here, so this prints WHICH path it was, with the first
    // frames of its own stack: a scan, a tile, the frequent rail, the line editor or
    // something nobody has thought of yet. Reading it back is the difference between
    // fixing the caller and guessing at it.
    if (const bool.fromEnvironment('UMIPOS_DEVELOPMENT_DIAGNOSTICS')) {
      final frames = StackTrace.current
          .toString()
          .split('\n')
          .take(5)
          .join(' | ');
      debugPrint('[umipos] cart add: $productId x$quantity <- $frames');
    }
    final cart = _state.cart;
    if (cart == null ||
        _merchantId == null ||
        _locationId == null ||
        _operatorSessionId == null) {
      // A till with no open sale used to drop the line here and say nothing:
      // the operator tapped a product, the pane closed, and the cart stayed
      // empty. Refusing out loud is the whole difference.
      throw const AppException(
        category: AppErrorCategory.conflict,
        code: 'CART_NOT_OPEN',
        recoverable: true,
      );
    }
    return _mutation(
      () => _repository.add(
        _merchantId!,
        CartLineInput(
          cartId: cart.id,
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          productId: productId,
          variantId: variantId,
          modifierSelections: modifiers,
          quantity: quantity,
          courseNumber: courseNumber,
          note: (note?.trim().isEmpty ?? true) ? null : note!.trim(),
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
        ),
      ),
      'product_added',
    );
  }

  Future<void> quantity(CartItem item, int quantity) async {
    if (quantity <= 0) {
      return remove(item);
    }
    final cart = _state.cart;
    if (cart == null) return;
    await _mutation(
      () => _repository.update(
        _merchantId!,
        item.id,
        CartLineInput(
          cartId: cart.id,
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          productId: item.productId,
          variantId: item.variant?['variantId'] as String?,
          modifierSelections: item.modifiers
              .map(
                (value) => {
                  'modifierId': value['modifierId']!,
                  'quantity': value['quantity']!,
                },
              )
              .toList(),
          quantity: quantity.clamp(1, 999).toInt(),
          // The course is not what this action is about, so it rides along
          // unchanged: the line is rewritten whole, and a missing course here
          // would silently drop a dessert back to course 1.
          courseNumber: item.courseNumber,
          note: item.note,
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
        ),
      ),
      'quantity_changed',
    );
  }

  Future<void> remove(CartItem item) async {
    final cart = _state.cart;
    if (cart == null) return;
    await _mutation(
      () => _repository.remove(
        _merchantId!,
        item.id,
        RemoveCartLineRequest(
          cartId: cart.id,
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
        ),
      ),
      'product_removed',
    );
  }

  Future<void> clear() async {
    final cart = _state.cart;
    if (cart == null || cart.items.isEmpty) return;
    await _mutation(
      () => _repository.clear(
        _merchantId!,
        ClearCartRequest(
          cartId: cart.id,
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
        ),
      ),
      'cart_cleared',
    );
  }

  /// Returns true only when the server rewrote the line — same contract as `add`.
  Future<bool> edit({
    required CartItem item,
    required String? variantId,
    required List<Map<String, Object?>> modifiers,
    required int quantity,
    required String? note,
    required int courseNumber,
  }) async {
    final cart = _state.cart;
    if (cart == null) return false;
    return _mutation(
      () => _repository.update(
        _merchantId!,
        item.id,
        CartLineInput(
          cartId: cart.id,
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          productId: item.productId,
          variantId: variantId,
          modifierSelections: modifiers,
          quantity: quantity.clamp(1, 999).toInt(),
          courseNumber: courseNumber,
          note: (note?.trim().isEmpty ?? true) ? null : note!.trim(),
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
        ),
      ),
      'cart_line_edited',
    );
  }

  Future<void> prepare() async {
    final cart = _state.cart;
    if (cart == null || cart.items.isEmpty) return;
    await _mutation(
      () => _repository.prepare(
        _merchantId!,
        PrepareSaleRequest(
          cartId: cart.id,
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
        ),
      ),
      'totals_loaded',
    );
  }

  /// Send this cart to the kitchen before the money — the fired order of
  /// `docs/architecture/2026-10-07-pos-fired-order-adr.md`.
  ///
  /// Firing writes the order and its kitchen ticket without a payment, and the
  /// server freezes the lines the kitchen already has. On success the cart is
  /// re-read, so `firedOrderId` and each line's `fired` marker become the view's
  /// own facts instead of the client's memory of one call.
  ///
  /// A cart that fired accepts new lines, and firing again sends only those (plan
  /// §8.2 F6): the second round appends to the order and the ticket the cart
  /// already owns. Returns the fire result, or null when the fire was refused (the
  /// state carries the refusal code) or there was nothing new to send.
  Future<FireOrderResult?> fire() async {
    final cart = _state.cart;
    if (cart == null ||
        _merchantId == null ||
        _locationId == null ||
        _operatorSessionId == null ||
        _state.phase == CartPhase.loading) {
      return null;
    }
    // Nothing new to send: a cart whose every line already reached the kitchen has
    // nothing to add to the ticket it owns.
    if (!cart.items.any((item) => item['fired'] != true)) return null;
    _set(CartState(phase: CartPhase.loading, cart: cart));
    try {
      final result = await _repository.fire(
        _merchantId!,
        FireOrderRequest(
          cartId: cart.id,
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
        ),
      );
      final refreshed = await _readSelected();
      _set(CartState(phase: CartPhase.ready, cart: refreshed));
      _event('order_fired');
      return result;
    } on AppException catch (error) {
      _failure(error);
      return null;
    }
  }

  /// Set how the order leaves the counter — `dine_in` or `takeout` (plan §8.2 F3,
  /// decision D5).
  ///
  /// The operator's choice in the top bar is a cart fact, not screen state: the
  /// fire and the checkout read it from the cart so a takeaway sale reaches the
  /// order as a takeaway.
  ///
  /// A CART THAT ALREADY FIRED ACCEPTS THE CHANGE TOO (owner, 2026-10-12). It used
  /// to refuse, on the argument that the order already existed with its type — but
  /// the ordinary case is a guest who sat down, ordered, and then takes the food
  /// away, and refusing left the crew with a till that could not record what the
  /// guest had just asked for. The server carries the new type onto the order the
  /// cart already fired, so the record follows the sale even though the paper the
  /// kitchen holds says what it said when it was fired.
  ///
  /// A takeout account also loses its table — the server clears it and gives it
  /// back to the floor plan — which is why the screen asks first.
  Future<void> setFulfillment(String fulfillmentType) async {
    final cart = _state.cart;
    if (cart == null ||
        _merchantId == null ||
        _locationId == null ||
        _operatorSessionId == null) {
      return;
    }
    if (cart.fulfillmentType == fulfillmentType) {
      return;
    }
    await _mutation(
      () => _repository.setFulfillment(
        _merchantId!,
        SetCartFulfillmentRequest(
          cartId: cart.id,
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          fulfillmentType: fulfillmentType,
          expectedVersion: cart.version,
          idempotencyKey: _uuid(),
        ),
      ),
      'cart_fulfillment_set',
    );
  }

  void clearLocal() {
    if (_state.phase == CartPhase.idle &&
        _state.cart == null &&
        _merchantId == null &&
        _locationId == null &&
        _operatorSessionId == null) {
      return;
    }
    _merchantId = null;
    _locationId = null;
    _operatorSessionId = null;
    _state = const CartState();
    notifyListeners();
  }

  /// True when the server accepted the command. The exception is captured into the
  /// cart's error state either way — the caller is the one that has to know whether
  /// the write landed, so it is answered here instead of guessed from the state.
  Future<bool> _mutation(Future<Cart> Function() action, String event) async {
    if (_state.phase == CartPhase.loading) return false;
    _set(CartState(phase: CartPhase.loading, cart: _state.cart));
    try {
      final cart = await action();
      _set(CartState(phase: CartPhase.ready, cart: cart));
      _event(event);
      return true;
    } on AppException catch (error) {
      _failure(error);
      return false;
    }
  }

  void _failure(AppException error) {
    _event('validation_failed');
    _set(
      CartState(
        phase: error.code == 'CART_VALIDATION_FAILED'
            ? CartPhase.validationFailure
            : CartPhase.failure,
        cart: _state.cart,
        errorCode: error.code,
        errorDetails: error.details,
      ),
    );
    // `CART_VALIDATION_FAILED` is one code for two different facts: a product that
    // cannot be ordered right now — which the operator fixes by looking at the screen
    // — and an account the server no longer takes writes on because it was suspended
    // or closed somewhere else, which no amount of retrying fixes. The till cannot
    // tell them apart from the code alone, so it asks the server and only lets go of
    // the account when the server's own read says the account is not the till's to
    // write any more.
    if (error.code == 'CART_VALIDATION_FAILED') {
      unawaited(_releaseIfAccountClosed());
    }
  }

  /// Let go of a cart the server has stopped accepting writes on.
  ///
  /// This is the way out of the dead end: a suspended account kept in the panel used
  /// to answer every action with the same sentence about an unavailable product, and
  /// the only exit was restarting the app. Verified against the read, never assumed —
  /// a plain refusal leaves the account where it is.
  Future<void> _releaseIfAccountClosed() async {
    final cart = _state.cart;
    if (cart == null ||
        _verifyingRelease ||
        _merchantId == null ||
        _locationId == null ||
        _operatorSessionId == null ||
        _state.phase == CartPhase.loading) {
      return;
    }
    _verifyingRelease = true;
    try {
      final reread = await _readSelected();
      if (_isWritable(reread)) return;
      _releaseAccount();
    } on AppException catch (error) {
      // A cart that is gone altogether is also a cart with nothing left to write on.
      if (error.code == 'CART_NOT_FOUND' ||
          error.code == 'RESOURCE_NOT_FOUND') {
        _releaseAccount();
      }
    } finally {
      _verifyingRelease = false;
    }
  }

  bool _isWritable(Cart cart) {
    final lifecycle = cart.lifecycleState;
    return (cart.status == 'draft' || cart.status == 'prepared') &&
        (lifecycle == null || _writableLifecycles.contains(lifecycle));
  }

  /// Drop the cart and say why. The account is not lost — it is on the server, in
  /// `Cuentas`, which is where the operator picks it up again.
  void _releaseAccount() {
    _merchantId = null;
    _locationId = null;
    _operatorSessionId = null;
    _set(
      const CartState(phase: CartPhase.idle, errorCode: 'CART_ACCOUNT_CLOSED'),
    );
    _event('account_released');
  }

  void _event(String name) =>
      _telemetry.event(ClientEvent(name: name, values: const {}));
  void _set(CartState value) {
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
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
        '${hex.substring(16, 20)}-${hex.substring(20)}';
  }
}
