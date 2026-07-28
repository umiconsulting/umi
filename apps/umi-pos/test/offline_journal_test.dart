import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/features/offline/connectivity_controller.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';
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
        tenantId: _id(3),
        branchId: _id(4),
        operatorSessionId: _id(5),
        idempotencyKey: _id(6),
        payload: {'private': 'financial-value'},
      );
      final two = await journal.append(
        commandId: _id(7),
        deviceId: _id(2),
        credentialVersion: 1,
        tenantId: _id(3),
        branchId: _id(4),
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
      tenantId: _id(3),
      branchId: _id(4),
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
        tenantId: _id(11),
        branchId: _id(12),
        operatorSessionId: _id(13),
        idempotencyKey: _id(20 + i),
        payload: {'index': i},
      );
    }
    final gateway = _Gateway();
    final count = await OrderedReplayEngine(journal, gateway).replay(
      scope: ReplayScope(
        tenantId: _id(11),
        branchId: _id(12),
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
