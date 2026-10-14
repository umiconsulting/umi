import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

void main() {
  testWidgets('touch on field padding opens the Android keyboard', (
    tester,
  ) async {
    final focus = FocusNode();
    addTearDown(focus.dispose);
    await tester.pumpWidget(
      PosApp(
        home: PosPage(
          body: Center(
            child: SizedBox(width: 432, child: PosField(focusNode: focus)),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final editor = tester.getRect(find.byType(EditableText));
    await tester.tapAt(Offset(editor.center.dx, editor.bottom + 8));
    await tester.pump();
    expect(focus.hasFocus, isTrue);
    expect(tester.testTextInput.isVisible, isTrue);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('touch opens the keyboard for an empty Android field', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    final controller = TextEditingController();
    final focus = FocusNode();
    addTearDown(controller.dispose);
    addTearDown(focus.dispose);
    await tester.pumpWidget(
      PosApp(
        home: PosPage(
          body: Center(
            child: SizedBox(
              width: 432,
              child: PosField(
                controller: controller,
                focusNode: focus,
                decoration: const PosFieldDecoration(labelText: 'Registro'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byType(EditableText));
    await tester.pump();
    expect(focus.hasFocus, isTrue);
    expect(tester.testTextInput.isVisible, isTrue);
    tester.testTextInput.enterText('ABCDEFGH');
    await tester.pump();
    expect(controller.text, 'ABCDEFGH');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('disabled input ignores a touch on its padding', (tester) async {
    final focus = FocusNode();
    addTearDown(focus.dispose);
    await tester.pumpWidget(
      PosApp(
        home: PosPage(
          body: Center(
            child: SizedBox(
              width: 432,
              child: PosField(focusNode: focus, enabled: false),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final editor = tester.getRect(find.byType(EditableText));
    await tester.tapAt(Offset(editor.center.dx, editor.bottom + 8));
    await tester.pump();
    expect(focus.hasFocus, isFalse);
    expect(tester.testTextInput.isVisible, isFalse);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('field callback runs once for text and padding touches', (
    tester,
  ) async {
    var taps = 0;
    await tester.pumpWidget(
      PosApp(
        home: PosPage(
          body: Center(
            child: SizedBox(
              width: 432,
              child: PosField(readOnly: true, onTap: () => taps++),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final editor = tester.getRect(find.byType(EditableText));
    await tester.tapAt(Offset(editor.center.dx, editor.bottom + 8));
    await tester.pump();
    expect(taps, 1);
    await tester.tap(find.byType(EditableText));
    await tester.pump();
    expect(taps, 2);
    expect(tester.testTextInput.isVisible, isFalse);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
