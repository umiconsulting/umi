import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/network/api_client.dart';
import 'connectivity_controller.dart';
import 'offline_journal.dart';

final class ReplayScope {
  const ReplayScope({
    required this.deviceId,
    required this.merchantId,
    required this.locationId,
    required this.operatorSessionId,
    required this.credentialVersion,
  });
  final String deviceId;
  final String merchantId;
  final String locationId;
  final String operatorSessionId;
  final int credentialVersion;
  Map<String, String> get query => {
    'locationId': locationId,
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
  Future<ResolvedReplayConflict> resolveConflict(
    ReplayScope scope,
    String commandId,
  );
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
          path: UmiRoutes.posOfflineReplayBegin(scope.merchantId),
          body: BeginReplayRequest(
            merchantId: scope.merchantId,
            locationId: scope.locationId,
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
          path: _path(UmiRoutes.posOfflinePolicy(scope.merchantId), scope),
        ),
      );

  @override
  Future<ReplayCursor> cursor(ReplayScope scope) async => ReplayCursor.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: _path(UmiRoutes.posOfflineReplayCursor(scope.merchantId), scope),
    ),
  );

  @override
  Future<ReplayBatchResult> submit(
    ReplayScope scope,
    ReplayBatch batch,
  ) async => ReplayBatchResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      // The scope rides on the URL, not only inside the commands. The commands
      // name the session that wrote them; the URL names the session submitting
      // them, which is the only one the server can still prove is open.
      path: _path(UmiRoutes.posOfflineReplayBatch(scope.merchantId), scope),
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
            UmiRoutes.posOfflineReplayCommand(scope.merchantId, commandId),
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
          path: _path(UmiRoutes.posOfflineConflicts(scope.merchantId), scope),
        ),
      );

  @override
  Future<ResolvedReplayConflict> resolveConflict(
    ReplayScope scope,
    String commandId,
  ) async => ResolvedReplayConflict.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: _path(
        UmiRoutes.posOfflineResolveConflict(scope.merchantId, commandId),
        scope,
      ),
      body: ResolveReplayConflictRequest(
        resolution: 'discard_refused',
      ).toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<ReconciliationSummary> reconcile(
    ReplayScope scope,
    ReconcileRequest request,
  ) async => ReconciliationSummary.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: _path(UmiRoutes.posOfflineReconcile(scope.merchantId), scope),
      body: request.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<void> acknowledge(ReplayScope scope, String reconciliationId) async {
    await _api.request(
      method: ApiMethod.post,
      path: _path(
        UmiRoutes.posOfflineReconcileAcknowledge(scope.merchantId),
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
          path: _path(UmiRoutes.posOfflineDiagnostics(scope.merchantId), scope),
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
              .where(
                (entry) =>
                    entry.status == JournalStatus.pending &&
                    entry.command.hubOwned != true,
              )
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
  waitingForCapacity,
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
       _connectivity = connectivity {
    _connectivity.addListener(_onConnectivityChanged);
  }
  final EncryptedOfflineJournal _journal;
  final ReplayGateway _gateway;
  final ConnectivityController _connectivity;

  /// The last scope the till handed this controller.
  ///
  /// The scope names the merchant, location, device, operator session and
  /// credential version a replay is submitted under, and it is built by the
  /// surface because that is where the session lives. Remembering it is what
  /// lets a replay start from a connectivity change rather than from a tap.
  ReplayScope? _scope;
  RecoveryStatus _status = const RecoveryStatus();
  bool _running = false;
  String? _reconciliationId;
  Timer? _retryTimer;
  RecoveryStatus get status => _status;
  String? get reconciliationId => _reconciliationId;

  /// Replay by itself when the connection comes back.
  ///
  /// This is the half the recovery centre could not do: `apiReachable` moves the
  /// till through `offline → recovering → online` on its own, and until now
  /// nothing listened for that. A cash sale taken in a dead spot sat in the
  /// journal until an operator opened the recovery centre or the app was
  /// restarted, which is exactly the "automatic ordered replay" gap §14 lists
  /// against workstream K. The journal is checked first because a replay with
  /// nothing to replay would still ask the server to begin a session on every
  /// transition; and `recover` keeps its own `_running` guard, so an operator
  /// pressing the button at the same moment cannot double-submit.
  void _onConnectivityChanged() {
    final scope = _scope;
    if (scope == null) return;
    final state = _connectivity.state;
    if (state != PosConnectivity.online &&
        state != PosConnectivity.recovering) {
      return;
    }
    unawaited(replayIfPending());
  }

  /// Drain pending work if the API is answering, whatever moved the state.
  ///
  /// Connectivity is edge-driven: a transition notifies this controller once.
  /// An edge can be missed — a probe that succeeded just before the backend
  /// died leaves the till believing it is online, so the recovery never fires
  /// a transition and the sale waits for an operator. Calling this on every
  /// successful probe makes replay *level*-triggered as well: it asks "is there
  /// pending work and is the API reachable", not "did something change".
  ///
  /// The journal is read first so a still till does no network work, and
  /// [recover] keeps its own guard, so a probe landing at the same moment as a
  /// reconnect cannot double-submit.
  Future<void> replayIfPending() async {
    final scope = _scope;
    if (scope == null) return;
    if (_connectivity.state != PosConnectivity.online &&
        _connectivity.state != PosConnectivity.recovering) {
      return;
    }
    if (_running) return;
    // A blocked stream or a refused device needs an operator, and a closed
    // server window needs time. Polling the API every heartbeat cannot clear
    // any of them; it only spends the budget the replay needs to finish. The
    // operator's action calls [recover] or [resolveConflict] directly.
    if (_status.phase == RecoveryPhase.blockedByConflict ||
        _status.phase == RecoveryPhase.blockedByDevice ||
        _status.phase == RecoveryPhase.blockedByStorage ||
        _status.phase == RecoveryPhase.waitingForCapacity) {
      return;
    }
    try {
      final snapshot = await _journal.load();
      if (snapshot.pendingCount == 0) return;
    } on OfflineJournalException {
      // Unreadable storage is `recover`'s to report, not a connectivity event's:
      // it sets `blockedByStorage` with the category, which is the state an
      // operator can act on. Swallowing it here keeps a listener from throwing.
      return;
    }
    await recover(scope);
  }

  @override
  void dispose() {
    _retryTimer?.cancel();
    _connectivity.removeListener(_onConnectivityChanged);
    super.dispose();
  }

  Future<void> recover(ReplayScope scope) async {
    if (_running) return;
    _retryTimer?.cancel();
    _scope = scope;
    _running = true;
    try {
      try {
        await _journal.discardForeignReplayScope(
          deviceId: scope.deviceId,
          credentialVersion: scope.credentialVersion,
        );
      } on OfflineJournalException catch (error) {
        _set(
          RecoveryStatus(
            phase: RecoveryPhase.blockedByDevice,
            errorCode: error.category,
          ),
        );
        return;
      }
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
        if (recovered != null) {
          await _journal.apply(recovered);
        } else {
          await _journal.retryUnknown(entry.command.commandId);
        }
      }

      // Resolve definitively refused local cart steps before asking the server
      // to reconcile "processed but not acknowledged" sequences. A refused
      // sequence has no successful result to recover, so doing reconciliation
      // first used to stop at `accepted_result_missing` and never reach this
      // cleanup.
      await _discardFirstDefiniteObsoleteCartConflict(scope);
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
      _reconciliationId = reconciliation.reconciliationId;
      if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
        debugPrint(
          '[umipos] replay reconcile required=${reconciliation.reconciliationRequired} '
          'server=${reconciliation.serverLastAcceptedSequence} '
          'ack=${afterRecovery.lastAcknowledgedSequence} '
          'pending=${afterRecovery.pendingCount}',
        );
      }
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
      if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
        debugPrint(
          '[umipos] replay ready pending=${ready.pendingCount} '
          'statuses=${ready.entries.map((e) => '${e.command.deviceSequence}:${e.status.name}').join(',')}',
        );
      }
      _set(
        RecoveryStatus(
          phase: RecoveryPhase.readyToReplay,
          total: ready.pendingCount,
        ),
      );
      await _replay(scope, session.replaySessionId);
      final settled = await _journal.load();
      final reconciliationId = _reconciliationId;
      if (reconciliationId != null &&
          settled.pendingCount == 0 &&
          _status.phase != RecoveryPhase.blockedByConflict &&
          _status.phase != RecoveryPhase.failedSafely) {
        // The local journal is durable and the server has accounted for every
        // command. Acknowledge that reconciliation here instead of leaving a
        // healthy sale behind an operator-only "Confirm reconciliation" button.
        await _gateway.acknowledge(scope, reconciliationId);
        _reconciliationId = null;
      }
    } on OfflineJournalException catch (error) {
      _set(
        RecoveryStatus(
          phase: RecoveryPhase.blockedByStorage,
          errorCode: error.category,
        ),
      );
    } on AppException catch (error) {
      if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
        debugPrint(
          '[umipos] replay app error code=${error.code} category=${error.category.name}',
        );
      }
      if (error.code == 'RATE_LIMITED') {
        _set(
          RecoveryStatus(
            phase: RecoveryPhase.waitingForCapacity,
            errorCode: error.code,
          ),
        );
        _scheduleRetry(scope, error.retryAfter ?? const Duration(seconds: 30));
        return;
      }
      final phase =
          error.code == 'DEVICE_REVOKED' ||
              error.code == 'DEVICE_CREDENTIAL_ROTATED'
          ? RecoveryPhase.blockedByDevice
          : RecoveryPhase.failedSafely;
      _set(RecoveryStatus(phase: phase, errorCode: error.code));
    } finally {
      _running = false;
    }
  }

  Future<void> acknowledgeReconciliation(ReplayScope scope) async {
    final reconciliationId = _reconciliationId;
    if (reconciliationId == null || _running) return;
    await _gateway.acknowledge(scope, reconciliationId);
    _reconciliationId = null;
    await recover(scope);
  }

  Future<int> resolveConflict(ReplayScope scope, String commandId) async {
    if (_running) return 0;
    _scope = scope;
    _running = true;
    try {
      _set(const RecoveryStatus(phase: RecoveryPhase.validatingAuthority));
      final resolved = await _gateway.resolveConflict(scope, commandId);
      if (!resolved.resolved) {
        _set(
          const RecoveryStatus(
            phase: RecoveryPhase.blockedByConflict,
            errorCode: 'CONFLICT_NOT_RESOLVABLE',
          ),
        );
        return 0;
      }
      final retried = await _journal.resolveConflictAndRetryFollowing(
        commandId,
      );
      _reconciliationId = null;
      // The refused step is no longer open, so the controller is not blocked.
      // Without this reset the heartbeat keeps skipping automatic replay after
      // a successful resolution.
      _set(RecoveryStatus(phase: RecoveryPhase.readyToReplay, total: retried));
      return retried;
    } on AppException catch (error) {
      if (error.code == 'RATE_LIMITED') {
        _set(
          RecoveryStatus(
            phase: RecoveryPhase.waitingForCapacity,
            errorCode: error.code,
          ),
        );
        _scheduleRetry(scope, error.retryAfter ?? const Duration(seconds: 30));
        return 0;
      }
      _set(
        RecoveryStatus(
          phase: RecoveryPhase.blockedByConflict,
          errorCode: error.code,
        ),
      );
      return 0;
    } on OfflineJournalException catch (error) {
      _set(
        RecoveryStatus(
          phase: RecoveryPhase.blockedByStorage,
          errorCode: error.category,
        ),
      );
      return 0;
    } finally {
      _running = false;
    }
  }

  Future<void> refreshPolicy(ReplayScope scope) async {
    // Cache policy age starts when the server confirms this download. The
    // configured issued_at is the age of the policy rules, not the age of this
    // device's copy. Using it made a daily refresh save an already stale policy
    // and fall back to online checkout after 24 hours.
    final session = await _gateway.begin(scope);
    await _journal.cachePolicy(
      OfflinePolicy.fromJson(session.policy),
      DateTime.parse(session.cursor['updatedAt']! as String),
    );
  }

  /// The server's own view of this till's queue, for support.
  ///
  /// Safe by construction — the contract carries counts, the accepted sequence,
  /// the last safe error category and an audit trail, and no token, payload or
  /// customer data. Null when the API cannot answer, which is exactly when the
  /// panel should simply not appear.
  Future<SafeReplayDiagnostic?> diagnostics(ReplayScope scope) async {
    try {
      return await _gateway.diagnostics(scope);
    } catch (_) {
      return null;
    }
  }

  Future<void> queryUnknownResults(ReplayScope scope) async {
    final snapshot = await _journal.load();
    for (final entry in snapshot.entries.where(
      (entry) => entry.status == JournalStatus.unknown,
    )) {
      final result = await _gateway.resultFor(scope, entry.command.commandId);
      if (result != null) await _journal.apply(result);
    }
  }

  Future<bool> _recoverBehind(
    ReplayScope scope,
    OfflineJournalSnapshot local,
    ReconciliationSummary reconciliation,
  ) async {
    final processedThrough =
        reconciliation.serverLastProcessedSequence ??
        reconciliation.serverLastAcceptedSequence;
    for (final entry in local.entries.where(
      (value) =>
          value.command.deviceSequence <= processedThrough &&
          value.status != JournalStatus.accepted &&
          value.status != JournalStatus.duplicate &&
          value.status != JournalStatus.resolved &&
          value.status != JournalStatus.archived,
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

  Future<void> _replay(
    ReplayScope scope,
    String replaySessionId, {
    int autoResolved = 0,
  }) async {
    _connectivity.replayStarted();
    var accepted = 0;
    var duplicates = 0;
    var processed = 0;
    final snapshot = await _journal.load();
    final pending =
        snapshot.entries
            .where(
              (entry) =>
                  entry.status == JournalStatus.pending &&
                  entry.command.hubOwned != true,
            )
            .toList()
          ..sort(
            (a, b) =>
                a.command.deviceSequence.compareTo(b.command.deviceSequence),
          );
    _set(RecoveryStatus(phase: RecoveryPhase.replaying, total: pending.length));
    if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
      debugPrint('[umipos] replay submit pending=${pending.length}');
    }
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
        if (error.code == 'RATE_LIMITED') {
          _set(
            RecoveryStatus(
              phase: RecoveryPhase.waitingForCapacity,
              total: pending.length,
              processed: processed,
              accepted: accepted,
              duplicates: duplicates,
              errorCode: error.code,
            ),
          );
          _scheduleRetry(
            scope,
            error.retryAfter ?? const Duration(seconds: 30),
          );
          return;
        }
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
          // Only a refusal that needs a person blocks the queue. A server
          // fault is transient: keep the commands and let the heartbeat try
          // again, or one bad minute would stop the till for the shift.
          final blocking =
              error.category == AppErrorCategory.conflict ||
              error.category == AppErrorCategory.permission ||
              error.category == AppErrorCategory.authentication;
          _set(
            RecoveryStatus(
              phase: blocking
                  ? RecoveryPhase.blockedByConflict
                  : RecoveryPhase.failedSafely,
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
      var unresolvedConflict = false;
      var resolvedInBatch = 0;
      for (final raw in batch.results) {
        final result = ReplayResult.fromJson(raw);
        await _journal.apply(result);
        processed++;
        if (result.status == 'accepted') accepted++;
        if (result.status == 'duplicate') duplicates++;
        if (result.status == 'conflict') {
          final command = pending
              .firstWhere(
                (entry) => entry.command.commandId == result.commandId,
              )
              .command;
          if (_isDefiniteNonFinancialCartRefusal(result, command)) {
            try {
              final resolution = await _gateway.resolveConflict(
                scope,
                result.commandId,
              );
              if (!resolution.resolved) {
                _set(
                  RecoveryStatus(
                    phase: RecoveryPhase.blockedByConflict,
                    total: pending.length,
                    processed: processed,
                    accepted: accepted,
                    duplicates: duplicates,
                    conflicts: 1,
                    errorCode: 'CONFLICT_NOT_RESOLVABLE',
                  ),
                );
                return;
              }
              await _journal.resolveConflictAndRetryFollowing(result.commandId);
              resolvedInBatch++;
              // The remaining results in this batch were evaluated against the
              // cursor before this refusal was closed. They are normally
              // `stream_blocked`; stop applying those stale answers and let the
              // next pass ask the server about them in order.
              break;
            } on AppException catch (error) {
              _set(
                RecoveryStatus(
                  phase: RecoveryPhase.blockedByConflict,
                  total: pending.length,
                  processed: processed,
                  accepted: accepted,
                  duplicates: duplicates,
                  conflicts: 1,
                  errorCode: error.code,
                ),
              );
              return;
            }
          } else {
            unresolvedConflict = true;
          }
        }
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
      if (unresolvedConflict) {
        _connectivity.reconciliationNeeded();
        _set(
          RecoveryStatus(
            phase: RecoveryPhase.blockedByConflict,
            total: pending.length,
            processed: processed,
            accepted: accepted,
            duplicates: duplicates,
            conflicts: 1,
          ),
        );
        return;
      }
      if (resolvedInBatch > 0) {
        // The server refused a cart that no longer exists. Resolving that exact
        // refusal advances the ordered cursor, so the lines behind it can be
        // submitted under the new cursor without asking the operator to clear a
        // conflict their screen never showed. Bound the chain: a stale account
        // has a handful of lines, not an endless stream.
        final nextAutoResolved = autoResolved + resolvedInBatch;
        if (nextAutoResolved > 50) {
          _set(
            RecoveryStatus(
              phase: RecoveryPhase.blockedByConflict,
              total: pending.length,
              processed: processed,
              accepted: accepted,
              duplicates: duplicates,
              conflicts: 1,
              errorCode: 'CONFLICT_CHAIN_TOO_LONG',
            ),
          );
          return;
        }
        await _replay(scope, replaySessionId, autoResolved: nextAutoResolved);
        return;
      }
      if (batch.stopped) return;
    }
    _connectivity.apiReachable(authorityValid: true);
    _retryTimer?.cancel();
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

  /// Close the first already-known non-financial cart refusal before building the
  /// pending batch.
  ///
  /// A conflict entry is not `pending`, so after a restart the recovery engine
  /// could see "zero pending" and submit nothing even though the ordered cursor
  /// was still blocked by the first refused line. Resolving that one advances
  /// the server cursor; [OfflineJournal.resolveConflictAndRetryFollowing] then
  /// returns the `stream_blocked` entries behind it to the queue.
  Future<void> _discardFirstDefiniteObsoleteCartConflict(
    ReplayScope scope,
  ) async {
    for (var resolved = 0; resolved < 50; resolved++) {
      final snapshot = await _journal.load();
      final refused = snapshot.entries
          .where(
            (entry) =>
                entry.status == JournalStatus.conflict &&
                _isDefiniteNonFinancialCartRefusalGuidance(
                  entry.failure?['retryable'],
                  entry.command.commandType,
                ),
          )
          .firstOrNull;
      if (refused == null) return;
      final resolution = await _gateway.resolveConflict(
        scope,
        refused.command.commandId,
      );
      if (!resolution.resolved) {
        throw const AppException(
          category: AppErrorCategory.conflict,
          code: 'CONFLICT_NOT_RESOLVABLE',
          recoverable: false,
        );
      }
      await _journal.resolveConflictAndRetryFollowing(
        refused.command.commandId,
      );
    }
    throw const AppException(
      category: AppErrorCategory.conflict,
      code: 'CONFLICT_CHAIN_TOO_LONG',
      recoverable: false,
    );
  }

  /// A non-financial cart command can be closed without human review when the
  /// server definitively refused it.
  ///
  /// The optimistic screen already painted the line or quantity. Once the server
  /// says the command did not apply and cannot be retried as-is, keeping that
  /// step open preserves nothing and blocks every later line. The refused step
  /// remains in history, while later commands are replayed against the current
  /// server cart.
  ///
  /// Financial, payment and table-lifecycle commands are excluded: those can
  /// create money or physical consequences and still require review. A fire or
  /// prepare command is safe only when the server marks it non-retryable; that
  /// verdict means no kitchen fact was created.
  bool _isDefiniteNonFinancialCartRefusal(
    ReplayResult result,
    OfflineCommand command,
  ) => _isDefiniteNonFinancialCartRefusalGuidance(
    result.failure?['retryable'],
    command.commandType,
  );

  bool _isDefiniteNonFinancialCartRefusalGuidance(
    Object? retryable,
    String commandType,
  ) {
    const safeCommands = {
      'pos.cart.open',
      'pos.cart.line.add',
      'pos.cart.line.update',
      'pos.cart.line.remove',
      'pos.cart.clear',
      'pos.cart.fulfillment.set',
      'pos.cart.table.set',
      'pos.cart.prepare',
      'pos.cart.fire',
    };
    if (!safeCommands.contains(commandType)) return false;
    if (retryable == true) return false;
    // Deployments have emitted this step as both `server_refused:*` and a bare
    // validation failure. For these seven local, non-financial cart operations,
    // the conflict itself is the definitive verdict. A retryable step is kept.
    return true;
  }

  void _set(RecoveryStatus value) {
    _status = value;
    notifyListeners();
  }

  /// Try the queue again after the window the server named.
  ///
  /// This is what keeps the till self-healing without operator work. The timer
  /// is single: a second refusal replaces the first deadline instead of adding
  /// a second replay.
  void _scheduleRetry(ReplayScope scope, Duration wait) {
    _retryTimer?.cancel();
    _retryTimer = Timer(wait, () {
      if (_connectivity.state == PosConnectivity.online ||
          _connectivity.state == PosConnectivity.recovering) {
        unawaited(recover(scope));
      }
    });
  }
}
