import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/bootstrap/composition_root.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
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

  /// The policy the sheet asks for on open. Defaults to a location that offers
  /// cash alone, which is what `default-deny` means and what most of these cases
  /// are about; a case that cares about a card terminal sets it.
  CheckoutPolicy? policyValue;
  final policyQueries = <PosCheckoutPolicyQuery>[];

  @override
  Future<CheckoutPolicy> policy(
    String merchantId,
    PosCheckoutPolicyQuery query,
  ) async {
    policyQueries.add(query);
    final value = policyValue;
    if (value == null) throw StateError('no policy');
    return value;
  }

  /// Every capture the sheet asked for, in order, and every settlement it made.
  final captures = <TenderCaptureRequest>[];
  final settlements = <TenderSettlementRequest>[];

  /// When set, `captureTender` throws it — how a test says "the provider is not
  /// reachable", which must stop the charge before anything is committed.
  String? captureFailureCode;

  /// When set, `checkout` throws something the controller has no type for — a
  /// raw error, the shape a body that does not parse or a transport failure
  /// outside the typed refusals arrives in.
  bool unexpectedFailure = false;

  @override
  Future<TenderCaptureResult> captureTender(
    String merchantId,
    TenderCaptureRequest request,
  ) async {
    captures.add(request);
    final code = captureFailureCode;
    if (code != null) {
      throw AppException(
        category: AppErrorCategory.transport,
        code: code,
        recoverable: true,
      );
    }
    return TenderCaptureResult.fromJson({
      'attempt': {
        'id': request.tenderId,
        'commandIdentity': request.commandIdentity,
        'cartId': request.cartId,
        'locationId': request.locationId,
        'method': 'external_terminal',
        'family': 'card_present',
        'provider': request.provider,
        'state': 'unknown',
        'queryOnly': true,
        'amount': request.amount,
        'providerOrderId': null,
        'providerPaymentId': null,
        'providerStatus': 'awaiting_operator_confirmation',
        'proofSource': null,
        'correlationId': 'test-correlation',
        'queryAfter': null,
        'expiresAt': null,
        'createdAt': '2026-09-17T00:00:00.000Z',
        'resolvedAt': null,
      },
      // What the manual terminal's own adapter answers, and the only thing it can
      // answer: the outcome is on a screen only a person can read.
      'outcome': {
        'kind': 'unknown',
        'providerStatus': 'awaiting_operator_confirmation',
        'code': 'MANUAL_TERMINAL_REQUIRES_A_PERSON',
        'message': 'Only the operator can settle this.',
      },
      'ambiguity': null,
      'idempotentReplay': false,
      'providerCalled': true,
      'capturedAt': '2026-09-17T00:00:00.000Z',
    });
  }

  @override
  Future<TenderSettlementResult> settleTender(
    String merchantId,
    String commandIdentity,
    TenderSettlementRequest request,
  ) async {
    settlements.add(request);
    return TenderSettlementResult.fromJson({
      'attempt': {
        'id': commandIdentity,
        'commandIdentity': commandIdentity,
        'cartId': 'cart',
        'locationId': request.locationId,
        'method': 'external_terminal',
        'family': 'card_present',
        'provider': 'manual_terminal',
        'state': request.outcome == 'paid' ? 'succeeded' : 'declined',
        'queryOnly': false,
        'amount': const {'minorUnits': 5500, 'currency': 'MXN'},
        'providerOrderId': null,
        'providerPaymentId': null,
        'providerStatus': 'awaiting_operator_confirmation',
        'proofSource': 'operator_attested',
        'correlationId': 'test-correlation',
        'queryAfter': null,
        'expiresAt': null,
        'createdAt': '2026-09-17T00:00:00.000Z',
        'resolvedAt': '2026-09-17T00:00:01.000Z',
      },
      'outcome': request.outcome,
      'proofSource': 'operator_attested',
      'evidence': request.evidence,
      'note': request.note,
      'previousState': 'unknown',
      'settledAt': '2026-09-17T00:00:01.000Z',
      'correlationId': 'test-correlation',
    });
  }

  @override
  Future<CheckoutResult> checkout(
    String merchantId,
    CheckoutCommand command,
  ) async {
    commands.add(command);
    if (unexpectedFailure) {
      throw StateError('the response was not a checkout result at all');
    }
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
        'merchantId': '00000000-0000-4000-8000-000000000001',
        'locationId': '00000000-0000-4000-8000-000000000002',
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
    String merchantId,
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
    String merchantId,
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
    String merchantId,
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
    merchantId: '00000000-0000-4000-8000-000000000001',
    locationId: '00000000-0000-4000-8000-000000000002',
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
  Future<Cart> create(String merchantId, CreateCartRequest request) async =>
      cart;
  @override
  Future<Cart> read(String merchantId, CartQuery query) async => cart;
  @override
  Future<Cart> add(String merchantId, CartLineInput input) async => cart;
  @override
  Future<Cart> update(
    String merchantId,
    String lineId,
    CartLineInput input,
  ) async => cart;
  @override
  Future<Cart> remove(
    String merchantId,
    String lineId,
    RemoveCartLineRequest input,
  ) async => cart;
  @override
  Future<Cart> prepare(String merchantId, PrepareSaleRequest input) async =>
      cart;
  @override
  Future<Cart> clear(String merchantId, ClearCartRequest input) async => cart;

  @override
  Future<PosIncomingOrders> incomingOrders(
    String merchantId,
    CartQuery query,
  ) async => throw UnimplementedError();

  @override
  Future<Cart> bindOrigin(
    String merchantId,
    BindCartOriginRequest input,
  ) async => throw UnimplementedError();
}

CheckoutController _controller(
  _CheckoutRepository repository, {
  Future<void> Function(CheckoutResult result)? afterCommit,
}) => CheckoutController(
  repository: repository,
  afterCommit: afterCommit,
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

/// A tender sheet on screen, on the location [policy] describes, with its own
/// cart and composition root, disposed by the test that opened it.
final class _TenderSheet {
  _TenderSheet(this.tester, this.root, this.cart, this.checkout);
  final WidgetTester tester;
  final AppCompositionRoot root;
  final CartController cart;
  final CheckoutController checkout;

  Future<void> dispose() async {
    await tester.pumpWidget(const SizedBox());
    root.dispose();
    cart.dispose();
    checkout.dispose();
  }
}

/// Open the sheet on the location [policy] describes.
///
/// The harness has no signed-in operator, so the sheet's own `initState` read
/// does not fire; the read is made here, exactly as the sheet would make it.
Future<_TenderSheet> _openTenderSheet(
  WidgetTester tester,
  _CheckoutRepository repository, {
  required CheckoutPolicy policy,
}) async {
  tester.view.devicePixelRatio = 1;
  // Tall enough that the whole tender surface lays out at once, so every
  // asserted part is on screen without scrolling.
  tester.view.physicalSize = const Size(1280, 3200);
  addTearDown(tester.view.reset);
  repository.policyValue = policy;
  final cart = CartController(
    repository: _CartRepository(),
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
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
  );
  final root = testRoot();
  final checkout = _controller(repository);
  await checkout.loadPolicy(
    merchantId: '00000000-0000-4000-8000-000000000001',
    locationId: '00000000-0000-4000-8000-000000000002',
    operatorSessionId: '00000000-0000-4000-8000-000000000003',
    currency: 'MXN',
  );
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
              cashShiftId: null,
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
  return _TenderSheet(tester, root, cart, checkout);
}

void main() {
  test('requires server repricing then explicit confirmation', () async {
    final repository = _CheckoutRepository();
    final controller = _controller(repository);
    await controller.preview(
      merchantId: '00000000-0000-4000-8000-000000000001',
      locationId: '00000000-0000-4000-8000-000000000002',
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

  test('completed sale requests hardware after the financial result', () async {
    final repository = _CheckoutRepository();
    CheckoutResult? hardwareResult;
    final controller = _controller(
      repository,
      afterCommit: (result) async => hardwareResult = result,
    );
    await controller.preview(
      merchantId: '00000000-0000-4000-8000-000000000001',
      locationId: '00000000-0000-4000-8000-000000000002',
      operatorSessionId: '00000000-0000-4000-8000-000000000003',
      cartId: '00000000-0000-4000-8000-000000000004',
      cartVersion: 3,
      paymentMethod: 'cash',
    );
    await controller.confirm();
    await Future<void>.delayed(Duration.zero);
    expect(hardwareResult?.status, 'completed');
  });

  test(
    'keeps value fingerprint command identity until checkout reset',
    () async {
      final repository = _CheckoutRepository();
      final controller = _controller(repository);

      Future<void> preview() => controller.preview(
        merchantId: '00000000-0000-4000-8000-000000000001',
        locationId: '00000000-0000-4000-8000-000000000002',
        operatorSessionId: '00000000-0000-4000-8000-000000000003',
        cartId: '00000000-0000-4000-8000-000000000004',
        cartVersion: 3,
        paymentMethod: 'cash',
      );

      await preview();
      final firstCommandId =
          repository.commands.last.customerValueFingerprintCommandId;
      await preview();
      expect(
        repository.commands.last.customerValueFingerprintCommandId,
        firstCommandId,
      );

      controller.reset();
      await preview();
      expect(
        repository.commands.last.customerValueFingerprintCommandId,
        isNot(firstCommandId),
      );
    },
  );

  test('unknown external-terminal payment remains query-only', () async {
    final repository = _CheckoutRepository(unknown: true);
    final controller = _controller(repository);
    await controller.preview(
      merchantId: '00000000-0000-4000-8000-000000000001',
      locationId: '00000000-0000-4000-8000-000000000002',
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
        merchantId: '00000000-0000-4000-8000-000000000001',
        locationId: '00000000-0000-4000-8000-000000000002',
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
      merchantId: '00000000-0000-4000-8000-000000000001',
      locationId: '00000000-0000-4000-8000-000000000002',
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
            'merchantId': '00000000-0000-4000-8000-000000000001',
            'locationId': '00000000-0000-4000-8000-000000000002',
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
      merchantId: '00000000-0000-4000-8000-000000000001',
      locationId: '00000000-0000-4000-8000-000000000002',
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
        merchantId: '00000000-0000-4000-8000-000000000001',
        locationId: '00000000-0000-4000-8000-000000000002',
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
        merchantId: '00000000-0000-4000-8000-000000000001',
        locationId: '00000000-0000-4000-8000-000000000002',
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
        merchantId: '00000000-0000-4000-8000-000000000001',
        locationId: '00000000-0000-4000-8000-000000000002',
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

  test(
    'a confirmed card terminal becomes an attempt and a settlement before the commit',
    () async {
      final repository = _CheckoutRepository();
      final controller = _controller(repository);
      await controller.preview(
        merchantId: '00000000-0000-4000-8000-000000000001',
        locationId: '00000000-0000-4000-8000-000000000002',
        operatorSessionId: '00000000-0000-4000-8000-000000000003',
        cartId: '00000000-0000-4000-8000-000000000004',
        cartVersion: 3,
        paymentMethod: 'external_terminal',
        tenderDrafts: const [
          {
            'id': '00000000-0000-4000-8000-000000000302',
            'type': 'manual_terminal',
            'amount': {'minorUnits': 5500, 'currency': 'MXN'},
            'amountReceived': null,
            'status': 'confirmed_success',
            'correlationId': 'terminal-test',
          },
        ],
      );

      // The ATTEMPT comes first, in the till's own name, keyed by the tender's
      // identity — which is derived from the cart, so a retry of this sale finds
      // the attempt instead of asking the provider a second time.
      expect(repository.captures, hasLength(1));
      expect(repository.captures.single.provider, 'manual_terminal');
      expect(
        repository.captures.single.commandIdentity,
        repository.captures.single.tenderId,
      );
      // And the operator's reading of the terminal screen is what SETTLES it. A
      // manual terminal can only ever answer `unknown`, so without this the
      // attempt would stay unresolved and the cart could be neither paid nor
      // cancelled.
      expect(repository.settlements, hasLength(1));
      expect(repository.settlements.single.outcome, 'paid');
      expect(
        repository.settlements.single.evidence,
        'terminal_screen_shows_paid',
      );
      // Both happened before the checkout command, which is what links them.
      expect(repository.commands, hasLength(1));
    },
  );

  test('an unknown terminal outcome is captured and NOT settled', () async {
    final repository = _CheckoutRepository();
    final controller = _controller(repository);
    await controller.preview(
      merchantId: '00000000-0000-4000-8000-000000000001',
      locationId: '00000000-0000-4000-8000-000000000002',
      operatorSessionId: '00000000-0000-4000-8000-000000000003',
      cartId: '00000000-0000-4000-8000-000000000004',
      cartVersion: 3,
      paymentMethod: 'external_terminal',
      tenderDrafts: const [
        {
          'id': '00000000-0000-4000-8000-000000000302',
          'type': 'manual_terminal',
          'amount': {'minorUnits': 5500, 'currency': 'MXN'},
          'amountReceived': null,
          'status': 'outcome_unknown',
          'correlationId': 'terminal-test',
        },
      ],
    );

    // The question is recorded — there is now something to resolve — and the
    // answer is NOT invented. An attempt nobody can resolve is the thing that
    // blocked a cart, so capturing without settling has to stay possible.
    expect(repository.captures, hasLength(1));
    expect(repository.settlements, isEmpty);
  });

  test(
    'a failure the protocol does not describe reaches the failure surface',
    () async {
      final repository = _CheckoutRepository()..unexpectedFailure = true;
      final controller = _controller(repository);
      await controller.preview(
        merchantId: '00000000-0000-4000-8000-000000000001',
        locationId: '00000000-0000-4000-8000-000000000002',
        operatorSessionId: '00000000-0000-4000-8000-000000000003',
        cartId: '00000000-0000-4000-8000-000000000004',
        cartVersion: 3,
        paymentMethod: 'cash',
      );

      // The press has to land somewhere the cashier can act on. It used to escape
      // the controller entirely: the phase stayed at `repricing`, which the sheet
      // paints as a spinner, with no error and nothing to press — the dead end
      // observed on the real till against an API that answered 503, where the only
      // way out was killing the app.
      expect(controller.state.phase, CheckoutPhase.failure);
      expect(controller.state.errorCode, 'UNEXPECTED_CHECKOUT_FAILURE');
    },
  );

  test('refuses to charge when the terminal cannot be reached at all', () async {
    final repository = _CheckoutRepository()
      ..captureFailureCode = 'TENDER_PROVIDER_UNAVAILABLE';
    final controller = _controller(repository);
    await controller.preview(
      merchantId: '00000000-0000-4000-8000-000000000001',
      locationId: '00000000-0000-4000-8000-000000000002',
      operatorSessionId: '00000000-0000-4000-8000-000000000003',
      cartId: '00000000-0000-4000-8000-000000000004',
      cartVersion: 3,
      paymentMethod: 'external_terminal',
      tenderDrafts: const [
        {
          'id': '00000000-0000-4000-8000-000000000302',
          'type': 'manual_terminal',
          'amount': {'minorUnits': 5500, 'currency': 'MXN'},
          'amountReceived': null,
          'status': 'confirmed_success',
          'correlationId': 'terminal-test',
        },
      ],
    );

    // The refusal names the real problem and NOTHING is committed: no sale, and
    // no tender recorded against money that may never have moved.
    expect(controller.state.phase, CheckoutPhase.failure);
    expect(controller.state.errorCode, 'TENDER_PROVIDER_UNAVAILABLE');
    expect(repository.commands, isEmpty);
  });

  testWidgets('checkout sheet renders authoritative totals and payment methods', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    // Tall enough that the redesigned tender sheet (hero total, method tile,
    // keypad, change block, receipt, charge button) lays out at once, so every
    // asserted part is on-screen without scrolling.
    tester.view.physicalSize = const Size(1280, 3200);
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
      repository.cart.merchantId,
      repository.cart.locationId,
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
                cashShiftId: null,
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
    // The redesigned SOTA tender screen: a hero total, the payment-method tile,
    // the cash-received flow with quick-cash notes and an on-screen keypad, the
    // colour-coded change block, and the receipt options.
    expect(find.text('TOTAL'), findsOneWidget);
    expect(find.text('Payment selection'), findsOneWidget);
    expect(find.text('Cash'), findsWidgets);
    expect(find.text('Cash received'), findsOneWidget);
    expect(find.text('Exact amount'), findsOneWidget);
    expect(find.text('MXN 500.00'), findsOneWidget); // a quick-cash note
    expect(find.text('7'), findsWidgets); // a keypad key
    expect(find.text('Change due'), findsOneWidget);
    expect(find.text('Receipt destination'), findsOneWidget);
    expect(find.text('MXN 116.00'), findsWidgets);
    // One-tap checkout: the charge button reviews the total server-side and, when
    // it matches what the cashier saw, commits in the same action. It is the last
    // FilledButton (after the harness's own "open" button).
    final charge = find.byType(FilledButton).last;
    await tester.ensureVisible(charge);
    await tester.tap(charge);
    await tester.pumpAndSettle();
    // The completed screen is the PoloTab-style change/paid summary.
    expect(find.text('Paid'), findsOneWidget);
    expect(find.text('New order'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    root.dispose();
    cart.dispose();
    checkout.dispose();
  });

  testWidgets(
    'the keypad belongs to cash: it leaves the surface when the tender is a card terminal',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      // The same tall surface as the case above: both tender faces have to lay
      // out at once, so neither is off-screen when its assertions run.
      tester.view.physicalSize = const Size(1280, 3200);
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
        repository.cart.merchantId,
        repository.cart.locationId,
        repository.cart.operatorSessionId,
      );
      final root = testRoot();
      // This location charges one tender at a time, so selecting the terminal
      // retires cash: that is the swap under test. The shared policy allows
      // mixed tender, which would keep the cash face (and its keypad) up.
      final checkoutRepository = _CheckoutRepository()
        ..policyValue = CheckoutPolicy.fromJson({
          ..._policy,
          'mixedTenderEnabled': false,
        });
      final checkout = _controller(checkoutRepository);
      // The sheet asks for the policy itself only when an operator is signed in,
      // and this harness has none, so the read is made here.
      await checkout.loadPolicy(
        merchantId: repository.cart.merchantId,
        locationId: repository.cart.locationId,
        operatorSessionId: repository.cart.operatorSessionId,
        currency: 'MXN',
      );
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
                  cashShiftId: null,
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

      // Cash owns the surface: the keypad and the field it drives are here.
      expect(find.text('7'), findsWidgets);
      expect(find.text('Cash received'), findsOneWidget);

      await tester.tap(find.text('Manual terminal'));
      await tester.pumpAndSettle();

      // The keypad leaves with the cash, and the terminal panel takes the space.
      expect(find.text('7'), findsNothing);
      expect(find.text('Cash received'), findsNothing);
      final terminalFace = find.byKey(const ValueKey('tender-terminal'));
      expect(terminalFace, findsOneWidget);
      expect(
        find.descendant(of: terminalFace, matching: find.text('Card terminal')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: terminalFace,
          matching: find.text(
            'The terminal is an operator declaration: the POS does not read its outcome.',
          ),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(of: terminalFace, matching: find.text('MXN 116.00')),
        findsOneWidget,
      );

      await tester.tap(find.text('Cash'));
      await tester.pumpAndSettle();
      expect(find.text('7'), findsWidgets);
      expect(find.text('Cash received'), findsOneWidget);
      expect(find.byKey(const ValueKey('tender-terminal')), findsNothing);

      // The swap is the design law's 220 ms surface transition.
      final switcher = tester.widget<AnimatedSwitcher>(
        find.ancestor(
          of: find.byKey(const ValueKey('tender-cash')),
          matching: find.byType(AnimatedSwitcher),
        ),
      );
      expect(switcher.duration, UmiMotion.standard);

      await tester.pumpWidget(const SizedBox());
      root.dispose();
      cart.dispose();
      checkout.dispose();
    },
  );

  testWidgets('a recovered split the policy forbids is named, not adopted', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1280, 3200);
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
      repository.cart.merchantId,
      repository.cart.locationId,
      repository.cart.operatorSessionId,
    );
    final root = testRoot();
    // One tender per sale here, and a draft written by an earlier session that
    // holds both halves of a split — the state the owner saw on the till, with
    // Efectivo and Terminal manual both selected and a charge that cannot work.
    final checkoutRepository =
        _CheckoutRepository(
            recoverySnapshot: const CheckoutRecoverySnapshot(
              checkoutId: '00000000-0000-4000-8000-000000000020',
              cartId: '00000000-0000-4000-8000-000000000004',
              checkoutVersion: 2,
              state: 'collecting_payment',
              tenderDrafts: [
                {
                  'id': '00000000-0000-4000-8000-000000000021',
                  'type': 'cash',
                  'amount': {'minorUnits': 5800, 'currency': 'MXN'},
                  'amountReceived': {'minorUnits': 5800, 'currency': 'MXN'},
                  'status': 'draft',
                  'correlationId': null,
                },
                {
                  'id': '00000000-0000-4000-8000-000000000022',
                  'type': 'manual_terminal',
                  'amount': {'minorUnits': 5800, 'currency': 'MXN'},
                  'amountReceived': null,
                  'status': 'confirmed_success',
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
              paymentOutcome: null,
              result: null,
              recoveryState: 'invalid_amount',
              checkoutFingerprint:
                  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              updatedAt: '2026-09-17T00:00:00.000Z',
            ),
          )
          ..policyValue = CheckoutPolicy.fromJson({
            ..._policy,
            'mixedTenderEnabled': false,
          });
    final checkout = _controller(checkoutRepository);
    await checkout.loadPolicy(
      merchantId: repository.cart.merchantId,
      locationId: repository.cart.locationId,
      operatorSessionId: repository.cart.operatorSessionId,
      currency: 'MXN',
    );
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
                cashShiftId: null,
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
    // The draft arrives while the sheet is open, which is when the real till
    // asks for it.
    await checkout.recover(
      merchantId: repository.cart.merchantId,
      locationId: repository.cart.locationId,
      operatorSessionId: repository.cart.operatorSessionId,
      cartId: repository.cart.id,
      cartVersion: 3,
    );
    await tester.pumpAndSettle();

    // The contradiction is named, once, in the operator's own terms...
    expect(find.text('This cart cannot be paid like this'), findsOneWidget);
    expect(find.text('Cash received'), findsOneWidget);
    // ...the unpayable half is NOT adopted (the terminal's own field is absent)...
    expect(find.text('Amount applied'), findsNothing);
    // ...and the charge is refused rather than offered.
    final charge = tester.widget<FilledButton>(find.byType(FilledButton).last);
    expect(charge.onPressed, isNull);

    await tester.pumpWidget(const SizedBox());
    root.dispose();
    cart.dispose();
    checkout.dispose();
  });

  testWidgets('a split says what it is and in which order the legs are charged', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1280, 3200);
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
      repository.cart.merchantId,
      repository.cart.locationId,
      repository.cart.operatorSessionId,
    );
    final root = testRoot();
    final checkoutRepository = _CheckoutRepository()
      ..policyValue = CheckoutPolicy.fromJson(_policy);
    final checkout = _controller(checkoutRepository);
    await checkout.loadPolicy(
      merchantId: repository.cart.merchantId,
      locationId: repository.cart.locationId,
      operatorSessionId: repository.cart.operatorSessionId,
      currency: 'MXN',
    );
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
                cashShiftId: null,
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

    // One method says nothing about splitting. (The control that WOULD arm one
    // wears the same words as the reading, so the reading is read by its body.)
    expect(find.text('Choose the second payment method.'), findsNothing);
    expect(
      find.byKey(const ValueKey('tender-split-arm')),
      findsOneWidget,
      reason: 'a location that allows mixed tender offers the split control',
    );

    // The operator's decision to split comes first: without it a second tile
    // would replace the first. Arming alone names the next step rather than
    // leaving the swapped tiles to speak for themselves.
    await tester.tap(find.byKey(const ValueKey('tender-split-arm')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('tender-split-disarm')), findsOneWidget);
    expect(find.text('Split payment'), findsOneWidget);
    expect(find.text('Choose the second payment method.'), findsOneWidget);

    // Now the second method joins the split, and the sheet names both legs in
    // the order they are charged: the cash the customer hands over first, the
    // card second.
    await tester.tap(find.text('Manual terminal'));
    await tester.pumpAndSettle();
    expect(find.text('Choose the second payment method.'), findsNothing);
    expect(find.text('Split payment'), findsOneWidget);
    expect(
      find.text('1. Cash: MXN 58.00   2. Manual terminal: MXN 58.00'),
      findsOneWidget,
    );

    await tester.pumpWidget(const SizedBox());
    root.dispose();
    cart.dispose();
    checkout.dispose();
  });

  testWidgets('split tender: the change line measures the cash leg, not the bill', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1280, 3200);
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
      repository.cart.merchantId,
      repository.cart.locationId,
      repository.cart.operatorSessionId,
    );
    final root = testRoot();
    // This location allows mixed tender, so selecting the terminal keeps the cash
    // leg: MXN 58.00 in the drawer and MXN 58.00 on the card, out of MXN 116.00.
    final checkoutRepository = _CheckoutRepository()
      ..policyValue = CheckoutPolicy.fromJson(_policy);
    final checkout = _controller(checkoutRepository);
    await checkout.loadPolicy(
      merchantId: repository.cart.merchantId,
      locationId: repository.cart.locationId,
      operatorSessionId: repository.cart.operatorSessionId,
      currency: 'MXN',
    );
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
                cashShiftId: null,
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
    // The operator asks for the split, then adds the terminal leg to the cash
    // one: arming first is what keeps both methods on the sale.
    await tester.tap(find.byKey(const ValueKey('tender-split-arm')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Manual terminal'));
    await tester.pumpAndSettle();

    final cashReceivedField = find.ancestor(
      of: find.text('Cash received'),
      matching: find.byType(TextField),
    );
    // The customer hands over MXN 100.00 for a MXN 58.00 cash leg. The change is
    // MXN 42.00 — measured against the cash leg. Before this was fixed the sheet
    // compared the drawer against the whole MXN 116.00 bill and said the customer
    // still owed MXN 16.00, with the money already on the counter.
    await tester.enterText(cashReceivedField, '100.00');
    await tester.pumpAndSettle();
    expect(find.text('Change due'), findsOneWidget);
    expect(find.text('MXN 42.00'), findsOneWidget);
    expect(find.text('Amount due'), findsNothing);

    // And the other direction still names what is missing: MXN 20.00 on the
    // counter leaves MXN 38.00 of the cash leg unpaid.
    await tester.enterText(cashReceivedField, '20.00');
    await tester.pumpAndSettle();
    expect(find.text('Amount due'), findsOneWidget);
    expect(find.text('MXN 38.00'), findsOneWidget);
    expect(find.text('Change due'), findsNothing);

    await tester.pumpWidget(const SizedBox());
    root.dispose();
    cart.dispose();
    checkout.dispose();
  });

  testWidgets('a second method tile replaces the first; it never splits', (
    tester,
  ) async {
    final repository = _CheckoutRepository();
    final sheet = await _openTenderSheet(
      tester,
      repository,
      // Mixed tender is allowed here, which used to be enough to make a second
      // tap accumulate a split nobody asked for.
      policy: CheckoutPolicy.fromJson({..._policy, 'maximumTenderLines': 4}),
    );

    // Cash owns the surface on open: the keypad and the field it drives.
    expect(find.text('7'), findsWidgets);
    expect(find.text('Cash received'), findsOneWidget);

    await tester.tap(find.text('Manual terminal'));
    await tester.pumpAndSettle();

    // The terminal replaces cash: the keypad leaves with it...
    expect(find.text('7'), findsNothing);
    expect(find.text('Cash received'), findsNothing);
    expect(find.byKey(const ValueKey('tender-terminal')), findsOneWidget);
    // ...and nothing was divided, so there is no split reading and no leg list.
    expect(find.text('Choose the second payment method.'), findsNothing);
    expect(find.textContaining(RegExp(r'^\d+\. ')), findsNothing);
    // The decision to split is still there to be made, and it is still unarmed.
    expect(find.byKey(const ValueKey('tender-split-arm')), findsOneWidget);

    await sheet.dispose();
  });

  testWidgets('an armed split keeps cash and adds the terminal leg', (
    tester,
  ) async {
    final repository = _CheckoutRepository();
    final sheet = await _openTenderSheet(
      tester,
      repository,
      policy: CheckoutPolicy.fromJson({..._policy, 'maximumTenderLines': 4}),
    );

    await tester.tap(find.byKey(const ValueKey('tender-split-arm')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Manual terminal'));
    await tester.pumpAndSettle();

    // Both methods are on the sale, so the keypad stays...
    expect(find.text('7'), findsWidgets);
    expect(find.text('Cash received'), findsOneWidget);
    // ...and the reading names the legs in the order the money is taken.
    expect(find.text('Split payment'), findsOneWidget);
    expect(
      find.text('1. Cash: MXN 58.00   2. Manual terminal: MXN 58.00'),
      findsOneWidget,
    );
    // The legs cover the MXN 116.00 bill exactly, so nothing is short or over.
    expect(find.textContaining('Short by'), findsNothing);
    expect(find.textContaining('Over by'), findsNothing);

    // Disarming puts the sale back to ONE method, and the one the operator
    // keeps is the cash that is already in their hand.
    await tester.tap(find.byKey(const ValueKey('tender-split-disarm')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('tender-split-arm')), findsOneWidget);
    expect(find.textContaining(RegExp(r'^\d+\. ')), findsNothing);
    expect(find.text('7'), findsWidgets);
    expect(find.byKey(const ValueKey('tender-terminal')), findsNothing);

    await sheet.dispose();
  });

  testWidgets('a split that does not cover the bill says by how much', (
    tester,
  ) async {
    final repository = _CheckoutRepository();
    final sheet = await _openTenderSheet(
      tester,
      repository,
      policy: CheckoutPolicy.fromJson({..._policy, 'maximumTenderLines': 4}),
    );

    await tester.tap(find.byKey(const ValueKey('tender-split-arm')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Manual terminal'));
    await tester.pumpAndSettle();

    // The operator puts only MXN 20.00 of the bill on cash: 20.00 + 58.00 is
    // MXN 38.00 short of the MXN 116.00 bill.
    final cashAppliedField = find.byWidgetPredicate(
      (widget) =>
          widget is TextField && widget.decoration?.labelText == 'Cash applied',
    );
    await tester.enterText(cashAppliedField, '20.00');
    await tester.pumpAndSettle();

    expect(find.textContaining('Short by MXN 38.00'), findsOneWidget);
    expect(find.textContaining('Over by'), findsNothing);
    // The reading names the gap, so the button does not offer the charge.
    final charge = tester.widget<FilledButton>(find.byType(FilledButton).last);
    expect(charge.onPressed, isNull);

    // Covering the bill again makes the charge live once more.
    await tester.enterText(cashAppliedField, '58.00');
    await tester.pumpAndSettle();
    expect(find.textContaining('Short by'), findsNothing);
    final live = tester.widget<FilledButton>(find.byType(FilledButton).last);
    expect(live.onPressed, isNotNull);

    await sheet.dispose();
  });

  testWidgets('one method per sale says so and offers no split control', (
    tester,
  ) async {
    final repository = _CheckoutRepository();
    final sheet = await _openTenderSheet(
      tester,
      repository,
      // Two ways to pay, but not both on one sale.
      policy: CheckoutPolicy.fromJson({
        ..._policy,
        'mixedTenderEnabled': false,
      }),
    );

    expect(find.byKey(const ValueKey('tender-split-arm')), findsNothing);
    expect(find.byKey(const ValueKey('tender-split-disarm')), findsNothing);
    expect(
      find.text('This location charges one method per sale.'),
      findsOneWidget,
    );

    await sheet.dispose();
  });
}
