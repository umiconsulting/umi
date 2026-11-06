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
import 'package:umi_pos/features/checkout/payment_method_tile.dart';

import 'receipt_document_test.dart' show fonts;

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
  bool enableManualTerminal = false;
  bool enableMixedTender = false;
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
  bool accountMissing = false;

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
    if (accountMissing) {
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
    'manualTerminalEnabled': enableManualTerminal,
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
    'mixedTenderEnabled': enableMixedTender,
    'maximumTenderLines': enableMixedTender ? 8 : 1,
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
  bool canConfirmManualTerminal = false,
  String? merchantLabel,
  Size viewport = const Size(1280, 1800),
  bool shell = false,
  bool viaRoute = false,
  Future<bool?> Function(int amountMinor, bool selected)?
  onShowBankTransferDetails,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = viewport;
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
  final surface = PartialCheckoutSurface(
    checkout: checkout,
    cart: cart,
    operatorSessionId: _operator,
    merchantLabel: merchantLabel,
    navigation: shell
        ? PosNavigation(
            destinations: const [
              PosDestination(
                icon: PosIcon(PosGlyphs.receiptLong),
                label: 'Sale',
              ),
              PosDestination(
                icon: PosIcon(PosGlyphs.paymentsOutlined),
                label: 'Cash',
              ),
            ],
          )
        : null,
    canConfirmManualTerminal: canConfirmManualTerminal,
    cashShiftId: _shift,
    onShowBankTransferDetails:
        onShowBankTransferDetails ?? (_, _) async => false,
  );
  await tester.pumpWidget(
    PosApp(
      locale: const Locale('en'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      home: viaRoute
          ? Builder(
              builder: (context) => PosButton(
                onPressed: () => Navigator.of(
                  context,
                ).push(PosPageRoute<void>(builder: (_) => surface)),
                child: const Text('Open partial'),
              ),
            )
          : surface,
    ),
  );
  await tester.pumpAndSettle();
  if (viaRoute) {
    await tester.tap(find.text('Open partial'));
    await tester.pumpAndSettle();
  }
  return (cart, checkout);
}

void main() {
  testWidgets(
    'phone partial route puts methods before the form and keeps cash visible',
    (tester) async {
      await fonts();
      final repository = _Repo()
        ..enableManualTerminal = true
        ..enableBankTransfer = true;
      final (cart, checkout) = await _pump(
        tester,
        repository,
        viewport: const Size(402, 874),
        shell: true,
        viaRoute: true,
        canConfirmManualTerminal: true,
        merchantLabel: 'Café · Local',
      );
      final principal = find.byKey(const ValueKey('partial-principal'));
      final cash = find.byKey(const ValueKey('partial-cash-received'));
      final methods = find.byType(PaymentMethodTile);
      for (final method in methods.evaluate()) {
        final rect = tester.getRect(find.byWidget(method.widget));
        expect(rect.bottom, lessThan(tester.getRect(principal).top));
        expect(rect.height, greaterThanOrEqualTo(48));
        expect(find.byWidget(method.widget).hitTestable(), findsOneWidget);
      }
      expect(
        tester
            .getSize(find.widgetWithText(PosTextButton, 'Back to account'))
            .height,
        44,
      );
      expect(
        tester.getSize(find.widgetWithText(PosTextButton, 'Refresh')).height,
        44,
      );
      expect(
        tester
            .getSize(find.byKey(const ValueKey('partial-account-disclosure')))
            .height,
        44,
      );
      expect(cash.hitTestable(), findsOneWidget);
      expect(
        tester.getRect(cash).bottom,
        lessThanOrEqualTo(
          tester
              .getRect(find.byKey(const ValueKey('partial-payment-editor')))
              .bottom,
        ),
      );
      expect(find.text('Amount due'), findsOneWidget);
      expect(
        tester
            .getSize(find.byKey(const ValueKey('partial-cash-change')))
            .height,
        36,
      );
      expect(
        find.byKey(const ValueKey('partial-exact-charge')).hitTestable(),
        findsOneWidget,
      );
      final charge = find.byKey(const ValueKey('partial-charge'));
      expect(charge.hitTestable(), findsOneWidget);
      expect(tester.getSize(charge).height, 48);
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await tester.pumpAndSettle();
      await tester.ensureVisible(cash);
      await tester.pumpAndSettle();
      expect(cash.hitTestable(), findsOneWidget);
      expect(charge.hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      checkout.dispose();
      cart.dispose();
    },
  );

  for (final width in [800.0, 820.0]) {
    testWidgets(
      'portrait partial checkout retains vertical methods and account at $width',
      (tester) async {
        final repository = _Repo()..enableManualTerminal = true;
        final (cart, checkout) = await _pump(
          tester,
          repository,
          viewport: Size(width, 1280),
          shell: true,
          canConfirmManualTerminal: true,
          merchantLabel: 'Cafe · Local',
        );
        final first = tester.getRect(find.byType(PaymentMethodTile).first);
        final second = tester.getRect(find.byType(PaymentMethodTile).at(1));
        final principal = tester.getRect(
          find.byKey(const ValueKey('partial-principal')),
        );
        final account = tester.getRect(
          find.byKey(const ValueKey('partial-account-summary')),
        );
        expect(first.right, lessThanOrEqualTo(principal.left));
        expect(second.top, greaterThanOrEqualTo(first.bottom));
        expect(account.left, greaterThanOrEqualTo(principal.right));
        expect(tester.takeException(), isNull);
        tester.platformDispatcher.textScaleFactorTestValue = 2;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('partial-account-summary')),
          findsNothing,
        );
        expect(
          find.byKey(const ValueKey('partial-account-disclosure')),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        checkout.dispose();
        cart.dispose();
      },
    );
  }

  testWidgets('phone partial checkout retains UMI beside the real merchant', (
    tester,
  ) async {
    final (cart, checkout) = await _pump(
      tester,
      _Repo(),
      merchantLabel: 'Café Norte · Centro',
    );
    tester.view.physicalSize = const Size(402, 874);
    await tester.pumpAndSettle();
    final header = find.byType(PosHeader);
    expect(
      find.descendant(of: header, matching: find.text('umi')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: header, matching: find.text('Café Norte · Centro')),
      findsOneWidget,
    );
    expect(find.byType(PosNavigation), findsNothing);
    expect(
      find.byKey(const ValueKey('partial-charge')).hitTestable(),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    cart.dispose();
    checkout.dispose();
  });

  testWidgets(
    'payment shell finds permitted navigation past an inner header page',
    (tester) async {
      PosNavigation? found;
      await tester.pumpWidget(
        PosApp(
          home: PosPage(
            bottomNavigationBar: PosNavigation(
              destinations: const [
                PosDestination(
                  icon: PosIcon(PosGlyphs.receiptOutlined),
                  label: 'Sale',
                ),
              ],
            ),
            body: PosPage(
              body: Builder(
                builder: (context) {
                  found = checkoutNavigationOf(context);
                  return const SizedBox();
                },
              ),
            ),
          ),
        ),
      );
      expect(found, isNotNull);
      expect((found!.destinations.single as PosDestination).label, 'Sale');
    },
  );

  testWidgets(
    'cash keypad changes only received amount and preserves exact principal',
    (tester) async {
      final repository = _Repo();
      final (cart, checkout) = await _pump(tester, repository);
      await tester.tap(find.byKey(const ValueKey('partial-cash-clear')));
      await tester.pump();
      for (final digit in ['2', '0', '0']) {
        await tester.tap(find.byKey(ValueKey('partial-cash-key-$digit')));
        await tester.pump();
      }
      final field = tester.widget<PosField>(
        find.byKey(const ValueKey('partial-cash-received')),
      );
      expect(field.controller!.text, '200');
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('partial-cash-change')),
          matching: find.text('MXN 84.00'),
        ),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('partial-charge')));
      await tester.pumpAndSettle();
      final tender = repository.commands.single['tender'] as Map;
      expect((tender['amount'] as Map)['minorUnits'], 11600);
      expect((tender['amountReceived'] as Map)['minorUnits'], 20000);
      await tester.pumpWidget(const SizedBox());
      cart.dispose();
      checkout.dispose();
    },
  );

  for (final size in const [
    Size(402, 874),
    Size(412, 915),
    Size(820, 1180),
    Size(800, 1340),
    Size(1340, 800),
    Size(1440, 1000),
  ]) {
    testWidgets('partial checkout keeps cash and charge reachable at $size', (
      tester,
    ) async {
      final (cart, checkout) = await _pump(tester, _Repo());
      tester.view.physicalSize = size;
      await tester.pumpAndSettle();
      final received = find.byKey(const ValueKey('partial-cash-received'));
      final change = find.byKey(const ValueKey('partial-cash-change'));
      final charge = find.byKey(const ValueKey('partial-charge'));
      expect(charge.hitTestable(), findsOneWidget);
      await tester.ensureVisible(received);
      await tester.pumpAndSettle();
      expect(received.hitTestable(), findsOneWidget);
      expect(tester.getRect(change).bottom, lessThan(size.height));
      expect(charge.hitTestable(), findsOneWidget);
      expect(
        tester.getRect(received).bottom,
        lessThan(tester.getRect(change).top),
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      cart.dispose();
      checkout.dispose();
    });
  }

  testWidgets(
    'a split terminal leg confirms without asking the operator to type a receipt folio',
    (tester) async {
      final repository = _Repo()
        ..enableManualTerminal = true
        ..enableMixedTender = true
        ..drafts.add({
          'id': '00000000-0000-4000-8000-000000000080',
          'type': 'cash',
          'amount': {'minorUnits': 4000, 'currency': 'MXN'},
          'amountReceived': {'minorUnits': 4000, 'currency': 'MXN'},
          'status': 'confirmed_success',
          'correlationId': null,
        });
      final (cart, checkout) = await _pump(
        tester,
        repository,
        canConfirmManualTerminal: true,
      );

      await tester.enterText(
        find.byKey(const ValueKey('partial-principal')),
        '76.00',
      );
      await tester.tap(
        find.byKey(const ValueKey('partial-method-manual_terminal')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('partial-charge')));
      await tester.pumpAndSettle();

      expect(find.text('Receipt reference'), findsNothing);
      await tester.tap(find.text('Yes, paid'));
      await tester.pumpAndSettle();

      expect(repository.commands, hasLength(1));
      expect(
        repository.commands.single['confirmationReference'],
        'operator_confirmed_terminal_screen',
      );

      await tester.pumpWidget(const SizedBox());
      cart.dispose();
      checkout.dispose();
    },
  );

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
    await tester.tap(find.byKey(const ValueKey('partial-tip-disclosure')));
    await tester.pumpAndSettle();
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
      expect(find.text('Cuenta 104'), findsNWidgets(2));
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
      expect(repository.commands, hasLength(1));
      expect((repository.commands.single['tender'] as Map)['amount'], {
        'minorUnits': 4000,
        'currency': 'MXN',
      });
      expect(find.text('MXN 76.00'), findsWidgets);
      expect(find.byKey(const ValueKey('partial-payment-0')), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('partial-tip-disclosure')));
      await tester.pumpAndSettle();
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

  testWidgets('a closed account shows a refusal and no charge action', (
    tester,
  ) async {
    final repository = _Repo()..accountMissing = true;
    final (cart, checkout) = await _pump(tester, repository);

    expect(
      find.text(
        'This account was already closed or saved from another screen. Return to Accounts to open it again.',
      ),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('partial-charge')), findsNothing);
    expect(repository.commands, isEmpty);

    await tester.pumpWidget(const SizedBox());
    cart.dispose();
    checkout.dispose();
  });

  testWidgets(
    'lost response requires ledger read and never creates a new leg',
    (tester) async {
      final repository = _Repo()..loseResponseOnce = true;
      final (cart, checkout) = await _pump(tester, repository);
      await tester.tap(find.byKey(const ValueKey('partial-equal-2')));
      await tester.tap(find.byKey(const ValueKey('partial-charge')));
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
