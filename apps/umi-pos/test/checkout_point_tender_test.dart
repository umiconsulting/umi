import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/bootstrap/composition_root.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/checkout/checkout_controller.dart';
import 'package:umi_pos/features/checkout/checkout_repository.dart';
import 'package:umi_pos/features/checkout/checkout_surface.dart';
import 'package:umi_pos/features/checkout/tender_identity.dart';
import 'package:umi_pos/features/entry/device_channel_socket_client.dart';

import 'support/fakes.dart';

/// Phase 3 of the Point plan: the till's card-terminal tender.
///
/// Every case here runs against a fake repository that speaks BOTH
/// [CheckoutRepository] and [TerminalTenderRepository] — the second interface is
/// how the card routes arrive without breaking the cash-only fakes in
/// `checkout_test.dart`.
const _merchantId = '00000000-0000-4000-8000-000000000001';
const _locationId = '00000000-0000-4000-8000-000000000002';
const _operatorSessionId = '00000000-0000-4000-8000-000000000003';
const _cartId = '00000000-0000-4000-8000-000000000004';
const _providerId = 'mercado_pago_point';

const _cartTotals = {
  'subtotal': {'minorUnits': 11600, 'currency': 'MXN'},
  'tax': {'minorUnits': 1600, 'currency': 'MXN'},
  'discounts': {
    'total': {'minorUnits': 0, 'currency': 'MXN'},
    'entries': <Object?>[],
  },
  'grandTotal': {'minorUnits': 11600, 'currency': 'MXN'},
  'businessDate': '2026-07-28',
};

const _confirmation = {
  'cartVersion': 3,
  'fingerprint':
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'totals': _cartTotals,
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

/// The card tender's identity is derived from the cart, which is the whole
/// reason a payment row written at commit can still name the attempt the
/// terminal is holding.
final _cardTenderId = tenderId(_cartId, 'card_terminal');

/// One method at a time: selecting the card terminal retires cash, which is the
/// shape a till with one terminal actually has.
const _policy = {
  'version': 'test-1',
  'manualTerminalEnabled': true,
  'mixedTenderEnabled': false,
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

Map<String, Object?> _attemptJson({
  required String commandIdentity,
  required String state,
  String? providerStatus,
  String? queryAfter,
  String? providerPaymentId,
}) => {
  'id': '00000000-0000-4000-8000-0000000000aa',
  'commandIdentity': commandIdentity,
  'cartId': _cartId,
  'locationId': _locationId,
  'method': 'external_terminal',
  'family': 'card_present',
  'provider': _providerId,
  'state': state,
  'queryOnly': state == 'unknown' || state == 'timeout',
  'amount': const {'minorUnits': 11600, 'currency': 'MXN'},
  'providerOrderId': 'POINT-ORDER-1',
  'providerPaymentId': providerPaymentId,
  'providerStatus': providerStatus,
  'proofSource': state == 'succeeded' ? 'provider' : null,
  'correlationId': 'point-test',
  'queryAfter': queryAfter,
  'expiresAt': null,
  'createdAt': '2026-09-17T00:00:00.000Z',
  'resolvedAt': state == 'succeeded' ? '2026-09-17T00:00:10.000Z' : null,
};

/// The tender routes' own fake: it answers what the till asked, and remembers
/// every question so a test can assert the identity and the `refresh` flag.
final class _PointRepository
    implements CheckoutRepository, TerminalTenderRepository {
  _PointRepository({
    this.providers = const [],
    this.providerReadFails = false,
    this.policyOverride,
  });

  /// The location's policy, when a test needs a different one from `_policy`
  /// (a location that allows a divided payment, for instance).
  final Map<String, Object?>? policyOverride;

  /// What `pos.tenderProviders` answers. An empty list is a location that offers
  /// no card terminal at all.
  final List<Map<String, Object?>> providers;

  /// The read itself failing — the case that must leave the screen exactly as it
  /// was, cash only, and never block a sale.
  final bool providerReadFails;

  final providerQueries = <TenderProviderQuery>[];

  /// What `pos.tenderAttempt` answers, in order; the last answer repeats. An
  /// empty queue is the 404: `TENDER_ATTEMPT_NOT_FOUND`, a normal answer that
  /// means no attempt exists for this identity.
  final attemptAnswers = <Map<String, Object?>>[];
  final attemptQueries = <TenderAttemptQuery>[];
  final attemptIdentities = <String>[];
  int _attemptIndex = 0;

  /// What a capture answers with.
  Map<String, Object?> captureOutcome = const {
    'kind': 'unknown',
    'providerStatus': 'at_terminal',
    'code': 'TERMINAL_STILL_WORKING',
    'message': null,
  };
  String? captureFailureCode;

  final captures = <TenderCaptureRequest>[];
  final settlements = <TenderSettlementRequest>[];
  final commands = <CheckoutCommand>[];

  /// Answer the commit with `PAYMENT_UNKNOWN` instead of a completed sale: how a
  /// real server refuses a sale whose attempt nobody resolved.
  bool refuseCommitAsPaymentUnknown = false;

  @override
  Future<CheckoutPolicy> policy(
    String merchantId,
    PosCheckoutPolicyQuery query,
  ) async => CheckoutPolicy.fromJson(policyOverride ?? _policy);

  @override
  Future<TenderProviderList> tenderProviders(
    String merchantId,
    TenderProviderQuery query,
  ) async {
    providerQueries.add(query);
    if (providerReadFails) {
      throw const AppException(
        category: AppErrorCategory.transport,
        code: 'TRANSPORT_FAILURE',
        recoverable: true,
      );
    }
    return TenderProviderList(providers: providers);
  }

  @override
  Future<TenderCaptureResult> captureTender(
    String merchantId,
    TenderCaptureRequest request,
  ) async {
    captures.add(request);
    final failure = captureFailureCode;
    if (failure != null) {
      throw AppException(
        category: AppErrorCategory.transport,
        code: failure,
        recoverable: true,
      );
    }
    final kind = captureOutcome['kind'];
    final state = kind == 'declined'
        ? 'declined'
        : kind == 'succeeded'
        ? 'succeeded'
        : 'unknown';
    return TenderCaptureResult.fromJson({
      'attempt': _attemptJson(
        commandIdentity: request.commandIdentity,
        state: state,
        providerStatus: captureOutcome['providerStatus'] as String?,
      ),
      'outcome': captureOutcome,
      'ambiguity': null,
      'idempotentReplay': false,
      'providerCalled': true,
      'capturedAt': '2026-09-17T00:00:00.000Z',
    });
  }

  @override
  Future<TenderAttemptResult> tenderAttempt(
    String merchantId,
    String commandIdentity,
    TenderAttemptQuery query,
  ) async {
    attemptQueries.add(query);
    attemptIdentities.add(commandIdentity);
    if (attemptAnswers.isEmpty) {
      // A 404 is "no attempt for this identity" — a normal answer, not an error.
      throw const AppException(
        category: AppErrorCategory.permission,
        code: 'TENDER_ATTEMPT_NOT_FOUND',
        recoverable: false,
      );
    }
    final answer =
        attemptAnswers[_attemptIndex.clamp(0, attemptAnswers.length - 1)];
    _attemptIndex++;
    final state = answer['state'] as String? ?? 'unknown';
    return TenderAttemptResult.fromJson({
      'attempt': _attemptJson(
        commandIdentity: commandIdentity,
        state: state,
        providerStatus: answer['providerStatus'] as String?,
        queryAfter: answer['queryAfter'] as String?,
        providerPaymentId: answer['providerPaymentId'] as String?,
      ),
      'outcome': {
        'kind': state == 'succeeded'
            ? 'succeeded'
            : state == 'declined' || state == 'cancelled'
            ? 'declined'
            : 'unknown',
        'providerStatus': answer['providerStatus'],
        'code': answer['code'] ?? answer['providerStatus'],
        'message': null,
      },
      'ambiguity': null,
      'providerAsked': query.refresh ?? false,
      'resolvedNow': state == 'succeeded',
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
      'attempt': _attemptJson(
        commandIdentity: commandIdentity,
        state: request.outcome == 'paid' ? 'succeeded' : 'declined',
        providerStatus: 'operator_attested',
      ),
      'outcome': request.outcome,
      'proofSource': 'operator_attested',
      'evidence': request.evidence,
      'note': request.note,
      'previousState': 'unknown',
      'settledAt': '2026-09-17T00:00:01.000Z',
      'correlationId': 'point-test',
    });
  }

  @override
  Future<CheckoutResult> checkout(
    String merchantId,
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
          'correlationId': 'point-test',
        },
        policy: _policy,
      );
    }
    if (refuseCommitAsPaymentUnknown) {
      return CheckoutResult(
        status: 'payment_unknown',
        confirmation: _confirmation,
        // What a terminal commit actually leaves behind: a `query_only` payment
        // row with NO provider, carrying the tender's identity. That identity is
        // the only key that can reach the terminal's own answer.
        payment: {
          'id': '00000000-0000-4000-8000-000000000021',
          'method': 'external_terminal',
          'status': 'unknown',
          'currency': 'MXN',
          'amountMinorUnits': 11600,
          'tenderId': _cardTenderId,
          'providerStatus': null,
        },
        reservation: null,
        sale: null,
        receipt: null,
        failure: {
          'code': 'PAYMENT_UNKNOWN',
          'retryable': false,
          'operatorGuidance': 'verify_terminal_outcome',
          'correlationId': 'point-test',
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
        'receiptRef': 'POS-point',
        'status': 'committed',
        'committedAt': '2026-07-28T19:00:00.000Z',
        'totals': _confirmation,
      },
      receipt: {
        'receiptRef': 'POS-point',
        'merchantId': _merchantId,
        'locationId': _locationId,
        'issuedAt': '2026-07-28T19:00:00.000Z',
        'businessDate': '2026-07-28',
        'lines': <Object?>[],
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
  ) async => throw UnimplementedError();

  @override
  Future<CheckoutRecoverySnapshot> recovery(
    String merchantId,
    String cartId,
    CheckoutRecoveryQuery query,
  ) async => throw const AppException(
    category: AppErrorCategory.permission,
    code: 'RESOURCE_NOT_FOUND',
    recoverable: false,
  );

  @override
  Future<CheckoutCancellationResult> cancel(
    String merchantId,
    String cartId,
    CheckoutCancellationRequest request,
  ) async => CheckoutCancellationResult(
    cartId: cartId,
    checkoutId: '00000000-0000-4000-8000-000000000020',
    state: 'ready',
    cancelledAt: '2026-07-29T12:00:00.000Z',
  );
}

final class _CartRepository implements CartRepository {
  final cart = const Cart(
    id: _cartId,
    merchantId: _merchantId,
    locationId: _locationId,
    operatorSessionId: _operatorSessionId,
    status: 'prepared',
    version: 3,
    items: [],
    totals: _cartTotals,
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

CheckoutController _controller(_PointRepository repository) =>
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

/// The device channel's own fake: it hands the sheet the nudge the API would, and
/// counts the listens and cancels, so a test can drive the wake-up and its
/// teardown without a socket.
final class _FakeDeviceChannel implements DeviceChannelSocketClient {
  final _nudges = StreamController<TenderAttemptNudge>.broadcast();
  int listens = 0;

  /// Whether the sheet is still listening. A broadcast controller reports a
  /// listener only while one is attached, so this is what "the socket came down
  /// with the sheet" looks like from outside the client.
  bool get listening => _nudges.hasListener;

  @override
  Stream<TenderAttemptNudge> watch() {
    listens++;
    return _nudges.stream;
  }

  @override
  Future<void> close() async {}

  void emit(TenderAttemptNudge nudge) => _nudges.add(nudge);
}

/// One nudge in the server's own shape: IDS ONLY, no amount and no status.
TenderAttemptNudge _nudge({String? commandIdentity, String? attemptId}) =>
    TenderAttemptNudge(
      merchantId: _merchantId,
      attemptId: attemptId ?? '00000000-0000-4000-8000-0000000000aa',
      commandIdentity: commandIdentity ?? tenderId(_cartId, 'card_terminal'),
      cartId: _cartId,
    );

/// A sheet on screen, with its own cart and composition root, disposed by the
/// test that opened it.
final class _Sheet {
  _Sheet(this.tester, this.repository, this.root, this.cart, this.checkout);
  final WidgetTester tester;
  final _PointRepository repository;
  final AppCompositionRoot root;
  final CartController cart;
  final CheckoutController checkout;

  Finder get cardTile => find.byKey(const ValueKey('method-card-terminal'));
  Finder get chargeButton => find.byType(FilledButton).last;

  Future<void> dispose() async {
    await tester.pumpWidget(const SizedBox());
    root.dispose();
    cart.dispose();
    checkout.dispose();
  }
}

Future<_Sheet> _openSheet(
  WidgetTester tester,
  _PointRepository repository, {
  DeviceChannelSocketClient? deviceChannel,
  Duration pollStart = const Duration(seconds: 10),
  Duration pollCap = const Duration(seconds: 10),
  Duration waitBound = const Duration(seconds: 60),
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(1280, 3200);
  addTearDown(tester.view.reset);
  final cartRepository = _CartRepository();
  final cart = CartController(
    repository: cartRepository,
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
  await cart.open(_merchantId, _locationId, _operatorSessionId);
  final root = testRoot();
  final checkout = _controller(repository);
  // The harness has no signed-in operator, so the sheet's own `initState` read
  // does not fire; the read is made here, exactly as the sheet would make it.
  await checkout.loadPolicy(
    merchantId: _merchantId,
    locationId: _locationId,
    operatorSessionId: _operatorSessionId,
    currency: 'MXN',
  );
  await tester.pumpWidget(
    MaterialApp(
      // The plan names the waiting copy in Spanish; the assertions read it.
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
            onPressed: () => showCheckoutSheet(
              context,
              checkout: checkout,
              cashShiftId: null,
              cart: cart,
              entry: root.entry,
              sales: root.sales,
              deviceChannel: deviceChannel,
              cardTerminalPollStart: pollStart,
              cardTerminalPollCap: pollCap,
              cardTerminalWaitBound: waitBound,
            ),
            child: const Text('open'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return _Sheet(tester, repository, root, cart, checkout);
}

void main() {
  // The two reads' WIRE shape, against a fake ApiClient. See the note above it.
  _tenderWireShapeTests();

  testWidgets(
    'an unavailable provider offers no card tile, and cash still pays',
    (tester) async {
      final repository = _PointRepository(
        providers: const [
          {
            'id': _providerId,
            'family': 'card_present',
            'available': false,
            'unavailableReason': 'missing credentials',
          },
        ],
      );
      final sheet = await _openSheet(tester, repository);

      // A button that fails after the customer decided is worse than no button:
      // the read decides the tile, and the read says no.
      expect(sheet.cardTile, findsNothing);
      expect(repository.providerQueries, hasLength(1));

      await tester.tap(sheet.chargeButton);
      await tester.pumpAndSettle();
      expect(find.text('Pagado'), findsOneWidget);
      expect(repository.captures, isEmpty);
      expect(repository.commands, hasLength(2));

      await sheet.dispose();
    },
  );

  testWidgets(
    'a providers read that fails leaves the policy and the sale intact',
    (tester) async {
      final repository = _PointRepository(providerReadFails: true);
      final sheet = await _openSheet(tester, repository);

      // The read is a READ: cash only, exactly as before, and the policy the
      // same request carried still stands.
      expect(sheet.cardTile, findsNothing);
      expect(sheet.checkout.policy, isNotNull);
      expect(find.text('Terminal manual'), findsOneWidget);

      await tester.tap(sheet.chargeButton);
      await tester.pumpAndSettle();
      expect(find.text('Pagado'), findsOneWidget);
      expect(repository.captures, isEmpty);

      await sheet.dispose();
    },
  );

  testWidgets(
    'an available provider captures once, with its own id and the stable identity',
    (tester) async {
      final repository = _PointRepository(
        providers: const [
          {
            'id': _providerId,
            'family': 'card_present',
            'available': true,
            'unavailableReason': null,
          },
        ],
      );
      final sheet = await _openSheet(tester, repository);

      expect(sheet.cardTile, findsOneWidget);
      expect(sheet.checkout.cardTerminalProviderId, _providerId);

      await tester.tap(sheet.cardTile);
      await tester.pumpAndSettle();
      await tester.tap(sheet.chargeButton);
      await tester.pump();

      // One capture, naming the provider the server offered, on the tender that
      // is DERIVED FROM THE CART — so a retry of this sale finds this attempt
      // instead of asking the terminal for a second charge.
      expect(repository.captures, hasLength(1));
      final capture = repository.captures.single;
      expect(capture.provider, _providerId);
      expect(capture.tenderId, tenderId(_cartId, 'card_terminal'));
      expect(capture.commandIdentity, tenderId(_cartId, 'card_terminal'));
      expect(capture.amount['minorUnits'], 11600);
      expect(capture.amount['currency'], 'MXN');

      // The terminal is still working, so the screen waits and the charge button
      // is inert: a second press must never be a second charge.
      expect(find.text('Esperando en la terminal…'), findsWidgets);
      expect(find.text('at_terminal'), findsWidgets);
      await tester.tap(sheet.chargeButton, warnIfMissed: false);
      await tester.pump();
      expect(repository.captures, hasLength(1));
      expect(repository.commands, isEmpty);

      await sheet.dispose();
    },
  );

  testWidgets(
    'a poll that answers succeeded approves the tender, and the commit links it',
    (tester) async {
      final repository =
          _PointRepository(
              providers: const [
                {
                  'id': _providerId,
                  'family': 'card_present',
                  'available': true,
                  'unavailableReason': null,
                },
              ],
            )
            ..attemptAnswers.addAll([
              {
                'state': 'succeeded',
                'providerStatus': 'processed',
                'queryAfter': null,
                'providerPaymentId': 'PAYPROBE-9001',
              },
            ]);
      final sheet = await _openSheet(
        tester,
        repository,
        pollStart: const Duration(milliseconds: 20),
        pollCap: const Duration(milliseconds: 20),
        waitBound: const Duration(seconds: 5),
      );

      await tester.tap(sheet.cardTile);
      await tester.pumpAndSettle();
      await tester.tap(sheet.chargeButton);
      await tester.pump();
      expect(repository.captures, hasLength(1));
      // The capture answered `unknown` — the customer has not finished — so the
      // till waits instead of pretending it knows.
      expect(find.text('Esperando en la terminal…'), findsWidgets);

      // Follow the attempt by the SAME command identity, asking the terminal.
      await tester.pump(const Duration(milliseconds: 25));
      await tester.pump();
      expect(repository.attemptIdentities, isNotEmpty);
      expect(
        repository.attemptIdentities.first,
        tenderId(_cartId, 'card_terminal'),
      );
      expect(repository.attemptQueries.first.refresh, true);

      // The approval is the terminal's, and the till says so.
      expect(find.text('La terminal aprobó el cobro.'), findsWidgets);
      expect(find.text('Cobro confirmado'), findsWidgets);

      // The operator's ordinary Cobrar commits it: no second capture (the commit
      // LINKS the attempt), and the draft the server sees carries the terminal's
      // own state.
      await tester.tap(sheet.chargeButton);
      await tester.pumpAndSettle();
      expect(repository.captures, hasLength(1));
      expect(repository.settlements, isEmpty);
      final card = repository.commands.last.tenderDrafts!.single;
      expect(card['type'], 'manual_terminal');
      expect(card['id'], tenderId(_cartId, 'card_terminal'));
      expect(card['status'], 'confirmed_success');
      expect(find.text('Pagado'), findsOneWidget);

      await sheet.dispose();
    },
  );

  testWidgets(
    'a nudge ends the wait for THIS sale, and another sale\'s changes nothing',
    (tester) async {
      final repository =
          _PointRepository(
              providers: const [
                {
                  'id': _providerId,
                  'family': 'card_present',
                  'available': true,
                  'unavailableReason': null,
                },
              ],
            )
            ..attemptAnswers.addAll([
              {
                'state': 'unknown',
                'providerStatus': 'at_terminal',
                'queryAfter': null,
                'providerPaymentId': null,
              },
              {
                'state': 'succeeded',
                'providerStatus': 'processed',
                'queryAfter': null,
                'providerPaymentId': 'PAYPROBE-9001',
              },
            ]);
      final channel = _FakeDeviceChannel();
      // The poll is TEN MINUTES out and the wait bound is a minute, so nothing
      // but the wake-up can end this wait inside the test.
      final sheet = await _openSheet(
        tester,
        repository,
        deviceChannel: channel,
        pollStart: const Duration(minutes: 10),
        pollCap: const Duration(minutes: 10),
        waitBound: const Duration(minutes: 1),
      );

      await tester.tap(sheet.cardTile);
      await tester.pumpAndSettle();
      await tester.tap(sheet.chargeButton);
      await tester.pump();
      // The wait subscribed, and the poll has asked nothing yet: the customer is
      // still at the terminal.
      expect(channel.listens, 1);
      expect(repository.attemptQueries, isEmpty);
      expect(find.text('Esperando en la terminal…'), findsWidgets);

      // ANOTHER SALE'S CARD. The register is owed an answer of its own, and this
      // is not it: no read, and the screen does not move.
      channel.emit(
        _nudge(commandIdentity: 'another-sale', attemptId: 'another-attempt'),
      );
      await tester.pump();
      expect(repository.attemptQueries, isEmpty);
      expect(find.text('Esperando en la terminal…'), findsWidgets);

      // THIS SALE'S, NAMED ONLY BY ITS ATTEMPT ID. The command identity travels
      // when the sender has it; the attempt id is the identity that always comes
      // back from the row.
      channel.emit(_nudge(commandIdentity: null));
      await tester.pump();
      await tester.pump();
      expect(repository.attemptQueries, hasLength(1));
      expect(
        repository.attemptIdentities.single,
        tenderId(_cartId, 'card_terminal'),
      );
      // The read is the SAME read the poll makes — the identity the capture used,
      // and the terminal asked, because the poll is what a nudge replaces.
      expect(repository.attemptQueries.single.refresh, true);
      // Still working, so the wait goes on.
      expect(find.text('Esperando en la terminal…'), findsWidgets);

      // THIS SALE'S, NAMED BY ITS COMMAND IDENTITY — the identity the capture
      // sent. The terminal has answered by now, so the wait ends AT ONCE.
      channel.emit(_nudge());
      await tester.pump();
      await tester.pump();
      expect(repository.attemptQueries, hasLength(2));
      expect(find.text('La terminal aprobó el cobro.'), findsWidgets);
      expect(find.text('Cobro confirmado'), findsWidgets);

      await sheet.dispose();
    },
  );

  testWidgets(
    'a channel that never connects leaves the poll to resolve the sale',
    (tester) async {
      final repository =
          _PointRepository(
              providers: const [
                {
                  'id': _providerId,
                  'family': 'card_present',
                  'available': true,
                  'unavailableReason': null,
                },
              ],
            )
            ..attemptAnswers.addAll([
              {
                'state': 'succeeded',
                'providerStatus': 'processed',
                'queryAfter': null,
                'providerPaymentId': 'PAYPROBE-9001',
              },
            ]);
      // Wired, listening, and silent: a dropped socket, a server restart, a
      // deployment without the opt-in — all the same to this screen.
      final channel = _FakeDeviceChannel();
      final sheet = await _openSheet(
        tester,
        repository,
        deviceChannel: channel,
        pollStart: const Duration(milliseconds: 20),
        pollCap: const Duration(milliseconds: 20),
        waitBound: const Duration(seconds: 5),
      );

      await tester.tap(sheet.cardTile);
      await tester.pumpAndSettle();
      await tester.tap(sheet.chargeButton);
      await tester.pump();
      expect(channel.listens, 1);
      expect(channel.listening, isTrue);
      expect(repository.attemptQueries, isEmpty);

      // Nothing arrives on the channel, so the POLL answers — the guarantee, not
      // the latency.
      await tester.pump(const Duration(milliseconds: 25));
      await tester.pump();
      expect(repository.attemptQueries, hasLength(1));
      expect(find.text('La terminal aprobó el cobro.'), findsWidgets);

      // And the wait takes its subscription down with the sheet: cancelling the
      // last listener is what closes the socket.
      await sheet.dispose();
      await tester.pump();
      expect(channel.listening, isFalse);
    },
  );

  testWidgets(
    'a declined card is refused, never settled and never a purchase',
    (tester) async {
      final repository =
          _PointRepository(
              providers: const [
                {
                  'id': _providerId,
                  'family': 'card_present',
                  'available': true,
                  'unavailableReason': null,
                },
              ],
            )
            ..captureOutcome = const {
              'kind': 'declined',
              'providerStatus': 'failed',
              'code': 'CARD_DECLINED_51',
              'message': null,
            };
      final sheet = await _openSheet(tester, repository);

      await tester.tap(sheet.cardTile);
      await tester.pumpAndSettle();
      await tester.tap(sheet.chargeButton);
      await tester.pumpAndSettle();

      // The terminal's own code and words, and the sale still open on cash.
      expect(
        find.text('La terminal rechazó el cobro (CARD_DECLINED_51).'),
        findsOneWidget,
      );
      expect(find.text('7'), findsWidgets);
      // No money moved, so nothing is committed and nothing is settled.
      expect(repository.captures, hasLength(1));
      expect(repository.settlements, isEmpty);
      expect(repository.commands, isEmpty);
      expect(find.text('Pagado'), findsNothing);

      await sheet.dispose();
    },
  );

  testWidgets('stopping the wait keeps the unresolved tender and cancels nothing', (
    tester,
  ) async {
    final repository =
        _PointRepository(
            providers: const [
              {
                'id': _providerId,
                'family': 'card_present',
                'available': true,
                'unavailableReason': null,
              },
            ],
          )
          ..attemptAnswers.addAll([
            {
              'state': 'unknown',
              'providerStatus': 'at_terminal',
              // The terminal's own window, well ahead so the assertion below is about
              // the schedule and not about how long the harness took to build.
              'queryAfter': DateTime.now()
                  .toUtc()
                  .add(const Duration(minutes: 5))
                  .toIso8601String(),
              'providerPaymentId': null,
            },
          ]);
    repository.refuseCommitAsPaymentUnknown = true;
    final sheet = await _openSheet(
      tester,
      repository,
      pollStart: const Duration(milliseconds: 20),
      pollCap: const Duration(milliseconds: 20),
      waitBound: const Duration(seconds: 30),
    );

    await tester.tap(sheet.cardTile);
    await tester.pumpAndSettle();
    await tester.tap(sheet.chargeButton);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 25));
    await tester.pump();
    // The first poll came back carrying the terminal's own window, so nothing
    // more is asked until that window elapses — the vendor's rule, not ours.
    expect(repository.attemptQueries, hasLength(1));
    await tester.pump(const Duration(milliseconds: 100));
    expect(repository.attemptQueries, hasLength(1));

    await tester.tap(find.text('Dejar de esperar'));
    await tester.pumpAndSettle();

    // Stopping the wait is not a cancellation: the attempt stays recorded, the
    // tender stays SELECTED as unresolved, and no settlement invents an answer.
    expect(
      find.text(
        'Dejaste de esperar: la terminal puede seguir con el pedido. '
        'El intento queda registrado y se puede consultar.',
      ),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('tender-card-terminal')), findsOneWidget);
    expect(find.text('Resultado desconocido'), findsWidgets);
    expect(repository.settlements, isEmpty);
    expect(repository.captures, hasLength(1));

    // No tile can wave it away either: a card the terminal may have charged
    // stays on the sale until something resolves it.
    await tester.tap(find.text('Efectivo'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('tender-card-terminal')), findsOneWidget);

    // And the commit refuses the whole sale by its own named code rather than
    // closing it over money nobody confirmed.
    await tester.tap(sheet.chargeButton);
    await tester.pumpAndSettle();
    final card = repository.commands.last.tenderDrafts!.singleWhere(
      (draft) => draft['id'] == tenderId(_cartId, 'card_terminal'),
    );
    expect(card['type'], 'manual_terminal');
    expect(card['id'], tenderId(_cartId, 'card_terminal'));
    expect(card['status'], 'outcome_unknown');
    expect(repository.settlements, isEmpty);
    expect(repository.captures, hasLength(1));
    expect(sheet.checkout.state.phase, CheckoutPhase.paymentUnknown);

    await sheet.dispose();
  });

  testWidgets(
    'consulting an unknown card charge asks the terminal, and a decline frees the sale',
    (tester) async {
      final repository =
          _PointRepository(
              providers: const [
                {
                  'id': _providerId,
                  'family': 'card_present',
                  'available': true,
                  'unavailableReason': null,
                },
              ],
            )
            ..attemptAnswers.addAll([
              // The first poll: the terminal has not answered, and its own window
              // is far ahead, so nothing else is asked until the operator asks.
              {
                'state': 'unknown',
                'providerStatus': 'at_terminal',
                'queryAfter': DateTime.now()
                    .toUtc()
                    .add(const Duration(minutes: 5))
                    .toIso8601String(),
                'providerPaymentId': null,
              },
              // What the terminal answers when it is asked again: the payment was
              // cancelled AT the terminal, so no money moved.
              {
                'state': 'cancelled',
                'providerStatus': 'canceled',
                'code': 'PROVIDER_DECLINED',
                'providerPaymentId': null,
              },
            ]);
      repository.refuseCommitAsPaymentUnknown = true;
      final sheet = await _openSheet(
        tester,
        repository,
        pollStart: const Duration(milliseconds: 20),
        pollCap: const Duration(milliseconds: 20),
        waitBound: const Duration(seconds: 30),
      );

      await tester.tap(sheet.cardTile);
      await tester.pumpAndSettle();
      await tester.tap(sheet.chargeButton);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 25));
      await tester.pump();
      await tester.tap(find.text('Dejar de esperar'));
      await tester.pumpAndSettle();
      // The commit refuses it, which is the screen this test is about.
      await tester.tap(sheet.chargeButton);
      await tester.pumpAndSettle();
      expect(sheet.checkout.state.phase, CheckoutPhase.paymentUnknown);

      await tester.tap(find.text('Consultar estado del pago'));
      await tester.pumpAndSettle();

      // THE QUESTION WENT TO THE TERMINAL: by the tender's own identity, with the
      // vendor asked again — not to a payment row that carries no provider at all,
      // which is what made this button a no-op.
      expect(repository.attemptIdentities.last, _cardTenderId);
      expect(repository.attemptQueries.last.refresh, isTrue);

      // A cancellation is not a sale. The screen goes back to taking money, and
      // it says out loud that nothing was charged before offering cash.
      expect(sheet.checkout.state.phase, CheckoutPhase.collectingPayment);
      expect(
        find.text(
          'La terminal rechazó el cobro y no se cobró nada. Puedes cobrar en '
          'efectivo, o iniciar una venta nueva para reintentar con tarjeta.',
        ),
        findsOneWidget,
      );
      expect(repository.settlements, isEmpty);

      await sheet.dispose();
    },
  );

  testWidgets('the wait bound is the unresolved case, not a silent failure', (
    tester,
  ) async {
    final repository =
        _PointRepository(
            providers: const [
              {
                'id': _providerId,
                'family': 'card_present',
                'available': true,
                'unavailableReason': null,
              },
            ],
          )
          ..attemptAnswers.addAll([
            {
              'state': 'unknown',
              'providerStatus': 'action_required',
              'queryAfter': null,
              'providerPaymentId': null,
            },
          ]);
    final sheet = await _openSheet(
      tester,
      repository,
      pollStart: const Duration(milliseconds: 20),
      pollCap: const Duration(milliseconds: 20),
      waitBound: const Duration(milliseconds: 60),
    );

    await tester.tap(sheet.cardTile);
    await tester.pumpAndSettle();
    await tester.tap(sheet.chargeButton);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    await tester.pump();

    expect(
      find.text(
        'Hay un cobro con tarjeta que nadie ha confirmado. '
        'La venta no se puede cerrar hasta resolverlo.',
      ),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('tender-card-terminal')), findsOneWidget);
    expect(find.text('Dejar de esperar'), findsNothing);
    expect(repository.settlements, isEmpty);

    await sheet.dispose();
  });

  test(
    'a draft that already has an attempt is skipped by the manual-terminal path',
    () async {
      final cardDraft = {
        'id': tenderId(_cartId, 'card_terminal'),
        'type': 'manual_terminal',
        'amount': const {'minorUnits': 11600, 'currency': 'MXN'},
        'amountReceived': null,
        'status': 'confirmed_success',
        'correlationId': 'card-terminal-test',
      };

      // The card tender already has an attempt (the terminal answered, or is
      // still out there). The commit LINKS it, so the manual
      // capture-plus-attestation path must not touch it: that path would invent
      // an operator's word for money a provider took.
      final pointRepository = _PointRepository()
        ..attemptAnswers.addAll([
          {
            'state': 'succeeded',
            'providerStatus': 'processed',
            'queryAfter': null,
            'providerPaymentId': 'PAYPROBE-9001',
          },
        ]);
      final pointController = _controller(pointRepository);
      await pointController.preview(
        merchantId: _merchantId,
        locationId: _locationId,
        operatorSessionId: _operatorSessionId,
        cartId: _cartId,
        cartVersion: 3,
        paymentMethod: 'external_terminal',
        tenderDrafts: [cardDraft],
      );
      expect(pointRepository.captures, isEmpty);
      expect(pointRepository.settlements, isEmpty);
      // The existence check is a READ: it never asks the terminal.
      expect(pointRepository.attemptQueries.single.refresh, false);
      expect(pointRepository.attemptIdentities.single, cardDraft['id']);

      // The manual terminal is unchanged: no attempt for the identity is a 404,
      // which is a normal answer, and the operator's own path runs.
      final manualRepository = _PointRepository();
      final manualController = _controller(manualRepository);
      await manualController.preview(
        merchantId: _merchantId,
        locationId: _locationId,
        operatorSessionId: _operatorSessionId,
        cartId: _cartId,
        cartVersion: 3,
        paymentMethod: 'external_terminal',
        tenderDrafts: [
          {...cardDraft, 'id': tenderId(_cartId, 'terminal')},
        ],
      );
      expect(manualRepository.captures, hasLength(1));
      expect(manualRepository.captures.single.provider, 'manual_terminal');
      expect(manualRepository.settlements, hasLength(1));
      expect(manualRepository.settlements.single.outcome, 'paid');
    },
  );

  testWidgets(
    'an armed split charges the card terminal for its leg, not the whole bill',
    (tester) async {
      final repository = _PointRepository(
        providers: const [
          {
            'id': _providerId,
            'family': 'card_present',
            'available': true,
            'unavailableReason': null,
          },
        ],
        policyOverride: {
          ..._policy,
          'mixedTenderEnabled': true,
          'maximumTenderLines': 4,
        },
      );
      final sheet = await _openSheet(tester, repository);

      // Cash first, and only cash: the card tile is offered, not taken.
      expect(find.byKey(const ValueKey('tender-cash')), findsOneWidget);
      expect(find.byKey(const ValueKey('tender-split-arm')), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('tender-split-arm')));
      await tester.pumpAndSettle();
      // The decision is named as soon as it is made, so the operator is never
      // looking at a half-built tender with nothing said about it.
      expect(
        find.textContaining('Elige el segundo método de pago.'),
        findsOneWidget,
      );

      await tester.tap(sheet.cardTile);
      await tester.pumpAndSettle();
      // Both legs are on the sale, in the order the money is taken.
      expect(find.byKey(const ValueKey('tender-cash')), findsOneWidget);
      expect(find.textContaining('1. Efectivo:'), findsOneWidget);
      expect(find.textContaining('2. Terminal de tarjeta:'), findsOneWidget);

      await tester.tap(sheet.chargeButton);
      await tester.pump();
      // The capture carries the CARD leg's amount. Charging the whole bill here
      // is the double-charge a divided check must never produce.
      expect(repository.captures, hasLength(1));
      expect(repository.captures.single.amount['minorUnits'], 5800);

      await sheet.dispose();
    },
  );

  testWidgets(
    'a cash tap cannot drop a card the terminal may already have charged',
    (tester) async {
      final repository = _PointRepository(
        providers: const [
          {
            'id': _providerId,
            'family': 'card_present',
            'available': true,
            'unavailableReason': null,
          },
        ],
      );
      final sheet = await _openSheet(
        tester,
        repository,
        pollStart: const Duration(milliseconds: 20),
        pollCap: const Duration(milliseconds: 20),
        waitBound: const Duration(seconds: 5),
      );

      // A card capture the terminal has not answered yet: the attempt owns the
      // sale until it resolves.
      await tester.tap(sheet.cardTile);
      await tester.pumpAndSettle();
      await tester.tap(sheet.chargeButton);
      await tester.pump();
      expect(repository.captures, hasLength(1));

      // Outside a split a cash tap REPLACES the card. It must not do that over
      // an unresolved attempt: this would present a card payment nobody
      // confirmed as a cash sale.
      await tester.tap(find.text('Efectivo').first);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('tender-cash')), findsNothing);

      await sheet.dispose();
    },
  );
}

/// The wire shape of the two tender reads, pinned against a real ApiClient.
///
/// This is the defect the NATIVE run found and no fake could: the till's unit
/// cases stub the repository, so a repository that unwrapped a `data` envelope
/// the server never sends looked exactly like one that worked. The server
/// answers `pos.tenderProviders` with the model (`{providers: [...]}`) and
/// `pos.tenderAttempt` with the attempt — NOT inside the checkout service's
/// `{ok, data}` envelope — so reading `['data']` produced null, the read threw,
/// and the screen stayed on cash with no card tile and nothing to say why.
final class _TenderReadsApi implements ApiClient {
  _TenderReadsApi(this.body);
  final Map<String, Object?> body;
  String? path;

  @override
  void dispose() {}

  @override
  Future<Map<String, Object?>> request({
    required ApiMethod method,
    required String path,
    Map<String, Object?>? body,
    CancellationToken? cancellation,
    bool idempotent = false,
    bool authRefresh = true,
    Map<String, String>? extraHeaders,
  }) async {
    this.path = path;
    return this.body;
  }
}

void _tenderWireShapeTests() {
  test(
    'the provider list is read from the response the server actually sends',
    () async {
      final api = _TenderReadsApi({
        'providers': [
          {
            'id': 'cash',
            'family': 'cash',
            'available': true,
            'unavailableReason': null,
          },
          {
            'id': 'mercado_pago_point',
            'family': 'card_present',
            'available': true,
            'unavailableReason': null,
          },
        ],
      });
      final repository = ApiCheckoutRepository(api);

      final list = await repository.tenderProviders(
        _merchantId,
        const TenderProviderQuery(
          locationId: _locationId,
          operatorSessionId: _operatorSessionId,
        ),
      );

      expect(list.providers, hasLength(2));
      expect(list.providers.last['id'], _providerId);
      expect(api.path, contains('/tender-providers'));
    },
  );

  test(
    'the attempt is read from the response the server actually sends',
    () async {
      final api = _TenderReadsApi({
        'attempt': {'id': _cartId, 'state': 'succeeded'},
        'outcome': {
          'kind': 'succeeded',
          'providerStatus': 'processed',
          'code': null,
          'message': null,
        },
        'ambiguity': null,
        'providerAsked': true,
        'resolvedNow': true,
      });
      final repository = ApiCheckoutRepository(api);

      final result = await repository.tenderAttempt(
        _merchantId,
        _cartId,
        const TenderAttemptQuery(
          locationId: _locationId,
          operatorSessionId: _operatorSessionId,
          refresh: true,
        ),
      );

      expect(result.providerAsked, isTrue);
      expect(result.attempt['state'], 'succeeded');
      expect(api.path, contains('/tenders/$_cartId'));
    },
  );
}
