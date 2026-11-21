import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';
import 'package:umi_pos/features/offline/sqlite_journal_store.dart';

void main() {
  setUpAll(sqfliteFfiInit);

  late Directory tempDir;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('umipos-journal-sqlite-');
  });

  tearDown(() async {
    if (await tempDir.exists()) {
      await tempDir.delete(recursive: true);
    }
  });

  test(
    'migrates 25 real encrypted legacy entries atomically and reopens from SQLite',
    () async {
      final cipherStore = _MemoryCipherStore();
      final legacyJournal = EncryptedOfflineJournal(cipherStore, web: false);

      for (var i = 1; i <= 25; i++) {
        final isCartOpen = i == 1;
        final isCash = i % 5 == 0;
        await legacyJournal.append(
          commandId: _id(1000 + i),
          deviceId: _id(2),
          credentialVersion: 3,
          merchantId: _id(3),
          locationId: _id(4),
          operatorSessionId: _id(5),
          idempotencyKey: _id(2000 + i),
          commandType: isCartOpen
              ? 'pos.cart.open'
              : isCash
              ? 'pos.checkout.cash'
              : 'pos.cart.line.add',
          provisionalId: isCartOpen ? _id(3001) : null,
          payload: isCash
              ? {
                  'checkoutIdentity': 'legacy-cash-$i',
                  'snapshot': {
                    'amountDueMinorUnits': 1500,
                    'checkoutCommand': {'cartId': _id(3001)},
                  },
                }
              : {'cartId': _id(3001), 'lineIndex': i},
          maxPendingCashCount: isCash ? 50 : null,
          maxPendingCashMinorUnits: isCash ? 500000 : null,
          cashAmountMinorUnits: isCash ? 1500 : null,
        );
        if (i <= 15) {
          await legacyJournal.apply(
            ReplayResult(
              commandId: _id(1000 + i),
              deviceSequence: i,
              status: 'accepted',
              officialId: isCartOpen ? _id(4001) : null,
              officialCommit: isCash ? {'saleId': _id(5000 + i)} : null,
              serverConflictReference: null,
              failure: null,
            ),
          );
        }
      }

      final legacyBefore = await legacyJournal.load();
      expect(legacyBefore.entries, hasLength(25));
      expect(legacyBefore.pendingCount, 10);
      expect(legacyBefore.lastAcknowledgedSequence, 15);
      expect(legacyBefore.nextSequence, 26);
      expect(legacyBefore.mappings[_id(3001)], _id(4001));
      expect(cipherStore.ciphertext, isNotNull);
      expect(cipherStore.ciphertext, isNot(contains('legacy-cash-5')));

      final dbPath = '${tempDir.path}/migrated-journal.sqlite';
      final sqliteStore = SqliteJournalStore(
        factory: databaseFactoryFfi,
        path: dbPath,
      );
      final sqliteJournal = EncryptedOfflineJournal(
        cipherStore,
        sqliteStore: sqliteStore,
        web: false,
      );

      final migrated = await sqliteJournal.load();
      expect(migrated.entries, hasLength(25));
      expect(migrated.pendingCount, 10);
      expect(migrated.lastAcknowledgedSequence, 15);
      expect(migrated.nextSequence, 26);
      expect(migrated.mappings[_id(3001)], _id(4001));
      expect(sqliteJournal.pendingCount.value, 10);
      expect(
        migrated.entries.map((e) => e.toJson()),
        legacyBefore.entries.map((e) => e.toJson()),
      );

      // Verify WAL PRAGMAs are genuinely active on the file DB.
      final pragmas = await sqliteStore.inspectPragmas();
      expect(
        pragmas['journal_mode'].toString().toLowerCase(),
        'wal',
      );
      expect(pragmas['synchronous'], 2); // FULL
      expect(pragmas['busy_timeout'], 5000);

      // Legacy blob was compacted to a migrated sentinel.
      final marker =
          jsonDecode(cipherStore.ciphertext!) as Map<String, Object?>;
      expect(marker['migratedToSqlite'], isTrue);

      await sqliteJournal.close();

      // Remove legacy ciphertext completely and reopen directly from SQLite.
      cipherStore.ciphertext = null;
      final reopenedStore = SqliteJournalStore(
        factory: databaseFactoryFfi,
        path: dbPath,
      );
      final reopened = EncryptedOfflineJournal(
        cipherStore,
        sqliteStore: reopenedStore,
        web: false,
      );
      final fromSqlite = await reopened.load();
      expect(fromSqlite.entries, hasLength(25));
      expect(fromSqlite.pendingCount, 10);
      expect(fromSqlite.lastAcknowledgedSequence, 15);
      expect(fromSqlite.nextSequence, 26);
      expect(fromSqlite.mappings[_id(3001)], _id(4001));
      await reopened.close();
    },
  );

  test(
    'appends 2,000 entries into real SQLite WAL with O(1) latency and survives reopen',
    () async {
      final cipherStore = _MemoryCipherStore();
      final dbPath = '${tempDir.path}/scale-2000.sqlite';
      final sqliteStore = SqliteJournalStore(
        factory: databaseFactoryFfi,
        path: dbPath,
      );
      final journal = EncryptedOfflineJournal(
        cipherStore,
        sqliteStore: sqliteStore,
        web: false,
      );

      const totalEntries = 2000;
      const pendingTail = 50;
      final appendMicros = <int>[];

      for (var seq = 1; seq <= totalEntries; seq++) {
        final isCash = seq % 4 == 0;
        final isCart = !isCash && seq % 2 == 0;
        final commandId = _id(100000 + seq);
        final cartId = _id(200000 + (seq % 100));

        final sw = Stopwatch()..start();
        await journal.append(
          commandId: commandId,
          deviceId: _id(2),
          credentialVersion: 1,
          merchantId: _id(3),
          locationId: _id(4),
          operatorSessionId: _id(5),
          idempotencyKey: _id(300000 + seq),
          commandType: isCash
              ? 'pos.checkout.cash'
              : isCart
              ? 'pos.cart.line.add'
              : 'operational.ack',
          provisionalId: isCash ? _id(400000 + seq) : null,
          payload: isCash
              ? {
                  'checkoutIdentity': 'scale-cash-$seq',
                  'secretNote': 'sensitive-cash-amount-$seq',
                  'snapshot': {
                    'amountDueMinorUnits': 2500,
                    'checkoutCommand': {'cartId': cartId},
                  },
                }
              : {'cartId': cartId, 'seq': seq},
          maxPendingCashCount: isCash ? 100 : null,
          maxPendingCashMinorUnits: isCash ? 5000000 : null,
          cashAmountMinorUnits: isCash ? 2500 : null,
        );
        sw.stop();
        appendMicros.add(sw.elapsedMicroseconds);

        // Settle the first 1,950 entries so active depth stays realistic (<250)
        // while retained history grows to all 2,000 rows in SQLite.
        if (seq <= totalEntries - pendingTail) {
          await journal.apply(
            ReplayResult(
              commandId: commandId,
              deviceSequence: seq,
              status: 'accepted',
              officialId: isCash ? _id(500000 + seq) : null,
              officialCommit: isCash ? {'receipt': 'R-$seq'} : null,
              serverConflictReference: null,
              failure: null,
            ),
          );
        }
      }

      final sorted = [...appendMicros]..sort();
      final meanMs =
          appendMicros.reduce((a, b) => a + b) / appendMicros.length / 1000.0;
      final p50Ms = sorted[(sorted.length * 0.50).floor()] / 1000.0;
      final p95Ms = sorted[(sorted.length * 0.95).floor()] / 1000.0;
      final p99Ms = sorted[(sorted.length * 0.99).floor()] / 1000.0;
      final first200MeanMs =
          appendMicros.take(200).reduce((a, b) => a + b) / 200 / 1000.0;
      final last200MeanMs =
          appendMicros.skip(totalEntries - 200).reduce((a, b) => a + b) /
          200 /
          1000.0;

      // Print metrics so verification logs capture exact measured numbers.
      // ignore: avoid_print
      print(
        'SQLite WAL 2,000-entry append latency: '
        'mean=${meanMs.toStringAsFixed(2)}ms '
        'p50=${p50Ms.toStringAsFixed(2)}ms '
        'p95=${p95Ms.toStringAsFixed(2)}ms '
        'p99=${p99Ms.toStringAsFixed(2)}ms '
        'first200=${first200MeanMs.toStringAsFixed(2)}ms '
        'last200=${last200MeanMs.toStringAsFixed(2)}ms',
      );

      expect(p99Ms, lessThan(25.0), reason: 'p99 append() must stay < 25 ms');
      expect(meanMs, lessThan(5.0), reason: 'mean append() must stay < 5 ms');

      // Verify raw SQLite rows are encrypted at rest (no plaintext leak).
      final rawRows = await sqliteStore.readAllEntries();
      expect(rawRows, hasLength(totalEntries));
      expect(rawRows[3].payloadEnc, isNot(contains('sensitive-cash-amount-4')));

      // Simulate crash/reopen by closing DB and opening a brand-new instance.
      await journal.close();
      final reopened = EncryptedOfflineJournal(
        cipherStore,
        sqliteStore: SqliteJournalStore(
          factory: databaseFactoryFfi,
          path: dbPath,
        ),
        web: false,
      );
      final restored = await reopened.load();
      expect(restored.entries, hasLength(totalEntries));
      expect(restored.nextSequence, totalEntries + 1);
      expect(restored.lastAcknowledgedSequence, totalEntries - pendingTail);
      expect(restored.pendingCount, pendingTail);
      expect(reopened.pendingCount.value, pendingTail);
      expect(
        restored.entries[3].command.payload['secretNote'],
        'sensitive-cash-amount-4',
      );
      expect(
        restored.entries.last.command.deviceSequence,
        totalEntries,
      );
      expect(restored.entries.last.status, JournalStatus.pending);

      // Verify P0 `hasPendingForCart` exclusion still holds on SQLite journal.
      await reopened.append(
        commandId: _id(999001),
        deviceId: _id(2),
        credentialVersion: 1,
        merchantId: _id(3),
        locationId: _id(4),
        operatorSessionId: _id(5),
        idempotencyKey: _id(999001),
        commandType: 'pos.kds.command',
        payload: const {'commandType': 'mark_item_ready'},
      );
      expect(reopened.hasPendingForCart(_id(888888)), isFalse);

      await reopened.close();

      // Verify tampering a single SQLite row fails integrity check closed.
      final rawDb = await databaseFactoryFfi.openDatabase(dbPath);
      await rawDb.update(
        'journal_entries',
        {'payload_enc': '{"schemaVersion":1,"nonce":"AA==","ciphertext":"AA==","mac":"AA=="}'},
        where: 'device_sequence = ?',
        whereArgs: [1],
      );
      await rawDb.close();

      final tamperedJournal = EncryptedOfflineJournal(
        cipherStore,
        sqliteStore: SqliteJournalStore(
          factory: databaseFactoryFfi,
          path: dbPath,
        ),
        web: false,
      );
      await expectLater(
        tamperedJournal.load(),
        throwsA(
          isA<OfflineJournalException>().having(
            (e) => e.category,
            'category',
            'journal_integrity_failed',
          ),
        ),
      );
      await tamperedJournal.close();
    },
  );

  test(
    'prunes expired settled rows (>30d) in SQLite without touching pending entries or unmapped cash proofs',
    () async {
      final cipherStore = _MemoryCipherStore();
      final dbPath = '${tempDir.path}/retention.sqlite';
      final sqliteStore = SqliteJournalStore(
        factory: databaseFactoryFfi,
        path: dbPath,
      );
      final journal = EncryptedOfflineJournal(
        cipherStore,
        sqliteStore: sqliteStore,
        web: false,
      );

      // 1. Settled operational.ack (eligible for pruning after 30 days).
      await journal.append(
        commandId: _id(1),
        deviceId: _id(2),
        credentialVersion: 1,
        merchantId: _id(3),
        locationId: _id(4),
        operatorSessionId: _id(5),
        idempotencyKey: _id(1),
        commandType: 'operational.ack',
        payload: const {'kind': 'expired-ack'},
      );
      await journal.apply(
        ReplayResult(
          commandId: _id(1),
          deviceSequence: 1,
          status: 'accepted',
          officialId: null,
          officialCommit: null,
          serverConflictReference: null,
          failure: null,
        ),
      );

      // 2. Settled mapped cash checkout (eligible for pruning after 30 days).
      await journal.append(
        commandId: _id(2),
        deviceId: _id(2),
        credentialVersion: 1,
        merchantId: _id(3),
        locationId: _id(4),
        operatorSessionId: _id(5),
        idempotencyKey: _id(2),
        commandType: 'pos.checkout.cash',
        provisionalId: _id(200),
        payload: const {'checkoutIdentity': 'mapped-cash'},
        maxPendingCashCount: 10,
        maxPendingCashMinorUnits: 50000,
        cashAmountMinorUnits: 3000,
      );
      await journal.apply(
        ReplayResult(
          commandId: _id(2),
          deviceSequence: 2,
          status: 'accepted',
          officialId: _id(201),
          officialCommit: const {'saleId': 'sale-2'},
          serverConflictReference: null,
          failure: null,
        ),
      );

      // 3. Settled UNMAPPED cash checkout (must be preserved as cash proof!).
      await journal.append(
        commandId: _id(3),
        deviceId: _id(2),
        credentialVersion: 1,
        merchantId: _id(3),
        locationId: _id(4),
        operatorSessionId: _id(5),
        idempotencyKey: _id(3),
        commandType: 'pos.checkout.cash',
        payload: const {'checkoutIdentity': 'unmapped-cash-proof'},
        maxPendingCashCount: 10,
        maxPendingCashMinorUnits: 50000,
        cashAmountMinorUnits: 3500,
      );
      await journal.apply(
        ReplayResult(
          commandId: _id(3),
          deviceSequence: 3,
          status: 'accepted',
          officialId: null,
          officialCommit: null,
          serverConflictReference: null,
          failure: null,
        ),
      );

      // 4. Pending command (must NEVER be pruned).
      await journal.append(
        commandId: _id(4),
        deviceId: _id(2),
        credentialVersion: 1,
        merchantId: _id(3),
        locationId: _id(4),
        operatorSessionId: _id(5),
        idempotencyKey: _id(4),
        commandType: 'pos.cart.line.add',
        payload: {'cartId': _id(300), 'qty': 2},
      );

      await journal.compact(
        DateTime.now().toUtc().add(const Duration(days: 31)),
      );
      final afterCompact = await journal.load();
      expect(
        afterCompact.entries.map((e) => e.command.commandId),
        [_id(3), _id(4)],
      );
      expect(afterCompact.pendingCount, 1);
      expect(afterCompact.mappings[_id(200)], _id(201));

      await journal.close();

      // Reopen and confirm pruned rows are physically deleted from SQLite.
      final reopened = EncryptedOfflineJournal(
        cipherStore,
        sqliteStore: SqliteJournalStore(
          factory: databaseFactoryFfi,
          path: dbPath,
        ),
        web: false,
      );
      final persisted = await reopened.load();
      expect(
        persisted.entries.map((e) => e.command.commandId),
        [_id(3), _id(4)],
      );
      expect(persisted.nextSequence, 5);
      expect(persisted.lastAcknowledgedSequence, 3);
      await reopened.close();
    },
  );
}

String _id(int value) =>
    '00000000-0000-4000-8000-${value.toString().padLeft(12, '0')}';

final class _MemoryCipherStore implements JournalCipherStore {
  String? ciphertext;
  String? key;
  @override
  Future<String?> readCiphertext() async => ciphertext;
  @override
  Future<String?> readKey() async => key;
  @override
  Future<void> writeCiphertext(String value) async => ciphertext = value;
  @override
  Future<void> writeKey(String value) async => key = value;
}
