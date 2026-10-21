import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/features/kitchen/hub_command_forwarder.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';
import 'package:umi_pos/features/offline/replay_engine.dart';

const _merchant = '00000000-0000-4000-8000-000000000101';
const _location = '00000000-0000-4000-8000-000000000102';
const _device = '00000000-0000-4000-8000-000000000103';
const _operator = '00000000-0000-4000-8000-000000000104';
const _command = '00000000-0000-4000-8000-000000000105';
const _key = '00000000-0000-4000-8000-000000000106';
const _provisional = '00000000-0000-4000-8000-000000000107';
const _official = '00000000-0000-4000-8000-000000000108';

void main() {
  test(
    'queues the peer entry once and then closes it from hub status',
    () async {
      final journal = EncryptedOfflineJournal(_MemoryStore(), web: false);
      await journal.append(
        commandId: _command,
        deviceId: _device,
        credentialVersion: 1,
        merchantId: _merchant,
        locationId: _location,
        operatorSessionId: _operator,
        idempotencyKey: _key,
        commandType: 'pos.command.group',
        hubOwned: true,
        provisionalId: _provisional,
        payload: const {
          'groupId': _key,
          'aggregateKeys': ['account:$_provisional'],
          'effects': [
            {
              'type': 'open_table_account',
              'provisionalCartId': _provisional,
              'tableId': '00000000-0000-4000-8000-000000000109',
              'partySize': 2,
            },
          ],
        },
      );
      final gateway = _Gateway();
      final forwarder = HubCommandForwarder(journal: journal, gateway: gateway);

      await forwarder.forwardNow();
      var entry = (await journal.load()).entries.single;
      expect(gateway.submits, 1);
      expect(entry.status, JournalStatus.pending);
      expect(entry.hubDeliveryState, 'queued');
      expect(entry.hubCommandId, gateway.hubCommandId);

      await forwarder.forwardNow();
      entry = (await journal.load()).entries.single;
      expect(gateway.submits, 1);
      expect(entry.status, JournalStatus.accepted);
      expect(entry.hubDeliveryState, 'accepted');
      expect((await journal.load()).mappings[_provisional], _official);
      expect((await journal.load()).pendingCount, 0);
      forwarder.dispose();
    },
  );

  test('a hub transport failure preserves the peer-owned entry', () async {
    final journal = EncryptedOfflineJournal(_MemoryStore(), web: false);
    await journal.append(
      commandId: _command,
      deviceId: _device,
      credentialVersion: 1,
      merchantId: _merchant,
      locationId: _location,
      operatorSessionId: _operator,
      idempotencyKey: _key,
      commandType: 'pos.cart.fire',
      hubOwned: true,
      payload: const {'cartId': _provisional},
    );
    final forwarder = HubCommandForwarder(
      journal: journal,
      gateway: _Gateway(failSubmit: true),
    );

    await forwarder.forwardNow();

    final entry = (await journal.load()).entries.single;
    expect(entry.status, JournalStatus.pending);
    expect(entry.hubDeliveryState, isNull);
    expect((await journal.load()).pendingCount, 1);
    forwarder.dispose();
  });

  test('a hub conflict remains visible and keeps its failure', () async {
    final journal = EncryptedOfflineJournal(_MemoryStore(), web: false);
    await journal.append(
      commandId: _command,
      deviceId: _device,
      credentialVersion: 1,
      merchantId: _merchant,
      locationId: _location,
      operatorSessionId: _operator,
      idempotencyKey: _key,
      commandType: 'pos.cart.fire',
      hubOwned: true,
      payload: const {'cartId': _provisional},
    );
    final gateway = _Gateway(state: 'conflict');
    final forwarder = HubCommandForwarder(journal: journal, gateway: gateway);

    await forwarder.forwardNow();
    await forwarder.forwardNow();

    final entry = (await journal.load()).entries.single;
    expect(entry.status, JournalStatus.conflict);
    expect(entry.hubDeliveryState, 'conflict');
    expect(entry.failure?['classification'], 'table_unavailable');
    expect((await journal.load()).pendingCount, 1);
    forwarder.dispose();
  });

  test('same-account commands reach the hub in device order', () async {
    final journal = EncryptedOfflineJournal(_MemoryStore(), web: false);
    for (var index = 0; index < 2; index += 1) {
      await journal.append(
        commandId: index == 0
            ? _command
            : '00000000-0000-4000-8000-000000000111',
        deviceId: _device,
        credentialVersion: 1,
        merchantId: _merchant,
        locationId: _location,
        operatorSessionId: _operator,
        idempotencyKey: index == 0
            ? _key
            : '00000000-0000-4000-8000-000000000112',
        commandType: 'pos.cart.line.add',
        hubOwned: true,
        payload: {'cartId': _provisional, 'quantity': index + 1},
      );
    }
    final gateway = _Gateway();
    final forwarder = HubCommandForwarder(journal: journal, gateway: gateway);

    await forwarder.forwardNow();

    expect(gateway.submittedCommands, [
      _command,
      '00000000-0000-4000-8000-000000000111',
    ]);
    expect(
      (await journal.load()).entries.map((entry) => entry.hubDeviceSequence),
      [41, 42],
    );
    forwarder.dispose();
  });

  test('a lost hub receipt resubmits the same local command', () async {
    final journal = EncryptedOfflineJournal(_MemoryStore(), web: false);
    await journal.append(
      commandId: _command,
      deviceId: _device,
      credentialVersion: 1,
      merchantId: _merchant,
      locationId: _location,
      operatorSessionId: _operator,
      idempotencyKey: _key,
      commandType: 'pos.cart.fire',
      hubOwned: true,
      payload: const {'cartId': _provisional},
    );
    final gateway = _Gateway(missStatusOnce: true);
    final forwarder = HubCommandForwarder(journal: journal, gateway: gateway);

    await forwarder.forwardNow();
    await forwarder.forwardNow();
    var entry = (await journal.load()).entries.single;
    expect(entry.hubDeliveryState, isNull);
    expect(entry.status, JournalStatus.pending);

    await forwarder.forwardNow();
    entry = (await journal.load()).entries.single;
    expect(gateway.submits, 2);
    expect(entry.hubDeliveryState, 'queued');
    forwarder.dispose();
  });

  test('a peer conflict resolves through the hub, not the cloud', () async {
    final journal = EncryptedOfflineJournal(_MemoryStore(), web: false);
    final command = await journal.append(
      commandId: _command,
      deviceId: _device,
      credentialVersion: 1,
      merchantId: _merchant,
      locationId: _location,
      operatorSessionId: _operator,
      idempotencyKey: _key,
      commandType: 'pos.cart.fire',
      hubOwned: true,
      payload: const {'cartId': _provisional},
    );
    await journal.apply(
      ReplayResult(
        commandId: command.commandId,
        deviceSequence: command.deviceSequence,
        status: 'conflict',
        officialId: null,
        officialCommit: null,
        serverConflictReference: _command,
        failure: const {
          'classification': 'table_unavailable',
          'retryable': false,
          'blocksFollowing': false,
          'operatorActionRequired': true,
          'managerActionRequired': false,
          'guidanceCode': 'table_unavailable',
          'correlationId': _command,
        },
      ),
    );
    final hub = _Gateway();
    final delegate = _ReplayDelegate();
    final gateway = HubAwareReplayGateway(
      delegate: delegate,
      journal: journal,
      hub: hub,
    );

    final result = await gateway.resolveConflict(_scope, _command);

    expect(result.resolved, isTrue);
    expect(hub.resolves, 1);
    expect(delegate.resolves, 0);
  });
}

const _scope = ReplayScope(
  deviceId: _device,
  merchantId: _merchant,
  locationId: _location,
  operatorSessionId: _operator,
  credentialVersion: 1,
);

final class _Gateway implements HubCommandGateway {
  _Gateway({
    this.state = 'accepted',
    this.failSubmit = false,
    this.missStatusOnce = false,
  });

  final String state;
  final bool failSubmit;
  bool missStatusOnce;
  int submits = 0;
  int resolves = 0;
  final String hubCommandId = '00000000-0000-4000-8000-000000000110';
  final List<String> submittedCommands = [];

  @override
  Future<HubCommandReceipt> submit(OfflineCommand command) async {
    submits += 1;
    if (failSubmit) throw StateError('hub_unreachable');
    submittedCommands.add(command.commandId);
    return HubCommandReceipt(
      commandId: hubCommandId,
      deviceSequence: 40 + submits,
      queued: true,
      duplicate: false,
    );
  }

  @override
  Future<HubCommandState> status(OfflineCommand command) async {
    if (missStatusOnce) {
      missStatusOnce = false;
      throw const AppException(
        category: AppErrorCategory.server,
        code: 'RESOURCE_NOT_FOUND',
        recoverable: false,
      );
    }
    return HubCommandState(
      status: state,
      errorCode: state == 'conflict' ? 'table_unavailable' : null,
      officialId: state == 'accepted' ? _official : null,
      officialCommit: null,
      failure: state == 'conflict'
          ? const {
              'classification': 'table_unavailable',
              'retryable': false,
              'blocksFollowing': false,
              'operatorActionRequired': true,
              'managerActionRequired': false,
              'guidanceCode': 'table_unavailable',
              'correlationId': _command,
            }
          : null,
      deviceSequence: 41,
    );
  }

  @override
  Future<HubConflictResolution> resolveConflict(OfflineCommand command) async {
    resolves += 1;
    return const HubConflictResolution(resolved: true, status: 'resolved');
  }
}

final class _ReplayDelegate implements ReplayGateway {
  int resolves = 0;

  @override
  Future<ResolvedReplayConflict> resolveConflict(
    ReplayScope scope,
    String commandId,
  ) async {
    resolves += 1;
    return ResolvedReplayConflict(
      resolved: true,
      commandId: commandId,
      deviceSequence: 1,
      nextAcceptedSequence: 1,
    );
  }

  @override
  Future<BeginReplayResponse> begin(ReplayScope scope) =>
      throw UnimplementedError();

  @override
  Future<OfflinePolicy> policy(ReplayScope scope) => throw UnimplementedError();

  @override
  Future<ReplayCursor> cursor(ReplayScope scope) => throw UnimplementedError();

  @override
  Future<ReplayBatchResult> submit(ReplayScope scope, ReplayBatch batch) =>
      throw UnimplementedError();

  @override
  Future<ReplayResult?> resultFor(ReplayScope scope, String commandId) =>
      throw UnimplementedError();

  @override
  Future<ConflictSummary> conflicts(ReplayScope scope) =>
      throw UnimplementedError();

  @override
  Future<ReconciliationSummary> reconcile(
    ReplayScope scope,
    ReconcileRequest request,
  ) => throw UnimplementedError();

  @override
  Future<void> acknowledge(ReplayScope scope, String reconciliationId) =>
      throw UnimplementedError();

  @override
  Future<SafeReplayDiagnostic> diagnostics(ReplayScope scope) =>
      throw UnimplementedError();
}

final class _MemoryStore implements JournalCipherStore {
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
