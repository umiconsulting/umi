import 'package:sqflite/sqflite.dart';

import '../../core/storage/local_database_location_stub.dart'
    if (dart.library.io) '../../core/storage/local_database_location_io.dart';

/// Persisted metadata row for the SQLite WAL offline journal.
///
/// The non-sensitive counters and device scope sit in indexed columns for fast
/// inspection; the full authenticated metadata payload (`mappings`,
/// `cachedPolicy`, `recoveryAudit`, sequence cross-check) lives inside
/// [metaEnc] encrypted with AES-GCM.
final class SqliteJournalMetaRow {
  const SqliteJournalMetaRow({
    required this.schemaVersion,
    required this.nextSequence,
    required this.lastAcknowledgedSequence,
    required this.metaEnc,
    this.deviceId,
    this.merchantId,
    this.locationId,
    this.lastServerSyncAtMs,
    this.legacyMigrated = false,
  });

  factory SqliteJournalMetaRow.fromMap(Map<String, Object?> row) =>
      SqliteJournalMetaRow(
        schemaVersion: (row['schema_version']! as num).toInt(),
        nextSequence: (row['next_sequence']! as num).toInt(),
        lastAcknowledgedSequence: (row['last_acknowledged_sequence']! as num)
            .toInt(),
        deviceId: row['device_id'] as String?,
        merchantId: row['merchant_id'] as String?,
        locationId: row['location_id'] as String?,
        lastServerSyncAtMs: (row['last_server_sync_at_ms'] as num?)?.toInt(),
        legacyMigrated: ((row['legacy_migrated'] as num?)?.toInt() ?? 0) != 0,
        metaEnc: row['meta_enc']! as String,
      );

  final int schemaVersion;
  final int nextSequence;
  final int lastAcknowledgedSequence;
  final String? deviceId;
  final String? merchantId;
  final String? locationId;
  final int? lastServerSyncAtMs;
  final bool legacyMigrated;
  final String metaEnc;

  Map<String, Object?> toMap() => {
    'id': 1,
    'schema_version': schemaVersion,
    'device_id': deviceId,
    'merchant_id': merchantId,
    'location_id': locationId,
    'next_sequence': nextSequence,
    'last_acknowledged_sequence': lastAcknowledgedSequence,
    'last_server_sync_at_ms': lastServerSyncAtMs,
    'legacy_migrated': legacyMigrated ? 1 : 0,
    'meta_enc': metaEnc,
  };
}

/// Persisted per-command row for the SQLite WAL offline journal.
///
/// Each row holds indexed operational columns plus its own AES-GCM encrypted
/// JSON payload ([payloadEnc]), allowing O(1) single-row writes without
/// re-encrypting journal history.
final class SqliteJournalEntryRow {
  const SqliteJournalEntryRow({
    required this.deviceSequence,
    required this.commandId,
    required this.status,
    required this.commandType,
    required this.createdAtMs,
    required this.payloadEnc,
    this.cartId,
    this.provisionalId,
    this.settledAtMs,
    this.retentionDeadlineMs,
  });

  factory SqliteJournalEntryRow.fromMap(Map<String, Object?> row) =>
      SqliteJournalEntryRow(
        deviceSequence: (row['device_sequence']! as num).toInt(),
        commandId: row['command_id']! as String,
        status: row['status']! as String,
        commandType: row['command_type']! as String,
        cartId: row['cart_id'] as String?,
        provisionalId: row['provisional_id'] as String?,
        createdAtMs: (row['created_at_ms']! as num).toInt(),
        settledAtMs: (row['settled_at_ms'] as num?)?.toInt(),
        retentionDeadlineMs: (row['retention_deadline_ms'] as num?)?.toInt(),
        payloadEnc: row['payload_enc']! as String,
      );

  final int deviceSequence;
  final String commandId;
  final String status;
  final String commandType;
  final String? cartId;
  final String? provisionalId;
  final int createdAtMs;
  final int? settledAtMs;
  final int? retentionDeadlineMs;
  final String payloadEnc;

  Map<String, Object?> toMap() => {
    'device_sequence': deviceSequence,
    'command_id': commandId,
    'status': status,
    'command_type': commandType,
    'cart_id': cartId,
    'provisional_id': provisionalId,
    'created_at_ms': createdAtMs,
    'settled_at_ms': settledAtMs,
    'retention_deadline_ms': retentionDeadlineMs,
    'payload_enc': payloadEnc,
  };
}

/// Lean SQLite WAL persistence backend for `EncryptedOfflineJournal`.
///
/// Configures `PRAGMA journal_mode=WAL`, `PRAGMA synchronous=FULL`, and
/// `PRAGMA busy_timeout=5000` so every append or state transition commits
/// only the touched row(s) and single-row metadata in one atomic transaction.
final class SqliteJournalStore {
  SqliteJournalStore({DatabaseFactory? factory, String? path})
    : _factoryOverride = factory,
      _pathOverride = path;

  factory SqliteJournalStore.openDefault() => SqliteJournalStore();

  static const _databaseFileName = 'umipos-offline-journal.sqlite';
  static const _databaseVersion = 1;
  static const _settledStatuses = "'accepted', 'duplicate', 'resolved', 'archived'";

  final DatabaseFactory? _factoryOverride;
  final String? _pathOverride;
  Future<Database>? _opening;
  Database? _database;
  int _writeGeneration = 0;

  /// Monotonically incremented after each committed write transaction so
  /// multiple journal handles sharing one store detect peer mutations.
  int get writeGeneration => _writeGeneration;

  Future<void> initialize() async {
    await _open();
  }

  Future<void> close() async {
    final opening = _opening;
    _opening = null;
    final database = _database ?? (opening != null ? await opening : null);
    _database = null;
    if (database != null && database.isOpen) {
      await database.close();
    }
  }

  Future<SqliteJournalMetaRow?> readMeta() async {
    final db = await _open();
    final rows = await db.query(
      'journal_meta',
      where: 'id = 1',
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return SqliteJournalMetaRow.fromMap(rows.single);
  }

  Future<List<SqliteJournalEntryRow>> readAllEntries() async {
    final db = await _open();
    final rows = await db.query(
      'journal_entries',
      orderBy: 'device_sequence ASC',
    );
    return rows.map(SqliteJournalEntryRow.fromMap).toList(growable: false);
  }

  /// Atomically writes the full journal state (used for one-time migration
  /// from legacy `offline.journal.v1`).
  Future<void> writeFullState({
    required SqliteJournalMetaRow meta,
    required List<SqliteJournalEntryRow> entries,
    bool replaceExisting = false,
  }) async {
    final db = await _open();
    await db.transaction((txn) async {
      if (replaceExisting) {
        await txn.delete('journal_entries');
      }
      final batch = txn.batch();
      for (final entry in entries) {
        batch.insert(
          'journal_entries',
          entry.toMap(),
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
      batch.insert(
        'journal_meta',
        meta.toMap(),
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      await batch.commit(noResult: true);
    });
    _writeGeneration++;
  }

  /// O(1) single-transaction write of only the touched entry row(s), optional
  /// expired sequences to remove, and the updated metadata row.
  Future<void> upsertEntriesAndMeta({
    required SqliteJournalMetaRow meta,
    required List<SqliteJournalEntryRow> entries,
    List<int> deleteSequences = const [],
  }) async {
    final db = await _open();
    await db.transaction((txn) async {
      if (deleteSequences.isNotEmpty) {
        await _deleteSequences(txn, deleteSequences);
      }
      for (final entry in entries) {
        await txn.insert(
          'journal_entries',
          entry.toMap(),
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
      await txn.insert(
        'journal_meta',
        meta.toMap(),
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    });
    _writeGeneration++;
  }

  /// Writes only `journal_meta` without touching any `journal_entries` row.
  Future<void> writeMeta(SqliteJournalMetaRow meta) async {
    final db = await _open();
    await db.transaction((txn) async {
      await txn.insert(
        'journal_meta',
        meta.toMap(),
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    });
    _writeGeneration++;
  }

  /// Clears all entries and resets metadata inside one transaction (used when
  /// discarding a foreign device replay scope).
  Future<void> deleteAllAndResetMeta(SqliteJournalMetaRow meta) async {
    final db = await _open();
    await db.transaction((txn) async {
      await txn.delete('journal_entries');
      await txn.insert(
        'journal_meta',
        meta.toMap(),
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    });
    _writeGeneration++;
  }

  /// Incrementally deletes expired settled rows via indexed SQL queries while
  /// preserving pending entries and unmapped cash sale proofs.
  Future<int> pruneExpired({
    required int nowMs,
    required int settledCutoffMs,
    required Set<String> mappedProvisionalIds,
    required SqliteJournalMetaRow meta,
  }) async {
    final db = await _open();
    var deleted = 0;
    await db.transaction((txn) async {
      deleted += await txn.rawDelete(
        'DELETE FROM journal_entries '
        'WHERE status IN ($_settledStatuses) '
        "AND command_type != 'pos.checkout.cash' "
        'AND ((retention_deadline_ms IS NOT NULL AND retention_deadline_ms <= ?) '
        'OR (retention_deadline_ms IS NULL AND settled_at_ms IS NOT NULL AND settled_at_ms < ?))',
        [nowMs, settledCutoffMs],
      );
      final cashCandidates = await txn.rawQuery(
        'SELECT device_sequence, status, provisional_id '
        'FROM journal_entries '
        'WHERE status IN ($_settledStatuses) '
        "AND command_type = 'pos.checkout.cash' "
        'AND ((retention_deadline_ms IS NOT NULL AND retention_deadline_ms <= ?) '
        'OR (retention_deadline_ms IS NULL AND settled_at_ms IS NOT NULL AND settled_at_ms < ?))',
        [nowMs, settledCutoffMs],
      );
      if (cashCandidates.isNotEmpty) {
        final toDelete = <int>[];
        for (final row in cashCandidates) {
          final status = row['status'] as String?;
          final provisionalId = row['provisional_id'] as String?;
          final unmappedCashProof =
              (status == 'accepted' || status == 'duplicate') &&
              (provisionalId == null ||
                  !mappedProvisionalIds.contains(provisionalId));
          if (!unmappedCashProof) {
            toDelete.add((row['device_sequence']! as num).toInt());
          }
        }
        if (toDelete.isNotEmpty) {
          deleted += await _deleteSequences(txn, toDelete);
        }
      }
      await txn.insert(
        'journal_meta',
        meta.toMap(),
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    });
    _writeGeneration++;
    return deleted;
  }

  /// Exposes active SQLite durability PRAGMAs for verification and diagnostics.
  Future<Map<String, Object?>> inspectPragmas() async {
    final db = await _open();
    final mode = await db.rawQuery('PRAGMA journal_mode');
    final sync = await db.rawQuery('PRAGMA synchronous');
    final timeout = await db.rawQuery('PRAGMA busy_timeout');
    return {
      'journal_mode': mode.isEmpty ? null : mode.first.values.first,
      'synchronous': sync.isEmpty ? null : sync.first.values.first,
      'busy_timeout': timeout.isEmpty ? null : timeout.first.values.first,
    };
  }

  Future<int> _deleteSequences(Transaction txn, List<int> sequences) async {
    var deleted = 0;
    const chunkSize = 400;
    for (var start = 0; start < sequences.length; start += chunkSize) {
      final end = start + chunkSize < sequences.length
          ? start + chunkSize
          : sequences.length;
      final chunk = sequences.sublist(start, end);
      final placeholders = List.filled(chunk.length, '?').join(', ');
      deleted += await txn.rawDelete(
        'DELETE FROM journal_entries WHERE device_sequence IN ($placeholders)',
        chunk,
      );
    }
    return deleted;
  }

  Future<Database> _open() {
    final current = _database;
    if (current != null && current.isOpen) return Future.value(current);
    return _opening ??= _openOnce();
  }

  Future<Database> _openOnce() async {
    final DatabaseFactory factory;
    final String path;
    if (_factoryOverride != null && _pathOverride != null) {
      factory = _factoryOverride;
      path = _pathOverride;
    } else {
      final resolved = await resolveLocalDatabaseLocation();
      if (resolved == null) {
        throw UnsupportedError(
          'SQLite offline journal is unavailable on this platform',
        );
      }
      factory = _factoryOverride ?? resolved.factory;
      path = _pathOverride ?? '${resolved.directory}/$_databaseFileName';
    }
    try {
      final database = await factory.openDatabase(
        path,
        options: OpenDatabaseOptions(
          version: _databaseVersion,
          onConfigure: (db) async {
            await db.rawQuery('PRAGMA busy_timeout = 5000');
            await db.rawQuery('PRAGMA journal_mode = WAL');
            await db.execute('PRAGMA synchronous = FULL');
            await db.execute('PRAGMA foreign_keys = ON');
          },
          onCreate: (db, version) async {
            await _createSchema(db);
          },
          onUpgrade: (db, oldVersion, newVersion) async {
            if (newVersion > _databaseVersion) {
              throw StateError(
                'Unsupported offline journal SQLite migration: '
                '$oldVersion to $newVersion',
              );
            }
          },
        ),
      );
      _database = database;
      return database;
    } catch (_) {
      _opening = null;
      rethrow;
    }
  }

  Future<void> _createSchema(Database db) async {
    await db.execute('''
      CREATE TABLE journal_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL,
        device_id TEXT,
        merchant_id TEXT,
        location_id TEXT,
        next_sequence INTEGER NOT NULL,
        last_acknowledged_sequence INTEGER NOT NULL,
        last_server_sync_at_ms INTEGER,
        legacy_migrated INTEGER NOT NULL DEFAULT 0,
        meta_enc TEXT NOT NULL
      )
    ''');
    await db.execute('''
      CREATE TABLE journal_entries (
        device_sequence INTEGER PRIMARY KEY,
        command_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        command_type TEXT NOT NULL,
        cart_id TEXT,
        provisional_id TEXT,
        created_at_ms INTEGER NOT NULL,
        settled_at_ms INTEGER,
        retention_deadline_ms INTEGER,
        payload_enc TEXT NOT NULL
      )
    ''');
    await db.execute('''
      CREATE INDEX idx_journal_entries_status_settled
        ON journal_entries (status, settled_at_ms)
    ''');
    await db.execute('''
      CREATE INDEX idx_journal_entries_status_retention
        ON journal_entries (status, retention_deadline_ms)
    ''');
    await db.execute('''
      CREATE INDEX idx_journal_entries_cart_id
        ON journal_entries (cart_id)
    ''');
    await db.execute('''
      CREATE INDEX idx_journal_entries_provisional_id
        ON journal_entries (provisional_id)
    ''');
  }
}
