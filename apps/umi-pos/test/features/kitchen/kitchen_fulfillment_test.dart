import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/kitchen/kitchen_fulfillment_badge.dart';

import 'kitchen_board_test.dart' show order, pumpBoard;

KitchenOrderProjection ticket(String? type, {String station = 'Barra'}) =>
    KitchenOrderProjection.fromJson({
      ...order(reference: 'Cuenta 021 · Mesa 3', stationName: station).toJson(),
      'fulfillmentType': type,
    });

void main() {
  for (final station in ['Barra', 'Cocina']) {
    for (final mode in [
      (
        type: 'dine_in',
        label: 'Para comer aquí',
        icon: 'table_restaurant_outlined',
      ),
      (type: 'takeout', label: 'Para llevar', icon: 'shopping_bag_outlined'),
    ]) {
      testWidgets('$station shows ${mode.type} with text and an icon', (
        tester,
      ) async {
        final harness = await pumpBoard(
          tester,
          locale: const Locale('es'),
          orders: [ticket(mode.type, station: station)],
        );
        expect(find.text(mode.label), findsOneWidget);
        expect(
          find.byWidgetPredicate(
            (widget) => widget is PosIcon && widget.icon?.name == mode.icon,
          ),
          findsOneWidget,
        );
        expect(find.text('Cuenta 021 · Mesa 3'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await harness.dispose(tester);
      });
    }
  }

  testWidgets('an older ticket does not infer dine in from its table label', (
    tester,
  ) async {
    final harness = await pumpBoard(
      tester,
      locale: const Locale('es'),
      orders: [ticket(null)],
    );
    expect(find.text('Tipo sin especificar'), findsOneWidget);
    expect(find.text('Para comer aquí'), findsNothing);
    expect(find.text('Para llevar'), findsNothing);
    await harness.dispose(tester);
  });

  testWidgets('a refreshed ticket updates its fulfillment label', (
    tester,
  ) async {
    final harness = await pumpBoard(
      tester,
      locale: const Locale('es'),
      orders: [ticket('dine_in')],
    );
    expect(find.text('Para comer aquí'), findsOneWidget);
    harness.room.orders = [
      KitchenOrderProjection.fromJson({
        ...ticket('takeout').toJson(),
        'version': 2,
      }),
    ];
    await harness.board.refresh();
    await tester.pump();
    expect(find.text('Para llevar'), findsOneWidget);
    expect(find.text('Para comer aquí'), findsNothing);
    await harness.dispose(tester);
  });

  testWidgets('compact cards retain the type at a large text size', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final harness = await pumpBoard(
      tester,
      locale: const Locale('es'),
      textScale: 2,
      orders: [ticket('dine_in')],
    );
    expect(find.text('Para comer aquí'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await harness.dispose(tester);
  });

  testWidgets('the English board uses its own fulfillment labels', (
    tester,
  ) async {
    final harness = await pumpBoard(
      tester,
      locale: const Locale('en'),
      orders: [ticket('takeout')],
    );
    expect(find.text('Takeaway'), findsOneWidget);
    expect(find.text('Para llevar'), findsNothing);
    await harness.dispose(tester);
  });

  for (final appearance in [
    (name: 'light', theme: UmiTheme.light()),
    (name: 'dark', theme: UmiTheme.dark()),
    (name: 'midnight', theme: UmiTheme.midnight()),
  ]) {
    testWidgets(
      '${appearance.name} labels have distinct colors and readable text',
      (tester) async {
        await tester.pumpWidget(
          PosApp(
            theme: appearance.theme,
            locale: const Locale('es'),
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            home: const Center(
              child: Wrap(
                children: [
                  KitchenFulfillmentBadge(fulfillmentType: 'dine_in'),
                  KitchenFulfillmentBadge(fulfillmentType: 'takeout'),
                ],
              ),
            ),
          ),
        );
        final colors = <Color>[];
        for (final label in ['Para comer aquí', 'Para llevar']) {
          final text = find.text(label);
          final color = tester.widget<Text>(text).style!.color!;
          colors.add(color);
          final container = tester.widget<Container>(
            find.ancestor(of: text, matching: find.byType(Container)).first,
          );
          final background = (container.decoration! as BoxDecoration).color!;
          final foregroundLuminance = color.computeLuminance();
          final backgroundLuminance = background.computeLuminance();
          final lighter = foregroundLuminance > backgroundLuminance
              ? foregroundLuminance
              : backgroundLuminance;
          final darker = foregroundLuminance < backgroundLuminance
              ? foregroundLuminance
              : backgroundLuminance;
          expect((lighter + .05) / (darker + .05), greaterThanOrEqualTo(4.5));
        }
        expect(colors.toSet(), hasLength(2));
        expect(tester.takeException(), isNull);
      },
    );
  }
}
