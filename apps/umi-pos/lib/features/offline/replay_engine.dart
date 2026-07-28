import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/network/api_client.dart';
import 'connectivity_controller.dart';
import 'offline_journal.dart';

final class ReplayScope {
  const ReplayScope({
    required this.tenantId,
    required this.branchId,
    required this.operatorSessionId,
    required this.credentialVersion,
  });
  final String tenantId;
  final String branchId;
  final String operatorSessionId;
  final int credentialVersion;
  Map<String, String> get query => {
    'branchId': branchId,
    'operatorSessionId': operatorSessionId,
    'credentialVersion': '$credentialVersion',
  };
}

abstract interface class ReplayGateway {
  Future<BeginReplayResponse> begin(ReplayScope scope);
  Future<OfflinePolicy> policy(ReplayScope scope);
  Future<ReplayCursor> cursor(ReplayScope scope);
  Future<ReplayBatchResult> submit(ReplayScope scope, ReplayBatch batch);
  Future<ReplayResult?> resultFor(ReplayScope scope, String commandId);
  Future<ConflictSummary> conflicts(ReplayScope scope);
  Future<ReconciliationSummary> reconcile(
    ReplayScope scope,
    ReconcileRequest request,
  );
  Future<void> acknowledge(ReplayScope scope, String reconciliationId);
  Future<SafeReplayDiagnostic> diagnostics(ReplayScope scope);
}

final class ApiReplayGateway implements ReplayGateway {
  ApiReplayGateway(this._api);
  final ApiClient _api;

  String _path(String path, ReplayScope scope) =>
      Uri(path: path, queryParameters: scope.query).toString();

  @override
  Future<BeginReplayResponse> begin(ReplayScope scope) async =>
      BeginReplayResponse.fromJson(
        await _api.request(
          method: ApiMethod.post,
          path: UmiRoutes.posOfflineReplayBegin(scope.tenantId),
          body: BeginReplayRequest(
            tenantId: scope.tenantId,
            branchId: scope.branchId,
            operatorSessionId: scope.operatorSessionId,
            credentialVersion: scope.credentialVersion,
          ).toJson(),
          idempotent: true,
        ),
      );

  @override
  Future<OfflinePolicy> policy(ReplayScope scope) async =>
      OfflinePolicy.fromJson(
        await _api.request(
          method: ApiMethod.get,
          path: _path(UmiRoutes.posOfflinePolicy(scope.tenantId), scope),
        ),
      );

  @override
  Future<ReplayCursor> cursor(ReplayScope scope) async => ReplayCursor.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: _path(UmiRoutes.posOfflineReplayCursor(scope.tenantId), scope),
    ),
  );

  @override
  Future<ReplayBatchResult> submit(
    ReplayScope scope,
    ReplayBatch batch,
  ) async => ReplayBatchResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posOfflineReplayBatch(scope.tenantId),
      body: batch.toJson(),
      // A lost response must be queried before the same batch is sent again.
      idempotent: false,
    ),
  );

  @override
  Future<ReplayResult?> resultFor(ReplayScope scope, String commandId) async {
    try {
      return ReplayResult.fromJson(
        await _api.request(
          method: ApiMethod.get,
          path: _path(
            UmiRoutes.posOfflineReplayCommand(scope.tenantId, commandId),
            scope,
          ),
        ),
      );
    } on AppException catch (error) {
      if (error.code == 'RESOURCE_NOT_FOUND') return null;
      rethrow;
    }
  }

  @override
  Future<ConflictSummary> conflicts(ReplayScope scope) async =>
      ConflictSummary.fromJson(
        await _api.request(
          method: ApiMethod.get,
          path: _path(UmiRoutes.posOfflineConflicts(scope.tenantId), scope),
        ),
      );

  @override
  Future<ReconciliationSummary> reconcile(
    ReplayScope scope,
    ReconcileRequest request,
  ) async => ReconciliationSummary.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: _path(UmiRoutes.posOfflineReconcile(scope.tenantId), scope),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<void> acknowledge(ReplayScope scope, String reconciliationId) async {
    await _api.request(
      method: ApiMethod.post,
      path: _path(
        UmiRoutes.posOfflineReconcileAcknowledge(scope.tenantId),
        scope,
      ),
      body: AcknowledgeReconciliationRequest(
        reconciliationId: reconciliationId,
      ).toJson(),
      idempotent: true,
    );
  }

  @override
  Future<SafeReplayDiagnostic> diagnostics(ReplayScope scope) async =>
      SafeReplayDiagnostic.fromJson(
        await _api.request(
          method: ApiMethod.get,
          path: _path(UmiRoutes.posOfflineDiagnostics(scope.tenantId), scope),
        ),
      );
}

/// Focused deterministic runner used by tests and foreground recovery tools.
/// Production startup uses [OfflineRecoveryController], which adds authority,
/// cursor reconciliation, and unknown-result recovery before invoking replay.
final class OrderedReplayEngine {
  OrderedReplayEngine(this._journal, this._gateway);
  final EncryptedOfflineJournal _journal;
  final ReplayGateway _gateway;
  bool _running = false;

  Future<int> replay({
    required ReplayScope scope,
    required String replaySessionId,
    int batchSize = 20,
  }) async {
    if (_running) throw const OfflineJournalException('replay_already_running');
    _running = true;
    var accepted = 0;
    try {
      final snapshot = await _journal.load();
      final pending =
          snapshot.entries
              .where((entry) => entry.status == JournalStatus.pending)
              .toList()
            ..sort(
              (left, right) => left.command.deviceSequence.compareTo(
                right.command.deviceSequence,
              ),
            );
      for (var offset = 0; offset < pending.length; offset += batchSize) {
        final slice = pending
            .skip(offset)
            .take(batchSize)
            .toList(growable: false);
        final result = await _gateway.submit(
          scope,
          ReplayBatch(
            replaySessionId: replaySessionId,
            commands: slice.map((entry) => entry.command.toJson()).toList(),
          ),
        );
        for (final encoded in result.results) {
          final item = ReplayResult.fromJson(encoded);
          await _journal.apply(item);
          if (item.status == 'accepted' || item.status == 'duplicate') {
            accepted++;
          }
          if (item.failure?['blocksFollowing'] == true) return accepted;
        }
        if (result.stopped) return accepted;
      }
      return accepted;
    } finally {
      _running = false;
    }
  }
}

enum RecoveryPhase {
  idle,
  inspectingStorage,
  validatingAuthority,
  recoveringUnknownResults,
  reconciling,
  readyToReplay,
  replaying,
  waitingForConnectivity,
  blockedByDevice,
  blockedByConflict,
  blockedByStorage,
  completed,
  failedSafely,
}

final class RecoveryStatus {
  const RecoveryStatus({
    this.phase = RecoveryPhase.idle,
    this.total = 0,
    this.processed = 0,
    this.accepted = 0,
    this.duplicates = 0,
    this.unknown = 0,
    this.conflicts = 0,
    this.errorCode,
  });
  final RecoveryPhase phase;
  final int total;
  final int processed;
  final int accepted;
  final int duplicates;
  final int unknown;
  final int conflicts;
  final String? errorCode;
}

/// The replay state machine owns correctness independently from widget lifetime.
final class OfflineRecoveryController extends ChangeNotifier {
  OfflineRecoveryController({
    required EncryptedOfflineJournal journal,
    required ReplayGateway gateway,
    required ConnectivityController connectivity,
  }) : _journal = journal,
       _gateway = gateway,
       _connectivity = connectivity;
  final EncryptedOfflineJournal _journal;
  final ReplayGateway _gateway;
  final ConnectivityController _connectivity;
  RecoveryStatus _status = const RecoveryStatus();
  bool _running = false;
  RecoveryStatus get status => _status;

  Future<void> recover(ReplayScope scope) async {
    if (_running) return;
    _running = true;
    try {
      _set(const RecoveryStatus(phase: RecoveryPhase.inspectingStorage));
      final local = await _journal.load();
      if (local.pendingCount == 0) {
        if (_connectivity.state == PosConnectivity.online ||
            _connectivity.state == PosConnectivity.recovering) {
          _set(const RecoveryStatus(phase: RecoveryPhase.validatingAuthority));
          final session = await _gateway.begin(scope);
          await _journal.cachePolicy(
            OfflinePolicy.fromJson(session.policy),
            DateTime.parse(session.cursor['updatedAt']! as String),
          );
        }
        _set(const RecoveryStatus(phase: RecoveryPhase.completed));
        return;
      }
      if (_connectivity.state != PosConnectivity.online &&
          _connectivity.state != PosConnectivity.recovering) {
        _set(
          RecoveryStatus(
            phase: RecoveryPhase.waitingForConnectivity,
            total: local.pendingCount,
          ),
        );
        return;
      }
      _set(
        RecoveryStatus(
          phase: RecoveryPhase.validatingAuthority,
          total: local.pendingCount,
        ),
      );
      final session = await _gateway.begin(scope);
      final policy = OfflinePolicy.fromJson(session.policy);
      await _journal.cachePolicy(
        policy,
        DateTime.parse(session.cursor['updatedAt']! as String),
      );

      _set(
        RecoveryStatus(
          phase: RecoveryPhase.recoveringUnknownResults,
          total: local.pendingCount,
        ),
      );
      for (final entry in local.entries.where(
        (value) => value.status == JournalStatus.unknown,
      )) {
        final recovered = await _gateway.resultFor(
          scope,
          entry.command.commandId,
        );
        if (recovered != null) await _journal.apply(recovered);
      }

      final afterRecovery = await _journal.load();
      _set(
        RecoveryStatus(
          phase: RecoveryPhase.reconciling,
          total: afterRecovery.pendingCount,
        ),
      );
      final reconciliation = await _gateway.reconcile(
        scope,
        ReconcileRequest(
          localLastAllocatedSequence: afterRecovery.nextSequence - 1,
          localLastAcknowledgedSequence: afterRecovery.lastAcknowledgedSequence,
        ),
      );
      if (reconciliation.reconciliationRequired &&
          reconciliation.serverLastAcceptedSequence >
              afterRecovery.lastAcknowledgedSequence) {
        final recovered = await _recoverBehind(
          scope,
          afterRecovery,
          reconciliation,
        );
        if (!recovered) return;
      }
      final ready = await _journal.load();
      _set(
        RecoveryStatus(
          phase: RecoveryPhase.readyToReplay,
          total: ready.pendingCount,
        ),
      );
      await _replay(scope, session.replaySessionId);
    } on OfflineJournalException catch (error) {
      _set(
        RecoveryStatus(
          phase: RecoveryPhase.blockedByStorage,
          errorCode: error.category,
        ),
      );
    } on AppException catch (error) {
      final phase = error.code == 'DEVICE_REVOKED'
          ? RecoveryPhase.blockedByDevice
          : RecoveryPhase.failedSafely;
      _set(RecoveryStatus(phase: phase, errorCode: error.code));
    } finally {
      _running = false;
    }
  }

  Future<bool> _recoverBehind(
    ReplayScope scope,
    OfflineJournalSnapshot local,
    ReconciliationSummary reconciliation,
  ) async {
    for (final entry in local.entries.where(
      (value) =>
          value.command.deviceSequence <=
              reconciliation.serverLastAcceptedSequence &&
          value.status != JournalStatus.accepted &&
          value.status != JournalStatus.duplicate,
    )) {
      final result = await _gateway.resultFor(scope, entry.command.commandId);
      if (result == null) {
        _set(
          RecoveryStatus(
            phase: RecoveryPhase.blockedByConflict,
            errorCode: 'accepted_result_missing',
          ),
        );
        return false;
      }
      await _journal.apply(result);
    }
    return true;
  }

  Future<void> _replay(ReplayScope scope, String replaySessionId) async {
    _connectivity.replayStarted();
    var accepted = 0;
    var duplicates = 0;
    var processed = 0;
    final snapshot = await _journal.load();
    final pending =
        snapshot.entries
            .where((entry) => entry.status == JournalStatus.pending)
            .toList()
          ..sort(
            (a, b) =>
                a.command.deviceSequence.compareTo(b.command.deviceSequence),
          );
    _set(RecoveryStatus(phase: RecoveryPhase.replaying, total: pending.length));
    for (var offset = 0; offset < pending.length; offset += 20) {
      final slice = pending.skip(offset).take(20).toList(growable: false);
      ReplayBatchResult batch;
      try {
        batch = await _gateway.submit(
          scope,
          ReplayBatch(
            replaySessionId: replaySessionId,
            commands: slice.map((entry) => entry.command.toJson()).toList(),
          ),
        );
      } on AppException catch (error) {
        if (error.code == 'DEVICE_REVOKED' ||
            error.code == 'DEVICE_CREDENTIAL_ROTATED') {
          _connectivity.block();
          _set(
            RecoveryStatus(
              phase: RecoveryPhase.blockedByDevice,
              total: pending.length,
              processed: processed,
              errorCode: error.code,
            ),
          );
          return;
        }
        if (error.category != AppErrorCategory.transport &&
            error.category != AppErrorCategory.timeout) {
          _set(
            RecoveryStatus(
              phase: RecoveryPhase.blockedByConflict,
              total: pending.length,
              processed: processed,
              errorCode: error.code,
            ),
          );
          return;
        }
        for (final entry in slice) {
          await _journal.markUnknown(entry.command.commandId);
        }
        _set(
          RecoveryStatus(
            phase: RecoveryPhase.recoveringUnknownResults,
            total: pending.length,
            processed: processed,
            accepted: accepted,
            duplicates: duplicates,
            unknown: slice.length,
          ),
        );
        return;
      }
      for (final raw in batch.results) {
        final result = ReplayResult.fromJson(raw);
        await _journal.apply(result);
        processed++;
        if (result.status == 'accepted') accepted++;
        if (result.status == 'duplicate') duplicates++;
        _set(
          RecoveryStatus(
            phase: RecoveryPhase.replaying,
            total: pending.length,
            processed: processed,
            accepted: accepted,
            duplicates: duplicates,
            conflicts: result.status == 'conflict' ? 1 : 0,
          ),
        );
        if (result.failure?['blocksFollowing'] == true) {
          _connectivity.reconciliationNeeded();
          _set(
            RecoveryStatus(
              phase: RecoveryPhase.blockedByConflict,
              total: pending.length,
              processed: processed,
              accepted: accepted,
              duplicates: duplicates,
              conflicts: 1,
              errorCode: result.failure?['classification'] as String?,
            ),
          );
          return;
        }
      }
      if (batch.stopped) return;
    }
    _connectivity.apiReachable(authorityValid: true);
    _set(
      RecoveryStatus(
        phase: RecoveryPhase.completed,
        total: pending.length,
        processed: processed,
        accepted: accepted,
        duplicates: duplicates,
      ),
    );
  }

  void _set(RecoveryStatus value) {
    _status = value;
    notifyListeners();
  }
}
