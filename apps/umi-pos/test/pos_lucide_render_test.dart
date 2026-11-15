import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

void main() {
  testWidgets('every live glyph renders ink inside its declared box', (
    tester,
  ) async {
    final names = <String>{};
    for (final file in Directory(
      'lib',
    ).listSync(recursive: true).whereType<File>()) {
      if (!file.path.endsWith('.dart')) continue;
      final source = file.readAsStringSync();
      names.addAll(
        RegExp(r"PosGlyph\(\s*'([^']+)'").allMatches(source).map((m) => m[1]!),
      );
      // The rail chooses between these literals at runtime.
      names.addAll(
        RegExp(r"'(nav_[a-z-]+)'").allMatches(source).map((m) => m[1]!),
      );
    }
    expect(names.length, greaterThan(140));
    final ordered = names.toList()..sort();
    final boundary = GlobalKey();
    tester.view.physicalSize = const Size(960, 960);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: Align(
          alignment: Alignment.topLeft,
          child: RepaintBoundary(
            key: boundary,
            child: SizedBox(
              width: 960,
              child: Wrap(
                children: [
                  for (final name in ordered)
                    SizedBox(
                      width: 48,
                      height: 48,
                      child: Center(
                        child: PosIcon(
                          PosGlyph(name),
                          size: 28,
                          color: const Color(0xFF173859),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    final render =
        boundary.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final pixels = await tester.runAsync(() async {
      final image = await render.toImage(pixelRatio: 1);
      final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
      image.dispose();
      return data!;
    });
    for (var i = 0; i < ordered.length; i++) {
      final left = (i % 20) * 48, top = (i ~/ 20) * 48;
      var ink = 0;
      for (var y = 0; y < 48; y++) {
        for (var x = 0; x < 48; x++) {
          final alpha = pixels!.getUint8(((top + y) * 960 + left + x) * 4 + 3);
          if (alpha == 0) continue;
          ink++;
          expect(
            x >= 10 && x < 38 && y >= 10 && y < 38,
            isTrue,
            reason: '${ordered[i]} paints beyond its 28px box',
          );
        }
      }
      expect(
        ink,
        greaterThan(10),
        reason: '${ordered[i]} must not silently render blank',
      );
    }
  });

  testWidgets(
    'icon keeps theme size, tint, explicit stroke, semantics and null spacing',
    (tester) async {
      final semantics = tester.ensureSemantics();
      final inkCounts = <int>[];
      try {
        for (final stroke in [1.0, 3.0]) {
          final boundary = GlobalKey();
          await tester.pumpWidget(
            Directionality(
              textDirection: TextDirection.ltr,
              child: IconTheme(
                data: const IconThemeData(size: 32, color: Color(0xFFAA3300)),
                child: Row(
                  children: [
                    RepaintBoundary(
                      key: boundary,
                      child: PosIcon(
                        PosGlyphs.printOutlined,
                        semanticLabel: 'Print receipt',
                        strokeWidth: stroke,
                      ),
                    ),
                    const PosIcon(null, key: ValueKey('empty-icon')),
                  ],
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(find.bySemanticsLabel('Print receipt'), findsOneWidget);
          expect(
            tester.getSize(find.byType(PosIcon).first),
            const Size(32, 32),
          );
          expect(
            tester.getSize(find.byKey(const ValueKey('empty-icon'))),
            const Size(32, 32),
          );
          final render =
              boundary.currentContext!.findRenderObject()!
                  as RenderRepaintBoundary;
          final pixels = await tester.runAsync(() async {
            final image = await render.toImage(pixelRatio: 1);
            final data = await image.toByteData(
              format: ui.ImageByteFormat.rawRgba,
            );
            image.dispose();
            return data!;
          });
          var ink = 0;
          for (var i = 0; i < pixels!.lengthInBytes; i += 4) {
            if (pixels.getUint8(i + 3) != 255) continue;
            ink++;
            expect(
              [
                pixels.getUint8(i),
                pixels.getUint8(i + 1),
                pixels.getUint8(i + 2),
              ],
              [170, 51, 0],
            );
          }
          inkCounts.add(ink);
          expect(tester.takeException(), isNull);
        }
        expect(inkCounts.last, greaterThan(inkCounts.first));
      } finally {
        semantics.dispose();
      }
    },
  );
}
