import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/security/operator_permissions.dart';
import 'package:umi_pos/features/cash/cash_approval.dart';
import 'package:umi_pos/features/cash/cash_controller.dart';
import 'package:umi_pos/features/cash/cash_recovery_store.dart';
import 'package:umi_pos/features/cash/cash_repository.dart';
import 'package:umi_pos/features/cash/cash_surface.dart';

final class _FakeCashRepository implements CashRepository {
  int openCalls = 0;

  /// True makes `center` never answer, which is the state a slow network
  /// produces and the one the screen draws its own shape for.
  bool holdCenter = false;

  /// What the blind count comes back as. Zero keeps the shift balanced; a
  /// negative number is a drawer that counted short, which is the state the
  /// reason dialog exists for.
  int countVarianceMinorUnits = 0;
  CashCenterSnapshot snapshot = const CashCenterSnapshot(
    businessDate: '2026-07-29',
    policy: {
      'version': 'cash-v1',
      'expiresAt': '2026-08-05T00:00:00.000Z',
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
    ledger: [],
    adoptableShift: null,
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

  /// A code makes `approve` refuse the way the API does, which is the branch
  /// that used to leave the screen with nothing to say.
  String? approvalFailureCode;

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
  ) async => holdCenter ? Completer<CashCenterSnapshot>().future : snapshot;

  @override
  Future<CashCommandRecoveryResult> commandRecovery(
    String merchantId,
    CashCommandRecoveryQuery query,
  ) async => recoveryResult;

  @override
  Future<ElevationGrantView> approve(ManagerApprovalRequest request) async {
    approvalRequest = request;
    final failure = approvalFailureCode;
    if (failure != null) {
      throw AppException(
        category: AppErrorCategory.unknown,
        code: failure,
        recoverable: false,
      );
    }
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
      ledger: const [],
      adoptableShift: null,
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
    final variance = countVarianceMinorUnits;
    final counted = 2000 + variance;
    final result = CashCountSummary(
      count: {
        'id': '00000000-0000-4000-8000-000000000020',
        'shiftId': '00000000-0000-4000-8000-000000000009',
        'attemptNumber': 1,
        'state': 'resolved',
        'countedCash': {'minorUnits': counted, 'currency': 'MXN'},
        'denominations': <Object?>[],
        'operatorId': '00000000-0000-4000-8000-000000000012',
        'ledgerSequence': 1,
        'submittedAt': '2026-07-29T18:00:00.000Z',
      },
      variance: {
        'expectedCash': {'minorUnits': 2000, 'currency': 'MXN'},
        'countedCash': {'minorUnits': counted, 'currency': 'MXN'},
        'signedVariance': {'minorUnits': variance, 'currency': 'MXN'},
        'absoluteVariance': {'minorUnits': variance.abs(), 'currency': 'MXN'},
        'tolerance': {'minorUnits': 100, 'currency': 'MXN'},
        'withinTolerance': variance.abs() <= 100,
        'approvalRequired': variance.abs() > 100,
        'reasonRequired': variance != 0,
        'outcome': variance == 0 ? 'balanced' : 'approval_required',
        'ledgerSequence': 1,
      },
      approvalFingerprint: variance == 0
          ? null
          : 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    );
    snapshot = CashCenterSnapshot(
      businessDate: snapshot.businessDate,
      policy: snapshot.policy,
      registers: snapshot.registers,
      ledger: const [],
      adoptableShift: null,
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

  AdoptCashShiftRequest? adoptedWith;
  CancelCashCountRequest? cancelledCountWith;

  @override
  Future<CashShift> cancelCount(
    String merchantId,
    String shiftId,
    CancelCashCountRequest request,
  ) async {
    cancelledCountWith = request;
    snapshot = CashCenterSnapshot(
      businessDate: snapshot.businessDate,
      policy: snapshot.policy,
      registers: snapshot.registers,
      ledger: snapshot.ledger,
      adoptableShift: null,
      currentShift: {
        ...?snapshot.currentShift,
        'status': 'open',
        'version': (snapshot.currentShift?['version'] as int? ?? 1) + 1,
      },
      expectedCash: null,
      latestCount: snapshot.latestCount,
      varianceResolution: null,
      reconciliation: null,
      recoveryState: 'none',
      allowedActions: const ['movement', 'suspend', 'count'],
      summary: null,
    );
    return CashShift.fromJson(snapshot.currentShift!);
  }

  @override
  Future<AdoptCashShiftResult> adopt(
    String merchantId,
    String shiftId,
    AdoptCashShiftRequest request,
  ) async {
    adoptedWith = request;
    final adopted = {
      ...?snapshot.adoptableShift,
      'holdingDeviceId': '00000000-0000-4000-8000-000000000099',
      'version': 4,
    };
    snapshot = CashCenterSnapshot(
      businessDate: snapshot.businessDate,
      policy: snapshot.policy,
      registers: snapshot.registers,
      ledger: const [],
      adoptableShift: null,
      currentShift: adopted,
      expectedCash: null,
      latestCount: null,
      varianceResolution: null,
      reconciliation: null,
      recoveryState: 'none',
      allowedActions: const ['movement', 'suspend', 'count'],
      summary: null,
    );
    return AdoptCashShiftResult(
      shift: adopted,
      register: snapshot.registers.first,
      custody: const {
        'previousHoldingDeviceId': '00000000-0000-4000-8000-000000000098',
        'newHoldingDeviceId': '00000000-0000-4000-8000-000000000099',
      },
      correlationId: 'adopt',
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  /// The reason the operator picked in the variance dialog, recorded so the test
  /// can prove the dialog sent the choice rather than a default of its own.
  ResolveCashVarianceRequest? resolvedWith;

  @override
  Future<CashVarianceResolution> resolve(
    String merchantId,
    String shiftId,
    ResolveCashVarianceRequest request,
  ) async {
    resolvedWith = request;
    return CashVarianceResolution(
      id: '00000000-0000-4000-8000-000000000021',
      shiftId: shiftId,
      countAttemptId: request.countAttemptId,
      reason: request.reason,
      note: request.note,
      approvalId: request.approvalId,
      approvalFingerprint: request.approvalFingerprint,
      ledgerSequence: 1,
      resolvedAt: '2026-07-29T18:05:00.000Z',
    );
  }
}

/// Puts the fake in the ordinary state: one open shift on the first register.
/// Text inside the approval dialog. The cash screen stays mounted behind it, so
/// an unscoped `find.text` can match the same words twice.
Finder _inApproval(String text) => find.descendant(
  of: find.byType(CashApprovalDialog),
  matching: find.text(text),
);

/// The refusal sentence, which is long enough to be one `Text` holding more than
/// the phrase under test.
Finder _inApprovalMessage(String text) => find.descendant(
  of: find.byType(CashApprovalDialog),
  matching: find.textContaining(text),
);

/// One key of the approval dialog's keypad, so a test can ask whether the till
/// is still inviting keystrokes.
FilledButton _approvalKey(WidgetTester tester, String digit) =>
    tester.widget<FilledButton>(
      find.descendant(
        of: find.byType(CashApprovalDialog),
        matching: find.widgetWithText(FilledButton, digit),
      ),
    );

/// Types a PIN the way the till asks for one: one tap per digit on the keypad
/// inside the approval dialog.
Future<void> _tapPin(WidgetTester tester, String pin) async {
  for (final digit in pin.split('')) {
    await tester.tap(
      find.descendant(
        of: find.byType(CashApprovalDialog),
        matching: find.widgetWithText(FilledButton, digit),
      ),
    );
    await tester.pump();
  }
}

Future<void> _seedOpenShift(_FakeCashRepository repository) => repository.open(
  '00000000-0000-4000-8000-000000000010',
  OpenCashShiftRequest(
    locationId: '00000000-0000-4000-8000-000000000011',
    operatorSessionId: '00000000-0000-4000-8000-000000000012',
    commandId: '00000000-0000-4000-8000-000000000060',
    idempotencyKey: '00000000-0000-4000-8000-000000000061',
    registerId: '00000000-0000-4000-8000-000000000001',
    openingFloat: const {'minorUnits': 150000, 'currency': 'MXN'},
    denominations: const [],
    businessDate: '2026-07-29',
    note: null,
    expectedRegisterVersion: 1,
  ),
);

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
      afterCommit: (value) async {
        action = value;
        return true;
      },
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

  testWidgets('Cash Center shows the shift journal on the surface', (
    tester,
  ) async {
    final repository = _FakeCashRepository();
    await repository.open(
      '00000000-0000-4000-8000-000000000010',
      OpenCashShiftRequest(
        locationId: '00000000-0000-4000-8000-000000000011',
        operatorSessionId: '00000000-0000-4000-8000-000000000012',
        commandId: '00000000-0000-4000-8000-000000000060',
        idempotencyKey: '00000000-0000-4000-8000-000000000061',
        registerId: '00000000-0000-4000-8000-000000000001',
        openingFloat: const {'minorUnits': 150000, 'currency': 'MXN'},
        denominations: const [],
        businessDate: '2026-07-29',
        note: null,
        expectedRegisterVersion: 1,
      ),
    );
    repository.snapshot = CashCenterSnapshot(
      businessDate: repository.snapshot.businessDate,
      policy: repository.snapshot.policy,
      registers: repository.snapshot.registers,
      ledger: [
        {
          'sequence': 1,
          'type': 'opening_float',
          'amount': {'minorUnits': 150000, 'currency': 'MXN'},
          'cashReceived': {'minorUnits': 0, 'currency': 'MXN'},
          'changeGiven': {'minorUnits': 0, 'currency': 'MXN'},
          'saleId': null,
          'receiptNumber': null,
          'operatorReference': 'Ana R.',
          'reasonCode': null,
          'note': null,
          'occurredAt': '2026-07-29T14:12:00.000Z',
        },
        {
          'sequence': 2,
          'type': 'paid_out',
          'amount': {'minorUnits': 35000, 'currency': 'MXN'},
          'cashReceived': {'minorUnits': 0, 'currency': 'MXN'},
          'changeGiven': {'minorUnits': 0, 'currency': 'MXN'},
          'saleId': null,
          'receiptNumber': null,
          'operatorReference': 'Luis M.',
          'reasonCode': 'hielo',
          'note': null,
          'occurredAt': '2026-07-29T15:48:00.000Z',
        },
      ],
      adoptableShift: null,
      currentShift: repository.snapshot.currentShift,
      expectedCash: const {
        'openingFloat': {'minorUnits': 150000, 'currency': 'MXN'},
        'netCashSales': {'minorUnits': 0, 'currency': 'MXN'},
        'paidIn': {'minorUnits': 0, 'currency': 'MXN'},
        'paidOut': {'minorUnits': 35000, 'currency': 'MXN'},
        'safeDrops': {'minorUnits': 0, 'currency': 'MXN'},
        'adjustments': {'minorUnits': 0, 'currency': 'MXN'},
        'grossCashReceived': {'minorUnits': 0, 'currency': 'MXN'},
        'changeGiven': {'minorUnits': 0, 'currency': 'MXN'},
        'expectedDrawerCash': {'minorUnits': 115000, 'currency': 'MXN'},
        'currency': 'MXN',
        'ledgerSequence': 2,
      },
      latestCount: null,
      varianceResolution: null,
      reconciliation: null,
      recoveryState: 'none',
      allowedActions: const ['movement', 'suspend', 'count'],
      summary: null,
    );

    final controller = CashController(repository: repository);
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
            permissions: OperatorPermissions(const ['cash.shift.read']),
          ),
        ),
      ),
    );
    await tester.pump();

    // The operator reads the drawer's account and the line that produced it, on
    // the same surface, without asking the owner's dashboard.
    expect(find.text('La cuenta del cajón'), findsOneWidget);
    expect(find.text('Libro del turno'), findsOneWidget);
    expect(find.text('Fondo inicial'), findsWidgets);
    expect(find.text('Retiros'), findsOneWidget);
    // The subtraction appears twice on purpose: once as the equation's term and
    // once as the journal line that produced it.
    expect(find.text('−MXN 350.00'), findsNWidgets(2));
  });

  test('the count exit posts the sequence the count was taken at', () async {
    final repository = _FakeCashRepository();
    await _seedOpenShift(repository);
    final controller = CashController(repository: repository);
    controller.setContext(
      merchantId: '00000000-0000-4000-8000-000000000010',
      locationId: '00000000-0000-4000-8000-000000000011',
      operatorSessionId: '00000000-0000-4000-8000-000000000012',
    );
    await controller.load();
    await controller.submitCount(
      amountMinorUnits: 2000,
      denominations: const [],
    );

    await controller.cancelCount();

    // The server refuses unless the ledger has stood still since the count, so the
    // terminal has to send the sequence the count was taken at, not the one it
    // holds after a reload.
    expect(repository.cancelledCountWith?.expectedLedgerSequence, 1);
    expect(repository.cancelledCountWith?.expectedShiftVersion, 2);
    expect(repository.cancelledCountWith?.reasonCode, 'count_opened_in_error');
  });

  testWidgets('offers the count exit only when the server says it is open', (
    tester,
  ) async {
    final repository = _FakeCashRepository();
    await _seedOpenShift(repository);
    final controller = CashController(repository: repository);
    controller.setContext(
      merchantId: '00000000-0000-4000-8000-000000000010',
      locationId: '00000000-0000-4000-8000-000000000011',
      operatorSessionId: '00000000-0000-4000-8000-000000000012',
    );
    await controller.load();
    await controller.submitCount(
      amountMinorUnits: 2000,
      denominations: const [],
    );
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
            permissions: OperatorPermissions(const ['cash.count.submit']),
          ),
        ),
      ),
    );
    await tester.pump();
    // The fake counted the drawer but did not offer the exit, because only the
    // server knows whether the ledger stood still. Nothing to press.
    expect(find.text('Cancelar conteo y volver a abierto'), findsNothing);
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
    // The figures on this screen wear the same micro-label as the equation's
    // terms, so the two cards read as one ledger.
    expect(find.textContaining('EXPECTED CASH'), findsWidgets);
    expect(find.textContaining('COUNTED CASH'), findsWidgets);
    expect(find.text('Start recount'), findsOneWidget);
    expect(find.text('Reconcile shift'), findsOneWidget);
  });

  testWidgets('an expired policy blocks the screen and says why', (
    tester,
  ) async {
    final repository = _FakeCashRepository();
    await _seedOpenShift(repository);
    repository.snapshot = CashCenterSnapshot(
      businessDate: repository.snapshot.businessDate,
      policy: repository.snapshot.policy,
      registers: repository.snapshot.registers,
      ledger: repository.snapshot.ledger,
      adoptableShift: null,
      currentShift: repository.snapshot.currentShift,
      expectedCash: null,
      latestCount: null,
      varianceResolution: null,
      reconciliation: null,
      recoveryState: 'policy_expired',
      allowedActions: const [],
      summary: null,
    );
    final controller = CashController(repository: repository);
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
            // Every permission the till has: the silence here is the policy's,
            // not the operator's, and the screen must not blame the wrong one.
            permissions: OperatorPermissions(const [
              'cash.shift.read',
              'cash.movement.paid_in',
              'cash.count.submit',
              'cash.shift.close',
            ]),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('La política de caja venció'), findsWidgets);
    expect(find.textContaining('no puede mover efectivo'), findsOneWidget);
    // Which policy lapsed and the day it did: the sentence an owner needs in
    // order to publish a new one, said in the identity bar.
    expect(find.textContaining('Versión cash-v1'), findsOneWidget);
    expect(find.textContaining('Vigente hasta 2026-08-05'), findsOneWidget);
    // The drawer's rules are still worth reading.
    expect(find.text('Política de la caja'), findsOneWidget);
    // No actions at all, and no misdiagnosis: "with your current permissions"
    // would send the operator to ask for a permission that would change nothing.
    expect(find.byType(OutlinedButton), findsNothing);
    expect(find.text('Solo consulta'), findsNothing);
  });

  testWidgets('opening a shift on a stranded drawer states its cost', (
    tester,
  ) async {
    final repository = _FakeCashRepository();
    final register =
        Map<String, Object?>.from(repository.snapshot.registers.first)
          ..['hold'] = {
            'state': 'held_by_orphaned_till',
            'shiftId': '00000000-0000-4000-8000-000000000009',
            'shiftStatus': 'open',
            'openedAt': '2026-07-29T14:12:00.000Z',
            'deviceId': '00000000-0000-4000-8000-000000000098',
            'deviceName': 'POS-01',
            'deviceStatus': 'revoked',
            'operatorSessionId': '00000000-0000-4000-8000-000000000012',
            'reclaimable': true,
          };
    repository.snapshot = CashCenterSnapshot(
      businessDate: repository.snapshot.businessDate,
      policy: repository.snapshot.policy,
      registers: [register],
      ledger: const [],
      adoptableShift: null,
      currentShift: null,
      expectedCash: null,
      latestCount: null,
      varianceResolution: null,
      reconciliation: null,
      recoveryState: 'shift_required',
      allowedActions: const ['open_shift'],
      summary: null,
    );
    final controller = CashController(repository: repository);
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
            permissions: OperatorPermissions(const [
              'cash.shift.read',
              'cash.shift.open',
            ]),
          ),
        ),
      ),
    );
    await tester.pump();

    // The server allows opening a shift on a drawer whose terminal is gone — the
    // open takes the drawer over — but it blocks the stranded shift without a
    // count, and the form used to present that as an ordinary action.
    expect(
      find.textContaining('el turno anterior queda bloqueado'),
      findsOneWidget,
    );
    // Both ways forward are on screen, with their costs.
    expect(find.textContaining('Liberar la caja'), findsOneWidget);
    expect(find.text('Abrir turno de caja'), findsOneWidget);
  });

  testWidgets('a slow load shows the screen\'s shape, not a spinner', (
    tester,
  ) async {
    final repository = _FakeCashRepository()..holdCenter = true;
    final controller = CashController(repository: repository);
    controller.setContext(
      merchantId: '00000000-0000-4000-8000-000000000010',
      locationId: '00000000-0000-4000-8000-000000000011',
      operatorSessionId: '00000000-0000-4000-8000-000000000012',
    );
    // The load never lands inside this test: the screen is photographed waiting.
    unawaited(controller.load());
    addTearDown(tester.view.reset);
    // Two windows and one phone: the single column, the reference terminal where
    // the skeleton's own journal had no room and reported an overflow, and the
    // narrow one.
    for (final size in const [
      Size(800, 600),
      Size(1280, 720),
      Size(390, 844),
    ]) {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1.0;
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
              permissions: OperatorPermissions(const ['cash.shift.read']),
            ),
          ),
        ),
      );
      await tester.pump();

      // The repo's own checklist asks a loading state to show "progress in the
      // shape of the coming content". A centred spinner is progress without a
      // shape: the operator waits, and then the whole screen arrives at once and
      // moves everything they were looking at. The pump itself is the other
      // assertion — a skeleton that does not fit its window fails the test.
      expect(find.byKey(const ValueKey('cash-skeleton')), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      // The app bar still says the screen is working on it.
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
    }
  });

  testWidgets('a drawer that did not open is said out loud', (tester) async {
    final repository = _FakeCashRepository();
    final controller = CashController(
      repository: repository,
      // The hardware layer answers per command: false means the pulse never
      // landed. The ledger committed either way — that is the whole point.
      afterCommit: (_) async => false,
    );
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
            permissions: OperatorPermissions(const [
              'cash.shift.read',
              'cash.shift.open',
            ]),
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.textContaining('El cajón no respondió'), findsNothing);

    // Opening a shift asks the drawer to open. It does not.
    await controller.openShift(
      registerId: '00000000-0000-4000-8000-000000000001',
      amountMinorUnits: 2000,
    );
    // The hardware answer arrives after the command commits, off the command's
    // own future. Pumps, not a real delay: this test runs on a fake clock.
    await tester.pump();
    await tester.pump();

    expect(controller.state.drawerUnanswered, isTrue);
    expect(find.textContaining('El cajón no respondió'), findsOneWidget);
    // It says what stands: the operation is recorded, the drawer is the part
    // that needs a hand. Calling this a failed cash operation would be a lie.
    expect(
      find.textContaining('La operación quedó registrada'),
      findsOneWidget,
    );
    expect(find.textContaining('No fue posible completar'), findsNothing);
  });

  testWidgets('a role that can only look is told why', (tester) async {
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
            permissions: OperatorPermissions(const ['cash.shift.read']),
          ),
        ),
      ),
    );
    await tester.pump();

    // The screen used to answer a limited role by drawing fewer buttons and
    // saying nothing, which reads as a console that is broken. It says which it
    // is, and what to do instead.
    expect(find.text('Solo consulta'), findsOneWidget);
    expect(
      find.textContaining('no hay acciones de caja para este turno'),
      findsOneWidget,
    );
    // The rules still apply to the person who cannot act on them.
    expect(find.text('Política de la caja'), findsOneWidget);
    // And there really is nothing to press on the drawer itself.
    expect(find.byType(OutlinedButton), findsNothing);
    expect(find.text('Iniciar conteo ciego'), findsNothing);
  });

  testWidgets('the state strip says when the drawer was last read', (
    tester,
  ) async {
    final repository = _FakeCashRepository();
    final controller = CashController(repository: repository);
    controller.setContext(
      merchantId: '00000000-0000-4000-8000-000000000010',
      locationId: '00000000-0000-4000-8000-000000000011',
      operatorSessionId: '00000000-0000-4000-8000-000000000012',
    );
    // Nothing has been read yet: there is no moment to name.
    expect(controller.lastReadAt, isNull);

    await controller.load();
    await controller.openShift(
      registerId: '00000000-0000-4000-8000-000000000001',
      amountMinorUnits: 2000,
    );
    final readAt = controller.lastReadAt;
    expect(readAt, isNotNull);

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
            permissions: OperatorPermissions(const ['cash.shift.read']),
          ),
        ),
      ),
    );
    await tester.pump();

    // The figures on this screen are one moment's reading, and the screen says
    // which moment: the disagreement about a drawer is usually a disagreement
    // about when somebody looked.
    final hh = readAt!.hour.toString().padLeft(2, '0');
    final mm = readAt.minute.toString().padLeft(2, '0');
    expect(find.text('Actualizado $hh:$mm'), findsOneWidget);
  });

  testWidgets('a movement the parser refuses is corrected, never discarded', (
    tester,
  ) async {
    final repository = _FakeCashRepository();
    await _seedOpenShift(repository);
    final controller = CashController(repository: repository);
    controller.setContext(
      merchantId: '00000000-0000-4000-8000-000000000010',
      locationId: '00000000-0000-4000-8000-000000000011',
      operatorSessionId: '00000000-0000-4000-8000-000000000012',
    );
    await controller.load();
    tester.view.physicalSize = const Size(1920, 1080);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
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
            permissions: OperatorPermissions(const [
              'cash.shift.read',
              'cash.movement.paid_in',
            ]),
          ),
        ),
      ),
    );
    await tester.pump();

    await tester.tap(find.text('Entrada de efectivo'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    FilledButton confirm() => tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Confirmar movimiento de caja'),
    );

    // The empty form states its requirements and will not submit. Before this,
    // an amount the parser refused closed the dialog and did nothing: no
    // movement, no message, the operator's typing gone.
    expect(confirm().onPressed, isNull);
    expect(
      find.text('Escribe un monto válido, por ejemplo 1,500.00.'),
      findsOneWidget,
    );
    expect(find.text('Escribe el motivo del movimiento.'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, 'no es un monto');
    await tester.pump();
    expect(confirm().onPressed, isNull);

    await tester.enterText(find.byType(TextField).first, '120');
    await tester.enterText(find.byType(TextField).last, 'hielo');
    await tester.pump();
    expect(confirm().onPressed, isNotNull);

    // 120 is over the fixture's 50 threshold, so the manager is asked next — and
    // the manager is shown what they are approving.
    await tester.tap(
      find.widgetWithText(FilledButton, 'Confirmar movimiento de caja'),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Se requiere aprobación del gerente'), findsOneWidget);
    expect(_inApproval('Entrada de efectivo'), findsOneWidget);
    expect(_inApproval('MXN 120.00'), findsOneWidget);
    expect(_inApproval('hielo'), findsOneWidget);
  });

  testWidgets('an approval the till refuses is said out loud, and the amount '
      'survives it', (tester) async {
    // The drawer could not be topped up, and the till said nothing about it.
    // `approveMovement` runs outside the controller's guarded operation, so a
    // refusal from it left `_movement` as an unhandled exception: the dialog was
    // already gone, the amount and the reason were discarded, and the screen
    // looked exactly like a button that does not work.
    final repository = _FakeCashRepository()
      ..approvalFailureCode = 'PERMISSION_DENIED';
    await _seedOpenShift(repository);
    final controller = CashController(repository: repository);
    controller.setContext(
      merchantId: '00000000-0000-4000-8000-000000000010',
      locationId: '00000000-0000-4000-8000-000000000011',
      operatorSessionId: '00000000-0000-4000-8000-000000000012',
    );
    await controller.load();
    tester.view.physicalSize = const Size(1920, 1080);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
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
            permissions: OperatorPermissions(const ['cash.movement.paid_in']),
          ),
        ),
      ),
    );
    await tester.pump();

    await tester.tap(find.text('Entrada de efectivo'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    await tester.enterText(find.byType(TextField).first, '500');
    await tester.enterText(find.byType(TextField).last, 'faltante de cambio');
    await tester.pump();
    await tester.tap(
      find.widgetWithText(FilledButton, 'Confirmar movimiento de caja'),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    // 500 is over the fixture's 50 threshold, so the manager is asked. The PIN
    // is entered the way a till asks for it — on the keypad — and refused the
    // way the API refuses a credential that matched nothing.
    await _tapPin(tester, '3333');
    await tester.tap(find.widgetWithText(FilledButton, 'Autorizar'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    // The refusal is on the dialog that caused it, in words that say what to do
    // about it, and the dialog is still open rather than gone — with the amount
    // and the reason still on screen. Another manager's PIN could still work, so
    // the keypad stays live.
    expect(_inApprovalMessage('Ese PIN no autoriza este movimiento'), findsOneWidget);
    expect(find.text('Se requiere aprobación del gerente'), findsOneWidget);
    expect(_inApproval('MXN 500.00'), findsOneWidget);
    expect(_inApproval('faltante de cambio'), findsOneWidget);
    expect(_approvalKey(tester, '1').onPressed, isNotNull);
  });

  testWidgets('a rate-locked till says so and stops inviting a PIN', (
    tester,
  ) async {
    // PIN_LOCKED means no credential on this device will be accepted for the
    // next few minutes. The dialog used to answer that by inviting the same
    // keystrokes again and, before that, by naming two different causes in one
    // sentence. It now says the one true thing and greys the pad.
    final repository = _FakeCashRepository()
      ..approvalFailureCode = 'PIN_LOCKED';
    await _seedOpenShift(repository);
    final controller = CashController(repository: repository);
    controller.setContext(
      merchantId: '00000000-0000-4000-8000-000000000010',
      locationId: '00000000-0000-4000-8000-000000000011',
      operatorSessionId: '00000000-0000-4000-8000-000000000012',
    );
    await controller.load();
    tester.view.physicalSize = const Size(1920, 1080);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
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
            permissions: OperatorPermissions(const ['cash.movement.paid_in']),
          ),
        ),
      ),
    );
    await tester.pump();

    await tester.tap(find.text('Entrada de efectivo'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.enterText(find.byType(TextField).first, '500');
    await tester.enterText(find.byType(TextField).last, 'faltante de cambio');
    await tester.pump();
    await tester.tap(
      find.widgetWithText(FilledButton, 'Confirmar movimiento de caja'),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    await _tapPin(tester, '3333');
    await tester.tap(find.widgetWithText(FilledButton, 'Autorizar'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(
      _inApprovalMessage('El PIN está bloqueado en esta caja unos minutos'),
      findsOneWidget,
    );
    expect(_approvalKey(tester, '1').onPressed, isNull);
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Autorizar'))
          .onPressed,
      isNull,
    );
  });

  testWidgets('the movement dialog states the amount that asks for a PIN', (
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
            permissions: OperatorPermissions(const [
              'cash.movement.paid_in',
              'cash.movement.paid_out',
            ]),
          ),
        ),
      ),
    );
    await tester.pump();

    await tester.tap(find.text('Entrada de efectivo'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    // The rule that decides whether a second dialog appears is stated before the
    // operator types anything, so the PIN is never a surprise.
    expect(
      find.text('A partir de MXN 50.00 se pide el PIN del encargado.'),
      findsOneWidget,
    );
  });

  testWidgets('the variance reason is chosen, never preselected', (
    tester,
  ) async {
    final repository = _FakeCashRepository()..countVarianceMinorUnits = -150;
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
    await controller.submitCount(amountMinorUnits: 1850);
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
            permissions: OperatorPermissions(const [
              'cash.count.submit',
              'cash.count.recount',
              'cash.reconcile',
            ]),
          ),
        ),
      ),
    );
    await tester.pump();

    // The next step sits at the foot of the close card, which is below the fold
    // on this test's 800 x 600 surface: bring it into view before pressing it.
    final reasonAction = find.widgetWithText(
      FilledButton,
      'Motivo de la diferencia',
    );
    await tester.ensureVisible(reasonAction);
    await tester.pumpAndSettle();
    await tester.tap(reasonAction);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    // The dialog explains the number it is about, and it does not answer for the
    // operator: the list starts empty and the confirm waits for a choice.
    expect(
      find.textContaining('Diferencia: −MXN 1.50 · Fuera de tolerancia'),
      findsOneWidget,
    );
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Confirmar'))
          .onPressed,
      isNull,
    );

    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Error de conteo').last);
    await tester.pumpAndSettle();

    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Confirmar'))
          .onPressed,
      isNotNull,
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Confirmar'));
    await tester.pumpAndSettle();
    expect(repository.resolvedWith?.reason, 'counting_error');
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

  const orphanShift = {
    'id': '00000000-0000-4000-8000-000000000031',
    'registerId': '00000000-0000-4000-8000-000000000001',
    'status': 'open',
    'version': 3,
    'holdingDeviceId': '00000000-0000-4000-8000-000000000098',
    'operatorSessionId': '00000000-0000-4000-8000-000000000013',
  };

  CashCenterSnapshot orphanedSnapshot(CashCenterSnapshot base) =>
      CashCenterSnapshot(
        businessDate: base.businessDate,
        policy: base.policy,
        registers: base.registers,
        ledger: const [],
        adoptableShift: orphanShift,
        currentShift: null,
        expectedCash: null,
        latestCount: null,
        varianceResolution: null,
        reconciliation: null,
        recoveryState: 'device_adoption_required',
        allowedActions: const ['adopt_shift'],
        summary: null,
      );

  test(
    'adopts the shift left open on a terminal that lost its identity',
    () async {
      final repository = _FakeCashRepository();
      repository.snapshot = orphanedSnapshot(repository.snapshot);
      final controller = CashController(repository: repository);
      controller.setContext(
        merchantId: '00000000-0000-4000-8000-000000000010',
        locationId: '00000000-0000-4000-8000-000000000011',
        operatorSessionId: '00000000-0000-4000-8000-000000000012',
      );
      await controller.load();
      expect(controller.state.snapshot?.adoptableShift, isNotNull);

      await controller.adoptShift();

      // The shift it takes over is the orphan, at the version the snapshot reported.
      expect(repository.adoptedWith?.shiftId, orphanShift['id']);
      expect(repository.adoptedWith?.expectedShiftVersion, 3);
      // And it is now this terminal's own shift, not an adoptable one.
      expect(controller.state.snapshot?.adoptableShift, isNull);
      expect(controller.state.snapshot?.currentShift?['status'], 'open');
    },
  );

  testWidgets(
    'offers to bring the shift over instead of a dead open-shift form',
    (tester) async {
      final repository = _FakeCashRepository();
      repository.snapshot = orphanedSnapshot(repository.snapshot);
      final controller = CashController(repository: repository);
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
              permissions: OperatorPermissions(const [
                'cash.shift.open',
                'cash.shift.resume',
              ]),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(
        find.text('Tu turno sigue abierto en otra terminal'),
        findsOneWidget,
      );
      // The open-shift form would be a trap here: the register is held, so opening
      // another shift on it can only fail.
      expect(find.text('Abrir turno de caja'), findsNothing);

      await tester.tap(find.text('Traer el turno a esta terminal'));
      await tester.pumpAndSettle();
      expect(repository.adoptedWith, isNotNull);
    },
  );

  testWidgets('opens a shift with the counted denomination total', (
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

    // The opening float is now counted on the denomination keypad (audit F3),
    // so there is no free-text amount to mistype. Tapping the MXN 1000 and
    // MXN 500 rows once each totals 1,500.00 — the same drawer, counted, not
    // typed.
    final button = find.widgetWithText(FilledButton, 'Abrir turno de caja');
    final adds = find.byIcon(Icons.add_circle_outline);
    expect(adds, findsWidgets);
    await tester.ensureVisible(adds.at(0));
    await tester.tap(adds.at(0)); // MXN 1000.00
    await tester.pump();
    await tester.ensureVisible(adds.at(1));
    await tester.tap(adds.at(1)); // MXN 500.00
    await tester.pump();

    expect(tester.widget<FilledButton>(button).onPressed, isNotNull);

    await tester.ensureVisible(button);
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pumpAndSettle();
    // One thousand five hundred pesos, summed from the counted denominations.
    expect(repository.openedWith?.openingFloat['minorUnits'], 150000);
  });
}
