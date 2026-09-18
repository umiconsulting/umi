import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/features/cash/cash_controller.dart';
import 'package:umi_pos/features/cash/cash_repository.dart';

/// A till that restarted mid-shift: the shift is still open, still held by THIS
/// device, and its `operator_session_id` points at the session that is gone.
/// The server reads that back as `operator_mismatch` and a `held_by_this_device`
/// register hold, which is what the controller has to act on by itself.
CashCenterSnapshot _mismatchSnapshot({
  required String shiftId,
  required String registerId,
  required String holdState,
  required bool reclaimable,
}) => CashCenterSnapshot(
  businessDate: '2026-09-16',
  policy: {
    'version': 'cash-v1',
    'currency': 'MXN',
    'movementApprovalThreshold': {'minorUnits': 5000, 'currency': 'MXN'},
  },
  registers: [
    {
      'id': registerId,
      'displayName': 'Caja 1',
      'publicReference': 'CAJA-1',
      'currency': 'MXN',
      'version': 3,
      'status': 'in_use',
      'hold': {
        'state': holdState,
        'shiftId': shiftId,
        'shiftStatus': 'open',
        'openedAt': '2026-09-16T20:52:56.649669+00:00',
        'deviceId': '00000000-0000-4000-8000-0000000000d1',
        'deviceName': 'Mostrador',
        'deviceStatus': holdState == 'held_by_orphaned_till' ? 'revoked' : 'active',
        'operatorSessionId': '00000000-0000-4000-8000-0000000000e1',
        'reclaimable': reclaimable,
      },
    },
  ],
  adoptableShift: null,
  currentShift: {
    'id': shiftId,
    'registerId': registerId,
    'status': 'open',
    'version': 4,
    'operatorSessionId': '00000000-0000-4000-8000-0000000000e1',
    'currency': 'MXN',
  },
  expectedCash: null,
  latestCount: null,
  varianceResolution: null,
  reconciliation: null,
  recoveryState: 'operator_mismatch',
  allowedActions: const ['resume'],
  summary: null,
);

CashCenterSnapshot _resumedSnapshot({
  required String shiftId,
  required String registerId,
  required String operatorSessionId,
}) => CashCenterSnapshot(
  businessDate: '2026-09-16',
  policy: {
    'version': 'cash-v1',
    'currency': 'MXN',
    'movementApprovalThreshold': {'minorUnits': 5000, 'currency': 'MXN'},
  },
  registers: [
    {
      'id': registerId,
      'displayName': 'Caja 1',
      'publicReference': 'CAJA-1',
      'currency': 'MXN',
      'version': 3,
      'status': 'in_use',
      'hold': {
        'state': 'held_by_this_device',
        'shiftId': shiftId,
        'shiftStatus': 'open',
        'openedAt': '2026-09-16T20:52:56.649669+00:00',
        'deviceId': '00000000-0000-4000-8000-0000000000d1',
        'deviceName': 'Mostrador',
        'deviceStatus': 'active',
        'operatorSessionId': operatorSessionId,
        'reclaimable': false,
      },
    },
  ],
  adoptableShift: null,
  currentShift: {
    'id': shiftId,
    'registerId': registerId,
    'status': 'open',
    'version': 5,
    'operatorSessionId': operatorSessionId,
    'currency': 'MXN',
  },
  expectedCash: null,
  latestCount: null,
  varianceResolution: null,
  reconciliation: null,
  recoveryState: 'none',
  allowedActions: const ['movement', 'suspend', 'handoff', 'count', 'no_sale'],
  summary: null,
);

final class _RestartFakeRepository implements CashRepository {
  _RestartFakeRepository({required this.orphaned});
  final bool orphaned;
  int centerCalls = 0;
  int resumeCalls = 0;
  ReclaimCashRegisterRequest? reclaimRequest;
  static const shiftId = '00000000-0000-4000-8000-0000000000a1';
  static const registerId = '00000000-0000-4000-8000-0000000000b1';
  static const liveSession = '00000000-0000-4000-8000-0000000000f1';

  @override
  Future<CashCenterSnapshot> center(
    String merchantId,
    CashCenterQuery query,
  ) async {
    centerCalls += 1;
    if (centerCalls == 1) {
      return _mismatchSnapshot(
        shiftId: shiftId,
        registerId: registerId,
        holdState: orphaned ? 'held_by_orphaned_till' : 'held_by_this_device',
        reclaimable: orphaned,
      );
    }
    return _resumedSnapshot(
      shiftId: shiftId,
      registerId: registerId,
      operatorSessionId: liveSession,
    );
  }

  @override
  Future<CashShift> transition(
    String merchantId,
    String shiftId,
    ShiftTransitionRequest request, {
    required bool suspend,
  }) async {
    resumeCalls += 1;
    return CashShift.fromJson({
      'id': shiftId,
      'merchantId': merchantId,
      'locationId': request.locationId,
      'registerId': registerId,
      'deviceId': '00000000-0000-4000-8000-0000000000d1',
      'deviceCredentialVersion': 1,
      'holdingDeviceId': '00000000-0000-4000-8000-0000000000d1',
      'holdingDeviceCredentialVersion': 1,
      'openingOperatorId': '00000000-0000-4000-8000-0000000000c1',
      'responsibleOperatorId': '00000000-0000-4000-8000-0000000000c1',
      'operatorSessionId': request.operatorSessionId,
      'currency': 'MXN',
      'businessDate': '2026-09-16',
      'status': 'open',
      'openingCommandId': request.commandId,
      'openedAt': '2026-09-16T20:52:56.649669+00:00',
      'suspendedAt': null,
      'closedAt': null,
      'ledgerSequence': 0,
      'version': request.expectedShiftVersion + 1,
    });
  }

  @override
  Future<ReclaimCashRegisterResult> reclaimRegister(
    String merchantId,
    String registerId,
    ReclaimCashRegisterRequest request,
  ) async {
    reclaimRequest = request;
    return ReclaimCashRegisterResult.fromJson({
      'register': {
        'id': registerId,
        'merchantId': merchantId,
        'locationId': request.locationId,
        'displayName': 'Caja 1',
        'publicReference': 'CAJA-1',
        'currency': 'MXN',
        'active': true,
        'assignmentPolicy': 'device_required',
        'assignment': {
          'deviceId': '00000000-0000-4000-8000-0000000000d1',
          'allowedDeviceClasses': ['pos_terminal'],
          'assignedAt': null,
        },
        'currentShiftId': null,
        'hold': {
          'state': 'free',
          'shiftId': null,
          'shiftStatus': null,
          'openedAt': null,
          'deviceId': null,
          'deviceName': null,
          'deviceStatus': null,
          'operatorSessionId': null,
          'reclaimable': false,
        },
        'status': 'available',
        'version': 4,
        'createdAt': '2026-09-01T00:00:00.000Z',
        'archivedAt': null,
      },
      'shift': null,
      'custody': null,
      'reclaimedAt': '2026-09-16T22:30:00.000Z',
      'correlationId': 'test',
    });
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  test('a restart resumes the till own shift on load, so it is chargeable again', () async {
    final repository = _RestartFakeRepository(orphaned: false);
    final controller = CashController(repository: repository);
    controller.setContext(
      merchantId: '00000000-0000-4000-8000-000000000000',
      locationId: '00000000-0000-4000-8000-000000000001',
      operatorSessionId: _RestartFakeRepository.liveSession,
    );

    await controller.load();

    expect(repository.resumeCalls, 1, reason: 'the till must resume its own shift');
    expect(repository.centerCalls, 2, reason: 'it re-reads the snapshot after resuming');
    expect(controller.activeShiftId, _RestartFakeRepository.shiftId);
    expect(controller.activeRegisterHoldState, 'held_by_this_device');
  });

  test('recoverOwnShift is a no-op when the drawer is not this device own', () async {
    final repository = _RestartFakeRepository(orphaned: true);
    final controller = CashController(repository: repository);
    controller.setContext(
      merchantId: '00000000-0000-4000-8000-000000000000',
      locationId: '00000000-0000-4000-8000-000000000001',
      operatorSessionId: _RestartFakeRepository.liveSession,
    );

    await controller.load();

    expect(repository.resumeCalls, 0, reason: 'an orphaned hold is not resumed, it is reclaimed');
    expect(controller.activeShiftId, isNull);
    expect(controller.reclaimableRegisters, hasLength(1));
  });

  test('reclaimRegister frees an orphaned drawer with the register version it saw', () async {
    final repository = _RestartFakeRepository(orphaned: true);
    final controller = CashController(repository: repository);
    controller.setContext(
      merchantId: '00000000-0000-4000-8000-000000000000',
      locationId: '00000000-0000-4000-8000-000000000001',
      operatorSessionId: _RestartFakeRepository.liveSession,
    );
    await controller.load();

    await controller.reclaimRegister(_RestartFakeRepository.registerId);

    expect(repository.reclaimRequest, isNotNull);
    expect(repository.reclaimRequest!.registerId, _RestartFakeRepository.registerId);
    expect(repository.reclaimRequest!.expectedRegisterVersion, 3);
  });
}
