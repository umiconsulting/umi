import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

void main() {
  testWidgets('an icon action has a name and accepts keyboard activation', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    try {
      var activated = 0;
      await tester.pumpWidget(
        PosApp(
          home: PosPage(
            body: Center(
              child: PosIconButton(
                tooltip: 'Actualizar',
                autofocus: true,
                onPressed: () => activated++,
                icon: const PosIcon(PosGlyphs.refresh),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(
        tester.getSemantics(find.byType(PosIcon)),
        isSemantics(
          label: 'Actualizar',
          isButton: true,
          isEnabled: true,
          isFocusable: true,
        ),
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pump();
      expect(activated, 1);
    } finally {
      semantics.dispose();
    }
  });

  testWidgets('navigation selection belongs to the action with the name', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    try {
      var selected = 0;
      await tester.pumpWidget(
        PosApp(
          home: StatefulBuilder(
            builder: (context, setState) => PosPage(
              body: const SizedBox(),
              bottomNavigationBar: PosNavigation(
                selectedIndex: selected,
                onDestinationSelected: (value) =>
                    setState(() => selected = value),
                destinations: const [
                  PosDestination(
                    icon: PosIcon(PosGlyphs.receiptLong),
                    label: 'Pedido',
                  ),
                  PosDestination(
                    icon: PosIcon(PosGlyphs.paymentsOutlined),
                    label: 'Caja',
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      expect(
        tester.getSemantics(find.text('Pedido')),
        isSemantics(
          label: 'Pedido',
          isButton: true,
          isSelected: true,
          isEnabled: true,
        ),
      );
      expect(
        tester.getSemantics(find.text('Caja')),
        isSemantics(
          label: 'Caja',
          isButton: true,
          isSelected: false,
          isEnabled: true,
        ),
      );
      await tester.tap(find.text('Caja'));
      await tester.pump();
      expect(selected, 1);
      expect(
        tester.getSemantics(find.text('Caja')),
        isSemantics(
          label: 'Caja',
          isButton: true,
          isSelected: true,
          isEnabled: true,
        ),
      );
    } finally {
      semantics.dispose();
    }
  });

  testWidgets('a menu with a custom child exposes its selected action', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    try {
      await tester.pumpWidget(
        PosApp(
          home: PosPage(
            body: PosMenuButton<int>(
              tooltip: 'Más secciones',
              selected: true,
              itemBuilder: (_) => const [
                PosMenuItem(value: 1, child: Text('Mesas')),
              ],
              child: const Text('Más'),
            ),
          ),
        ),
      );
      expect(
        tester.getSemantics(find.text('Más')),
        isSemantics(
          label: 'Más secciones',
          isButton: true,
          isEnabled: true,
          isSelected: true,
        ),
      );
      await tester.tap(find.text('Más'));
      await tester.pumpAndSettle();
      expect(find.text('Mesas'), findsOneWidget);
      expect(tester.takeException(), isNull);
    } finally {
      semantics.dispose();
    }
  });
}
