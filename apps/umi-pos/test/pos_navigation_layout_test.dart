import 'package:flutter/rendering.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';

import 'receipt_document_test.dart' show fonts;

List<String> names(String locale) => locale == 'es'
    // The owner's order (2026-10-12): the counter's day, and no "Pedidos".
    ? ['Comanda', 'Mesas', 'Cocina', 'Ventas', 'Caja', 'Ajustes']
    : ['Order', 'Tables', 'Kitchen', 'Sales', 'Cash', 'Settings'];

Widget app({
  required String locale,
  required double scale,
  required Widget home,
}) => PosApp(
  theme: UmiTheme.light(),
  locale: Locale(locale),
  supportedLocales: AppLocalizations.supportedLocales,
  localizationsDelegates: const [
    AppLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ],
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
    child: child!,
  ),
  home: home,
);

PosNavigation navigation(
  List<String> labels,
  int selected,
  ValueChanged<int> onSelected,
) => PosNavigation(
  selectedIndex: selected,
  onDestinationSelected: onSelected,
  destinations: [
    for (final label in labels)
      PosDestination(
        icon: const PosIcon(PosGlyphs.receiptOutlined),
        label: label,
      ),
  ],
);

void completeLabels(WidgetTester tester) {
  final texts = find.descendant(
    of: find.byType(PosNavigation),
    matching: find.byType(Text),
  );
  for (final element in texts.evaluate()) {
    final text = element.widget as Text;
    final label = text.data!;
    final render = element.findRenderObject()! as RenderParagraph;
    final boxes = render.getBoxesForSelection(
      TextSelection(baseOffset: 0, extentOffset: label.length),
    );
    expect(boxes, hasLength(1), reason: label);
    expect(boxes.single.left, greaterThanOrEqualTo(-1), reason: label);
    expect(
      boxes.single.right,
      lessThanOrEqualTo(render.size.width + 1),
      reason: label,
    );
    expect(render.didExceedMaxLines, isFalse, reason: label);
  }
}

void main() {
  for (final size in [const Size(800, 1340), const Size(1340, 800)]) {
    testWidgets(
      'A11 navigation reserves only the bottom system inset in $size',
      (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 213 / 160;
        addTearDown(tester.view.reset);
        await fonts();
        late StateSetter update;
        var topInset = 0.0;
        await tester.pumpWidget(
          app(
            locale: 'es',
            scale: 1,
            home: StatefulBuilder(
              builder: (context, state) {
                update = state;
                return MediaQuery(
                  data: MediaQuery.of(context).copyWith(
                    padding: EdgeInsets.only(top: topInset, bottom: 48),
                  ),
                  child: PosPage(
                    bottomNavigationBar: navigation(names('es'), 0, (_) {}),
                  ),
                );
              },
            ),
          ),
        );
        await tester.pumpAndSettle();
        final height = tester.getSize(find.byType(PosNavigation)).height;
        update(() => topInset = 30);
        await tester.pumpAndSettle();
        expect(tester.getSize(find.byType(PosNavigation)).height, height);
        completeLabels(tester);
        expect(tester.takeException(), isNull);
      },
    );
  }
  for (final locale in ['es', 'en']) {
    for (final scale in [1.0, 2.0]) {
      for (final size in [
        const Size(375, 812),
        const Size(812, 375),
        const Size(1024, 768),
      ]) {
        testWidgets(
          'navigation keeps complete $locale labels at $scale in $size',
          (tester) async {
            tester.view.physicalSize = size;
            tester.view.devicePixelRatio = 1;
            addTearDown(tester.view.reset);
            await fonts();
            await tester.pumpWidget(
              app(
                locale: locale,
                scale: scale,
                home: PosPage(
                  bottomNavigationBar: navigation(
                    names(locale),
                    names(locale).length - 1,
                    (_) {},
                  ),
                ),
              ),
            );
            await tester.pumpAndSettle();
            completeLabels(tester);
            expect(tester.takeException(), isNull);
          },
        );
      }
    }
  }
  testWidgets('navigation fits local constraints independent of screen width', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1024, 768);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await fonts();
    await tester.pumpWidget(
      app(
        locale: 'es',
        scale: 2,
        home: PosPage(
          body: Align(
            alignment: Alignment.bottomCenter,
            child: SizedBox(
              width: 420,
              child: navigation(names('es'), names('es').length - 1, (_) {}),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    completeLabels(tester);
    expect(tester.getSize(find.byType(PosNavigation)).width, 420);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'four authorized destinations keep complete names and callback indices',
    (tester) async {
      tester.view.physicalSize = const Size(375, 812);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await fonts();
      var selected = 0;
      final labels = ['Comanda', 'Caja', 'Ventas', 'Ajustes'];
      await tester.pumpWidget(
        app(
          locale: 'es',
          scale: 2,
          home: StatefulBuilder(
            builder: (_, update) => PosPage(
              body: Text('Selected: $selected'),
              bottomNavigationBar: navigation(
                labels,
                selected,
                (index) => update(() => selected = index),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      completeLabels(tester);
      for (var index = 0; index < labels.length; index++) {
        final target = find.descendant(
          of: find.byType(PosNavigation),
          matching: find.text(labels[index]),
        );
        await tester.tap(target);
        await tester.pumpAndSettle();
        expect(selected, index);
        expect(find.text('Selected: $index'), findsOneWidget);
        completeLabels(tester);
      }
      expect(find.text('Más'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  for (final locale in ['es', 'en']) {
    testWidgets(
      'overflow keeps selection through expansion and accepts a new keyboard choice in $locale',
      (tester) async {
        tester.view.physicalSize = const Size(812, 375);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await fonts();
        var selected = 0;
        // One more destination than the app ships, so the rail collapses and there
        // is an overflow to exercise: the six the till carries now fit this viewport.
        final labels = [...names(locale), 'Extra'];
        await tester.pumpWidget(
          app(
            locale: locale,
            scale: 2,
            home: StatefulBuilder(
              builder: (_, update) => PosPage(
                body: Text('Selected: $selected'),
                bottomNavigationBar: navigation(
                  labels,
                  selected,
                  (index) => update(() => selected = index),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text(locale == 'es' ? 'Más' : 'More'));
        await tester.pumpAndSettle();
        await tester.tap(find.text(labels[3]));
        await tester.pumpAndSettle();
        expect(selected, 3);
        final more = find.byTooltip(
          '${labels[3]}, ${locale == 'es' ? 'más secciones' : 'more sections'}',
        );
        expect(more, findsOneWidget);
        await tester.tap(more);
        await tester.pumpAndSettle();
        tester.view.physicalSize = const Size(1280, 720);
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('pos-anchored-menu')), findsNothing);
        expect(selected, 3);
        expect(find.text('Selected: 3'), findsOneWidget);
        completeLabels(tester);
        tester.view.physicalSize = const Size(812, 375);
        await tester.pumpAndSettle();
        expect(more, findsOneWidget);
        // Reopen by pointer, then exercise a new choice with real key events.
        // This does not assert focus preservation through the layout change.
        await tester.tap(more);
        await tester.pumpAndSettle();
        await tester.sendKeyEvent(LogicalKeyboardKey.end);
        await tester.sendKeyEvent(LogicalKeyboardKey.enter);
        await tester.pumpAndSettle();
        expect(selected, labels.length - 1);
        expect(find.text('Selected: ${labels.length - 1}'), findsOneWidget);
        completeLabels(tester);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
