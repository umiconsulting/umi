import 'dart:async';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/bootstrap/composition_root.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/checkout/checkout_controller.dart';
import 'package:umi_pos/features/checkout/checkout_repository.dart';
import 'package:umi_pos/features/checkout/checkout_surface.dart';
import 'package:umi_pos/features/checkout/partial_checkout_surface.dart';
import 'package:umi_pos/features/customer_value/customer_value_controller.dart';
import 'package:umi_pos/features/customer_value/customer_value_repository.dart';
import 'package:umi_pos/features/entry/entry_controller.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';
import 'package:umi_pos/features/sale/sale_lifecycle_controller.dart';
import 'package:umi_pos/features/sale/sale_repository.dart';

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
  'bankTransferEnabled': false,
  'bankTransferDetails': null,
  'merchantLogoUrl': null,
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
    'attribution': 'account_owner',
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
    this.idempotencyConflictOnce = false,
    this.recoverySnapshot,
    this.paymentStatusValue = 'unknown',
  });
  final bool unknown;
  final bool loseCommitResponseOnce;
  final bool idempotencyConflictOnce;
  final CheckoutRecoverySnapshot? recoverySnapshot;
  final String paymentStatusValue;

  /// When set, the confirmation this fake publishes NAMES the value the command carried — the way
  /// `checkout-calculator.ts` hashes `customerValue` into the fingerprint — so a test can see which
  /// confirmation a commit quoted.
  bool valueAwareFingerprint = false;

  /// When set, the confirmation's fingerprint MOVES with the command's tenders the way the real
  /// calculator's does (it hashes them). A test that corrects a tender after a preview needs the
  /// server to answer a different fingerprint for the corrected command.
  bool fingerprintFollowsTheCommand = false;
  static const valuedFingerprint =
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
  static const valuedStoredValueFingerprint =
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
  static const correctedTenderFingerprint =
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

  /// When set, the repriced confirmation comes back with this grand total — how a test reaches the
  /// confirmation screen instead of the one-tap charge.
  int? repricedGrandTotalMinorUnits;
  bool responseLost = false;
  bool idempotencyConflictSent = false;
  bool requireCashShift = false;
  String cashHoldState = 'free';
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

  /// The confirmation the server would publish for this command. With
  /// [valueAwareFingerprint] the value the command carries is in the fingerprint and in
  /// `storedValueFingerprint`, which is how the real calculator behaves.
  Map<String, Object?> _confirmationFor(CheckoutCommand command) {
    final confirmation = <String, Object?>{..._confirmation};
    final repriced = repricedGrandTotalMinorUnits;
    if (repriced != null) {
      confirmation['totals'] = {
        ...(_confirmation['totals']! as Map<String, Object?>),
        'grandTotal': {'minorUnits': repriced, 'currency': 'MXN'},
      };
    }
    if (fingerprintFollowsTheCommand) {
      // The calculator hashes the tender drafts into the fingerprint, so a corrected tender is a
      // different confirmation. Modelled two-way: the cart's own total, and anything else.
      final cash = (command.tenderDrafts ?? const <Map<String, Object?>>[])
          .where((tender) => tender['type'] == 'cash')
          .firstOrNull;
      final received =
          (cash?['amountReceived'] as Map<String, Object?>?)?['minorUnits']
              as num?;
      if (received != null && received.toInt() != 11600) {
        confirmation['fingerprint'] = correctedTenderFingerprint;
      }
    }
    if (!valueAwareFingerprint || command.customerValue == null) {
      return confirmation;
    }
    confirmation['fingerprint'] = valuedFingerprint;
    confirmation['storedValueFingerprint'] = valuedStoredValueFingerprint;
    return confirmation;
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
      return CheckoutResult(
        status: 'confirmation_required',
        confirmation: _confirmationFor(command),
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
    if (requireCashShift && command.cashShiftId == null) {
      throw AppException(
        category: AppErrorCategory.unknown,
        code: 'CASH_SHIFT_REQUIRED',
        recoverable: false,
        details: {'holdState': cashHoldState},
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
    if (idempotencyConflictOnce && !idempotencyConflictSent) {
      idempotencyConflictSent = true;
      throw const AppException(
        category: AppErrorCategory.conflict,
        code: 'IDEMPOTENCY_CONFLICT',
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

/// A checkout repository that also owns a partial-payment ledger. The account
/// Split action must reach that ledger without changing any other checkout
/// behavior.
final class _PartialCheckoutRepository
    implements CheckoutRepository, PartialPaymentRepository {
  final delegate = _CheckoutRepository();

  CheckoutPolicy? get policyValue => delegate.policyValue;
  set policyValue(CheckoutPolicy? value) => delegate.policyValue = value;

  Map<String, Object?>? ledger;

  @override
  Future<CheckoutPolicy> policy(
    String merchantId,
    PosCheckoutPolicyQuery query,
  ) => delegate.policy(merchantId, query);

  @override
  Future<TenderCaptureResult> captureTender(
    String merchantId,
    TenderCaptureRequest request,
  ) => delegate.captureTender(merchantId, request);

  @override
  Future<TenderSettlementResult> settleTender(
    String merchantId,
    String commandIdentity,
    TenderSettlementRequest request,
  ) => delegate.settleTender(merchantId, commandIdentity, request);

  @override
  Future<CheckoutResult> checkout(String merchantId, CheckoutCommand command) =>
      delegate.checkout(merchantId, command);

  @override
  Future<PaymentOutcome> paymentStatus(
    String merchantId,
    String paymentId,
    PaymentStatusQuery query,
  ) => delegate.paymentStatus(merchantId, paymentId, query);

  @override
  Future<CheckoutRecoverySnapshot> recovery(
    String merchantId,
    String cartId,
    CheckoutRecoveryQuery query,
  ) => delegate.recovery(merchantId, cartId, query);

  @override
  Future<CheckoutCancellationResult> cancel(
    String merchantId,
    String cartId,
    CheckoutCancellationRequest request,
  ) => delegate.cancel(merchantId, cartId, request);

  @override
  Future<CheckoutPartialPaymentResult> partialPayments(
    String merchantId,
    String cartId,
    CheckoutPartialPaymentQuery query,
  ) async {
    final value = ledger;
    if (value == null) {
      throw const AppException(
        category: AppErrorCategory.unknown,
        code: 'RESOURCE_NOT_FOUND',
        recoverable: false,
      );
    }
    return CheckoutPartialPaymentResult(ok: true, data: value);
  }

  @override
  Future<CheckoutPartialPaymentResult> collectPartialPayment(
    String merchantId,
    String cartId,
    CheckoutPartialPaymentRequest command,
  ) => throw UnimplementedError();
}

final class _CartRepository implements CartRepository {
  final cart = Cart(
    id: '00000000-0000-4000-8000-000000000004',
    merchantId: '00000000-0000-4000-8000-000000000001',
    locationId: '00000000-0000-4000-8000-000000000002',
    operatorSessionId: '00000000-0000-4000-8000-000000000003',
    accountFolio: 'Cuenta 182',
    status: 'prepared',
    version: 3,
    firedOrderId: null,
    fulfillmentType: 'dine_in',
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

  @override
  Future<FireOrderResult> fire(
    String merchantId,
    FireOrderRequest request,
  ) async => throw UnimplementedError();

  @override
  Future<Cart> setFulfillment(
    String merchantId,
    SetCartFulfillmentRequest input,
  ) async => throw UnimplementedError();
}

CheckoutController _controller(
  CheckoutRepository repository, {
  Future<String?> Function(CheckoutResult result)? afterCommit,
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
  Future<String?> Function()? onOpenCashShift,
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
    PosApp(
      locale: const Locale('en'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,

        GlobalWidgetsLocalizations.delegate,
      ],
      home: Builder(
        builder: (context) => PosPage(
          body: PosButton(
            onPressed: () => showCheckoutSheet(
              context,
              checkout: checkout,
              cashShiftId: null,
              cart: cart,
              entry: root.entry,
              sales: root.sales,
              onOpenCashShift: onOpenCashShift,
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

/// The fingerprint the held preview answers with. Asserted on the command, so the
/// test proves the commit carries the preview it was shown and not just any value.
const _previewFingerprint =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/// What a SECOND preview answers with, so a test can tell which one the commit named.
const _rekeyedPreviewFingerprint =
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

/// A customer-value repository whose preview is HELD OPEN until the test answers it.
///
/// The defect this covers was a race, and a race cannot be observed from the
/// outside unless one leg can be stopped: with the future parked, the only way the
/// commit can travel is if the sheet never waited for it.
final class _HeldPreview implements CustomerValueRepository {
  final requests = <CustomerValuePreviewRequest>[];
  final held = <Completer<CustomerValuePreview>>[];

  @override
  Future<CustomerValuePreview> preview(
    String merchantId,
    CustomerValuePreviewRequest command,
  ) {
    requests.add(command);
    final completer = Completer<CustomerValuePreview>();
    held.add(completer);
    return completer.future;
  }

  /// Answer every preview asked for so far, the way the server does.
  void answer() {
    for (final (index, completer) in held.indexed) {
      if (!completer.isCompleted) {
        completer.complete(
          CustomerValuePreview(
            // The shape the demo API answers for a pilot customer: points, the earn preview, a
            // reward the customer cannot afford yet, and a wallet the cashier may apply. The panel
            // grows with every one of them, which is what the money screen has to survive.
            summary: <String, Object?>{
              'customer': {'displayName': 'Cliente Piloto'},
              'points': {'available': 0, 'pending': 0},
              'wallet': {
                'accountId': '00000000-0000-4000-8000-000000000070',
                'currency': 'MXN',
                'available': 50000,
              },
              'giftCards': <Object?>[],
            },
            earn: {'expectedPoints': 45, 'status': 'pending'},
            rewards: <Map<String, Object?>>[
              {
                'reward': {
                  'id': '00000000-0000-4000-8000-000000000071',
                  'displayName': 'Reward piloto',
                },
                'eligible': false,
                'state': 'ineligible',
                'pointsCost': 100,
              },
            ],
            selectedReward: null,
            storedValueAuthorizations: <Map<String, Object?>>[],
            remainingBalance: {'minorUnits': 0, 'currency': 'MXN'},
            policyVersions: {'loyalty': 'pilot'},
            // A re-asked preview carries a different fingerprint, because the basis it is computed
            // against is part of it — which is how a test sees WHICH preview the commit named.
            fingerprint: index == 0
                ? _previewFingerprint
                : _rekeyedPreviewFingerprint,
          ),
        );
      }
    }
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

/// The sale the sheet finds open: a cart with a customer already attached, which
/// is the only state in which the sheet previews loyalty at all.
final class _CustomerSale implements SaleRepository {
  _CustomerSale(this.cart, this.customer);
  final Cart cart;
  final Map<String, Object?> customer;

  SaleSnapshot _snapshot({String? id, Map<String, Object?>? customer}) =>
      SaleSnapshot(
        id: id ?? cart.id,
        state: 'building_cart',
        cart: cart.toJson(),
        label: null,
        customer: customer,
        originalOperatorSessionId: cart.operatorSessionId,
        currentOperatorSessionId: cart.operatorSessionId,
        suspendedAt: null,
        cancelledAt: null,
        cancellationReasonCode: null,
        cancellationReason: null,
        committedSaleId: null,
        sourceOrderId: null,
        receiptId: null,
        receiptRef: null,
        updatedAt: '2026-07-28T19:00:00.000Z',
      );

  @override
  Future<SaleSnapshot> current(
    String merchantId,
    SaleHistoryQuery query,
  ) async => _snapshot(customer: customer);

  /// The next sale the till opens by itself once this one is paid: same cart
  /// fixture, and no customer — the loyalty pairing belongs to the paid sale.
  @override
  Future<SaleSnapshot> start(
    String merchantId,
    SaleContextRequest request,
  ) async => _snapshot(id: '00000000-0000-4000-8000-000000000060');

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

/// A device already signed in. The customer-value preview names the operator
/// session, so the sheet cannot ask for one without this.
final class _SignedInTrustedSessionGateway implements EntryGateway {
  @override
  Future<OperatorSessionView> startOperator(
    String merchantId,
    String locationId,
  ) async => OperatorSessionView(
    id: '00000000-0000-4000-8000-000000000003',
    userId: '00000000-0000-4000-8000-000000000040',
    staffId: 'staff',
    merchantId: merchantId,
    locationId: locationId,
    deviceId: 'device',
    state: 'active',
    // What a cashier needs to see the panel in full: the reward and the wallet rows carry their own
    // actions, and each one is behind its own permission.
    permissions: const [
      'cart.write',
      'loyalty.read',
      'loyalty.reward.authorize',
      'wallet.authorize',
    ],
    entitlements: const [],
    startedAt: '2026-07-28T18:00:00.000Z',
    lastActivityAt: '2026-07-28T19:00:00.000Z',
    expiresAt: '2026-07-28T23:00:00.000Z',
  );

  @override
  Future<void> lockOperator(String id) async {}

  @override
  Future<void> logout() async {}

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

Future<EntryController> _signedInEntry() async {
  final entry = EntryController(
    gateway: _SignedInTrustedSessionGateway(),
    vault: CredentialVault(MemorySecureStorage()),
    telemetry: const SafeTelemetry(
      enabled: false,
      context: TelemetryContext(
        appVersion: 'test',
        environment: 'test',
        platform: 'test',
      ),
      exporter: NoopTelemetryExporter(),
    ),
    idleTimeout: const Duration(seconds: 30),
  );
  // One branch on the tenant, so the pick starts the operator session and the
  // entry lands on `ready` the way the app's own auto-path does.
  await entry.selectTenant(
    EntryMerchant.fromJson({
      'id': '00000000-0000-4000-8000-000000000001',
      'name': 'Test café',
      'roles': <Object?>[],
      'permissions': <Object?>[],
      'entitlements': <Object?>[],
      'locations': [
        {
          'id': '00000000-0000-4000-8000-000000000002',
          'merchantId': '00000000-0000-4000-8000-000000000001',
          'name': 'Test location',
          'status': 'active',
          'deviceAllowed': true,
          'operatorAllowed': true,
        },
      ],
    }),
  );
  return entry;
}

/// The pieces a customer-value charge needs, disposed together by the test.
final class _ValueSheet {
  _ValueSheet(
    this.tester,
    this.repository,
    this.value,
    this.cart,
    this.sales,
    this.entry,
    this.customerValue,
    this.checkout,
  );
  final WidgetTester tester;
  final _CheckoutRepository repository;
  final _HeldPreview value;
  final CartController cart;
  final SaleLifecycleController sales;
  final EntryController entry;
  final CustomerValueController customerValue;
  final CheckoutController checkout;

  Future<void> dispose() async {
    await tester.pumpWidget(const SizedBox());
    entry.dispose();
    sales.dispose();
    cart.dispose();
    customerValue.dispose();
    checkout.dispose();
  }
}

/// A tender sheet whose sale already has a customer, whose loyalty preview is HELD until the test
/// answers it, and whose canvas is the till's unless the test says otherwise.
Future<_ValueSheet> _openValueSheet(
  WidgetTester tester, {
  Size canvas = const Size(1396, 737),
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = canvas;
  addTearDown(tester.view.reset);
  final repository = _CheckoutRepository()
    ..policyValue = CheckoutPolicy.fromJson(_policy)
    ..valueAwareFingerprint = true;
  final carts = _CartRepository();
  final telemetry = const SafeTelemetry(
    enabled: false,
    context: TelemetryContext(
      appVersion: 'test',
      environment: 'test',
      platform: 'test',
    ),
    exporter: NoopTelemetryExporter(),
  );
  final cart = CartController(repository: carts, telemetry: telemetry);
  await cart.open(
    carts.cart.merchantId,
    carts.cart.locationId,
    carts.cart.operatorSessionId,
  );
  final sales = SaleLifecycleController(
    repository: _CustomerSale(carts.cart, const {
      'id': '00000000-0000-4000-8000-000000000050',
      'displayName': 'Cliente Piloto',
      'contactHint': null,
    }),
    cart: cart,
    telemetry: telemetry,
  );
  await sales.open(
    carts.cart.merchantId,
    carts.cart.locationId,
    carts.cart.operatorSessionId,
  );
  final entry = await _signedInEntry();
  final value = _HeldPreview();
  final customerValue = CustomerValueController(value);
  final checkout = _controller(repository);
  await checkout.loadPolicy(
    merchantId: carts.cart.merchantId,
    locationId: carts.cart.locationId,
    operatorSessionId: carts.cart.operatorSessionId,
    currency: 'MXN',
  );
  await tester.pumpWidget(
    PosApp(
      locale: const Locale('en'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,

        GlobalWidgetsLocalizations.delegate,
      ],
      home: Builder(
        builder: (context) => PosPage(
          body: PosButton(
            onPressed: () => showCheckoutSheet(
              context,
              checkout: checkout,
              cashShiftId: null,
              cart: cart,
              entry: entry,
              sales: sales,
              customerValue: customerValue,
            ),
            child: const Text('open'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return _ValueSheet(
    tester,
    repository,
    value,
    cart,
    sales,
    entry,
    customerValue,
    checkout,
  );
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
      afterCommit: (result) async {
        hardwareResult = result;
        return null;
      },
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

  test('a drawer that did not answer becomes a warning on the receipt', () async {
    final repository = _CheckoutRepository();
    final controller = _controller(
      repository,
      // The hardware ran, the money is recorded, and the drawer's pulse did not
      // answer. The till has to say so where the cashier is (plan §8.2 F5).
      afterCommit: (result) async => 'DRAWER_UNANSWERED',
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

    expect(controller.state.phase, CheckoutPhase.completed);
    expect(controller.state.postCommitWarning, 'DRAWER_UNANSWERED');
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

  test('the value selection the command carries has no null fields', () async {
    // The generated `toJson()` writes every key, so the fields this sale has no
    // value for would travel as `null`. The contract declares them optional, and
    // for the ones the database reads as arrays (`fundedGiftCards`) an explicit
    // null is a 400, not an omission: measured at the till on 2026-10-11,
    // `customerValue.fundedGiftCards` came back ["Expected array, received null"].
    final repository = _CheckoutRepository();
    final controller = _controller(repository);
    controller.applyCustomerValue(
      const CustomerValueSelection(
        previewFingerprint: _previewFingerprint,
        storedValueAuthorizationIds: <String>[],
      ),
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
    final selection = repository.commands.last.customerValue!;
    expect(selection.entries.where((entry) => entry.value == null), isEmpty);
    expect(selection.containsKey('fundedGiftCards'), isFalse);
    expect(selection['previewFingerprint'], _previewFingerprint);
  });

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

  test(
    'an idempotency refusal is recovered and retried automatically with a new identity',
    () async {
      final repository = _CheckoutRepository(idempotencyConflictOnce: true);
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
      expect(controller.state.phase, CheckoutPhase.completed);
      final commits = repository.commands
          .where((command) => command.totalsFingerprint != null)
          .toList();
      expect(commits, hasLength(2));
      expect(commits.first.idempotencyKey, isNot(commits.last.idempotencyKey));
      expect(commits.first.commandId, isNot(commits.last.commandId));
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

  testWidgets('account split opens the ledger without an empty check', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1280, 2400);
    addTearDown(tester.view.reset);
    final repository = _PartialCheckoutRepository()
      ..policyValue = CheckoutPolicy.fromJson(_policy)
      ..ledger = const {
        'cartId': '00000000-0000-4000-8000-000000000004',
        'cartVersion': 3,
        'amountDue': {'minorUnits': 11600, 'currency': 'MXN'},
        'appliedAmount': {'minorUnits': 0, 'currency': 'MXN'},
        'remainingBalance': {'minorUnits': 11600, 'currency': 'MXN'},
        'tipAmount': {'minorUnits': 0, 'currency': 'MXN'},
        'tenderDrafts': <Object?>[],
        'confirmationReferences': <String, String>{},
        'blockedByUnknown': false,
        'unresolvedTender': null,
        'canFinalize': false,
      };
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
    final entry = await _signedInEntry();
    final checkout = _controller(repository);
    await checkout.loadPolicy(
      merchantId: '00000000-0000-4000-8000-000000000001',
      locationId: '00000000-0000-4000-8000-000000000002',
      operatorSessionId: '00000000-0000-4000-8000-000000000003',
      currency: 'MXN',
    );
    final root = testRoot();
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        home: Builder(
          builder: (context) => PosPage(
            body: PosButton(
              onPressed: () => showSplitCheckout(
                context,
                checkout: checkout,
                cashShiftId: '00000000-0000-4000-8000-000000000005',
                cart: cart,
                entry: entry,
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

    expect(find.byType(PartialCheckoutSurface), findsOneWidget);
    expect(find.text('MXN 116.00'), findsWidgets);
    expect(find.text('This portion'), findsOneWidget);
    expect(find.text('Tip'), findsOneWidget);
    expect(find.text('Charge now'), findsOneWidget);
    expect(find.text('Remaining'), findsOneWidget);

    await tester.pumpWidget(const SizedBox());
    root.dispose();
    entry.dispose();
    cart.dispose();
    checkout.dispose();
  });

  testWidgets('account split suggests tips on the guest portion before tax', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1280, 720);
    addTearDown(tester.view.reset);
    final repository = _PartialCheckoutRepository()
      ..policyValue = CheckoutPolicy.fromJson(_policy)
      ..ledger = const {
        'cartId': '00000000-0000-4000-8000-000000000004',
        'cartVersion': 3,
        'amountDue': {'minorUnits': 11600, 'currency': 'MXN'},
        'appliedAmount': {'minorUnits': 0, 'currency': 'MXN'},
        'remainingBalance': {'minorUnits': 11600, 'currency': 'MXN'},
        'tipAmount': {'minorUnits': 0, 'currency': 'MXN'},
        'tenderDrafts': <Object?>[],
        'confirmationReferences': <String, String>{},
        'blockedByUnknown': false,
        'unresolvedTender': null,
        'canFinalize': false,
      };
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
    final entry = await _signedInEntry();
    final checkout = _controller(repository);
    await checkout.loadPolicy(
      merchantId: '00000000-0000-4000-8000-000000000001',
      locationId: '00000000-0000-4000-8000-000000000002',
      operatorSessionId: '00000000-0000-4000-8000-000000000003',
      currency: 'MXN',
    );
    final root = testRoot();
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        home: Builder(
          builder: (context) => PosPage(
            body: PosButton(
              onPressed: () => showSplitCheckout(
                context,
                checkout: checkout,
                cashShiftId: '00000000-0000-4000-8000-000000000005',
                cart: cart,
                entry: entry,
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

    expect(find.text('Tip for the account owner'), findsOneWidget);
    expect(find.text('Suggested base · MXN 100.00 before tax'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('partial-tip-bp-1000')));
    await tester.pumpAndSettle();

    PosField tipField() =>
        tester.widget<PosField>(find.byKey(const ValueKey('partial-tip')));
    expect(tipField().controller?.text, '10.00');
    expect(
      find.text('Portion MXN 116.00 + tip MXN 10.00 = charge MXN 126.00'),
      findsOneWidget,
    );

    await tester.enterText(
      find.byKey(const ValueKey('partial-principal')),
      '58.00',
    );
    await tester.pumpAndSettle();
    expect(tipField().controller?.text, '5.00');

    await tester.tap(find.byKey(const ValueKey('partial-tip-zero')));
    await tester.pumpAndSettle();
    expect(tipField().controller?.text, '0.00');

    await tester.tap(find.byKey(const ValueKey('partial-tip-bp-1500')));
    await tester.pumpAndSettle();
    expect(tipField().controller?.text, '7.50');

    await tester.enterText(find.byKey(const ValueKey('partial-tip')), '7.25');
    await tester.pumpAndSettle();
    expect(tipField().controller?.text, '7.25');
    expect(
      find.text('Portion MXN 58.00 + tip MXN 7.25 = charge MXN 65.25'),
      findsOneWidget,
    );

    await tester.enterText(find.byKey(const ValueKey('partial-tip')), '50.01');
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<PosButton>(find.byKey(const ValueKey('partial-charge')))
          .onPressed,
      isNull,
    );

    await tester.pumpWidget(const SizedBox());
    root.dispose();
    entry.dispose();
    cart.dispose();
    checkout.dispose();
  });

  testWidgets('closing an existing account split does not reopen it', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1280, 2400);
    addTearDown(tester.view.reset);
    final repository = _PartialCheckoutRepository()
      ..policyValue = CheckoutPolicy.fromJson(_policy)
      ..ledger = const {
        'cartId': '00000000-0000-4000-8000-000000000004',
        'cartVersion': 3,
        'amountDue': {'minorUnits': 11600, 'currency': 'MXN'},
        'appliedAmount': {'minorUnits': 4000, 'currency': 'MXN'},
        'remainingBalance': {'minorUnits': 7600, 'currency': 'MXN'},
        'tipAmount': {'minorUnits': 0, 'currency': 'MXN'},
        'tenderDrafts': [
          {
            'id': '00000000-0000-4000-8000-000000000099',
            'type': 'cash',
            'amount': {'minorUnits': 4000, 'currency': 'MXN'},
            'amountReceived': {'minorUnits': 4000, 'currency': 'MXN'},
            'status': 'draft',
            'correlationId': null,
          },
        ],
        'confirmationReferences': <String, String>{},
        'blockedByUnknown': false,
        'unresolvedTender': null,
        'canFinalize': false,
      };
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
    final entry = await _signedInEntry();
    final checkout = _controller(repository);
    await checkout.loadPolicy(
      merchantId: '00000000-0000-4000-8000-000000000001',
      locationId: '00000000-0000-4000-8000-000000000002',
      operatorSessionId: '00000000-0000-4000-8000-000000000003',
      currency: 'MXN',
    );
    final root = testRoot();
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        home: Builder(
          builder: (context) => PosPage(
            body: PosButton(
              onPressed: () => showSplitCheckout(
                context,
                checkout: checkout,
                cashShiftId: '00000000-0000-4000-8000-000000000005',
                cart: cart,
                entry: entry,
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
    expect(find.byType(PartialCheckoutSurface), findsOneWidget);

    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();

    expect(find.byType(PartialCheckoutSurface), findsNothing);
    expect(find.text('open'), findsOneWidget);

    await tester.pumpWidget(const SizedBox());
    root.dispose();
    entry.dispose();
    cart.dispose();
    checkout.dispose();
  });

  testWidgets('regular checkout does not open a new split ledger', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1280, 2400);
    addTearDown(tester.view.reset);
    final repository = _PartialCheckoutRepository()
      ..policyValue = CheckoutPolicy.fromJson(_policy);
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
    final entry = await _signedInEntry();
    final checkout = _controller(repository);
    await checkout.loadPolicy(
      merchantId: '00000000-0000-4000-8000-000000000001',
      locationId: '00000000-0000-4000-8000-000000000002',
      operatorSessionId: '00000000-0000-4000-8000-000000000003',
      currency: 'MXN',
    );
    final root = testRoot();
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        home: Builder(
          builder: (context) => PosPage(
            body: PosButton(
              onPressed: () => showCheckoutSheet(
                context,
                checkout: checkout,
                cashShiftId: '00000000-0000-4000-8000-000000000005',
                cart: cart,
                entry: entry,
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

    expect(find.byType(PartialCheckoutSurface), findsNothing);

    await tester.pumpWidget(const SizedBox());
    root.dispose();
    entry.dispose();
    cart.dispose();
    checkout.dispose();
  });

  testWidgets('a tender corrected after the preview re-keys the pair before the charge', (
    tester,
  ) async {
    // The pair the closeout asserts is keyed on the command WITHOUT its customer value — the
    // basis. Correct a tender after the preview was taken (the customer hands over a 500 note) and
    // the basis moves with it, so the row on file names a command that no longer exists and the
    // commit is refused as stale: measured on the iMin D3-504 on 2026-10-11 at 13:37:44, with the
    // till saying only "No fue posible completar el cobro de forma segura." The sheet asks for the
    // new basis and re-keys the row before it charges.
    final sheet = await _openValueSheet(tester);
    final repository = sheet.repository
      // A repriced total takes the sheet to its confirmation screen, which is where a real
      // operator corrects the tender.
      ..repricedGrandTotalMinorUnits = 39900
      // …and the corrected tender is a different command, so the server answers a different
      // fingerprint for it, exactly as the calculator's hash of the tender drafts does.
      ..fingerprintFollowsTheCommand = true;
    final value = sheet.value;
    await tester.tap(find.widgetWithText(PosButton, 'Checkout · MXN 116.00'));
    await tester.pumpAndSettle();
    expect(value.requests, hasLength(1));
    final firstBasis = value.requests.first.checkoutFingerprint;

    // The correction: the cash the customer handed over, after the preview.
    await tester.tap(find.text('MXN 500.00'));
    await tester.pumpAndSettle();
    // The sheet is showing the repriced total, and the edit turns the confirm back into a charge.
    await tester.tap(find.widgetWithText(PosButton, 'Checkout · MXN 399.00'));
    await tester.pumpAndSettle();
    expect(
      value.requests,
      hasLength(2),
      reason: 'the basis moved, so the row has to be written again',
    );
    expect(value.requests.last.checkoutFingerprint, isNot(firstBasis));

    // The server answers the re-keyed preview, and only then can the charge name it.
    value.answer();
    await tester.pumpAndSettle();
    expect(
      repository.commands.last.customerValue?['previewFingerprint'],
      _rekeyedPreviewFingerprint,
      reason: 'the commit names the preview the corrected command was keyed on',
    );
    expect(tester.takeException(), isNull);
    await sheet.dispose();
  });

  testWidgets(
    'cash shortage disables charge until the received amount covers the bill',
    (tester) async {
      final repository = _CheckoutRepository()
        ..policyValue = CheckoutPolicy.fromJson(_policy);
      final sheet = await _openTenderSheet(
        tester,
        repository,
        policy: CheckoutPolicy.fromJson(_policy),
      );
      await tester.tap(find.text('MXN 100.00'));
      await tester.pumpAndSettle();
      final charge = find.widgetWithText(PosButton, 'Checkout · MXN 116.00');
      expect(tester.widget<PosButton>(charge).onPressed, isNull);
      expect(repository.commands, isEmpty);
      await tester.tap(find.text('MXN 200.00'));
      await tester.pumpAndSettle();
      expect(tester.widget<PosButton>(charge).onPressed, isNotNull);
      await sheet.dispose();
    },
  );

  testWidgets('a tip is collected: the tender covers the amount due it creates', (
    tester,
  ) async {
    // The server adds the tip to the amount due (`amountDue = discountedSubtotal + tipAmount`) and
    // then checks the tenders cover it. The applied legs used to be balanced against the BILL alone,
    // so a 10 % tip on this MXN 116.00 sale left the till reading `Falta por cobrar MXN 11.60` with
    // nothing able to raise the applied amount and a charge refused as a remaining balance —
    // measured on the iMin D3-504 on 2026-10-11.
    final repository = _CheckoutRepository()
      ..policyValue = CheckoutPolicy.fromJson(_policy);
    final sheet = await _openTenderSheet(
      tester,
      repository,
      policy: CheckoutPolicy.fromJson(_policy),
    );
    await tester.tap(find.text('10%'));
    await tester.pumpAndSettle();
    // 10 % of 116.00 is 11.60, so the cash the till applies and receives is 127.60.
    expect(find.text('127.60'), findsWidgets);

    final charge = find.byType(PosButton).last;
    await tester.ensureVisible(charge);
    await tester.tap(charge);
    await tester.pumpAndSettle();

    final command = repository.commands.last;
    expect(command.tipDraft?['basisPoints'], 1000);
    final cash = (command.tenderDrafts as List<Object?>)
        .cast<Map<String, Object?>>()
        .firstWhere((tender) => tender['type'] == 'cash');
    expect(
      (cash['amount']! as Map<String, Object?>)['minorUnits'],
      12760,
      reason:
          'the tender has to cover the bill and the tip the server will ask for',
    );
    await sheet.dispose();
  });

  testWidgets('a tip does not overwrite what the customer handed over', (
    tester,
  ) async {
    // The customer puts MXN 500.00 on a MXN 116.00 bill and the operator THEN adds a tip.
    // The change is what is left of the 500 once the bill and the tip are paid (500 − 127.60
    // = 372.40), and the 500 stays on screen. The till used to rewrite the received amount
    // with the new total on every draft change, so the change read zero and the money on
    // the counter disappeared from the screen (owner, 2026-10-13).
    final repository = _CheckoutRepository()
      ..policyValue = CheckoutPolicy.fromJson(_policy);
    final sheet = await _openTenderSheet(
      tester,
      repository,
      policy: CheckoutPolicy.fromJson(_policy),
    );

    final cashReceivedField = find.ancestor(
      of: find.text('Cash received'),
      matching: find.byType(PosField),
    );
    await tester.tap(cashReceivedField);
    await tester.pump();
    for (final key in ['5', '0', '0']) {
      await tester.tap(find.text(key).first);
      await tester.pump();
    }
    await tester.pumpAndSettle();

    await tester.tap(find.text('10%'));
    await tester.pumpAndSettle();

    // Lo que el cliente puso en el mostrador sigue ahí: el campo no se reescribe con el
    // total. (Se teclea 500 y el campo muestra 500 — el formateo a dos decimales es de los
    // botones de efectivo rápido, no de cada tecla.)
    expect(
      find.text('500'),
      findsWidgets,
      reason: 'el efectivo recibido no se reescribe',
    );
    expect(find.text('MXN 372.40'), findsOneWidget);
    await sheet.dispose();
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
      PosApp(
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,

          GlobalWidgetsLocalizations.delegate,
        ],
        home: Builder(
          builder: (context) => PosPage(
            body: PosButton(
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
    expect(find.text('Checkout'), findsOneWidget);
    // The redesigned SOTA tender screen: a hero total, the payment-method tile,
    // the cash-received flow with quick-cash notes and an on-screen keypad, the
    // colour-coded change block. Receipt delivery uses the default display path.
    expect(find.text('TOTAL'), findsOneWidget);
    expect(find.text('Payment selection'), findsOneWidget);
    expect(find.text('Cash'), findsWidgets);
    expect(find.text('Cash received'), findsOneWidget);
    expect(find.text('Exact amount'), findsOneWidget);
    expect(find.text('MXN 500.00'), findsOneWidget); // a quick-cash note
    expect(find.text('7'), findsWidgets); // a keypad key
    expect(find.text('Change due'), findsOneWidget);
    expect(find.text('Receipt destination'), findsNothing);
    expect(find.text('MXN 116.00'), findsWidgets);
    // Changing the received cash must not add another confirmation. The
    // operator has already reviewed the visible total and tender.
    await tester.tap(find.text('MXN 500.00'));
    await tester.pumpAndSettle();
    // One-tap checkout: the charge button reviews the total server-side and, when
    // it matches what the cashier saw, commits in the same action. It is the last
    // PosButton (after the harness's own "open" button).
    final charge = find.byType(PosButton).last;
    await tester.ensureVisible(charge);
    await tester.tap(charge);
    await tester.pumpAndSettle();
    // The completed screen is the PoloTab-style change/paid summary.
    expect(find.text('Paid'), findsOneWidget);
    expect(find.text('New order'), findsOneWidget);
    // AND NO FIELD IS STILL WAITING FOR TYPING. The tender's amount field kept focus through the
    // commit, so Android left the soft keyboard open over this screen — measured on the iMin
    // D3-504 on 2026-10-10, where it covered the lower half of the till. A Linux window has a
    // hardware keyboard, so this assertion is the only place the desktop can hold the line.
    expect(
      tester
          .widgetList<EditableText>(find.byType(EditableText))
          .where((field) => field.focusNode.hasFocus),
      isEmpty,
    );
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
        PosApp(
          locale: const Locale('en'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,

            GlobalWidgetsLocalizations.delegate,
          ],
          home: Builder(
            builder: (context) => PosPage(
              body: PosButton(
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
      PosApp(
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,

          GlobalWidgetsLocalizations.delegate,
        ],
        home: Builder(
          builder: (context) => PosPage(
            body: PosButton(
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
    expect(find.text('This order cannot be paid like this'), findsOneWidget);
    expect(find.text('Cash received'), findsOneWidget);
    // ...the unpayable half is NOT adopted (the terminal's own field is absent)...
    expect(find.text('Amount applied'), findsNothing);
    // ...and the charge is refused rather than offered.
    final charge = tester.widget<PosButton>(find.byType(PosButton).last);
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
      PosApp(
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,

          GlobalWidgetsLocalizations.delegate,
        ],
        home: Builder(
          builder: (context) => PosPage(
            body: PosButton(
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
      PosApp(
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,

          GlobalWidgetsLocalizations.delegate,
        ],
        home: Builder(
          builder: (context) => PosPage(
            body: PosButton(
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
      matching: find.byType(PosField),
    );
    // The customer hands over MXN 100.00 for a MXN 58.00 cash leg. The change is
    // MXN 42.00 — measured against the cash leg. Before this was fixed the sheet
    // compared the drawer against the whole MXN 116.00 bill and said the customer
    // still owed MXN 16.00, with the money already on the counter.
    // The keypad is the only input the cash field takes now (a POS often has no keyboard
    // and the real one covered the number being read), so the test drives the keys the
    // operator would: tap the field to point the keypad at it, then type.
    await tester.tap(cashReceivedField);
    await tester.pump();
    for (final key in ['1', '0', '0', '.', '0', '0']) {
      await tester.tap(find.text(key).first);
      await tester.pump();
    }
    await tester.pumpAndSettle();
    expect(find.text('Change due'), findsOneWidget);
    expect(find.text('MXN 42.00'), findsOneWidget);
    expect(find.text('Amount due'), findsNothing);

    // And the other direction still names what is missing: MXN 20.00 on the
    // counter leaves MXN 38.00 of the cash leg unpaid.
    await tester.tap(cashReceivedField);
    await tester.pump();
    for (final key in ['2', '0', '.', '0', '0']) {
      await tester.tap(find.text(key).first);
      await tester.pump();
    }
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

  testWidgets('bank instructions never charge; only a confirmed deposit does', (
    tester,
  ) async {
    final repository = _CheckoutRepository();
    final sheet = await _openTenderSheet(
      tester,
      repository,
      policy: CheckoutPolicy.fromJson({
        ..._policy,
        'bankTransferEnabled': true,
        'bankTransferDetails': {
          'holderName': 'ONCA DEMO',
          'bankName': 'Banco de prueba',
          'clabe': '012345678901234567',
          'accountNumber': null,
        },
      }),
    );

    await tester.tap(find.byKey(const ValueKey('method-bank-transfer')));
    await tester.pumpAndSettle();
    expect(find.text('ONCA DEMO'), findsOneWidget);
    expect(find.text('ONCA Cuenta 182'), findsOneWidget);
    expect(find.byKey(const ValueKey('bank-transfer-clabe')), findsOneWidget);
    expect(
      find.byKey(const ValueKey('bank-transfer-modal-amount')),
      findsOneWidget,
    );
    expect(repository.commands, isEmpty);

    await tester.tap(find.byKey(const ValueKey('bank-transfer-close')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('bank-transfer-amount')), findsNothing);
    expect(repository.commands, isEmpty);

    await tester.tap(find.byKey(const ValueKey('method-bank-transfer')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('bank-transfer-select')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('bank-transfer-amount')), findsOneWidget);
    expect(find.byKey(const ValueKey('tender-bank-transfer')), findsOneWidget);
    final bankIcon = find.descendant(
      of: find.byKey(const ValueKey('tender-bank-transfer')),
      matching: find.byType(PosIcon),
    );
    expect(tester.getSize(bankIcon.first).width, lessThanOrEqualTo(64));
    expect(find.text('Terminal charge'), findsNothing);
    expect(repository.commands, isEmpty);

    await tester.tap(find.textContaining('Checkout ·'));
    await tester.pumpAndSettle();
    expect(find.text('Confirm deposit received'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('bank-transfer-confirm-close')));
    await tester.pumpAndSettle();
    expect(repository.commands, isEmpty);

    await tester.tap(find.textContaining('Checkout ·'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('bank-transfer-confirm')));
    await tester.pumpAndSettle();
    expect(repository.commands, isNotEmpty);
    expect(repository.commands.first.paymentMethod, 'bank_transfer');
    final tender = repository.commands.first.tenderDrafts!.singleWhere(
      (draft) => draft['type'] == 'bank_transfer',
    );
    expect(tender['status'], 'confirmed_success');
    expect(tender['amount'], {'minorUnits': 11600, 'currency': 'MXN'});
    await sheet.dispose();
  });

  testWidgets('manual card payment uses the tap icon and needs confirmation', (
    tester,
  ) async {
    final repository = _CheckoutRepository();
    final sheet = await _openTenderSheet(
      tester,
      repository,
      policy: CheckoutPolicy.fromJson(_policy),
    );
    await tester.tap(find.text('Manual terminal'));
    await tester.pumpAndSettle();
    final face = find.byKey(const ValueKey('tender-terminal'));
    final icon = find.descendant(of: face, matching: find.byType(SvgPicture));
    expect(icon, findsOneWidget);
    expect(tester.getSize(icon), const Size(104, 78));
    expect(find.text('Processing externally'), findsOneWidget);
    expect(find.text('Charging outside the POS'), findsOneWidget);
    expect(find.text('Payment failed'), findsNothing);
    expect(find.text('Receipt destination'), findsNothing);

    await tester.tap(find.textContaining('Checkout ·'));
    await tester.pumpAndSettle();
    expect(find.text('Confirm the terminal charge'), findsOneWidget);
    await tester.tap(
      find.byKey(const ValueKey('manual-terminal-confirm-close')),
    );
    await tester.pumpAndSettle();
    expect(repository.commands, isEmpty);

    await tester.tap(find.textContaining('Checkout ·'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('manual-terminal-confirm')));
    await tester.pumpAndSettle();
    expect(repository.commands, isNotEmpty);
    final tender = repository.commands.first.tenderDrafts!.singleWhere(
      (draft) => draft['type'] == 'manual_terminal',
    );
    expect(tender['status'], 'confirmed_success');
    expect(tender['amount'], {'minorUnits': 11600, 'currency': 'MXN'});
    await sheet.dispose();
  });

  testWidgets('bank transfer is absent until the location enables it', (
    tester,
  ) async {
    final sheet = await _openTenderSheet(
      tester,
      _CheckoutRepository(),
      policy: CheckoutPolicy.fromJson(_policy),
    );
    expect(find.byKey(const ValueKey('method-bank-transfer')), findsNothing);
    await sheet.dispose();
  });

  testWidgets('bank instructions show only the bank leg of a split', (
    tester,
  ) async {
    final repository = _CheckoutRepository();
    final sheet = await _openTenderSheet(
      tester,
      repository,
      policy: CheckoutPolicy.fromJson({
        ..._policy,
        'maximumTenderLines': 2,
        'bankTransferEnabled': true,
        'bankTransferDetails': {
          'holderName': 'ONCA DEMO',
          'bankName': 'Banco de prueba',
          'clabe': '000000000000000000',
        },
      }),
    );
    await tester.tap(find.byKey(const ValueKey('tender-split-arm')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('method-bank-transfer')));
    await tester.pumpAndSettle();
    expect(find.text('MXN 58.00'), findsWidgets);
    await tester.tap(find.byKey(const ValueKey('bank-transfer-select')));
    await tester.pumpAndSettle();
    final field = tester.widget<PosField>(
      find.byKey(const ValueKey('bank-transfer-amount')),
    );
    expect(field.controller?.text, '58.00');
    expect(repository.commands, isEmpty);
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

  testWidgets('an unequal split allocates the remaining amount', (
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

    final cashAppliedField = find.byWidgetPredicate(
      (widget) =>
          widget is PosField && widget.decoration?.labelText == 'Cash applied',
    );
    await tester.enterText(cashAppliedField, '20.00');
    await tester.pumpAndSettle();
    expect(
      find.text('1. Cash: MXN 20.00   2. Manual terminal: MXN 96.00'),
      findsOneWidget,
    );
    expect(find.textContaining('Short by'), findsNothing);
    expect(find.textContaining('Over by'), findsNothing);
    final charge = tester.widget<PosButton>(find.byType(PosButton).last);
    expect(charge.onPressed, isNotNull);

    await tester.tap(find.text('10%'));
    await tester.pumpAndSettle();
    expect(
      find.text('1. Cash: MXN 20.00   2. Manual terminal: MXN 107.60'),
      findsOneWidget,
      reason: 'la propina conserva el importe que el cajero asignó a efectivo',
    );
    final terminalField = find.byWidgetPredicate(
      (widget) =>
          widget is PosField &&
          widget.decoration?.labelText == 'Amount applied' &&
          widget.controller?.text == '107.60',
    );
    await tester.enterText(terminalField, '40.00');
    await tester.pumpAndSettle();
    expect(
      find.text('1. Cash: MXN 87.60   2. Manual terminal: MXN 40.00'),
      findsOneWidget,
      reason: 'editar el importe de tarjeta calcula el resto en efectivo',
    );
    expect(
      tester.widget<PosButton>(find.byType(PosButton).last).onPressed,
      isNotNull,
    );

    await sheet.dispose();
  });

  testWidgets('card tip opens the on-screen keypad and hides receipt choices', (
    tester,
  ) async {
    final sheet = await _openTenderSheet(
      tester,
      _CheckoutRepository(),
      policy: CheckoutPolicy.fromJson(_policy),
    );
    await tester.tap(find.text('Manual terminal'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('tender-tip-keypad')), findsNothing);
    expect(find.text('Receipt destination'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('custom-tip-percentage')));
    await tester.pumpAndSettle();
    final keypad = find.byKey(const ValueKey('tender-tip-keypad'));
    expect(keypad, findsOneWidget);
    tester.view.physicalSize = const Size(1920, 1080);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(tester.getRect(keypad).bottom, lessThan(820));
    for (final digit in ['1', '2', '.', '5']) {
      await tester.tap(find.descendant(of: keypad, matching: find.text(digit)));
      await tester.pump();
    }
    final percent = tester.widget<PosField>(
      find.byKey(const ValueKey('custom-tip-percentage')),
    );
    expect(percent.controller?.text, '12.5');
    final terminal = tester.widget<PosField>(
      find.byWidgetPredicate(
        (widget) =>
            widget is PosField &&
            widget.decoration?.labelText == 'Amount applied',
      ),
    );
    expect(terminal.controller?.text, '130.50');
    expect(find.text('MXN 130.50'), findsWidgets);
    expect(find.text('Checkout · MXN 130.50'), findsOneWidget);
    await tester.tap(
      find.descendant(of: keypad, matching: find.text('Confirm')),
    );
    await tester.pumpAndSettle();
    expect(keypad, findsNothing);
    expect(find.byKey(const ValueKey('tender-terminal')), findsOneWidget);
    await sheet.dispose();
  });

  testWidgets('fixed tip also uses the keypad with a card', (tester) async {
    final sheet = await _openTenderSheet(
      tester,
      _CheckoutRepository(),
      policy: CheckoutPolicy.fromJson(_policy),
    );
    await tester.tap(find.text('Manual terminal'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('custom-tip-fixed')));
    await tester.pumpAndSettle();
    final keypad = find.byKey(const ValueKey('tender-tip-keypad'));
    expect(keypad, findsOneWidget);
    for (final digit in ['5', '.', '0', '0']) {
      await tester.tap(find.descendant(of: keypad, matching: find.text(digit)));
      await tester.pump();
    }
    final fixed = tester.widget<PosField>(
      find.byKey(const ValueKey('custom-tip-fixed')),
    );
    expect(fixed.controller?.text, '5.00');
    final terminal = tester.widget<PosField>(
      find.byWidgetPredicate(
        (widget) =>
            widget is PosField &&
            widget.decoration?.labelText == 'Amount applied',
      ),
    );
    expect(terminal.controller?.text, '121.00');
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
  for (final hold in ['free', 'held_by_active_till']) {
    testWidgets(
      'cash refusal offers opening only for an available drawer: $hold',
      (tester) async {
        final repository = _CheckoutRepository()
          ..requireCashShift = true
          ..cashHoldState = hold;
        var opens = 0;
        final pending = Completer<String?>();
        final sheet = await _openTenderSheet(
          tester,
          repository,
          policy: CheckoutPolicy.fromJson(_policy),
          onOpenCashShift: () {
            opens++;
            return pending.future;
          },
        );
        await sheet.checkout.preview(
          merchantId: '00000000-0000-4000-8000-000000000001',
          locationId: '00000000-0000-4000-8000-000000000002',
          operatorSessionId: '00000000-0000-4000-8000-000000000003',
          cartId: '00000000-0000-4000-8000-000000000004',
          cartVersion: 3,
          paymentMethod: 'cash',
          cashReceivedMinorUnits: 11600,
        );
        await sheet.checkout.confirm();
        await tester.pumpAndSettle();
        expect(sheet.checkout.state.errorCode, 'CASH_SHIFT_REQUIRED');
        final action = find.widgetWithText(
          PosButton,
          'Open cash shift and continue',
        );
        if (hold == 'held_by_active_till') {
          expect(action, findsNothing);
          expect(opens, 0);
        } else {
          await tester.tap(action);
          await tester.pump();
          expect(opens, 1);
          expect(tester.widget<PosButton>(action).onPressed, isNull);
          pending.complete('00000000-0000-4000-8000-000000000009');
          await tester.pumpAndSettle();
          expect(sheet.checkout.state.phase, CheckoutPhase.completed);
          expect(
            repository.commands.last.cashShiftId,
            '00000000-0000-4000-8000-000000000009',
          );
          final commits = repository.commands
              .where((c) => c.totalsFingerprint != null)
              .toList();
          expect(commits.length, 2);
          expect(commits.first.commandId, commits.last.commandId);
          expect(commits.first.idempotencyKey, commits.last.idempotencyKey);
          expect(commits.first.cartId, commits.last.cartId);
        }
        expect(tester.takeException(), isNull);
        await sheet.dispose();
      },
    );
  }

  testWidgets(
    'the one-tap charge waits for the loyalty preview the command has to carry',
    (tester) async {
      // A sale with a customer attached cannot be charged unless the command
      // carries the loyalty preview's fingerprint: the database asserts it and
      // refuses the commit with `LOYALTY_PREVIEW_STALE` when the half is missing
      // (`merchant.assert_loyalty_earn_preview`). The sheet charges in one action —
      // review, then commit — so the preview it showed and the commit it sends race.
      // This test parks the preview and proves the commit WAITS for it.
      final sheet = await _openValueSheet(tester);
      final repository = sheet.repository;
      final value = sheet.value;
      final checkout = sheet.checkout;
      final charge = find.widgetWithText(PosButton, 'Checkout · MXN 116.00');
      expect(find.text('Confirm and pay'), findsNothing);
      await tester.ensureVisible(charge);
      await tester.tap(charge);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      // The review has gone out and asked for the preview. While that answer is
      // parked, only the repricing command may exist: a commit here is the defect.
      expect(value.requests, hasLength(1));
      expect(repository.commands, hasLength(1));
      expect(find.text('Payment is processing'), findsOneWidget);
      expect(find.text('Confirm and pay'), findsNothing);
      value.answer();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      // THREE commands, in the order the contract needs: the review that found the total, the
      // review that carries the value, and the commit.
      expect(repository.commands, hasLength(3));
      final reviews = repository.commands
          .where((command) => command.totalsFingerprint == null)
          .toList();
      final commits = repository.commands
          .where((command) => command.totalsFingerprint != null)
          .toList();
      expect(reviews, hasLength(2));
      expect(reviews.first.customerValue, isNull);
      expect(
        reviews.last.customerValue?['previewFingerprint'],
        _previewFingerprint,
      );
      // The commit names the confirmation that carries the value, and both halves of the pair.
      expect(commits, hasLength(1));
      expect(
        commits.single.totalsFingerprint,
        _CheckoutRepository.valuedFingerprint,
      );
      expect(
        commits.single.customerValue?['previewFingerprint'],
        _previewFingerprint,
      );
      expect(
        commits.single.customerValue?['storedValueFingerprint'],
        _CheckoutRepository.valuedStoredValueFingerprint,
      );
      expect(
        commits.single.customerValue!.entries.where(
          (entry) => entry.value == null,
        ),
        isEmpty,
      );
      // ONE preview per checkout version — the server can only hold one.
      expect(value.requests, hasLength(1));
      expect(checkout.state.phase, CheckoutPhase.completed);
      expect(tester.takeException(), isNull);
      await sheet.dispose();
    },
  );

  testWidgets(
    'the money screen keeps its methods and its charge action on the till canvas',
    (tester) async {
      // The playbook's own check: "money screens fit one screen". The loyalty panel grows when it
      // has something to say (points, a wallet with its own buttons, a reward row), and the method
      // tiles sit BELOW it — so the panel is what can push `Efectivo` and the charge action off the
      // till's canvas. Measured at the iMin's own logical size, 1396x737.
      final sheet = await _openValueSheet(tester);
      // A repriced total that differs from the one on screen is how the operator reaches the
      // confirmation screen, where the panel HAS its answer and the charge is still ahead.
      sheet.repository.repricedGrandTotalMinorUnits = 99900;
      final charge = find.widgetWithText(PosButton, 'Checkout · MXN 116.00');
      await tester.ensureVisible(charge);
      await tester.tap(charge);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      sheet.value.answer();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      final canvas = Offset.zero & tester.view.physicalSize;
      for (final finder in [
        find.text('Cash'),
        find.widgetWithText(PosButton, 'Checkout · MXN 999.00'),
      ]) {
        final rect = tester.getRect(finder.first);
        expect(
          rect.top >= canvas.top && rect.bottom <= canvas.bottom,
          isTrue,
          reason:
              '$finder sits at $rect, outside the $canvas the till draws on',
        );
      }
      await sheet.dispose();
    },
  );
}
