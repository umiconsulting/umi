import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/features/offline/connectivity_controller.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';
import 'package:umi_pos/features/offline/replay_engine.dart';

void main() {
  test(
    'restart queries a lost response before replay and maps it once',
    () async {
      final store = _Store();
      final journal = EncryptedOfflineJournal(store, web: false);
      await journal.append(
        commandId: _id(1),
        deviceId: _id(2),
        credentialVersion: 1,
        tenantId: _id(3),
        branchId: _id(4),
        operatorSessionId: _id(5),
        idempotencyKey: _id(6),
        provisionalId: _id(7),
        commandType: 'pos.checkout.cash',
        payload: const {'checkoutIdentity': 'restart-recovery'},
        deduplicationKey: 'restart-recovery',
        maxPendingCashCount: 3,
        maxPendingCashMinorUnits: 30000,
        cashAmountMinorUnits: 5000,
      );
      final connectivity = _online();
      final lost = _Gateway(loseSubmitResponse: true);
      await OfflineRecoveryController(
        journal: journal,
        gateway: lost,
        connectivity: connectivity,
      ).recover(_scope());
      expect(
        (await journal.load()).entries.single.status,
        JournalStatus.unknown,
      );

      final restarted = EncryptedOfflineJournal(store, web: false);
      final recoveredGateway = _Gateway(
        recoveredResult: ReplayResult(
          commandId: _id(1),
          deviceSequence: 1,
          status: 'accepted',
          officialId: _id(8),
          officialCommit: const {'receipt': 'safe-reference'},
          serverConflictReference: null,
          failure: null,
        ),
        serverSequence: 1,
      );
      final controller = OfflineRecoveryController(
        journal: restarted,
        gateway: recoveredGateway,
        connectivity: _online(),
      );
      await controller.recover(_scope());
      final snapshot = await restarted.load();
      expect(recoveredGateway.submissions, 0);
      expect(recoveredGateway.resultQueries, 1);
      expect(snapshot.entries.single.status, JournalStatus.accepted);
      expect(snapshot.mappings[_id(7)], _id(8));
      expect(controller.status.phase, RecoveryPhase.completed);
    },
  );

  for (final code in ['DEVICE_REVOKED', 'DEVICE_CREDENTIAL_ROTATED']) {
    test('$code blocks recovery before replay', () async {
      final journal = EncryptedOfflineJournal(_Store(), web: false);
      await journal.append(
        commandId: _id(1),
        deviceId: _id(2),
        credentialVersion: 1,
        tenantId: _id(3),
        branchId: _id(4),
        operatorSessionId: _id(5),
        idempotencyKey: _id(6),
        payload: const {},
      );
      final gateway = _Gateway(authorityError: code);
      final controller = OfflineRecoveryController(
        journal: journal,
        gateway: gateway,
        connectivity: _online(),
      );
      await controller.recover(_scope());
      expect(controller.status.phase, RecoveryPhase.blockedByDevice);
      expect(gateway.submissions, 0);
      expect(
        (await journal.load()).entries.single.status,
        JournalStatus.pending,
      );
    });
  }
}

ConnectivityController _online() {
  final connectivity = ConnectivityController();
  connectivity.apiReachable(authorityValid: true);
  connectivity.apiReachable(authorityValid: true);
  return connectivity;
}

ReplayScope _scope() => ReplayScope(
  tenantId: _id(3),
  branchId: _id(4),
  operatorSessionId: _id(5),
  credentialVersion: 1,
);

String _id(int value) =>
    '00000000-0000-4000-8000-${value.toString().padLeft(12, '0')}';

final class _Store implements JournalCipherStore {
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
  _Gateway({
    this.loseSubmitResponse = false,
    this.recoveredResult,
    this.serverSequence = 0,
    this.authorityError,
  });
  final bool loseSubmitResponse;
  final ReplayResult? recoveredResult;
  final int serverSequence;
  final String? authorityError;
  int submissions = 0;
  int resultQueries = 0;

  OfflinePolicy get _policy => OfflinePolicy(
    cash: OfflineCashPolicy(
      enabled: true,
      version: 'policy-1',
      issuedAt: DateTime.now().toUtc().toIso8601String(),
      expiresAt: DateTime.now()
          .toUtc()
          .add(const Duration(minutes: 10))
          .toIso8601String(),
      maxPolicyAgeSeconds: 600,
      tenantId: _id(3),
      branchId: _id(4),
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
    allowedCommandTypes: const ['operational.ack', 'pos.checkout.cash'],
    maxBatchSize: 20,
    webSensitiveJournalEnabled: false,
  );

  @override
  Future<BeginReplayResponse> begin(ReplayScope scope) async {
    if (authorityError != null) {
      throw AppException(
        category: AppErrorCategory.authentication,
        code: authorityError!,
        recoverable: false,
      );
    }
    return BeginReplayResponse(
      replaySessionId: _id(10),
      cursor: ReplayCursor(
        deviceId: _id(2),
        credentialVersion: 1,
        lastAcceptedSequence: serverSequence,
        reconciliationRequired: false,
        updatedAt: DateTime.now().toUtc().toIso8601String(),
      ).toJson(),
      policy: _policy.toJson(),
    );
  }

  @override
  Future<ReplayBatchResult> submit(ReplayScope scope, ReplayBatch batch) async {
    submissions++;
    if (loseSubmitResponse) {
      throw const AppException(
        category: AppErrorCategory.transport,
        code: 'RESPONSE_LOST',
        recoverable: true,
      );
    }
    throw StateError('no replay expected');
  }

  @override
  Future<ReplayResult?> resultFor(ReplayScope scope, String commandId) async {
    resultQueries++;
    return recoveredResult;
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
    serverLastAcceptedSequence: serverSequence,
    missingSequences: const [],
    duplicates: const [],
    conflicts: const [],
    provisionalMappings: const [],
    reconciliationRequired: false,
  );

  @override
  Future<OfflinePolicy> policy(ReplayScope scope) async => _policy;
  @override
  Future<void> acknowledge(ReplayScope scope, String reconciliationId) async {}
  @override
  Future<ConflictSummary> conflicts(ReplayScope scope) async =>
      const ConflictSummary(items: []);
  @override
  Future<ReplayCursor> cursor(ReplayScope scope) async =>
      throw UnimplementedError();
  @override
  Future<SafeReplayDiagnostic> diagnostics(ReplayScope scope) async =>
      throw UnimplementedError();
}
