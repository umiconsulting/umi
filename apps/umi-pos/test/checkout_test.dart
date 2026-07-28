import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
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

final class _CheckoutRepository implements CheckoutRepository {
  _CheckoutRepository({this.unknown = false});
  final bool unknown;
  final commands = <CheckoutCommand>[];

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
      'status': 'unknown',
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

  testWidgets(
    'checkout sheet renders authoritative totals and payment methods',
    (tester) async {
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
      expect(find.text('Cash'), findsOneWidget);
      expect(find.text('External terminal'), findsOneWidget);
      expect(find.text('MXN 116.00'), findsWidgets);
      await tester.pumpWidget(const SizedBox());
      root.dispose();
      cart.dispose();
      checkout.dispose();
    },
  );
}
