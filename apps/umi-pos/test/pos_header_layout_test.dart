import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

void main() {
  testWidgets('header and navigation consume system padding once', (
    tester,
  ) async {
    await tester.pumpWidget(
      PosApp(
        home: MediaQuery(
          data: const MediaQueryData(
            padding: EdgeInsets.only(top: 30, bottom: 48),
          ),
          child: PosPage(
            appBar: const PosHeader(title: Text('Comanda'), toolbarHeight: 56),
            bottomNavigationBar: PosNavigation(
              selectedIndex: 0,
              destinations: const [
                PosDestination(
                  icon: PosIcon(PosGlyphs.receiptOutlined),
                  label: 'Comanda',
                ),
                PosDestination(
                  icon: PosIcon(PosGlyphs.tuneOutlined),
                  label: 'Ajustes',
                ),
              ],
            ),
            body: const SafeArea(
              child: SizedBox.expand(key: ValueKey('canvas')),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      tester.getTopLeft(find.byKey(const ValueKey('canvas'))).dy,
      tester.getBottomLeft(find.byType(PosHeader)).dy,
    );
    expect(
      tester.getBottomLeft(find.byKey(const ValueKey('canvas'))).dy,
      tester.getTopLeft(find.byType(PosNavigation)).dy,
    );
    expect(tester.takeException(), isNull);
  });
  testWidgets('root header stays root after a covered theme change', (
    tester,
  ) async {
    final navigator = GlobalKey<NavigatorState>();
    late StateSetter update;
    var mode = PosThemeMode.light;
    const home = PosPage(
      appBar: PosHeader(title: Text('Comanda')),
      body: SizedBox.shrink(),
    );
    await tester.pumpWidget(
      StatefulBuilder(
        builder: (context, state) {
          update = state;
          return PosApp(navigatorKey: navigator, themeMode: mode, home: home);
        },
      ),
    );
    expect(find.byTooltip('Back'), findsNothing);
    unawaited(
      navigator.currentState!.push(
        PosPageRoute<void>(
          builder: (_) => const PosPage(
            appBar: PosHeader(title: Text('Settings')),
            body: SizedBox.shrink(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byTooltip('Back'), findsOneWidget);
    update(() => mode = PosThemeMode.dark);
    await tester.pumpAndSettle();
    navigator.currentState!.pop();
    await tester.pumpAndSettle();
    expect(find.byTooltip('Back'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  for (final scale in [1.0, 2.0]) {
    testWidgets(
      'compact header keeps title and actions inside the viewport at $scale',
      (tester) async {
        tester.view.physicalSize = const Size(375, 812);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(
          PosApp(
            home: MediaQuery(
              data: MediaQueryData(
                size: const Size(375, 812),
                textScaler: TextScaler.linear(scale),
              ),
              child: PosPage(
                appBar: PosHeader(
                  leading: PosIconButton(
                    tooltip: 'Atrás',
                    icon: const PosIcon(PosGlyphs.arrowBack),
                    onPressed: () {},
                  ),
                  title: const Text('Mesas de la sucursal principal'),
                  actions: [
                    const PosTag(label: Text('12 mesas')),
                    const PosTag(label: Text('En línea')),
                    PosIconButton(
                      tooltip: 'Actualizar',
                      icon: const PosIcon(PosGlyphs.refresh),
                      onPressed: () {},
                    ),
                    PosIconButton(
                      tooltip: 'Cuenta',
                      icon: const PosIcon(PosGlyphs.personOutline),
                      onPressed: () {},
                    ),
                  ],
                ),
                body: const Center(child: Text('Plano')),
              ),
            ),
          ),
        );
        await tester.pump();
        expect(tester.takeException(), isNull);
        for (final label in ['Atrás', 'Actualizar', 'Cuenta']) {
          final rect = tester.getRect(find.byTooltip(label));
          expect(rect.left, greaterThanOrEqualTo(0));
          expect(rect.right, lessThanOrEqualTo(375));
          expect(rect.width, greaterThanOrEqualTo(48));
          expect(rect.height, greaterThanOrEqualTo(48));
        }
        expect(
          tester.getRect(find.text('Plano')).top,
          greaterThan(tester.getRect(find.byType(PosHeader)).bottom),
        );
      },
    );
  }
}
