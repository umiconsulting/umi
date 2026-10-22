import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/cash/money_input.dart';
import 'package:umi_pos/features/checkout/checkout_controller.dart';
import 'package:umi_pos/features/checkout/checkout_repository.dart';
import 'package:umi_pos/features/checkout/checkout_surface.dart';
import 'package:umi_pos/features/checkout/partial_checkout_surface.dart';

const _merchant = '00000000-0000-4000-8000-000000000001';
const _location = '00000000-0000-4000-8000-000000000002';
const _operator = '00000000-0000-4000-8000-000000000003';
const _cartId = '00000000-0000-4000-8000-000000000004';
const _shift = '00000000-0000-4000-8000-000000000005';
const _totals = <String, Object?>{
  'subtotal': {'minorUnits': 11600, 'currency': 'MXN'},
  'tax': {'minorUnits': 0, 'currency': 'MXN'},
  'discounts': {
    'total': {'minorUnits': 0, 'currency': 'MXN'},
    'entries': <Object?>[],
  },
  'grandTotal': {'minorUnits': 11600, 'currency': 'MXN'},
  'businessDate': '2026-10-14',
};

final class _CartRepo implements CartRepository {
  final cart = const Cart(
    id: _cartId,
    merchantId: _merchant,
    locationId: _location,
    operatorSessionId: _operator,
    accountFolio: 'Cuenta 104',
    status: 'prepared',
    version: 3,
    firedOrderId: null,
    fulfillmentType: 'dine_in',
    items: [],
    totals: _totals,
    checkoutEnabled: true,
    checkoutMessageCode: 'OK',
    updatedAt: '2026-10-14T19:00:00.000Z',
  );

  @override
  Future<Cart> create(String merchantId, CreateCartRequest request) async =>
      cart;
  @override
  Future<Cart> read(String merchantId, CartQuery query) async => cart;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final class _Repo implements CheckoutRepository, PartialPaymentRepository {
  bool enableBankTransfer = false;
  final drafts = <Map<String, Object?>>[];
  final commands = <Map<String, Object?>>[];
  final finalCommands = <CheckoutCommand>[];
  Map<String, Object?>? unresolved;
  bool loseResponseOnce = false;
  bool responseLost = false;
  bool loseBeforeWriteOnce = false;
  bool writeSkipped = false;
  bool loseFinalResponseOnce = false;
  bool finalResponseLost = false;

  Map<String, Object?> get snapshot {
    final applied = drafts.fold<int>(0, (sum, draft) {
      final total = ((draft['amount'] as Map)['minorUnits'] as num).toInt();
      final tip =
          ((draft['tipAmount'] as Map?)?['minorUnits'] as num?)?.toInt() ?? 0;
      return sum + total - tip;
    });
    return {
      'cartId': _cartId,
      'cartVersion': 3,
      'amountDue': {'minorUnits': 11600, 'currency': 'MXN'},
      'appliedAmount': {'minorUnits': applied, 'currency': 'MXN'},
      'remainingBalance': {'minorUnits': 11600 - applied, 'currency': 'MXN'},
      'tipAmount': {
        'minorUnits': drafts.fold<int>(
          0,
          (sum, draft) =>
              sum +
              (((draft['tipAmount'] as Map?)?['minorUnits'] as num?)?.toInt() ??
                  0),
        ),
        'currency': 'MXN',
      },
      'tenderDrafts': List<Map<String, Object?>>.from(drafts),
      'confirmationReferences': <String, String>{},
      'blockedByUnknown': unresolved != null,
      'unresolvedTender': unresolved,
      'canFinalize': applied == 11600,
    };
  }

  @override
  Future<CheckoutPartialPaymentResult> partialPayments(
    String merchantId,
    String cartId,
    CheckoutPartialPaymentQuery query,
  ) async {
    if (drafts.isEmpty && unresolved == null) {
      throw const AppException(
        category: AppErrorCategory.unknown,
        code: 'RESOURCE_NOT_FOUND',
        recoverable: false,
      );
    }
    return CheckoutPartialPaymentResult(ok: true, data: snapshot);
  }

  @override
  Future<CheckoutPartialPaymentResult> collectPartialPayment(
    String merchantId,
    String cartId,
    CheckoutPartialPaymentRequest request,
  ) async {
    final command = request.toJson();
    commands.add(command);
    if (loseBeforeWriteOnce && !writeSkipped) {
      writeSkipped = true;
      throw const AppException(
        category: AppErrorCategory.transport,
        code: 'TRANSPORT_FAILURE',
        recoverable: true,
      );
    }
    final tender = Map<String, Object?>.from(command['tender']! as Map);
    if (tender['status'] == 'operator_reported_failure') {
      unresolved = null;
    } else {
      if (!drafts.any((item) => item['id'] == tender['id'])) drafts.add(tender);
      unresolved = null;
    }
    if (loseResponseOnce && !responseLost) {
      responseLost = true;
      throw const AppException(
        category: AppErrorCategory.transport,
        code: 'TRANSPORT_FAILURE',
        recoverable: true,
      );
    }
    return CheckoutPartialPaymentResult(ok: true, data: snapshot);
  }

  @override
  Future<CheckoutPolicy> policy(
    String merchantId,
    PosCheckoutPolicyQuery query,
  ) async => CheckoutPolicy.fromJson({
    'version': 'test',
    'manualTerminalEnabled': false,
    'bankTransferEnabled': enableBankTransfer,
    'bankTransferDetails': enableBankTransfer
        ? <String, Object?>{
            'holderName': 'ONCA DEMO',
            'bankName': 'Banco de prueba',
            'clabe': '012345678901234567',
            'accountNumber': null,
          }
        : null,
    'merchantLogoUrl': null,
    'mixedTenderEnabled': false,
    'maximumTenderLines': 1,
    'manualTerminalApprovalThreshold': {'minorUnits': 50000, 'currency': 'MXN'},
    'manualTerminalApprovalPermission': 'checkout.terminal.approve',
    'tip': {
      'enabled': true,
      'presetBasisPoints': <int>[],
      'customPercentageEnabled': false,
      'customFixedEnabled': true,
      'maximumTip': {'minorUnits': 5000, 'currency': 'MXN'},
      'requiredPermission': null,
      'version': 'test',
    },
    'discount': {
      'enabled': false,
      'maximumBasisPoints': 0,
      'maximumAmount': {'minorUnits': 0, 'currency': 'MXN'},
      'cashierThreshold': {'minorUnits': 0, 'currency': 'MXN'},
      'customRequiresApproval': false,
      'requiredPermission': 'checkout.discount.apply',
      'approvalPermission': 'checkout.discount.approve',
      'version': 'test',
    },
  });

  @override
  Future<CheckoutResult> checkout(
    String merchantId,
    CheckoutCommand command,
  ) async {
    finalCommands.add(command);
    if (loseFinalResponseOnce &&
        command.totalsFingerprint != null &&
        !finalResponseLost) {
      finalResponseLost = true;
      throw const AppException(
        category: AppErrorCategory.transport,
        code: 'TRANSPORT_FAILURE',
        recoverable: true,
      );
    }
    final confirmation = {
      'fingerprint':
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'totals': _totals,
    };
    return CheckoutResult(
      status: command.totalsFingerprint == null
          ? 'confirmation_required'
          : 'completed',
      confirmation: confirmation,
      payment: null,
      reservation: null,
      sale: null,
      receipt: null,
      failure: null,
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<(CartController, CheckoutController)> _pump(
  WidgetTester tester,
  _Repo repository, {
  Future<bool?> Function(int amountMinor, bool selected)?
  onShowBankTransferDetails,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(1280, 1800);
  addTearDown(tester.view.reset);
  const telemetry = SafeTelemetry(
    enabled: false,
    context: TelemetryContext(
      appVersion: 'test',
      environment: 'test',
      platform: 'test',
    ),
    exporter: NoopTelemetryExporter(),
  );
  final cart = CartController(repository: _CartRepo(), telemetry: telemetry);
  await cart.open(_merchant, _location, _operator);
  final checkout = CheckoutController(
    repository: repository,
    telemetry: telemetry,
  );
  await checkout.loadPolicy(
    merchantId: _merchant,
    locationId: _location,
    operatorSessionId: _operator,
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
      home: PartialCheckoutSurface(
        checkout: checkout,
        cart: cart,
        operatorSessionId: _operator,
        canConfirmManualTerminal: false,
        cashShiftId: _shift,
        onShowBankTransferDetails:
            onShowBankTransferDetails ?? (_, _) async => false,
      ),
    ),
  );
  await tester.pumpAndSettle();
  return (cart, checkout);
}

void main() {
  testWidgets('transfer opens the existing bank card for this exact payment', (
    tester,
  ) async {
    final repository = _Repo()..enableBankTransfer = true;
    late BuildContext partialContext;
    late CartController cart;
    late CheckoutController checkout;
    final shownAmounts = <int>[];
    final controllers = await _pump(
      tester,
      repository,
      onShowBankTransferDetails: (amountMinor, selected) {
        shownAmounts.add(amountMinor);
        return showPosDialog<bool>(
          context: partialContext,
          builder: (_) => BankTransferDialog(
            details: checkout.policy!.bankTransferDetails!,
            merchantName: 'ONCA',
            logoUrl: null,
            amount: formatMinorUnits(amountMinor, 'MXN'),
            accountFolio: cart.state.cart!.accountFolio,
            selected: selected,
          ),
        );
      },
    );
    cart = controllers.$1;
    checkout = controllers.$2;
    partialContext = tester.element(find.byType(PartialCheckoutSurface));
    await tester.enterText(
      find.byKey(const ValueKey('partial-principal')),
      '40.00',
    );
    await tester.enterText(find.byKey(const ValueKey('partial-tip')), '5.00');
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const ValueKey('partial-method-bank_transfer')),
    );
    await tester.pumpAndSettle();
    expect(find.text('ONCA DEMO'), findsOneWidget);
    expect(find.text('ONCA Cuenta 104'), findsOneWidget);
    expect(find.byKey(const ValueKey('bank-transfer-clabe')), findsOneWidget);
    expect(find.text('MXN 45.00'), findsWidgets);
    expect(shownAmounts, [4500]);
    expect(repository.commands, isEmpty);

    await tester.tap(find.byKey(const ValueKey('bank-transfer-close')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('partial-bank-view-details')),
      findsNothing,
    );
    await tester.tap(
      find.byKey(const ValueKey('partial-method-bank_transfer')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('bank-transfer-select')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('partial-bank-view-details')),
      findsOneWidget,
    );
    await tester.enterText(
      find.byKey(const ValueKey('partial-principal')),
      '30.00',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('partial-bank-view-details')));
    await tester.pumpAndSettle();
    expect(find.text('MXN 35.00'), findsWidgets);
    expect(find.byKey(const ValueKey('bank-transfer-select')), findsNothing);
    expect(repository.commands, isEmpty);

    await tester.pumpWidget(const SizedBox());
    cart.dispose();
    checkout.dispose();
  });

  testWidgets(
    'a lost first request retries the same payment identity after 404',
    (tester) async {
      final repository = _Repo()..loseBeforeWriteOnce = true;
      final (cart, checkout) = await _pump(tester, repository);
      await tester.enterText(
        find.byKey(const ValueKey('partial-principal')),
        '40.00',
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('partial-charge')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Refresh'));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('partial-retry-same-payment')),
        findsOneWidget,
      );
      await tester.tap(
        find.byKey(const ValueKey('partial-retry-same-payment')),
      );
      await tester.pumpAndSettle();
      expect(repository.commands, hasLength(2));
      expect(
        repository.commands.first['idempotencyKey'],
        repository.commands.last['idempotencyKey'],
      );
      expect(
        (repository.commands.first['tender'] as Map)['id'],
        (repository.commands.last['tender'] as Map)['id'],
      );
      expect(repository.snapshot['appliedAmount'], {
        'minorUnits': 4000,
        'currency': 'MXN',
      });

      await tester.pumpWidget(const SizedBox());
      cart.dispose();
      checkout.dispose();
    },
  );

  testWidgets('lost final response blocks another close until recovery', (
    tester,
  ) async {
    final repository = _Repo()..loseFinalResponseOnce = true;
    repository.drafts.add({
      'id': '00000000-0000-4000-8000-000000000083',
      'type': 'cash',
      'amount': {'minorUnits': 11600, 'currency': 'MXN'},
      'amountReceived': {'minorUnits': 11600, 'currency': 'MXN'},
      'status': 'draft',
      'correlationId': null,
    });
    final (cart, checkout) = await _pump(tester, repository);
    await tester.tap(find.byKey(const ValueKey('partial-finalize')));
    await tester.pumpAndSettle();
    expect(repository.finalCommands, hasLength(2));
    expect(
      tester
          .widget<PosButton>(find.byKey(const ValueKey('partial-finalize')))
          .onPressed,
      isNull,
    );
    expect(find.textContaining('not confirmed'), findsWidgets);

    await tester.pumpWidget(const SizedBox());
    cart.dispose();
    checkout.dispose();
  });

  testWidgets('closing a collected manual tender does not capture it again', (
    tester,
  ) async {
    final repository = _Repo();
    repository.drafts.addAll([
      {
        'id': '00000000-0000-4000-8000-000000000081',
        'type': 'manual_terminal',
        'amount': {'minorUnits': 4000, 'currency': 'MXN'},
        'amountReceived': null,
        'status': 'confirmed_success',
        'correlationId': null,
      },
      {
        'id': '00000000-0000-4000-8000-000000000082',
        'type': 'cash',
        'amount': {'minorUnits': 7600, 'currency': 'MXN'},
        'amountReceived': {'minorUnits': 7600, 'currency': 'MXN'},
        'status': 'draft',
        'correlationId': null,
      },
    ]);
    final (cart, checkout) = await _pump(tester, repository);
    await tester.tap(find.byKey(const ValueKey('partial-finalize')));
    await tester.pumpAndSettle();
    expect(repository.finalCommands, hasLength(2));
    expect(checkout.state.phase, CheckoutPhase.completed);

    await tester.pumpWidget(const SizedBox());
    cart.dispose();
    checkout.dispose();
  });

  testWidgets(
    'an uncertain external charge blocks new payments until resolved',
    (tester) async {
      final repository = _Repo()
        ..unresolved = {
          'id': '00000000-0000-4000-8000-000000000088',
          'type': 'manual_terminal',
          'amount': {'minorUnits': 3000, 'currency': 'MXN'},
          'amountReceived': null,
          'status': 'outcome_unknown',
          'correlationId': null,
        };
      final (cart, checkout) = await _pump(tester, repository);
      expect(
        find.byKey(const ValueKey('partial-unknown-failed')),
        findsOneWidget,
      );
      expect(
        tester
            .widget<PosButton>(find.byKey(const ValueKey('partial-charge')))
            .onPressed,
        isNull,
      );
      await tester.tap(find.byKey(const ValueKey('partial-unknown-failed')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(PosField).last, 'terminal_declined');
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<PosButton>(
              find.byKey(const ValueKey('partial-unknown-confirm')),
            )
            .onPressed,
        isNotNull,
      );
      await tester.tap(find.byKey(const ValueKey('partial-unknown-confirm')));
      await tester.pumpAndSettle();
      expect(repository.commands, hasLength(1));
      expect(
        (repository.commands.single['tender'] as Map)['id'],
        '00000000-0000-4000-8000-000000000088',
      );
      expect(
        (repository.commands.single['tender'] as Map)['status'],
        'operator_reported_failure',
      );
      expect(repository.snapshot['remainingBalance'], {
        'minorUnits': 11600,
        'currency': 'MXN',
      });
      expect(
        find.byKey(const ValueKey('partial-unknown-failed')),
        findsNothing,
      );

      await tester.pumpWidget(const SizedBox());
      cart.dispose();
      checkout.dispose();
    },
  );

  testWidgets('GET restores saved account balance and history', (tester) async {
    final repository = _Repo();
    repository.drafts.add({
      'id': '00000000-0000-4000-8000-000000000099',
      'type': 'cash',
      'amount': {'minorUnits': 4000, 'currency': 'MXN'},
      'amountReceived': {'minorUnits': 4000, 'currency': 'MXN'},
      'status': 'draft',
      'correlationId': null,
    });
    final (cart, checkout) = await _pump(tester, repository);
    expect(find.byKey(const ValueKey('partial-payment-0')), findsOneWidget);
    expect(find.text('MXN 76.00'), findsWidgets);
    expect(find.text('Charge MXN 76.00'), findsOneWidget);
    expect(repository.commands, isEmpty);

    await tester.pumpWidget(const SizedBox());
    cart.dispose();
    checkout.dispose();
  });

  testWidgets(
    'records unequal cash legs and a tip, then closes once balance is zero',
    (tester) async {
      final repository = _Repo();
      final (cart, checkout) = await _pump(tester, repository);
      expect(find.text('Cuenta 104'), findsOneWidget);
      expect(find.text('Remaining'), findsOneWidget);
      expect(find.text('MXN 116.00'), findsWidgets);
      expect(
        find.byKey(const ValueKey('partial-method-manual_terminal')),
        findsNothing,
      );

      await tester.enterText(
        find.byKey(const ValueKey('partial-principal')),
        '40.00',
      );
      await tester.pump();
      expect(find.text('Charge MXN 40.00'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('partial-charge')));
      await tester.pumpAndSettle();
      expect(
        find.text('After the first payment', findRichText: true),
        findsNothing,
      );
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(repository.commands, hasLength(1));
      expect((repository.commands.single['tender'] as Map)['amount'], {
        'minorUnits': 4000,
        'currency': 'MXN',
      });
      expect(find.text('MXN 76.00'), findsWidgets);
      expect(find.byKey(const ValueKey('partial-payment-0')), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('partial-tip')),
        '10.00',
      );
      await tester.pumpAndSettle();
      expect(find.text('Charge MXN 86.00'), findsOneWidget);
      expect(find.byKey(const ValueKey('partial-tip-owner')), findsOneWidget);
      await tester.enterText(
        find.byKey(const ValueKey('partial-cash-received')),
        '100.00',
      );
      await tester.pumpAndSettle();
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('partial-cash-change')),
          matching: find.text('MXN 14.00'),
        ),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('partial-charge')));
      await tester.pumpAndSettle();
      expect(repository.commands, hasLength(2));
      expect((repository.commands.last['tender'] as Map)['tipAmount'], {
        'minorUnits': 1000,
        'currency': 'MXN',
      });
      expect(find.byKey(const ValueKey('partial-finalize')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('partial-finalize')));
      await tester.pumpAndSettle();
      expect(repository.finalCommands, hasLength(2));
      expect(repository.finalCommands.last.tenderDrafts, hasLength(2));

      await tester.pumpWidget(const SizedBox());
      cart.dispose();
      checkout.dispose();
    },
  );

  testWidgets(
    'lost response requires ledger read and never creates a new leg',
    (tester) async {
      final repository = _Repo()..loseResponseOnce = true;
      final (cart, checkout) = await _pump(tester, repository);
      await tester.tap(find.byKey(const ValueKey('partial-equal-2')));
      await tester.tap(find.byKey(const ValueKey('partial-charge')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(find.textContaining('may have been recorded'), findsOneWidget);
      expect(
        tester
            .widget<PosButton>(find.byKey(const ValueKey('partial-charge')))
            .onPressed,
        isNull,
      );
      await tester.tap(find.text('Refresh'));
      await tester.pumpAndSettle();
      expect(repository.commands, hasLength(1));
      expect(find.byKey(const ValueKey('partial-payment-0')), findsOneWidget);
      expect(find.text('Charge MXN 58.00'), findsOneWidget);

      await tester.pumpWidget(const SizedBox());
      cart.dispose();
      checkout.dispose();
    },
  );
}
