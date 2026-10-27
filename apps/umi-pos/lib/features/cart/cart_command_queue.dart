import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../kitchen/hub_command_forwarder.dart';
import '../offline/connectivity_controller.dart';
import '../offline/offline_journal.dart';
import '../offline/replay_engine.dart';
import 'cart_repository.dart';

final class CartDeviceIdentity {
  const CartDeviceIdentity({
    required this.deviceId,
    required this.credentialVersion,
  });

  final String deviceId;
  final int credentialVersion;
}

final class CartCommandScope {
  const CartCommandScope({
    required this.merchantId,
    required this.locationId,
    required this.operatorSessionId,
    required this.deviceId,
    required this.credentialVersion,
  });

  final String merchantId;
  final String locationId;
  final String operatorSessionId;
  final String deviceId;
  final int credentialVersion;

  ReplayScope get replayScope => ReplayScope(
    deviceId: deviceId,
    merchantId: merchantId,
    locationId: locationId,
    operatorSessionId: operatorSessionId,
    credentialVersion: credentialVersion,
  );
}

typedef CartPrediction =
    Cart? Function(Cart base, Map<String, String> lineAliases);

final class QueuedCartCommand {
  const QueuedCartCommand({
    required this.commandId,
    required this.commandType,
    required this.idempotencyKey,
    required this.payload,
    required this.event,
    required this.predict,
    this.provisionalLineId,
    this.provisionalCartId,
  });

  final String commandId;
  final String commandType;
  final String idempotencyKey;
  final Map<String, Object?> payload;
  final String event;
  final CartPrediction predict;
  final String? provisionalLineId;
  final String? provisionalCartId;
}

/// Runs cart commands against one local ordering lane.
///
/// The last server cart is the base. Every tap is applied to that base before
/// the queue drains. Server answers replace the base without removing the later
/// local commands. A transport failure turns the queue into a journal-backed
/// queue and leaves the painted commands in place for ordered replay.
final class CartCommandQueue {
  CartCommandQueue({
    required CartRepository repository,
    required EncryptedOfflineJournal journal,
    required CartCommandScope? Function() scope,
    required void Function(Cart cart) onCart,
    required void Function(AppException error) onError,
    required void Function(String event) onEvent,
    required void Function(bool busy) onBusy,
    void Function()? onSettled,
    ConnectivityController? connectivity,
    OfflineRecoveryController? recovery,
    HubCommandForwarder? hub,
  }) : _repository = repository,
       _journal = journal,
       _scope = scope,
       _onCart = onCart,
       _onError = onError,
       _onEvent = onEvent,
       _onBusy = onBusy,
       _onSettled = onSettled,
       _connectivity = connectivity,
       _recovery = recovery,
       _hub = hub {
    _connectivity?.addListener(_connectivityChanged);
    _recovery?.addListener(_recoveryChanged);
    _hub?.addListener(_hubChanged);
    _journal.pendingCount.addListener(_journalSettled);
  }

  final CartRepository _repository;
  final EncryptedOfflineJournal _journal;
  final CartCommandScope? Function() _scope;
  final void Function(Cart cart) _onCart;
  final void Function(AppException error) _onError;
  final void Function(String event) _onEvent;
  final void Function(bool busy) _onBusy;
  final void Function()? _onSettled;
  final ConnectivityController? _connectivity;
  final OfflineRecoveryController? _recovery;
  final HubCommandForwarder? _hub;

  final List<QueuedCartCommand> _commands = [];
  final Map<String, String> _cartAliases = {};
  final Map<String, String> _lineAliases = {};
  final Set<String> _journaledCommands = {};
  Cart? _serverCart;
  Future<void> _journalTail = Future<void>.value();
  Future<void>? _journalInspection;
  bool _initialized = false;
  bool _journalBacked = false;
  bool _draining = false;
  bool _replayScheduled = false;
  bool _reconciling = false;
  bool _disposed = false;
  int _selectionGeneration = 0;

  bool get hasPending => _commands.isNotEmpty;
  int get pendingCount => _commands.length;
  bool get awaitsSynchronization => _journalBacked && _commands.isNotEmpty;

  void clearLocal() {
    _selectionGeneration += 1;
    _commands.clear();
    _cartAliases.clear();
    _lineAliases.clear();
    _serverCart = null;
  }

  /// Drop in-memory commands after the journal has proved they are all settled.
  ///
  /// This is not `clearLocal`: the server snapshot stays. Account resume uses it
  /// when accepted commands remained painted in the lane and made the till look
  /// busy long after the API had already answered them.
  void clearSettledCommands() {
    _commands.clear();
    _cartAliases.clear();
    _lineAliases.clear();
    _journaledCommands.clear();
    _journalBacked = false;
  }

  void initialize(Cart cart) {
    _selectionGeneration += 1;
    _serverCart = cart;
    if (_initialized) return;
    _initialized = true;
    _journalInspection = _inspectJournal();
  }

  void acceptServerCart(Cart cart) {
    _serverCart = cart;
    if (_commands.isEmpty) return;
    _emitPrediction();
  }

  /// Put every in-memory command into the encrypted ordered journal before the
  /// caller changes account.
  ///
  /// Online commands are normally sent first for latency, so they are not in the
  /// journal yet. Starting another account used to clear that list and lose work
  /// that had been painted but not acknowledged. Persisting first makes account
  /// switching a local, ordered operation: the old commands replay before the
  /// new `pos.cart.open`.
  Future<bool> preservePendingCommands() async {
    if (_commands.isEmpty || _disposed) return true;
    _journalBacked = true;
    await _persistPending();
    if (_disposed) return false;
    final preserved = _commands.every(
      (command) => _journaledCommands.contains(command.commandId),
    );
    if (preserved) _requestReplay();
    return preserved;
  }

  Cart? submit(QueuedCartCommand command) {
    final server = _serverCart;
    if (server == null || _disposed) return null;
    final current = _compose() ?? server;
    final painted = command.predict(current, _lineAliases);
    if (painted == null) return null;
    _commands.add(command);
    _emitPrediction();
    unawaited(_start());
    return _compose();
  }

  /// Submit a command that must reach the journal before the UI paints it.
  ///
  /// The fire command is the order boundary. A KDS command can arrive as soon
  /// as the line shows as sent. If the fire command is still only in memory,
  /// the KDS command gets an earlier device sequence and the server refuses it.
  Future<Cart?> submitAndPersist(QueuedCartCommand command) async {
    final server = _serverCart;
    if (server == null || _disposed) return null;
    final current = _compose() ?? server;
    final painted = command.predict(current, _lineAliases);
    if (painted == null) return null;
    _commands.add(command);
    _journalBacked = true;
    await _persistPending();
    if (_disposed || !_journaledCommands.contains(command.commandId)) {
      return null;
    }
    _emitPrediction();
    unawaited(_start());
    return _compose();
  }

  Future<void> _start() async {
    if (!_initialized) {
      _initialized = true;
      _journalInspection = _inspectJournal();
    }
    await _journalInspection;
    if (_disposed || _commands.isEmpty) return;
    if (_hub != null) {
      _journalBacked = true;
      await _persistPending();
      if (!_disposed) {
        await _hub.forwardNow();
        await _settleAfterHub();
      }
      return;
    }
    if (_journalBacked || _knownOffline) {
      _journalBacked = true;
      await _persistPending();
      if (!_knownOffline) _requestReplay();
      return;
    }
    await _drain();
  }

  Future<void> _inspectJournal() async {
    if (!_journal.supportsSecureOffline) return;
    try {
      final snapshot = await _journal.load();
      final hasOrderCommands = snapshot.entries.any(
        (entry) =>
            offlineOrderCommandTypes.contains(entry.command.commandType) &&
            entry.status != JournalStatus.accepted &&
            entry.status != JournalStatus.duplicate &&
            entry.status != JournalStatus.resolved &&
            entry.status != JournalStatus.archived,
      );
      if (hasOrderCommands) {
        _journalBacked = true;
        _requestReplay();
      }
    } on OfflineJournalException catch (error) {
      _onError(
        AppException(
          category: AppErrorCategory.storage,
          code: error.category,
          recoverable: true,
        ),
      );
    }
  }

  Future<void> _drain() async {
    if (_draining || _journalBacked || _knownOffline) return;
    _draining = true;
    _onBusy(true);
    try {
      while (_commands.isNotEmpty && !_journalBacked && !_disposed) {
        if (_knownOffline) {
          _journalBacked = true;
          await _persistPending();
          break;
        }
        final command = _commands.first;
        try {
          final result = await _execute(command);
          _commands.removeAt(0);
          if (command.commandType == 'pos.cart.line.add') {
            _rememberAddedLine(command, result.cart);
          }
          _serverCart = result.cart;
          _emitPrediction();
          _onEvent(command.event);
        } on AppException catch (error) {
          if (!_isDefiniteRefusal(error)) {
            _connectivity?.apiFailure();
            _journalBacked = true;
            await _persistPending();
            if (!_knownOffline) _requestReplay();
            break;
          }
          _commands.removeAt(0);
          _emitPrediction();
          _onError(error);
        } catch (_) {
          _connectivity?.apiFailure();
          _journalBacked = true;
          await _persistPending();
          break;
        }
      }
    } finally {
      _draining = false;
      _onBusy(false);
    }
  }

  Future<({Cart cart, FireOrderResult? fire})> _execute(
    QueuedCartCommand command,
  ) async {
    final scope = _scope();
    final server = _serverCart;
    if (scope == null || server == null) {
      throw const AppException(
        category: AppErrorCategory.authentication,
        code: 'CART_COMMAND_SCOPE_MISSING',
        recoverable: true,
      );
    }
    final payload = Map<String, Object?>.of(command.payload);
    if (command.commandType != 'pos.cart.open') {
      final cartId = payload['cartId'];
      if (cartId is String) {
        payload['cartId'] = _cartAliases[cartId] ?? cartId;
      }
    }
    switch (command.commandType) {
      case 'pos.cart.open':
        final provisionalCartId = payload.remove('cartId') as String;
        final created = await _repository.create(
          scope.merchantId,
          CreateCartRequest.fromJson(payload),
        );
        _cartAliases[provisionalCartId] = created.id;
        return (cart: created, fire: null);
      case 'pos.cart.line.add':
        final input = CartLineInput.fromJson(payload);
        return (
          cart: await _repository.add(
            scope.merchantId,
            _versionedLine(input, command, server.version),
          ),
          fire: null,
        );
      case 'pos.cart.line.update':
        final lineId = payload.remove('lineId') as String;
        final input = CartLineInput.fromJson(payload);
        return (
          cart: await _repository.update(
            scope.merchantId,
            _aliasedLine(lineId),
            _versionedLine(input, command, server.version),
          ),
          fire: null,
        );
      case 'pos.cart.line.remove':
        final lineId = payload.remove('lineId') as String;
        return (
          cart: await _repository.remove(
            scope.merchantId,
            _aliasedLine(lineId),
            _versionedRemove(payload, command, server.version),
          ),
          fire: null,
        );
      case 'pos.cart.clear':
        return (
          cart: await _repository.clear(
            scope.merchantId,
            _versionedClear(payload, command, server.version),
          ),
          fire: null,
        );
      case 'pos.cart.prepare':
        return (
          cart: await _repository.prepare(
            scope.merchantId,
            _versionedPrepare(payload, command, server.version),
          ),
          fire: null,
        );
      case 'pos.cart.fire':
        final fired = await _repository.fire(
          scope.merchantId,
          _versionedFire(payload, command, server.version),
        );
        return (cart: await _readServerCart(scope), fire: fired);
      case 'pos.cart.fulfillment.set':
        return (
          cart: await _repository.setFulfillment(
            scope.merchantId,
            _versionedFulfillment(payload, command, server.version),
          ),
          fire: null,
        );
      case 'pos.command.group':
        {
          final group = OfflineCommandGroupPayload.fromJson(payload);
          if (group.effects.length != 1 ||
              group.effects.single['type'] != 'open_table_account' ||
              group.groupId != command.idempotencyKey) {
            throw const AppException(
              category: AppErrorCategory.unsupported,
              code: 'COMMAND_GROUP_UNSUPPORTED',
              recoverable: false,
            );
          }
          final effect = group.effects.single;
          final accounts = _repository;
          if (accounts is! OpenAccountCartRepository) {
            throw const AppException(
              category: AppErrorCategory.unsupported,
              code: 'CART_TABLE_UNSUPPORTED',
              recoverable: false,
            );
          }
          final provisionalCartId = effect['provisionalCartId']! as String;
          final opened = await (accounts as OpenAccountCartRepository)
              .openTableAccount(
                scope.merchantId,
                query: CartQuery(
                  locationId: scope.locationId,
                  operatorSessionId: scope.operatorSessionId,
                ),
                tableId: effect['tableId']! as String,
                partySize: (effect['partySize'] as num?)?.toInt(),
                idempotencyKey: command.idempotencyKey,
              );
          _cartAliases[provisionalCartId] = opened.id;
          return (cart: opened, fire: null);
        }
      case 'pos.cart.table.set':
        {
          final accounts = _repository;
          if (accounts is! AccountDetailsCartRepository) {
            throw const AppException(
              category: AppErrorCategory.unsupported,
              code: 'CART_TABLE_UNSUPPORTED',
              recoverable: false,
            );
          }
          final cartId = payload.remove('cartId') as String;
          final request = AssignCartTableRequest.fromJson({
            ...payload,
            'expectedVersion': server.version,
          });
          return (
            cart: await (accounts as AccountDetailsCartRepository)
                .assignAccountTable(
                  scope.merchantId,
                  _cartAliases[cartId] ?? cartId,
                  request,
                ),
            fire: null,
          );
        }
      default:
        throw const AppException(
          category: AppErrorCategory.unsupported,
          code: 'CART_COMMAND_UNSUPPORTED',
          recoverable: false,
        );
    }
  }

  CartLineInput _versionedLine(
    CartLineInput input,
    QueuedCartCommand command,
    int version,
  ) => CartLineInput(
    cartId: input.cartId,
    locationId: input.locationId,
    operatorSessionId: input.operatorSessionId,
    productId: input.productId,
    variantId: input.variantId,
    modifierSelections: input.modifierSelections,
    quantity: input.quantity,
    courseNumber: input.courseNumber,
    note: input.note,
    expectedVersion: version,
    idempotencyKey: command.idempotencyKey,
  );

  RemoveCartLineRequest _versionedRemove(
    Map<String, Object?> payload,
    QueuedCartCommand command,
    int version,
  ) => RemoveCartLineRequest(
    cartId: payload['cartId']! as String,
    locationId: payload['locationId']! as String,
    operatorSessionId: payload['operatorSessionId']! as String,
    expectedVersion: version,
    idempotencyKey: command.idempotencyKey,
  );

  ClearCartRequest _versionedClear(
    Map<String, Object?> payload,
    QueuedCartCommand command,
    int version,
  ) => ClearCartRequest(
    cartId: payload['cartId']! as String,
    locationId: payload['locationId']! as String,
    operatorSessionId: payload['operatorSessionId']! as String,
    expectedVersion: version,
    idempotencyKey: command.idempotencyKey,
  );

  PrepareSaleRequest _versionedPrepare(
    Map<String, Object?> payload,
    QueuedCartCommand command,
    int version,
  ) => PrepareSaleRequest(
    cartId: payload['cartId']! as String,
    locationId: payload['locationId']! as String,
    operatorSessionId: payload['operatorSessionId']! as String,
    expectedVersion: version,
    idempotencyKey: command.idempotencyKey,
  );

  FireOrderRequest _versionedFire(
    Map<String, Object?> payload,
    QueuedCartCommand command,
    int version,
  ) => FireOrderRequest(
    cartId: payload['cartId']! as String,
    locationId: payload['locationId']! as String,
    operatorSessionId: payload['operatorSessionId']! as String,
    expectedVersion: version,
    idempotencyKey: command.idempotencyKey,
  );

  SetCartFulfillmentRequest _versionedFulfillment(
    Map<String, Object?> payload,
    QueuedCartCommand command,
    int version,
  ) => SetCartFulfillmentRequest(
    cartId: payload['cartId']! as String,
    locationId: payload['locationId']! as String,
    operatorSessionId: payload['operatorSessionId']! as String,
    fulfillmentType: payload['fulfillmentType']! as String,
    expectedVersion: version,
    idempotencyKey: command.idempotencyKey,
  );

  Future<Cart> _readServerCart(CartCommandScope scope, {String? cartId}) {
    final selected = _serverCart;
    if (selected == null) {
      throw const AppException(
        category: AppErrorCategory.conflict,
        code: 'CART_NOT_OPEN',
        recoverable: true,
      );
    }
    final cart = cartId ?? _cartAliases[selected.id] ?? selected.id;
    final query = CartQuery(
      locationId: scope.locationId,
      operatorSessionId: scope.operatorSessionId,
    );
    final repository = _repository;
    return repository is OpenAccountCartRepository
        ? (repository as OpenAccountCartRepository).account(
            scope.merchantId,
            cart,
            query,
          )
        : repository.read(scope.merchantId, query);
  }

  void _rememberAddedLine(QueuedCartCommand command, Cart serverCart) {
    final provisionalLineId = command.provisionalLineId;
    if (provisionalLineId == null) return;
    final productId = command.payload['productId'];
    if (productId is! String) return;
    for (final raw in serverCart.items) {
      final line = CartItem.fromJson(raw);
      if (line.productId == productId) {
        _lineAliases[provisionalLineId] = line.id;
        return;
      }
    }
  }

  String _aliasedLine(String lineId) => _lineAliases[lineId] ?? lineId;

  Cart? _compose() {
    final server = _serverCart;
    if (server == null) return null;
    var painted = server;
    for (final command in _commands) {
      try {
        final next = command.predict(painted, _lineAliases);
        if (next != null) painted = next;
      } catch (_) {
        // One bad prediction must not hide the last good cart.
      }
    }
    return painted;
  }

  void _emitPrediction() {
    final painted = _compose();
    if (painted != null) {
      if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
        debugPrint(
          '[umipos] cart queue emit items=${painted.items.length} '
          'pending=${_commands.length}',
        );
      }
      _onCart(painted);
    }
  }

  Future<void> _persistPending() {
    final operation = _journalTail.then((_) async {
      final scope = _scope();
      if (scope == null) {
        throw const OfflineJournalException('command_scope_missing');
      }
      final pending = _commands
          .where((command) => !_journaledCommands.contains(command.commandId))
          .toList(growable: false);
      for (final command in pending) {
        await _journal.append(
          commandId: command.commandId,
          deviceId: scope.deviceId,
          credentialVersion: scope.credentialVersion,
          merchantId: scope.merchantId,
          locationId: scope.locationId,
          operatorSessionId: scope.operatorSessionId,
          idempotencyKey: command.idempotencyKey,
          provisionalId: command.provisionalCartId,
          payload: command.payload,
          commandType: command.commandType,
          hubOwned: _hub != null,
        );
        _journaledCommands.add(command.commandId);
      }
    });
    _journalTail = operation.then<void>((_) {}, onError: (_, _) {});
    return operation.catchError((Object error) {
      _onError(
        AppException(
          category: AppErrorCategory.storage,
          code: error is OfflineJournalException
              ? error.category
              : 'offline_journal_write_failed',
          recoverable: true,
        ),
      );
    });
  }

  void _requestReplay() {
    final recovery = _recovery;
    final scope = _scope();
    final hub = _hub;
    if (scope == null || _replayScheduled || _reconciling) return;
    if (hub != null) {
      _replayScheduled = true;
      unawaited(
        _journalTail
            .then((_) async {
              await hub.forwardNow();
              final state = _connectivity?.state;
              final cloudCanRun =
                  recovery != null &&
                  (state == PosConnectivity.online ||
                      state == PosConnectivity.recovering);
              if (!cloudCanRun) return;
              final snapshot = await _journal.load();
              final cloudPending = snapshot.entries.any(
                (entry) =>
                    entry.status == JournalStatus.pending &&
                    entry.command.hubOwned != true &&
                    offlineOrderCommandTypes.contains(
                      entry.command.commandType,
                    ),
              );
              if (cloudPending) await recovery.recover(scope.replayScope);
            })
            .catchError((_) {})
            .whenComplete(() => _replayScheduled = false),
      );
      return;
    }
    if (recovery == null) return;
    if (_recoveryNeedsOperator(recovery.status.phase)) {
      // A blocked conflict/device/storage state cannot be cleared by sending the
      // same batch on every heartbeat. The recovery centre or the automatic
      // definite-refusal cleanup owns that transition; hammering the API here
      // only produced a visible retry loop and kept the local lane looking busy.
      return;
    }
    if (_connectivity != null &&
        _connectivity.state != PosConnectivity.online &&
        _connectivity.state != PosConnectivity.recovering) {
      return;
    }
    _replayScheduled = true;
    unawaited(
      _journalTail
          .then((_) async {
            await recovery.recover(scope.replayScope);
            _replayScheduled = false;
          })
          .catchError((_) {
            _replayScheduled = false;
          }),
    );
  }

  bool _recoveryNeedsOperator(RecoveryPhase phase) =>
      phase == RecoveryPhase.blockedByConflict ||
      phase == RecoveryPhase.blockedByDevice ||
      phase == RecoveryPhase.blockedByStorage ||
      phase == RecoveryPhase.waitingForCapacity;

  void _connectivityChanged() {
    if (_disposed || !_journalBacked) return;
    final state = _connectivity?.state;
    if (state == PosConnectivity.online ||
        state == PosConnectivity.recovering) {
      _requestReplay();
    }
  }

  void _recoveryChanged() {
    final status = _recovery?.status;
    if (_disposed ||
        status?.phase != RecoveryPhase.completed ||
        !_journalBacked ||
        _reconciling) {
      return;
    }
    unawaited(_settleAfterReplay());
  }

  void _hubChanged() {
    if (_disposed || _hub == null) return;
    unawaited(_settleAfterHub());
  }

  /// The journal is the authority for "is anything still unsynced".
  ///
  /// The queue and the replay engine can settle the same command through
  /// different paths. The journal count is the one fact both update, so zero
  /// here always means the in-memory list must stop being counted. Without
  /// this listener a direct refusal followed by a successful replay left the
  /// header saying "1 local" over an empty journal.
  void _journalSettled() {
    if (_disposed || _reconciling || _commands.isEmpty) return;
    if (_journal.pendingCount.value != 0) return;
    unawaited(_settleAfterReplay());
  }

  Future<void> _settleAfterHub() async {
    if (_disposed || _reconciling || _hub == null) return;
    final settling = _commands.map((command) => command.commandId).toSet();
    if (settling.any((commandId) => !_journaledCommands.contains(commandId))) {
      return;
    }
    _reconciling = true;
    try {
      final snapshot = await _journal.load();
      if (_commands.length != settling.length ||
          _commands.any((command) => !settling.contains(command.commandId))) {
        return;
      }
      final stillPending = snapshot.entries.any(
        (entry) =>
            entry.command.hubOwned == true &&
            offlineOrderCommandTypes.contains(entry.command.commandType) &&
            entry.status != JournalStatus.accepted &&
            entry.status != JournalStatus.duplicate &&
            entry.status != JournalStatus.resolved &&
            entry.status != JournalStatus.archived,
      );
      if (stillPending) return;
      for (final entry in snapshot.entries) {
        final provisional = entry.command.provisionalId;
        final official = entry.officialId;
        if (provisional != null && official != null) {
          _cartAliases[provisional] = official;
        }
      }
      final scope = _scope();
      if (scope == null) return;
      _commands.clear();
      _lineAliases.clear();
      _journalBacked = true;
      _onSettled?.call();
      try {
        final cart = await _readServerCart(scope);
        _serverCart = cart;
        _onCart(cart);
      } catch (_) {
        // The official read can wait. The peer keeps its last local projection.
      }
    } catch (_) {
      // Keep the local commands until the journal is readable again.
    } finally {
      _reconciling = false;
    }
  }

  Future<void> _settleAfterReplay() async {
    if (_disposed || _reconciling) return;
    _reconciling = true;
    final generation = _selectionGeneration;
    final settling = _commands.map((command) => command.commandId).toSet();
    final selectedId = _serverCart?.id;
    var refreshed = false;
    try {
      final snapshot = await _journal.load();
      if (_disposed || generation != _selectionGeneration) return;
      final terminalIds = snapshot.entries
          .where(
            (entry) => switch (entry.status) {
              JournalStatus.accepted ||
              JournalStatus.duplicate ||
              JournalStatus.resolved ||
              JournalStatus.archived => true,
              _ => false,
            },
          )
          .map((entry) => entry.command.commandId)
          .toSet();
      final confirmed = settling.intersection(terminalIds);
      if (settling.isNotEmpty && confirmed.isEmpty) return;
      final scope = _scope();
      if (scope == null || selectedId == null) return;
      final target =
          snapshot.mappings[selectedId] ??
          _cartAliases[selectedId] ??
          selectedId;

      // Keep new taps durable until the API snapshot supplies the current version.
      _journalBacked = true;
      final cart = await _readServerCart(scope, cartId: target);
      if (_disposed || generation != _selectionGeneration) return;
      if (_repository is OpenAccountCartRepository && cart.id != target) return;

      _commands.removeWhere((command) => confirmed.contains(command.commandId));
      _journaledCommands.removeAll(confirmed);
      _cartAliases.addAll(snapshot.mappings);
      final current = _serverCart;
      if (current == null ||
          current.id != cart.id ||
          current.version <= cart.version) {
        _serverCart = cart;
      }
      _journalBacked = _commands.isNotEmpty;
      _emitPrediction();
      if (_commands.isEmpty) _onSettled?.call();
      refreshed = true;
    } catch (_) {
      // Preserve the projection and journal. A later sync retries the read.
    } finally {
      _reconciling = false;
      if (!_disposed &&
          _commands.isNotEmpty &&
          (refreshed || generation != _selectionGeneration)) {
        unawaited(_start());
      }
    }
  }

  bool get _knownOffline =>
      _connectivity?.state == PosConnectivity.offline ||
      // One failed call is enough to stop offering the network first. The
      // command goes to the journal instead, which replay drains the moment the
      // API answers — the operator sees the same paint either way, but does not
      // wait through a doomed request.
      _connectivity?.state == PosConnectivity.degraded ||
      _connectivity?.state == PosConnectivity.blocked;

  /// Only a typed refusal proves the command did not land.
  ///
  /// A gateway error, an invalid error body or an unknown server failure says
  /// nothing about the write. Keeping the command in the journal lets replay
  /// query the idempotency key instead of dropping work that may have applied.
  bool _isDefiniteRefusal(AppException error) => switch (error.category) {
    AppErrorCategory.permission ||
    AppErrorCategory.conflict ||
    AppErrorCategory.unsupported ||
    AppErrorCategory.configuration => true,
    _ => false,
  };

  void dispose() {
    _disposed = true;
    _journal.pendingCount.removeListener(_journalSettled);
    _connectivity?.removeListener(_connectivityChanged);
    _recovery?.removeListener(_recoveryChanged);
    _hub?.removeListener(_hubChanged);
  }
}

String cartCommandId() => _uuid();

String _uuid() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  final hex = bytes
      .map((value) => value.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
