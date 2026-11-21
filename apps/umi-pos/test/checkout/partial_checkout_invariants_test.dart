import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/checkout/checkout_controller.dart';
import 'package:umi_pos/features/checkout/checkout_repository.dart';
import 'package:umi_pos/features/checkout/partial_checkout_surface.dart';
import 'package:umi_pos/features/tables/table_state_controller.dart';
import 'package:umi_pos/features/tables/table_state_repository.dart';

const _merchant = '00000000-0000-4000-8000-000000000001';
const _location = '00000000-0000-4000-8000-000000000002';
const _operator = '00000000-0000-4000-8000-000000000003';
const _cartId = '00000000-0000-4000-8000-000000000004';
const _shift = '00000000-0000-4000-8000-000000000005';
const _tableId = '00000000-0000-4000-8000-000000000010';
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

void main() {
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

  testWidgets(
    'lost response requires ledger read and never creates a duplicate leg',
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

    expect(repository.commands, isEmpty);
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

  testWidgets('a closed account refuses any new charge', (tester) async {
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

  test(
    'paid party stays seated (paidAt != null) until explicit departure',
    () async {
      final now = DateTime.utc(2026, 9, 16, 18, 0, 0);
      final repo = _TableRepo(
        serverTime: now.toIso8601String(),
        initial: TableStateEntry(
          tableId: _tableId,
          state: tableStateServed,
          seatedAt: '2026-09-16T17:58:00.000Z',
          partySize: 2,
          groupId: null,
          paidAt: '2026-09-16T17:59:00.000Z',
        ),
      );
      final controller = TableStateController(repo, clock: () => now);
      addTearDown(controller.dispose);

      await controller.load(_merchant, _location, _operator);
      expect(controller.stateOf(_tableId).paidAt, isNotNull);
      expect(controller.partyPresent(_tableId), isTrue);
      expect(controller.isPaidAndOccupied(_tableId), isTrue);
      expect(controller.elapsedOf(_tableId), const Duration(minutes: 2));
      expect(controller.stateOf(_tableId).state, tableStateServed);

      // Only explicit departure (`clearTable`) transitions the paid table to dirty.
      final cleared = await controller.clearTable(_tableId);
      expect(cleared, isTrue);
      expect(controller.stateOf(_tableId).state, tableStateDirty);
      expect(controller.partyPresent(_tableId), isFalse);
      expect(controller.isPaidAndOccupied(_tableId), isFalse);
    },
  );
}

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
    'manualTerminalEnabled': false,
    'bankTransferEnabled': false,
    'bankTransferDetails': null,
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
    return CheckoutResult(
      status: command.totalsFingerprint == null
          ? 'confirmation_required'
          : 'completed',
      confirmation: {
        'fingerprint': List.filled(64, 'a').join(),
        'totals': _totals,
      },
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

final class _TableRepo implements TableStateRepository {
  _TableRepo({required this.serverTime, required TableStateEntry initial})
    : _entry = initial;

  final String serverTime;
  TableStateEntry _entry;

  @override
  Future<TableStateMap> read(
    String merchantId,
    PosTableStateQuery query,
  ) async => TableStateMap(
    locationId: _location,
    serverTime: serverTime,
    states: [_entry.toJson()],
  );

  @override
  Future<TableStateChangeResult> clear(
    String merchantId,
    ClearTableRequest request,
  ) async {
    _entry = TableStateEntry(
      tableId: _entry.tableId,
      state: tableStateDirty,
      seatedAt: null,
      partySize: null,
      groupId: null,
      paidAt: null,
    );
    return TableStateChangeResult(
      commandId: '00000000-0000-4000-8000-000000000099',
      locationId: _location,
      serverTime: serverTime,
      changed: [_entry.toJson()],
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<(CartController, CheckoutController)> _pump(
  WidgetTester tester,
  _Repo repository,
) async {
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
        onShowBankTransferDetails: (_, _) async => false,
      ),
    ),
  );
  await tester.pumpAndSettle();
  return (cart, checkout);
}
