import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/network/api_client.dart';
import '../offline/offline_journal.dart';
import '../offline/replay_engine.dart';

final class HubCommandReceipt {
  const HubCommandReceipt({
    required this.commandId,
    required this.deviceSequence,
    required this.queued,
    required this.duplicate,
  });

  final String commandId;
  final int deviceSequence;
  final bool queued;
  final bool duplicate;
}

final class HubCommandState {
  const HubCommandState({
    required this.status,
    required this.errorCode,
    required this.officialId,
    required this.officialCommit,
    required this.failure,
    required this.deviceSequence,
  });

  final String status;
  final String? errorCode;
  final String? officialId;
  final Map<String, Object?>? officialCommit;
  final Map<String, Object?>? failure;
  final int? deviceSequence;

  bool get terminal =>
      status == 'accepted' ||
      status == 'duplicate' ||
      status == 'conflict' ||
      status == 'rejected' ||
      status == 'resolved';
}

final class HubConflictResolution {
  const HubConflictResolution({required this.resolved, required this.status});

  final bool resolved;
  final String status;
}

/// Serializes hub intake by account key.
///
/// Authentication can take longer than the local write. The lane starts before
/// authentication, so two requests for one account cannot swap order. Different
/// account keys have different lanes and do not wait for each other.
final class HubAccountSequencer {
  final Map<String, Future<void>> _tails = {};

  Future<T> run<T>(String key, Future<T> Function() action) async {
    final previous = _tails[key] ?? Future<void>.value();
    final completed = Completer<void>();
    _tails[key] = completed.future;
    try {
      await previous;
      return await action();
    } finally {
      completed.complete();
      if (identical(_tails[key], completed.future)) {
        _tails.remove(key)?.ignore();
      }
    }
  }
}

abstract interface class HubCommandGateway {
  Future<HubCommandReceipt> submit(OfflineCommand command);
  Future<HubCommandState> status(OfflineCommand command);
  Future<HubConflictResolution> resolveConflict(OfflineCommand command);
}

final class ApiHubCommandGateway implements HubCommandGateway {
  ApiHubCommandGateway(this._api);

  final BoundedApiClient _api;

  static const _commandTypes = {
    'pos.cart.open',
    'pos.cart.line.add',
    'pos.cart.line.update',
    'pos.cart.line.remove',
    'pos.cart.clear',
    'pos.cart.prepare',
    'pos.cart.fire',
    'pos.cart.fulfillment.set',
    'pos.cart.table.set',
    'pos.command.group',
    'pos.table.command',
  };

  Map<String, String> _headers(OfflineCommand command) => {
    'x-umi-operator-session-id': command.operatorSessionId,
  };

  String _base(OfflineCommand command) =>
      '/api/v1/pos/merchants/${command.merchantId}/lan';

  @override
  Future<HubCommandReceipt> submit(OfflineCommand command) async {
    if (!_commandTypes.contains(command.commandType)) {
      throw StateError('command_not_hub_forwardable');
    }
    if (command.commandType == 'pos.table.command') {
      final answer = await _api.sendLanHub(
        method: ApiMethod.post,
        path: '${_base(command)}/table-command',
        body: {
          'commandId': command.commandId,
          'idempotencyKey': command.idempotencyKey,
          ...command.payload,
        },
        extraHeaders: _headers(command),
      );
      final data = _data(answer);
      return HubCommandReceipt(
        commandId: data['commandId']! as String,
        deviceSequence: (data['deviceSequence']! as num).toInt(),
        queued: data['queued'] == true,
        duplicate: data['duplicate'] == true,
      );
    }
    final group = command.commandType == 'pos.command.group'
        ? OfflineCommandGroupPayload.fromJson(command.payload)
        : null;
    final answer = await _api.sendLanHub(
      method: ApiMethod.post,
      path: group == null
          ? '${_base(command)}/cart-command'
          : '${_base(command)}/command-group',
      body: group == null
          ? {
              'commandId': command.commandId,
              'idempotencyKey': command.idempotencyKey,
              'commandType': command.commandType,
              'payload': command.payload,
            }
          : command.payload,
      extraHeaders: _headers(command),
    );
    final data = _data(answer);
    return HubCommandReceipt(
      commandId: data['commandId']! as String,
      deviceSequence: (data['deviceSequence']! as num).toInt(),
      queued: data['queued'] == true,
      duplicate: data['duplicate'] == true,
    );
  }

  @override
  Future<HubCommandState> status(OfflineCommand command) async {
    if (command.commandType == 'pos.table.command') {
      final answer = await _api.sendLanHub(
        method: ApiMethod.get,
        path: '${_base(command)}/table-command/${command.commandId}',
        extraHeaders: _headers(command),
      );
      final data = _data(answer);
      return HubCommandState(
        status: data['status']! as String,
        errorCode: data['errorCode'] as String?,
        officialId: data['officialId'] as String?,
        officialCommit: data['officialCommit'] as Map<String, Object?>?,
        failure: data['failure'] as Map<String, Object?>?,
        deviceSequence: (data['deviceSequence'] as num?)?.toInt(),
      );
    }
    final group = command.commandType == 'pos.command.group'
        ? OfflineCommandGroupPayload.fromJson(command.payload)
        : null;
    final answer = await _api.sendLanHub(
      method: ApiMethod.get,
      path: group == null
          ? '${_base(command)}/cart-command/${command.commandId}'
          : '${_base(command)}/command-group/${group.groupId}',
      extraHeaders: _headers(command),
    );
    final data = _data(answer);
    return HubCommandState(
      status: data['status']! as String,
      errorCode: data['errorCode'] as String?,
      officialId: data['officialId'] as String?,
      officialCommit: data['officialCommit'] as Map<String, Object?>?,
      failure: data['failure'] as Map<String, Object?>?,
      deviceSequence: (data['deviceSequence'] as num?)?.toInt(),
    );
  }

  @override
  Future<HubConflictResolution> resolveConflict(OfflineCommand command) async {
    if (command.commandType == 'pos.table.command') {
      final answer = await _api.sendLanHub(
        method: ApiMethod.post,
        path: '${_base(command)}/table-command/${command.commandId}/resolve',
        body: const {'resolution': 'discard_refused'},
        extraHeaders: _headers(command),
      );
      final data = _data(answer);
      return HubConflictResolution(
        resolved: data['resolved'] == true,
        status: data['status']! as String,
      );
    }
    final group = command.commandType == 'pos.command.group'
        ? OfflineCommandGroupPayload.fromJson(command.payload)
        : null;
    final answer = await _api.sendLanHub(
      method: ApiMethod.post,
      path: group == null
          ? '${_base(command)}/cart-command/${command.commandId}/resolve'
          : '${_base(command)}/command-group/${group.groupId}/resolve',
      body: const {'resolution': 'discard_refused'},
      extraHeaders: _headers(command),
    );
    final data = _data(answer);
    return HubConflictResolution(
      resolved: data['resolved'] == true,
      status: data['status']! as String,
    );
  }

  Map<String, Object?> _data(Map<String, Object?> answer) {
    final data = answer['data'];
    if (data is! Map<String, Object?>) {
      throw StateError('hub_response_invalid');
    }
    return data;
  }
}

/// Sends peer-owned conflict resolution through the main station.
final class HubAwareReplayGateway implements ReplayGateway {
  HubAwareReplayGateway({
    required ReplayGateway delegate,
    required EncryptedOfflineJournal journal,
    required HubCommandGateway hub,
  }) : _delegate = delegate,
       _journal = journal,
       _hub = hub;

  final ReplayGateway _delegate;
  final EncryptedOfflineJournal _journal;
  final HubCommandGateway _hub;

  @override
  Future<ResolvedReplayConflict> resolveConflict(
    ReplayScope scope,
    String commandId,
  ) async {
    final snapshot = await _journal.load();
    final matches = snapshot.entries.where(
      (entry) => entry.command.commandId == commandId,
    );
    if (matches.isEmpty) {
      throw const AppException(
        category: AppErrorCategory.storage,
        code: 'COMMAND_NOT_FOUND',
        recoverable: false,
      );
    }
    final entry = matches.single;
    if (entry.command.hubOwned != true) {
      return _delegate.resolveConflict(scope, commandId);
    }
    final result = await _hub.resolveConflict(entry.command);
    return ResolvedReplayConflict(
      resolved: result.resolved,
      commandId: commandId,
      deviceSequence: entry.command.deviceSequence,
      nextAcceptedSequence: snapshot.lastAcknowledgedSequence,
    );
  }

  @override
  Future<BeginReplayResponse> begin(ReplayScope scope) =>
      _delegate.begin(scope);

  @override
  Future<OfflinePolicy> policy(ReplayScope scope) => _delegate.policy(scope);

  @override
  Future<ReplayCursor> cursor(ReplayScope scope) => _delegate.cursor(scope);

  @override
  Future<ReplayBatchResult> submit(ReplayScope scope, ReplayBatch batch) =>
      _delegate.submit(scope, batch);

  @override
  Future<ReplayResult?> resultFor(ReplayScope scope, String commandId) =>
      _delegate.resultFor(scope, commandId);

  @override
  Future<ConflictSummary> conflicts(ReplayScope scope) =>
      _delegate.conflicts(scope);

  @override
  Future<ReconciliationSummary> reconcile(
    ReplayScope scope,
    ReconcileRequest request,
  ) => _delegate.reconcile(scope, request);

  @override
  Future<void> acknowledge(ReplayScope scope, String reconciliationId) =>
      _delegate.acknowledge(scope, reconciliationId);

  @override
  Future<SafeReplayDiagnostic> diagnostics(ReplayScope scope) =>
      _delegate.diagnostics(scope);
}

/// Delivers peer-owned journal entries to the main station in sequence order.
///
/// The peer journal stays the first durable copy. A queued receipt proves the
/// hub now has its own durable copy. The peer closes its entry only after the
/// hub reports the cloud result.
final class HubCommandForwarder extends ChangeNotifier {
  HubCommandForwarder({
    required EncryptedOfflineJournal journal,
    required HubCommandGateway gateway,
    this.interval = const Duration(seconds: 2),
  }) : _journal = journal,
       _gateway = gateway;

  final EncryptedOfflineJournal _journal;
  final HubCommandGateway _gateway;
  final Duration interval;

  Timer? _timer;
  bool _running = false;
  bool _disposed = false;

  void start() {
    if (_disposed) return;
    _timer ??= Timer.periodic(interval, (_) => unawaited(forwardNow()));
    unawaited(forwardNow());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  Future<void> forwardNow() async {
    if (_running || _disposed) return;
    _running = true;
    try {
      final snapshot = await _journal.load();
      final pending =
          snapshot.entries
              .where(
                (entry) =>
                    entry.status == JournalStatus.pending &&
                    entry.command.hubOwned == true,
              )
              .toList()
            ..sort(
              (left, right) => left.command.deviceSequence.compareTo(
                right.command.deviceSequence,
              ),
            );
      for (final entry in pending) {
        if (_disposed) return;
        try {
          if (entry.hubDeliveryState == null ||
              entry.hubDeliveryState == 'pending') {
            final receipt = await _gateway.submit(entry.command);
            await _journal.recordHubDelivery(
              commandId: entry.command.commandId,
              state: 'queued',
              hubCommandId: receipt.commandId,
              hubDeviceSequence: receipt.deviceSequence,
            );
            notifyListeners();
            continue;
          }
          final status = await _gateway.status(entry.command);
          if (status.status == 'queued' || status.status == 'pending') {
            continue;
          }
          if (!status.terminal) {
            throw StateError('hub_status_unknown');
          }
          await _journal.recordHubDelivery(
            commandId: entry.command.commandId,
            state: status.status,
            hubCommandId: entry.hubCommandId ?? entry.command.commandId,
            hubDeviceSequence:
                status.deviceSequence ??
                entry.hubDeviceSequence ??
                entry.command.deviceSequence,
            officialId: status.officialId,
            officialCommit: status.officialCommit,
            failure: status.failure,
            errorCode: status.errorCode,
          );
          notifyListeners();
        } on AppException catch (error) {
          if (error.code == 'RESOURCE_NOT_FOUND' &&
              entry.hubDeliveryState != null) {
            await _journal.clearHubDelivery(entry.command.commandId);
            notifyListeners();
            continue;
          }
          return;
        }
      }
    } catch (_) {
      // Keep the local entry and try again. A transport failure says nothing
      // about the hub copy, and the stable command ID makes retry safe.
    } finally {
      _running = false;
    }
  }

  @override
  void dispose() {
    _disposed = true;
    stop();
    super.dispose();
  }
}
