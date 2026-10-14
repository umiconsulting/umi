import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/operator_permissions.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/features/cart/account_details_surface.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/cart/open_accounts_surface.dart';
import 'package:umi_pos/features/sale/sale_lifecycle_controller.dart';
import 'package:umi_pos/features/sale/sale_repository.dart';
import 'package:umi_pos/shared/approvals/manager_approval_repository.dart';

/// The elevation route, faked: it answers what the server would answer and keeps the
/// request, which is what the assertions read.
final class _Approvals implements ManagerApprovalRepository {
  ManagerApprovalRequest? request;
  AppException? failure;

  @override
  Future<ElevationGrantView> approve(ManagerApprovalRequest request) async {
    this.request = request;
    if (failure != null) throw failure!;
    return ElevationGrantView(
      elevationId: 'elevation',
      permission: request.permission,
      merchantId: request.merchantId,
      locationId: request.locationId,
      method: 'manager_approval',
      expiresAt: '2026-10-12T00:05:00Z',
      commandFingerprint: request.commandFingerprint,
    );
  }
}

Cart _account(
  String id, {
  String owner = 'waiter',
  bool sent = false,
  String? tableId,
  String? tableName,
  String? accountName,
  String lifecycle = 'building_cart',
  String createdAt = '2026-10-12T00:00:00Z',
  String businessDate = '2026-10-12',
}) => Cart.fromJson({
  'id': id,
  'merchantId': 'merchant',
  'locationId': 'branch',
  'operatorSessionId': owner,
  'status': 'draft',
  'version': 7,
  'firedOrderId': sent ? 'order' : null,
  'fulfillmentType': 'dine_in',
  'tableId': tableId,
  'tableName': tableName,
  'tableVisitId': tableId == null ? null : 'visit',
  'accountName': accountName,
  'accountFolio': 'Cuenta 024',
  'createdAt': createdAt,
  'operatorName': 'Ana López',
  'lifecycleState': lifecycle,
  'items': [
    {
      'id': 'line',
      'productId': 'product',
      'productName': 'Café',
      'saleAction': 'add',
      'quantity': 1,
      'courseNumber': 1,
      'variant': null,
      'modifiers': <Map<String, Object?>>[],
      'note': null,
      'fired': sent,
      'firedOrderItemId': sent ? 'order-line' : null,
      'price': {
        'lineTotal': {'minorUnits': 4500, 'currency': 'MXN'},
      },
    },
  ],
  'totals': {
    'subtotal': {'minorUnits': 4500, 'currency': 'MXN'},
    'tax': {'minorUnits': 0, 'currency': 'MXN'},
    'discounts': {
      'total': {'minorUnits': 0, 'currency': 'MXN'},
      'entries': <Object?>[],
    },
    'grandTotal': {'minorUnits': 4500, 'currency': 'MXN'},
    'businessDate': businessDate,
  },
  'checkoutEnabled': true,
  'checkoutMessageCode': 'CHECKOUT_READY',
  'updatedAt': '2026-10-12T00:00:00Z',
});

class _Telemetry implements Telemetry {
  final events = <String>[];
  @override
  void event(ClientEvent event) => events.add(event.name);
}

class _Repository
    implements
        CartRepository,
        OpenAccountCartRepository,
        AccountDetailsCartRepository,
        SentCartLineRepository {
  final calls = <String>[];
  final accounts = <String, Cart>{};
  AppException? suspendFailure;
  CartQuery? lastReadQuery;
  CartLineInput? lastLine;
  String? lastReadId;
  AppException? cancellationFailure;
  RemoveSentCartLineRequest? cancellationRequest;
  AssignCartTableRequest? assignmentRequest;
  SetCartAccountDetailsRequest? detailsRequest;
  AppException? assignmentFailure;
  String? savedName;
  bool savedNameExplicit = false;

  @override
  Future<Cart> setAccountDetails(
    String merchantId,
    String cartId,
    SetCartAccountDetailsRequest request,
  ) async {
    calls.add('name:$cartId');
    detailsRequest = request;
    final cart = accounts[cartId]!;
    final changed = Cart.fromJson({
      ...cart.toJson(),
      'accountName': request.accountName,
      'version': request.expectedVersion + 1,
    });
    accounts[cartId] = changed;
    return changed;
  }

  @override
  Future<Cart> assignAccountTable(
    String merchantId,
    String cartId,
    AssignCartTableRequest request,
  ) async {
    calls.add('assign:$cartId');
    assignmentRequest = request;
    if (assignmentFailure != null) throw assignmentFailure!;
    final cart = accounts[cartId]!;
    return Cart.fromJson({
      ...cart.toJson(),
      'version': request.expectedVersion + 1,
      'tableId': request.tableId,
      'tableName': 'Mesa 2',
      'tableVisitId': 'new-visit',
      'fulfillmentType': 'dine_in',
    });
  }

  @override
  Future<Cart> cancelSentLine(
    String merchantId,
    String lineId,
    RemoveSentCartLineRequest request,
  ) async {
    calls.add('cancel:$lineId');
    cancellationRequest = request;
    if (cancellationFailure != null) throw cancellationFailure!;
    return Cart.fromJson({
      ...accounts[request.cartId]!.toJson(),
      'version': request.expectedVersion + 1,
      'items': <Map<String, Object?>>[],
    });
  }

  @override
  Future<List<Cart>> openAccounts(String merchantId, CartQuery query) async =>
      accounts.values.toList();

  @override
  Future<Cart> account(
    String merchantId,
    String cartId,
    CartQuery query,
  ) async {
    calls.add('read:$cartId');
    lastReadId = cartId;
    lastReadQuery = query;
    return accounts[cartId]!;
  }

  @override
  Future<Cart> suspendAccount(
    String merchantId, {
    required Cart cart,
    required CartQuery query,
    required String idempotencyKey,
    String? accountName,
    bool updateName = false,
  }) async {
    calls.add('save:${cart.id}');
    savedName = accountName;
    savedNameExplicit = updateName;
    if (suspendFailure != null) throw suspendFailure!;
    final saved = Cart.fromJson({
      ...cart.toJson(),
      'version': cart.version + 1,
      'lifecycleState': 'suspended',
      if (updateName) 'accountName': accountName,
    });
    accounts[saved.id] = saved;
    return saved;
  }

  @override
  Future<Cart> openTableAccount(
    String merchantId, {
    required CartQuery query,
    required String tableId,
    required String idempotencyKey,
  }) async {
    calls.add('open:$tableId');
    return accounts.values.firstWhere(
      (cart) => cart.toJson()['tableId'] == tableId,
    );
  }

  @override
  Future<Cart> resumeAccount(
    String merchantId, {
    required Cart cart,
    required CartQuery query,
    required String idempotencyKey,
  }) async {
    calls.add('resume:${cart.id}');
    return Cart.fromJson({
      ...cart.toJson(),
      'lifecycleState': 'recovered',
      'operatorSessionId': query.operatorSessionId,
    });
  }

  @override
  Future<Cart> add(String merchantId, CartLineInput input) async {
    lastLine = input;
    return accounts[input.cartId]!;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw StateError('Unexpected cart call: ${invocation.memberName}');
}

class _NoSaleCommands implements SaleRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw StateError('Unexpected sale command: ${invocation.memberName}');
}

class _CartBootstrap extends _Repository {
  Cart? current;
  int creates = 0;
  @override
  Future<Cart> create(String merchantId, CreateCartRequest request) async {
    calls.add('create');
    creates++;
    final created = Cart.fromJson({
      ..._account(
        'counter-$creates',
        owner: request.operatorSessionId,
      ).toJson(),
      'merchantId': merchantId,
      'locationId': request.locationId,
      'items': <Map<String, Object?>>[],
    });
    current = created;
    return created;
  }
}

class _CartOnlySales extends _NoSaleCommands {
  _CartOnlySales(this.carts);
  final _CartBootstrap carts;
  @override
  Future<SaleSnapshot> current(
    String merchantId,
    SaleHistoryQuery query,
  ) async {
    final cart = carts.current;
    if (cart == null) {
      throw const AppException(
        category: AppErrorCategory.conflict,
        code: 'SALE_NOT_FOUND',
        recoverable: true,
      );
    }
    return SaleSnapshot(
      id: cart.id,
      state: 'building_cart',
      cart: cart.toJson(),
      label: cart.accountName,
      customer: null,
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
      updatedAt: cart.updatedAt,
    );
  }
}

class _AccountApi implements ApiClient {
  Map<String, Object?>? body;
  String? path;
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
    this.body = body;
    this.path = path;
    return _account('a').toJson();
  }

  @override
  void dispose() {}
}

void main() {
  test(
    'waiter bootstrap waits for an order before creating an account',
    () async {
      final repository = _CartBootstrap();
      final telemetry = _Telemetry();
      final cart = CartController(repository: repository, telemetry: telemetry);
      final sales = SaleLifecycleController(
        repository: _CartOnlySales(repository),
        cart: cart,
        telemetry: telemetry,
      );
      addTearDown(cart.dispose);
      addTearDown(sales.dispose);
      await sales.open('merchant', 'branch', 'waiter', useCartAuthority: true);
      expect(repository.calls, isEmpty);
      expect(cart.state.cart, isNull);
      expect(sales.state.phase, SalePhase.idle);
      expect(await sales.newSale(), isTrue);
      expect(repository.calls, ['create']);
      expect(cart.state.cart!.tableId, isNull);
      expect(cart.state.cart!.operatorSessionId, 'waiter');
      expect(sales.state.phase, SalePhase.buildingCart);
      expect(sales.state.errorCode, isNull);
    },
  );

  test(
    'waiter starts a fresh unnamed account after saving and leaving',
    () async {
      final repository = _CartBootstrap();
      final telemetry = _Telemetry();
      final cart = CartController(repository: repository, telemetry: telemetry);
      final sales = SaleLifecycleController(
        repository: _CartOnlySales(repository),
        cart: cart,
        telemetry: telemetry,
      );
      addTearDown(cart.dispose);
      addTearDown(sales.dispose);
      await sales.open('merchant', 'branch', 'waiter', useCartAuthority: true);
      expect(repository.calls, isEmpty);
      expect(await sales.newSale(), isTrue);
      final savedId = cart.state.cart!.id;
      expect(
        await sales.newSale(),
        isFalse,
        reason: 'active account cannot be replaced',
      );
      expect(
        await cart.saveAccount(accountName: 'Ana', updateName: true),
        isTrue,
      );
      sales.accountSaved();
      cart.clearLocal();
      expect(await sales.newSale(), isTrue);
      expect(repository.calls, ['create', 'save:$savedId', 'create']);
      expect(repository.accounts[savedId]!.accountName, 'Ana');
      expect(cart.state.cart!.id, isNot(savedId));
      expect(cart.state.cart!.tableId, isNull);
      expect(sales.state.errorCode, isNull);
    },
  );

  test(
    'atomic save wire distinguishes omitted name from explicit removal',
    () async {
      final api = _AccountApi();
      final repository = ApiCartRepository(api);
      final account = _account('a');
      const query = CartQuery(
        locationId: 'branch',
        operatorSessionId: 'waiter',
      );
      await repository.suspendAccount(
        'merchant',
        cart: account,
        query: query,
        idempotencyKey: 'save',
      );
      expect(api.body!.containsKey('accountName'), isFalse);
      await repository.suspendAccount(
        'merchant',
        cart: account,
        query: query,
        idempotencyKey: 'save-null',
        updateName: true,
      );
      expect(api.body!.containsKey('accountName'), isTrue);
      expect(api.body!['accountName'], isNull);
      expect(api.path, UmiRoutes.posCartSuspend('merchant'));
    },
  );

  test(
    'named save is one atomic suspend and an omitted name preserves the label',
    () async {
      final repository = _Repository();
      final cart = CartController(
        repository: repository,
        telemetry: _Telemetry(),
      );
      addTearDown(cart.dispose);
      cart.restore(_account('a'));
      expect(
        await cart.saveAccount(
          accountName: '  Ana · para llevar  ',
          updateName: true,
        ),
        isTrue,
      );
      expect(repository.calls, ['save:a']);
      expect(repository.savedName, 'Ana · para llevar');
      expect(repository.savedNameExplicit, isTrue);
      expect(cart.state.cart!.accountName, 'Ana · para llevar');
      expect(await cart.saveAccount(), isTrue);
      expect(repository.savedNameExplicit, isFalse);
      expect(cart.state.cart!.accountName, 'Ana · para llevar');
    },
  );

  test(
    'rename can remove a name without changing the reference or products',
    () async {
      final repository = _Repository();
      final account = _account('a', accountName: 'Ana');
      repository.accounts['a'] = account;
      final cart = CartController(
        repository: repository,
        telemetry: _Telemetry(),
      );
      addTearDown(cart.dispose);
      cart.restore(account, operatorSessionId: 'cashier');
      expect(await cart.renameAccount('  '), isTrue);
      expect(repository.detailsRequest!.accountName, isNull);
      expect(repository.detailsRequest!.operatorSessionId, 'cashier');
      expect(cart.state.cart!.accountFolio, account.accountFolio);
      expect(cart.state.cart!.items, account.items);
    },
  );

  test(
    'table assignment keeps account ID, reference, name and sent products',
    () async {
      final repository = _Repository();
      final account = _account('a', accountName: 'Ana', sent: true);
      repository.accounts['a'] = account;
      final cart = CartController(
        repository: repository,
        telemetry: _Telemetry(),
      );
      addTearDown(cart.dispose);
      cart.restore(account, operatorSessionId: 'cashier');
      expect(await cart.assignAccountTable('table-2'), isTrue);
      expect(repository.assignmentRequest!.expectedVersion, 7);
      expect(repository.assignmentRequest!.operatorSessionId, 'cashier');
      expect(cart.state.cart!.id, account.id);
      expect(cart.state.cart!.accountFolio, account.accountFolio);
      expect(cart.state.cart!.accountName, 'Ana');
      expect(cart.state.cart!.items, account.items);
      expect(cart.state.cart!.firedOrderId, account.firedOrderId);
      expect(cart.state.cart!.tableId, 'table-2');
      expect(
        accountDisplayTitle(cart.state.cart!, spanish: true),
        'Cuenta 024',
      );
    },
  );

  test(
    'occupied table refusal retains the unnamed account and all its products',
    () async {
      final repository = _Repository()
        ..assignmentFailure = const AppException(
          category: AppErrorCategory.conflict,
          code: 'CART_TABLE_ACCOUNT_EXISTS',
          recoverable: true,
        );
      final account = _account('a');
      final cart = CartController(
        repository: repository,
        telemetry: _Telemetry(),
      );
      addTearDown(cart.dispose);
      cart.restore(account);
      expect(await cart.assignAccountTable('occupied'), isFalse);
      expect(cart.state.cart!.id, account.id);
      expect(cart.state.cart!.items, account.items);
      expect(cart.state.cart!.tableId, isNull);
      expect(cart.state.errorCode, 'CART_TABLE_ACCOUNT_EXISTS');
      repository.accounts[account.id] = account;
      repository.assignmentFailure = null;
      expect(await cart.assignAccountTable('free'), isTrue);
      expect(cart.state.errorCode, isNull);
      expect(cart.state.cart!.id, account.id);
      expect(cart.state.cart!.items, account.items);
      expect(cart.state.cart!.tableId, 'free');
    },
  );
  testWidgets(
    'account name is optional and cancel is distinct from a blank name',
    (tester) async {
      String? result = 'unopened';
      await tester.pumpWidget(
        PosApp(
          locale: const Locale('es'),
          supportedLocales: const [Locale('es')],
          home: Builder(
            builder: (context) => PosPage(
              body: PosButton(
                onPressed: () async => result = await showAccountNameDialog(
                  context,
                  saveAndLeave: true,
                ),
                child: const Text('Abrir'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Abrir'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Guardar y salir'));
      await tester.pumpAndSettle();
      expect(result, '');
      await tester.tap(find.text('Abrir'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();
      expect(result, isNull);
      expect(tester.takeException(), isNull);
    },
  );

  test(
    'operator exit parks account through cart authority without sale mutations',
    () async {
      final repository = _Repository();
      final telemetry = _Telemetry();
      final cart = CartController(repository: repository, telemetry: telemetry);
      final sales = SaleLifecycleController(
        repository: _NoSaleCommands(),
        cart: cart,
        telemetry: telemetry,
      );
      addTearDown(cart.dispose);
      addTearDown(sales.dispose);
      cart.restore(_account('waiter-account'));
      expect(
        await sales.prepareForOperatorExit(useCartAuthority: true),
        isTrue,
      );
      expect(repository.calls, ['save:waiter-account']);
      expect(
        repository.accounts['waiter-account']!.items.single['fired'],
        isFalse,
      );
      expect(sales.state.phase, SalePhase.suspended);
    },
  );

  test('waiter sees tables and orders without sale management access', () {
    final access = OperatorActionAccess(OperatorPermissions(['cart.write']));
    expect(tillSurfacesFor(access, hasFloorPlan: true), [
      TillSurface.order,
      TillSurface.tables,
      TillSurface.settings,
    ]);
    expect(access.showSaleActions, isFalse);
  });

  test(
    'cancel sent line sends the chosen reason and current account version',
    () async {
      final repository = _Repository();
      final telemetry = _Telemetry();
      final account = _account('a', owner: 'old-session', sent: true);
      repository.accounts['a'] = account;
      final controller = CartController(
        repository: repository,
        telemetry: telemetry,
      );
      addTearDown(controller.dispose);
      controller.restore(account, operatorSessionId: 'cashier');
      expect(
        await controller.cancelSentLine(
          CartItem.fromJson(account.items.single),
          'customer_changed',
        ),
        isTrue,
      );
      expect(repository.calls, ['cancel:line']);
      expect(repository.cancellationRequest!.reasonCode, 'customer_changed');
      expect(repository.cancellationRequest!.operatorSessionId, 'cashier');
      expect(repository.cancellationRequest!.expectedVersion, 7);
      expect(controller.state.cart!.items, isEmpty);
      expect(controller.state.cart!.version, 8);
      expect(telemetry.events, contains('sent_line_cancelled'));
    },
  );

  test(
    'preparation refusal preserves the sent line and account version',
    () async {
      final repository = _Repository()
        ..cancellationFailure = const AppException(
          category: AppErrorCategory.conflict,
          code: 'KITCHEN_PREPARATION_STARTED',
          recoverable: true,
        );
      final telemetry = _Telemetry();
      final account = _account('a', sent: true);
      final controller = CartController(
        repository: repository,
        telemetry: telemetry,
      );
      addTearDown(controller.dispose);
      controller.restore(account);
      expect(
        await controller.cancelSentLine(
          CartItem.fromJson(account.items.single),
          'duplicate',
        ),
        isFalse,
      );
      expect(controller.state.cart!.items.single['fired'], isTrue);
      expect(controller.state.cart!.version, 7);
      expect(controller.state.errorCode, 'KITCHEN_PREPARATION_STARTED');
      expect(telemetry.events, isNot(contains('sent_line_cancelled')));
    },
  );

  test(
    'the manager approves the void, and the retry carries that exact elevation',
    () async {
      final repository = _Repository();
      final approvals = _Approvals();
      final account = _account('a', sent: true);
      repository.accounts['a'] = account;
      final controller = CartController(
        repository: repository,
        telemetry: _Telemetry(),
        approvals: approvals,
      );
      addTearDown(controller.dispose);
      controller.restore(account);
      final line = CartItem.fromJson(account.items.single);
      expect(controller.supportsVoidAfterPreparationApproval, isTrue);

      final approval = await controller.approveVoidAfterPreparation(
        item: line,
        reasonCode: 'duplicate',
        managerPin: '3333',
      );

      // The PIN is the manager's, and what it proves is the permission the API named
      // back on the refusal: voiding something that was already made.
      expect(approvals.request!.managerPin, '3333');
      expect(
        approvals.request!.permission,
        'order.void_after_preparation.approve',
      );
      expect(approvals.request!.operatorSessionId, 'waiter');
      // The elevation is bound to the act, so a manager who approved THIS line for THIS
      // reason on THIS version cannot have approved a different cancel.
      expect(
        approvals.request!.commandFingerprint,
        voidAfterPreparationFingerprint(
          merchantId: 'merchant',
          locationId: 'branch',
          cartId: 'a',
          lineId: line.id,
          reasonCode: 'duplicate',
          expectedVersion: 7,
        ),
      );

      expect(
        await controller.cancelSentLine(
          line,
          'duplicate',
          approvalId: approval!.approvalId,
          actionFingerprint: approval.fingerprint,
        ),
        isTrue,
      );
      expect(repository.cancellationRequest!.approvalId, 'elevation');
      expect(
        repository.cancellationRequest!.approvalFingerprint,
        approval.fingerprint,
      );
    },
  );

  test('a refused manager PIN leaves the elevation ungranted', () async {
    final repository = _Repository();
    final approvals = _Approvals()
      ..failure = const AppException(
        category: AppErrorCategory.permission,
        code: 'PERMISSION_DENIED',
        recoverable: true,
      );
    final account = _account('a', sent: true);
    final controller = CartController(
      repository: repository,
      telemetry: _Telemetry(),
      approvals: approvals,
    );
    addTearDown(controller.dispose);
    controller.restore(account);

    await expectLater(
      controller.approveVoidAfterPreparation(
        item: CartItem.fromJson(account.items.single),
        reasonCode: 'duplicate',
        managerPin: '9999',
      ),
      throwsA(
        isA<AppException>().having((e) => e.code, 'code', 'PERMISSION_DENIED'),
      ),
    );
    expect(repository.calls, isEmpty);
  });

  test('a till with no approval route cannot offer the approved cancel', () {
    final controller = CartController(
      repository: _Repository(),
      telemetry: _Telemetry(),
    );
    addTearDown(controller.dispose);
    expect(controller.supportsVoidAfterPreparationApproval, isFalse);
  });

  test('save retains pending products and never sends an order', () async {
    final repository = _Repository();
    final telemetry = _Telemetry();
    final controller = CartController(
      repository: repository,
      telemetry: telemetry,
    );
    addTearDown(controller.dispose);
    controller.restore(_account('a'));
    expect(await controller.saveAccount(), isTrue);
    expect(repository.calls, ['save:a']);
    expect(controller.state.cart!.items.single['fired'], isFalse);
    expect(controller.state.cart!.firedOrderId, isNull);
    expect(controller.state.cart!.version, 8);
    expect(telemetry.events, contains('account_saved'));
    expect(telemetry.events, isNot(contains('order_fired')));
  });

  test(
    'table switch saves the previous account before opening another',
    () async {
      final repository = _Repository();
      repository.accounts['b'] = _account(
        'b',
        tableId: 'table-b',
        tableName: 'Mesa 2',
      );
      final controller = CartController(
        repository: repository,
        telemetry: _Telemetry(),
      );
      addTearDown(controller.dispose);
      controller.restore(_account('a'));
      expect(
        await controller.openTableAccount(
          merchantId: 'merchant',
          locationId: 'branch',
          operatorSessionId: 'waiter',
          tableId: 'table-b',
        ),
        isTrue,
      );
      expect(repository.calls, ['save:a', 'open:table-b']);
      expect(controller.state.cart!.id, 'b');
      expect(repository.accounts['a']!.items.single['fired'], isFalse);
    },
  );

  test('save refusal retains the account and prevents table switch', () async {
    final repository = _Repository()
      ..suspendFailure = const AppException(
        category: AppErrorCategory.conflict,
        code: 'CART_VERSION_CONFLICT',
        recoverable: true,
      );
    final controller = CartController(
      repository: repository,
      telemetry: _Telemetry(),
    );
    addTearDown(controller.dispose);
    controller.restore(_account('a'));
    expect(
      await controller.openTableAccount(
        merchantId: 'merchant',
        locationId: 'branch',
        operatorSessionId: 'waiter',
        tableId: 'table-b',
      ),
      isFalse,
    );
    expect(repository.calls, ['save:a']);
    expect(controller.state.cart!.id, 'a');
    expect(controller.state.errorCode, 'CART_VERSION_CONFLICT');
  });

  test(
    'opening the moved table refreshes its account without suspending it',
    () async {
      final repository = _Repository();
      final original = _account('a', tableId: 'table-a', tableName: 'Mesa 2');
      final moved = Cart.fromJson({
        ...original.toJson(),
        'tableId': 'table-b',
        'tableName': 'Mesa 3',
        'version': original.version + 1,
      });
      repository.accounts['a'] = moved;
      final controller = CartController(
        repository: repository,
        telemetry: _Telemetry(),
      );
      addTearDown(controller.dispose);
      controller.restore(original);
      expect(
        await controller.openTableAccount(
          merchantId: 'merchant',
          locationId: 'branch',
          operatorSessionId: 'waiter',
          tableId: 'table-b',
        ),
        isTrue,
      );
      expect(repository.calls, ['read:a']);
      expect(controller.state.cart!.tableName, 'Mesa 3');
      expect(controller.state.cart!.version, moved.version);
      expect(controller.state.cart!.items, original.items);
    },
  );

  test(
    'recovered account refreshes by ID and uses the current actor for edits',
    () async {
      final repository = _Repository();
      final cart = _account(
        'shared',
        owner: 'old-session',
        sent: true,
        tableId: 'table',
        tableName: 'Mesa 1',
        lifecycle: 'suspended',
      );
      repository.accounts[cart.id] = cart;
      final controller = CartController(
        repository: repository,
        telemetry: _Telemetry(),
      );
      addTearDown(controller.dispose);
      expect(
        await controller.resumeAccount(
          account: cart,
          operatorSessionId: 'cashier',
        ),
        isTrue,
      );
      await controller.refresh();
      expect(repository.lastReadId, 'shared');
      expect(repository.lastReadQuery!.operatorSessionId, 'cashier');
      expect(controller.state.cart!.items.single['fired'], isTrue);
      await controller.add(productId: 'round-two');
      expect(repository.lastLine!.cartId, 'shared');
      expect(repository.lastLine!.operatorSessionId, 'cashier');
    },
  );

  testWidgets(
    'account list keeps send status visible and secondary details in tooltips',
    (tester) async {
      final accounts = [
        _account('table-account', tableId: 'table', tableName: 'Mesa 1'),
        _account('counter-account', sent: true, lifecycle: 'suspended'),
      ];
      await tester.pumpWidget(
        PosApp(
          locale: const Locale('es'),
          supportedLocales: const [Locale('es')],
          home: PosPage(
            body: OpenAccountsDialog(
              load: () async => accounts,
              operatorSessionId: 'cashier',
              clock: () => DateTime(2026, 10, 12, 11),
              currentBusinessDate: '2026-10-12',
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('Cuenta 024 · Mesa 1'), findsOneWidget);
      expect(find.text('Cuenta 024'), findsOneWidget);
      expect(find.textContaining('Por enviar'), findsOneWidget);
      expect(find.textContaining('Enviada'), findsOneWidget);
      expect(find.textContaining('Cuenta 024'), findsNWidgets(2));
      expect(find.textContaining('Ana López'), findsNothing);
      expect(find.textContaining('MXN 45.00'), findsNWidgets(2));
      final details = tester.widgetList<PosTooltip>(find.byType(PosTooltip));
      expect(
        details.where((tooltip) => tooltip.message.contains('Ana López')),
        hasLength(2),
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'an account left open before the 04:00 boundary is grouped as earlier',
    (tester) async {
      final accounts = [
        // Opened at 20:00 yesterday: the same shift as today's early hours, but on the
        // previous side of the operational-day boundary.
        _account(
          'yesterday',
          tableId: 'table',
          tableName: 'Mesa 1',
          createdAt: '2026-10-11T20:00:00',
        ),
        _account('today', createdAt: '2026-10-12T09:00:00', accountName: 'Ana'),
      ];
      await tester.pumpWidget(
        PosApp(
          locale: const Locale('es'),
          supportedLocales: const [Locale('es')],
          home: PosPage(
            body: OpenAccountsDialog(
              load: () async => accounts,
              operatorSessionId: 'cashier',
              clock: () => DateTime(2026, 10, 12, 11, 30),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('DE UN DÍA ANTERIOR'), findsOneWidget);
      expect(find.text('DE HOY'), findsOneWidget);
      expect(find.text('Anterior'), findsOneWidget);
      expect(find.textContaining('hace 15 h'), findsOneWidget);
      expect(
        find.textContaining('cuenta quedó abierta de un día anterior'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('a day of only fresh accounts shows no carried-over notice', (
    tester,
  ) async {
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        supportedLocales: const [Locale('es')],
        home: PosPage(
          body: OpenAccountsDialog(
            load: () async => [
              _account('today', createdAt: '2026-10-12T09:00:00'),
            ],
            operatorSessionId: 'cashier',
            clock: () => DateTime(2026, 10, 12, 11, 30),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('DE UN DÍA ANTERIOR'), findsNothing);
    expect(find.text('DE HOY'), findsNothing);
    expect(find.text('Anterior'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets("the server's business date outranks the till's 04:00 guess", (
    tester,
  ) async {
    // The merchant's day turns at midnight, so the 02:00 account is today's even
    // though the till's own boundary (04:00) would file it as yesterday's. The date
    // the server stamped on the account is the one that decides.
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        supportedLocales: const [Locale('es')],
        home: PosPage(
          body: OpenAccountsDialog(
            load: () async => [
              _account('early', createdAt: '2026-10-12T02:00:00'),
              _account(
                'stamped-yesterday',
                createdAt: '2026-10-12T09:00:00',
                businessDate: '2026-10-11',
              ),
            ],
            operatorSessionId: 'cashier',
            clock: () => DateTime(2026, 10, 12, 11, 30),
            currentBusinessDate: '2026-10-12',
          ),
        ),
      ),
    );
    await tester.pump();

    // The 02:00 account is today's, and the one the server stamped with yesterday's
    // date is the only carried one.
    expect(find.text('DE UN DÍA ANTERIOR'), findsOneWidget);
    expect(find.text('Anterior'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
