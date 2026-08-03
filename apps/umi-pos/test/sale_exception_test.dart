import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/features/exception/exception_controller.dart';
import 'package:umi_pos/features/exception/exception_recovery_store.dart';
import 'package:umi_pos/features/exception/exception_repository.dart';
import 'package:umi_pos/features/exception/exception_surface.dart';

const merchant = '00000000-0000-4000-8000-000000000001';
const location = '00000000-0000-4000-8000-000000000002';
const operatorSession = '00000000-0000-4000-8000-000000000003';
const sale = '00000000-0000-4000-8000-000000000004';
const line = '00000000-0000-4000-8000-000000000005';

Map<String, Object?> money(int value) => {
  'minorUnits': value,
  'currency': 'MXN',
};

SaleExceptionEligibility testEligibility({
  bool blocked = false,
}) => SaleExceptionEligibility(
  sale: {
    'saleId': sale,
    'receiptId': '00000000-0000-4000-8000-000000000006',
    'receiptReference': 'R-100',
    'businessDate': '2026-08-03',
    'committedAt': '2026-08-03T12:00:00.000Z',
    'version': 3,
    'currency': 'MXN',
    'originalTotal': money(15000),
    'previouslyRefunded': money(0),
    'remainingRefundable': money(15000),
  },
  allowedTypes: blocked
      ? const []
      : const ['full_refund', 'partial_refund', 'void'],
  refund: {
    'allowed': !blocked,
    'fullRefundAllowed': !blocked,
    'partialRefundAllowed': !blocked,
    'cashRefundAllowed': !blocked,
    'manualTerminalRefundAllowed': !blocked,
    'approvalRequired': false,
    'approvalThreshold': money(20000),
    'lines': <Object?>[
      {
        'saleLineId': line,
        'productReference': 'CAF-LAT',
        'displayName': 'Latte',
        'isService': false,
        'quantity': {'original': 2, 'previouslyRefunded': 0, 'remaining': 2},
        'merchandise': money(13000),
        'tax': money(2000),
        'discount': money(0),
        'tip': money(0),
        'total': money(15000),
        'restockOptions': <Object?>['restock', 'do_not_restock'],
      },
    ],
    'refundableTax': money(2000),
    'refundableDiscount': money(0),
    'refundableTip': money(0),
    'blockCodes': blocked ? <Object?>['policy_window_expired'] : <Object?>[],
    'supportCodes': <Object?>[],
  },
  voidEligibility: {
    'allowed': !blocked,
    'blockCodes': <Object?>[],
    'approvalRequired': true,
    'windowEndsAt': '2026-08-03T13:00:00.000Z',
  },
  allocationPolicy: 'proportional',
  tipPolicy: 'non_refundable',
  onlineRequired: true,
  correlationReference: 'correlation-1',
);

RefundPreview testPreview({bool approval = false, bool terminal = false}) =>
    RefundPreview(
      previewId: '00000000-0000-4000-8000-000000000007',
      saleId: sale,
      originalReceiptId: '00000000-0000-4000-8000-000000000006',
      exceptionType: 'partial_refund',
      status: 'preview_ready',
      lines: [
        {
          'saleLineId': line,
          'quantity': 1,
          'merchandise': money(6500),
          'tax': money(1000),
          'discount': money(0),
          'tip': money(0),
          'total': money(7500),
          'restockDecision': 'restock',
        },
      ],
      allocation: {
        'merchandise': money(6500),
        'tax': money(1000),
        'discount': money(0),
        'tip': money(0),
        'total': money(7500),
      },
      tax: {'amount': money(1000), 'historical': true},
      discount: {'amount': money(0), 'historical': true},
      tip: {'amount': money(0), 'policy': 'non_refundable'},
      tenders: [
        {
          'originalTenderId': '00000000-0000-4000-8000-000000000008',
          'tenderType': terminal ? 'manual_terminal' : 'cash',
          'amount': money(7500),
          'strategy': 'proportional',
        },
      ],
      cash: terminal ? null : {'amount': money(7500)},
      manualTerminal: terminal
          ? {
              'status': 'awaiting_operator_confirmation',
              'amount': money(7500),
              'correlationReference': 'correlation-1',
              'queryOnly': false,
              'canRetryAsNew': true,
            }
          : null,
      remainingRefundableAfter: money(7500),
      approvalRequired: approval,
      reason: 'product_defect',
      previewFingerprint: 'a' * 64,
      expiresAt: '2026-08-03T13:00:00.000Z',
      saleVersion: 3,
      exceptionVersion: 0,
      correlationReference: 'correlation-1',
    );

SaleExceptionResult testResult() => SaleExceptionResult(
  exceptionId: '00000000-0000-4000-8000-000000000009',
  saleId: sale,
  status: 'committed',
  exceptionType: 'partial_refund',
  allocation: {'total': money(7500)},
  receipt: {'publicReference': 'EX-100'},
  remainingRefundable: money(7500),
  correlationReference: 'correlation-1',
  committedAt: '2026-08-03T12:10:00.000Z',
  retryAllowed: false,
);

ManualTerminalRefundOutcomeResult terminalResult(
  String previewId,
  String outcome,
) => ManualTerminalRefundOutcomeResult(
  previewId: previewId,
  status: outcome,
  instruction: {
    'status': outcome,
    'amount': money(7500),
    'correlationReference': 'correlation-1',
    'queryOnly': outcome == 'outcome_unknown',
    'canRetryAsNew': false,
  },
  updatedAt: '2026-08-03T12:05:00.000Z',
  correlationReference: 'correlation-1',
);

final class TestExceptionRepository implements SaleExceptionRepository {
  SaleExceptionEligibility nextEligibility = testEligibility();
  RefundPreview nextPreview = testPreview();
  SaleExceptionResult nextResult = testResult();
  ExceptionCommandRecoveryResult nextRecovery =
      const ExceptionCommandRecoveryResult(
        state: 'query_original_command',
        result: null,
        terminalOutcome: null,
        commandType: null,
        queryOnly: true,
        safeAction: 'query_again',
      );
  RefundPreviewRequest? previewRequest;
  RefundApprovalRequest? approvalRequest;
  SaleExceptionCommand? commitRequest;
  bool failCommit = false;
  int terminalFailuresRemaining = 0;
  final List<ManualTerminalRefundOutcomeRequest> terminalRequests = [];

  @override
  Future<SaleExceptionEligibility> eligibility(
    String merchantId,
    String saleId,
    SaleExceptionEligibilityQuery query,
  ) async => nextEligibility;

  @override
  Future<ExceptionHistory> history(
    String merchantId,
    String saleId,
    SaleExceptionEligibilityQuery query,
  ) async => const ExceptionHistory(sale: {}, entries: [], nextCursor: null);

  @override
  Future<RefundPreview> preview(
    String merchantId,
    String saleId,
    RefundPreviewRequest request,
  ) async {
    previewRequest = request;
    return nextPreview;
  }

  @override
  Future<RefundApprovalResult> approve(
    String merchantId,
    String saleId,
    RefundApprovalRequest request,
  ) async {
    approvalRequest = request;
    return RefundApprovalResult(
      approvalId: '00000000-0000-4000-8000-000000000010',
      approvingOperatorReference: 'Manager',
      previewFingerprint: request.previewFingerprint,
      expiresAt: '2026-08-03T13:00:00.000Z',
      oneUse: true,
    );
  }

  @override
  Future<ManualTerminalRefundOutcomeResult> terminalOutcome(
    String merchantId,
    String saleId,
    String previewId,
    ManualTerminalRefundOutcomeRequest request,
  ) async {
    terminalRequests.add(request);
    if (terminalFailuresRemaining > 0) {
      terminalFailuresRemaining -= 1;
      throw const AppException(
        category: AppErrorCategory.transport,
        code: 'NETWORK_UNAVAILABLE',
        recoverable: true,
      );
    }
    return terminalResult(previewId, request.outcome);
  }

  @override
  Future<SaleExceptionResult> commit(
    String merchantId,
    String saleId,
    SaleExceptionCommand command,
  ) async {
    commitRequest = command;
    if (failCommit) {
      throw const AppException(
        category: AppErrorCategory.transport,
        code: 'NETWORK_UNAVAILABLE',
        recoverable: true,
      );
    }
    return nextResult;
  }

  @override
  Future<ExceptionCommandRecoveryResult> recover(
    String merchantId,
    ExceptionCommandRecoveryQuery query,
  ) async => nextRecovery;
}

SaleExceptionController controller(
  TestExceptionRepository repository, {
  MemorySaleExceptionRecoveryStore? recovery,
}) => SaleExceptionController(
  repository: repository,
  recoveryStore: recovery ?? MemorySaleExceptionRecoveryStore(),
);

Future<void> setContext(SaleExceptionController value) => value.setContext(
  merchantId: merchant,
  locationId: location,
  operatorSessionId: operatorSession,
);

void main() {
  test('loads server eligibility and keeps the online-only boundary', () async {
    final repository = TestExceptionRepository();
    final value = controller(repository);
    await setContext(value);
    await value.load(sale);
    expect(value.state.phase, SaleExceptionPhase.eligible);
    expect(value.state.eligibility?.onlineRequired, isTrue);
  });

  test(
    'shows a typed blocked state when the server denies eligibility',
    () async {
      final repository = TestExceptionRepository()
        ..nextEligibility = testEligibility(blocked: true);
      final value = controller(repository);
      await setContext(value);
      await value.load(sale);
      expect(value.state.phase, SaleExceptionPhase.blocked);
    },
  );

  test('sends selected quantities and uses the server preview total', () async {
    final repository = TestExceptionRepository();
    final value = controller(repository);
    await setContext(value);
    await value.load(sale);
    await value.createPreview(
      exceptionType: 'partial_refund',
      reason: 'product_defect',
      lines: [
        {'saleLineId': line, 'quantity': 1, 'restockDecision': 'restock'},
      ],
    );
    expect(repository.previewRequest?.lines.single['quantity'], 1);
    expect(value.state.preview?.allocation['total'], money(7500));
  });

  test('keeps a manual terminal unknown outcome query-only', () async {
    final repository = TestExceptionRepository()
      ..nextPreview = testPreview(terminal: true);
    final value = controller(repository);
    await setContext(value);
    await value.load(sale);
    await value.createPreview(
      exceptionType: 'partial_refund',
      reason: 'product_defect',
      lines: [
        {'saleLineId': line, 'quantity': 1, 'restockDecision': 'restock'},
      ],
    );
    await value.recordTerminalOutcome('outcome_unknown');
    expect(value.state.phase, SaleExceptionPhase.outcomeUnknown);
    expect(value.state.terminalOutcome?.instruction['queryOnly'], isTrue);
  });

  test(
    'recovers a lost terminal result with its original command identity',
    () async {
      final terminal = terminalResult(
        testPreview(terminal: true).previewId,
        'confirmed_success',
      );
      final repository = TestExceptionRepository()
        ..nextPreview = testPreview(terminal: true)
        ..terminalFailuresRemaining = 1
        ..nextRecovery = ExceptionCommandRecoveryResult(
          state: 'query_original_command',
          result: null,
          terminalOutcome: terminal.toJson(),
          commandType: 'terminal_outcome',
          queryOnly: true,
          safeAction: 'return_to_sale',
        );
      final recovery = MemorySaleExceptionRecoveryStore();
      final value = controller(repository, recovery: recovery);
      await setContext(value);
      await value.load(sale);
      await value.createPreview(
        exceptionType: 'partial_refund',
        reason: 'product_defect',
        lines: [
          {'saleLineId': line, 'quantity': 1, 'restockDecision': 'restock'},
        ],
      );
      await value.recordTerminalOutcome('confirmed_success');
      expect(value.state.phase, SaleExceptionPhase.previewReady);
      expect(value.state.terminalOutcome?.status, 'confirmed_success');
      expect(recovery.value?.commandType, 'terminal_outcome');
    },
  );

  test('restores an unknown terminal result after restart', () async {
    final preview = testPreview(terminal: true);
    final recovery = MemorySaleExceptionRecoveryStore();
    await recovery.save(
      PendingSaleException(
        merchantId: merchant,
        locationId: location,
        operatorSessionId: operatorSession,
        saleId: sale,
        commandId: '00000000-0000-4000-8000-000000000030',
        idempotencyKey: '00000000-0000-4000-8000-000000000031',
        commandType: 'terminal_outcome',
        requestedTerminalOutcome: 'outcome_unknown',
        preview: preview.toJson(),
      ),
    );
    final repository = TestExceptionRepository()
      ..nextRecovery = ExceptionCommandRecoveryResult(
        state: 'outcome_unknown',
        result: null,
        terminalOutcome: terminalResult(
          preview.previewId,
          'outcome_unknown',
        ).toJson(),
        commandType: 'terminal_outcome',
        queryOnly: true,
        safeAction: 'verify_terminal',
      );
    final value = controller(repository, recovery: recovery);
    await setContext(value);
    expect(value.state.phase, SaleExceptionPhase.outcomeUnknown);
    expect(value.state.terminalOutcome?.instruction['queryOnly'], isTrue);
  });

  test(
    'resubmits an unrecorded terminal command with the same identity',
    () async {
      final repository = TestExceptionRepository()
        ..nextPreview = testPreview(terminal: true)
        ..terminalFailuresRemaining = 1;
      final recovery = MemorySaleExceptionRecoveryStore();
      final value = controller(repository, recovery: recovery);
      await setContext(value);
      await value.load(sale);
      await value.createPreview(
        exceptionType: 'partial_refund',
        reason: 'product_defect',
        lines: [
          {'saleLineId': line, 'quantity': 1, 'restockDecision': 'restock'},
        ],
      );

      await value.recordTerminalOutcome('confirmed_success');

      expect(value.state.phase, SaleExceptionPhase.previewReady);
      expect(repository.terminalRequests, hasLength(2));
      expect(
        repository.terminalRequests[1].commandId,
        repository.terminalRequests[0].commandId,
      );
      expect(
        repository.terminalRequests[1].idempotencyKey,
        repository.terminalRequests[0].idempotencyKey,
      );
      expect(repository.terminalRequests[1].outcome, 'confirmed_success');
    },
  );

  test('sends the manager PIN without placing it in recovery state', () async {
    final repository = TestExceptionRepository()
      ..nextPreview = testPreview(approval: true);
    final recovery = MemorySaleExceptionRecoveryStore();
    final value = controller(repository, recovery: recovery);
    await setContext(value);
    await value.load(sale);
    await value.createPreview(
      exceptionType: 'partial_refund',
      reason: 'product_defect',
      lines: [
        {'saleLineId': line, 'quantity': 1, 'restockDecision': 'restock'},
      ],
    );
    await value.approve('2468');
    expect(repository.approvalRequest?.managerPin, '2468');
    expect(recovery.value, isNull);
    expect(value.state.approval?.oneUse, isTrue);
  });

  test('commits once and clears the encrypted recovery boundary', () async {
    final repository = TestExceptionRepository();
    final recovery = MemorySaleExceptionRecoveryStore();
    final value = controller(repository, recovery: recovery);
    await setContext(value);
    await value.load(sale);
    await value.createPreview(
      exceptionType: 'partial_refund',
      reason: 'product_defect',
      lines: [
        {'saleLineId': line, 'quantity': 1, 'restockDecision': 'restock'},
      ],
    );
    await value.commit();
    expect(value.state.phase, SaleExceptionPhase.committed);
    expect(repository.commitRequest?.offline, isFalse);
    expect(recovery.value, isNull);
  });

  test('recovers the original result after response loss', () async {
    final repository = TestExceptionRepository()
      ..failCommit = true
      ..nextRecovery = ExceptionCommandRecoveryResult(
        state: 'committed_result_available',
        result: testResult().toJson(),
        terminalOutcome: null,
        commandType: 'exception_commit',
        queryOnly: true,
        safeAction: 'return_to_sale',
      );
    final value = controller(repository);
    await setContext(value);
    await value.load(sale);
    await value.createPreview(
      exceptionType: 'partial_refund',
      reason: 'product_defect',
      lines: [
        {'saleLineId': line, 'quantity': 1, 'restockDecision': 'restock'},
      ],
    );
    await value.commit();
    expect(value.state.phase, SaleExceptionPhase.recovered);
    expect(value.state.result?.exceptionId, testResult().exceptionId);
  });

  testWidgets('renders localized exception choices with screen semantics', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    final value = controller(TestExceptionRepository());
    await setContext(value);
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
        home: Builder(
          builder: (context) => Scaffold(
            body: FilledButton(
              onPressed: () => showSaleExceptionDialog(
                context,
                controller: value,
                saleId: sale,
              ),
              child: const Text('abrir'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();
    expect(find.text('Reembolso total'), findsOneWidget);
    expect(find.text('Reembolso parcial'), findsOneWidget);
    expect(find.text('Anular venta'), findsOneWidget);
    expect(find.text('full_refund'), findsNothing);
    semantics.dispose();
  });
}
