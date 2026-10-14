import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/features/cart/open_accounts_surface.dart';

Cart _account(
  String id, {
  String? name,
  String? table,
  String? folio,
  String fulfillment = 'dine_in',
  String businessDate = '2026-10-12',
  String createdAt = '2026-10-12T00:00:00Z',
}) => Cart.fromJson({
  'id': id,
  'merchantId': 'merchant',
  'locationId': 'branch',
  'operatorSessionId': 'waiter',
  'status': 'draft',
  'version': 1,
  'fulfillmentType': fulfillment,
  'tableId': table == null ? null : 'table-$id',
  'tableName': table,
  'accountName': name,
  'accountFolio': folio ?? 'Cuenta 024',
  'createdAt': createdAt,
  'operatorName': 'Ana López',
  'items': <Object?>[],
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

Widget _page(OpenAccountsList list) => PosApp(
  locale: const Locale('es'),
  supportedLocales: const [Locale('es')],
  home: PosPage(body: list),
);

void main() {
  testWidgets('previous days filter selects and voids only old accounts', (
    tester,
  ) async {
    var accounts = [
      _account('old-one', businessDate: '2026-10-13'),
      _account('old-two', businessDate: '2026-10-13'),
      _account(
        'today',
        businessDate: '2026-10-14',
        createdAt: '2026-10-14T10:00:00',
      ),
    ];
    List<Cart>? cancelled;
    await tester.pumpWidget(
      _page(
        OpenAccountsList(
          showDateFilter: true,
          clock: () => DateTime(2026, 10, 14, 11),
          currentBusinessDate: '2026-10-14',
          load: () async => accounts,
          onSelected: (_) {},
          onCancelCarriedOver: (selected) async {
            cancelled = selected;
            accounts = accounts
                .where((account) => !selected.any((a) => a.id == account.id))
                .toList();
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Días anteriores'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('open-account-today')), findsNothing);
    await tester.tap(find.text('Seleccionar todas'));
    await tester.pumpAndSettle();
    expect(find.text('Anular seleccionadas (2)'), findsOneWidget);
    await tester.tap(find.text('Anular seleccionadas (2)'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Si alguna tiene un cobro'), findsOneWidget);
    await tester.tap(
      find.descendant(
        of: find.byType(PosAlertDialog),
        matching: find.text('Anular'),
      ),
    );
    await tester.pumpAndSettle();
    expect(cancelled?.map((account) => account.id).toSet(), {
      'old-one',
      'old-two',
    });
    expect(find.text('No hay cuentas de días anteriores.'), findsOneWidget);
    await tester.tap(find.text('Todas las fechas'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('open-account-today')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('old account can be voided alone; action needs permission', (
    tester,
  ) async {
    final old = _account('old', businessDate: '2026-10-13');
    var selected = <Cart>[];
    Widget page(Future<void> Function(List<Cart>)? cancel) => _page(
      OpenAccountsList(
        showDateFilter: true,
        clock: () => DateTime(2026, 10, 14, 11),
        currentBusinessDate: '2026-10-14',
        load: () async => [old],
        onSelected: (_) {},
        onCancelCarriedOver: cancel,
      ),
    );
    await tester.pumpWidget(page(null));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Días anteriores'));
    await tester.pumpAndSettle();
    expect(find.text('Anular'), findsNothing);
    await tester.pumpWidget(
      page((accounts) async {
        selected = accounts;
      }),
    );
    await tester.pumpAndSettle();
    final row = find.byKey(const ValueKey('open-account-old'));
    await tester.tap(find.descendant(of: row, matching: find.text('Anular')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(
        of: find.byType(PosAlertDialog),
        matching: find.text('Anular'),
      ),
    );
    await tester.pumpAndSettle();
    expect(selected.single.id, 'old');
    expect(tester.takeException(), isNull);
  });

  testWidgets('previous-day actions stay usable on a narrow screen', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      _page(
        OpenAccountsList(
          showDateFilter: true,
          clock: () => DateTime(2026, 10, 14, 11),
          currentBusinessDate: '2026-10-14',
          load: () async => [_account('old', businessDate: '2026-10-13')],
          onSelected: (_) {},
          onCancelCarriedOver: (_) async {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Días anteriores'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Seleccionar todas'));
    await tester.pumpAndSettle();
    expect(find.text('Anular seleccionadas (1)'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('bulk selection stops at the atomic 50-account limit', (
    tester,
  ) async {
    await tester.pumpWidget(
      _page(
        OpenAccountsList(
          showDateFilter: true,
          clock: () => DateTime(2026, 10, 14, 11),
          currentBusinessDate: '2026-10-14',
          load: () async => [
            for (var index = 0; index < 51; index++)
              _account('old-$index', businessDate: '2026-10-13'),
          ],
          onSelected: (_) {},
          onCancelCarriedOver: (_) async {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Días anteriores'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Seleccionar 50'));
    await tester.pumpAndSettle();
    expect(find.text('Anular seleccionadas (50)'), findsOneWidget);
    expect(
      find.text('Puedes anular hasta 50 cuentas por operación.'),
      findsOneWidget,
    );
    await tester.tap(find.text('Quitar selección'));
    await tester.pumpAndSettle();
    expect(find.text('Anular seleccionadas (0)'), findsOneWidget);
  });

  testWidgets('an old active cart cannot hide nine accounts from yesterday', (
    tester,
  ) async {
    final yesterday = List.generate(
      9,
      (index) => _account(
        'old-$index',
        businessDate: '2026-10-13',
        createdAt: '2026-10-13T18:00:00',
      ),
    );
    final accounts = [
      ...yesterday,
      _account(
        'today',
        businessDate: '2026-10-14',
        createdAt: '2026-10-14T09:00:00',
      ),
    ];
    Widget page(String currentBusinessDate) => _page(
      OpenAccountsList(
        load: () async => accounts,
        currentBusinessDate: currentBusinessDate,
        clock: () => DateTime(2026, 10, 14, 11),
        onSelected: (_) {},
      ),
    );
    await tester.pumpWidget(page('2026-10-14'));
    await tester.pumpAndSettle();
    expect(find.textContaining('9 cuentas quedaron abiertas'), findsOneWidget);

    await tester.pumpWidget(page('2026-10-13'));
    await tester.pumpAndSettle();

    expect(find.textContaining('9 cuentas quedaron abiertas'), findsOneWidget);
    expect(find.text('DE UN DÍA ANTERIOR'), findsOneWidget);
    expect(find.text('Anterior'), findsWidgets);
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('open-account-today')),
      200,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('DE HOY'), findsOneWidget);
    expect(find.byKey(const ValueKey('open-account-today')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('reused daily folio shows the older business date', (
    tester,
  ) async {
    final old = _account(
      'old',
      folio: 'Cuenta 004',
      table: 'Mesa 1',
      businessDate: '2026-10-13',
    );
    final today = _account(
      'today',
      folio: 'Cuenta 004',
      table: 'Mesa 2',
      businessDate: '2026-10-14',
      createdAt: '2026-10-14T10:00:00',
    );
    await tester.pumpWidget(
      _page(
        OpenAccountsList(
          clock: () => DateTime(2026, 10, 14, 11),
          currentBusinessDate: '2026-10-14',
          load: () async => [old, today],
          onSelected: (_) {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Cuenta 004 · 2026-10-13 · Mesa 1'), findsOneWidget);
    expect(find.text('Cuenta 004 · Mesa 2'), findsOneWidget);
    expect(find.text('Cuenta 004 · 2026-10-14 · Mesa 2'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'availability checks pause with the app and stop when the account closes',
    (tester) async {
      final busy = _account('busy');
      var reads = 0;
      var releases = 0;
      await tester.pumpWidget(
        _page(
          OpenAccountsList(
            load: () async => [busy],
            watchedAccount: busy,
            readAccount: (_) async {
              reads++;
              throw const AppException(
                category: AppErrorCategory.conflict,
                code: 'CART_NOT_FOUND',
                recoverable: true,
              );
            },
            onAccountReleased: () => releases++,
            onSelected: (_) {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump(const Duration(seconds: 10));
      expect(reads, 0);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump(const Duration(seconds: 5));
      await tester.pump();
      expect(reads, 1);
      expect(releases, 1);
      expect(find.byKey(const ValueKey('open-account-busy')), findsNothing);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 10));
      expect(reads, 1);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a blocked account is released automatically with its fresh version',
    (tester) async {
      final busy = _account('busy', name: 'Mesa Ana');
      Cart? watched = busy;
      var active = true;
      var reads = 0;
      Cart? selected;
      await tester.pumpWidget(
        _page(
          OpenAccountsList(
            load: () async => [busy],
            watchedAccount: watched,
            readAccount: (_) async {
              reads++;
              return Cart.fromJson({
                ...busy.toJson(),
                'accountOwnerActive': active,
                'version': active ? 1 : 2,
              });
            },
            onAccountReleased: () => watched = null,
            onSelected: (account) => selected = account,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(PosField), 'Ana');
      await tester.pump(const Duration(seconds: 5));
      await tester.pump();
      expect(watched, same(busy));
      active = false;
      await tester.pump(const Duration(seconds: 5));
      await tester.pump();
      expect(watched, isNull);
      expect(reads, 2);
      expect(find.text('Ana'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('open-account-busy')));
      expect(selected?.version, 2);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 10));
      expect(reads, 2);
    },
  );

  testWidgets(
    'availability checks preserve a refusal on failure and never overlap',
    (tester) async {
      final busy = _account('busy');
      var reads = 0;
      var releases = 0;
      final pending = Completer<Cart>();
      await tester.pumpWidget(
        _page(
          OpenAccountsList(
            load: () async => [busy],
            watchedAccount: busy,
            readAccount: (_) {
              reads++;
              return pending.future;
            },
            onAccountReleased: () => releases++,
            onSelected: (_) {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 5));
      await tester.pump(const Duration(seconds: 20));
      expect(reads, 1);
      pending.completeError(
        const AppException(
          category: AppErrorCategory.transport,
          code: 'NETWORK_ERROR',
          recoverable: true,
        ),
      );
      await tester.pump();
      expect(releases, 0);
      expect(find.byKey(const ValueKey('open-account-busy')), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a response for a previous watched account cannot clear a newer refusal',
    (tester) async {
      final first = _account('first');
      final second = _account('second');
      final pending = Completer<Cart>();
      var releases = 0;
      Widget page(Cart watched) => _page(
        OpenAccountsList(
          load: () async => [first, second],
          watchedAccount: watched,
          readAccount: (_) => pending.future,
          onAccountReleased: () => releases++,
          onSelected: (_) {},
        ),
      );
      await tester.pumpWidget(page(first));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpWidget(page(second));
      pending.complete(
        Cart.fromJson({...first.toJson(), 'accountOwnerActive': false}),
      );
      await tester.pump();
      expect(releases, 0);
      await tester.pumpWidget(const SizedBox());
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'fulfillment filter includes table and tableless dine-in accounts',
    (tester) async {
      await tester.pumpWidget(
        _page(
          OpenAccountsList(
            showFulfillmentFilter: true,
            load: () async => [
              _account('table', table: 'Mesa 2'),
              _account('counter', name: 'Luis'),
              _account('takeout', name: 'Salida', fulfillment: 'takeout'),
            ],
            onSelected: (_) {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Comer aquí'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('open-account-table')), findsOneWidget);
      expect(
        find.byKey(const ValueKey('open-account-counter')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('open-account-takeout')), findsNothing);
      await tester.tap(find.text('Para llevar'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('open-account-table')), findsNothing);
      expect(
        find.byKey(const ValueKey('open-account-takeout')),
        findsOneWidget,
      );
      await tester.tap(find.text('Todas'));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('open-account-counter')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'search finds folio, table and name and selects the same account',
    (tester) async {
      final terrace = _account('terrace', table: 'Mesa 2', folio: 'Cuenta 125');
      final counter = _account('counter', name: 'Luis', folio: 'Cuenta 126');
      Cart? selected;
      await tester.pumpWidget(
        _page(
          OpenAccountsList(
            load: () async => [terrace, counter],
            clock: () => DateTime(2026, 10, 12, 11),
            currentBusinessDate: '2026-10-12',
            onSelected: (cart) => selected = cart,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Cuenta 125 · Mesa 2'), findsOneWidget);
      expect(find.text('Cuenta 126'), findsOneWidget);
      expect(find.textContaining('Luis'), findsOneWidget);
      await tester.enterText(find.byType(EditableText), '125 ana');
      await tester.pumpAndSettle();
      expect(find.text('Cuenta 125 · Mesa 2'), findsOneWidget);
      expect(find.textContaining('Luis'), findsNothing);
      await tester.tap(find.text('Cuenta 125 · Mesa 2'));
      expect(selected, same(terrace));
      await tester.enterText(find.byType(EditableText), 'Luis');
      await tester.pumpAndSettle();
      expect(find.text('Cuenta 125 · Mesa 2'), findsNothing);
      expect(
        find.byKey(const ValueKey('open-account-counter')),
        findsOneWidget,
      );
      await tester.enterText(find.byType(EditableText), 'unknown');
      await tester.pumpAndSettle();
      expect(find.text('No hay coincidencias.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('without table view excludes assigned accounts after refresh', (
    tester,
  ) async {
    var accounts = [
      _account('table', table: 'Mesa 2'),
      _account('counter', name: 'Luis'),
    ];
    await tester.pumpWidget(
      _page(
        OpenAccountsList(
          tablelessOnly: true,
          load: () async => accounts,
          onSelected: (_) {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Cuenta 024 · Mesa 2'), findsNothing);
    expect(find.textContaining('Luis'), findsOneWidget);
    accounts = [_account('counter', name: 'Luis', table: 'Mesa 3')];
    await tester.tap(
      find.byWidgetPredicate(
        (widget) => widget is PosIconButton && widget.tooltip == 'Actualizar',
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('Luis'), findsNothing);
    expect(find.text('No hay cuentas abiertas.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
