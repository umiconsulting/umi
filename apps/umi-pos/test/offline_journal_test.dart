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

  test('an order command enters the durable journal', () async {
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    final command = await journal.append(
      commandId: _id(51),
      deviceId: _id(52),
      credentialVersion: 1,
      merchantId: _id(53),
      locationId: _id(54),
      operatorSessionId: _id(55),
      idempotencyKey: _id(56),
      commandType: 'pos.cart.line.add',
      payload: {'cartId': _id(57), 'productId': _id(58), 'quantity': 1},
    );
    expect(command.commandType, 'pos.cart.line.add');
    expect((await journal.load()).pendingCount, 1);
  });

  test('a re-enrolled device starts a clean replay stream', () async {
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    for (var offset = 0; offset < 2; offset++) {
      await journal.append(
        commandId: _id(70 + offset),
        deviceId: _id(80),
        credentialVersion: 1,
        merchantId: _id(81),
        locationId: _id(82),
        operatorSessionId: _id(83),
        idempotencyKey: _id(84 + offset),
        commandType: 'pos.cart.line.add',
        payload: {'cartId': _id(86), 'productId': _id(87), 'quantity': 1},
      );
    }

    expect(
      await journal.discardForeignReplayScope(
        deviceId: _id(90),
        credentialVersion: 1,
      ),
      2,
    );
    final reset = await journal.load();
    expect(reset.entries, isEmpty);
    expect(reset.pendingCount, 0);
    expect(reset.nextSequence, 1);
    expect(reset.lastAcknowledgedSequence, 0);

    final current = await journal.append(
      commandId: _id(91),
      deviceId: _id(90),
      credentialVersion: 1,
      merchantId: _id(81),
      locationId: _id(82),
      operatorSessionId: _id(83),
      idempotencyKey: _id(92),
      commandType: 'pos.cart.open',
      payload: const {},
    );
    expect(current.deviceSequence, 1);
  });

  test('a foreign-device cash sale remains for explicit recovery', () async {
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    await journal.append(
      commandId: _id(93),
      deviceId: _id(80),
      credentialVersion: 1,
      merchantId: _id(81),
      locationId: _id(82),
      operatorSessionId: _id(83),
      idempotencyKey: _id(94),
      commandType: 'pos.checkout.cash',
      payload: const {},
      maxPendingCashCount: 3,
      maxPendingCashMinorUnits: 100000,
      cashAmountMinorUnits: 100,
    );

    await expectLater(
      journal.discardForeignReplayScope(
        deviceId: _id(90),
        credentialVersion: 1,
      ),
      throwsA(
        isA<OfflineJournalException>().having(
          (error) => error.category,
          'category',
          'foreign_device_cash_requires_recovery',
        ),
      ),
    );
    expect((await journal.load()).pendingCashCount, 1);
  });

  test('a safe command conflict can return to the ordered queue', () async {
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    await journal.append(
      commandId: _id(61),
      deviceId: _id(62),
      credentialVersion: 1,
      merchantId: _id(63),
      locationId: _id(64),
      operatorSessionId: _id(65),
      idempotencyKey: _id(66),
      commandType: 'pos.kds.command',
      payload: const {'commandType': 'mark_item_ready'},
    );
    await journal.apply(
      ReplayResult(
        commandId: _id(61),
        deviceSequence: 1,
        status: 'conflict',
        officialId: null,
        officialCommit: null,
        serverConflictReference: _id(67),
        failure: {
          'classification': 'server_validation_failed',
          'retryable': false,
          'blocksFollowing': true,
          'operatorActionRequired': true,
          'managerActionRequired': false,
          'guidanceCode': 'server_validation_failed',
          'correlationId': _id(68),
        },
      ),
    );
    expect(
      (await journal.load()).entries.single.status,
      JournalStatus.conflict,
    );

    await journal.retryConflict(_id(61));

    final retried = (await journal.load()).entries.single;
    expect(retried.status, JournalStatus.pending);
    expect(retried.command.deviceSequence, 1);
    expect(retried.failure, isNull);
  });

  test('resolving a blocking conflict requeues the gap behind it', () async {
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    await journal.append(
      commandId: _id(71),
      deviceId: _id(72),
      credentialVersion: 1,
      merchantId: _id(73),
      locationId: _id(74),
      operatorSessionId: _id(75),
      idempotencyKey: _id(76),
      commandType: 'pos.table.command',
      payload: const {'action': 'seat'},
    );
    await journal.append(
      commandId: _id(77),
      deviceId: _id(72),
      credentialVersion: 1,
      merchantId: _id(73),
      locationId: _id(74),
      operatorSessionId: _id(75),
      idempotencyKey: _id(78),
      commandType: 'pos.cart.fire',
      payload: const {'cartId': '00000000-0000-4000-8000-000000000079'},
    );
    for (final conflict in [
      (_id(71), 1, 'table_unavailable'),
      (_id(77), 2, 'sequence_gap'),
    ]) {
      await journal.apply(
        ReplayResult(
          commandId: conflict.$1,
          deviceSequence: conflict.$2,
          status: 'conflict',
          officialId: null,
          officialCommit: null,
          serverConflictReference: _id(80 + conflict.$2),
          failure: {
            'classification': conflict.$3,
            'retryable': false,
            'blocksFollowing': true,
            'operatorActionRequired': true,
            'managerActionRequired': false,
            'guidanceCode': conflict.$3,
            'correlationId': conflict.$1,
          },
        ),
      );
    }

    final retried = await journal.resolveConflictAndRetryFollowing(_id(71));
    final snapshot = await journal.load();

    expect(retried, 1);
    expect(snapshot.entries.first.status, JournalStatus.resolved);
    expect(snapshot.entries.last.status, JournalStatus.pending);
    expect(snapshot.entries.last.failure, isNull);
    expect(snapshot.lastAcknowledgedSequence, 1);
    expect(snapshot.pendingCount, 1);
  });

  test('resolving a stream conflict requeues blocked account steps', () async {
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    await journal.append(
      commandId: _id(81),
      deviceId: _id(82),
      credentialVersion: 1,
      merchantId: _id(83),
      locationId: _id(84),
      operatorSessionId: _id(85),
      idempotencyKey: _id(86),
      commandType: 'pos.command.group',
      payload: const {'groupId': 'group'},
    );
    await journal.append(
      commandId: _id(87),
      deviceId: _id(82),
      credentialVersion: 1,
      merchantId: _id(83),
      locationId: _id(84),
      operatorSessionId: _id(85),
      idempotencyKey: _id(88),
      commandType: 'pos.cart.fire',
      payload: {'cartId': _id(89)},
    );
    for (final conflict in [
      (_id(81), 1, 'table_unavailable', false),
      (_id(87), 2, 'stream_blocked', true),
    ]) {
      await journal.apply(
        ReplayResult(
          commandId: conflict.$1,
          deviceSequence: conflict.$2,
          status: 'conflict',
          officialId: null,
          officialCommit: null,
          serverConflictReference: _id(90 + conflict.$2),
          failure: {
            'classification': conflict.$3,
            'retryable': conflict.$4,
            'blocksFollowing': false,
            'operatorActionRequired': true,
            'managerActionRequired': false,
            'guidanceCode': conflict.$3,
            'correlationId': conflict.$1,
          },
        ),
      );
    }

    final retried = await journal.resolveConflictAndRetryFollowing(_id(81));
    final snapshot = await journal.load();

    expect(retried, 1);
    expect(snapshot.entries.first.status, JournalStatus.resolved);
    expect(snapshot.entries.last.status, JournalStatus.pending);
    expect(snapshot.entries.last.failure, isNull);
    expect(snapshot.lastAcknowledgedSequence, 1);
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
        deviceId: _id(10),
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

  test('a hub-owned command is not replayed to the cloud', () async {
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    final command = await journal.append(
      commandId: _id(91),
      deviceId: _id(92),
      credentialVersion: 1,
      merchantId: _id(93),
      locationId: _id(94),
      operatorSessionId: _id(95),
      idempotencyKey: _id(96),
      commandType: 'pos.cart.fire',
      hubOwned: true,
      payload: const {'cartId': 'hub-cart'},
    );
    final gateway = _Gateway();

    final accepted = await OrderedReplayEngine(journal, gateway).replay(
      scope: ReplayScope(
        deviceId: _id(92),
        merchantId: _id(93),
        locationId: _id(94),
        operatorSessionId: _id(95),
        credentialVersion: 1,
      ),
      replaySessionId: _id(97),
    );

    expect(command.hubOwned, isTrue);
    expect(accepted, 0);
    expect(gateway.sequences, isEmpty);
    expect((await journal.load()).pendingCount, 1);
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
  Future<ResolvedReplayConflict> resolveConflict(
    ReplayScope scope,
    String commandId,
  ) => throw UnimplementedError();
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
