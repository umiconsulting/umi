import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

void main() {
  testWidgets('every declared glyph has a drawing and fits its box', (
    tester,
  ) async {
    final source = File('lib/core/theme/pos_icons.dart').readAsStringSync();
    final names = RegExp(
      r"PosGlyph\(\s*'([^']+)'",
      multiLine: true,
    ).allMatches(source).map((m) => m[1]!).toSet().toList()..sort();
    expect(names.length, greaterThan(120));
    tester.view.physicalSize = const Size(1400, 1300);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final boundary = GlobalKey();
    await tester.pumpWidget(
      PosApp(
        home: RepaintBoundary(
          key: boundary,
          child: ColoredBox(
            color: const Color(0xFFFFFFFF),
            child: GridView.count(
              crossAxisCount: 10,
              childAspectRatio: 1.6,
              children: [
                for (final name in names)
                  Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      PosIcon(PosGlyph(name), size: 28),
                      const SizedBox(height: 8),
                      Text(
                        name.replaceAll('_outlined', '').replaceAll('_', ' '),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 10,
                          color: Color(0xFF17212D),
                        ),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ),
      ),
    );
    // Pinta también los elementos fuera de la primera vista.
    for (var i = 0; i < 3; i++) {
      await tester.drag(find.byType(GridView), const Offset(0, -500));
      await tester.pump();
      expect(tester.takeException(), isNull);
    }
    if (Platform.environment['ESTACION_EXPORT_GLYPHS'] == '1') {
      await tester.drag(find.byType(GridView), const Offset(0, 2000));
      await tester.pumpAndSettle();
      final image =
          await (boundary.currentContext!.findRenderObject()!
                  as RenderRepaintBoundary)
              .toImage();
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      File(
        '../../docs/research/2026-10-08-pos-native-estacion/N3-glyph-inventory.png',
      ).writeAsBytesSync(bytes!.buffer.asUint8List());
      image.dispose();
    }
  });
}
