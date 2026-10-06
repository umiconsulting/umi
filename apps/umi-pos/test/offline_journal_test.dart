import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/features/offline/connectivity_controller.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';
import 'package:umi_pos/features/offline/recovery_actions.dart';
import 'package:umi_pos/features/offline/replay_engine.dart';

void main() {
  test(
    'encrypts payload, allocates ordered sequences, and detects tampering',
    () async {
      final store = _MemoryCipherStore();
      final journal = EncryptedOfflineJournal(store, web: false);
      final one = await journal.append(
        commandId: _id(1),
        deviceId: _id(2),
        credentialVersion: 1,
        merchantId: _id(3),
        locationId: _id(4),
        operatorSessionId: _id(5),
        idempotencyKey: _id(6),
        payload: {'private': 'financial-value'},
      );
      final two = await journal.append(
        commandId: _id(7),
        deviceId: _id(2),
        credentialVersion: 1,
        merchantId: _id(3),
        locationId: _id(4),
        operatorSessionId: _id(5),
        idempotencyKey: _id(8),
        payload: {'ok': true},
      );
      expect(one.deviceSequence, 1);
      expect(two.deviceSequence, 2);
      expect(store.ciphertext, isNot(contains('financial-value')));
      store.ciphertext = '${store.ciphertext}x';
      await expectLater(
        journal.load(),
        throwsA(isA<OfflineJournalException>()),
      );
    },
  );

  test('duplicate ids and non-allowlisted commands fail closed', () async {
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    Future<void> add([String type = 'operational.ack']) => journal.append(
      commandId: _id(1),
      deviceId: _id(2),
      credentialVersion: 1,
      merchantId: _id(3),
      locationId: _id(4),
      operatorSessionId: _id(5),
      idempotencyKey: _id(6),
      payload: const {},
      commandType: type,
    );
    await add();
    await add();
    expect((await journal.load()).entries, hasLength(1));
    await expectLater(
      add('device.rotate'),
      throwsA(isA<OfflineJournalException>()),
    );
  });

  test('replay remains ordered and stops on a blocking conflict', () async {
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    for (var i = 1; i <= 3; i++) {
      await journal.append(
        commandId: _id(i),
        deviceId: _id(10),
        credentialVersion: 1,
        merchantId: _id(11),
        locationId: _id(12),
        operatorSessionId: _id(13),
        idempotencyKey: _id(20 + i),
        payload: {'index': i},
      );
    }
    final gateway = _Gateway();
    final count = await OrderedReplayEngine(journal, gateway).replay(
      scope: ReplayScope(
        merchantId: _id(11),
        locationId: _id(12),
        operatorSessionId: _id(13),
        credentialVersion: 1,
      ),
      replaySessionId: _id(30),
      batchSize: 2,
    );
    expect(count, 1);
    expect(gateway.sequences, [1, 2]);
    expect((await journal.load()).entries.last.status, JournalStatus.pending);
  });

  test(
    'connectivity uses hysteresis and revoked authority blocks immediately',
    () {
      final controller = ConnectivityController();
      controller.apiReachable(authorityValid: true);
      expect(controller.state, PosConnectivity.unknown);
      controller.apiReachable(authorityValid: true);
      expect(controller.state, PosConnectivity.online);
      controller.apiFailure();
      expect(controller.state, PosConnectivity.degraded);
      controller.apiFailure();
      controller.apiFailure();
      expect(controller.state, PosConnectivity.offline);
      controller.apiReachable(authorityValid: false);
      expect(controller.state, PosConnectivity.blocked);
    },
  );

  test('web sensitive journal fails closed', () async {
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: true);
    await expectLater(journal.load(), throwsA(isA<OfflineJournalException>()));
  });

  test(
    'all concurrent journal mutations serialize without losing state',
    () async {
      final store = _MemoryCipherStore();
      final journals = [
        EncryptedOfflineJournal(store, web: false),
        EncryptedOfflineJournal(store, web: false),
      ];
      await Future.wait([
        for (var i = 1; i <= 20; i++)
          journals[i % journals.length].append(
            commandId: _id(i),
            deviceId: _id(100),
            credentialVersion: 1,
            merchantId: _id(101),
            locationId: _id(102),
            operatorSessionId: _id(103),
            idempotencyKey: _id(200 + i),
            payload: {'index': i},
          ),
      ]);
      final snapshot = await journals.first.load();
      expect(snapshot.entries, hasLength(20));
      expect(
        snapshot.entries.map((entry) => entry.command.deviceSequence),
        orderedEquals(List<int>.generate(20, (index) => index + 1)),
      );
    },
  );

  test(
    'failed durable write preserves the previous encrypted snapshot',
    () async {
      final store = _MemoryCipherStore();
      final journal = EncryptedOfflineJournal(store, web: false);
      await journal.append(
        commandId: _id(1),
        deviceId: _id(2),
        credentialVersion: 1,
        merchantId: _id(3),
        locationId: _id(4),
        operatorSessionId: _id(5),
        idempotencyKey: _id(6),
        payload: const {'state': 'durable'},
      );
      store.failNextWrite = true;
      await expectLater(
        journal.markUnknown(_id(1)),
        throwsA(isA<StateError>()),
      );
      final restored = EncryptedOfflineJournal(store, web: false);
      expect(
        (await restored.load()).entries.single.status,
        JournalStatus.pending,
      );
    },
  );

  test('mixed mutation types share the same store writer', () async {
    final store = _MemoryCipherStore();
    final first = EncryptedOfflineJournal(store, web: false);
    final second = EncryptedOfflineJournal(store, web: false);
    for (var i = 1; i <= 2; i++) {
      await first.append(
        commandId: _id(i),
        deviceId: _id(20),
        credentialVersion: 1,
        merchantId: _id(21),
        locationId: _id(22),
        operatorSessionId: _id(23),
        idempotencyKey: _id(30 + i),
        payload: {'index': i},
      );
    }
    await Future.wait([
      first.apply(
        ReplayResult(
          commandId: _id(1),
          deviceSequence: 1,
          status: 'accepted',
          officialId: null,
          officialCommit: null,
          serverConflictReference: null,
          failure: null,
        ),
      ),
      second.markUnknown(_id(2)),
      first.compact(DateTime.now().toUtc()),
      second.recordRecoveryAction(RecoveryActionCatalog.all.first, 'completed'),
      second.append(
        commandId: _id(3),
        deviceId: _id(20),
        credentialVersion: 1,
        merchantId: _id(21),
        locationId: _id(22),
        operatorSessionId: _id(23),
        idempotencyKey: _id(33),
        payload: const {'index': 3},
      ),
    ]);
    final snapshot = await first.load();
    expect(snapshot.entries, hasLength(3));
    expect(snapshot.entries[0].status, JournalStatus.accepted);
    expect(snapshot.entries[1].status, JournalStatus.unknown);
    expect(snapshot.entries[2].command.deviceSequence, 3);
    expect(snapshot.recoveryAudit.single['outcome'], 'completed');
  });

  test(
    'restart after durable append recovers the same command identity',
    () async {
      final store = _MemoryCipherStore()..failAfterNextWrite = true;
      final journal = EncryptedOfflineJournal(store, web: false);
      await expectLater(
        journal.append(
          commandId: _id(1),
          deviceId: _id(2),
          credentialVersion: 1,
          merchantId: _id(3),
          locationId: _id(4),
          operatorSessionId: _id(5),
          idempotencyKey: _id(6),
          payload: const {'checkoutIdentity': 'persisted-checkout'},
          commandType: 'pos.checkout.cash',
          provisionalId: _id(7),
          deduplicationKey: 'persisted-checkout',
          maxPendingCashCount: 3,
          maxPendingCashMinorUnits: 30000,
          cashAmountMinorUnits: 5000,
        ),
        throwsA(isA<StateError>()),
      );
      final restarted = EncryptedOfflineJournal(store, web: false);
      final recovered = await restarted.append(
        commandId: _id(8),
        deviceId: _id(2),
        credentialVersion: 1,
        merchantId: _id(3),
        locationId: _id(4),
        operatorSessionId: _id(5),
        idempotencyKey: _id(9),
        payload: const {'checkoutIdentity': 'persisted-checkout'},
        commandType: 'pos.checkout.cash',
        provisionalId: _id(10),
        deduplicationKey: 'persisted-checkout',
        maxPendingCashCount: 3,
        maxPendingCashMinorUnits: 30000,
        cashAmountMinorUnits: 5000,
      );
      expect(recovered.commandId, _id(1));
      expect(recovered.provisionalId, _id(7));
      expect((await restarted.load()).entries, hasLength(1));
    },
  );

  test(
    'mapping and archive crashes converge without losing financial work',
    () async {
      final store = _MemoryCipherStore();
      final journal = EncryptedOfflineJournal(store, web: false);
      await journal.append(
        commandId: _id(1),
        deviceId: _id(2),
        credentialVersion: 1,
        merchantId: _id(3),
        locationId: _id(4),
        operatorSessionId: _id(5),
        idempotencyKey: _id(6),
        payload: const {'checkoutIdentity': 'mapping-checkout'},
        commandType: 'pos.checkout.cash',
        provisionalId: _id(7),
        maxPendingCashCount: 3,
        maxPendingCashMinorUnits: 30000,
        cashAmountMinorUnits: 5000,
      );
      final accepted = ReplayResult(
        commandId: _id(1),
        deviceSequence: 1,
        status: 'accepted',
        officialId: _id(8),
        officialCommit: const {'safe': true},
        serverConflictReference: null,
        failure: null,
      );
      store.failNextWrite = true;
      await expectLater(journal.apply(accepted), throwsA(isA<StateError>()));
      expect(
        (await journal.load()).entries.single.status,
        JournalStatus.pending,
      );
      await journal.apply(accepted);
      expect((await journal.load()).mappings[_id(7)], _id(8));

      store.failNextWrite = true;
      await expectLater(
        journal.compact(DateTime.now().toUtc().add(const Duration(days: 31))),
        throwsA(isA<StateError>()),
      );
      expect((await journal.load()).entries, hasLength(1));
      await journal.compact(
        DateTime.now().toUtc().add(const Duration(days: 31)),
      );
      expect((await journal.load()).entries, isEmpty);
      expect((await journal.load()).mappings[_id(7)], _id(8));
    },
  );
}

String _id(int value) =>
    '00000000-0000-4000-8000-${value.toString().padLeft(12, '0')}';

final class _MemoryCipherStore implements JournalCipherStore {
  String? ciphertext;
  String? key;
  bool failNextWrite = false;
  bool failAfterNextWrite = false;
  @override
  Future<String?> readCiphertext() async => ciphertext;
  @override
  Future<String?> readKey() async => key;
  @override
  Future<void> writeCiphertext(String value) async {
    if (failNextWrite) {
      failNextWrite = false;
      throw StateError('simulated crash before durable replacement');
    }
    ciphertext = value;
    if (failAfterNextWrite) {
      failAfterNextWrite = false;
      throw StateError('simulated crash after durable replacement');
    }
  }

  @override
  Future<void> writeKey(String value) async => key = value;
}

final class _Gateway implements ReplayGateway {
  final sequences = <int>[];
  @override
  Future<ReplayResult?> resultFor(ReplayScope scope, String commandId) async =>
      null;
  @override
  Future<ReplayBatchResult> submit(ReplayScope scope, ReplayBatch batch) async {
    final results = <ReplayResult>[];
    for (final encoded in batch.commands) {
      final command = OfflineCommand.fromJson(encoded);
      sequences.add(command.deviceSequence);
      final blocked = command.deviceSequence == 2;
      results.add(
        ReplayResult(
          commandId: command.commandId,
          deviceSequence: command.deviceSequence,
          status: blocked ? 'conflict' : 'accepted',
          officialId: null,
          officialCommit: null,
          serverConflictReference: blocked ? command.commandId : null,
          failure: blocked
              ? ReplayFailure(
                  classification: 'sequence_gap',
                  retryable: false,
                  blocksFollowing: true,
                  operatorActionRequired: true,
                  managerActionRequired: false,
                  guidanceCode: 'sequence_gap',
                  correlationId: command.commandId,
                ).toJson()
              : null,
        ),
      );
      if (blocked) break;
    }
    return ReplayBatchResult(
      replaySessionId: batch.replaySessionId,
      results: results.map((result) => result.toJson()).toList(),
      cursor: ReplayCursor(
        deviceId: OfflineCommand.fromJson(batch.commands.first).deviceId,
        credentialVersion: OfflineCommand.fromJson(
          batch.commands.first,
        ).deviceCredentialVersion,
        lastAcceptedSequence: 1,
        reconciliationRequired: true,
        updatedAt: DateTime.now().toUtc().toIso8601String(),
      ).toJson(),
      stopped: results.last.failure?['blocksFollowing'] == true,
    );
  }

  @override
  Future<void> acknowledge(ReplayScope scope, String reconciliationId) async {}
  @override
  Future<BeginReplayResponse> begin(ReplayScope scope) =>
      throw UnimplementedError();
  @override
  Future<ConflictSummary> conflicts(ReplayScope scope) =>
      throw UnimplementedError();
  @override
  Future<ReplayCursor> cursor(ReplayScope scope) => throw UnimplementedError();
  @override
  Future<SafeReplayDiagnostic> diagnostics(ReplayScope scope) =>
      throw UnimplementedError();
  @override
  Future<OfflinePolicy> policy(ReplayScope scope) => throw UnimplementedError();
  @override
  Future<ReconciliationSummary> reconcile(
    ReplayScope scope,
    ReconcileRequest request,
  ) => throw UnimplementedError();
}
