import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import 'kitchen_board_test.dart'
    show itemJson, itemLatte, itemToast, order, pumpBoard;

void main() {
  setUpAll(() async {
    final body = FontLoader('IBM Plex Sans');
    for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
      body.addFont(rootBundle.load('assets/fonts/IBMPlexSans-$weight.ttf'));
    }
    await body.load();
    final heading = FontLoader('Bricolage Grotesque');
    for (final weight in ['SemiBold', 'Bold']) {
      heading.addFont(
        rootBundle.load('assets/fonts/BricolageGrotesque12pt-$weight.ttf'),
      );
    }
    await heading.load();
  });

  testWidgets('KDS opens on commands and retains station/day filters', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1096, 752);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final harness = await pumpBoard(
      tester,
      locale: const Locale('es'),
      orders: [
        order(
          reference: 'Cuenta actual',
          station: 'barra',
          stationName: 'Barra',
          items: [itemJson(itemLatte, 'Café actual')],
        ),
        order(
          reference: 'Cuenta anterior',
          station: 'cocina',
          stationName: 'Cocina',
          businessDate: '2026-09-15',
          items: [itemJson(itemToast, 'Pizza anterior')],
        ),
      ],
    );
    final filters = find.byKey(const ValueKey('kitchen-filters'));
    Finder control(String label) => find
        .ancestor(
          of: find.descendant(
            of: filters,
            matching: find.textContaining(label).first,
          ),
          matching: find.byType(PosTapRegion),
        )
        .first;

    expect(find.text('Café actual'), findsOneWidget);
    expect(find.text('Pizza anterior'), findsNothing);
    expect(find.text('Preparación'), findsNothing);
    expect(find.byKey(const ValueKey('kitchen-view-select')), findsNothing);
    expect(find.text('Hoy (1)'), findsOneWidget);
    expect(find.text('Anteriores (1)'), findsOneWidget);
    expect(find.text('Todos (2)'), findsOneWidget);
    await tester.tap(control('Anteriores'));
    await tester.pump();
    expect(find.text('Pizza anterior'), findsOneWidget);
    expect(find.text('Café actual'), findsNothing);
    expect(harness.room.prepListReads, 0);
    expect(tester.takeException(), isNull);
    await harness.dispose(tester);
  });

  testWidgets('station filter remains fixed when its result is empty', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(520, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final harness = await pumpBoard(
      tester,
      locale: const Locale('es'),
      kitchenStations: const [
        KitchenStation(id: 'barra', key: 'barra', name: 'Barra', sortOrder: 0),
        KitchenStation(
          id: 'cocina',
          key: 'cocina',
          name: 'Cocina',
          sortOrder: 1,
        ),
      ],
      orders: [
        for (var index = 0; index < 4; index++)
          order(
            reference: 'Cuenta $index',
            station: 'barra',
            stationName: 'Barra',
            businessDate: index == 0 ? '2026-09-15' : '2026-09-16',
          ),
      ],
    );
    final filters = find.byKey(const ValueKey('kitchen-filters'));
    Finder control(Finder text) => find
        .ancestor(
          of: find.descendant(of: filters, matching: text).first,
          matching: find.byType(PosTapRegion),
        )
        .first;
    final initial = tester.getRect(control(find.text('Cocina')));
    await tester.tap(control(find.text('Cocina')));
    await tester.pump();
    expect(find.text('Cuenta 1'), findsNothing);
    expect(tester.getRect(control(find.text('Cocina'))), initial);
    expect(find.text('Hoy (0)'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await harness.dispose(tester);
  });

  testWidgets('compact KDS keeps both filters and removes only the view tab', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final harness = await pumpBoard(
      tester,
      locale: const Locale('es'),
      textScale: 2,
      orders: [
        order(
          reference: 'Cuenta actual',
          stationName: 'Barra',
          items: [itemJson(itemLatte, 'Latte')],
        ),
        order(
          reference: 'Cuenta anterior',
          station: 'cocina',
          stationName: 'Cocina',
          businessDate: '2026-09-15',
          items: [itemJson(itemToast, 'Pizza')],
        ),
      ],
    );

    expect(find.text('Latte'), findsOneWidget);
    expect(find.text('Pizza'), findsNothing);
    expect(find.byKey(const ValueKey('kitchen-filters')), findsOneWidget);
    expect(find.byKey(const ValueKey('kitchen-view-select')), findsNothing);
    expect(find.text('Preparación'), findsNothing);
    await tester.ensureVisible(find.text('Anteriores (1)'));
    await tester.pump();
    await tester.tap(find.text('Anteriores (1)'));
    await tester.pump();
    expect(find.text('Pizza'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await harness.dispose(tester);
  });
}
