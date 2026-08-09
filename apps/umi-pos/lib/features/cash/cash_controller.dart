import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import 'cash_recovery_store.dart';
import 'cash_repository.dart';

final class CashState {
  const CashState({
    this.busy = false,
    this.snapshot,
    this.errorCode,
    this.count,
    this.resolution,
    this.reconciliation,
    this.closeResult,
  });

  final bool busy;
  final CashCenterSnapshot? snapshot;
  final String? errorCode;
  final CashCountSummary? count;
  final CashVarianceResolution? resolution;
  final ShiftReconciliation? reconciliation;
  final ShiftCloseResult? closeResult;
}

final class CommittedCashHardwareAction {
  const CommittedCashHardwareAction({
    required this.reason,
    required this.reference,
    required this.registerId,
  });

  final String reason;
  final String reference;
  final String? registerId;
}

final class CashController extends ChangeNotifier {
  CashController({
    required CashRepository repository,
    CashRecoveryStore? recoveryStore,
    Future<void> Function(CommittedCashHardwareAction action)? afterCommit,
  }) : _repository = repository,
       _recoveryStore = recoveryStore ?? MemoryCashRecoveryStore(),
       _afterCommit = afterCommit;

  final CashRepository _repository;
  final CashRecoveryStore _recoveryStore;
  final Future<void> Function(CommittedCashHardwareAction action)? _afterCommit;
  CashState _state = const CashState();
  CashState get state => _state;
  String? _merchantId;
  String? _locationId;
  String? _operatorSessionId;

  String? get activeShiftId {
    final snapshot = _state.snapshot;
    final shift = snapshot?.currentShift;
    if (shift == null ||
        shift['status'] != 'open' ||
        shift['operatorSessionId'] != _operatorSessionId ||
        snapshot!.recoveryState != 'none') {
      return null;
    }
    return shift['id'] as String?;
  }

  String? get activeRegisterId {
    final shift = _state.snapshot?.currentShift;
    return shift?['status'] == 'open' ? shift!['registerId'] as String? : null;
  }

  void setContext({
    required String merchantId,
    required String locationId,
    required String operatorSessionId,
  }) {
    if (_merchantId == merchantId &&
        _locationId == locationId &&
        _operatorSessionId == operatorSessionId) {
      return;
    }
    _merchantId = merchantId;
    _locationId = locationId;
    _operatorSessionId = operatorSessionId;
    _state = const CashState();
  }

  void clear() {
    _merchantId = null;
    _locationId = null;
    _operatorSessionId = null;
    _set(const CashState());
  }

  Future<void> load() async {
    if (!_hasContext || _state.busy) return;
    _set(CashState(busy: true, snapshot: _state.snapshot));
    try {
      final recoveryCode = await _recoverPendingCommand();
      final snapshot = await _repository.center(
        _merchantId!,
        CashCenterQuery(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
        ),
      );
      final restored = _restore(snapshot);
      _set(
        CashState(
          snapshot: restored.snapshot,
          count: restored.count,
          resolution: restored.resolution,
          reconciliation: restored.reconciliation,
          errorCode: recoveryCode,
        ),
      );
    } on AppException catch (error) {
      _set(CashState(snapshot: _state.snapshot, errorCode: error.code));
    }
  }

  Future<void> openShift({
    required String registerId,
    required int amountMinorUnits,
    List<Map<String, Object?>> denominations = const [],
    String? note,
  }) async {
    final snapshot = _requireSnapshot();
    final register = snapshot.registers.firstWhere(
      (item) => item['id'] == registerId,
    );
    await _perform(() async {
      final ids = await _commandIds(
        'open_shift',
        hardwareReason: 'register_open',
        registerId: registerId,
      );
      await _repository.open(
        _merchantId!,
        OpenCashShiftRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          commandId: ids.commandId,
          idempotencyKey: ids.idempotencyKey,
          registerId: registerId,
          openingFloat: {
            'minorUnits': amountMinorUnits,
            'currency': register['currency']! as String,
          },
          denominations: denominations,
          businessDate: snapshot.businessDate,
          note: note,
          expectedRegisterVersion: register['version']! as int,
        ),
      );
      await _completeCommand(ids);
      await _reload();
      _runPostCommit(
        CommittedCashHardwareAction(
          reason: 'register_open',
          reference: ids.commandId,
          registerId: registerId,
        ),
      );
    });
  }

  Future<void> movement({
    required String type,
    required int amountMinorUnits,
    required String reasonCode,
    String? note,
    String? approvalId,
    String? actionFingerprint,
  }) async {
    final shift = _requireShift();
    await _perform(() async {
      final ids = await _commandIds(
        'cash_movement',
        hardwareReason:
            const {'paid_in', 'paid_out', 'safe_drop'}.contains(type)
            ? type
            : null,
        registerId: shift['registerId'] as String?,
      );
      await _repository.movement(
        _merchantId!,
        shift['id']! as String,
        CashMovementRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          commandId: ids.commandId,
          idempotencyKey: ids.idempotencyKey,
          shiftId: shift['id']! as String,
          type: type,
          amount: {
            'minorUnits': amountMinorUnits,
            'currency': shift['currency']! as String,
          },
          reasonCode: reasonCode,
          note: note,
          approvalId: approvalId,
          actionFingerprint: actionFingerprint,
          expectedShiftVersion: shift['version']! as int,
        ),
      );
      await _completeCommand(ids);
      await _reload();
      if (const {'paid_in', 'paid_out', 'safe_drop'}.contains(type)) {
        _runPostCommit(
          CommittedCashHardwareAction(
            reason: type,
            reference: ids.commandId,
            registerId: shift['registerId'] as String?,
          ),
        );
      }
    });
  }

  bool movementRequiresApproval(int amountMinorUnits) {
    final raw = _state.snapshot?.policy['movementApprovalThreshold'];
    if (raw is! Map<String, Object?>) return true;
    final threshold = raw['minorUnits'];
    return threshold is! int || amountMinorUnits >= threshold;
  }

  Future<({String approvalId, String fingerprint})> approveMovement({
    required String managerPin,
    required String type,
    required int amountMinorUnits,
    required String reasonCode,
    String? note,
  }) async {
    final shift = _requireShift();
    final fingerprint = sha256
        .convert(
          utf8.encode(
            [
              _merchantId!,
              _locationId!,
              shift['id']! as String,
              type,
              amountMinorUnits,
              shift['currency']! as String,
              reasonCode,
              note ?? '',
              shift['version']! as int,
            ].join(':'),
          ),
        )
        .toString();
    final approval = await _repository.approve(
      ManagerApprovalRequest(
        operatorSessionId: _operatorSessionId!,
        managerPin: managerPin,
        permission: 'cash.movement.$type.approve',
        merchantId: _merchantId!,
        locationId: _locationId!,
        commandFingerprint: fingerprint,
      ),
    );
    return (approvalId: approval.elevationId, fingerprint: fingerprint);
  }

  Future<void> suspendOrResume({required bool suspend}) async {
    final shift = _requireShift();
    await _perform(() async {
      final ids = await _commandIds(suspend ? 'suspend_shift' : 'resume_shift');
      await _repository.transition(
        _merchantId!,
        shift['id']! as String,
        ShiftTransitionRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          commandId: ids.commandId,
          idempotencyKey: ids.idempotencyKey,
          shiftId: shift['id']! as String,
          expectedShiftVersion: shift['version']! as int,
          reasonCode: suspend ? 'operator_break' : null,
        ),
        suspend: suspend,
      );
      await _completeCommand(ids);
      await _reload();
    });
  }

  Future<void> handoff(String incomingPin) async {
    final shift = _requireShift();
    await _perform(() async {
      final ids = await _commandIds('handoff_shift');
      await _repository.handoff(
        _merchantId!,
        shift['id']! as String,
        ShiftHandoffRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          commandId: ids.commandId,
          idempotencyKey: ids.idempotencyKey,
          shiftId: shift['id']! as String,
          expectedShiftVersion: shift['version']! as int,
          incomingOperatorPin: incomingPin,
          fingerprint: _fingerprintSeed(shift),
        ),
      );
      await _completeCommand(ids);
      clear();
    });
  }

  Future<void> submitCount({
    required int amountMinorUnits,
    List<Map<String, Object?>> denominations = const [],
    String? note,
  }) async {
    final shift = _requireShift();
    await _perform(() async {
      final ids = await _commandIds('submit_count');
      final count = await _repository.count(
        _merchantId!,
        shift['id']! as String,
        SubmitBlindCountRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          commandId: ids.commandId,
          idempotencyKey: ids.idempotencyKey,
          shiftId: shift['id']! as String,
          countedCash: {
            'minorUnits': amountMinorUnits,
            'currency': shift['currency']! as String,
          },
          denominations: denominations,
          expectedShiftVersion: shift['version']! as int,
          expectedLedgerSequence: shift['ledgerSequence']! as int,
          note: note,
        ),
      );
      await _completeCommand(ids);
      await _reload(count: count, resolution: null, reconciliation: null);
    });
  }

  Future<void> requestRecount({String reasonCode = 'operator_recount'}) async {
    final shift = _requireShift();
    final count = _state.count;
    if (count == null) throw StateError('A prior count is required.');
    await _perform(() async {
      final ids = await _commandIds('request_recount');
      await _repository.recount(
        _merchantId!,
        shift['id']! as String,
        RecountRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          commandId: ids.commandId,
          idempotencyKey: ids.idempotencyKey,
          shiftId: shift['id']! as String,
          priorCountAttemptId: count.count['id']! as String,
          reasonCode: reasonCode,
          expectedShiftVersion: shift['version']! as int,
        ),
      );
      await _completeCommand(ids);
      await _reload(
        count: count,
        resolution: _state.resolution,
        reconciliation: null,
      );
    });
  }

  Future<String> approveVariance(String managerPin) async {
    final count = _state.count;
    final fingerprint = count?.approvalFingerprint;
    if (count == null || fingerprint == null) {
      throw StateError('Variance approval is not available.');
    }
    final approval = await _repository.approve(
      ManagerApprovalRequest(
        operatorSessionId: _operatorSessionId!,
        managerPin: managerPin,
        permission: 'cash.variance.approve',
        merchantId: _merchantId!,
        locationId: _locationId!,
        commandFingerprint: fingerprint,
      ),
    );
    return approval.elevationId;
  }

  Future<void> resolveVariance({
    required String reason,
    String? note,
    String? approvalId,
  }) async {
    final shift = _requireShift();
    final count = _state.count;
    if (count == null) throw StateError('A count is required.');
    await _perform(() async {
      final ids = await _commandIds('resolve_variance');
      final resolution = await _repository.resolve(
        _merchantId!,
        shift['id']! as String,
        ResolveCashVarianceRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          commandId: ids.commandId,
          idempotencyKey: ids.idempotencyKey,
          shiftId: shift['id']! as String,
          countAttemptId: count.count['id']! as String,
          reason: reason,
          note: note,
          approvalId: approvalId,
          approvalFingerprint: count.approvalFingerprint,
          expectedShiftVersion: shift['version']! as int,
        ),
      );
      await _completeCommand(ids);
      await _reload(count: count, resolution: resolution, reconciliation: null);
    });
  }

  Future<void> reconcile() async {
    final shift = _requireShift();
    final count = _state.count;
    if (count == null) throw StateError('A count is required.');
    await _perform(() async {
      final ids = await _commandIds('reconcile_shift');
      final result = await _repository.reconcile(
        _merchantId!,
        shift['id']! as String,
        ReconcileCashShiftRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          commandId: ids.commandId,
          idempotencyKey: ids.idempotencyKey,
          shiftId: shift['id']! as String,
          countAttemptId: count.count['id']! as String,
          resolutionId: _state.resolution?.id,
          expectedShiftVersion: shift['version']! as int,
        ),
      );
      await _completeCommand(ids);
      await _reload(
        count: count,
        resolution: _state.resolution,
        reconciliation: result,
      );
    });
  }

  Future<void> closeShift() async {
    await closeShiftWithApproval();
  }

  Future<String> approveClose(String managerPin) async {
    final fingerprint = _state.reconciliation?.closeApprovalFingerprint;
    if (fingerprint == null) {
      throw StateError('Close approval is not available.');
    }
    final approval = await _repository.approve(
      ManagerApprovalRequest(
        operatorSessionId: _operatorSessionId!,
        managerPin: managerPin,
        permission: 'cash.shift.close.approve',
        merchantId: _merchantId!,
        locationId: _locationId!,
        commandFingerprint: fingerprint,
      ),
    );
    return approval.elevationId;
  }

  Future<void> closeShiftWithApproval({String? approvalId}) async {
    final shift = _requireShift();
    final count = _state.count;
    final reconciliation = _state.reconciliation;
    if (count == null || reconciliation == null) {
      throw StateError('Reconciliation is required.');
    }
    await _perform(() async {
      final ids = await _commandIds('close_shift');
      final result = await _repository.close(
        _merchantId!,
        shift['id']! as String,
        ShiftCloseRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          commandId: ids.commandId,
          idempotencyKey: ids.idempotencyKey,
          shiftId: shift['id']! as String,
          countAttemptId: count.count['id']! as String,
          reconciliationId: reconciliation.id,
          approvalId: approvalId,
          approvalFingerprint: reconciliation.closeApprovalFingerprint,
          expectedShiftVersion: shift['version']! as int,
        ),
      );
      await _completeCommand(ids);
      final snapshot = await _repository.center(
        _merchantId!,
        CashCenterQuery(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
        ),
      );
      _set(CashState(snapshot: snapshot, closeResult: result));
    });
  }

  Future<({String approvalId, String fingerprint})> approveNoSale({
    required String managerPin,
    required String reasonCode,
  }) async {
    final shift = _requireShift();
    final fingerprint = sha256
        .convert(
          utf8.encode(
            [
              _merchantId!,
              _locationId!,
              shift['id']! as String,
              reasonCode,
              shift['responsibleOperatorId']! as String,
              shift['deviceId']! as String,
            ].join(':'),
          ),
        )
        .toString();
    final approval = await _repository.approve(
      ManagerApprovalRequest(
        operatorSessionId: _operatorSessionId!,
        managerPin: managerPin,
        permission: 'cash.drawer.no_sale.approve',
        merchantId: _merchantId!,
        locationId: _locationId!,
        commandFingerprint: fingerprint,
      ),
    );
    return (approvalId: approval.elevationId, fingerprint: fingerprint);
  }

  Future<void> requestNoSale(
    String reasonCode, {
    required String approvalId,
    required String approvalFingerprint,
  }) async {
    final shift = _requireShift();
    await _perform(() async {
      final ids = await _commandIds(
        'no_sale_drawer',
        hardwareReason: 'no_sale',
        registerId: shift['registerId'] as String?,
      );
      await _repository.noSale(
        _merchantId!,
        shift['id']! as String,
        NoSaleDrawerRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          commandId: ids.commandId,
          idempotencyKey: ids.idempotencyKey,
          shiftId: shift['id']! as String,
          reasonCode: reasonCode,
          approvalId: approvalId,
          approvalFingerprint: approvalFingerprint,
        ),
      );
      await _completeCommand(ids);
      await _reload();
      _runPostCommit(
        CommittedCashHardwareAction(
          reason: 'no_sale',
          reference: ids.commandId,
          registerId: shift['registerId'] as String?,
        ),
      );
    });
  }

  bool get _hasContext =>
      _merchantId != null && _locationId != null && _operatorSessionId != null;

  CashCenterSnapshot _requireSnapshot() {
    final snapshot = _state.snapshot;
    if (snapshot == null) throw StateError('Cash Center is not loaded.');
    return snapshot;
  }

  Map<String, Object?> _requireShift() {
    final shift = _requireSnapshot().currentShift;
    if (shift == null) throw StateError('An active cash shift is required.');
    return shift;
  }

  Future<void> _reload({
    CashCountSummary? count,
    CashVarianceResolution? resolution,
    ShiftReconciliation? reconciliation,
  }) async {
    final snapshot = await _repository.center(
      _merchantId!,
      CashCenterQuery(
        locationId: _locationId!,
        operatorSessionId: _operatorSessionId!,
      ),
    );
    final restoredCount =
        count ??
        (snapshot.latestCount == null
            ? null
            : CashCountSummary.fromJson(snapshot.latestCount!));
    final restoredResolution =
        resolution ??
        (snapshot.varianceResolution == null
            ? null
            : CashVarianceResolution.fromJson(snapshot.varianceResolution!));
    final restoredReconciliation =
        reconciliation ??
        (snapshot.reconciliation == null
            ? null
            : ShiftReconciliation.fromJson(snapshot.reconciliation!));
    _set(
      CashState(
        snapshot: snapshot,
        count: restoredCount,
        resolution: restoredResolution,
        reconciliation: restoredReconciliation,
      ),
    );
  }

  CashState _restore(CashCenterSnapshot snapshot) => CashState(
    snapshot: snapshot,
    count: snapshot.latestCount == null
        ? null
        : CashCountSummary.fromJson(snapshot.latestCount!),
    resolution: snapshot.varianceResolution == null
        ? null
        : CashVarianceResolution.fromJson(snapshot.varianceResolution!),
    reconciliation: snapshot.reconciliation == null
        ? null
        : ShiftReconciliation.fromJson(snapshot.reconciliation!),
  );

  Future<void> _perform(Future<void> Function() operation) async {
    if (_state.busy) return;
    final before = _state;
    _set(
      CashState(
        busy: true,
        snapshot: before.snapshot,
        count: before.count,
        resolution: before.resolution,
        reconciliation: before.reconciliation,
      ),
    );
    try {
      await operation();
    } on AppException catch (error) {
      _set(
        CashState(
          snapshot: before.snapshot,
          count: before.count,
          resolution: before.resolution,
          reconciliation: before.reconciliation,
          errorCode: error.code,
        ),
      );
    }
  }

  Future<PendingCashCommand> _commandIds(
    String operation, {
    String? hardwareReason,
    String? registerId,
  }) async {
    final merchantId = _merchantId!;
    final locationId = _locationId!;
    final pending = await _recoveryStore.load(merchantId, locationId);
    if (pending != null) {
      final result = await _repository.commandRecovery(
        merchantId,
        CashCommandRecoveryQuery(
          locationId: locationId,
          operatorSessionId: _operatorSessionId!,
          commandId: pending.commandId,
          idempotencyKey: pending.idempotencyKey,
        ),
      );
      if (result.status == 'succeeded') {
        await _recoveryStore.clear(merchantId, locationId);
        throw const AppException(
          category: AppErrorCategory.conflict,
          code: 'CASH_COMMAND_RECOVERED',
          recoverable: false,
        );
      }
      if (result.status == 'processing') {
        throw AppException(
          category: AppErrorCategory.conflict,
          code: 'CASH_COMMAND_PENDING',
          recoverable: true,
          correlationId: result.correlationId,
        );
      }
      if (result.status == 'failed' && !result.retryable) {
        await _recoveryStore.clear(merchantId, locationId);
        throw AppException(
          category: AppErrorCategory.conflict,
          code: result.failureCode ?? 'CASH_OPERATION_CONFLICT',
          recoverable: false,
          correlationId: result.correlationId,
        );
      }
      if (pending.operation != operation) {
        throw const AppException(
          category: AppErrorCategory.conflict,
          code: 'CASH_RECOVERY_ACTION_REQUIRED',
          recoverable: true,
        );
      }
      return pending;
    }
    final command = PendingCashCommand(
      merchantId: merchantId,
      locationId: locationId,
      operation: operation,
      commandId: _uuid(),
      idempotencyKey: _uuid(),
      hardwareReason: hardwareReason,
      registerId: registerId,
    );
    await _recoveryStore.save(command);
    return command;
  }

  Future<void> _completeCommand(PendingCashCommand command) =>
      _recoveryStore.clear(command.merchantId, command.locationId);

  void _runPostCommit(CommittedCashHardwareAction action) {
    final callback = _afterCommit;
    if (callback == null) return;
    unawaited(callback(action).catchError((Object _) {}));
  }

  Future<String?> _recoverPendingCommand() async {
    final pending = await _recoveryStore.load(_merchantId!, _locationId!);
    if (pending == null) return null;
    final result = await _repository.commandRecovery(
      _merchantId!,
      CashCommandRecoveryQuery(
        locationId: _locationId!,
        operatorSessionId: _operatorSessionId!,
        commandId: pending.commandId,
        idempotencyKey: pending.idempotencyKey,
      ),
    );
    if (result.status == 'succeeded') {
      await _completeCommand(pending);
      if (pending.hardwareReason != null) {
        _runPostCommit(
          CommittedCashHardwareAction(
            reason: pending.hardwareReason!,
            reference: pending.commandId,
            registerId: pending.registerId,
          ),
        );
      }
      return 'CASH_COMMAND_RECOVERED';
    }
    if (result.status == 'processing') return 'CASH_COMMAND_PENDING';
    if (result.status == 'failed' && !result.retryable) {
      await _completeCommand(pending);
      return result.failureCode ?? 'CASH_OPERATION_CONFLICT';
    }
    return 'CASH_COMMAND_RETRY_REQUIRED';
  }

  String _uuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  String _fingerprintSeed(Map<String, Object?> shift) {
    final value = shift['id']! as String;
    final seed = value.codeUnits.fold<int>(0, (total, item) => total ^ item);
    return List<String>.filled(
      64,
      seed.toRadixString(16).padLeft(2, '0').substring(0, 2),
    ).join();
  }

  void _set(CashState next) {
    _state = next;
    notifyListeners();
  }
}
