import 'dart:io';

import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/tables/order_table_picker.dart';

// Native widget renders with fixture data. These images are not device captures.
// Run: flutter test test/render/order_table_setup_render.dart --update-goldens
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final body = FontLoader('IBM Plex Sans');
    for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
      body.addFont(rootBundle.load('assets/fonts/IBMPlexSans-$weight.ttf'));
    }
    await body.load();
    final headings = FontLoader('Bricolage Grotesque');
    for (final weight in ['SemiBold', 'Bold']) {
      headings.addFont(
        rootBundle.load('assets/fonts/BricolageGrotesque12pt-$weight.ttf'),
      );
    }
    await headings.load();
    Directory(
      '../../docs/reports/evidence/2026-10-13-seleccion-mesa-mapa',
    ).createSync(recursive: true);
  });

  for (final size in [
    const Size(360, 640),
    const Size(601, 1007),
    const Size(1007, 601),
    const Size(1280, 752),
  ]) {
    final viewport = '${size.width.toInt()}x${size.height.toInt()}';
    testWidgets('table setup widget render Midnight $viewport', (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        RepaintBoundary(
          child: PosApp(
            themeMode: PosThemeMode.midnight,
            midnightTheme: UmiTheme.midnight(),
            locale: const Locale('es'),
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
            ],
            home: Builder(
              builder: (context) => PosPage(
                body: Center(
                  child: PosButton(
                    onPressed: () => showOrderTablePicker(
                      context,
                      areas: const [],
                      createTables: (slots) async => [
                        FloorPlanArea(
                          id: 'fixture-area',
                          name: 'Sala',
                          width: 600,
                          height: 480,
                          elements: [
                            for (var index = 0; index < slots.length; index++)
                              FloorPlanElement(
                                id: 'fixture-table-${index + 1}',
                                kind: 'table',
                                shape: 'square',
                                label: 'Mesa ${index + 1}',
                                capacity: 4,
                                x: 60 + slots[index] % 4 * 120,
                                y: 60 + slots[index] ~/ 4 * 120,
                                width: 80,
                                height: 80,
                                rotation: 0,
                              ).toJson(),
                          ],
                        ),
                      ],
                    ),
                    child: const Text('Elegir mesa'),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Elegir mesa'));
      await tester.pumpAndSettle();
      Future<void> capture(String state) => expectLater(
        find.byType(PosApp),
        matchesGoldenFile(
          '../../../../docs/reports/evidence/2026-10-13-seleccion-mesa-mapa/widget-render-tables-$state-midnight-$viewport.png',
        ),
      );
      await capture('empty');
      await tester.enterText(find.byKey(const ValueKey('table-count')), '3');
      tester.testTextInput.hide();
      await tester.pumpAndSettle();
      await capture('draft');
      await tester.tap(find.text('Guardar mesas'));
      await tester.pumpAndSettle();
      expect(find.text('Elige una mesa'), findsOneWidget);
      await capture('selection');
      expect(tester.takeException(), isNull);
    });
  }
}
