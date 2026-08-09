import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/security/operator_permissions.dart';
import 'package:umi_pos/features/cash/cash_controller.dart';
import 'package:umi_pos/features/cash/cash_recovery_store.dart';
import 'package:umi_pos/features/cash/cash_repository.dart';
import 'package:umi_pos/features/cash/cash_surface.dart';

final class _FakeCashRepository implements CashRepository {
  int openCalls = 0;
  CashCenterSnapshot snapshot = const CashCenterSnapshot(
    businessDate: '2026-07-29',
    policy: {
      'version': 'cash-v1',
      'blindCountRequired': true,
      'currency': 'MXN',
      'movementApprovalThreshold': {'minorUnits': 5000, 'currency': 'MXN'},
    },
    registers: [
      {
        'id': '00000000-0000-4000-8000-000000000001',
        'displayName': 'Caja principal',
        'publicReference': 'REG-01',
        'currency': 'MXN',
        'version': 1,
        'status': 'assigned',
      },
    ],
    currentShift: null,
    expectedCash: null,
    latestCount: null,
    varianceResolution: null,
    reconciliation: null,
    recoveryState: 'shift_required',
    allowedActions: ['open_shift'],
    summary: null,
  );
  OpenCashShiftRequest? openedWith;
  ManagerApprovalRequest? approvalRequest;
  NoSaleDrawerRequest? noSaleRequest;
  CashCommandRecoveryResult recoveryResult = const CashCommandRecoveryResult(
    commandId: '00000000-0000-4000-8000-000000000070',
    commandType: 'pos.cash.paid_in',
    status: 'succeeded',
    retryable: false,
    failureCode: null,
    correlationId: 'cash-recovered',
  );

  @override
  Future<CashCenterSnapshot> center(
    String merchantId,
    CashCenterQuery query,
  ) async => snapshot;

  @override
  Future<CashCommandRecoveryResult> commandRecovery(
    String merchantId,
    CashCommandRecoveryQuery query,
  ) async => recoveryResult;

  @override
  Future<ElevationGrantView> approve(ManagerApprovalRequest request) async {
    approvalRequest = request;
    return ElevationGrantView(
      elevationId: '00000000-0000-4000-8000-000000000090',
      permission: request.permission,
      merchantId: request.merchantId,
      locationId: request.locationId,
      method: 'manager_approval',
      expiresAt: '2026-07-29T20:05:00.000Z',
      commandFingerprint: request.commandFingerprint,
    );
  }

  @override
  Future<OpenCashShiftResult> open(
    String merchantId,
    OpenCashShiftRequest request,
  ) async {
    openCalls += 1;
    openedWith = request;
    snapshot = CashCenterSnapshot(
      businessDate: snapshot.businessDate,
      policy: snapshot.policy,
      registers: snapshot.registers,
      currentShift: {
        'id': '00000000-0000-4000-8000-000000000009',
        'status': 'open',
        'version': 1,
        'ledgerSequence': 1,
        'currency': 'MXN',
        'operatorSessionId': '00000000-0000-4000-8000-000000000012',
        'responsibleOperatorId': '00000000-0000-4000-8000-000000000013',
        'deviceId': '00000000-0000-4000-8000-000000000014',
      },
      expectedCash: null,
      latestCount: null,
      varianceResolution: null,
      reconciliation: null,
      recoveryState: 'none',
      allowedActions: const ['movement', 'suspend', 'count'],
      summary: null,
    );
    return OpenCashShiftResult(
      register: snapshot.registers.first,
      shift: snapshot.currentShift!,
      openingFloat: {
        'total': request.openingFloat,
        'denominations': request.denominations,
        'note': request.note,
      },
      policy: snapshot.policy,
      correlationId: 'cash-open',
      recovered: false,
    );
  }

  @override
  Future<NoSaleDrawerEvent> noSale(
    String merchantId,
    String shiftId,
    NoSaleDrawerRequest request,
  ) async {
    noSaleRequest = request;
    return NoSaleDrawerEvent(
      id: '00000000-0000-4000-8000-000000000091',
      shiftId: shiftId,
      status: 'requested',
      verifiedHardwareResult: false,
      requestedAt: '2026-08-09T00:00:00.000Z',
      correlationId: 'cash-no-sale',
    );
  }

  @override
  Future<CashCountSummary> count(
    String merchantId,
    String shiftId,
    SubmitBlindCountRequest request,
  ) async {
    const result = CashCountSummary(
      count: {
        'id': '00000000-0000-4000-8000-000000000020',
        'shiftId': '00000000-0000-4000-8000-000000000009',
        'attemptNumber': 1,
        'state': 'resolved',
        'countedCash': {'minorUnits': 2000, 'currency': 'MXN'},
        'denominations': <Object?>[],
        'operatorId': '00000000-0000-4000-8000-000000000012',
        'ledgerSequence': 1,
        'submittedAt': '2026-07-29T18:00:00.000Z',
      },
      variance: {
        'expectedCash': {'minorUnits': 2000, 'currency': 'MXN'},
        'countedCash': {'minorUnits': 2000, 'currency': 'MXN'},
        'signedVariance': {'minorUnits': 0, 'currency': 'MXN'},
        'absoluteVariance': {'minorUnits': 0, 'currency': 'MXN'},
        'tolerance': {'minorUnits': 100, 'currency': 'MXN'},
        'withinTolerance': true,
        'approvalRequired': false,
        'reasonRequired': false,
        'outcome': 'balanced',
        'ledgerSequence': 1,
      },
      approvalFingerprint: null,
    );
    snapshot = CashCenterSnapshot(
      businessDate: snapshot.businessDate,
      policy: snapshot.policy,
      registers: snapshot.registers,
      currentShift: {
        ...snapshot.currentShift!,
        'status': 'reconciliation_required',
        'version': 2,
      },
      expectedCash: const {
        'expectedDrawerCash': {'minorUnits': 2000, 'currency': 'MXN'},
        'ledgerSequence': 1,
      },
      latestCount: result.toJson(),
      varianceResolution: null,
      reconciliation: null,
      recoveryState: 'reconciliation_required',
      allowedActions: const ['resolve_variance', 'reconcile', 'count'],
      summary: null,
    );
    return result;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  test('controller opens one shift with integer opening cash', () async {
    final repository = _FakeCashRepository();
    final controller = CashController(repository: repository);
    controller.setContext(
      merchantId: '00000000-0000-4000-8000-000000000010',
      locationId: '00000000-0000-4000-8000-000000000011',
      operatorSessionId: '00000000-0000-4000-8000-000000000012',
    );
    await controller.load();
    await controller.openShift(
      registerId: '00000000-0000-4000-8000-000000000001',
      amountMinorUnits: 2000,
    );
    expect(repository.openedWith?.openingFloat['minorUnits'], 2000);
    expect(controller.state.snapshot?.currentShift?['status'], 'open');
  });

  test('committed opening float requests hardware after the ledger', () async {
    final repository = _FakeCashRepository();
    CommittedCashHardwareAction? action;
    final controller = CashController(
      repository: repository,
      afterCommit: (value) async => action = value,
    );
    controller.setContext(
      merchantId: '00000000-0000-4000-8000-000000000010',
      locationId: '00000000-0000-4000-8000-000000000011',
      operatorSessionId: '00000000-0000-4000-8000-000000000012',
    );
    await controller.load();
    await controller.openShift(
      registerId: '00000000-0000-4000-8000-000000000001',
      amountMinorUnits: 2000,
    );
    await Future<void>.delayed(Duration.zero);
    expect(action?.reason, 'register_open');
    expect(action?.registerId, '00000000-0000-4000-8000-000000000001');
  });

  test(
    'movement approval uses a command fingerprint and approval permission',
    () async {
      final repository = _FakeCashRepository();
      final controller = CashController(repository: repository);
      controller.setContext(
        merchantId: '00000000-0000-4000-8000-000000000010',
        locationId: '00000000-0000-4000-8000-000000000011',
        operatorSessionId: '00000000-0000-4000-8000-000000000012',
      );
      await controller.load();
      await controller.openShift(
        registerId: '00000000-0000-4000-8000-000000000001',
        amountMinorUnits: 2000,
      );

      expect(controller.movementRequiresApproval(4999), isFalse);
      expect(controller.movementRequiresApproval(5000), isTrue);
      final result = await controller.approveMovement(
        managerPin: '3333',
        type: 'paid_out',
        amountMinorUnits: 5000,
        reasonCode: 'pilot_expense',
      );

      expect(
        repository.approvalRequest?.permission,
        'cash.movement.paid_out.approve',
      );
      expect(result.fingerprint, hasLength(64));
      expect(
        repository.approvalRequest?.commandFingerprint,
        result.fingerprint,
      );
    },
  );

  testWidgets('Cash Center hides expected cash before a blind count', (
    tester,
  ) async {
    final controller = CashController(repository: _FakeCashRepository());
    controller.setContext(
      merchantId: '00000000-0000-4000-8000-000000000010',
      locationId: '00000000-0000-4000-8000-000000000011',
      operatorSessionId: '00000000-0000-4000-8000-000000000012',
    );
    await controller.load();
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: Scaffold(
          body: CashCenter(
            controller: controller,
            permissions: OperatorPermissions(const ['cash.shift.open']),
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Centro de caja'), findsOneWidget);
    expect(find.textContaining('Efectivo esperado'), findsNothing);
    expect(find.bySemanticsLabel('Abrir turno de caja'), findsOneWidget);
  });

  test('cash count and shift state recover after restart', () async {
    final repository = _FakeCashRepository();
    final first = CashController(repository: repository);
    first.setContext(
      merchantId: '00000000-0000-4000-8000-000000000010',
      locationId: '00000000-0000-4000-8000-000000000011',
      operatorSessionId: '00000000-0000-4000-8000-000000000012',
    );
    await first.load();
    await first.openShift(
      registerId: '00000000-0000-4000-8000-000000000001',
      amountMinorUnits: 2000,
    );
    await first.submitCount(amountMinorUnits: 2000);

    final recovered = CashController(repository: repository);
    recovered.setContext(
      merchantId: '00000000-0000-4000-8000-000000000010',
      locationId: '00000000-0000-4000-8000-000000000011',
      operatorSessionId: '00000000-0000-4000-8000-000000000012',
    );
    await recovered.load();
    expect(recovered.state.count?.variance['outcome'], 'balanced');
    expect(recovered.state.snapshot?.expectedCash?['expectedDrawerCash'], {
      'minorUnits': 2000,
      'currency': 'MXN',
    });
  });

  testWidgets('Cash Center reveals expected cash only after count submission', (
    tester,
  ) async {
    final repository = _FakeCashRepository();
    final controller = CashController(repository: repository);
    controller.setContext(
      merchantId: '00000000-0000-4000-8000-000000000010',
      locationId: '00000000-0000-4000-8000-000000000011',
      operatorSessionId: '00000000-0000-4000-8000-000000000012',
    );
    await controller.load();
    await controller.openShift(
      registerId: '00000000-0000-4000-8000-000000000001',
      amountMinorUnits: 2000,
    );
    await controller.submitCount(amountMinorUnits: 2000);
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: Scaffold(
          body: CashCenter(
            controller: controller,
            permissions: OperatorPermissions(const [
              'cash.count.recount',
              'cash.reconcile',
            ]),
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.textContaining('Expected cash'), findsWidgets);
    expect(find.textContaining('Counted cash'), findsWidgets);
    expect(find.text('Start recount'), findsOneWidget);
    expect(find.text('Reconcile shift'), findsOneWidget);
  });

  test(
    'no-sale drawer request consumes an exact separate manager approval',
    () async {
      final repository = _FakeCashRepository();
      final controller = CashController(repository: repository);
      controller.setContext(
        merchantId: '00000000-0000-4000-8000-000000000010',
        locationId: '00000000-0000-4000-8000-000000000011',
        operatorSessionId: '00000000-0000-4000-8000-000000000012',
      );
      await controller.load();
      await controller.openShift(
        registerId: '00000000-0000-4000-8000-000000000001',
        amountMinorUnits: 2000,
      );
      final approval = await controller.approveNoSale(
        managerPin: '1234',
        reasonCode: 'operator_request',
      );
      await controller.requestNoSale(
        'operator_request',
        approvalId: approval.approvalId,
        approvalFingerprint: approval.fingerprint,
      );

      expect(
        repository.approvalRequest?.permission,
        'cash.drawer.no_sale.approve',
      );
      expect(
        repository.approvalRequest?.commandFingerprint,
        approval.fingerprint,
      );
      expect(repository.noSaleRequest?.approvalId, approval.approvalId);
      expect(
        repository.noSaleRequest?.approvalFingerprint,
        approval.fingerprint,
      );
    },
  );

  test(
    'restart queries a durable command and does not repeat its effect',
    () async {
      final repository = _FakeCashRepository();
      final store = MemoryCashRecoveryStore();
      await store.save(
        const PendingCashCommand(
          merchantId: '00000000-0000-4000-8000-000000000010',
          locationId: '00000000-0000-4000-8000-000000000011',
          operation: 'cash_movement',
          commandId: '00000000-0000-4000-8000-000000000070',
          idempotencyKey: '00000000-0000-4000-8000-000000000071',
        ),
      );
      final controller = CashController(
        repository: repository,
        recoveryStore: store,
      );
      controller.setContext(
        merchantId: '00000000-0000-4000-8000-000000000010',
        locationId: '00000000-0000-4000-8000-000000000011',
        operatorSessionId: '00000000-0000-4000-8000-000000000012',
      );
      await controller.load();
      expect(controller.state.errorCode, 'CASH_COMMAND_RECOVERED');
      expect(
        await store.load(
          '00000000-0000-4000-8000-000000000010',
          '00000000-0000-4000-8000-000000000011',
        ),
        isNull,
      );
      expect(repository.openCalls, 0);
    },
  );

  test(
    'offline checkout uses only an open shift for the current session',
    () async {
      final repository = _FakeCashRepository();
      repository.snapshot = CashCenterSnapshot.fromJson({
        ...repository.snapshot.toJson(),
        'currentShift': {
          'id': '00000000-0000-4000-8000-000000000009',
          'status': 'open',
          'operatorSessionId': '00000000-0000-4000-8000-000000000012',
        },
        'recoveryState': 'none',
      });
      final controller = CashController(repository: repository);
      controller.setContext(
        merchantId: '00000000-0000-4000-8000-000000000010',
        locationId: '00000000-0000-4000-8000-000000000011',
        operatorSessionId: '00000000-0000-4000-8000-000000000012',
      );
      await controller.load();
      expect(controller.activeShiftId, '00000000-0000-4000-8000-000000000009');

      repository.snapshot = CashCenterSnapshot.fromJson({
        ...repository.snapshot.toJson(),
        'currentShift': {
          'id': '00000000-0000-4000-8000-000000000009',
          'status': 'suspended',
          'operatorSessionId': '00000000-0000-4000-8000-000000000012',
        },
        'recoveryState': 'shift_suspended',
      });
      await controller.load();
      expect(controller.activeShiftId, isNull);

      repository.snapshot = CashCenterSnapshot.fromJson({
        ...repository.snapshot.toJson(),
        'currentShift': {
          'id': '00000000-0000-4000-8000-000000000009',
          'status': 'open',
          'operatorSessionId': '00000000-0000-4000-8000-000000000099',
        },
        'recoveryState': 'operator_mismatch',
      });
      await controller.load();
      expect(controller.activeShiftId, isNull);
    },
  );
}
