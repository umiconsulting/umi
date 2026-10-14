import 'dart:io';

import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/shared/widgets/station_document.dart';

/// Renders the two places the station signs its own name, so a human can judge
/// them after the owner asked for a quieter entry (2026-10-11).
///
/// This file is deliberately **not** named `*_test.dart`: it writes PNGs, which
/// a CI suite must not do on its own. Run it by name:
///
///   flutter test test/render/entry_brand_render.dart --update-goldens
///
/// The images land in `test/render/shots/`.
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
  });

  testWidgets('login cover', (tester) async {
    tester.view.physicalSize = const Size(620, 1080);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      RepaintBoundary(
        child: PosApp(
          theme: UmiTheme.light(),
          locale: const Locale('es'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
          ],
          home: const PosPage(body: StationEntryCover()),
        ),
      ),
    );
    await tester.pump();
    Directory('test/render/shots').createSync(recursive: true);
    await expectLater(
      find.byType(PosApp),
      matchesGoldenFile('shots/entry-cover-620x1080.png'),
    );
  });

  testWidgets('navigation rail', (tester) async {
    tester.view.physicalSize = const Size(1920, 1080);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      RepaintBoundary(
        child: PosApp(
          theme: UmiTheme.light(),
          locale: const Locale('es'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
          ],
          home: PosPage(
            body: const SizedBox.shrink(),
            bottomNavigationBar: PosNavigation(
              destinations: const [
                PosDestination(
                  icon: PosIcon(PosGlyphs.receiptLongOutlined),
                  label: 'Comanda',
                ),
                PosDestination(
                  icon: PosIcon(PosGlyphs.paymentsOutlined),
                  label: 'Caja',
                ),
                PosDestination(
                  icon: PosIcon(PosGlyphs.tuneOutlined),
                  label: 'Ajustes',
                ),
              ],
              onDestinationSelected: (_) {},
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    Directory('test/render/shots').createSync(recursive: true);
    await expectLater(
      find.byType(PosApp),
      matchesGoldenFile('shots/entry-rail-1920x1080.png'),
    );
  });
}
