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
    this.drawerUnanswered = false,
  });

  final bool busy;
  final CashCenterSnapshot? snapshot;
  final String? errorCode;
  final CashCountSummary? count;
  final CashVarianceResolution? resolution;
  final ShiftReconciliation? reconciliation;
  final ShiftCloseResult? closeResult;

  /// The last committed command asked the hardware to open the drawer, and the
  /// hardware did not answer. The money is recorded — a drawer failure never
  /// changes a financial fact — but somebody has to open the drawer by hand, and
  /// the till is the only thing that knows it.
  final bool drawerUnanswered;
}

/// What came of asking the till to take its own paused shift back.
///
/// Either the shift is open again and [shiftId] names it, or the server
/// refused and [errorCode] says why. The refusals are different facts — a PIN
/// that matched nothing, a PIN that is locked, a rate limit — and the operator
/// is entitled to tell them apart, so they travel as the code the API sent.
final class ShiftResumeOutcome {
  const ShiftResumeOutcome.resumed(this.shiftId) : errorCode = null;
  const ShiftResumeOutcome.refused(this.errorCode) : shiftId = null;

  final String? shiftId;
  final String? errorCode;

  bool get ok => shiftId != null;
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
    OpenShiftCache? openShiftCache,
    Future<bool> Function(CommittedCashHardwareAction action)? afterCommit,
  }) : _repository = repository,
       _recoveryStore = recoveryStore ?? MemoryCashRecoveryStore(),
       _openShiftCache = openShiftCache ?? MemoryOpenShiftCache(),
       _afterCommit = afterCommit;

  final CashRepository _repository;
  final CashRecoveryStore _recoveryStore;
  final OpenShiftCache _openShiftCache;

  /// The shift this till saw open when it last had an answer, used only while
  /// the till has no snapshot at all (a cold start with no uplink).
  String? _rememberedShiftId;

  /// Runs the hardware a committed command asks for, and answers whether the
  /// hardware took it. The controller does not know what a drawer is; it knows
  /// that something the operator asked for either happened or did not.
  final Future<bool> Function(CommittedCashHardwareAction action)? _afterCommit;
  CashState _state = const CashState();
  CashState get state => _state;

  /// When the server last answered this screen with a snapshot.
  ///
  /// The drawer's figures are a reading, not a live feed: the till asks, the
  /// answer is a moment old, and the operator may be looking at a number that
  /// predates the cash somebody else just put in the drawer. The screen says the
  /// moment, so "is this current?" is answerable without pressing refresh to find
  /// out. Null before the first answer.
  DateTime? _lastReadAt;
  DateTime? get lastReadAt => _lastReadAt;
  String? _merchantId;
  String? _locationId;
  String? _operatorSessionId;

  String? get activeShiftId {
    final snapshot = _state.snapshot;
    final shift = snapshot?.currentShift;
    if (shift == null) return _rememberedShiftId;
    if (shift['status'] != 'open' ||
        shift['operatorSessionId'] != _operatorSessionId ||
        snapshot!.recoveryState != 'none') {
      return null;
    }
    return shift['id'] as String?;
  }

  /// True when this till's own shift is paused and one PIN brings it back.
  ///
  /// A paused shift is not the restart case: the session still matches, the
  /// register is still held by this device, and the server offers `resume`. It
  /// is the moment the till sat unattended, so the till asks who is taking it
  /// back instead of resuming on its own.
  bool get canResumePausedShift {
    final snapshot = _state.snapshot;
    if (snapshot == null || snapshot.recoveryState != 'shift_suspended') {
      return false;
    }
    final shift = snapshot.currentShift;
    if (shift == null || shift['status'] != 'suspended') return false;
    if (shift['registerId'] == null) return false;
    if (!snapshot.allowedActions.contains('resume')) return false;
    for (final register in snapshot.registers) {
      if (register['id'] != shift['registerId']) continue;
      final hold = register['hold'];
      return hold is Map<String, Object?> &&
          hold['state'] == 'held_by_this_device';
    }
    return false;
  }

  String? get activeRegisterId {
    final shift = _state.snapshot?.currentShift;
    return shift?['status'] == 'open' ? shift!['registerId'] as String? : null;
  }

  /// The register this till is standing at, with the hold the server resolved.
  /// The hold is the only thing that can say whether a drawer the till cannot
  /// open is its own to resume, an orphaned one to reclaim, or a live terminal's
  /// that needs a manager to count it out.
  Map<String, Object?>? get activeRegister {
    final snapshot = _state.snapshot;
    final registerId = activeRegisterId;
    if (snapshot == null || registerId == null) return null;
    for (final register in snapshot.registers) {
      if (register['id'] == registerId) return register;
    }
    return null;
  }

  /// The hold state (`free | held_by_this_device | held_by_active_till |
  /// held_by_orphaned_till`) for the register the till is standing at.
  String? get activeRegisterHoldState {
    final hold = activeRegister?['hold'];
    return hold is Map<String, Object?> ? hold['state'] as String? : null;
  }

  /// Registers this till is offered whose holding terminal is gone for good, so
  /// the drawer can be reclaimed without a count (`POST .../reclaim`).
  List<Map<String, Object?>> get reclaimableRegisters {
    final snapshot = _state.snapshot;
    if (snapshot == null) return const [];
    return snapshot.registers.where((register) {
      final hold = register['hold'];
      return hold is Map<String, Object?> &&
          hold['state'] == 'held_by_orphaned_till' &&
          hold['reclaimable'] == true;
    }).toList();
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
    unawaited(_hydrateRememberedShift());
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
      var recoveryCode = await _recoverPendingCommand();
      var snapshot = await _center();
      // THE RESTART PATH.
      //
      // Every app start mints a new operator session (crash, update, power
      // cycle, handover) while the shift this very device opened keeps its old
      // `operator_session_id`. The server reads that back as
      // `recoveryState == 'operator_mismatch'` and a register hold of
      // `held_by_this_device`: the drawer is still ours and no money moved, so
      // the till takes its own shift back here instead of leaving the operator
      // to retype nothing and hit CASH_SHIFT_REQUIRED on the charge. A drawer
      // held by a *different* live terminal is never touched by this: that stays
      // held_by_active_till, which the server keeps behind the manager path.
      if (_shouldResumeOwnShift(snapshot)) {
        try {
          await _resumeOwnShift(snapshot.currentShift!);
          snapshot = await _center();
        } on AppException catch (error) {
          // A resume that the server refuses (a role without cash.shift.resume,
          // or a shift that moved) must not take the catalog down with it. The
          // mismatch snapshot is kept, and the Caja screen still offers the
          // explicit resume action.
          //
          // SAY WHY, THOUGH. This catch used to swallow the refusal whole, so the
          // one code that explains the dead button — `CASH_RECOVERY_ACTION_REQUIRED`,
          // i.e. a cash movement of this terminal is still unresolved — never
          // reached a screen and the operator pressed the same button again.
          recoveryCode ??= error.code;
        } catch (_) {
          // Anything else is a client fault on a path that must not take the
          // screen down either; the mismatch snapshot is still useful.
        }
      }
      final restored = _restore(snapshot);
      _lastReadAt = DateTime.now();
      _set(
        CashState(
          snapshot: restored.snapshot,
          count: restored.count,
          resolution: restored.resolution,
          reconciliation: restored.reconciliation,
          errorCode: recoveryCode,
        ),
      );
      await _rememberShift(restored.snapshot);
    } on AppException catch (error) {
      final offline =
          error.category == AppErrorCategory.transport ||
          error.category == AppErrorCategory.timeout ||
          error.category == AppErrorCategory.server;
      if (offline && _state.snapshot == null) {
        await _hydrateRememberedShift();
        _set(const CashState());
        return;
      }
      _set(CashState(snapshot: _state.snapshot, errorCode: error.code));
    } catch (_) {
      // A load can fail for a reason the API did not describe: a socket that
      // closed, a payload the parser refused, a bug in this file. Catching only
      // `AppException` left `busy` true forever, so the screen showed a spinner
      // with no message and no way out — the plan's §4 bar says every failure
      // shows a typed message with a recovery action, and a spinner that never
      // resolves is that sentence in the negative. Found by driving the real app
      // against a failing API (defect D26).
      _set(
        CashState(snapshot: _state.snapshot, errorCode: unexpectedFailureCode),
      );
    }
  }

  /// The code used when the load failed for a reason the API did not name.
  ///
  /// Deliberately not an `AppException.code`: nothing in the contract describes
  /// this, and pretending a server code would make the operator's message lie.
  static const String unexpectedFailureCode = 'CASH_CENTER_UNAVAILABLE';

  /// Keep the open shift this answer named, so the next cold start can belong
  /// to it. A closed or foreign shift clears it: only this operator's own open
  /// drawer is worth remembering.
  Future<void> _rememberShift(CashCenterSnapshot? snapshot) async {
    final merchantId = _merchantId;
    final locationId = _locationId;
    final operatorSessionId = _operatorSessionId;
    if (merchantId == null || locationId == null || operatorSessionId == null) {
      return;
    }
    final shiftId = activeShiftId;
    try {
      if (shiftId == null) {
        _rememberedShiftId = null;
        await _openShiftCache.clear(merchantId, locationId);
        return;
      }
      _rememberedShiftId = shiftId;
      await _openShiftCache.save(
        OpenShiftSnapshot(
          shiftId: shiftId,
          merchantId: merchantId,
          locationId: locationId,
          operatorSessionId: operatorSessionId,
        ),
      );
    } catch (_) {
      // Remembering is an optimisation; never fail the screen for it.
    }
  }

  Future<void> _hydrateRememberedShift() async {
    final merchantId = _merchantId;
    final locationId = _locationId;
    final operatorSessionId = _operatorSessionId;
    if (merchantId == null || locationId == null || operatorSessionId == null) {
      return;
    }
    try {
      final cached = await _openShiftCache.load(merchantId, locationId);
      if (cached == null) return;
      // A shift belongs to the operator session that opened it. A different
      // operator on this till must not inherit somebody else's drawer id.
      if (cached.operatorSessionId != operatorSessionId) return;
      _rememberedShiftId = cached.shiftId;
    } catch (_) {
      _rememberedShiftId = null;
    }
  }

  /// Take this till's own shift back so it can charge again, without a human
  /// retyping anything. Returns the shift id in force afterwards, or null when
  /// there is nothing of ours to resume (a live terminal's drawer, or no drawer
  /// at all — those need the reclaim or open-shift paths instead).
  Future<String?> recoverOwnShift() async {
    if (!_hasContext) return null;
    final snapshot = _state.snapshot;
    if (snapshot == null) {
      await load();
      return activeShiftId;
    }
    if (_state.busy || !_shouldResumeOwnShift(snapshot)) return activeShiftId;
    await _perform(() async {
      await _resumeOwnShift(snapshot.currentShift!);
      await _reload();
    });
    return activeShiftId;
  }

  /// Bring this till's paused shift back, once the operator has said who they
  /// are.
  ///
  /// The server authorizes a resume from the operator session, so the PIN is
  /// not what makes the write legal — it is the till asking the person who
  /// takes the drawer back to prove it is them, and the server checks that
  /// against the operator enrolled on this device. A refusal throws before
  /// anything is resumed, so a wrong PIN leaves the shift exactly as it was.
  Future<ShiftResumeOutcome> resumePausedShiftWithPin({
    required String pin,
  }) async {
    if (!_hasContext) return const ShiftResumeOutcome.refused(null);
    final snapshot = _state.snapshot;
    final shift = snapshot?.currentShift;
    if (snapshot == null || shift == null || !canResumePausedShift) {
      return ShiftResumeOutcome.refused(_state.errorCode);
    }
    await _repository.verifyOperatorPin(
      VerifyOperatorPinRequest(
        pin: pin,
        permission: 'cash.shift.resume',
        merchantId: _merchantId!,
        locationId: _locationId!,
      ),
    );
    await _perform(() async {
      await _resumeOwnShift(shift, reasonCode: 'operator_resumed_break');
      await _reload();
    });
    final errorCode = _state.errorCode;
    if (errorCode != null) return ShiftResumeOutcome.refused(errorCode);
    return activeShiftId == null
        ? const ShiftResumeOutcome.refused('CASH_OPERATION_FAILED')
        : ShiftResumeOutcome.resumed(activeShiftId!);
  }

  /// Free a register whose holding terminal is never coming back. The server
  /// proves the terminal is gone; the client only names the register it can see.
  Future<void> reclaimRegister(String registerId) async {
    final snapshot = _requireSnapshot();
    final register = snapshot.registers.firstWhere(
      (item) => item['id'] == registerId,
    );
    await _perform(() async {
      final ids = await _commandIds('reclaim_register', registerId: registerId);
      await _repository.reclaimRegister(
        _merchantId!,
        registerId,
        ReclaimCashRegisterRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          commandId: ids.commandId,
          idempotencyKey: ids.idempotencyKey,
          registerId: registerId,
          expectedRegisterVersion: register['version']! as int,
          reasonCode: 'holding_terminal_gone',
        ),
      );
      await _completeCommand(ids);
      await _reload();
    });
  }

  /// True when the register hold is this device's own and the only thing wrong
  /// is that the shift points at an operator session that is gone.
  bool _shouldResumeOwnShift(CashCenterSnapshot snapshot) {
    if (snapshot.recoveryState != 'operator_mismatch') return false;
    if (!snapshot.allowedActions.contains('resume')) return false;
    final shift = snapshot.currentShift;
    if (shift == null || shift['status'] != 'open') return false;
    if (shift['registerId'] == null) return false;
    for (final register in snapshot.registers) {
      if (register['id'] != shift['registerId']) continue;
      final hold = register['hold'];
      return hold is Map<String, Object?> &&
          hold['state'] == 'held_by_this_device';
    }
    return false;
  }

  Future<CashCenterSnapshot> _center() => _repository.center(
    _merchantId!,
    CashCenterQuery(
      locationId: _locationId!,
      operatorSessionId: _operatorSessionId!,
    ),
  );

  /// `resume` (not `adopt`) is the operation that fits a shift held by THIS
  /// device: `adopt` refuses a shift whose `holding_device_id` is already this
  /// terminal (`SHIFT_ALREADY_HELD`), and only `resume` rewrites the shift's
  /// `operator_session_id` onto the live session. Same operator, same drawer,
  /// nothing about the money changes.
  /// Take back the drawer the SERVER named, by id.
  ///
  /// `recoverOwnShift` decides from the cash snapshot's idea of "the current
  /// shift", and that idea is refreshed on load — which means a till that read the
  /// cash centre before the drawer came back to it (an app update, a reinstall, a
  /// session that moved on) presses a resume button against a stale snapshot and
  /// nothing happens. The refusal already carries the shift it refused over, so the
  /// recovery names that id instead of asking the till to guess.
  ///
  /// Returns the shift id in force afterwards, or null when the server refused.
  Future<String?> resumeShiftById(String shiftId) async {
    if (!_hasContext) return null;
    // Read first: the load path already resumes a shift this terminal holds and
    // whose session moved on, so the common case of an app update ends here.
    await load();
    if (activeShiftId != null) {
      return activeShiftId;
    }
    final current = _state.snapshot?.currentShift;
    // A version is not guessed. If the server did not name this shift as the one
    // this terminal holds, there is nothing here to resume, and sending a made-up
    // version would be a write the operator did not authorise.
    if (current == null || current['id'] != shiftId) {
      debugPrint(
        '[umipos] resume $shiftId: the cash snapshot names '
        '${current?['id'] ?? 'no shift'} — nothing of ours to resume',
      );
      return null;
    }
    // `bigint` reaches Dart as a String through some paths (the contract types it
    // as a number and node-postgres hands it back as text), so a String that
    // parses is a version, not a reason to give up.
    final rawVersion = current['version'];
    final version = rawVersion is int
        ? rawVersion
        : rawVersion is String
        ? int.tryParse(rawVersion)
        : null;
    if (version == null) {
      debugPrint('[umipos] resume $shiftId: version is ${rawVersion.runtimeType}');
      return null;
    }
    debugPrint('[umipos] resume $shiftId at version $version');
    await _perform(() async {
      final ids = await _commandIds('resume_shift');
      await _repository.transition(
        _merchantId!,
        shiftId,
        ShiftTransitionRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          commandId: ids.commandId,
          idempotencyKey: ids.idempotencyKey,
          shiftId: shiftId,
          expectedShiftVersion: version,
          reasonCode: 'operator_session_replaced',
        ),
        suspend: false,
      );
      await _completeCommand(ids);
      await _reload();
    });
    if (_state.errorCode != null) return null;
    return activeShiftId ?? shiftId;
  }

  Future<void> _resumeOwnShift(
    Map<String, Object?> shift, {
    String reasonCode = 'operator_session_replaced',
  }) async {
    final ids = await _commandIds('resume_shift');
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
        reasonCode: reasonCode,
      ),
      suspend: false,
    );
    await _completeCommand(ids);
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

  /// Take back a shift this operator already owns, from a terminal that can no
  /// longer speak for it. On web that terminal is usually this same browser before
  /// its stored identity was cleared, which mints a new device out of one register.
  Future<void> adoptShift() async {
    final shift = _requireSnapshot().adoptableShift;
    if (shift == null) return;
    await _perform(() async {
      final ids = await _commandIds('adopt_shift');
      await _repository.adopt(
        _merchantId!,
        shift['id']! as String,
        AdoptCashShiftRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          commandId: ids.commandId,
          idempotencyKey: ids.idempotencyKey,
          shiftId: shift['id']! as String,
          expectedShiftVersion: shift['version']! as int,
          reasonCode: 'terminal_identity_changed',
        ),
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

  /// Put the drawer back to open because the count should not have happened.
  ///
  /// The server refuses unless the ledger has stood still since the count and
  /// nobody has recorded a variance reason, so this cannot erase a fact that
  /// money has already moved through. The count stays in the history.
  Future<void> cancelCount({
    String reasonCode = 'count_opened_in_error',
  }) async {
    final shift = _requireShift();
    final count = _state.count;
    if (count == null) throw StateError('A prior count is required.');
    await _perform(() async {
      final ids = await _commandIds('cancel_count');
      await _repository.cancelCount(
        _merchantId!,
        shift['id']! as String,
        CancelCashCountRequest(
          locationId: _locationId!,
          operatorSessionId: _operatorSessionId!,
          commandId: ids.commandId,
          idempotencyKey: ids.idempotencyKey,
          shiftId: shift['id']! as String,
          expectedShiftVersion: shift['version']! as int,
          expectedLedgerSequence: count.count['ledgerSequence']! as int,
          reasonCode: reasonCode,
        ),
      );
      await _completeCommand(ids);
      await _reload();
    });
  }

  /// Ask the manager for the variance, and hand back null when it was REFUSED.
  ///
  /// A null answer is not a missing answer: the refusal is on the screen
  /// (`state.errorCode`, which the cash centre renders as its one notice), and the caller must not
  /// carry on to `resolveVariance` as if the money had been authorised.
  Future<String?> approveVariance(String managerPin) async {
    final count = _state.count;
    final fingerprint = count?.approvalFingerprint;
    if (count == null || fingerprint == null) {
      throw StateError('Variance approval is not available.');
    }
    return _approve(() async {
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
    });
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

  /// The manager's authorisation to close a shift whose count is out of tolerance.
  ///
  /// THIS ONE USED TO LEAVE NOTHING BEHIND WHEN IT WAS REFUSED — see `_approve`, which is the fix:
  /// the request ran outside the controller's guard, so the API's answer reached no one. Measured on
  /// the iMin D3-504 on 2026-10-11: the till posted `"managerPin": ""` and got
  /// `400 VALIDATION_FAILED {"fieldErrors":{"managerPin":["Invalid"]}}`, the dialog was already
  /// gone, the screen looked untouched, and the shift stayed in `closing` — unclosable, with the
  /// only way out being `Reanudar turno`.
  Future<String?> approveClose(String managerPin) async {
    final fingerprint = _state.reconciliation?.closeApprovalFingerprint;
    if (fingerprint == null) {
      throw StateError('Close approval is not available.');
    }
    return _approve(() async {
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
    });
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

  /// The manager's authorisation to open the drawer without a sale, or null when it was refused
  /// (the refusal is on the screen; see `_approve`).
  Future<({String approvalId, String fingerprint})?> approveNoSale({
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
    return _approve(() async {
      final granted = await _repository.approve(
        ManagerApprovalRequest(
          operatorSessionId: _operatorSessionId!,
          managerPin: managerPin,
          permission: 'cash.drawer.no_sale.approve',
          merchantId: _merchantId!,
          locationId: _locationId!,
          commandFingerprint: fingerprint,
        ),
      );
      return (approvalId: granted.elevationId, fingerprint: fingerprint);
    });
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
    _lastReadAt = DateTime.now();
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

  /// One manager approval, INSIDE the controller's guard.
  ///
  /// `_perform` is what turns an `AppException` into `state.errorCode`, and the cash centre renders
  /// that one field as its notice. An approval awaited outside it — as the close, the variance and
  /// the no-sale drawer used to be — leaves nothing behind when the API refuses it: no error, no
  /// notice, and a caller that carries on as if the money had been authorised. Null means REFUSED,
  /// and the caller must stop; the reason is already on the screen.
  Future<T?> _approve<T>(Future<T> Function() request) async {
    T? granted;
    await _perform(() async {
      granted = await request();
      // AN APPROVAL HAS NOTHING TO RELOAD, and `_perform` releases the screen through the operation
      // itself: every other operation ends in `_reload`, which is what clears `busy`. Without this
      // the approval would leave the controller busy, and the step that FOLLOWS it — the drawer
      // request, the variance, the close — would find `_perform` returning at its `busy` guard and
      // quietly do nothing at all.
      _set(
        CashState(
          snapshot: _state.snapshot,
          count: _state.count,
          resolution: _state.resolution,
          reconciliation: _state.reconciliation,
        ),
      );
    });
    return _state.errorCode == null ? granted : null;
  }

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
      debugPrint(
        '[umipos] cash op refused: ${error.code} '
        '(${error.runtimeType}) details=${error.details}',
      );
      _set(
        CashState(
          snapshot: before.snapshot,
          count: before.count,
          resolution: before.resolution,
          reconciliation: before.reconciliation,
          errorCode: error.code,
        ),
      );
    } catch (error, stack) {
      debugPrint(
        '[umipos] cash op blew up BEFORE the server saw it: '
        '${error.runtimeType} $error',
      );
      debugPrint('$stack');
      // ANYTHING ELSE STILL HAS TO RELEASE THE SCREEN.
      //
      // Only `AppException` was caught here, so a decoding slip — a bigint the
      // API sent as a string, a field that arrived null — escaped `_perform`
      // with `busy` still true. The cash screen then sat behind a progress bar
      // for ever, on a shift the server had already changed, and the only way
      // out was reloading the page. A cashier cannot be left there.
      _set(
        CashState(
          snapshot: before.snapshot,
          count: before.count,
          resolution: before.resolution,
          reconciliation: before.reconciliation,
          errorCode: 'CASH_OPERATION_FAILED',
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
      if (result.status == 'not_found') {
        // THE SERVER NEVER SAW THIS COMMAND, AND IT NEVER WILL.
        //
        // A cash command runs inside one transaction: the claim row is written
        // first and the whole thing rolls back on any refusal, so a refused
        // command leaves no row behind. The till only keeps a pending command
        // for an attempt that did not finish on this device, and that attempt is
        // over by the time we ask. So "not found" means it never landed, and the
        // pending record protects no money.
        //
        // Keeping it wedged the whole cash screen: a count the server refused
        // before it recorded anything left the till asking about it on every
        // action, and a resume was refused because that other operation was
        // still "pending". Discard it and hand the caller fresh ids.
        await _recoveryStore.clear(merchantId, locationId);
      } else {
        if (pending.operation != operation) {
          throw const AppException(
            category: AppErrorCategory.conflict,
            code: 'CASH_RECOVERY_ACTION_REQUIRED',
            recoverable: true,
          );
        }
        return pending;
      }
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
    unawaited(
      callback(action).then((answered) {
        // The command is already committed, so this is not an error: it is a
        // fact about the drawer that the operator standing in front of it has
        // no other way to learn. It used to be swallowed on purpose, and the
        // result was a person pressing "abrir cajón", watching nothing happen,
        // and being told nothing.
        if (!answered) _noteDrawerUnanswered();
      }, onError: (Object _) => _noteDrawerUnanswered()),
    );
  }

  void _noteDrawerUnanswered() {
    if (!_hasContext || _state.drawerUnanswered) return;
    _set(
      CashState(
        snapshot: _state.snapshot,
        errorCode: _state.errorCode,
        count: _state.count,
        resolution: _state.resolution,
        reconciliation: _state.reconciliation,
        closeResult: _state.closeResult,
        drawerUnanswered: true,
      ),
    );
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
    if (result.status == 'not_found') {
      // THE SERVER NEVER HEARD OF IT, AND IT NEVER WILL.
      //
      // A cash command runs inside one transaction — the claim row is written
      // first and the whole thing rolls back on any refusal — so a command the
      // server does not have never landed, and the record protects no money. The
      // write path (`_commandIds`) already discards it; this path used to keep it
      // and answer `CASH_COMMAND_RETRY_REQUIRED` on every load, which is how a
      // leftover from an attempt that never left the device came to sit in front
      // of every later action. Measured on the iMin, 2026-10-11: five command ids
      // the till kept asking about, none of them in `merchant.business_command`.
      await _completeCommand(pending);
      return null;
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
