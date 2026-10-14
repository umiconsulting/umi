import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/features/cart/accounts_workspace.dart';

Cart _account(String id, {String? table}) => Cart.fromJson({
  'id': id,
  'merchantId': 'merchant',
  'locationId': 'branch',
  'operatorSessionId': 'waiter',
  'status': 'draft',
  'version': 1,
  'fulfillmentType': 'dine_in',
  'tableId': table == null ? null : 'table-$id',
  'tableName': table,
  'accountName': 'Ana',
  'accountFolio': 'Cuenta 024',
  'createdAt': '2026-10-12T00:00:00Z',
  'operatorName': 'Juan',
  'items': <Object?>[],
  'totals': {
    'subtotal': {'minorUnits': 4500, 'currency': 'MXN'},
    'tax': {'minorUnits': 0, 'currency': 'MXN'},
    'discounts': {
      'total': {'minorUnits': 0, 'currency': 'MXN'},
      'entries': <Object?>[],
    },
    'grandTotal': {'minorUnits': 4500, 'currency': 'MXN'},
    'businessDate': '2026-10-12',
  },
  'checkoutEnabled': true,
  'checkoutMessageCode': 'CHECKOUT_READY',
  'updatedAt': '2026-10-12T00:00:00Z',
});

void main() {
  testWidgets('a refused account stays in the list with its owner notice', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1280, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    const refusal = 'Mesero 2 tiene esta cuenta abierta en Tablet A11.';
    String? notice;
    Cart? watched;
    var active = true;
    var reads = 0;
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        supportedLocales: const [Locale('es')],
        home: StatefulBuilder(
          builder: (context, setState) => AccountsWorkspace(
            withoutTable: true,
            notice: notice,
            watchedAccount: watched,
            readAccount: (account) async {
              reads++;
              return Cart.fromJson({
                ...account.toJson(),
                'accountOwnerActive': active,
              });
            },
            onAccountReleased: () => setState(() {
              watched = null;
              notice = null;
            }),
            onViewChanged: (_) {},
            load: () async => [_account('busy')],
            onSelected: (account) => setState(() {
              watched = account;
              notice = refusal;
            }),
            onNewAccount: null,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('open-account-busy')));
    await tester.pumpAndSettle();
    expect(find.text(refusal).hitTestable(), findsOneWidget);
    expect(find.byKey(const ValueKey('open-account-busy')), findsOneWidget);
    await tester.pump(const Duration(seconds: 5));
    await tester.pump();
    expect(find.text(refusal), findsOneWidget);
    active = false;
    await tester.pump(const Duration(seconds: 5));
    await tester.pump();
    expect(find.text(refusal), findsNothing);
    expect(find.byKey(const ValueKey('open-account-busy')), findsOneWidget);
    await tester.pump(const Duration(seconds: 20));
    expect(reads, 2);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'accounts switch views and create without a table from either view',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      var withoutTable = false;
      var newAccounts = 0;
      Cart? selected;
      final account = _account('counter');
      await tester.pumpWidget(
        PosApp(
          locale: const Locale('es'),
          supportedLocales: const [Locale('es')],
          home: StatefulBuilder(
            builder: (context, setState) => AccountsWorkspace(
              withoutTable: withoutTable,
              onViewChanged: (value) => setState(() => withoutTable = value),
              load: () async => [account, _account('table', table: 'Mesa 2')],
              onSelected: (cart) => selected = cart,
              onNewAccount: () => newAccounts++,
              tables: const Center(child: Text('Plano de mesas')),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Plano de mesas'), findsOneWidget);
      await tester.tap(find.text('Nueva cuenta sin mesa'));
      expect(newAccounts, 1);
      await tester.tap(find.text('Lista'));
      await tester.pumpAndSettle();
      expect(withoutTable, isTrue);
      expect(find.text('Plano de mesas'), findsNothing);
      expect(find.text('Cuenta 024 · 2026-10-12'), findsOneWidget);
      expect(find.text('Cuenta 024 · 2026-10-12 · Mesa 2'), findsOneWidget);
      expect(find.textContaining('Ana'), findsNWidgets(2));
      expect(find.byKey(const ValueKey('open-account-table')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('open-account-counter')));
      expect(selected, same(account));
      await tester.tap(find.text('Nueva cuenta sin mesa'));
      expect(newAccounts, 2);
      await tester.tap(find.text('Mapa'));
      await tester.pumpAndSettle();
      expect(withoutTable, isFalse);
      expect(find.text('Plano de mesas'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'without a map accounts remain available and creation respects busy',
    (tester) async {
      var busy = false;
      var newAccounts = 0;
      var viewChanges = 0;
      late StateSetter update;
      Cart? selected;
      final account = _account('counter');
      await tester.pumpWidget(
        PosApp(
          locale: const Locale('es'),
          supportedLocales: const [Locale('es')],
          home: StatefulBuilder(
            builder: (context, setState) {
              update = setState;
              return AccountsWorkspace(
                withoutTable: false,
                onViewChanged: (_) => viewChanges++,
                load: () async => [account],
                onSelected: (cart) => selected = cart,
                onNewAccount: () => newAccounts++,
                busy: busy,
              );
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(PosSegmented<bool>), findsOneWidget);
      expect(find.text('Días anteriores'), findsOneWidget);
      expect(find.text('Mesas'), findsNothing);
      await tester.tap(find.text('Cuenta 024 · 2026-10-12'));
      expect(selected, same(account));
      await tester.tap(find.text('Nueva cuenta sin mesa'));
      expect(newAccounts, 1);
      update(() => busy = true);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Nueva cuenta sin mesa'));
      expect(newAccounts, 1);
      expect(viewChanges, 0);
      expect(tester.takeException(), isNull);
    },
  );
}
