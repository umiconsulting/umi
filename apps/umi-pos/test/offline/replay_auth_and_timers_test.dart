import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/bootstrap/bootstrap_controller.dart';
import 'package:umi_pos/bootstrap/composition_root.dart';
import 'package:umi_pos/core/config/app_config.dart';
import 'package:umi_pos/core/contracts/contract_gateway.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/feature_flags/feature_flags.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/platform/platform_adapters.dart';
import 'package:umi_pos/core/release/release_compatibility.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/core/storage/storage.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/cart/incoming_orders_controller.dart';
import 'package:umi_pos/features/cash/cash_controller.dart';
import 'package:umi_pos/features/cash/cash_repository.dart';
import 'package:umi_pos/features/catalog/catalog_controller.dart';
import 'package:umi_pos/features/catalog/catalog_repository.dart';
import 'package:umi_pos/features/checkout/checkout_controller.dart';
import 'package:umi_pos/features/checkout/checkout_repository.dart';
import 'package:umi_pos/features/entry/entry_controller.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';
import 'package:umi_pos/features/exception/exception_controller.dart';
import 'package:umi_pos/features/exception/exception_recovery_store.dart';
import 'package:umi_pos/features/exception/exception_repository.dart';
import 'package:umi_pos/features/offline/connectivity_controller.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';
import 'package:umi_pos/features/offline/replay_engine.dart';
import 'package:umi_pos/features/sale/sale_lifecycle_controller.dart';
import 'package:umi_pos/features/sale/sale_repository.dart';

import '../support/fakes.dart';

void main() {
  test(
    'lock, logout, and clearSession clear replay scope so heartbeats emit zero 401 replay calls',
    () async {
      final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
      await _appendCommand(journal, id: 1, commandType: 'pos.cart.line.add');
      final connectivity = _online();
      final gateway = _FakeReplayGateway(
        onBegin: (_) async => throw const AppException(
          category: AppErrorCategory.server,
          code: 'SERVER_TEMP_UNAVAILABLE',
          recoverable: true,
        ),
      );
      final recovery = OfflineRecoveryController(
        journal: journal,
        gateway: gateway,
        connectivity: connectivity,
      );
      addTearDown(recovery.dispose);

      final vault = CredentialVault(MemorySecureStorage());
      await vault.saveDevice(
        id: _id(2),
        publicId: 'dev-pub-1',
        credential: 'device-secret',
        credentialVersion: 1,
        state: 'active',
        merchantId: _id(3),
        locationId: _id(4),
      );
      final entry = EntryController(
        gateway: _FakeEntryGateway(),
        vault: vault,
        telemetry: _noopTelemetry,
        offlineRecovery: recovery,
      );
      addTearDown(entry.dispose);

      // Establish a ready operator session and an active replay scope.
      await entry.initialize();
      await entry.loginWithPin('1234');
      expect(entry.state.phase, EntryPhase.ready);

      await recovery.recover(_scope(sessionId: _id(50)));
      expect(gateway.beginCalls, 1);

      // Lock terminal: must clear scope and pause in blockedByAuth.
      await entry.lock();
      expect(entry.state.phase, EntryPhase.pinRequired);
      expect(recovery.status.phase, RecoveryPhase.blockedByAuth);

      // Simulate 5 x 10s heartbeats returning 200 /health/live while locked.
      for (var i = 0; i < 5; i++) {
        connectivity.apiReachable(authorityValid: true);
        await recovery.replayIfPending();
      }
      expect(
        gateway.beginCalls,
        1,
        reason: 'locked terminal must never call replay begin on heartbeat',
      );

      // Also verify logout() and clearSession() clear scope and cancel timers.
      gateway.onBegin = (_) async => throw const AppException(
        category: AppErrorCategory.server,
        code: 'RATE_LIMITED',
        recoverable: true,
        details: {'retryAfterSeconds': 1},
      );
      await recovery.recover(_scope(sessionId: _id(51)));
      expect(recovery.status.phase, RecoveryPhase.waitingForCapacity);
      await entry.logout();
      expect(recovery.status.phase, RecoveryPhase.blockedByAuth);
      await Future<void>.delayed(const Duration(milliseconds: 1150));
      expect(
        gateway.beginCalls,
        2,
        reason: 'logout/clearScope must cancel pending retry timer',
      );

      await recovery.recover(_scope(sessionId: _id(52)));
      await entry.clearSession();
      expect(recovery.status.phase, RecoveryPhase.blockedByAuth);
      await Future<void>.delayed(const Duration(milliseconds: 1150));
      expect(gateway.beginCalls, 3);
    },
  );

  test(
    'AUTHENTICATION_REQUIRED pauses in blockedByAuth until PIN unlock supplies a fresh scope',
    () async {
      final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
      await _appendCommand(journal, id: 1, commandType: 'pos.cart.line.add');
      final connectivity = _online();
      final seenSessions = <String>[];
      var allowAuth = false;
      final gateway = _FakeReplayGateway(
        onBegin: (scope) async {
          seenSessions.add(scope.operatorSessionId);
          if (!allowAuth) {
            throw const AppException(
              category: AppErrorCategory.authentication,
              code: 'AUTHENTICATION_REQUIRED',
              recoverable: false,
            );
          }
          return _beginResponse();
        },
        acceptSubmit: true,
      );
      final recovery = OfflineRecoveryController(
        journal: journal,
        gateway: gateway,
        connectivity: connectivity,
      );
      addTearDown(recovery.dispose);

      await recovery.recover(_scope(sessionId: _id(50)));
      expect(recovery.status.phase, RecoveryPhase.blockedByAuth);
      expect(recovery.status.errorCode, 'AUTHENTICATION_REQUIRED');
      expect(gateway.beginCalls, 1);

      // Heartbeat ticks must NOT retry while blockedByAuth.
      for (var i = 0; i < 5; i++) {
        connectivity.apiReachable(authorityValid: true);
        await recovery.replayIfPending();
      }
      expect(gateway.beginCalls, 1);

      // Operator unlocks with PIN -> fresh authenticated scope drains queue.
      allowAuth = true;
      await recovery.recover(_scope(sessionId: _id(51)));
      expect(recovery.status.phase, RecoveryPhase.completed);
      expect((await journal.load()).pendingCount, 0);
      expect(seenSessions, [_id(50), _id(51)]);
      expect(gateway.submissions, 1);
    },
  );

  test(
    '429 Retry-After firing while offline never deadlocks in waitingForCapacity',
    () async {
      final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
      await _appendCommand(journal, id: 1, commandType: 'pos.cart.line.add');
      final connectivity = _online();
      var rateLimitOnce = true;
      final gateway = _FakeReplayGateway(
        onBegin: (_) async {
          if (rateLimitOnce) {
            rateLimitOnce = false;
            throw const AppException(
              category: AppErrorCategory.server,
              code: 'RATE_LIMITED',
              recoverable: true,
              details: {'retryAfterSeconds': 1},
            );
          }
          return _beginResponse();
        },
        acceptSubmit: true,
      );
      final recovery = OfflineRecoveryController(
        journal: journal,
        gateway: gateway,
        connectivity: connectivity,
      );
      addTearDown(recovery.dispose);

      await recovery.recover(_scope());
      expect(recovery.status.phase, RecoveryPhase.waitingForCapacity);
      expect(gateway.submissions, 0);

      // Go offline before the 429 timer fires.
      connectivity.networkDown();
      expect(connectivity.state, PosConnectivity.offline);

      // Let the Retry-After timer fire while offline.
      await Future<void>.delayed(const Duration(milliseconds: 1150));
      expect(
        recovery.status.phase,
        RecoveryPhase.waitingForConnectivity,
        reason: 'timer firing offline must exit waitingForCapacity',
      );
      expect(gateway.submissions, 0);

      // Connectivity returns -> heartbeat / connectivity listener drains immediately.
      connectivity.apiReachable(authorityValid: true);
      connectivity.apiReachable(authorityValid: true);
      await recovery.replayIfPending();
      await pumpEventQueue();

      expect((await journal.load()).pendingCount, 0);
      expect(recovery.status.phase, RecoveryPhase.completed);
      expect(gateway.submissions, 1);
    },
  );

  test(
    'reconcile serverLastProcessedSequence > lastAcknowledged runs _recoverBehind and discards conflict ONLY on explicit rejected/conflict_discarded',
    () async {
      final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
      for (var seq = 1; seq <= 3; seq++) {
        await _appendCommand(
          journal,
          id: seq,
          commandType: 'pos.cart.line.add',
        );
        if (seq < 3) {
          await journal.apply(
            ReplayResult(
              commandId: _id(seq),
              deviceSequence: seq,
              status: 'accepted',
              officialId: _id(100 + seq),
              officialCommit: null,
              serverConflictReference: null,
              failure: null,
            ),
          );
        }
      }
      // Seq #3 is pending behind serverLastAccepted=3; seq #4 is a local KDS refusal
      // behind serverLastProcessed=4.
      await _appendCommand(journal, id: 4, commandType: 'pos.kds.command');
      await journal.apply(
        ReplayResult(
          commandId: _id(4),
          deviceSequence: 4,
          status: 'conflict',
          officialId: null,
          officialCommit: null,
          serverConflictReference: _id(99),
          failure: const {
            'classification': 'server_validation_failed',
            'retryable': false,
            'blocksFollowing': false,
            'operatorActionRequired': true,
            'managerActionRequired': false,
            'guidanceCode': 'kitchen_refusal:KITCHEN_INVALID_TRANSITION',
            'correlationId': '00000000-0000-4000-8000-000000000099',
          },
        ),
      );

      // 1) Absence (resultFor returns null for seq #4) MUST NOT discard seq #4,
      //    while _recoverBehind still runs FIRST for seq #3 and preserves officialId.
      final queryOrder = <String>[];
      final gatewayAbsence = _FakeReplayGateway(
        serverAcceptedSequence: 3,
        serverProcessedSequence: 4,
        reconciliationRequired: true,
        onResultFor: (commandId) async {
          queryOrder.add(commandId);
          if (commandId == _id(3)) {
            return ReplayResult(
              commandId: _id(3),
              deviceSequence: 3,
              status: 'accepted',
              officialId: _id(103),
              officialCommit: null,
              serverConflictReference: null,
              failure: null,
            );
          }
          // Returning null for seq #4 (absence) must NOT resolve the conflict.
          return null;
        },
      );
      final controller1 = OfflineRecoveryController(
        journal: journal,
        gateway: gatewayAbsence,
        connectivity: _online(),
      );
      addTearDown(controller1.dispose);

      await controller1.recover(_scope());
      expect(
        queryOrder,
        [_id(3), _id(4)],
        reason: '_recoverBehind must recover seq #3 before conflict consumption queries seq #4',
      );
      final snapAfterAbsence = await journal.load();
      expect(snapAfterAbsence.entries[2].status, JournalStatus.accepted);
      expect(snapAfterAbsence.entries[2].officialId, _id(103));
      expect(snapAfterAbsence.lastAcknowledgedSequence, 3);
      expect(
        snapAfterAbsence.entries[3].status,
        JournalStatus.conflict,
        reason: 'absence (null resultFor) must never discard a conflict',
      );

      // 2) Now local lastAck == 3 == serverLastAcceptedSequence, but
      //    serverLastProcessedSequence == 4 > 3. Explicit rejected/conflict_discarded
      //    resolves seq #4 and advances lastAcknowledgedSequence to 4.
      final gatewayDiscarded = _FakeReplayGateway(
        serverAcceptedSequence: 3,
        serverProcessedSequence: 4,
        reconciliationRequired: true,
        onResultFor: (commandId) async {
          if (commandId == _id(4)) {
            return ReplayResult(
              commandId: _id(4),
              deviceSequence: 4,
              status: 'rejected',
              officialId: null,
              officialCommit: null,
              serverConflictReference: _id(99),
              failure: const {
                'classification': 'server_validation_failed',
                'retryable': false,
                'blocksFollowing': false,
                'operatorActionRequired': true,
                'managerActionRequired': false,
                'guidanceCode': 'conflict_discarded',
                'correlationId': '00000000-0000-4000-8000-000000000099',
              },
            );
          }
          return null;
        },
      );
      final controller2 = OfflineRecoveryController(
        journal: journal,
        gateway: gatewayDiscarded,
        connectivity: _online(),
      );
      addTearDown(controller2.dispose);

      await controller2.recover(_scope());
      final snapAfterDiscard = await journal.load();
      expect(snapAfterDiscard.entries[3].status, JournalStatus.resolved);
      expect(snapAfterDiscard.lastAcknowledgedSequence, 4);
      expect(snapAfterDiscard.pendingCount, 0);
      expect(controller2.status.phase, RecoveryPhase.completed);
    },
  );

  test(
    'reconcile serverLastProcessedSequence > lastAcknowledged queries pending behind entry in _recoverBehind',
    () async {
      final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
      for (var seq = 1; seq <= 3; seq++) {
        await _appendCommand(
          journal,
          id: seq,
          commandType: 'pos.cart.line.add',
        );
        await journal.apply(
          ReplayResult(
            commandId: _id(seq),
            deviceSequence: seq,
            status: 'accepted',
            officialId: _id(100 + seq),
            officialCommit: null,
            serverConflictReference: null,
            failure: null,
          ),
        );
      }
      await _appendCommand(journal, id: 4, commandType: 'pos.kds.command');

      final queried = <String>[];
      final gateway = _FakeReplayGateway(
        serverAcceptedSequence: 3,
        serverProcessedSequence: 4,
        reconciliationRequired: true,
        onResultFor: (commandId) async {
          queried.add(commandId);
          return ReplayResult(
            commandId: commandId,
            deviceSequence: 4,
            status: 'rejected',
            officialId: null,
            officialCommit: null,
            serverConflictReference: _id(99),
            failure: const {
              'classification': 'server_validation_failed',
              'retryable': false,
              'blocksFollowing': false,
              'operatorActionRequired': true,
              'managerActionRequired': false,
              'guidanceCode': 'conflict_discarded',
              'correlationId': '00000000-0000-4000-8000-000000000099',
            },
          );
        },
      );
      final controller = OfflineRecoveryController(
        journal: journal,
        gateway: gateway,
        connectivity: _online(),
      );
      addTearDown(controller.dispose);

      await controller.recover(_scope());
      expect(queried, [_id(4)]);
      expect((await journal.load()).entries[3].status, JournalStatus.resolved);
      expect((await journal.load()).pendingCount, 0);
      expect(controller.status.phase, RecoveryPhase.completed);
    },
  );

  test(
    'blockedByConflict does not mark apiReachable(authorityValid: true) or hammer replay on 10s heartbeats',
    () async {
      final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
      await _appendCommand(journal, id: 1, commandType: 'pos.kds.command');
      await _appendCommand(journal, id: 2, commandType: 'pos.cart.line.add');
      final connectivity = _online();
      final gateway = _FakeReplayGateway(
        onSubmit: (scope, batch) async {
          final first = OfflineCommand.fromJson(batch.commands.first);
          return ReplayBatchResult(
            replaySessionId: batch.replaySessionId,
            results: [
              ReplayResult(
                commandId: first.commandId,
                deviceSequence: first.deviceSequence,
                status: 'conflict',
                officialId: null,
                officialCommit: null,
                serverConflictReference: _id(77),
                failure: const {
                  'classification': 'server_validation_failed',
                  'retryable': false,
                  'blocksFollowing': false,
                  'operatorActionRequired': true,
                  'managerActionRequired': false,
                  'guidanceCode': 'kitchen_refusal:KITCHEN_INVALID_TRANSITION',
                  'correlationId': '00000000-0000-4000-8000-000000000099',
                },
              ).toJson(),
            ],
            cursor: ReplayCursor(
              deviceId: _id(2),
              credentialVersion: 1,
              lastAcceptedSequence: 0,
              reconciliationRequired: true,
              updatedAt: DateTime.now().toUtc().toIso8601String(),
            ).toJson(),
            stopped: true,
          );
        },
      );
      final recovery = OfflineRecoveryController(
        journal: journal,
        gateway: gateway,
        connectivity: connectivity,
      );
      addTearDown(recovery.dispose);

      await recovery.recover(_scope());
      expect(recovery.status.phase, RecoveryPhase.blockedByConflict);
      expect(
        connectivity.state,
        PosConnectivity.reconciliationRequired,
        reason: 'blockedByConflict must NOT mark apiReachable(authorityValid: true)',
      );
      expect(gateway.beginCalls, 1);
      expect(gateway.submissions, 1);

      // 5 simulated 10s heartbeats must NOT hammer replay while blocked.
      for (var i = 0; i < 5; i++) {
        await recovery.replayIfPending();
      }
      expect(gateway.beginCalls, 1);
      expect(gateway.submissions, 1);
    },
  );

  test(
    'composition root heartbeat releases _heartbeatInFlight before slow replay finishes',
    () async {
      final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
      await _appendCommand(journal, id: 1, commandType: 'pos.cart.line.add');
      final connectivity = _online();
      final replayGate = Completer<BeginReplayResponse>();
      final gateway = _FakeReplayGateway(
        onBegin: (_) => replayGate.future,
        acceptSubmit: true,
      );
      final recovery = OfflineRecoveryController(
        journal: journal,
        gateway: gateway,
        connectivity: connectivity,
      );
      // Seed active scope while offline so replayIfPending will trigger on beat.
      connectivity.networkDown();
      await recovery.recover(_scope());
      expect(recovery.status.phase, RecoveryPhase.waitingForConnectivity);

      var healthLiveCalls = 0;
      final api = _HealthLiveApi(() {
        healthLiveCalls++;
        return const {'ok': true};
      });
      final root = _buildRoot(
        api: api,
        connectivity: connectivity,
        journal: journal,
        recovery: recovery,
      );
      addTearDown(root.dispose);

      // First beat proves reachability (recovering) and fires replay asynchronously.
      await root.runConnectivityHeartbeatOnce();
      // Give the unawaited replayIfPending() microtasks time to enter gateway.begin().
      await pumpEventQueue();
      expect(healthLiveCalls, 1);
      expect(gateway.beginCalls, 1);

      // Second beat while gateway.begin() is still blocked MUST STILL hit /health/live!
      await root.runConnectivityHeartbeatOnce();
      expect(
        healthLiveCalls,
        2,
        reason: 'slow replay must not hold _heartbeatInFlight across /health/live',
      );
      expect(
        gateway.beginCalls,
        1,
        reason: 'OfflineRecoveryController._running guard prevents duplicate replay',
      );

      // Complete the slow replay cleanly.
      replayGate.complete(_beginResponse());
      await pumpEventQueue();
      expect((await journal.load()).pendingCount, 0);
    },
  );
}

const _noopTelemetry = SafeTelemetry(
  enabled: false,
  context: TelemetryContext(
    appVersion: 'test',
    environment: 'test',
    platform: 'test',
  ),
  exporter: NoopTelemetryExporter(),
);

ConnectivityController _online() {
  final connectivity = ConnectivityController();
  connectivity.apiReachable(authorityValid: true);
  connectivity.apiReachable(authorityValid: true);
  return connectivity;
}

ReplayScope _scope({String? sessionId}) => ReplayScope(
  deviceId: _id(2),
  merchantId: _id(3),
  locationId: _id(4),
  operatorSessionId: sessionId ?? _id(5),
  credentialVersion: 1,
);

String _id(int value) =>
    '00000000-0000-4000-8000-${value.toString().padLeft(12, '0')}';

Future<void> _appendCommand(
  EncryptedOfflineJournal journal, {
  required int id,
  required String commandType,
}) => journal.append(
  commandId: _id(id),
  deviceId: _id(2),
  credentialVersion: 1,
  merchantId: _id(3),
  locationId: _id(4),
  operatorSessionId: _id(5),
  idempotencyKey: _id(200 + id),
  commandType: commandType,
  payload: commandType == 'pos.kds.command'
      ? const {'commandType': 'start_preparation'}
      : {'cartId': _id(300)},
);

BeginReplayResponse _beginResponse({int serverSequence = 0}) =>
    BeginReplayResponse(
      replaySessionId: _id(10),
      cursor: ReplayCursor(
        deviceId: _id(2),
        credentialVersion: 1,
        lastAcceptedSequence: serverSequence,
        reconciliationRequired: false,
        updatedAt: DateTime.now().toUtc().toIso8601String(),
      ).toJson(),
      policy: OfflinePolicy(
        cash: OfflineCashPolicy(
          enabled: true,
          version: 'policy-1',
          issuedAt: DateTime.now().toUtc().toIso8601String(),
          expiresAt: DateTime.now()
              .toUtc()
              .add(const Duration(minutes: 10))
              .toIso8601String(),
          maxPolicyAgeSeconds: 600,
          merchantId: _id(3),
          locationId: _id(4),
          deviceId: _id(2),
          deviceCredentialVersion: 1,
          currency: 'MXN',
          requiredPermission: 'offline.cash.checkout',
          requiredEntitlement: 'pos.offline_cash',
          managerApprovalThresholdMinorUnits: null,
          allowedDeviceClasses: const ['pos_terminal'],
          limits: OfflinePolicyLimits(
            maxSingleSaleMinorUnits: 10000,
            maxAccumulatedMinorUnits: 30000,
            maxOfflineSaleCount: 3,
            maxActiveQueueDepth: 10,
            maxCommandAgeSeconds: 3600,
            maxCatalogAgeSeconds: 900,
            maxPricingAgeSeconds: 600,
            maxTaxAgeSeconds: 600,
          ).toJson(),
          correlationId: _id(9),
          fingerprint: List.filled(64, 'a').join(),
        ).toJson(),
        allowedCommandTypes: const [
          'operational.ack',
          'pos.cart.line.add',
          'pos.kds.command',
          'pos.checkout.cash',
        ],
        maxBatchSize: 20,
        webSensitiveJournalEnabled: false,
      ).toJson(),
    );

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

final class _FakeReplayGateway implements ReplayGateway {
  _FakeReplayGateway({
    this.onBegin,
    this.onSubmit,
    this.onResultFor,
    this.acceptSubmit = false,
    this.serverAcceptedSequence = 0,
    this.serverProcessedSequence,
    this.reconciliationRequired = false,
  });

  Future<BeginReplayResponse> Function(ReplayScope scope)? onBegin;
  Future<ReplayBatchResult> Function(ReplayScope scope, ReplayBatch batch)?
  onSubmit;
  Future<ReplayResult?> Function(String commandId)? onResultFor;
  final bool acceptSubmit;
  final int serverAcceptedSequence;
  final int? serverProcessedSequence;
  final bool reconciliationRequired;

  int beginCalls = 0;
  int submissions = 0;
  int acknowledgements = 0;

  @override
  Future<BeginReplayResponse> begin(ReplayScope scope) async {
    beginCalls++;
    if (onBegin != null) return onBegin!(scope);
    return _beginResponse(serverSequence: serverAcceptedSequence);
  }

  @override
  Future<ReplayBatchResult> submit(ReplayScope scope, ReplayBatch batch) async {
    submissions++;
    if (onSubmit != null) return onSubmit!(scope, batch);
    if (!acceptSubmit) throw StateError('submit not expected');
    final results = batch.commands.map((raw) {
      final cmd = OfflineCommand.fromJson(raw);
      return ReplayResult(
        commandId: cmd.commandId,
        deviceSequence: cmd.deviceSequence,
        status: 'accepted',
        officialId: _id(500 + cmd.deviceSequence),
        officialCommit: null,
        serverConflictReference: null,
        failure: null,
      );
    }).toList();
    return ReplayBatchResult(
      replaySessionId: batch.replaySessionId,
      results: results.map((r) => r.toJson()).toList(),
      cursor: ReplayCursor(
        deviceId: _id(2),
        credentialVersion: 1,
        lastAcceptedSequence: results.last.deviceSequence,
        reconciliationRequired: false,
        updatedAt: DateTime.now().toUtc().toIso8601String(),
      ).toJson(),
      stopped: false,
    );
  }

  @override
  Future<ReplayResult?> resultFor(ReplayScope scope, String commandId) async {
    if (onResultFor != null) return onResultFor!(commandId);
    return null;
  }

  @override
  Future<ReconciliationSummary> reconcile(
    ReplayScope scope,
    ReconcileRequest request,
  ) async => ReconciliationSummary(
    reconciliationId: _id(11),
    deviceId: _id(2),
    credentialVersion: 1,
    localLastAllocatedSequence: request.localLastAllocatedSequence,
    localLastAcknowledgedSequence: request.localLastAcknowledgedSequence,
    serverLastAcceptedSequence: serverAcceptedSequence,
    serverLastProcessedSequence: serverProcessedSequence,
    missingSequences: const [],
    duplicates: const [],
    conflicts: const [],
    provisionalMappings: const [],
    reconciliationRequired: reconciliationRequired,
  );

  @override
  Future<void> acknowledge(ReplayScope scope, String reconciliationId) async {
    acknowledgements++;
  }

  @override
  Future<ConflictSummary> conflicts(ReplayScope scope) async =>
      const ConflictSummary(items: []);

  @override
  Future<ResolvedReplayConflict> resolveConflict(
    ReplayScope scope,
    String commandId,
  ) async => ResolvedReplayConflict(
    resolved: true,
    commandId: commandId,
    deviceSequence: 1,
    nextAcceptedSequence: 1,
  );

  @override
  Future<OfflinePolicy> policy(ReplayScope scope) async =>
      throw UnimplementedError();

  @override
  Future<ReplayCursor> cursor(ReplayScope scope) async =>
      throw UnimplementedError();

  @override
  Future<SafeReplayDiagnostic> diagnostics(ReplayScope scope) async =>
      throw UnimplementedError();
}

final class _FakeEntryGateway implements EntryGateway {
  final _device = DeviceSummary(
    id: _id(2),
    publicId: 'dev-pub-1',
    merchantId: _id(3),
    locationId: _id(4),
    displayName: 'Caja Principal',
    type: 'pos_terminal',
    platform: 'android',
    mobility: 'static',
    state: 'active',
    credentialVersion: 1,
    rotationRequired: false,
    lastSeenAt: '2026-11-20T00:00:00.000Z',
    revokedAt: null,
    replacementDeviceId: null,
  );

  @override
  Future<DeviceSummary> deviceStatus() async => _device;

  @override
  Future<PosSessionResponse> pinLogin({
    required String pin,
    required String merchantId,
    required String locationId,
  }) async => PosSessionResponse(
    tokens: const PosSessionTokens(
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    ).toJson(),
    session: const {
      'user': {'displayName': 'Caja Principal'},
    },
  );

  @override
  Future<EntryContextResponse> entryContext() async => EntryContextResponse(
    merchants: [
      EntryMerchant(
        id: _id(3),
        name: 'ONCA',
        roles: const ['cashier'],
        permissions: const ['order.create', 'offline.cash.checkout'],
        entitlements: const [],
        locations: [
          LocationAccess(
            id: _id(4),
            merchantId: _id(3),
            name: 'Centro',
            status: 'active',
            deviceAllowed: true,
            operatorAllowed: true,
          ).toJson(),
        ],
      ).toJson(),
    ],
  );

  @override
  Future<OperatorSessionView> startOperator(
    String merchantId,
    String locationId,
  ) async {
    final now = DateTime.now().toUtc();
    return OperatorSessionView(
      id: _id(50),
      userId: _id(60),
      staffId: _id(61),
      merchantId: merchantId,
      locationId: locationId,
      deviceId: _id(2),
      state: 'active',
      permissions: const ['order.create', 'offline.cash.checkout'],
      entitlements: const [],
      startedAt: now.toIso8601String(),
      lastActivityAt: now.toIso8601String(),
      expiresAt: now.add(const Duration(hours: 8)).toIso8601String(),
    );
  }

  @override
  Future<void> lockOperator(String sessionId) async {}

  @override
  Future<void> logout() async {}

  @override
  Future<void> endOperator(String sessionId) async {}

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final class _HealthLiveApi implements ApiClient {
  _HealthLiveApi(this._onHealthLive);
  final Map<String, Object?> Function() _onHealthLive;

  @override
  Future<Map<String, Object?>> request({
    required ApiMethod method,
    required String path,
    Map<String, Object?>? body,
    CancellationToken? cancellation,
    bool idempotent = false,
    bool authRefresh = true,
    Map<String, String>? extraHeaders,
  }) async {
    if (path == '/health/live') return _onHealthLive();
    return const {};
  }

  @override
  void dispose() {}
}

AppCompositionRoot _buildRoot({
  required ApiClient api,
  required ConnectivityController connectivity,
  required EncryptedOfflineJournal journal,
  required OfflineRecoveryController recovery,
}) {
  final secureStorage = MemorySecureStorage();
  final preferences = TestPreferences();
  final credentials = CredentialVault(secureStorage);
  final cartRepo = ApiCartRepository(api);
  final cart = CartController(repository: cartRepo, telemetry: _noopTelemetry);
  return AppCompositionRoot(
    config: pilotTestConfig,
    connectivityHeartbeat: false,
    controller: BootstrapController(
      config: pilotTestConfig,
      contracts: const GeneratedContractGateway(),
      releaseCompatibility: ApiReleaseCompatibilityGateway(
        api: api,
        config: pilotTestConfig,
      ),
      secureStorage: secureStorage,
      preferences: preferences,
      telemetry: _noopTelemetry,
    ),
    telemetry: _noopTelemetry,
    secureStorage: secureStorage,
    preferences: preferences,
    localDatabase: const UnsupportedLocalDatabase(),
    platform: const PlatformAdapters(
      connectivity: UnsupportedConnectivity(),
      deviceIdentity: UnsupportedDeviceIdentity(),
      lifecycle: UnsupportedAppLifecycle(),
    ),
    apiClient: api,
    features: FeatureFlags.bootstrap(FeatureBootstrapMode.localSafeDefaults),
    credentials: credentials,
    entry: EntryController(
      gateway: ApiEntryGateway(api, credentials),
      vault: credentials,
      telemetry: _noopTelemetry,
      offlineRecovery: recovery,
    ),
    exceptions: SaleExceptionController(
      repository: ApiSaleExceptionRepository(api),
      recoveryStore: MemorySaleExceptionRecoveryStore(),
    ),
    catalog: CatalogController(
      repository: ApiCatalogRepository(api),
      cache: CatalogCache(),
      telemetry: _noopTelemetry,
    ),
    cart: cart,
    incomingOrders: IncomingOrdersController(
      repository: cartRepo,
      telemetry: _noopTelemetry,
    ),
    cash: CashController(repository: ApiCashRepository(api)),
    checkout: CheckoutController(
      repository: ApiCheckoutRepository(api),
      telemetry: _noopTelemetry,
    ),
    sales: SaleLifecycleController(
      repository: ApiSaleRepository(api),
      cart: cart,
      telemetry: _noopTelemetry,
    ),
    connectivity: connectivity,
    offlineJournal: journal,
    offlineRecovery: recovery,
  );
}
