import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import 'table_state_repository.dart';

/// The live state of the room, shared with the map surface (plan §8D steps 3–5).
///
/// The six state names are the contract's (`TABLE_STATE_VALUES`), never a local
/// enum and never a seventh: the server's column carries the same six in a CHECK
/// constraint, so a value that is not listed there cannot be stored either.
const String tableStateOpen = 'open';
const String tableStateSeated = 'seated';
const String tableStateOrdered = 'ordered';
const String tableStateServed = 'served';
const String tableStateAwaitingPayment = 'awaiting_payment';
const String tableStateDirty = 'dirty';

/// The four states in which a party is ON the table. Mirrors the contract's
/// `PARTY_PRESENT_STATES`; the other two (`open`, `dirty`) are free tables.
const Set<String> tablePartyStates = {
  tableStateSeated,
  tableStateOrdered,
  tableStateServed,
  tableStateAwaitingPayment,
};

/// A table is free — bookable for a new party — in `open` and `dirty`. That is
/// the API's own rule (`seat` only refuses when a party is present), and a POS
/// that waited for somebody to wipe a table before seating it would stop working
/// during a rush.
bool tableIsFree(String state) =>
    state == tableStateOpen || state == tableStateDirty;

final class TableStateController extends ChangeNotifier {
  TableStateController(this._repository, {DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;

  final TableStateRepository _repository;

  /// Device clock, injectable so a test can prove the turn timer follows the
  /// server's clock and not this one.
  final DateTime Function() _clock;

  TableStateMap? _map;
  Map<String, TableStateEntry> _entries = const {};
  DateTime? _receivedAtLocal;
  bool _loading = false;
  bool _busy = false;
  bool _stale = false;
  String? _errorCode;
  String? _merchantId;
  String? _locationId;
  String? _operatorSessionId;
  String? _scope;
  int _generation = 0;
  bool _disposed = false;

  /// The whole room as the server last described it, or null before the first
  /// successful read.
  TableStateMap? get map => _map;

  /// A read is in flight.
  bool get loading => _loading;

  /// A command is in flight. Every write releases this flag on every outcome.
  bool get busy => _busy;

  /// The last read failed, so what is drawn may be out of date.
  bool get stale => _stale;

  /// The last command's typed refusal, or null. Cleared when a new command
  /// starts and by [dismissError].
  String? get errorCode => _errorCode;

  bool get hasContext =>
      _merchantId != null && _locationId != null && _operatorSessionId != null;

  /// The live state of one table. **A table with no entry is `open`**, which the
  /// contract states explicitly: the layout says the table exists and nothing has
  /// happened on it yet, so the state row was never created. It is not "unknown".
  TableStateEntry stateOf(String tableId) =>
      _entries[tableId] ??
      TableStateEntry(
        tableId: tableId,
        state: tableStateOpen,
        seatedAt: null,
        partySize: null,
        groupId: null,
      );

  /// Every table of one merged group, named once by the server's `groupId`.
  List<TableStateEntry> group(String groupId) => _entries.values
      .where((entry) => entry.groupId == groupId)
      .toList(growable: false);

  /// Whether a party is on the table right now.
  bool partyPresent(String tableId) =>
      tablePartyStates.contains(stateOf(tableId).state);

  /// The server's clock, advanced by however long this device has held the
  /// snapshot. A till whose own clock is wrong still shows the true turn time,
  /// because the origin travels with the map and only the *delta* is local.
  DateTime? get serverNow {
    final map = _map;
    final received = _receivedAtLocal;
    if (map == null || received == null) return null;
    final anchor = DateTime.tryParse(map.serverTime);
    if (anchor == null) return null;
    return anchor.toUtc().add(_clock().toUtc().difference(received));
  }

  /// How long a party has held this table, from the server's `seatedAt`. Null
  /// when no party is present or nothing has been read yet. A move cannot restart
  /// this clock: the server refuses to move `seated_at`, so there is nothing here
  /// to reset — the client only displays what the server holds.
  Duration? elapsedOf(String tableId) {
    final entry = stateOf(tableId);
    final seatedAt = entry.seatedAt;
    if (seatedAt == null) return null;
    final now = serverNow;
    final start = DateTime.tryParse(seatedAt);
    if (now == null || start == null) return null;
    final elapsed = now.difference(start.toUtc());
    return elapsed.isNegative ? Duration.zero : elapsed;
  }

  /// True while any table holds a party, which is when the surface has to tick
  /// its timers.
  bool get anyPartyPresent =>
      _entries.values.any((entry) => tablePartyStates.contains(entry.state));

  void dismissError() {
    if (_errorCode == null) return;
    _errorCode = null;
    if (!_disposed) notifyListeners();
  }

  void clear() {
    _generation++;
    _scope = null;
    _merchantId = null;
    _locationId = null;
    _operatorSessionId = null;
    _map = null;
    _entries = const {};
    _receivedAtLocal = null;
    _loading = false;
    _busy = false;
    _stale = false;
    _errorCode = null;
    if (!_disposed) notifyListeners();
  }

  /// Read the room for the operator session in force. Safe to call from a poll:
  /// an overlapping read for the same scope is dropped, a stale response for a
  /// previous scope is discarded, and the last good map is kept on failure (a
  /// till that blinks offline must not blank the floor).
  Future<void> load(
    String merchantId,
    String locationId,
    String operatorSessionId,
  ) async {
    final scope = '$merchantId:$locationId:$operatorSessionId';
    if (_scope == scope && _loading) return;
    _scope = scope;
    _merchantId = merchantId;
    _locationId = locationId;
    _operatorSessionId = operatorSessionId;
    final generation = ++_generation;
    if (_disposed) return;
    _loading = true;
    notifyListeners();
    try {
      final result = await _repository.read(
        merchantId,
        PosTableStateQuery(
          locationId: locationId,
          operatorSessionId: operatorSessionId,
        ),
      );
      if (_disposed || generation != _generation) return;
      if (result.locationId != locationId) {
        throw const FormatException('Location mismatch');
      }
      _install(result);
      _stale = false;
    } catch (error) {
      if (_disposed || generation != _generation) return;
      _stale = true;
      if (error is AppException &&
          (error.category == AppErrorCategory.authentication ||
              error.category == AppErrorCategory.permission)) {
        _map = null;
        _entries = const {};
        _receivedAtLocal = null;
      }
    } finally {
      if (!_disposed && generation == _generation) {
        _loading = false;
        notifyListeners();
      }
    }
  }

  /// Seat a party at a free table. The entry point that did not exist before:
  /// without it no table order can be started anywhere in the POS.
  Future<bool> seat(String tableId, int partySize) => _command(
    (key) => _repository.seat(
      _merchantId!,
      SeatTableRequest(
        locationId: _locationId!,
        operatorSessionId: _operatorSessionId!,
        idempotencyKey: key,
        tableId: tableId,
        partySize: partySize,
      ),
    ),
  );

  /// Move a party to another table. The turn timer travels: the server refuses
  /// to move `seated_at`, so the party keeps its clock.
  Future<bool> move({
    required String fromTableId,
    required String toTableId,
  }) => _command(
    (key) => _repository.move(
      _merchantId!,
      MovePartyRequest(
        locationId: _locationId!,
        operatorSessionId: _operatorSessionId!,
        idempotencyKey: key,
        fromTableId: fromTableId,
        toTableId: toTableId,
      ),
    ),
  );

  /// Merge free tables into one party. They share one `groupId`, which is what
  /// makes them one bounded region on the map.
  Future<bool> merge({
    required List<String> tableIds,
    required int partySize,
  }) => _command(
    (key) => _repository.merge(
      _merchantId!,
      MergeTablesRequest(
        locationId: _locationId!,
        operatorSessionId: _operatorSessionId!,
        idempotencyKey: key,
        tableIds: tableIds,
        partySize: partySize,
      ),
    ),
  );

  /// Dissolve the group containing [tableId]. The table named keeps the party;
  /// the rest become `dirty`.
  Future<bool> split(String tableId) => _command(
    (key) => _repository.split(
      _merchantId!,
      SplitPartyRequest(
        locationId: _locationId!,
        operatorSessionId: _operatorSessionId!,
        idempotencyKey: key,
        tableId: tableId,
      ),
    ),
  );

  /// The party leaves. The table becomes `dirty` — the API's `clear`, which
  /// refuses a table that holds no party.
  Future<bool> clearTable(String tableId) => _command(
    (key) => _repository.clear(
      _merchantId!,
      ClearTableRequest(
        locationId: _locationId!,
        operatorSessionId: _operatorSessionId!,
        idempotencyKey: key,
        tableId: tableId,
      ),
    ),
  );

  /// Wiped and ready: `dirty` (or `open`) goes back to `open`. This is the
  /// API's `open` operation, the other half of clearing — a table returns to
  /// `open` only when somebody says it has been wiped.
  Future<bool> markReady(String tableId) => _command(
    (key) => _repository.markReady(
      _merchantId!,
      OpenTableRequest(
        locationId: _locationId!,
        operatorSessionId: _operatorSessionId!,
        idempotencyKey: key,
        tableId: tableId,
      ),
    ),
  );

  /// The party is on the table and its food is in: "Pedido enviado". Any
  /// party-present state may reach this one, not only `seated`.
  Future<bool> markOrdered(String tableId) => _command(
    (key) => _repository.markOrdered(
      _merchantId!,
      MarkTableOrderedRequest(
        locationId: _locationId!,
        operatorSessionId: _operatorSessionId!,
        idempotencyKey: key,
        tableId: tableId,
      ),
    ),
  );

  /// The party is on the table and its food is out: "Servido". A table with no
  /// party on it is the only thing the server refuses.
  Future<bool> markServed(String tableId) => _command(
    (key) => _repository.markServed(
      _merchantId!,
      MarkTableServedRequest(
        locationId: _locationId!,
        operatorSessionId: _operatorSessionId!,
        idempotencyKey: key,
        tableId: tableId,
      ),
    ),
  );

  /// The party is on the table and has asked for the bill: "Pedir la cuenta".
  Future<bool> markAwaitingPayment(String tableId) => _command(
    (key) => _repository.markAwaitingPayment(
      _merchantId!,
      MarkTableAwaitingPaymentRequest(
        locationId: _locationId!,
        operatorSessionId: _operatorSessionId!,
        idempotencyKey: key,
        tableId: tableId,
      ),
    ),
  );

  /// One idempotent command: a fresh idempotency key, the operator session in
  /// force, and the changed tables drawn at once before the authoritative read.
  Future<bool> _command(
    Future<TableStateChangeResult> Function(String idempotencyKey) send,
  ) async {
    if (!hasContext || _busy) return false;
    final merchantId = _merchantId!;
    final locationId = _locationId!;
    final operatorSessionId = _operatorSessionId!;
    _busy = true;
    _errorCode = null;
    if (!_disposed) notifyListeners();
    try {
      final result = await send(_uuid());
      if (_disposed) return false;
      _applyChange(result);
      notifyListeners();
      await load(merchantId, locationId, operatorSessionId);
      return true;
    } on AppException catch (error) {
      _errorCode = error.code;
      return false;
    } catch (_) {
      // ANYTHING ELSE STILL HAS TO RELEASE THE SURFACE.
      //
      // The sibling cash controller caught only `AppException` here, so a
      // decoding slip left its screen behind a progress bar for ever with no
      // message and no way out. A refusal the operator can read is what this
      // code owes them, whatever the failure turns out to be.
      _errorCode = 'TABLE_OPERATION_FAILED';
      return false;
    } finally {
      _busy = false;
      if (!_disposed) notifyListeners();
    }
  }

  void _install(TableStateMap map) {
    final entries = <String, TableStateEntry>{};
    for (final raw in map.states) {
      final entry = TableStateEntry.fromJson(raw);
      entries[entry.tableId] = entry;
    }
    _map = map;
    _entries = entries;
    _receivedAtLocal = _clock();
  }

  /// Draw the command's own result immediately, then let the read that follows
  /// replace it with the room.
  void _applyChange(TableStateChangeResult result) {
    final current = _map;
    final merged = <String, Map<String, Object?>>{};
    for (final raw in current?.states ?? const <Map<String, Object?>>[]) {
      final id = raw['tableId'];
      if (id is String) merged[id] = raw;
    }
    for (final changed in result.changed) {
      final id = changed['tableId'];
      if (id is String) merged[id] = changed;
    }
    _install(
      TableStateMap(
        locationId: current?.locationId ?? result.locationId,
        serverTime: result.serverTime,
        states: merged.values.toList(growable: false),
      ),
    );
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }

  /// A v4 UUID, minted per command so a retry after a lost response is a new
  /// attempt the server can journal rather than a silent second party.
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
