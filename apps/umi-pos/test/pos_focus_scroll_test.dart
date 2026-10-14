import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

void main() {
  testWidgets('focusing a scrolled action reveals it without activating it', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(375, 375);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final focus = FocusNode();
    final scroll = ScrollController();
    var activations = 0;
    try {
      await tester.pumpWidget(
        PosApp(
          home: PosPage(
            body: SingleChildScrollView(
              controller: scroll,
              child: Column(
                children: [
                  const SizedBox(height: 900),
                  PosButton(
                    focusNode: focus,
                    onPressed: () => activations++,
                    child: const Text('Cobrar'),
                  ),
                  const SizedBox(height: 400),
                ],
              ),
            ),
          ),
        ),
      );
      expect(find.text('Cobrar').hitTestable(), findsNothing);
      focus.requestFocus();
      await tester.pumpAndSettle();
      expect(find.text('Cobrar').hitTestable(), findsOneWidget);
      final rect = tester.getRect(find.byType(PosButton));
      expect(rect.top, greaterThanOrEqualTo(0));
      expect(rect.bottom, lessThanOrEqualTo(375));
      expect(activations, 0);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(activations, 1);
      expect(tester.takeException(), isNull);
    } finally {
      await tester.pumpWidget(const SizedBox());
      focus.dispose();
      scroll.dispose();
    }
  });
}
