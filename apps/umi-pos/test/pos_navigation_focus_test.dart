import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import 'pos_navigation_layout_test.dart' show app, names;
import 'receipt_document_test.dart' show fonts;

Finder destination(String label) =>
    find.descendant(of: find.byType(PosNavigation), matching: find.text(label));

bool focused(WidgetTester tester, String label) =>
    Focus.of(tester.element(destination(label))).hasPrimaryFocus;

void main() {
  for (final locale in ['es', 'en']) {
    for (final width in [1024.0, 1280.0]) {
      testWidgets(
        'menu returns focus to its destination without selecting in $locale at $width',
        (tester) async {
          tester.view.physicalSize = const Size(812, 375);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          await fonts();
          // ONE MORE DESTINATION THAN THE APP SHIPS. The rail carries six now, and
          // on this viewport the short English words fit without collapsing — the
          // behaviour under test is the overflow menu's focus recovery, so the
          // fixture has to overflow by construction.
          final labels = [...names(locale), 'Extra'];
          // The rail lost "Pedidos" and the owner reordered it (2026-10-12), so the
          // last destination — the one whose menu this test drives — moved.
          final last = labels.length - 1;
          var selected = last;
          var choices = 0;
          await tester.pumpWidget(
            app(
              locale: locale,
              scale: 2,
              home: StatefulBuilder(
                builder: (_, update) => PosPage(
                  body: Text('Selected: $selected'),
                  bottomNavigationBar: PosNavigation(
                    selectedIndex: selected,
                    onDestinationSelected: (index) => update(() {
                      selected = index;
                      choices++;
                    }),
                    destinations: [
                      for (var i = 0; i < labels.length; i++)
                        PosDestination(
                          key: ValueKey(i),
                          icon: const PosIcon(PosGlyphs.receiptOutlined),
                          label: labels[i],
                        ),
                    ],
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          await tester.tap(
            find.byTooltip(
              '${labels[last]}, ${locale == 'es' ? 'más secciones' : 'more sections'}',
            ),
          );
          await tester.pumpAndSettle();
          // The focused menu option differs from the selected page.
          await tester.sendKeyEvent(LogicalKeyboardKey.home);
          await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
          await tester.pumpAndSettle();
          tester.view.physicalSize = Size(width, 768);
          await tester.pumpAndSettle();
          expect(find.byKey(const ValueKey('pos-anchored-menu')), findsNothing);
          expect(selected, last);
          expect(choices, 0, reason: 'focus recovery must not activate a page');
          expect(focused(tester, labels[4]), isTrue);
          await tester.sendKeyEvent(LogicalKeyboardKey.enter);
          await tester.pumpAndSettle();
          expect(selected, 4);
          expect(choices, 1);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }

  testWidgets('direct destination keeps focus when rows and rail change', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await fonts();
    await tester.pumpWidget(
      app(
        locale: 'es',
        scale: 2,
        home: PosPage(
          bottomNavigationBar: PosNavigation(
            onDestinationSelected: (_) {},
            destinations: [
              for (final label in names('es'))
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
    // A destination the collapsed rail still shows: the first three are on screen,
    // and the rest live behind "más secciones". It used to be "Ventas", which the
    // owner's new order pushed into the menu (2026-10-12).
    final visible = names('es')[2];
    Focus.of(tester.element(destination(visible))).requestFocus();
    await tester.pumpAndSettle();
    expect(focused(tester, visible), isTrue);
    for (final size in [
      const Size(812, 375),
      const Size(1280, 720),
      const Size(375, 812),
    ]) {
      tester.view.physicalSize = size;
      await tester.pumpAndSettle();
      expect(focused(tester, visible), isTrue, reason: '$size');
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('navigation does not steal an editor focus during resize', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(812, 375);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await fonts();
    final node = FocusNode();
    addTearDown(node.dispose);
    await tester.pumpWidget(
      app(
        locale: 'es',
        scale: 2,
        home: PosPage(
          body: PosField(focusNode: node),
          bottomNavigationBar: PosNavigation(
            selectedIndex: names('es').length - 1,
            onDestinationSelected: (_) {},
            destinations: [
              for (final label in names('es'))
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
    node.requestFocus();
    await tester.pumpAndSettle();
    for (final size in [const Size(1280, 720), const Size(375, 812)]) {
      tester.view.physicalSize = size;
      await tester.pumpAndSettle();
      expect(node.hasPrimaryFocus, isTrue);
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('a focused secondary identity survives a collapsed round trip', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1280, 768);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await fonts();
    await tester.pumpWidget(
      app(
        locale: 'es',
        scale: 2,
        home: PosPage(
          bottomNavigationBar: PosNavigation(
            selectedIndex: 0,
            onDestinationSelected: (_) {},
            destinations: [
              for (final label in names('es'))
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
    Focus.of(tester.element(destination('Ajustes'))).requestFocus();
    await tester.pumpAndSettle();
    tester.view.physicalSize = const Size(375, 812);
    await tester.pumpAndSettle();
    expect(focused(tester, 'Más'), isTrue);
    tester.view.physicalSize = const Size(1280, 768);
    await tester.pumpAndSettle();
    expect(focused(tester, 'Ajustes'), isTrue);
    expect(
      tester.widget<PosNavigation>(find.byType(PosNavigation)).selectedIndex,
      0,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('local expansion dismisses its menu and restores focus', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1280, 768);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await fonts();
    var width = 420.0;
    late StateSetter update;
    await tester.pumpWidget(
      app(
        locale: 'es',
        scale: 2,
        home: StatefulBuilder(
          builder: (_, set) {
            update = set;
            return PosPage(
              body: Align(
                alignment: Alignment.bottomCenter,
                child: SizedBox(
                  width: width,
                  child: PosNavigation(
                    selectedIndex: names('es').length - 1,
                    onDestinationSelected: (_) {},
                    destinations: [
                      for (final label in names('es'))
                        PosDestination(
                          icon: const PosIcon(PosGlyphs.receiptOutlined),
                          label: label,
                        ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    // The rail's own "more" button, found by what it is rather than by the words
    // its tooltip happens to carry: fewer destinations fit the rail now, so which
    // label it announces depends on the order the owner set.
    await tester.tap(
      find.descendant(
        of: find.byType(PosNavigation),
        matching: find.byType(PosMenuButton<Object>),
      ),
    );
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();
    update(() => width = 1200);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('pos-anchored-menu')), findsNothing);
    expect(focused(tester, 'Ajustes'), isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('removed menu identity closes without choosing another page', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(812, 375);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await fonts();
    // One more than the app ships, so the fixture overflows and the menu exists at
    // all: the rail carries six now and these labels fit without collapsing.
    final labels = [...names('es'), 'Extra'];
    var allowed = [0, 1, 2, 3, 4, 5, 6];
    var choices = 0;
    late StateSetter update;
    await tester.pumpWidget(
      app(
        locale: 'es',
        scale: 2,
        home: StatefulBuilder(
          builder: (_, set) {
            update = set;
            return PosPage(
              bottomNavigationBar: PosNavigation(
                selectedIndex: allowed.indexOf(6),
                onDestinationSelected: (_) => choices++,
                destinations: [
                  for (final id in allowed)
                    PosDestination(
                      key: ValueKey(id),
                      icon: const PosIcon(PosGlyphs.receiptOutlined),
                      label: labels[id],
                    ),
                ],
              ),
            );
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('${labels[6]}, más secciones'));
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pumpAndSettle();
    update(() => allowed = [0, 1, 2, 3, 4, 6]);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('pos-anchored-menu')), findsNothing);
    expect(choices, 0);
    // Focus comes back to the destination the menu belonged to — the one the
    // collapsed rail names on its "more" button.
    expect(focused(tester, labels[6]), isTrue);
    expect(find.text('Pedidos'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
