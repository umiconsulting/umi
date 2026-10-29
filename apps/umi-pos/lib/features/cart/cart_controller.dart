import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/observability/telemetry.dart';
import '../../core/storage/local_working_copy.dart';
import '../../shared/approvals/manager_approval_repository.dart';
import '../../shared/business_day.dart';
import '../kitchen/hub_command_forwarder.dart';
import '../offline/connectivity_controller.dart';
import '../offline/offline_journal.dart';
import '../offline/replay_engine.dart';
import 'cart_command_queue.dart';
import 'cart_optimism.dart';
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
    LocalWorkingCopy? workingCopy,
    EncryptedOfflineJournal? offlineJournal,
    CartDeviceIdentity? Function()? deviceIdentity,
    ConnectivityController? connectivity,
    OfflineRecoveryController? recovery,
    HubCommandForwarder? hub,
  }) : _repository = repository,
       _approvals = approvals,
       _telemetry = telemetry,
       _workingCopy = workingCopy,
       _deviceIdentity = deviceIdentity,
       _journal = offlineJournal,
       _connectivity = connectivity {
    _journal?.pendingCount.addListener(_journalCountChanged);
    if (offlineJournal != null && deviceIdentity != null) {
      _queue = CartCommandQueue(
        repository: repository,
        journal: offlineJournal,
        scope: _queueScope,
        onCart: _acceptQueuedCart,
        onError: _failure,
        onEvent: _event,
        onBusy: _setQueueBusy,
        onSettled: notifyListeners,
        connectivity: connectivity,
        recovery: recovery,
        hub: hub,
      );
      if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
        debugPrint('[umipos] cart queue=available');
      }
    } else if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
      debugPrint('[umipos] cart queue=unavailable');
    }
  }
  final CartRepository _repository;
  final ManagerApprovalRepository? _approvals;
  final ConnectivityController? _connectivity;
  final Telemetry _telemetry;
  final LocalWorkingCopy? _workingCopy;
  final CartDeviceIdentity? Function()? _deviceIdentity;
  final EncryptedOfflineJournal? _journal;
  CartCommandQueue? _queue;
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

  /// A write is on the wire.
  ///
  /// This is what serializes the till's writes onto one account. It used to be
  /// spelled "the state says `loading`", which had the side effect of greying the
  /// screen for every tap; now that a predicted cart is painted at once the state
  /// stays `ready`, so the fact needs its own name. It is the client's half of the
  /// server's rule that only one writer holds an account at a time
  /// (`CART_ACCOUNT_BUSY`, `apps/umi-api/src/modules/pos-cart/pos-cart.repository.ts`).
  bool _inFlight = false;
  bool _disposed = false;

  /// True while a direct cart write is on the wire.
  ///
  /// A command waiting in [CartCommandQueue] is already durable and already
  /// painted. Treating that backlog as a write in progress greyed out editing,
  /// split and charge while the till retried an unrelated earlier command; the
  /// operator then needed an app restart to recover an account that was usable
  /// all along. The queue is the serialization point for line edits, so its
  /// backlog is synchronization status, not a lock on the account.
  bool get isWriting => _inFlight || _state.phase == CartPhase.loading;

  /// Local commands that have not reached the server yet.
  ///
  /// This is deliberately separate from [isWriting]: the header may say there
  /// is local work without disabling the next tap.
  bool get hasPendingLocalWrites => _queue?.hasPending ?? false;

  /// Durable unsynced work, as the operator must see it.
  ///
  /// The queue also holds an in-memory list of commands it has not finished
  /// sending. That list is an implementation detail: a command can succeed on
  /// the server and still sit there until the next settle pass. Counting it
  /// here made the header say "1 local" over an empty journal and kept
  /// "Dividir cuenta" disabled after the server had accepted every step. The
  /// journal is the authority once secure offline storage is available.
  int get pendingSyncCount {
    final journal = _journal;
    if (journal != null && journal.supportsSecureOffline) {
      return journal.pendingCount.value;
    }
    return _queue?.pendingCount ?? 0;
  }

  bool get hasPendingForCurrentCart {
    final cartId = _state.cart?.id;
    if (cartId == null) return pendingSyncCount > 0;
    return (_queue?.hasPending ?? false) ||
        (_journal?.hasPendingForCart(cartId) ?? false);
  }

  void _journalCountChanged() {
    if (!_disposed) notifyListeners();
  }

  /// Idle means neither a write on the wire nor an account being opened.
  bool get _busy =>
      _inFlight ||
      _state.phase == CartPhase.loading ||
      (_queue?.hasPending ?? false);

  bool get supportsOpenAccounts => _repository is OpenAccountCartRepository;
  bool get supportsLocalWrites =>
      _queue != null && (_journal?.supportsSecureOffline ?? false);
  bool get supportsAccountDetails =>
      _repository is AccountDetailsCartRepository;

  Future<bool> renameAccount(String? name) async {
    final cart = _state.cart;
    final repository = _repository;
    if (cart == null || repository is! AccountDetailsCartRepository || _busy) {
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
      // The name is the till's own fact: nothing the server knows can change it,
      // so the prediction is not a guess.
      predict: () => optimisticRenameAccount(
        cart,
        cleanName == null || cleanName.isEmpty ? null : cleanName,
      ),
    );
  }

  Future<bool> assignAccountTable(String tableId, {String? tableName}) async {
    final cart = _state.cart;
    final repository = _repository;
    if (cart == null || repository is! AccountDetailsCartRepository) {
      return false;
    }
    // This is the path the counter takes ("Cobrar" asks for the table), and it
    // is a different method from `openTableAccount`. Guarding it exactly the
    // same way keeps one rule for both: offline, the table choice is journaled
    // and the server validates the claim when the command lands.
    // A pending line is not a reason to refuse the table. The queue owns the
    // order of writes, so the assignment waits behind the line that is already
    // painted instead of racing it with an older cart version. Refusing here
    // made "Agregar mesa" show a stale product error and left the account
    // tableless whenever a line had not settled yet.
    if (_queue != null && (_connectivityIsDown || _queue!.hasPending)) {
      return _queueTableLocally(
        merchantId: _merchantId!,
        locationId: _locationId!,
        operatorSessionId: _operatorSessionId!,
        tableId: tableId,
        tableName: tableName,
      );
    }
    if (_busy) return false;
    final assigned = await _mutation(
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
    if (!assigned && _queue != null && _tableWriteCanWait()) {
      return _queueTableLocally(
        merchantId: _merchantId!,
        locationId: _locationId!,
        operatorSessionId: _operatorSessionId!,
        tableId: tableId,
        tableName: tableName,
      );
    }
    return assigned;
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
        _busy) {
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
        _busy) {
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

  /// Make the current local lane durable before starting another account.
  ///
  /// This is the account-switch boundary, not a server save: the commands keep
  /// their order in the journal and the following `pos.cart.open` will park the
  /// previous account when replay reaches it. No command is dropped merely
  /// because the operator changed customers.
  Future<bool> preserveForAccountSwitch() async {
    return preservePendingCommands();
  }

  /// Make every painted cart command durable before a local financial commit.
  ///
  /// The checkout consumes the same encrypted journal. Without this barrier a
  /// line still waiting in the in-memory lane could be missing when replay
  /// reaches the checkout, and the server would refuse a total built on that
  /// line.
  Future<bool> preservePendingCommands() async {
    final queue = _queue;
    if (queue == null || !queue.hasPending) return true;
    return queue.preservePendingCommands();
  }

  Future<bool> _settleConfirmedQueueForAccountSwitch() async {
    final queue = _queue;
    if (queue == null || !queue.hasPending) return true;
    final journal = _journal;
    if (journal == null) return false;
    try {
      final snapshot = await journal.load();
      if (snapshot.pendingCount != 0) {
        _failure(
          const AppException(
            category: AppErrorCategory.conflict,
            code: 'OFFLINE_SYNC_PENDING',
            recoverable: true,
          ),
        );
        return false;
      }
      queue.clearSettledCommands();
      _setQueueBusy(false);
      return true;
    } catch (_) {
      _failure(
        const AppException(
          category: AppErrorCategory.storage,
          code: 'OFFLINE_SYNC_PENDING',
          recoverable: true,
        ),
      );
      return false;
    }
  }

  Future<List<Cart>> openAccounts(
    String merchantId,
    String locationId,
    String operatorSessionId, {
    bool preferCache = false,
  }) async {
    final repository = _repository;
    if (repository is! OpenAccountCartRepository) return const [];
    final query = CartQuery(
      locationId: locationId,
      operatorSessionId: operatorSessionId,
    );
    final cached = await _readCachedAccounts(merchantId, query);
    if (preferCache && cached != null) {
      unawaited(
        _refreshCachedAccounts(
          repository as OpenAccountCartRepository,
          merchantId,
          query,
        ),
      );
      return cached;
    }
    try {
      // The account screen is a decision surface. Returning yesterday's cache
      // first painted accounts the server had already closed, then a refresh
      // needed a second tap to reveal the truth. Offline remains cache-first via
      // the fallback below; online, the list waits for the authoritative answer.
      final accounts = await (repository as OpenAccountCartRepository)
          .openAccounts(merchantId, query);
      unawaited(_persistAccounts(merchantId, query, accounts));
      return accounts;
    } on AppException {
      if (cached != null) return cached;
      rethrow;
    }
  }

  /// Read another account without claiming it or replacing the current cart.
  Future<Cart> readAccount(Cart account, String operatorSessionId) async {
    final query = CartQuery(
      locationId: account.locationId,
      operatorSessionId: operatorSessionId,
    );
    final cached = await _readCachedCart(account.merchantId, account.id);
    if (cached != null) {
      unawaited(_refreshCachedCart(account.merchantId, account.id, query));
      return cached;
    }
    final value = await (_repository as OpenAccountCartRepository).account(
      account.merchantId,
      account.id,
      query,
    );
    unawaited(_persistCart(value));
    return value;
  }

  /// Open or recover the table's account. Save the current account first.
  Future<bool> openTableAccount({
    required String merchantId,
    required String locationId,
    required String operatorSessionId,
    required String tableId,
    String? tableName,
    int? partySize,
  }) async {
    final repository = _repository;
    if (repository is! OpenAccountCartRepository) return false;
    // Offline, the room is the only authority the till has, and the assignment
    // travels with the journal: the server checks the table again when the sale
    // lands, so a table two tills claimed in a dead spot is a conflict to
    // report, not a wrong room on a receipt.
    //
    // Checked before `_busy`: a till with commands still draining is exactly
    // the one that needs this path, and the queue serializes the command
    // itself.
    if (_queue != null && _connectivityIsDown) {
      return _queueTableLocally(
        merchantId: merchantId,
        locationId: locationId,
        operatorSessionId: operatorSessionId,
        tableId: tableId,
        tableName: tableName,
        partySize: partySize,
      );
    }
    if (_busy) return false;
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
    final opened = await _mutation(
      () => (repository as OpenAccountCartRepository).openTableAccount(
        merchantId,
        query: _query,
        tableId: tableId,
        partySize: partySize,
        idempotencyKey: _uuid(),
      ),
      'table_account_opened',
    );
    // The link can fail between the connectivity snapshot and this request. The
    // room action already succeeded; journal the account assignment instead of
    // replacing it with a red "operation failed" banner.
    if (!opened && _queue != null && _tableWriteCanWait()) {
      return _queueTableLocally(
        merchantId: merchantId,
        locationId: locationId,
        operatorSessionId: operatorSessionId,
        tableId: tableId,
        tableName: tableName,
        partySize: partySize,
      );
    }
    return opened;
  }

  /// True while the till has strong enough evidence that the API is gone.
  bool get _connectivityIsDown {
    final state = _connectivity?.state;
    return state == PosConnectivity.offline ||
        // `degraded` is one failed call: the API is not answering reliably, and
        // waiting for the third failure to offer a table is waiting through
        // taps the operator has already made. The journal path is safe either
        // way — replay re-checks the table.
        state == PosConnectivity.degraded ||
        state == PosConnectivity.blocked;
  }

  /// A failed table write that says nothing about the command's truth is safe
  /// to journal. A typed refusal is not: queueing it would replay a command the
  /// server has already explained cannot apply.
  bool _tableWriteCanWait() {
    if (_connectivityIsDown) return true;
    const definiteRefusals = {
      'CART_VALIDATION_FAILED',
      'CART_NOT_FOUND',
      'CART_ACTOR_BUSY',
      'CART_TABLE_ACCOUNT_EXISTS',
      'CART_ALREADY_ASSIGNED',
      'CART_PAYMENT_UNRESOLVED',
      'TABLE_ALREADY_OCCUPIED',
      'TABLE_NOT_OCCUPIED',
      'TABLE_CAPACITY_EXCEEDED',
      'TABLE_NOT_IN_PLAN',
      'PERMISSION_DENIED',
      'DEVICE_REVOKED',
    };
    return !definiteRefusals.contains(_state.errorCode);
  }

  /// Whether a write must take the journal-backed path now.
  ///
  /// The account surface uses this before it asks the server to save the
  /// current account. A journaled `pos.cart.open` parks an account with lines
  /// on replay, so waiting on a save that cannot land only adds a failure the
  /// operator cannot act on.
  bool get isOffline => _connectivityIsDown;

  /// Open (or move) a table account without the API.
  ///
  /// The cart is created locally and journaled exactly like any other account;
  /// the table rides on its own command so replay assigns it to the cart the
  /// server ends up creating. Reusing `open()` here keeps one code path for
  /// "start an account" whether or not there is a link.
  Future<bool> _queueTableLocally({
    required String merchantId,
    required String locationId,
    required String operatorSessionId,
    required String tableId,
    String? tableName,
    int? partySize,
  }) async {
    if (_merchantId != merchantId ||
        _locationId != locationId ||
        _operatorSessionId != operatorSessionId ||
        _state.cart == null) {
      return _queueTableAccountGroup(
        merchantId: merchantId,
        locationId: locationId,
        operatorSessionId: operatorSessionId,
        tableId: tableId,
        tableName: tableName,
        partySize: partySize,
      );
    }
    final cart = _state.cart;
    if (cart == null || cart.id.isEmpty) return false;
    if (cart.tableId == tableId) return true;
    final idempotencyKey = _uuid();
    // `cartId` is not on the typed request — the route carries it — but the
    // queued command and the journal do, because replay has to know which cart
    // the table belongs to.
    final payload = {
      'cartId': cart.id,
      ...AssignCartTableRequest(
        locationId: locationId,
        operatorSessionId: operatorSessionId,
        tableId: tableId,
        partySize: partySize,
        expectedVersion: cart.version,
        idempotencyKey: idempotencyKey,
      ).toJson(),
    };
    return _submitQueued(
      idempotencyKey: idempotencyKey,
      commandType: 'pos.cart.table.set',
      payload: payload,
      event: 'cart_table_set',
      predict: (base, aliases) => optimisticSetTable(base, tableId, tableName),
    );
  }

  bool _queueTableAccountGroup({
    required String merchantId,
    required String locationId,
    required String operatorSessionId,
    required String tableId,
    String? tableName,
    int? partySize,
  }) {
    final queue = _queue;
    if (queue == null) return false;
    clearLocal();
    _merchantId = merchantId;
    _locationId = locationId;
    _operatorSessionId = operatorSessionId;
    final local = _emptyLocalCart(merchantId, locationId, operatorSessionId);
    queue.initialize(local);
    _set(CartState(phase: CartPhase.ready, cart: local));
    final idempotencyKey = _uuid();
    return _submitQueued(
      idempotencyKey: idempotencyKey,
      commandType: 'pos.command.group',
      payload: {
        'groupId': idempotencyKey,
        'aggregateKeys': ['account:${local.id}', 'table:$tableId'],
        'effects': [
          {
            'type': 'open_table_account',
            'provisionalCartId': local.id,
            'tableId': tableId,
            'partySize': partySize ?? 1,
          },
        ],
      },
      event: 'table_account_opened',
      predict: (base, aliases) => optimisticSetTable(base, tableId, tableName),
      provisionalCartId: local.id,
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
    if (repository is! OpenAccountCartRepository) return false;
    if (_state.cart?.id == account.id &&
        _operatorSessionId == operatorSessionId) {
      // The account is already open on this till. Selecting it is a screen
      // transition, not a write; a queued local command must not turn the
      // current account into an unreachable one.
      return true;
    }
    if (!await _settleConfirmedQueueForAccountSwitch()) return false;
    if (_busy) return false;
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
    String operatorSessionId, {
    String? accountName,
  }) async {
    final key = '$merchantId:$locationId:$operatorSessionId';
    if ('$_merchantId:$_locationId:$_operatorSessionId' == key &&
        _state.cart != null &&
        (accountName == null || _state.cart!.accountName == accountName)) {
      return;
    }
    clearLocal();
    _merchantId = merchantId;
    _locationId = locationId;
    _operatorSessionId = operatorSessionId;
    if (_queue != null) {
      final idempotencyKey = _uuid();
      final local = _emptyLocalCart(
        merchantId,
        locationId,
        operatorSessionId,
        accountName: accountName,
      );
      _queue!.initialize(local);
      _set(CartState(phase: CartPhase.ready, cart: local));
      _submitQueued(
        idempotencyKey: idempotencyKey,
        commandType: 'pos.cart.open',
        payload: {
          'cartId': local.id,
          ...CreateCartRequest(
            locationId: locationId,
            operatorSessionId: operatorSessionId,
            idempotencyKey: idempotencyKey,
            accountName: accountName,
          ).toJson(),
        },
        event: 'cart_opened',
        predict: (base, aliases) => base,
        provisionalCartId: local.id,
      );
      return;
    }
    _set(const CartState(phase: CartPhase.loading));
    try {
      final cart = await _repository.create(
        merchantId,
        CreateCartRequest(
          locationId: locationId,
          operatorSessionId: operatorSessionId,
          idempotencyKey: _uuid(),
          accountName: accountName,
        ),
      );
      _queue?.initialize(cart);
      unawaited(_persistCart(cart));
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
    _queue?.initialize(cart);
    unawaited(_persistCart(cart));
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
    if (_queue?.awaitsSynchronization ?? false) {
      // The local cart is ahead of the server. A read now would replace it,
      // and it would also wait on the unavailable API before checkout opens.
      return;
    }
    try {
      final refreshed = await _readSelected();
      unawaited(_persistCart(refreshed));
      if (_queue?.hasPending ?? false) {
        _queue!.acceptServerCart(refreshed);
      } else {
        _set(CartState(phase: CartPhase.ready, cart: refreshed));
      }
    } on AppException catch (error) {
      _failure(error);
    }
  }

  /// Read the server cart before an online charge uses its version.
  /// A pending local write can change that version after the read.
  Future<Cart?> refreshForCheckout() async {
    if (_state.cart == null ||
        _merchantId == null ||
        _locationId == null ||
        _operatorSessionId == null ||
        _inFlight ||
        (_queue?.hasPending ?? false)) {
      return null;
    }
    try {
      final refreshed = await _readSelected();
      if (_inFlight || (_queue?.hasPending ?? false)) return null;
      if (!_isWritable(refreshed)) {
        _releaseAccount();
        return null;
      }
      unawaited(_persistCart(refreshed));
      _set(CartState(phase: CartPhase.ready, cart: refreshed));
      return refreshed;
    } on AppException catch (error) {
      _failure(error);
      return null;
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
    ProvisionalLine? provisional,
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
    final cleanNote = (note?.trim().isEmpty ?? true) ? null : note!.trim();
    // The line the till paints before the server answers. Only for a product the
    // catalogue could price on its own — no variant and no option to choose — which
    // is exactly the tap that has no sheet to wait behind anyway. Everything else
    // keeps the old path, because a wrong price painted confidently is worse than a
    // spinner.
    final lineId = _uuid();
    final canPredict =
        provisional != null && provisional.productId == productId;
    final idempotencyKey = _uuid();
    final input = CartLineInput(
      cartId: cart.id,
      locationId: _locationId!,
      operatorSessionId: _operatorSessionId!,
      productId: productId,
      variantId: variantId,
      modifierSelections: modifiers,
      quantity: quantity,
      courseNumber: courseNumber,
      note: cleanNote,
      clientLineId: lineId,
      expectedVersion: cart.version,
      idempotencyKey: idempotencyKey,
    );
    if (canPredict &&
        _submitQueued(
          idempotencyKey: idempotencyKey,
          commandType: 'pos.cart.line.add',
          payload: input.toJson(),
          event: 'product_added',
          provisionalLineId: lineId,
          predict: (base, aliases) => optimisticAddLine(
            base,
            lineId: lineId,
            line: provisional,
            quantity: quantity,
            courseNumber: courseNumber,
            note: cleanNote,
          ),
        )) {
      return true;
    }
    return _mutation(
      () => _repository.add(_merchantId!, input),
      'product_added',
      predict: canPredict
          ? () => optimisticAddLine(
              cart,
              lineId: lineId,
              line: provisional,
              quantity: quantity,
              courseNumber: courseNumber,
              note: cleanNote,
            )
          : null,
    );
  }

  Future<void> quantity(CartItem item, int quantity) async {
    if (quantity <= 0) {
      return remove(item);
    }
    final cart = _state.cart;
    if (cart == null) return;
    final next = quantity.clamp(1, 999).toInt();
    final idempotencyKey = _uuid();
    final input = CartLineInput(
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
      quantity: next,
      // The course is not what this action is about, so it rides along
      // unchanged: the line is rewritten whole, and a missing course here
      // would silently drop a dessert back to course 1.
      courseNumber: item.courseNumber,
      note: item.note,
      expectedVersion: cart.version,
      idempotencyKey: idempotencyKey,
    );
    if (_submitQueued(
      idempotencyKey: idempotencyKey,
      commandType: 'pos.cart.line.update',
      payload: {'lineId': item.id, ...input.toJson()},
      event: 'quantity_changed',
      predict: (base, aliases) =>
          optimisticSetQuantity(base, aliases[item.id] ?? item.id, next),
    )) {
      return;
    }
    await _mutation(
      () => _repository.update(_merchantId!, item.id, input),
      'quantity_changed',
      // The line already carries what one unit costs, so this is arithmetic the
      // server repeats identically rather than a guess about price.
      predict: () => optimisticSetQuantity(cart, item.id, next),
    );
  }

  /// Add the same configured line again.
  ///
  /// The existing line carries the server price, variant and modifiers, so the
  /// repeat can paint at once and the server can still confirm the new line.
  Future<bool> repeat(CartItem item) {
    final price = PriceSnapshot.fromJson(item.price);
    return add(
      productId: item.productId,
      variantId: item.variant?['variantId'] as String?,
      modifiers: item.modifiers,
      quantity: item.quantity,
      note: item.note,
      courseNumber: item.courseNumber,
      provisional: ProvisionalLine(
        productId: item.productId,
        productName: item.productName,
        saleAction: item.saleAction,
        unitMinorUnits: (price.unitPrice['minorUnits'] as num?)?.toInt() ?? 0,
        currency: price.unitPrice['currency'] as String? ?? 'MXN',
        taxRateBasisPoints: price.taxRateBasisPoints,
      ),
    );
  }

  Future<void> remove(CartItem item) async {
    final cart = _state.cart;
    if (cart == null) return;
    final idempotencyKey = _uuid();
    final payload = RemoveCartLineRequest(
      cartId: cart.id,
      locationId: _locationId!,
      operatorSessionId: _operatorSessionId!,
      expectedVersion: cart.version,
      idempotencyKey: idempotencyKey,
    ).toJson();
    if (_submitQueued(
      idempotencyKey: idempotencyKey,
      commandType: 'pos.cart.line.remove',
      payload: {'lineId': item.id, ...payload},
      event: 'product_removed',
      predict: (base, aliases) =>
          optimisticRemoveLine(base, aliases[item.id] ?? item.id),
    )) {
      return;
    }
    await _mutation(
      () => _repository.remove(
        _merchantId!,
        item.id,
        RemoveCartLineRequest.fromJson(payload),
      ),
      'product_removed',
      predict: () => optimisticRemoveLine(cart, item.id),
    );
  }

  Future<void> clear() async {
    final cart = _state.cart;
    if (cart == null || cart.items.isEmpty) return;
    final idempotencyKey = _uuid();
    final payload = ClearCartRequest(
      cartId: cart.id,
      locationId: _locationId!,
      operatorSessionId: _operatorSessionId!,
      expectedVersion: cart.version,
      idempotencyKey: idempotencyKey,
    ).toJson();
    if (_submitQueued(
      idempotencyKey: idempotencyKey,
      commandType: 'pos.cart.clear',
      payload: payload,
      event: 'cart_cleared',
      predict: (base, aliases) => optimisticClear(base),
    )) {
      return;
    }
    await _mutation(
      () => _repository.clear(_merchantId!, ClearCartRequest.fromJson(payload)),
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
    final cleanNote = (note?.trim().isEmpty ?? true) ? null : note!.trim();
    final nextQuantity = quantity.clamp(1, 999).toInt();
    final idempotencyKey = _uuid();
    final input = CartLineInput(
      cartId: cart.id,
      locationId: _locationId!,
      operatorSessionId: _operatorSessionId!,
      productId: item.productId,
      variantId: variantId,
      modifierSelections: modifiers,
      quantity: nextQuantity,
      courseNumber: courseNumber,
      note: cleanNote,
      expectedVersion: cart.version,
      idempotencyKey: idempotencyKey,
    );
    if (optimisticEditLine(
          cart,
          item,
          variantId: variantId,
          modifiers: modifiers,
          quantity: nextQuantity,
          courseNumber: courseNumber,
          note: cleanNote,
        ) !=
        null) {
      if (_submitQueued(
        idempotencyKey: idempotencyKey,
        commandType: 'pos.cart.line.update',
        payload: {'lineId': item.id, ...input.toJson()},
        event: 'cart_line_edited',
        predict: (base, aliases) => optimisticEditLine(
          base,
          item,
          lineId: aliases[item.id] ?? item.id,
          variantId: variantId,
          modifiers: modifiers,
          quantity: nextQuantity,
          courseNumber: courseNumber,
          note: cleanNote,
        ),
      )) {
        return true;
      }
    }
    return _mutation(
      () => _repository.update(_merchantId!, item.id, input),
      'cart_line_edited',
    );
  }

  Future<void> prepare() async {
    final cart = _state.cart;
    if (cart == null || cart.items.isEmpty) return;
    final idempotencyKey = _uuid();
    final payload = PrepareSaleRequest(
      cartId: cart.id,
      locationId: _locationId!,
      operatorSessionId: _operatorSessionId!,
      expectedVersion: cart.version,
      idempotencyKey: idempotencyKey,
    ).toJson();
    if (_submitQueued(
      idempotencyKey: idempotencyKey,
      commandType: 'pos.cart.prepare',
      payload: payload,
      event: 'totals_loaded',
      predict: (base, aliases) => base,
    )) {
      return;
    }
    await _mutation(
      () => _repository.prepare(
        _merchantId!,
        PrepareSaleRequest.fromJson(payload),
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
        (_busy && _queue == null)) {
      return null;
    }
    // Nothing new to send: a cart whose every line already reached the kitchen has
    // nothing to add to the ticket it owns.
    if (!cart.items.any((item) => item['fired'] != true)) return null;
    final idempotencyKey = _uuid();
    final payload = FireOrderRequest(
      cartId: cart.id,
      locationId: _locationId!,
      operatorSessionId: _operatorSessionId!,
      expectedVersion: cart.version,
      idempotencyKey: idempotencyKey,
    ).toJson();
    final lineCount = cart.items.where((item) => item['fired'] != true).length;
    if (await _submitQueuedPersisted(
      idempotencyKey: idempotencyKey,
      commandType: 'pos.cart.fire',
      payload: payload,
      event: 'order_fired',
      predict: (base, aliases) => optimisticFire(base),
    )) {
      return FireOrderResult(
        cartId: cart.id,
        cartVersion: cart.version + 1,
        orderId: _uuid(),
        reference: null,
        lineCount: lineCount,
        firedAt: DateTime.now().toUtc().toIso8601String(),
      );
    }
    _set(CartState(phase: CartPhase.loading, cart: cart));
    try {
      final result = await _repository.fire(
        _merchantId!,
        FireOrderRequest.fromJson(payload),
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
    final idempotencyKey = _uuid();
    final payload = SetCartFulfillmentRequest(
      cartId: cart.id,
      locationId: _locationId!,
      operatorSessionId: _operatorSessionId!,
      fulfillmentType: fulfillmentType,
      expectedVersion: cart.version,
      idempotencyKey: idempotencyKey,
    ).toJson();
    if (_submitQueued(
      idempotencyKey: idempotencyKey,
      commandType: 'pos.cart.fulfillment.set',
      payload: payload,
      event: 'cart_fulfillment_set',
      predict: (base, aliases) =>
          optimisticSetFulfillment(base, fulfillmentType),
    )) {
      return;
    }
    await _mutation(
      () => _repository.setFulfillment(
        _merchantId!,
        SetCartFulfillmentRequest.fromJson(payload),
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
    _queue?.clearLocal();
    _state = const CartState();
    notifyListeners();
  }

  /// True when the server accepted the command. The exception is captured into the
  /// cart's error state either way — the caller is the one that has to know whether
  /// the write landed, so it is answered here instead of guessed from the state.
  ///
  /// [predict] is the difference between a tap that waits and a tap that does not.
  /// When the caller can say what the cart becomes — see `cart_optimism.dart` — the
  /// till paints that at once and the server's answer, which is the authoritative
  /// one, replaces it when it arrives. When the caller cannot, this behaves exactly
  /// as it always did: `loading`, then the server's cart.
  Future<bool> _mutation(
    Future<Cart> Function() action,
    String event, {
    Cart? Function()? predict,
  }) async {
    if (_busy) return false;
    final base = _state.cart;
    final predicted = predict?.call();
    _inFlight = true;
    if (predicted != null) {
      // Painted, not confirmed. The screen stops waiting on Boston; the write it
      // describes is still only an intention until the server answers below.
      _set(CartState(phase: CartPhase.ready, cart: predicted));
    } else {
      _set(CartState(phase: CartPhase.loading, cart: base));
    }
    try {
      final cart = await action();
      _queue?.acceptServerCart(cart);
      unawaited(_persistCart(cart));
      _set(CartState(phase: CartPhase.ready, cart: cart));
      _event(event);
      return true;
    } on AppException catch (error) {
      // A refused write takes its prediction with it. Leaving a line on the screen
      // that the server never accepted is the failure mode the whole design is
      // careful about, so the cart goes back to the last answer that was true.
      //
      // The wire is settled before the refusal is recorded: `_failure` may go on to
      // re-read the account, and that check asks whether a write is still out. A
      // refusal that left the flag set would make the till refuse to look at itself.
      _inFlight = false;
      _failure(error, revertTo: predicted != null ? base : null);
      return false;
    } finally {
      _inFlight = false;
    }
  }

  void _failure(AppException error, {Cart? revertTo}) {
    _event('validation_failed');
    _set(
      CartState(
        phase: error.code == 'CART_VALIDATION_FAILED'
            ? CartPhase.validationFailure
            : CartPhase.failure,
        cart: revertTo ?? _state.cart,
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
        _busy) {
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

  Future<List<Cart>?> _readCachedAccounts(
    String merchantId,
    CartQuery query,
  ) async {
    final workingCopy = _workingCopy;
    if (workingCopy == null) return null;
    try {
      return await workingCopy.readOpenAccounts(merchantId, query);
    } catch (_) {
      return null;
    }
  }

  Future<void> _refreshCachedAccounts(
    OpenAccountCartRepository repository,
    String merchantId,
    CartQuery query,
  ) async {
    try {
      final accounts = await repository.openAccounts(merchantId, query);
      await _persistAccounts(merchantId, query, accounts);
    } on AppException {
      // The cached accounts stay usable while the till is away from the API.
    }
  }

  Future<Cart?> _readCachedCart(String merchantId, String cartId) async {
    final workingCopy = _workingCopy;
    if (workingCopy == null) return null;
    try {
      return await workingCopy.readCart(merchantId, cartId);
    } catch (_) {
      return null;
    }
  }

  Future<void> _refreshCachedCart(
    String merchantId,
    String cartId,
    CartQuery query,
  ) async {
    final repository = _repository;
    if (repository is! OpenAccountCartRepository) return;
    try {
      final cart = await (repository as OpenAccountCartRepository).account(
        merchantId,
        cartId,
        query,
      );
      await _persistCart(cart);
    } on AppException {
      // The last server answer remains available for display.
    }
  }

  Future<void> _persistAccounts(
    String merchantId,
    CartQuery query,
    List<Cart> accounts,
  ) async {
    try {
      await _workingCopy?.writeOpenAccounts(merchantId, query, accounts);
    } catch (_) {
      _event('local_store_write_failed');
    }
  }

  Future<void> _persistCart(Cart cart) async {
    try {
      await _workingCopy?.writeCart(cart);
    } catch (_) {
      _event('local_store_write_failed');
    }
  }

  bool _submitQueued({
    required String idempotencyKey,
    required String commandType,
    required Map<String, Object?> payload,
    required String event,
    required CartPrediction predict,
    String? provisionalLineId,
    String? provisionalCartId,
  }) {
    final queue = _queue;
    if (queue == null) return false;
    final painted =
        queue.submit(
          QueuedCartCommand(
            commandId: cartCommandId(),
            commandType: commandType,
            idempotencyKey: idempotencyKey,
            payload: payload,
            event: event,
            predict: predict,
            provisionalLineId: provisionalLineId,
            provisionalCartId: provisionalCartId,
          ),
        ) !=
        null;
    if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
      debugPrint('[umipos] cart queue submit=$commandType painted=$painted');
    }
    return painted;
  }

  Future<bool> _submitQueuedPersisted({
    required String idempotencyKey,
    required String commandType,
    required Map<String, Object?> payload,
    required String event,
    required CartPrediction predict,
    String? provisionalLineId,
    String? provisionalCartId,
  }) async {
    final queue = _queue;
    if (queue == null) return false;
    final painted = await queue.submitAndPersist(
      QueuedCartCommand(
        commandId: cartCommandId(),
        commandType: commandType,
        idempotencyKey: idempotencyKey,
        payload: payload,
        event: event,
        predict: predict,
        provisionalLineId: provisionalLineId,
        provisionalCartId: provisionalCartId,
      ),
    );
    if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
      debugPrint(
        '[umipos] cart queue submit-persisted=$commandType '
        'painted=${painted != null}',
      );
    }
    return painted != null;
  }

  CartCommandScope? _queueScope() {
    final merchantId = _merchantId;
    final locationId = _locationId;
    final operatorSessionId = _operatorSessionId;
    final device = _deviceIdentity?.call();
    if (merchantId == null ||
        locationId == null ||
        operatorSessionId == null ||
        device == null) {
      return null;
    }
    return CartCommandScope(
      merchantId: merchantId,
      locationId: locationId,
      operatorSessionId: operatorSessionId,
      deviceId: device.deviceId,
      credentialVersion: device.credentialVersion,
    );
  }

  void _acceptQueuedCart(Cart cart) {
    if (_disposed) return;
    if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
      debugPrint(
        '[umipos] cart accept queued items=${cart.items.length} '
        'total=${cart.totals['grandTotal']}',
      );
    }
    unawaited(_persistCart(cart));
    _set(CartState(phase: CartPhase.ready, cart: cart));
  }

  void _setQueueBusy(bool busy) {
    if (_disposed || _inFlight == busy) return;
    _inFlight = busy;
    notifyListeners();
  }

  void _set(CartState value) {
    if (_disposed) return;
    _state = value;
    notifyListeners();
  }

  Cart _emptyLocalCart(
    String merchantId,
    String locationId,
    String operatorSessionId, {
    String? accountName,
  }) {
    final now = DateTime.now();
    // The operational date, not the calendar or UTC one. A café whose day starts
    // at 04:00 is still on yesterday's date at 03:00, and the server derives the
    // same date from `business_day_start`. Using the calendar date here put an
    // offline ticket in "Todos" but out of the KDS's "Hoy" bucket — the cook saw
    // the arrival sound with no card on the active rail.
    final businessDate = operationalDayStart(
      now,
    ).toIso8601String().substring(0, 10);
    Map<String, Object?> money() => {'minorUnits': 0, 'currency': 'MXN'};
    return Cart(
      id: _uuid(),
      merchantId: merchantId,
      locationId: locationId,
      operatorSessionId: operatorSessionId,
      status: 'draft',
      lifecycleState: 'building_cart',
      version: 1,
      firedOrderId: null,
      fulfillmentType: 'dine_in',
      accountName: accountName,
      items: const [],
      totals: {
        'subtotal': money(),
        'tax': money(),
        'discounts': {
          'total': money(),
          'entries': const <Map<String, Object?>>[],
        },
        'grandTotal': money(),
        'businessDate': businessDate,
      },
      checkoutEnabled: false,
      checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
      updatedAt: now.toUtc().toIso8601String(),
    );
  }

  @override
  void dispose() {
    _disposed = true;
    _journal?.pendingCount.removeListener(_journalCountChanged);
    _queue?.dispose();
    super.dispose();
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
