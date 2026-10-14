import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/shared/widgets/status_card.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final loader = FontLoader('IBM Plex Sans');
    for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
      loader.addFont(rootBundle.load('assets/fonts/IBMPlexSans-$weight.ttf'));
    }
    await loader.load();
    final headings = FontLoader('Bricolage Grotesque');
    for (final weight in ['SemiBold', 'Bold']) {
      headings.addFont(
        rootBundle.load('assets/fonts/BricolageGrotesque12pt-$weight.ttf'),
      );
    }
    await headings.load();
  });
  for (final locale in ['es', 'en']) {
    final labels = locale == 'es'
        // The owner's order (2026-10-12): the counter's day, and no "Pedidos".
        ? ['Comanda', 'Mesas', 'Cocina', 'Ventas', 'Caja', 'Ajustes']
        : ['Order', 'Tables', 'Kitchen', 'Sales', 'Cash', 'Settings'];
    for (final scale in [1.5, 2.0]) {
      testWidgets('rail keeps complete $locale words at scale $scale', (
        tester,
      ) async {
        tester.view.physicalSize = const Size(1280, 720);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(
          _scaledApp(
            locale: locale,
            scale: scale,
            child: PosPage(
              body: Row(
                children: [
                  PosNavigation(
                    selectedIndex: 0,
                    onDestinationSelected: (_) {},
                    destinations: [
                      for (final label in labels)
                        PosDestination(
                          icon: const PosIcon(PosGlyphs.receiptOutlined),
                          label: label,
                        ),
                    ],
                  ).asRail(),
                  const Expanded(child: SizedBox()),
                ],
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        for (final label in labels) {
          final paragraph = tester.renderObject<RenderParagraph>(
            find.text(label),
          );
          expect(
            paragraph.getBoxesForSelection(
              TextSelection(baseOffset: 0, extentOffset: label.length),
            ),
            hasLength(1),
            reason: label,
          );
        }
        expect(tester.takeException(), isNull);
      });
    }
    testWidgets('empty status keeps complete $locale words at scale 2', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(375, 812);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final title = locale == 'es'
          ? 'No hay pedidos entrantes.'
          : 'No incoming orders.';
      await tester.pumpWidget(
        _scaledApp(
          locale: locale,
          scale: 2,
          child: PosPage(
            body: Padding(
              padding: const EdgeInsets.all(24),
              child: StatusCard(
                icon: PosGlyphs.inventory2Outlined,
                title: title,
                message: locale == 'es'
                    ? 'Los pedidos aparecen aquí.'
                    : 'Orders appear here.',
                action: PosOutlineButton(
                  onPressed: () {},
                  child: Text(locale == 'es' ? 'Actualizar' : 'Refresh'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final paragraph = tester.renderObject<RenderParagraph>(find.text(title));
      var offset = 0;
      for (final word in title.split(' ')) {
        expect(
          paragraph.getBoxesForSelection(
            TextSelection(
              baseOffset: offset,
              extentOffset: offset + word.length,
            ),
          ),
          hasLength(1),
          reason: word,
        );
        offset += word.length + 1;
      }
      final action = find.text(locale == 'es' ? 'Actualizar' : 'Refresh');
      await tester.ensureVisible(action);
      await tester.pumpAndSettle();
      expect(tester.getRect(action).bottom, lessThanOrEqualTo(812));
      expect(tester.takeException(), isNull);
    });
  }
  for (final scale in [1.5, 2.0]) {
    testWidgets('phone navigation keeps complete words at scale $scale', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(375, 812);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        PosApp(
          locale: const Locale('es'),
          theme: UmiTheme.light(),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
          ],
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(scale)),
            child: child!,
          ),
          home: PosPage(
            bottomNavigationBar: PosNavigation(
              selectedIndex: 6,
              onDestinationSelected: (_) {},
              destinations: [
                for (final label in [
                  'Comanda',
                  'Caja',
                  'Ventas',
                  'Mesas',
                  'Cocina',
                  'Pedidos',
                  'Ajustes',
                ])
                  PosDestination(
                    icon: const PosIcon(PosGlyphs.receiptOutlined),
                    label: label,
                  ),
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      for (final label in ['Comanda', 'Caja', 'Ventas', 'Ajustes']) {
        final finder = find.text(label);
        expect(finder, findsOneWidget);
        final paragraph = tester.renderObject<RenderParagraph>(finder);
        final boxes = paragraph.getBoxesForSelection(
          TextSelection(baseOffset: 0, extentOffset: label.length),
        );
        expect(
          boxes,
          hasLength(1),
          reason: '$label must not split across lines',
        );
        expect(tester.getRect(finder).right, lessThanOrEqualTo(375));
      }
      expect(tester.takeException(), isNull);
    });
  }
}

Widget _scaledApp({
  required String locale,
  required double scale,
  required Widget child,
}) => PosApp(
  locale: Locale(locale),
  theme: UmiTheme.light(),
  supportedLocales: AppLocalizations.supportedLocales,
  localizationsDelegates: const [
    AppLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ],
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
    child: child!,
  ),
  home: child,
);
