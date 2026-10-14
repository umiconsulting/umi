import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

void main() {
  final panel = find.byKey(const ValueKey('pos-anchored-menu'));

  testWidgets('selection stays beside its source and restores keyboard focus', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(900, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final semantics = tester.ensureSemantics();
    try {
      var value = 'coffee';
      var changes = 0;
      await tester.pumpWidget(
        PosApp(
          home: StatefulBuilder(
            builder: (_, update) => PosPage(
              body: Stack(
                children: [
                  Positioned(
                    left: 200,
                    top: 80,
                    width: 230,
                    child: PosSelect<String>(
                      value: value,
                      isExpanded: true,
                      onChanged: (next) => update(() {
                        value = next!;
                        changes++;
                      }),
                      items: const [
                        PosSelectItem(value: 'coffee', child: Text('Café')),
                        PosSelectItem(
                          value: 'closed',
                          enabled: false,
                          child: Text('Agotado'),
                        ),
                        PosSelectItem(value: 'tea', child: Text('Té')),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      final source = find.byType(PosSelect<String>);
      final anchor = tester.getRect(source);
      await tester.tap(source);
      await tester.pumpAndSettle();
      final menu = tester.getRect(panel);
      expect(menu.top, closeTo(anchor.bottom + 6, 1));
      expect(menu.left, closeTo(anchor.left, 1));
      expect(find.byType(PosAlertDialog), findsNothing);
      expect(ModalRoute.of(tester.element(source))!.isCurrent, isFalse);
      final selected = find.descendant(of: panel, matching: find.text('Café'));
      expect(
        tester.getSemantics(selected).flagsCollection.isSelected.toBoolOrNull(),
        isTrue,
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(value, 'tea');
      expect(changes, 1);
      expect(panel, findsNothing);
      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pumpAndSettle();
      expect(panel, findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(changes, 1);
      expect(value, 'tea');
      expect(tester.takeException(), isNull);
    } finally {
      semantics.dispose();
    }
  });

  testWidgets('long options fit above a phone edge and remain reachable', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    var value = 35;
    await tester.pumpWidget(
      PosApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.6)),
          child: child!,
        ),
        home: StatefulBuilder(
          builder: (_, update) => PosPage(
            body: Align(
              alignment: Alignment.bottomRight,
              child: SizedBox(
                width: 230,
                child: PosSelect<int>(
                  value: value,
                  menuMaxHeight: 220,
                  onChanged: (next) => update(() => value = next!),
                  items: [
                    for (var i = 0; i < 50; i++)
                      PosSelectItem(
                        value: i,
                        child: Text('Opción de servicio $i'),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
    final source = find.byType(PosSelect<int>);
    final anchor = tester.getRect(source);
    await tester.tap(source);
    await tester.pumpAndSettle();
    final menu = tester.getRect(panel);
    expect(menu.bottom, lessThanOrEqualTo(anchor.top - 5));
    expect(menu.height, lessThanOrEqualTo(220));
    expect(menu.left, greaterThanOrEqualTo(8));
    expect(menu.right, lessThanOrEqualTo(367));
    expect(
      find
          .descendant(of: panel, matching: find.text('Opción de servicio 35'))
          .hitTestable(),
      findsOneWidget,
    );
    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();
    expect(
      find
          .descendant(of: panel, matching: find.text('Opción de servicio 49'))
          .hitTestable(),
      findsOneWidget,
    );
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(value, 49);
    await tester.tap(source);
    await tester.pumpAndSettle();
    expect(panel, findsOneWidget);
    tester.view.physicalSize = const Size(812, 375);
    await tester.pumpAndSettle();
    expect(panel, findsNothing);
    expect(value, 49);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'closing an action menu does not activate the control behind it',
    (tester) async {
      var outside = 0;
      String? action;
      await tester.pumpWidget(
        PosApp(
          home: PosPage(
            body: Stack(
              children: [
                Positioned(
                  left: 20,
                  top: 20,
                  child: PosMenuButton<String>(
                    tooltip: 'Acciones de venta',
                    onSelected: (value) => action = value,
                    itemBuilder: (_) => const [
                      PosMenuItem(value: 'edit', child: Text('Editar nota')),
                      PosMenuDivider(),
                      PosMenuItem(
                        value: 'cancel',
                        enabled: false,
                        child: Text('Cancelar venta'),
                      ),
                    ],
                  ),
                ),
                Positioned(
                  left: 400,
                  top: 300,
                  child: PosButton(
                    onPressed: () => outside++,
                    child: const Text('Otra acción'),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
      await tester.tap(find.byTooltip('Acciones de venta'));
      await tester.pumpAndSettle();
      expect(panel, findsOneWidget);
      await tester.tap(find.text('Cancelar venta'));
      await tester.pumpAndSettle();
      expect(action, isNull);
      expect(panel, findsOneWidget);
      await tester.tap(find.text('Otra acción'), warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(panel, findsNothing);
      expect(outside, 0);
      await tester.tap(find.text('Otra acción'));
      await tester.pump();
      expect(outside, 1);
      expect(tester.takeException(), isNull);
    },
  );
}
