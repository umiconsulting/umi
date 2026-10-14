import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

void main() {
  for (final reverse in [false, true]) {
    testWidgets(
      'modal keeps ${reverse ? 'backward' : 'forward'} traversal and restores its source',
      (tester) async {
        final source = FocusNode();
        final first = FocusNode();
        final last = FocusNode();
        addTearDown(source.dispose);
        addTearDown(first.dispose);
        addTearDown(last.dispose);
        var actions = 0;
        await tester.pumpWidget(
          PosApp(
            home: Builder(
              builder: (context) => PosPage(
                body: PosButton(
                  focusNode: source,
                  autofocus: true,
                  onPressed: () => showPosDialog<void>(
                    context: context,
                    builder: (dialogContext) => PosAlertDialog(
                      title: const Text('Documento'),
                      content: const Text('Contenido del documento'),
                      actions: [
                        PosButton(
                          focusNode: first,
                          autofocus: true,
                          onPressed: () => actions++,
                          child: const Text('Acción'),
                        ),
                        PosTextButton(
                          focusNode: last,
                          onPressed: () => Navigator.pop(dialogContext),
                          child: const Text('Cerrar'),
                        ),
                      ],
                    ),
                  ),
                  child: const Text('Abrir'),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.sendKeyEvent(LogicalKeyboardKey.enter);
        await tester.pumpAndSettle();
        expect(first.hasFocus, isTrue);
        if (reverse) {
          await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
        }
        await tester.sendKeyEvent(LogicalKeyboardKey.tab);
        await tester.pumpAndSettle();
        expect(last.hasFocus, isTrue);
        await tester.sendKeyEvent(LogicalKeyboardKey.tab);
        await tester.pumpAndSettle();
        expect(first.hasFocus, isTrue);
        expect(source.hasFocus, isFalse);
        if (reverse) await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
        expect(actions, 0);
        await tester.sendKeyEvent(LogicalKeyboardKey.escape);
        await tester.pumpAndSettle();
        expect(find.byType(PosAlertDialog), findsNothing);
        expect(source.hasFocus, isTrue);
        expect(actions, 0);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }
}
