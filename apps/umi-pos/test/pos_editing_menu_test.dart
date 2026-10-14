import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

void main() {
  testWidgets('primary typography preserves the button foreground', (
    tester,
  ) async {
    await tester.pumpWidget(
      PosApp(
        home: PosPage(
          body: Builder(
            builder: (context) => PosButton(
              onPressed: () {},
              style: PosButton.styleFrom(
                textStyle: PosTheme.of(context).textTheme.titleLarge,
              ),
              child: const Text('Cobrar'),
            ),
          ),
        ),
      ),
    );
    final context = tester.element(find.text('Cobrar'));
    expect(
      DefaultTextStyle.of(context).style.color,
      PosTheme.of(context).colorScheme.onPrimary,
    );
  });

  testWidgets('editing menu fits a narrow enlarged viewport and copies text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 420);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    var clipboard = 'Texto para pegar';
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.getData') return {'text': clipboard};
      if (call.method == 'Clipboard.hasStrings') {
        return {'value': clipboard.isNotEmpty};
      }
      if (call.method == 'Clipboard.setData') {
        clipboard = (call.arguments as Map)['text'] as String;
      }
      return null;
    });
    addTearDown(
      () => messenger.setMockMethodCallHandler(SystemChannels.platform, null),
    );
    final controller = TextEditingController(text: 'Café de piñón');
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      PosApp(
        home: MediaQuery(
          data: MediaQueryData(
            size: const Size(320, 420),
            textScaler: TextScaler.linear(2),
          ),
          child: PosPage(
            body: Center(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: PosField(controller: controller),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.byType(EditableText));
    controller.selection = TextSelection(
      baseOffset: 0,
      extentOffset: controller.text.length,
    );
    await tester.pump();
    final editor = tester.state<EditableTextState>(find.byType(EditableText));
    editor.showToolbar();
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    for (final label in ['Cut', 'Copy', 'Paste']) {
      final rect = tester.getRect(find.widgetWithText(PosTextButton, label));
      expect(rect.left, greaterThanOrEqualTo(0));
      expect(rect.right, lessThanOrEqualTo(320));
      expect(rect.top, greaterThanOrEqualTo(0));
      expect(rect.bottom, lessThanOrEqualTo(420));
      expect(rect.height, greaterThanOrEqualTo(48));
    }
    await tester.tap(find.text('Copy'));
    await tester.pumpAndSettle();
    expect(clipboard, 'Café de piñón');
    expect(controller.text, 'Café de piñón');
  });

  testWidgets('field applies configured borders when focus changes', (
    tester,
  ) async {
    final focus = FocusNode();
    addTearDown(focus.dispose);
    const resting = Color(0xFF225522), active = Color(0xFF553399);
    await tester.pumpWidget(
      PosApp(
        home: PosPage(
          body: Center(
            child: PosField(
              focusNode: focus,
              decoration: const PosFieldDecoration(
                enabledBorder: PosFieldBorder(
                  borderSide: BorderSide(color: resting),
                ),
                focusedBorder: PosFieldBorder(
                  borderSide: BorderSide(color: active, width: 3),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    BoxDecoration box() => tester
        .widgetList<Container>(
          find.descendant(
            of: find.byType(PosField),
            matching: find.byType(Container),
          ),
        )
        .map((w) => w.decoration)
        .whereType<BoxDecoration>()
        .firstWhere((d) => d.border != null);
    expect((box().border as Border).top.color, resting);
    focus.requestFocus();
    await tester.pump();
    expect((box().border as Border).top.color, active);
    expect((box().border as Border).top.width, 3);
  });
}
