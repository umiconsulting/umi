import 'dart:ui' show PointerDeviceKind;
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

void main() {
  testWidgets('icon styles follow pointer and disabled states', (tester) async {
    var enabled = true, taps = 0;
    late StateSetter update;
    const resting = Color(0xFF112233),
        hovered = Color(0xFF223344),
        disabled = Color(0xFF556677);
    await tester.pumpWidget(
      PosApp(
        home: StatefulBuilder(
          builder: (_, state) {
            update = state;
            return PosPage(
              body: Center(
                child: PosIconButton(
                  tooltip: 'Actualizar',
                  onPressed: enabled ? () => taps++ : null,
                  style: PosButtonStyle(
                    backgroundColor: WidgetStateProperty.resolveWith(
                      (s) => s.contains(WidgetState.disabled)
                          ? disabled
                          : s.contains(WidgetState.hovered)
                          ? hovered
                          : resting,
                    ),
                  ),
                  icon: const PosIcon(PosGlyphs.refresh),
                ),
              ),
            );
          },
        ),
      ),
    );
    Color? fill() {
      final decoration = tester
          .widget<DecoratedBox>(
            find
                .descendant(
                  of: find.byType(PosIconButton),
                  matching: find.byType(DecoratedBox),
                )
                .first,
          )
          .decoration;
      return decoration is ShapeDecoration ? decoration.color : null;
    }

    expect(fill(), resting);
    final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await mouse.addPointer(location: Offset.zero);
    await mouse.moveTo(tester.getCenter(find.byType(PosIconButton)));
    await tester.pump();
    expect(fill(), hovered);
    await tester.tap(find.byType(PosIconButton));
    await tester.pump();
    expect(taps, 1);
    update(() => enabled = false);
    await tester.pump();
    expect(fill(), disabled);
    await tester.tap(find.byType(PosIconButton));
    await tester.pump();
    expect(taps, 1);
    await mouse.removePointer();
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('button styles follow actual pointer, focus and enabled states', (
    tester,
  ) async {
    final node = FocusNode();
    addTearDown(node.dispose);
    var enabled = true, selected = false, taps = 0;
    late StateSetter update;
    const resting = Color(0xFF112233),
        hovered = Color(0xFF223344),
        focused = Color(0xFF334455),
        pressed = Color(0xFF445566),
        disabled = Color(0xFF556677),
        chosen = Color(0xFF667788);
    Color resolve(Set<WidgetState> states) {
      if (states.contains(WidgetState.disabled)) return disabled;
      if (states.contains(WidgetState.pressed)) return pressed;
      if (states.contains(WidgetState.selected)) return chosen;
      if (states.contains(WidgetState.focused)) return focused;
      if (states.contains(WidgetState.hovered)) return hovered;
      return resting;
    }

    await tester.pumpWidget(
      PosApp(
        home: StatefulBuilder(
          builder: (context, setState) {
            update = setState;
            return PosPage(
              body: Center(
                child: PosButton(
                  focusNode: node,
                  selected: selected,
                  onPressed: enabled ? () => taps++ : null,
                  style: PosButtonStyle(
                    backgroundColor: WidgetStateProperty.resolveWith(resolve),
                  ),
                  child: const Text('Cobrar'),
                ),
              ),
            );
          },
        ),
      ),
    );
    Color? fill() =>
        (tester
                    .widget<DecoratedBox>(
                      find
                          .descendant(
                            of: find.byType(PosButton),
                            matching: find.byType(DecoratedBox),
                          )
                          .first,
                    )
                    .decoration
                as ShapeDecoration)
            .color;
    expect(fill(), resting);
    final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await mouse.addPointer(location: Offset.zero);
    await mouse.moveTo(tester.getCenter(find.text('Cobrar')));
    await tester.pump();
    expect(fill(), hovered);
    await mouse.down(tester.getCenter(find.text('Cobrar')));
    await tester.pump(const Duration(milliseconds: 120));
    expect(fill(), pressed);
    await mouse.up();
    await tester.pump();
    expect(taps, 1);
    await mouse.moveTo(Offset.zero);
    await tester.pump();
    node.requestFocus();
    await tester.pump();
    expect(node.hasFocus, isTrue);
    // FocusManager commits the focus change after the first frame.
    await tester.pump();
    expect(fill(), focused);
    update(() => selected = true);
    await tester.pump();
    expect(fill(), chosen);
    update(() => enabled = false);
    await tester.pump();
    expect(fill(), disabled);
    await tester.tap(find.text('Cobrar'));
    await tester.pump();
    expect(taps, 1);
    expect(tester.takeException(), isNull);
    await mouse.removePointer();
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('selected styleFrom colors apply and yield to disabled colors', (
    tester,
  ) async {
    var enabled = true;
    late StateSetter update;
    const chosen = Color(0xFF223344), disabled = Color(0xFF556677);
    await tester.pumpWidget(
      PosApp(
        home: StatefulBuilder(
          builder: (_, setState) {
            update = setState;
            return PosPage(
              body: Center(
                child: PosButton(
                  selected: true,
                  onPressed: enabled ? () {} : null,
                  style: PosButton.styleFrom(
                    selectedBackgroundColor: chosen,
                    disabledBackgroundColor: disabled,
                  ),
                  child: const Text('Seleccionado'),
                ),
              ),
            );
          },
        ),
      ),
    );
    Color? fill() =>
        (tester
                    .widget<DecoratedBox>(
                      find
                          .descendant(
                            of: find.byType(PosButton),
                            matching: find.byType(DecoratedBox),
                          )
                          .first,
                    )
                    .decoration
                as ShapeDecoration)
            .color;
    expect(fill(), chosen);
    update(() => enabled = false);
    await tester.pump();
    expect(fill(), disabled);
    expect(tester.takeException(), isNull);
  });
}
