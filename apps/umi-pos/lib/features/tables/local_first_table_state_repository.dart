import 'dart:async';
import 'dart:math';

import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/storage/local_working_copy.dart';
import '../offline/offline_journal.dart';
import '../offline/replay_engine.dart';
import 'table_state_repository.dart';

final class TableDeviceIdentity {
  const TableDeviceIdentity({
    required this.deviceId,
    required this.credentialVersion,
  });

  final String deviceId;
  final int credentialVersion;
}

/// A floor plan that keeps working when the uplink does not.
///
/// The cached room is painted first. Every table command is projected onto that
/// cache and committed to the encrypted journal before the method returns, so
/// the tap does not wait for Boston. Replay sends the same operation to the same
/// table service as a live tap, under the live operator session and the original
/// idempotency key.
final class LocalFirstTableStateRepository
    implements TableStateRepository, TableSeatProjectionRepository {
  LocalFirstTableStateRepository({
    required TableStateRepository cloud,
    required LocalWorkingCopy local,
    required EncryptedOfflineJournal journal,
    required TableDeviceIdentity? Function() identity,
    required Future<void> Function(ReplayScope scope) replay,
    this.hubOwned = false,
  }) : _cloud = cloud,
       _local = local,
       _journal = journal,
       _identity = identity,
       _replay = replay;

  static const namespace = 'table_state';
  static const _document = 'room';

  final TableStateRepository _cloud;
  final LocalWorkingCopy _local;
  final EncryptedOfflineJournal _journal;
  final TableDeviceIdentity? Function() _identity;
  final Future<void> Function(ReplayScope scope) _replay;
  final bool hubOwned;

  String _scope(String merchantId, String locationId) =>
      '$merchantId:$locationId';

  Future<TableStateMap?> _cached(String merchantId, String locationId) async {
    final payload = await _local.readDocument(
      namespace,
      _scope(merchantId, locationId),
      _document,
    );
    return payload == null ? null : TableStateMap.fromJson(payload);
  }

  Future<void> _cache(String merchantId, TableStateMap map) =>
      _local.writeDocument(
        namespace: namespace,
        scopeKey: _scope(merchantId, map.locationId),
        id: _document,
        payload: map.toJson(),
      );

  @override
  Future<TableStateMap> read(
    String merchantId,
    PosTableStateQuery query,
  ) async {
    final cached = await _cached(merchantId, query.locationId);
    final TableStateMap server;
    try {
      server = await _cloud.read(merchantId, query);
    } catch (_) {
      if (cached != null) return cached;
      rethrow;
    }
    await _cache(merchantId, server);
    return server;
  }

  @override
  Future<TableStateChangeResult> seat(
    String merchantId,
    SeatTableRequest request,
  ) => _command(
    'seat',
    merchantId,
    request.toJson(),
    online: () => _cloud.seat(merchantId, request),
  );

  @override
  Future<TableStateChangeResult> move(
    String merchantId,
    MovePartyRequest request,
  ) => _command(
    'move',
    merchantId,
    request.toJson(),
    online: () => _cloud.move(merchantId, request),
  );

  @override
  Future<TableStateChangeResult> merge(
    String merchantId,
    MergeTablesRequest request,
  ) => _command(
    'merge',
    merchantId,
    request.toJson(),
    online: () => _cloud.merge(merchantId, request),
  );

  @override
  Future<TableStateChangeResult> split(
    String merchantId,
    SplitPartyRequest request,
  ) => _command(
    'split',
    merchantId,
    request.toJson(),
    online: () => _cloud.split(merchantId, request),
  );

  @override
  Future<TableStateChangeResult> clear(
    String merchantId,
    ClearTableRequest request,
  ) => _command(
    'clear',
    merchantId,
    request.toJson(),
    online: () => _cloud.clear(merchantId, request),
  );

  @override
  Future<TableStateChangeResult> markReady(
    String merchantId,
    OpenTableRequest request,
  ) => _command(
    'open',
    merchantId,
    request.toJson(),
    online: () => _cloud.markReady(merchantId, request),
  );

  @override
  Future<TableStateChangeResult> markOrdered(
    String merchantId,
    MarkTableOrderedRequest request,
  ) => _command(
    'ordered',
    merchantId,
    request.toJson(),
    online: () => _cloud.markOrdered(merchantId, request),
  );

  @override
  Future<TableStateChangeResult> markServed(
    String merchantId,
    MarkTableServedRequest request,
  ) => _command(
    'served',
    merchantId,
    request.toJson(),
    online: () => _cloud.markServed(merchantId, request),
  );

  @override
  Future<TableStateChangeResult> markAwaitingPayment(
    String merchantId,
    MarkTableAwaitingPaymentRequest request,
  ) => _command(
    'awaiting_payment',
    merchantId,
    request.toJson(),
    online: () => _cloud.markAwaitingPayment(merchantId, request),
  );

  @override
  Future<TableStateMap> projectSeat(
    String merchantId,
    String locationId,
    String tableId,
    int partySize,
  ) async {
    final current = await _cached(merchantId, locationId);
    if (current == null) {
      throw const AppException(
        category: AppErrorCategory.configuration,
        code: 'TABLE_STATE_NOT_CACHED',
        recoverable: true,
      );
    }
    String? currentState;
    for (final entry in current.states) {
      if (entry['tableId'] == tableId && entry['state'] is String) {
        currentState = entry['state'] as String;
        break;
      }
    }
    if (currentState != null &&
        !const {'open', 'dirty'}.contains(currentState)) {
      throw const AppException(
        category: AppErrorCategory.conflict,
        code: 'TABLE_ALREADY_OCCUPIED',
        recoverable: true,
      );
    }
    final projected = _project(
      action: 'seat',
      request: {
        'tableId': tableId,
        'locationId': locationId,
        'operatorSessionId': '00000000-0000-4000-8000-000000000000',
        'idempotencyKey': '00000000-0000-4000-8000-000000000000',
        'partySize': partySize,
      },
      current: current,
      commandId: 'account-open:$tableId',
    );
    await _cache(merchantId, projected.map);
    return projected.map;
  }

  Future<TableStateChangeResult> _command(
    String action,
    String merchantId,
    Map<String, Object?> request, {
    required Future<TableStateChangeResult> Function() online,
  }) async {
    final identity = _identity();
    if (identity == null) {
      throw const AppException(
        category: AppErrorCategory.configuration,
        code: 'OFFLINE_SCOPE_MISSING',
        recoverable: true,
      );
    }
    final locationId = request['locationId'] as String;
    final operatorSessionId = request['operatorSessionId'] as String;
    final idempotencyKey = request['idempotencyKey'] as String;
    final current = await _cached(merchantId, locationId);
    if (current == null) {
      throw const AppException(
        category: AppErrorCategory.configuration,
        code: 'TABLE_STATE_NOT_CACHED',
        recoverable: true,
      );
    }
    final result = _project(
      action: action,
      request: request,
      current: current,
      commandId: idempotencyKey,
    );
    await _cache(merchantId, result.map);
    try {
      final accepted = await online();
      await _cache(merchantId, result.map);
      return accepted;
    } on AppException catch (error) {
      if (error.category != AppErrorCategory.transport &&
          error.category != AppErrorCategory.timeout &&
          error.category != AppErrorCategory.server) {
        await _cache(merchantId, current);
        rethrow;
      }
    } catch (_) {
      // A platform or LAN transport can surface outside AppException. The
      // durable journal below is the fallback for that offline outcome.
    }
    await _journal.append(
      commandId: idempotencyKey,
      deviceId: identity.deviceId,
      credentialVersion: identity.credentialVersion,
      merchantId: merchantId,
      locationId: locationId,
      operatorSessionId: operatorSessionId,
      idempotencyKey: idempotencyKey,
      commandType: 'pos.table.command',
      hubOwned: hubOwned,
      payload: {'action': action, 'request': request},
    );
    unawaited(
      _replay(
        ReplayScope(
          deviceId: identity.deviceId,
          merchantId: merchantId,
          locationId: locationId,
          operatorSessionId: operatorSessionId,
          credentialVersion: identity.credentialVersion,
        ),
      ),
    );
    return result.change;
  }

  _TableProjection _project({
    required String action,
    required Map<String, Object?> request,
    required TableStateMap current,
    required String commandId,
  }) {
    final now = DateTime.now().toUtc().toIso8601String();
    final entries = <String, Map<String, Object?>>{
      for (final raw in current.states)
        if (raw['tableId'] case final String id)
          id: Map<String, Object?>.from(raw),
    };
    Map<String, Object?> entry(String tableId) =>
        entries[tableId] ??
        <String, Object?>{
          'tableId': tableId,
          'state': 'open',
          'seatedAt': null,
          'partySize': null,
          'groupId': null,
          'openAccountId': null,
          'openAccountFolio': null,
          'openAccountTableId': null,
        };
    Map<String, Object?> write(
      String tableId, {
      required String state,
      String? seatedAt,
      int? partySize,
      String? groupId,
      bool clearAccount = false,
    }) {
      final previous = entry(tableId);
      final next = <String, Object?>{
        ...previous,
        'tableId': tableId,
        'state': state,
        'seatedAt': seatedAt,
        'partySize': partySize,
        'groupId': groupId,
        if (clearAccount) 'openAccountId': null,
        if (clearAccount) 'openAccountFolio': null,
        if (clearAccount) 'openAccountTableId': null,
      };
      entries[tableId] = next;
      return next;
    }

    bool free(String tableId) {
      final state = entry(tableId)['state'] as String? ?? 'open';
      return state == 'open' || state == 'dirty';
    }

    bool present(String tableId) {
      final state = entry(tableId)['state'] as String? ?? 'open';
      return const {
        'seated',
        'ordered',
        'served',
        'awaiting_payment',
      }.contains(state);
    }

    Never refuse(String code) => throw AppException(
      category: AppErrorCategory.conflict,
      code: code,
      recoverable: true,
    );

    final changed = <Map<String, Object?>>[];
    switch (action) {
      case 'seat':
        final tableId = request['tableId']! as String;
        if (!free(tableId)) refuse('TABLE_ALREADY_OCCUPIED');
        changed.add(
          write(
            tableId,
            state: 'seated',
            seatedAt: now,
            partySize: (request['partySize'] as num).toInt(),
            clearAccount: true,
          ),
        );
        break;
      case 'move':
        final from = request['fromTableId']! as String;
        final to = request['toTableId']! as String;
        if (!present(from)) refuse('TABLE_NOT_OCCUPIED');
        if (!free(to)) refuse('TABLE_ALREADY_OCCUPIED');
        final source = Map<String, Object?>.from(entry(from));
        final groupId = source['groupId'] as String?;
        changed.add(
          write(
            to,
            state: source['state']! as String,
            seatedAt: source['seatedAt'] as String?,
            partySize: source['partySize'] as int?,
            clearAccount: true,
          ),
        );
        final released = groupId == null
            ? [from]
            : entries.values
                  .where(
                    (item) =>
                        item['groupId'] == groupId && item['tableId'] != to,
                  )
                  .map((item) => item['tableId']! as String)
                  .toList(growable: false);
        for (final tableId in released) {
          changed.add(write(tableId, state: 'dirty', clearAccount: true));
        }
        break;
      case 'merge':
        final tableIds = (request['tableIds']! as List<Object?>).cast<String>();
        for (final tableId in tableIds) {
          if (!free(tableId)) refuse('TABLE_ALREADY_OCCUPIED');
        }
        final groupId = _uuid();
        final partySize = (request['partySize'] as num).toInt();
        for (final tableId in tableIds) {
          changed.add(
            write(
              tableId,
              state: 'seated',
              seatedAt: now,
              partySize: partySize,
              groupId: groupId,
              clearAccount: true,
            ),
          );
        }
        break;
      case 'split':
        final tableId = request['tableId']! as String;
        if (!present(tableId)) refuse('TABLE_NOT_OCCUPIED');
        final groupId = entry(tableId)['groupId'] as String?;
        if (groupId == null) refuse('TABLE_NOT_GROUPED');
        for (final member in entries.values.toList(growable: false)) {
          if (member['groupId'] != groupId) continue;
          final memberId = member['tableId']! as String;
          changed.add(
            memberId == tableId
                ? write(
                    memberId,
                    state: member['state']! as String,
                    seatedAt: member['seatedAt'] as String?,
                    partySize: member['partySize'] as int?,
                  )
                : write(memberId, state: 'dirty', clearAccount: true),
          );
        }
        break;
      case 'clear':
        final tableId = request['tableId']! as String;
        if (!present(tableId)) refuse('TABLE_NOT_OCCUPIED');
        final groupId = entry(tableId)['groupId'] as String?;
        for (final member in entries.values.toList(growable: false)) {
          if (groupId != null && member['groupId'] != groupId) continue;
          if (groupId == null && member['tableId'] != tableId) continue;
          changed.add(
            write(
              member['tableId']! as String,
              state: 'dirty',
              clearAccount: true,
            ),
          );
        }
        break;
      case 'open':
        final tableId = request['tableId']! as String;
        if (present(tableId)) refuse('TABLE_ALREADY_OCCUPIED');
        changed.add(write(tableId, state: 'open', clearAccount: true));
        break;
      case 'ordered':
      case 'served':
      case 'awaiting_payment':
        final tableId = request['tableId']! as String;
        if (!present(tableId)) refuse('TABLE_NOT_OCCUPIED');
        final state = action;
        final groupId = entry(tableId)['groupId'] as String?;
        for (final member in entries.values.toList(growable: false)) {
          if (groupId != null && member['groupId'] != groupId) continue;
          if (groupId == null && member['tableId'] != tableId) continue;
          changed.add(
            write(
              member['tableId']! as String,
              state: state,
              seatedAt: member['seatedAt'] as String?,
              partySize: member['partySize'] as int?,
              groupId: groupId,
            ),
          );
        }
        break;
      default:
        refuse('OFFLINE_TABLE_ACTION_UNKNOWN');
    }
    changed.sort(
      (left, right) =>
          (left['tableId']! as String).compareTo(right['tableId']! as String),
    );
    final map = TableStateMap(
      locationId: current.locationId,
      serverTime: now,
      states: entries.values.toList(growable: false),
    );
    return _TableProjection(
      map: map,
      change: TableStateChangeResult(
        locationId: current.locationId,
        commandId: commandId,
        changed: changed,
        serverTime: now,
      ),
    );
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

final class _TableProjection {
  const _TableProjection({required this.map, required this.change});

  final TableStateMap map;
  final TableStateChangeResult change;
}
