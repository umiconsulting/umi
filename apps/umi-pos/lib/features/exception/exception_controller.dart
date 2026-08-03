import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import 'exception_recovery_store.dart';
import 'exception_repository.dart';

enum SaleExceptionPhase {
  idle,
  loading,
  eligible,
  blocked,
  previewReady,
  approvalRequired,
  terminalRequired,
  committing,
  outcomeUnknown,
  committed,
  recovered,
  failure,
}

final class SaleExceptionState {
  const SaleExceptionState({
    this.phase = SaleExceptionPhase.idle,
    this.saleId,
    this.eligibility,
    this.preview,
    this.approval,
    this.terminalOutcome,
    this.result,
    this.history,
    this.errorCode,
  });

  final SaleExceptionPhase phase;
  final String? saleId;
  final SaleExceptionEligibility? eligibility;
  final RefundPreview? preview;
  final RefundApprovalResult? approval;
  final ManualTerminalRefundOutcomeResult? terminalOutcome;
  final SaleExceptionResult? result;
  final ExceptionHistory? history;
  final String? errorCode;
}

final class SaleExceptionController extends ChangeNotifier {
  SaleExceptionController({
    required SaleExceptionRepository repository,
    required SaleExceptionRecoveryStore recoveryStore,
  }) : _repository = repository,
       _recoveryStore = recoveryStore;

  final SaleExceptionRepository _repository;
  final SaleExceptionRecoveryStore _recoveryStore;
  SaleExceptionState _state = const SaleExceptionState();
  SaleExceptionState get state => _state;
  String? _merchantId;
  String? _locationId;
  String? _operatorSessionId;
  String? _commandId;
  String? _idempotencyKey;
  bool _busy = false;

  Future<void> setContext({
    required String merchantId,
    required String locationId,
    required String operatorSessionId,
  }) async {
    _merchantId = merchantId;
    _locationId = locationId;
    _operatorSessionId = operatorSessionId;
    await recoverPending();
  }

  Future<void> load(String saleId) async {
    if (_busy || _merchantId == null) return;
    _busy = true;
    _set(SaleExceptionState(phase: SaleExceptionPhase.loading, saleId: saleId));
    try {
      final eligibility = await _repository.eligibility(
        _merchantId!,
        saleId,
        SaleExceptionEligibilityQuery(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
        ),
      );
      final history = await _repository.history(
        _merchantId!,
        saleId,
        SaleExceptionEligibilityQuery(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
        ),
      );
      _set(
        SaleExceptionState(
          phase: eligibility.allowedTypes.isEmpty
              ? SaleExceptionPhase.blocked
              : SaleExceptionPhase.eligible,
          saleId: saleId,
          eligibility: eligibility,
          history: history,
        ),
      );
    } on AppException catch (error) {
      _failure(saleId, error.code);
    } finally {
      _busy = false;
    }
  }

  Future<void> createPreview({
    required String exceptionType,
    required String reason,
    required List<Map<String, Object?>> lines,
    String? note,
  }) async {
    final eligibility = _state.eligibility;
    final saleId = _state.saleId;
    if (_busy || eligibility == null || saleId == null) return;
    _busy = true;
    _set(
      SaleExceptionState(
        phase: SaleExceptionPhase.loading,
        saleId: saleId,
        eligibility: eligibility,
        history: _state.history,
      ),
    );
    try {
      final sale = eligibility.sale;
      final preview = await _repository.preview(
        _merchantId!,
        saleId,
        RefundPreviewRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          exceptionType: exceptionType,
          reason: reason,
          note: note?.trim().isEmpty ?? true ? null : note!.trim(),
          lines: lines,
          expectedSaleVersion: sale['version']! as int,
        ),
      );
      _commandId = _uuid();
      _idempotencyKey = _uuid();
      _set(
        SaleExceptionState(
          phase: preview.manualTerminal != null
              ? SaleExceptionPhase.terminalRequired
              : preview.approvalRequired
              ? SaleExceptionPhase.approvalRequired
              : SaleExceptionPhase.previewReady,
          saleId: saleId,
          eligibility: eligibility,
          preview: preview,
          history: _state.history,
        ),
      );
    } on AppException catch (error) {
      _failure(saleId, error.code, eligibility: eligibility);
    } finally {
      _busy = false;
    }
  }

  Future<void> recordTerminalOutcome(String outcome) async {
    final preview = _state.preview;
    final saleId = _state.saleId;
    if (_busy || preview == null || saleId == null) return;
    _busy = true;
    final commandId = _uuid();
    final idempotencyKey = _uuid();
    final pending = PendingSaleException(
      merchantId: _merchantId!,
      locationId: _locationId!,
      operatorSessionId: _operatorSessionId!,
      saleId: saleId,
      commandId: commandId,
      idempotencyKey: idempotencyKey,
      commandType: 'terminal_outcome',
      requestedTerminalOutcome: outcome,
      preview: preview.toJson(),
    );
    await _recoveryStore.save(pending);
    try {
      final terminal = await _repository.terminalOutcome(
        _merchantId!,
        saleId,
        preview.previewId,
        ManualTerminalRefundOutcomeRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          outcome: outcome,
          commandId: commandId,
          idempotencyKey: idempotencyKey,
        ),
      );
      if (outcome == 'operator_reported_failure') {
        await _recoveryStore.clear(_merchantId!, _locationId!);
      }
      _set(
        SaleExceptionState(
          phase: outcome == 'outcome_unknown'
              ? SaleExceptionPhase.outcomeUnknown
              : outcome == 'confirmed_success'
              ? preview.approvalRequired
                    ? SaleExceptionPhase.approvalRequired
                    : SaleExceptionPhase.previewReady
              : SaleExceptionPhase.terminalRequired,
          saleId: saleId,
          eligibility: _state.eligibility,
          preview: preview,
          terminalOutcome: terminal,
          history: _state.history,
        ),
      );
    } on AppException catch (error) {
      await recoverPending(fallbackError: error.code);
    } finally {
      _busy = false;
    }
  }

  Future<void> approve(String managerPin) async {
    final preview = _state.preview;
    final saleId = _state.saleId;
    final commandId = _commandId;
    if (_busy || preview == null || saleId == null || commandId == null) return;
    _busy = true;
    try {
      final fingerprint = sha256
          .convert(
            utf8.encode(
              jsonEncode({
                'commandId': commandId,
                'previewFingerprint': preview.previewFingerprint,
                'previewId': preview.previewId,
                'saleId': saleId,
              }),
            ),
          )
          .toString();
      final approval = await _repository.approve(
        _merchantId!,
        saleId,
        RefundApprovalRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          saleId: saleId,
          previewId: preview.previewId,
          commandId: commandId,
          previewFingerprint: preview.previewFingerprint,
          commandFingerprint: fingerprint,
          managerPin: managerPin,
        ),
      );
      _set(
        SaleExceptionState(
          phase: SaleExceptionPhase.previewReady,
          saleId: saleId,
          eligibility: _state.eligibility,
          preview: preview,
          approval: approval,
          terminalOutcome: _state.terminalOutcome,
          history: _state.history,
        ),
      );
    } on AppException catch (error) {
      _failure(
        saleId,
        error.code,
        eligibility: _state.eligibility,
        preview: preview,
        approval: _state.approval,
        terminalOutcome: _state.terminalOutcome,
        history: _state.history,
      );
    } finally {
      _busy = false;
    }
  }

  Future<void> commit() async {
    final preview = _state.preview;
    final saleId = _state.saleId;
    final commandId = _commandId;
    final idempotencyKey = _idempotencyKey;
    if (_busy ||
        preview == null ||
        saleId == null ||
        commandId == null ||
        idempotencyKey == null) {
      return;
    }
    _busy = true;
    _set(
      SaleExceptionState(
        phase: SaleExceptionPhase.committing,
        saleId: saleId,
        eligibility: _state.eligibility,
        preview: preview,
        approval: _state.approval,
        terminalOutcome: _state.terminalOutcome,
        history: _state.history,
      ),
    );
    final pending = PendingSaleException(
      merchantId: _merchantId!,
      locationId: _locationId!,
      operatorSessionId: _operatorSessionId!,
      saleId: saleId,
      commandId: commandId,
      idempotencyKey: idempotencyKey,
      commandType: 'exception_commit',
      requestedTerminalOutcome: null,
      preview: preview.toJson(),
    );
    await _recoveryStore.save(pending);
    try {
      final saleVersion = preview.saleVersion;
      final result = await _repository.commit(
        _merchantId!,
        saleId,
        SaleExceptionCommand(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          previewId: preview.previewId,
          previewFingerprint: preview.previewFingerprint,
          approvalId: _state.approval?.approvalId,
          expectedSaleVersion: saleVersion,
          commandId: commandId,
          idempotencyKey: idempotencyKey,
          offline: false,
        ),
      );
      await _recoveryStore.clear(_merchantId!, _locationId!);
      _set(
        SaleExceptionState(
          phase: SaleExceptionPhase.committed,
          saleId: saleId,
          eligibility: _state.eligibility,
          preview: preview,
          approval: _state.approval,
          terminalOutcome: _state.terminalOutcome,
          result: result,
          history: _state.history,
        ),
      );
    } on AppException catch (error) {
      await recoverPending(fallbackError: error.code);
    } finally {
      _busy = false;
    }
  }

  Future<void> recoverPending({String? fallbackError}) async {
    if (_merchantId == null) return;
    final pending = await _recoveryStore.load(_merchantId!, _locationId!);
    if (pending == null) return;
    try {
      final recovery = await _repository.recover(
        pending.merchantId,
        ExceptionCommandRecoveryQuery(
          locationId: pending.locationId,
          operatorSessionId: pending.operatorSessionId,
          commandId: pending.commandId,
          idempotencyKey: pending.idempotencyKey,
        ),
      );
      if (recovery.result != null) {
        await _recoveryStore.clear(pending.merchantId, pending.locationId);
        _set(
          SaleExceptionState(
            phase: SaleExceptionPhase.recovered,
            saleId: pending.saleId,
            result: SaleExceptionResult.fromJson(recovery.result!),
          ),
        );
      } else if (recovery.terminalOutcome != null) {
        final preview = RefundPreview.fromJson(pending.preview);
        final terminal = ManualTerminalRefundOutcomeResult.fromJson(
          recovery.terminalOutcome!,
        );
        if (terminal.status == 'operator_reported_failure') {
          await _recoveryStore.clear(pending.merchantId, pending.locationId);
        }
        _commandId = _uuid();
        _idempotencyKey = _uuid();
        _set(
          SaleExceptionState(
            phase: terminal.status == 'outcome_unknown'
                ? SaleExceptionPhase.outcomeUnknown
                : terminal.status == 'confirmed_success'
                ? preview.approvalRequired
                      ? SaleExceptionPhase.approvalRequired
                      : SaleExceptionPhase.previewReady
                : SaleExceptionPhase.terminalRequired,
            saleId: pending.saleId,
            preview: preview,
            terminalOutcome: terminal,
          ),
        );
      } else if (pending.commandType == 'terminal_outcome' &&
          pending.requestedTerminalOutcome != null &&
          recovery.state == 'query_original_command') {
        final preview = RefundPreview.fromJson(pending.preview);
        final terminal = await _repository.terminalOutcome(
          pending.merchantId,
          pending.saleId,
          preview.previewId,
          ManualTerminalRefundOutcomeRequest(
            locationId: pending.locationId,
            operatorSessionId: pending.operatorSessionId,
            outcome: pending.requestedTerminalOutcome!,
            commandId: pending.commandId,
            idempotencyKey: pending.idempotencyKey,
          ),
        );
        if (terminal.status == 'operator_reported_failure') {
          await _recoveryStore.clear(pending.merchantId, pending.locationId);
        }
        _commandId = _uuid();
        _idempotencyKey = _uuid();
        _set(
          SaleExceptionState(
            phase: terminal.status == 'outcome_unknown'
                ? SaleExceptionPhase.outcomeUnknown
                : terminal.status == 'confirmed_success'
                ? preview.approvalRequired
                      ? SaleExceptionPhase.approvalRequired
                      : SaleExceptionPhase.previewReady
                : SaleExceptionPhase.terminalRequired,
            saleId: pending.saleId,
            preview: preview,
            terminalOutcome: terminal,
          ),
        );
      } else {
        _set(
          SaleExceptionState(
            phase: recovery.state == 'outcome_unknown'
                ? SaleExceptionPhase.outcomeUnknown
                : SaleExceptionPhase.failure,
            saleId: pending.saleId,
            errorCode: recovery.state == 'outcome_unknown'
                ? 'PAYMENT_OUTCOME_UNKNOWN'
                : fallbackError ?? 'REFUND_RECOVERY_REQUIRED',
          ),
        );
      }
    } on AppException catch (error) {
      _failure(pending.saleId, fallbackError ?? error.code);
    }
  }

  void clear() {
    _merchantId = null;
    _locationId = null;
    _operatorSessionId = null;
    _commandId = null;
    _idempotencyKey = null;
    _set(const SaleExceptionState());
  }

  void _failure(
    String saleId,
    String code, {
    SaleExceptionEligibility? eligibility,
    RefundPreview? preview,
    RefundApprovalResult? approval,
    ManualTerminalRefundOutcomeResult? terminalOutcome,
    ExceptionHistory? history,
  }) => _set(
    SaleExceptionState(
      phase: SaleExceptionPhase.failure,
      saleId: saleId,
      eligibility: eligibility,
      preview: preview,
      approval: approval,
      terminalOutcome: terminalOutcome,
      history: history,
      errorCode: code,
    ),
  );

  void _set(SaleExceptionState value) {
    _state = value;
    notifyListeners();
  }

  String _uuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
        '${hex.substring(16, 20)}-${hex.substring(20)}';
  }
}
