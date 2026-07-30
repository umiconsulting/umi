import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
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
    String tenantId,
    CashCenterQuery query,
  ) async => snapshot;

  @override
  Future<CashCommandRecoveryResult> commandRecovery(
    String tenantId,
    CashCommandRecoveryQuery query,
  ) async => recoveryResult;

  @override
  Future<OpenCashShiftResult> open(
    String tenantId,
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
  Future<CashCountSummary> count(
    String tenantId,
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
      tenantId: '00000000-0000-4000-8000-000000000010',
      branchId: '00000000-0000-4000-8000-000000000011',
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

  testWidgets('Cash Center hides expected cash before a blind count', (
    tester,
  ) async {
    final controller = CashController(repository: _FakeCashRepository());
    controller.setContext(
      tenantId: '00000000-0000-4000-8000-000000000010',
      branchId: '00000000-0000-4000-8000-000000000011',
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
        home: Scaffold(body: CashCenter(controller: controller)),
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
      tenantId: '00000000-0000-4000-8000-000000000010',
      branchId: '00000000-0000-4000-8000-000000000011',
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
      tenantId: '00000000-0000-4000-8000-000000000010',
      branchId: '00000000-0000-4000-8000-000000000011',
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
      tenantId: '00000000-0000-4000-8000-000000000010',
      branchId: '00000000-0000-4000-8000-000000000011',
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
        home: Scaffold(body: CashCenter(controller: controller)),
      ),
    );
    await tester.pump();
    expect(find.textContaining('Expected cash'), findsWidgets);
    expect(find.textContaining('Counted cash'), findsWidgets);
    expect(find.text('Start recount'), findsOneWidget);
    expect(find.text('Reconcile shift'), findsOneWidget);
  });

  test(
    'restart queries a durable command and does not repeat its effect',
    () async {
      final repository = _FakeCashRepository();
      final store = MemoryCashRecoveryStore();
      await store.save(
        const PendingCashCommand(
          tenantId: '00000000-0000-4000-8000-000000000010',
          branchId: '00000000-0000-4000-8000-000000000011',
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
        tenantId: '00000000-0000-4000-8000-000000000010',
        branchId: '00000000-0000-4000-8000-000000000011',
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
        tenantId: '00000000-0000-4000-8000-000000000010',
        branchId: '00000000-0000-4000-8000-000000000011',
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
