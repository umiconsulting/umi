import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:cryptography/cryptography.dart';
import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/storage/storage.dart';
import 'sqlite_journal_store.dart';

const offlineJournalSchemaVersion = 1;
const offlineJournalMaxDepth = 250;
const offlineOrderCommandTypes = {
  'pos.cart.open',
  'pos.cart.line.add',
  'pos.cart.line.update',
  'pos.cart.line.remove',
  'pos.cart.clear',
  'pos.cart.prepare',
  'pos.cart.fire',
  'pos.cart.fulfillment.set',
  'pos.cart.table.set',
  'pos.command.group',
  'pos.kds.command',
};
const offlineTableCommandTypes = {'pos.table.command'};
const offlineJournalCommandTypes = {
  ...offlineOrderCommandTypes,
  ...offlineTableCommandTypes,
};

enum JournalStatus {
  pending,
  replaying,
  unknown,
  accepted,
  duplicate,
  conflict,
  resolved,
  archived,
}

final class OfflineJournalException implements Exception {
  const OfflineJournalException(this.category);
  final String category;
  @override
  String toString() => 'OfflineJournalException($category)';
}

final class JournalEntry {
  const JournalEntry({
    required this.command,
    required this.status,
    required this.attempts,
    this.lastReplayAt,
    this.lastSafeErrorCategory,
    this.officialId,
    this.officialCommit,
    this.failure,
    this.serverConflictReference,
    this.retentionDeadline,
    this.hubDeliveryState,
    this.hubCommandId,
    this.hubDeviceSequence,
    this.hubUpdatedAt,
  });
  final OfflineCommand command;
  final JournalStatus status;
  final int attempts;
  final DateTime? lastReplayAt;
  final String? lastSafeErrorCategory;
  final String? officialId;
  final Map<String, Object?>? officialCommit;
  final Map<String, Object?>? failure;
  final String? serverConflictReference;
  final DateTime? retentionDeadline;
  final String? hubDeliveryState;
  final String? hubCommandId;
  final int? hubDeviceSequence;
  final DateTime? hubUpdatedAt;

  JournalEntry replayed({
    required JournalStatus status,
    String? error,
    String? officialId,
    Map<String, Object?>? officialCommit,
    Map<String, Object?>? failure,
    String? serverConflictReference,
    String? hubDeliveryState,
    String? hubCommandId,
    int? hubDeviceSequence,
    DateTime? hubUpdatedAt,
  }) => JournalEntry(
    command: command,
    status: status,
    attempts: attempts + 1,
    lastReplayAt: DateTime.now().toUtc(),
    lastSafeErrorCategory: error,
    officialId: officialId ?? this.officialId,
    officialCommit: officialCommit ?? this.officialCommit,
    failure: failure ?? this.failure,
    serverConflictReference:
        serverConflictReference ?? this.serverConflictReference,
    hubDeliveryState: hubDeliveryState ?? this.hubDeliveryState,
    hubCommandId: hubCommandId ?? this.hubCommandId,
    hubDeviceSequence: hubDeviceSequence ?? this.hubDeviceSequence,
    hubUpdatedAt: hubUpdatedAt ?? this.hubUpdatedAt,
    retentionDeadline:
        (status == JournalStatus.accepted || status == JournalStatus.duplicate)
        ? DateTime.now().toUtc().add(const Duration(days: 30))
        : retentionDeadline,
  );

  JournalEntry resolvedConflict() => JournalEntry(
    command: command,
    status: JournalStatus.resolved,
    attempts: attempts,
    lastReplayAt: DateTime.now().toUtc(),
    lastSafeErrorCategory: lastSafeErrorCategory,
    officialId: officialId,
    officialCommit: officialCommit,
    failure: failure,
    serverConflictReference: serverConflictReference,
    retentionDeadline: DateTime.now().toUtc().add(const Duration(days: 30)),
  );

  Map<String, Object?> toJson() => {
    'command': command.toJson(),
    'status': status.name,
    'attempts': attempts,
    'lastReplayAt': lastReplayAt?.toIso8601String(),
    'lastSafeErrorCategory': lastSafeErrorCategory,
    'officialId': officialId,
    'officialCommit': officialCommit,
    'failure': failure,
    'serverConflictReference': serverConflictReference,
    'retentionDeadline': retentionDeadline?.toIso8601String(),
    'hubDeliveryState': hubDeliveryState,
    'hubCommandId': hubCommandId,
    'hubDeviceSequence': hubDeviceSequence,
    'hubUpdatedAt': hubUpdatedAt?.toIso8601String(),
  };
  factory JournalEntry.fromJson(Map<String, Object?> json) => JournalEntry(
    command: OfflineCommand.fromJson(json['command']! as Map<String, Object?>),
    status: JournalStatus.values.byName(json['status']! as String),
    attempts: json['attempts']! as int,
    lastReplayAt: _date(json['lastReplayAt']),
    lastSafeErrorCategory: json['lastSafeErrorCategory'] as String?,
    officialId: json['officialId'] as String?,
    officialCommit: json['officialCommit'] as Map<String, Object?>?,
    failure: json['failure'] as Map<String, Object?>?,
    serverConflictReference: json['serverConflictReference'] as String?,
    retentionDeadline: _date(json['retentionDeadline']),
    hubDeliveryState: json['hubDeliveryState'] as String?,
    hubCommandId: json['hubCommandId'] as String?,
    hubDeviceSequence: (json['hubDeviceSequence'] as num?)?.toInt(),
    hubUpdatedAt: _date(json['hubUpdatedAt']),
  );
}

DateTime? _date(Object? value) =>
    value == null ? null : DateTime.parse(value as String);

int _advanceAcknowledgedSequence(
  List<JournalEntry> entries,
  int acknowledged, [
  Map<int, int>? indexBySequence,
]) {
  var next = acknowledged;
  while (true) {
    final JournalEntry entry;
    if (indexBySequence != null) {
      final index = indexBySequence[next + 1];
      if (index == null || index < 0 || index >= entries.length) return next;
      entry = entries[index];
    } else {
      final matches = entries.where(
        (item) => item.command.deviceSequence == next + 1,
      );
      if (matches.isEmpty) return next;
      entry = matches.single;
    }
    if (entry.status != JournalStatus.accepted &&
        entry.status != JournalStatus.duplicate &&
        entry.status != JournalStatus.resolved) {
      return next;
    }
    next += 1;
  }
}

final class OfflineJournalSnapshot {
  const OfflineJournalSnapshot({
    required this.nextSequence,
    required this.lastAcknowledgedSequence,
    required this.entries,
    required this.mappings,
    this.cachedPolicy,
    this.lastTrustedServerTime,
    this.lastTrustedLocalTime,
    this.recoveryAudit = const [],
  });
  final int nextSequence;
  final int lastAcknowledgedSequence;
  final List<JournalEntry> entries;
  final Map<String, String> mappings;
  final Map<String, Object?>? cachedPolicy;
  final DateTime? lastTrustedServerTime;
  final DateTime? lastTrustedLocalTime;
  final List<Map<String, Object?>> recoveryAudit;
  int get pendingCount => entries
      .where(
        (e) =>
            e.status == JournalStatus.pending ||
            e.status == JournalStatus.unknown ||
            e.status == JournalStatus.conflict,
      )
      .length;

  /// A refused sale for one account must not stop an unrelated online sale.
  /// Unknown command shapes block checkout until recovery can identify them.
  bool hasPendingForCart(String cartId) {
    for (final entry in entries) {
      if (entry.status != JournalStatus.pending &&
          entry.status != JournalStatus.replaying &&
          entry.status != JournalStatus.unknown &&
          entry.status != JournalStatus.conflict) {
        continue;
      }
      final command = entry.command;
      if (command.commandType == 'pos.table.command' ||
          command.commandType == 'pos.kds.command' ||
          command.commandType == 'operational.ack') {
        continue;
      }
      final snapshot = command.payload['snapshot'];
      final checkout = snapshot is Map ? snapshot['checkoutCommand'] : null;
      final rawId =
          command.payload['cartId'] ??
          (checkout is Map ? checkout['cartId'] : null) ??
          command.provisionalId;
      if (rawId is! String || rawId.isEmpty) return true;
      if (rawId == cartId || mappings[rawId] == cartId) return true;
    }
    return false;
  }

  Iterable<JournalEntry> get activeCash => entries.where(
    (entry) =>
        entry.command.commandType == 'pos.checkout.cash' &&
        entry.status != JournalStatus.accepted &&
        entry.status != JournalStatus.duplicate &&
        entry.status != JournalStatus.resolved &&
        entry.status != JournalStatus.archived,
  );
  int get pendingCashCount => activeCash.length;
  int get pendingCashMinorUnits => activeCash.fold(0, (sum, entry) {
    final snapshot = entry.command.payload['snapshot'];
    if (snapshot is! Map<String, Object?>) return sum;
    return sum + ((snapshot['amountDueMinorUnits'] as num?)?.toInt() ?? 0);
  });
}

abstract interface class JournalCipherStore {
  Future<String?> readCiphertext();
  Future<void> writeCiphertext(String value);
  Future<String?> readKey();
  Future<void> writeKey(String value);
}

final class PlatformJournalCipherStore implements JournalCipherStore {
  PlatformJournalCipherStore(this._preferences, this._secure);
  final PreferencesStore _preferences;
  final SecureKeyValueStorage _secure;
  static const _document = 'offline.journal.v1';
  static const _key = 'offline.journal.key.v1';
  @override
  Future<String?> readCiphertext() => _preferences.readString(_document);
  @override
  Future<void> writeCiphertext(String value) async {
    await _preferences.writeString(_document, value);
    final persisted = await _preferences.readString(_document);
    if (persisted != value) {
      throw const OfflineJournalException('journal_write_failed');
    }
  }

  @override
  Future<String?> readKey() => _secure.read(_key);
  @override
  Future<void> writeKey(String value) => _secure.write(_key, value);
}

/// Native-only authenticated encrypted, versioned and bounded command journal.
///
/// The AES-256-GCM key is held by platform secure storage. When backed by
/// [SqliteJournalStore], each command row and metadata record is individually
/// encrypted and committed inside a single SQLite WAL transaction in O(1) time.
/// Without a [SqliteJournalStore] (legacy / unit tests), ciphertext is stored
/// via [JournalCipherStore].
final class EncryptedOfflineJournal {
  EncryptedOfflineJournal(
    this._store, {
    SqliteJournalStore? sqliteStore,
    bool? web,
  }) : _sqliteStore = sqliteStore,
       _web = web ?? kIsWeb,
       _mutationQueue = _queues[sqliteStore ?? _store] ??=
           _JournalMutationQueue();
  static final Expando<_JournalMutationQueue> _queues =
      Expando<_JournalMutationQueue>('encrypted-journal-writer');
  static const _emptySnapshot = OfflineJournalSnapshot(
    nextSequence: 1,
    lastAcknowledgedSequence: 0,
    entries: [],
    mappings: {},
    cachedPolicy: null,
    lastTrustedServerTime: null,
    lastTrustedLocalTime: null,
  );

  final JournalCipherStore _store;
  final SqliteJournalStore? _sqliteStore;
  final _JournalMutationQueue _mutationQueue;
  final bool _web;
  final _cipher = AesGcm.with256bits();
  final ValueNotifier<int> pendingCount = ValueNotifier<int>(0);
  OfflineJournalSnapshot? _lastSnapshot;
  String? _lastCiphertext;
  String? _lastKeyString;
  SecretKey? _cachedSecretKey;
  int _loadedSqliteGeneration = -1;
  bool _sqliteInitialized = false;
  bool _legacyMigrated = false;
  String? _lastDeviceId;
  String? _lastMerchantId;
  String? _lastLocationId;

  // O(1) in-memory lookup indexes aligned with `_lastSnapshot`.
  final Map<String, int> _indexByCommandId = {};
  final Map<int, int> _indexBySequence = {};
  final Map<String, String> _checkoutIdentityToCommandId = {};
  int _activeCount = 0;
  int _pendingCashCount = 0;
  int _pendingCashMinorUnits = 0;
  int? _earliestRetentionDeadlineMs;

  bool hasPendingForCart(String cartId) =>
      _lastSnapshot?.hasPendingForCart(cartId) ?? pendingCount.value > 0;

  bool get supportsSecureOffline => !_web;

  Future<void> close() async {
    await _sqliteStore?.close();
    _sqliteInitialized = false;
    _loadedSqliteGeneration = -1;
  }

  Future<OfflineJournalSnapshot> load() async {
    _ensureSupported();
    final sqlite = _sqliteStore;
    if (sqlite != null) {
      return _loadSqlite(sqlite);
    }
    return _loadLegacy();
  }

  Future<OfflineJournalSnapshot> _loadLegacy() async {
    final encoded = await _store.readCiphertext();
    if (encoded == null) {
      _lastCiphertext = null;
      _clearMemoryState();
      return _emptySnapshot;
    }
    if (encoded == _lastCiphertext && _lastSnapshot != null) {
      return _lastSnapshot!;
    }
    final snapshot = await _decryptLegacyBlob(encoded);
    if (snapshot == null) {
      _lastCiphertext = encoded;
      _publishPending(_emptySnapshot);
      return _emptySnapshot;
    }
    _lastCiphertext = encoded;
    _publishPending(snapshot);
    return snapshot;
  }

  Future<OfflineJournalSnapshot> _loadSqlite(SqliteJournalStore sqlite) async {
    if (_sqliteInitialized &&
        _lastSnapshot != null &&
        _loadedSqliteGeneration == sqlite.writeGeneration) {
      return _lastSnapshot!;
    }
    await sqlite.initialize();
    final metaRow = await sqlite.readMeta();
    if (metaRow == null) {
      // One-time atomic migration from legacy `offline.journal.v1` blob.
      final legacyEncoded = await _store.readCiphertext();
      if (legacyEncoded != null) {
        final migrated = await _decryptLegacyBlob(legacyEncoded);
        if (migrated != null) {
          final key = await _key(create: true);
          _syncDeviceScopeFromSnapshot(migrated);
          _legacyMigrated = true;
          final entryRows = <SqliteJournalEntryRow>[];
          for (final entry in migrated.entries) {
            entryRows.add(await _encodeSqliteEntry(entry, key));
          }
          final meta = await _encodeSqliteMeta(
            migrated,
            key,
            legacyMigrated: true,
          );
          await sqlite.writeFullState(
            meta: meta,
            entries: entryRows,
            replaceExisting: true,
          );
          // Mark legacy blob migrated so SharedPreferences XML shrinks and
          // never re-imports. Best-effort because SQLite already committed.
          try {
            await _store.writeCiphertext(
              jsonEncode({
                'schemaVersion': offlineJournalSchemaVersion,
                'migratedToSqlite': true,
              }),
            );
          } catch (_) {}
          _sqliteInitialized = true;
          _loadedSqliteGeneration = sqlite.writeGeneration;
          _publishPending(migrated);
          return migrated;
        }
      }
      _sqliteInitialized = true;
      _loadedSqliteGeneration = sqlite.writeGeneration;
      _publishPending(_emptySnapshot);
      return _emptySnapshot;
    }
    try {
      if (metaRow.schemaVersion != offlineJournalSchemaVersion) {
        throw const OfflineJournalException('schema_version_unsupported');
      }
      final key = await _key(create: false);
      final metaData = await _decryptJson(metaRow.metaEnc, key);
      final nextSequence = metaData['nextSequence']! as int;
      final lastAck = metaData['lastAcknowledgedSequence']! as int;
      if (nextSequence != metaRow.nextSequence ||
          lastAck != metaRow.lastAcknowledgedSequence) {
        throw const OfflineJournalException('journal_integrity_failed');
      }
      final entryRows = await sqlite.readAllEntries();
      final entries = <JournalEntry>[];
      for (final row in entryRows) {
        final decoded = await _decryptJson(row.payloadEnc, key);
        final entry = JournalEntry.fromJson(decoded);
        if (entry.command.deviceSequence != row.deviceSequence ||
            entry.command.commandId != row.commandId) {
          throw const OfflineJournalException('journal_integrity_failed');
        }
        entries.add(entry);
      }
      final snapshot = OfflineJournalSnapshot(
        nextSequence: nextSequence,
        lastAcknowledgedSequence: lastAck,
        entries: List<JournalEntry>.unmodifiable(entries),
        mappings: (metaData['mappings']! as Map<String, Object?>).map(
          (k, v) => MapEntry(k, v! as String),
        ),
        cachedPolicy: metaData['cachedPolicy'] as Map<String, Object?>?,
        lastTrustedServerTime: _date(metaData['lastTrustedServerTime']),
        lastTrustedLocalTime: _date(metaData['lastTrustedLocalTime']),
        recoveryAudit:
            (metaData['recoveryAudit'] as List<Object?>? ?? const [])
                .map((item) => item! as Map<String, Object?>)
                .toList(growable: false),
      );
      _lastDeviceId = metaRow.deviceId;
      _lastMerchantId = metaRow.merchantId;
      _lastLocationId = metaRow.locationId;
      _legacyMigrated = metaRow.legacyMigrated;
      _sqliteInitialized = true;
      _loadedSqliteGeneration = sqlite.writeGeneration;
      _publishPending(snapshot);
      return snapshot;
    } on OfflineJournalException {
      rethrow;
    } catch (_) {
      throw const OfflineJournalException('journal_integrity_failed');
    }
  }

  Future<OfflineJournalSnapshot?> _decryptLegacyBlob(String encoded) async {
    try {
      final wrapper = jsonDecode(encoded) as Map<String, Object?>;
      if (wrapper['migratedToSqlite'] == true) {
        return null;
      }
      if (wrapper['schemaVersion'] != offlineJournalSchemaVersion) {
        throw const OfflineJournalException('schema_version_unsupported');
      }
      final key = await _key(create: false);
      final data = await _decryptWrapper(wrapper, key);
      return OfflineJournalSnapshot(
        nextSequence: data['nextSequence']! as int,
        lastAcknowledgedSequence: data['lastAcknowledgedSequence']! as int,
        entries: (data['entries']! as List<Object?>)
            .map((e) => JournalEntry.fromJson(e! as Map<String, Object?>))
            .toList(growable: false),
        mappings: (data['mappings']! as Map<String, Object?>).map(
          (key, value) => MapEntry(key, value! as String),
        ),
        cachedPolicy: data['cachedPolicy'] as Map<String, Object?>?,
        lastTrustedServerTime: _date(data['lastTrustedServerTime']),
        lastTrustedLocalTime: _date(data['lastTrustedLocalTime']),
        recoveryAudit: (data['recoveryAudit'] as List<Object?>? ?? const [])
            .map((item) => item! as Map<String, Object?>)
            .toList(growable: false),
      );
    } on OfflineJournalException {
      rethrow;
    } catch (_) {
      throw const OfflineJournalException('journal_integrity_failed');
    }
  }

  Future<OfflineCommand> append({
    required String commandId,
    required String deviceId,
    required int credentialVersion,
    required String merchantId,
    required String locationId,
    required String operatorSessionId,
    required String idempotencyKey,
    required Map<String, Object?> payload,
    String commandType = 'operational.ack',
    String? provisionalId,
    String? originDeviceId,
    String? originOperatorSessionId,
    String? hubReceivedAt,
    bool hubOwned = false,
    String? deduplicationKey,
    int? maxPendingCashCount,
    int? maxPendingCashMinorUnits,
    int? cashAmountMinorUnits,
  }) => _mutate((current) async {
    if (commandType != 'operational.ack' &&
        commandType != 'pos.checkout.cash' &&
        !offlineJournalCommandTypes.contains(commandType)) {
      throw const OfflineJournalException('command_not_offline_eligible');
    }
    if (deduplicationKey != null) {
      final matched = _findByCheckoutIdentity(
        current,
        commandType,
        deduplicationKey,
      );
      if (matched != null) {
        return _MutationResult(
          snapshot: current,
          value: matched.command,
          changed: false,
        );
      }
    }
    if (commandType == 'pos.checkout.cash') {
      if (maxPendingCashCount == null ||
          maxPendingCashMinorUnits == null ||
          cashAmountMinorUnits == null) {
        throw const OfflineJournalException('cash_policy_limits_missing');
      }
      final pendingCashCount = _hasAlignedIndex(current)
          ? _pendingCashCount
          : current.pendingCashCount;
      final pendingCashMinor = _hasAlignedIndex(current)
          ? _pendingCashMinorUnits
          : current.pendingCashMinorUnits;
      if (pendingCashCount >= maxPendingCashCount) {
        throw const OfflineJournalException('sale_count_limit');
      }
      if (cashAmountMinorUnits > maxPendingCashMinorUnits - pendingCashMinor) {
        throw const OfflineJournalException('accumulated_amount_limit');
      }
    }
    final duplicateIndex = _findIndexByCommandId(current, commandId);
    if (duplicateIndex >= 0) {
      final existing = current.entries[duplicateIndex].command;
      final same =
          existing.deviceId == deviceId &&
          existing.deviceCredentialVersion == credentialVersion &&
          existing.merchantId == merchantId &&
          existing.locationId == locationId &&
          existing.operatorSessionId == operatorSessionId &&
          existing.commandType == commandType &&
          existing.idempotencyKey == idempotencyKey &&
          existing.provisionalId == provisionalId &&
          jsonEncode(_canonical(existing.payload)) ==
              jsonEncode(_canonical(payload));
      if (same) {
        return _MutationResult(
          snapshot: current,
          value: existing,
          changed: false,
        );
      }
      throw const OfflineJournalException('fingerprint_mismatch');
    }
    final now = DateTime.now().toUtc();
    final nowMs = now.millisecondsSinceEpoch;
    final createdAt = now.toIso8601String();
    final bool needsPrune =
        !_hasAlignedIndex(current) ||
        (_earliestRetentionDeadlineMs != null &&
            _earliestRetentionDeadlineMs! <= nowMs);
    final List<JournalEntry> retained;
    final List<int> deletedSequences;
    final int activeCount;
    if (needsPrune) {
      retained = _retainedEntries(current, now);
      if (retained.length == current.entries.length) {
        deletedSequences = const [];
      } else {
        final keptSeqs = {for (final e in retained) e.command.deviceSequence};
        deletedSequences = [
          for (final e in current.entries)
            if (!keptSeqs.contains(e.command.deviceSequence))
              e.command.deviceSequence,
        ];
      }
      activeCount = retained.where(_isActive).length;
    } else {
      retained = current.entries;
      deletedSequences = const [];
      activeCount = _activeCount;
    }
    // Retained receipts and settled commands are history, not unsynced work.
    if (activeCount >= offlineJournalMaxDepth) {
      throw const OfflineJournalException('queue_capacity_exceeded');
    }
    final unsigned = OfflineCommand(
      commandId: commandId,
      provisionalId: provisionalId,
      deviceId: deviceId,
      deviceCredentialVersion: credentialVersion,
      deviceSequence: current.nextSequence,
      merchantId: merchantId,
      locationId: locationId,
      operatorSessionId: operatorSessionId,
      commandType: commandType,
      idempotencyKey: idempotencyKey,
      fingerprint: List.filled(64, '0').join(),
      contractVersion: contractVersion,
      schemaVersion: offlineJournalSchemaVersion,
      createdAt: createdAt,
      originDeviceId: originDeviceId,
      originOperatorSessionId: originOperatorSessionId,
      hubReceivedAt: hubReceivedAt,
      hubOwned: hubOwned,
      payload: payload,
    ).toJson()..remove('fingerprint');
    final canonical = jsonEncode(_canonical(unsigned));
    final fingerprint = sha256.convert(utf8.encode(canonical)).toString();
    final command = OfflineCommand(
      commandId: commandId,
      provisionalId: provisionalId,
      deviceId: deviceId,
      deviceCredentialVersion: credentialVersion,
      deviceSequence: current.nextSequence,
      merchantId: merchantId,
      locationId: locationId,
      operatorSessionId: operatorSessionId,
      commandType: commandType,
      idempotencyKey: idempotencyKey,
      fingerprint: fingerprint,
      contractVersion: contractVersion,
      schemaVersion: offlineJournalSchemaVersion,
      createdAt: createdAt,
      originDeviceId: originDeviceId,
      originOperatorSessionId: originOperatorSessionId,
      hubReceivedAt: hubReceivedAt,
      hubOwned: hubOwned,
      payload: payload,
    );
    final newEntry = JournalEntry(
      command: command,
      status: JournalStatus.pending,
      attempts: 0,
    );
    final next = OfflineJournalSnapshot(
      nextSequence: current.nextSequence + 1,
      lastAcknowledgedSequence: current.lastAcknowledgedSequence,
      entries: [...retained, newEntry],
      mappings: current.mappings,
      cachedPolicy: current.cachedPolicy,
      lastTrustedServerTime: current.lastTrustedServerTime,
      lastTrustedLocalTime: current.lastTrustedLocalTime,
      recoveryAudit: current.recoveryAudit,
    );
    return _MutationResult(
      snapshot: next,
      value: command,
      delta: _JournalDelta.upsert(
        entries: [newEntry],
        deleteSequences: deletedSequences,
        singleAppend: deletedSequences.isEmpty,
      ),
    );
  });

  Future<void> apply(ReplayResult result) => _mutate((current) async {
    final index = _findIndexByCommandId(current, result.commandId);
    if (index < 0) {
      throw const OfflineJournalException('result_command_unknown');
    }
    final old = current.entries[index];
    final status = switch (result.status) {
      'accepted' => JournalStatus.accepted,
      'duplicate' => JournalStatus.duplicate,
      'conflict' || 'rejected' => JournalStatus.conflict,
      _ => throw const OfflineJournalException('result_status_unknown'),
    };
    final updated = old.replayed(
      status: status,
      error: result.failure?['classification'] as String?,
      officialId: result.officialId,
      officialCommit: result.officialCommit,
      failure: result.failure,
      serverConflictReference: result.serverConflictReference,
    );
    final entries = [...current.entries];
    entries[index] = updated;
    final mappings = {...current.mappings};
    if (old.command.provisionalId != null && result.officialId != null) {
      final existing = mappings[old.command.provisionalId];
      if (existing != null && existing != result.officialId) {
        throw const OfflineJournalException('provisional_mapping_conflict');
      }
      mappings[old.command.provisionalId!] = result.officialId!;
    }
    final acknowledged = _advanceAcknowledgedSequence(
      entries,
      current.lastAcknowledgedSequence,
      _hasAlignedIndex(current) ? _indexBySequence : null,
    );
    return _MutationResult<void>(
      snapshot: OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: acknowledged,
        entries: entries,
        mappings: mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
        recoveryAudit: current.recoveryAudit,
      ),
      value: null,
      delta: _JournalDelta.upsert(
        entries: [updated],
        replacedIndex: index,
        replacedOldEntry: old,
      ),
    );
  });

  /// Record the hub's custody state for one peer-owned command.
  ///
  /// A queued receipt proves that the hub has a durable copy. The peer keeps
  /// the entry in its own queue until the hub reports the cloud result. An
  /// accepted receipt closes the peer entry and installs the official ID.
  Future<void> recordHubDelivery({
    required String commandId,
    required String state,
    required String hubCommandId,
    required int hubDeviceSequence,
    String? officialId,
    Map<String, Object?>? officialCommit,
    Map<String, Object?>? failure,
    String? errorCode,
  }) => _mutate((current) async {
    final index = _findIndexByCommandId(current, commandId);
    if (index < 0) {
      throw const OfflineJournalException('result_command_unknown');
    }
    final old = current.entries[index];
    if (old.command.hubOwned != true) {
      throw const OfflineJournalException('hub_delivery_not_peer_owned');
    }
    final status = switch (state) {
      'queued' || 'pending' => JournalStatus.pending,
      'accepted' => JournalStatus.accepted,
      'duplicate' => JournalStatus.duplicate,
      'conflict' || 'rejected' => JournalStatus.conflict,
      'resolved' => JournalStatus.resolved,
      _ => throw const OfflineJournalException('hub_status_unknown'),
    };
    final terminal =
        status == JournalStatus.accepted ||
        status == JournalStatus.duplicate ||
        status == JournalStatus.conflict ||
        status == JournalStatus.resolved;
    final updated = JournalEntry(
      command: old.command,
      status: status,
      attempts: old.attempts + (terminal ? 1 : 0),
      lastReplayAt: terminal ? DateTime.now().toUtc() : old.lastReplayAt,
      lastSafeErrorCategory:
          errorCode ?? (terminal ? null : old.lastSafeErrorCategory),
      officialId: officialId ?? old.officialId,
      officialCommit: officialCommit ?? old.officialCommit,
      failure:
          failure ??
          (terminal && status != JournalStatus.conflict ? null : old.failure),
      serverConflictReference: old.serverConflictReference,
      retentionDeadline:
          status == JournalStatus.accepted ||
              status == JournalStatus.duplicate ||
              status == JournalStatus.resolved
          ? DateTime.now().toUtc().add(const Duration(days: 30))
          : old.retentionDeadline,
      hubDeliveryState: state,
      hubCommandId: hubCommandId,
      hubDeviceSequence: hubDeviceSequence,
      hubUpdatedAt: DateTime.now().toUtc(),
    );
    final entries = [...current.entries];
    entries[index] = updated;
    final mappings = {...current.mappings};
    if (old.command.provisionalId != null && officialId != null) {
      final existing = mappings[old.command.provisionalId];
      if (existing != null && existing != officialId) {
        throw const OfflineJournalException('provisional_mapping_conflict');
      }
      mappings[old.command.provisionalId!] = officialId;
    }
    return _MutationResult<void>(
      snapshot: OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: _advanceAcknowledgedSequence(
          entries,
          current.lastAcknowledgedSequence,
          _hasAlignedIndex(current) ? _indexBySequence : null,
        ),
        entries: entries,
        mappings: mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
        recoveryAudit: current.recoveryAudit,
      ),
      value: null,
      delta: _JournalDelta.upsert(
        entries: [updated],
        replacedIndex: index,
        replacedOldEntry: old,
      ),
    );
  });

  /// Forget a hub receipt that the hub no longer knows.
  ///
  /// The local copy stays pending and is safe to submit again with the same
  /// identities. This covers a hub restore from an older backup.
  Future<void> clearHubDelivery(String commandId) => _mutate((current) async {
    final index = _findIndexByCommandId(current, commandId);
    if (index < 0) {
      throw const OfflineJournalException('result_command_unknown');
    }
    final old = current.entries[index];
    if (old.command.hubOwned != true || old.status != JournalStatus.pending) {
      throw const OfflineJournalException('hub_delivery_not_resettable');
    }
    final updated = JournalEntry(
      command: old.command,
      status: JournalStatus.pending,
      attempts: old.attempts,
      lastReplayAt: old.lastReplayAt,
      lastSafeErrorCategory: old.lastSafeErrorCategory,
      officialId: old.officialId,
      officialCommit: old.officialCommit,
      failure: old.failure,
      serverConflictReference: old.serverConflictReference,
      retentionDeadline: old.retentionDeadline,
    );
    final entries = [...current.entries];
    entries[index] = updated;
    return _MutationResult<void>(
      snapshot: OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: current.lastAcknowledgedSequence,
        entries: entries,
        mappings: current.mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
        recoveryAudit: current.recoveryAudit,
      ),
      value: null,
      delta: _JournalDelta.upsert(
        entries: [updated],
        replacedIndex: index,
        replacedOldEntry: old,
      ),
    );
  });

  /// Return a refused command to the ordered queue after its cause is fixed.
  ///
  /// The command identity and sequence do not change, so the server's
  /// idempotency and ordered cursor still apply. This is limited to writes for
  /// which a second submission cannot create a second business fact.
  Future<void> retryConflict(String commandId) => _mutate((current) async {
    final index = _findIndexByCommandId(current, commandId);
    if (index < 0) {
      throw const OfflineJournalException('result_command_unknown');
    }
    final entry = current.entries[index];
    if (entry.status != JournalStatus.conflict ||
        (entry.command.commandType != 'pos.kds.command' &&
            entry.command.commandType != 'pos.table.command' &&
            entry.command.commandType != 'pos.checkout.cash')) {
      throw const OfflineJournalException('command_not_retryable');
    }
    final updated = JournalEntry(
      command: entry.command,
      status: JournalStatus.pending,
      attempts: entry.attempts,
    );
    final entries = [...current.entries];
    entries[index] = updated;
    return _MutationResult(
      snapshot: OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: current.lastAcknowledgedSequence,
        entries: entries,
        mappings: current.mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
        recoveryAudit: current.recoveryAudit,
      ),
      value: null,
      delta: _JournalDelta.upsert(
        entries: [updated],
        replacedIndex: index,
        replacedOldEntry: entry,
      ),
    );
  });

  /// Start a clean ordered stream after this installation is enrolled as a new
  /// device identity.
  ///
  /// Replaying an old device's sequence under the new device is impossible: the
  /// server correctly refuses the command as a scope change. Keeping those cart
  /// commands forever left the queue blocked and allowed a provisional local
  /// cart to survive beside the server's real account. Financial commands are
  /// never discarded here; they remain for explicit recovery.
  Future<int> discardForeignReplayScope({
    required String deviceId,
    required int credentialVersion,
  }) => _mutate((current) async {
    final foreign = current.entries
        .where(
          (entry) =>
              entry.command.deviceId != deviceId ||
              entry.command.deviceCredentialVersion != credentialVersion,
        )
        .toList(growable: false);
    if (foreign.isEmpty) {
      return _MutationResult(snapshot: current, value: 0, changed: false);
    }
    if (foreign.any(
      (entry) => entry.command.commandType == 'pos.checkout.cash',
    )) {
      throw const OfflineJournalException(
        'foreign_device_cash_requires_recovery',
      );
    }
    return _MutationResult(
      snapshot: OfflineJournalSnapshot(
        // A device-identity reset invalidates the whole ordered stream. Keeping
        // even same-device commands from after the reset would preserve their
        // old sequence numbers and recreate the same gap.
        nextSequence: 1,
        lastAcknowledgedSequence: 0,
        entries: const [],
        mappings: const {},
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
        recoveryAudit: current.recoveryAudit,
      ),
      value: current.entries.length,
      delta: const _JournalDelta.resetAll(),
    );
  });

  /// Close a refused command and return gap conflicts behind it to the queue.
  ///
  /// The resolved entry remains in the journal. A later `sequence_gap` was
  /// caused by the refused sequence, so it is pending again only after the
  /// server advances the cursor.
  Future<int> resolveConflictAndRetryFollowing(String commandId) =>
      _mutate((current) async {
        final index = _findIndexByCommandId(current, commandId);
        if (index < 0) {
          throw const OfflineJournalException('result_command_unknown');
        }
        final entry = current.entries[index];
        if (entry.status != JournalStatus.conflict) {
          throw const OfflineJournalException('command_not_in_conflict');
        }
        final entries = [...current.entries];
        final resolved = entry.resolvedConflict();
        entries[index] = resolved;
        final touched = <JournalEntry>[resolved];
        var retried = 0;
        for (var cursor = index + 1; cursor < entries.length; cursor++) {
          final following = entries[cursor];
          if (following.status != JournalStatus.conflict ||
              (following.lastSafeErrorCategory != 'sequence_gap' &&
                  following.lastSafeErrorCategory != 'stream_blocked')) {
            continue;
          }
          final requeued = JournalEntry(
            command: following.command,
            status: JournalStatus.pending,
            attempts: following.attempts,
          );
          entries[cursor] = requeued;
          touched.add(requeued);
          retried++;
        }
        final acknowledged = _advanceAcknowledgedSequence(
          entries,
          current.lastAcknowledgedSequence,
          _hasAlignedIndex(current) ? _indexBySequence : null,
        );
        return _MutationResult(
          snapshot: OfflineJournalSnapshot(
            nextSequence: current.nextSequence,
            lastAcknowledgedSequence: acknowledged,
            entries: entries,
            mappings: current.mappings,
            cachedPolicy: current.cachedPolicy,
            lastTrustedServerTime: current.lastTrustedServerTime,
            lastTrustedLocalTime: current.lastTrustedLocalTime,
            recoveryAudit: current.recoveryAudit,
          ),
          value: retried,
          delta: _JournalDelta.upsert(entries: touched),
        );
      });

  /// Return an unknown command to the ordered queue after the server confirms
  /// that it never received the command.
  ///
  /// The command keeps its identity and sequence. The server can therefore
  /// reject a duplicate, and the cursor still sees one ordered fact.
  Future<void> retryUnknown(String commandId) => _mutate((current) async {
    final index = _findIndexByCommandId(current, commandId);
    if (index < 0) {
      throw const OfflineJournalException('result_command_unknown');
    }
    final entry = current.entries[index];
    if (entry.status != JournalStatus.unknown ||
        !offlineJournalCommandTypes.contains(entry.command.commandType)) {
      throw const OfflineJournalException('command_not_retryable');
    }
    final updated = JournalEntry(
      command: entry.command,
      status: JournalStatus.pending,
      attempts: entry.attempts,
    );
    final entries = [...current.entries];
    entries[index] = updated;
    return _MutationResult(
      snapshot: OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: current.lastAcknowledgedSequence,
        entries: entries,
        mappings: current.mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
        recoveryAudit: current.recoveryAudit,
      ),
      value: null,
      delta: _JournalDelta.upsert(
        entries: [updated],
        replacedIndex: index,
        replacedOldEntry: entry,
      ),
    );
  });

  Future<void> markUnknown(String commandId) => _mutate((current) async {
    final index = _findIndexByCommandId(current, commandId);
    if (index < 0) {
      throw const OfflineJournalException('result_command_unknown');
    }
    final entries = [...current.entries];
    final old = entries[index];
    final updated = JournalEntry(
      command: old.command,
      status: JournalStatus.unknown,
      attempts: old.attempts + 1,
      lastReplayAt: DateTime.now().toUtc(),
      lastSafeErrorCategory: 'response_unknown',
      officialId: old.officialId,
      officialCommit: old.officialCommit,
      failure: old.failure,
      serverConflictReference: old.serverConflictReference,
      retentionDeadline: old.retentionDeadline,
    );
    entries[index] = updated;
    return _MutationResult<void>(
      snapshot: OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: current.lastAcknowledgedSequence,
        entries: entries,
        mappings: current.mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
        recoveryAudit: current.recoveryAudit,
      ),
      value: null,
      delta: _JournalDelta.upsert(
        entries: [updated],
        replacedIndex: index,
        replacedOldEntry: old,
      ),
    );
  });

  Future<void> cachePolicy(OfflinePolicy policy, DateTime trustedServerTime) =>
      _mutate((current) async {
        return _MutationResult<void>(
          snapshot: OfflineJournalSnapshot(
            nextSequence: current.nextSequence,
            lastAcknowledgedSequence: current.lastAcknowledgedSequence,
            entries: current.entries,
            mappings: current.mappings,
            cachedPolicy: policy.toJson(),
            lastTrustedServerTime: trustedServerTime.toUtc(),
            lastTrustedLocalTime: DateTime.now().toUtc(),
            recoveryAudit: current.recoveryAudit,
          ),
          value: null,
          delta: const _JournalDelta.metaOnly(),
        );
      });

  Future<void> compact(DateTime now) => _mutate((current) async {
    final utcNow = now.toUtc();
    final retained = _retainedEntries(current, utcNow);
    return _MutationResult<void>(
      snapshot: OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: current.lastAcknowledgedSequence,
        entries: retained,
        mappings: current.mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
        recoveryAudit: current.recoveryAudit,
      ),
      value: null,
      delta: _JournalDelta.prune(now: utcNow),
    );
  });

  bool _isActive(JournalEntry entry) =>
      entry.status != JournalStatus.accepted &&
      entry.status != JournalStatus.duplicate &&
      entry.status != JournalStatus.resolved &&
      entry.status != JournalStatus.archived;

  bool _isUnmappedCashProof(JournalEntry entry, Map<String, String> mappings) =>
      (entry.status == JournalStatus.accepted ||
          entry.status == JournalStatus.duplicate) &&
      entry.command.commandType == 'pos.checkout.cash' &&
      (entry.command.provisionalId == null ||
          !mappings.containsKey(entry.command.provisionalId));

  List<JournalEntry> _retainedEntries(
    OfflineJournalSnapshot current,
    DateTime now,
  ) {
    return current.entries
        .where((entry) {
          if (_isActive(entry)) return true;
          if (_isUnmappedCashProof(entry, current.mappings)) return true;
          final deadline = entry.retentionDeadline;
          return deadline == null || deadline.isAfter(now);
        })
        .toList(growable: false);
  }

  Future<void> recordRecoveryAction(RecoveryAction action, String outcome) =>
      _mutate((current) async {
        final audit = [
          ...current.recoveryAudit,
          <String, Object?>{
            'eventCategory': action.auditEvent,
            'occurredAt': DateTime.now().toUtc().toIso8601String(),
            'diagnosticCode': action.diagnosticCode,
            'outcome': outcome,
          },
        ];
        return _MutationResult<void>(
          snapshot: OfflineJournalSnapshot(
            nextSequence: current.nextSequence,
            lastAcknowledgedSequence: current.lastAcknowledgedSequence,
            entries: current.entries,
            mappings: current.mappings,
            cachedPolicy: current.cachedPolicy,
            lastTrustedServerTime: current.lastTrustedServerTime,
            lastTrustedLocalTime: current.lastTrustedLocalTime,
            recoveryAudit: audit.length <= 100
                ? audit
                : audit.sublist(audit.length - 100),
          ),
          value: null,
          delta: const _JournalDelta.metaOnly(),
        );
      });

  Future<T> _mutate<T>(
    Future<_MutationResult<T>> Function(OfflineJournalSnapshot current)
    mutation,
  ) {
    final result = _mutationQueue.tail.then((_) async {
      final change = await mutation(await load());
      if (change.changed) await _save(change.snapshot, change.delta);
      return change.value;
    });
    _mutationQueue.tail = result.then<void>((_) {}, onError: (_, _) {});
    return result;
  }

  Future<void> _save(
    OfflineJournalSnapshot snapshot,
    _JournalDelta delta,
  ) async {
    _ensureSupported();
    final sqlite = _sqliteStore;
    if (sqlite != null) {
      await _saveSqlite(sqlite, snapshot, delta);
      return;
    }
    await _saveLegacy(snapshot, delta);
  }

  Future<void> _saveSqlite(
    SqliteJournalStore sqlite,
    OfflineJournalSnapshot snapshot,
    _JournalDelta delta,
  ) async {
    final key = await _key(create: true);
    final prevDeviceId = _lastDeviceId;
    final prevMerchantId = _lastMerchantId;
    final prevLocationId = _lastLocationId;
    if (delta.kind == _DeltaKind.resetAll) {
      _lastDeviceId = null;
      _lastMerchantId = null;
      _lastLocationId = null;
    } else if (delta.upsertedEntries.isNotEmpty) {
      final latest = delta.upsertedEntries.last.command;
      _lastDeviceId = latest.deviceId;
      _lastMerchantId = latest.merchantId;
      _lastLocationId = latest.locationId;
    }
    try {
      final meta = await _encodeSqliteMeta(
        snapshot,
        key,
        legacyMigrated: _legacyMigrated,
      );
      switch (delta.kind) {
        case _DeltaKind.none:
          break;
        case _DeltaKind.upsert:
          final encodedRows = <SqliteJournalEntryRow>[];
          for (final entry in delta.upsertedEntries) {
            encodedRows.add(await _encodeSqliteEntry(entry, key));
          }
          await sqlite.upsertEntriesAndMeta(
            meta: meta,
            entries: encodedRows,
            deleteSequences: delta.deleteSequences,
          );
        case _DeltaKind.metaOnly:
          await sqlite.writeMeta(meta);
        case _DeltaKind.prune:
          final now = delta.pruneNow ?? DateTime.now().toUtc();
          final nowMs = now.millisecondsSinceEpoch;
          final cutoffMs = now
              .subtract(const Duration(days: 30))
              .millisecondsSinceEpoch;
          await sqlite.pruneExpired(
            nowMs: nowMs,
            settledCutoffMs: cutoffMs,
            mappedProvisionalIds: snapshot.mappings.keys.toSet(),
            meta: meta,
          );
        case _DeltaKind.resetAll:
          await sqlite.deleteAllAndResetMeta(meta);
      }
      _sqliteInitialized = true;
      _loadedSqliteGeneration = sqlite.writeGeneration;
      _publishPending(snapshot, delta: delta);
    } catch (_) {
      _lastDeviceId = prevDeviceId;
      _lastMerchantId = prevMerchantId;
      _lastLocationId = prevLocationId;
      rethrow;
    }
  }

  Future<void> _saveLegacy(
    OfflineJournalSnapshot snapshot,
    _JournalDelta delta,
  ) async {
    final encodedWrapper = await _encryptJson({
      'nextSequence': snapshot.nextSequence,
      'lastAcknowledgedSequence': snapshot.lastAcknowledgedSequence,
      'entries': snapshot.entries.map((e) => e.toJson()).toList(),
      'mappings': snapshot.mappings,
      'cachedPolicy': snapshot.cachedPolicy,
      'lastTrustedServerTime': snapshot.lastTrustedServerTime
          ?.toIso8601String(),
      'lastTrustedLocalTime': snapshot.lastTrustedLocalTime?.toIso8601String(),
      'recoveryAudit': snapshot.recoveryAudit,
    }, await _key(create: true));
    await _store.writeCiphertext(encodedWrapper);
    _lastCiphertext = encodedWrapper;
    _publishPending(snapshot, delta: delta);
  }

  Future<SqliteJournalMetaRow> _encodeSqliteMeta(
    OfflineJournalSnapshot snapshot,
    SecretKey key, {
    required bool legacyMigrated,
  }) async {
    final metaEnc = await _encryptJson({
      'nextSequence': snapshot.nextSequence,
      'lastAcknowledgedSequence': snapshot.lastAcknowledgedSequence,
      'mappings': snapshot.mappings,
      'cachedPolicy': snapshot.cachedPolicy,
      'lastTrustedServerTime': snapshot.lastTrustedServerTime
          ?.toIso8601String(),
      'lastTrustedLocalTime': snapshot.lastTrustedLocalTime?.toIso8601String(),
      'recoveryAudit': snapshot.recoveryAudit,
    }, key);
    return SqliteJournalMetaRow(
      schemaVersion: offlineJournalSchemaVersion,
      deviceId: _lastDeviceId,
      merchantId: _lastMerchantId,
      locationId: _lastLocationId,
      nextSequence: snapshot.nextSequence,
      lastAcknowledgedSequence: snapshot.lastAcknowledgedSequence,
      lastServerSyncAtMs: snapshot.lastTrustedServerTime
          ?.toUtc()
          .millisecondsSinceEpoch,
      legacyMigrated: legacyMigrated,
      metaEnc: metaEnc,
    );
  }

  Future<SqliteJournalEntryRow> _encodeSqliteEntry(
    JournalEntry entry,
    SecretKey key,
  ) async {
    final command = entry.command;
    final createdAtMs = DateTime.parse(
      command.createdAt,
    ).toUtc().millisecondsSinceEpoch;
    final settled = !_isActive(entry);
    final settledAtMs = settled
        ? (entry.lastReplayAt ?? DateTime.now().toUtc())
              .toUtc()
              .millisecondsSinceEpoch
        : null;
    final payloadEnc = await _encryptJson(entry.toJson(), key);
    return SqliteJournalEntryRow(
      deviceSequence: command.deviceSequence,
      commandId: command.commandId,
      status: entry.status.name,
      commandType: command.commandType,
      cartId: _extractCartId(command),
      provisionalId: command.provisionalId,
      createdAtMs: createdAtMs,
      settledAtMs: settledAtMs,
      retentionDeadlineMs: entry.retentionDeadline
          ?.toUtc()
          .millisecondsSinceEpoch,
      payloadEnc: payloadEnc,
    );
  }

  static String? _extractCartId(OfflineCommand command) {
    final snapshot = command.payload['snapshot'];
    final checkout = snapshot is Map ? snapshot['checkoutCommand'] : null;
    final rawId =
        command.payload['cartId'] ??
        (checkout is Map ? checkout['cartId'] : null);
    return rawId is String && rawId.isNotEmpty ? rawId : null;
  }

  Future<String> _encryptJson(
    Map<String, Object?> payload,
    SecretKey key,
  ) async {
    final clear = utf8.encode(jsonEncode(payload));
    final box = await _cipher.encrypt(clear, secretKey: key);
    return jsonEncode({
      'schemaVersion': offlineJournalSchemaVersion,
      'keyVersion': 1,
      'nonce': base64Encode(box.nonce),
      'ciphertext': base64Encode(box.cipherText),
      'mac': base64Encode(box.mac.bytes),
    });
  }

  Future<Map<String, Object?>> _decryptJson(
    String encoded,
    SecretKey key,
  ) async {
    final wrapper = jsonDecode(encoded) as Map<String, Object?>;
    if (wrapper['schemaVersion'] != offlineJournalSchemaVersion) {
      throw const OfflineJournalException('schema_version_unsupported');
    }
    return _decryptWrapper(wrapper, key);
  }

  Future<Map<String, Object?>> _decryptWrapper(
    Map<String, Object?> wrapper,
    SecretKey key,
  ) async {
    final box = SecretBox(
      base64Decode(wrapper['ciphertext']! as String),
      nonce: base64Decode(wrapper['nonce']! as String),
      mac: Mac(base64Decode(wrapper['mac']! as String)),
    );
    final clear = await _cipher.decrypt(box, secretKey: key);
    return jsonDecode(utf8.decode(clear)) as Map<String, Object?>;
  }

  void _syncDeviceScopeFromSnapshot(OfflineJournalSnapshot snapshot) {
    if (snapshot.entries.isEmpty) return;
    final last = snapshot.entries.last.command;
    _lastDeviceId = last.deviceId;
    _lastMerchantId = last.merchantId;
    _lastLocationId = last.locationId;
  }

  void _clearMemoryState() {
    _lastSnapshot = null;
    _indexByCommandId.clear();
    _indexBySequence.clear();
    _checkoutIdentityToCommandId.clear();
    _activeCount = 0;
    _pendingCashCount = 0;
    _pendingCashMinorUnits = 0;
    _earliestRetentionDeadlineMs = null;
  }

  bool _hasAlignedIndex(OfflineJournalSnapshot snapshot) =>
      identical(_lastSnapshot, snapshot);

  int _findIndexByCommandId(OfflineJournalSnapshot current, String commandId) {
    if (_hasAlignedIndex(current)) {
      return _indexByCommandId[commandId] ?? -1;
    }
    return current.entries.indexWhere(
      (entry) => entry.command.commandId == commandId,
    );
  }

  JournalEntry? _findByCheckoutIdentity(
    OfflineJournalSnapshot current,
    String commandType,
    String deduplicationKey,
  ) {
    if (_hasAlignedIndex(current)) {
      final commandId =
          _checkoutIdentityToCommandId['$commandType\u0000$deduplicationKey'];
      if (commandId == null) return null;
      final index = _indexByCommandId[commandId];
      return index == null ? null : current.entries[index];
    }
    for (final entry in current.entries) {
      if (entry.command.commandType == commandType &&
          entry.command.payload['checkoutIdentity'] == deduplicationKey) {
        return entry;
      }
    }
    return null;
  }

  int _cashMinorUnits(JournalEntry entry) {
    final snapshot = entry.command.payload['snapshot'];
    if (snapshot is! Map<String, Object?>) return 0;
    return (snapshot['amountDueMinorUnits'] as num?)?.toInt() ?? 0;
  }

  void _publishPending(
    OfflineJournalSnapshot snapshot, {
    _JournalDelta? delta,
  }) {
    final previous = _lastSnapshot;
    if (previous != null &&
        delta != null &&
        delta.kind == _DeltaKind.metaOnly) {
      _lastSnapshot = snapshot;
      pendingCount.value = _activeCount;
      return;
    }
    if (previous != null &&
        delta != null &&
        delta.kind == _DeltaKind.upsert &&
        delta.singleAppend &&
        delta.upsertedEntries.length == 1 &&
        snapshot.entries.length == previous.entries.length + 1) {
      final entry = delta.upsertedEntries.single;
      final index = snapshot.entries.length - 1;
      _indexByCommandId[entry.command.commandId] = index;
      _indexBySequence[entry.command.deviceSequence] = index;
      final checkoutId = entry.command.payload['checkoutIdentity'];
      if (checkoutId is String) {
        _checkoutIdentityToCommandId['${entry.command.commandType}\u0000$checkoutId'] =
            entry.command.commandId;
      }
      if (_isActive(entry)) {
        _activeCount += 1;
        if (entry.command.commandType == 'pos.checkout.cash') {
          _pendingCashCount += 1;
          _pendingCashMinorUnits += _cashMinorUnits(entry);
        }
      }
      _lastSnapshot = snapshot;
      pendingCount.value = _activeCount;
      return;
    }
    if (previous != null &&
        delta != null &&
        delta.kind == _DeltaKind.upsert &&
        delta.replacedIndex != null &&
        delta.replacedOldEntry != null &&
        delta.upsertedEntries.length == 1 &&
        snapshot.entries.length == previous.entries.length) {
      final oldEntry = delta.replacedOldEntry!;
      final newEntry = delta.upsertedEntries.single;
      final wasActive = _isActive(oldEntry);
      final isActive = _isActive(newEntry);
      if (wasActive && !isActive) {
        _activeCount -= 1;
        if (oldEntry.command.commandType == 'pos.checkout.cash') {
          _pendingCashCount -= 1;
          _pendingCashMinorUnits -= _cashMinorUnits(oldEntry);
        }
      } else if (!wasActive && isActive) {
        _activeCount += 1;
        if (newEntry.command.commandType == 'pos.checkout.cash') {
          _pendingCashCount += 1;
          _pendingCashMinorUnits += _cashMinorUnits(newEntry);
        }
      }
      final newDeadline = newEntry.retentionDeadline
          ?.toUtc()
          .millisecondsSinceEpoch;
      if (!isActive &&
          newDeadline != null &&
          !_isUnmappedCashProof(newEntry, snapshot.mappings)) {
        if (_earliestRetentionDeadlineMs == null ||
            newDeadline < _earliestRetentionDeadlineMs!) {
          _earliestRetentionDeadlineMs = newDeadline;
        }
      } else if (oldEntry.command.provisionalId != null &&
          snapshot.mappings.length != previous.mappings.length) {
        // A newly added provisional mapping may unlock retention pruning for
        // an older settled cash checkout; mark for re-check on next compact/append.
        _earliestRetentionDeadlineMs = 0;
      }
      _lastSnapshot = snapshot;
      pendingCount.value = _activeCount;
      return;
    }
    _rebuildIndexes(snapshot);
    _lastSnapshot = snapshot;
    pendingCount.value = _activeCount;
  }

  void _rebuildIndexes(OfflineJournalSnapshot snapshot) {
    _indexByCommandId.clear();
    _indexBySequence.clear();
    _checkoutIdentityToCommandId.clear();
    _activeCount = 0;
    _pendingCashCount = 0;
    _pendingCashMinorUnits = 0;
    _earliestRetentionDeadlineMs = null;
    for (var i = 0; i < snapshot.entries.length; i++) {
      final entry = snapshot.entries[i];
      _indexByCommandId[entry.command.commandId] = i;
      _indexBySequence[entry.command.deviceSequence] = i;
      final checkoutId = entry.command.payload['checkoutIdentity'];
      if (checkoutId is String) {
        _checkoutIdentityToCommandId['${entry.command.commandType}\u0000$checkoutId'] =
            entry.command.commandId;
      }
      if (_isActive(entry)) {
        _activeCount += 1;
        if (entry.command.commandType == 'pos.checkout.cash') {
          _pendingCashCount += 1;
          _pendingCashMinorUnits += _cashMinorUnits(entry);
        }
      } else if (!_isUnmappedCashProof(entry, snapshot.mappings)) {
        final deadline = entry.retentionDeadline
            ?.toUtc()
            .millisecondsSinceEpoch;
        if (deadline != null &&
            (_earliestRetentionDeadlineMs == null ||
                deadline < _earliestRetentionDeadlineMs!)) {
          _earliestRetentionDeadlineMs = deadline;
        }
      }
    }
  }

  Future<SecretKey> _key({required bool create}) async {
    final existing = await _store.readKey();
    if (existing != null) {
      if (existing == _lastKeyString && _cachedSecretKey != null) {
        return _cachedSecretKey!;
      }
      final key = SecretKey(base64Decode(existing));
      _lastKeyString = existing;
      _cachedSecretKey = key;
      return key;
    }
    if (!create) {
      throw const OfflineJournalException('encryption_key_unavailable');
    }
    final bytes = List<int>.generate(32, (_) => Random.secure().nextInt(256));
    final encodedKey = base64Encode(bytes);
    await _store.writeKey(encodedKey);
    final key = SecretKey(bytes);
    _lastKeyString = encodedKey;
    _cachedSecretKey = key;
    return key;
  }

  void _ensureSupported() {
    if (_web) {
      throw const OfflineJournalException('secure_offline_unsupported_on_web');
    }
  }

  Object? _canonical(Object? value) {
    if (value is Map<String, Object?>) {
      final keys = value.keys.toList()..sort();
      return {for (final key in keys) key: _canonical(value[key])};
    }
    if (value is List<Object?>) return value.map(_canonical).toList();
    return value;
  }
}

final class _JournalMutationQueue {
  Future<void> tail = Future<void>.value();
}

enum _DeltaKind { none, upsert, metaOnly, prune, resetAll }

final class _JournalDelta {
  const _JournalDelta._({
    required this.kind,
    this.upsertedEntries = const [],
    this.deleteSequences = const [],
    this.pruneNow,
    this.singleAppend = false,
    this.replacedIndex,
    this.replacedOldEntry,
  });

  const _JournalDelta.none() : this._(kind: _DeltaKind.none);

  const _JournalDelta.metaOnly() : this._(kind: _DeltaKind.metaOnly);

  const _JournalDelta.resetAll() : this._(kind: _DeltaKind.resetAll);

  const _JournalDelta.prune({required DateTime now})
    : this._(kind: _DeltaKind.prune, pruneNow: now);

  const _JournalDelta.upsert({
    required List<JournalEntry> entries,
    List<int> deleteSequences = const [],
    bool singleAppend = false,
    int? replacedIndex,
    JournalEntry? replacedOldEntry,
  }) : this._(
         kind: _DeltaKind.upsert,
         upsertedEntries: entries,
         deleteSequences: deleteSequences,
         singleAppend: singleAppend,
         replacedIndex: replacedIndex,
         replacedOldEntry: replacedOldEntry,
       );

  final _DeltaKind kind;
  final List<JournalEntry> upsertedEntries;
  final List<int> deleteSequences;
  final DateTime? pruneNow;
  final bool singleAppend;
  final int? replacedIndex;
  final JournalEntry? replacedOldEntry;
}

final class _MutationResult<T> {
  const _MutationResult({
    required this.snapshot,
    required this.value,
    this.changed = true,
    this.delta = const _JournalDelta.none(),
  });
  final OfflineJournalSnapshot snapshot;
  final T value;
  final bool changed;
  final _JournalDelta delta;
}
