import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

void main() {
  testWidgets('unselected radio has a ring and an empty centre', (
    tester,
  ) async {
    const key = ValueKey('radio-paint');
    for (final selected in [false, true]) {
      await tester.pumpWidget(
        Directionality(
          textDirection: TextDirection.ltr,
          child: Center(
            child: RepaintBoundary(
              key: key,
              child: PosIcon(
                selected
                    ? PosGlyphs.radioButtonChecked
                    : PosGlyphs.radioButtonUnchecked,
                size: 48,
                color: const Color(0xFF17212D),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      final boundary = tester.renderObject<RenderRepaintBoundary>(
        find.byKey(key),
      );
      final pixels = await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 1);
        final bytes = await image.toByteData(
          format: ui.ImageByteFormat.rawRgba,
        );
        image.dispose();
        return bytes!;
      });
      int alpha(int x, int y) => pixels!.getUint8((y * 48 + x) * 4 + 3);
      expect(
        alpha(24, 6),
        greaterThan(0),
        reason: 'Both states retain the radio ring',
      );
      expect(
        alpha(24, 24),
        selected ? greaterThan(0) : equals(0),
        reason: 'Only the selected state fills the centre',
      );
    }
  });
}
