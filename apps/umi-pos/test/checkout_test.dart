import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/checkout/checkout_controller.dart';
import 'package:umi_pos/features/checkout/checkout_repository.dart';
import 'package:umi_pos/features/checkout/checkout_surface.dart';

import 'support/fakes.dart';

const _confirmation = {
  'cartVersion': 3,
  'fingerprint':
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'totals': {
    'subtotal': {'minorUnits': 11600, 'currency': 'MXN'},
    'tax': {'minorUnits': 1600, 'currency': 'MXN'},
    'discounts': {
      'total': {'minorUnits': 0, 'currency': 'MXN'},
      'entries': <Object?>[],
    },
    'grandTotal': {'minorUnits': 11600, 'currency': 'MXN'},
    'businessDate': '2026-07-28',
  },
  'taxes': {
    'total': {'minorUnits': 1600, 'currency': 'MXN'},
    'entries': <Object?>[],
  },
  'discounts': {
    'total': {'minorUnits': 0, 'currency': 'MXN'},
    'entries': <Object?>[],
  },
  'confirmedAt': null,
};
const _policy = {
  'version': 'test-1',
  'manualTerminalEnabled': true,
  'mixedTenderEnabled': true,
  'maximumTenderLines': 8,
  'manualTerminalApprovalThreshold': {'minorUnits': 50000, 'currency': 'MXN'},
  'manualTerminalApprovalPermission': 'checkout.terminal.approve',
  'tip': {
    'enabled': true,
    'presetBasisPoints': [1000, 1500, 2000],
    'customPercentageEnabled': true,
    'customFixedEnabled': true,
    'maximumTip': {'minorUnits': 5000, 'currency': 'MXN'},
    'requiredPermission': null,
    'version': 'test-1',
  },
  'discount': {
    'enabled': true,
    'maximumBasisPoints': 3000,
    'maximumAmount': {'minorUnits': 5000, 'currency': 'MXN'},
    'cashierThreshold': {'minorUnits': 1000, 'currency': 'MXN'},
    'customRequiresApproval': true,
    'requiredPermission': 'checkout.discount.apply',
    'approvalPermission': 'checkout.discount.approve',
    'version': 'test-1',
  },
};

final class _CheckoutRepository implements CheckoutRepository {
  _CheckoutRepository({
    this.unknown = false,
    this.loseCommitResponseOnce = false,
    this.recoverySnapshot,
    this.paymentStatusValue = 'unknown',
  });
  final bool unknown;
  final bool loseCommitResponseOnce;
  final CheckoutRecoverySnapshot? recoverySnapshot;
  final String paymentStatusValue;
  bool responseLost = false;
  final commands = <CheckoutCommand>[];
  final cancellations = <CheckoutCancellationRequest>[];

  @override
  Future<CheckoutResult> checkout(
    String tenantId,
    CheckoutCommand command,
  ) async {
    commands.add(command);
    if (command.totalsFingerprint == null) {
      return const CheckoutResult(
        status: 'confirmation_required',
        confirmation: _confirmation,
        payment: null,
        reservation: null,
        sale: null,
        receipt: null,
        failure: {
          'code': 'CHECKOUT_CONFIRMATION_REQUIRED',
          'retryable': false,
          'operatorGuidance': 'confirm_totals',
          'correlationId': 'checkout-test',
        },
        policy: _policy,
      );
    }
    if (loseCommitResponseOnce && !responseLost) {
      responseLost = true;
      throw const AppException(
        category: AppErrorCategory.transport,
        code: 'TRANSPORT_FAILURE',
        recoverable: true,
      );
    }
    if (unknown) {
      return const CheckoutResult(
        status: 'payment_unknown',
        confirmation: _confirmation,
        payment: {
          'attempt': {
            'id': '00000000-0000-4000-8000-000000000010',
            'method': 'external_terminal',
            'amount': {'minorUnits': 11600, 'currency': 'MXN'},
            'status': 'unknown',
            'expiresAt': '2026-07-28T20:00:00.000Z',
            'correlationId': 'checkout-test',
            'queryOnly': true,
            'createdAt': '2026-07-28T19:00:00.000Z',
          },
          'ambiguity': {
            'paymentRef': '00000000-0000-4000-8000-000000000010',
            'status': 'unknown',
            'queryOnly': true,
            'canRetryAsNew': false,
            'queryAfter': '2026-07-28T20:00:00.000Z',
            'correlationId': 'checkout-test',
          },
        },
        reservation: {
          'id': '00000000-0000-4000-8000-000000000011',
          'status': 'reserved',
          'expiresAt': '2026-07-28T20:00:00.000Z',
          'lineCount': 1,
        },
        sale: null,
        receipt: null,
        failure: {
          'code': 'PAYMENT_UNKNOWN',
          'retryable': false,
          'operatorGuidance': 'query_payment',
          'correlationId': 'checkout-test',
        },
        recoveryState: 'terminal_outcome_unknown',
        policy: _policy,
      );
    }
    return const CheckoutResult(
      status: 'completed',
      confirmation: _confirmation,
      payment: null,
      reservation: null,
      sale: {
        'id': '00000000-0000-4000-8000-000000000012',
        'orderId': '00000000-0000-4000-8000-000000000013',
        'receiptRef': 'POS-test',
        'status': 'committed',
        'committedAt': '2026-07-28T19:00:00.000Z',
        'totals': _confirmation,
      },
      receipt: {
        'receiptRef': 'POS-test',
        'tenantId': '00000000-0000-4000-8000-000000000001',
        'branchId': '00000000-0000-4000-8000-000000000002',
        'issuedAt': '2026-07-28T19:00:00.000Z',
        'businessDate': '2026-07-28',
        'lines': [
          {
            'lineRef': 'line-1',
            'description': 'Café',
            'quantity': 1,
            'unitPrice': {'minorUnits': 11600, 'currency': 'MXN'},
            'lineTotal': {'minorUnits': 11600, 'currency': 'MXN'},
          },
        ],
        'subtotal': {'minorUnits': 11600, 'currency': 'MXN'},
        'taxTotal': {'minorUnits': 1600, 'currency': 'MXN'},
        'grandTotal': {'minorUnits': 11600, 'currency': 'MXN'},
        'currency': 'MXN',
        'version': 1,
      },
      failure: null,
      policy: _policy,
    );
  }

  @override
  Future<PaymentOutcome> paymentStatus(
    String tenantId,
    String paymentId,
    PaymentStatusQuery query,
  ) async => PaymentOutcome.fromJson({
    'attempt': {
      'id': paymentId,
      'method': 'external_terminal',
      'amount': {'minorUnits': 11600, 'currency': 'MXN'},
      'status': paymentStatusValue,
      'expiresAt': '2026-07-28T20:00:00.000Z',
      'correlationId': 'checkout-test',
      'queryOnly': true,
      'createdAt': '2026-07-28T19:00:00.000Z',
    },
    'ambiguity': {
      'paymentRef': paymentId,
      'status': 'unknown',
      'queryOnly': true,
      'canRetryAsNew': false,
      'queryAfter': '2026-07-28T20:00:00.000Z',
      'correlationId': 'checkout-test',
    },
  });

  @override
  Future<CheckoutRecoverySnapshot> recovery(
    String tenantId,
    String cartId,
    CheckoutRecoveryQuery query,
  ) async {
    final snapshot = recoverySnapshot;
    if (snapshot != null) return snapshot;
    throw const AppException(
      category: AppErrorCategory.permission,
      code: 'RESOURCE_NOT_FOUND',
      recoverable: false,
    );
  }

  @override
  Future<CheckoutCancellationResult> cancel(
    String tenantId,
    String cartId,
    CheckoutCancellationRequest request,
  ) async {
    cancellations.add(request);
    return CheckoutCancellationResult(
      cartId: cartId,
      checkoutId: '00000000-0000-4000-8000-000000000020',
      state: 'ready',
      cancelledAt: '2026-07-29T12:00:00.000Z',
    );
  }
}

final class _CartRepository implements CartRepository {
  final cart = Cart(
    id: '00000000-0000-4000-8000-000000000004',
    tenantId: '00000000-0000-4000-8000-000000000001',
    branchId: '00000000-0000-4000-8000-000000000002',
    operatorSessionId: '00000000-0000-4000-8000-000000000003',
    status: 'prepared',
    version: 3,
    items: [],
    totals: _confirmation['totals']! as Map<String, Object?>,
    checkoutEnabled: false,
    checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
    updatedAt: '2026-07-28T19:00:00.000Z',
  );
  @override
  Future<Cart> create(String tenantId, CreateCartRequest request) async => cart;
  @override
  Future<Cart> read(String tenantId, CartQuery query) async => cart;
  @override
  Future<Cart> add(String tenantId, CartLineInput input) async => cart;
  @override
  Future<Cart> update(
    String tenantId,
    String lineId,
    CartLineInput input,
  ) async => cart;
  @override
  Future<Cart> remove(
    String tenantId,
    String lineId,
    RemoveCartLineRequest input,
  ) async => cart;
  @override
  Future<Cart> prepare(String tenantId, PrepareSaleRequest input) async => cart;
  @override
  Future<Cart> clear(String tenantId, ClearCartRequest input) async => cart;
}

CheckoutController _controller(_CheckoutRepository repository) =>
    CheckoutController(
      repository: repository,
      telemetry: const SafeTelemetry(
        enabled: false,
        context: TelemetryContext(
          appVersion: 'test',
          environment: 'test',
          platform: 'test',
        ),
        exporter: NoopTelemetryExporter(),
      ),
    );

void main() {
  test('requires server repricing then explicit confirmation', () async {
    final repository = _CheckoutRepository();
    final controller = _controller(repository);
    await controller.preview(
      tenantId: '00000000-0000-4000-8000-000000000001',
      branchId: '00000000-0000-4000-8000-000000000002',
      operatorSessionId: '00000000-0000-4000-8000-000000000003',
      cartId: '00000000-0000-4000-8000-000000000004',
      cartVersion: 3,
      paymentMethod: 'cash',
    );
    expect(controller.state.phase, CheckoutPhase.confirmationRequired);
    await controller.confirm();
    expect(controller.state.phase, CheckoutPhase.completed);
    expect(repository.commands[0].totalsFingerprint, isNull);
    expect(
      repository.commands[1].totalsFingerprint,
      _confirmation['fingerprint'],
    );
    expect(
      repository.commands[0].idempotencyKey,
      isNot(repository.commands[1].idempotencyKey),
    );
  });

  test('unknown external-terminal payment remains query-only', () async {
    final repository = _CheckoutRepository(unknown: true);
    final controller = _controller(repository);
    await controller.preview(
      tenantId: '00000000-0000-4000-8000-000000000001',
      branchId: '00000000-0000-4000-8000-000000000002',
      operatorSessionId: '00000000-0000-4000-8000-000000000003',
      cartId: '00000000-0000-4000-8000-000000000004',
      cartVersion: 3,
      paymentMethod: 'external_terminal',
    );
    await controller.confirm();
    expect(controller.state.phase, CheckoutPhase.paymentUnknown);
    final ambiguity =
        controller.state.result!.payment!['ambiguity']! as Map<String, Object?>;
    expect(ambiguity['canRetryAsNew'], false);
  });

  test(
    'response-loss retry preserves command identity and cannot duplicate payment',
    () async {
      final repository = _CheckoutRepository(loseCommitResponseOnce: true);
      final controller = _controller(repository);
      await controller.preview(
        tenantId: '00000000-0000-4000-8000-000000000001',
        branchId: '00000000-0000-4000-8000-000000000002',
        operatorSessionId: '00000000-0000-4000-8000-000000000003',
        cartId: '00000000-0000-4000-8000-000000000004',
        cartVersion: 3,
        paymentMethod: 'cash',
      );
      await controller.confirm();
      expect(controller.state.phase, CheckoutPhase.failure);
      await controller.confirm();
      expect(controller.state.phase, CheckoutPhase.completed);
      expect(
        repository.commands[1].commandId,
        repository.commands[2].commandId,
      );
      expect(
        repository.commands[1].idempotencyKey,
        repository.commands[2].idempotencyKey,
      );
    },
  );

  test('restart recovery restores tender drafts and unknown state', () async {
    final repository = _CheckoutRepository(
      paymentStatusValue: 'timeout',
      recoverySnapshot: const CheckoutRecoverySnapshot(
        checkoutId: '00000000-0000-4000-8000-000000000020',
        cartId: '00000000-0000-4000-8000-000000000004',
        checkoutVersion: 2,
        state: 'payment_unknown',
        tenderDrafts: [
          {
            'id': '00000000-0000-4000-8000-000000000021',
            'type': 'manual_terminal',
            'amount': {'minorUnits': 11600, 'currency': 'MXN'},
            'amountReceived': null,
            'status': 'outcome_unknown',
            'correlationId': 'terminal-test',
          },
        ],
        tipDraft: null,
        discountDrafts: [],
        receiptDelivery: {
          'destination': 'display',
          'channel': null,
          'customerContactId': null,
        },
        paymentSummary: null,
        paymentOutcome: {
          'attempt': {
            'id': '00000000-0000-4000-8000-000000000022',
            'method': 'external_terminal',
            'amount': {'minorUnits': 11600, 'currency': 'MXN'},
            'status': 'unknown',
            'expiresAt': '2026-07-29T20:10:00.000Z',
            'correlationId': 'terminal-test',
            'queryOnly': true,
            'createdAt': '2026-07-29T20:00:00.000Z',
          },
          'ambiguity': {
            'paymentRef': '00000000-0000-4000-8000-000000000022',
            'status': 'unknown',
            'queryOnly': true,
            'canRetryAsNew': false,
            'queryAfter': '2026-07-29T20:10:00.000Z',
            'correlationId': 'terminal-test',
          },
        },
        result: null,
        recoveryState: 'terminal_outcome_unknown',
        checkoutFingerprint:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        updatedAt: '2026-07-29T20:00:00.000Z',
      ),
    );
    final controller = _controller(repository);
    await controller.recover(
      tenantId: '00000000-0000-4000-8000-000000000001',
      branchId: '00000000-0000-4000-8000-000000000002',
      operatorSessionId: '00000000-0000-4000-8000-000000000003',
      cartId: '00000000-0000-4000-8000-000000000004',
      cartVersion: 3,
    );
    expect(controller.state.phase, CheckoutPhase.paymentUnknown);
    expect(controller.tenderDrafts.single['status'], 'outcome_unknown');
    await controller.queryUnknownPayment();
    expect(controller.state.phase, CheckoutPhase.paymentUnknown);
    final attempt =
        controller.state.result?.payment?['attempt'] as Map<String, Object?>;
    expect(attempt['status'], 'timeout');
  });

  test('restart recovery restores the committed receipt result', () async {
    final repository = _CheckoutRepository(
      recoverySnapshot: CheckoutRecoverySnapshot(
        checkoutId: '00000000-0000-4000-8000-000000000020',
        cartId: '00000000-0000-4000-8000-000000000004',
        checkoutVersion: 2,
        state: 'completed',
        tenderDrafts: const [],
        tipDraft: null,
        discountDrafts: const [],
        receiptDelivery: const {
          'destination': 'display',
          'channel': null,
          'customerContactId': null,
        },
        paymentSummary: null,
        paymentOutcome: null,
        result: const CheckoutResult(
          status: 'completed',
          confirmation: _confirmation,
          payment: null,
          reservation: null,
          sale: {
            'id': '00000000-0000-4000-8000-000000000030',
            'orderId': '00000000-0000-4000-8000-000000000031',
            'receiptId': '00000000-0000-4000-8000-000000000032',
            'receiptRef': 'POS-recovered',
            'status': 'committed',
            'committedAt': '2026-07-29T20:00:00.000Z',
            'totals': _confirmation,
          },
          receipt: {
            'receiptRef': 'POS-recovered',
            'tenantId': '00000000-0000-4000-8000-000000000001',
            'branchId': '00000000-0000-4000-8000-000000000002',
            'issuedAt': '2026-07-29T20:00:00.000Z',
            'businessDate': '2026-07-29',
            'lines': [],
            'subtotal': {'minorUnits': 11600, 'currency': 'MXN'},
            'taxTotal': {'minorUnits': 1600, 'currency': 'MXN'},
            'grandTotal': {'minorUnits': 11600, 'currency': 'MXN'},
            'currency': 'MXN',
            'version': 1,
          },
          failure: null,
          recoveryState: 'none',
          receiptDelivery: {
            'destination': 'display',
            'channel': null,
            'customerContactId': null,
          },
          policy: _policy,
        ).toJson(),
        recoveryState: 'none',
        checkoutFingerprint:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        updatedAt: '2026-07-29T20:00:00.000Z',
      ),
    );
    final controller = _controller(repository);
    await controller.recover(
      tenantId: '00000000-0000-4000-8000-000000000001',
      branchId: '00000000-0000-4000-8000-000000000002',
      operatorSessionId: '00000000-0000-4000-8000-000000000003',
      cartId: '00000000-0000-4000-8000-000000000004',
      cartVersion: 3,
    );
    expect(controller.state.phase, CheckoutPhase.completed);
    expect(controller.state.result?.receipt?['receiptRef'], 'POS-recovered');
  });

  test(
    'checkout cancellation clears drafts but never cancels an unknown payment',
    () async {
      final repository = _CheckoutRepository();
      final controller = _controller(repository);
      await controller.preview(
        tenantId: '00000000-0000-4000-8000-000000000001',
        branchId: '00000000-0000-4000-8000-000000000002',
        operatorSessionId: '00000000-0000-4000-8000-000000000003',
        cartId: '00000000-0000-4000-8000-000000000004',
        cartVersion: 3,
        paymentMethod: 'cash',
      );
      expect(await controller.cancel(), true);
      expect(repository.cancellations, hasLength(1));
      expect(controller.state.phase, CheckoutPhase.idle);

      final unknownRepository = _CheckoutRepository(unknown: true);
      final unknownController = _controller(unknownRepository);
      await unknownController.preview(
        tenantId: '00000000-0000-4000-8000-000000000001',
        branchId: '00000000-0000-4000-8000-000000000002',
        operatorSessionId: '00000000-0000-4000-8000-000000000003',
        cartId: '00000000-0000-4000-8000-000000000004',
        cartVersion: 3,
        paymentMethod: 'external_terminal',
      );
      await unknownController.confirm();
      expect(await unknownController.cancel(), false);
      expect(unknownRepository.cancellations, isEmpty);
    },
  );

  test(
    'passes mixed tender, tip, discount, and receipt intent through the generated contract',
    () async {
      final repository = _CheckoutRepository();
      final controller = _controller(repository);
      await controller.preview(
        tenantId: '00000000-0000-4000-8000-000000000001',
        branchId: '00000000-0000-4000-8000-000000000002',
        operatorSessionId: '00000000-0000-4000-8000-000000000003',
        cartId: '00000000-0000-4000-8000-000000000004',
        cartVersion: 3,
        paymentMethod: 'external_terminal',
        tenderDrafts: const [
          {
            'id': '00000000-0000-4000-8000-000000000301',
            'type': 'cash',
            'amount': {'minorUnits': 5800, 'currency': 'MXN'},
            'amountReceived': {'minorUnits': 6000, 'currency': 'MXN'},
            'status': 'draft',
            'correlationId': null,
          },
          {
            'id': '00000000-0000-4000-8000-000000000302',
            'type': 'manual_terminal',
            'amount': {'minorUnits': 5800, 'currency': 'MXN'},
            'amountReceived': null,
            'status': 'confirmed_success',
            'correlationId': 'terminal-test',
          },
        ],
        tipDraft: const {
          'kind': 'percentage',
          'basisPoints': 1000,
          'fixedAmount': null,
        },
        discountDrafts: const [
          {
            'id': '00000000-0000-4000-8000-000000000303',
            'type': 'order_percentage',
            'lineId': null,
            'basisPoints': 1000,
            'fixedAmount': null,
            'reason': 'Equipo',
          },
        ],
        receiptDelivery: const {
          'destination': 'print_later',
          'channel': null,
          'customerContactId': null,
        },
      );
      expect(repository.commands.single.tenderDrafts, hasLength(2));
      expect(repository.commands.single.tipDraft?['basisPoints'], 1000);
      expect(repository.commands.single.discountDrafts, hasLength(1));
      expect(
        repository.commands.single.receiptDelivery?['destination'],
        'print_later',
      );
    },
  );

  testWidgets(
    'checkout sheet renders authoritative totals and payment methods',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(1280, 1800);
      addTearDown(tester.view.reset);
      final repository = _CartRepository();
      final cart = CartController(
        repository: repository,
        telemetry: const SafeTelemetry(
          enabled: false,
          context: TelemetryContext(
            appVersion: 'test',
            environment: 'test',
            platform: 'test',
          ),
          exporter: NoopTelemetryExporter(),
        ),
      );
      await cart.open(
        repository.cart.tenantId,
        repository.cart.branchId,
        repository.cart.operatorSessionId,
      );
      final root = testRoot();
      final checkout = _controller(_CheckoutRepository());
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
          home: Builder(
            builder: (context) => Scaffold(
              body: FilledButton(
                onPressed: () => showCheckoutSheet(
                  context,
                  checkout: checkout,
                  cart: cart,
                  entry: root.entry,
                  sales: root.sales,
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      expect(find.text('Authoritative checkout'), findsOneWidget);
      expect(find.text('Cash'), findsWidgets);
      expect(find.text('Payment selection'), findsOneWidget);
      expect(find.text('Exact amount'), findsOneWidget);
      expect(find.text('MXN 116.00'), findsWidgets);
      final review = find.text('Review authoritative totals');
      for (var index = 0; index < 6 && review.evaluate().isEmpty; index++) {
        await tester.drag(find.byType(ListView).first, const Offset(0, -300));
        await tester.pump();
      }
      await tester.tap(review);
      await tester.pumpAndSettle();
      expect(find.text('Manual terminal', skipOffstage: false), findsWidgets);
      expect(
        find.text('Custom tip percent', skipOffstage: false),
        findsOneWidget,
      );
      expect(
        find.text('Custom tip amount', skipOffstage: false),
        findsOneWidget,
      );
      expect(find.text('Percentage', skipOffstage: false), findsOneWidget);
      expect(find.text('Fixed amount', skipOffstage: false), findsOneWidget);
      expect(
        find.text('Receipt destination', skipOffstage: false),
        findsOneWidget,
      );
      await tester.pumpWidget(const SizedBox());
      root.dispose();
      cart.dispose();
      checkout.dispose();
    },
  );
}
