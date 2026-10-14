import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

void main() {
  testWidgets('keyboard reveals and identifies a selected document reference', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final semantics = tester.ensureSemantics();
    try {
      const reference = 'POS-REF-0001';
      await tester.pumpWidget(
        PosApp(
          home: PosPage(
            body: Column(
              children: [
                Expanded(
                  child: SingleChildScrollView(
                    child: Column(
                      children: [
                        const PosSelectableText(reference),
                        const SizedBox(height: 1200),
                        PosButton(
                          onPressed: () {},
                          child: const Text('Leer final'),
                        ),
                      ],
                    ),
                  ),
                ),
                PosButton(
                  autofocus: true,
                  onPressed: () {},
                  child: const Text('Cerrar'),
                ),
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Leer final'));
      await tester.pumpAndSettle();
      final viewport = tester.getRect(find.byType(Scrollable).first);
      expect(
        tester.getRect(find.text(reference)).bottom,
        lessThan(viewport.top),
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<SelectableRegion>(find.byType(SelectableRegion))
            .focusNode!
            .hasFocus,
        isTrue,
      );
      final bounds = tester.getRect(find.text(reference));
      expect(bounds.top, greaterThanOrEqualTo(viewport.top - 1));
      expect(bounds.bottom, lessThanOrEqualTo(viewport.bottom + 1));
      final node = tester.getSemantics(find.text(reference));
      expect(node.flagsCollection.isFocused.toBoolOrNull(), isTrue);
      expect(tester.takeException(), isNull);
    } finally {
      await tester.pumpWidget(const SizedBox());
      semantics.dispose();
    }
  });
}
