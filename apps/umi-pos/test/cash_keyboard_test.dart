import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/security/operator_permissions.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/features/cash/cash_controller.dart';
import 'package:umi_pos/features/cash/cash_surface.dart';

import 'render/cash_centro_render.dart';

/// A till is operated by a finger on the counter and by a keyboard at the back
/// desk. The finger has the glass under it; the keyboard has only what the screen
/// draws. The repo's own checklist (visual principles, item 6) asks for a focus
/// state that "looks deliberate" and never "relies on colour alone", so these
/// tests read the border the screen resolves for a focused control.
Future<void> _pumpCashCenter(WidgetTester tester) async {
  final controller = CashController(repository: previewRepository('open'));
  controller.setContext(
    merchantId: '00000000-0000-4000-8000-000000000010',
    locationId: '00000000-0000-4000-8000-000000000011',
    operatorSessionId: '00000000-0000-4000-8000-000000000012',
  );
  await controller.load();
  // The till's own viewport. At the default 800 x 600 test surface the movement
  // tiles sit below the fold and a tap on them misses — which once had me
  // believing this screen's dialogs did not take keyboard focus at all.
  tester.view.physicalSize = const Size(1920, 1080);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    PosApp(
      locale: const Locale('es'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,

        GlobalWidgetsLocalizations.delegate,
      ],
      home: PosPage(
        body: CashCenter(
          controller: controller,
          permissions: OperatorPermissions(const [
            'cash.shift.read',
            'cash.movement.paid_in',
            'cash.movement.paid_out',
            'cash.count.submit',
            'cash.shift.suspend',
          ]),
        ),
      ),
    ),
  );
  await tester.pump();
}


bool _hasFocusRing(WidgetTester tester, Finder region) => tester.widgetList<DecoratedBox>(find.descendant(of: region, matching: find.byType(DecoratedBox))).any((widget) {
  final decoration = widget.decoration;
  if (decoration is! BoxDecoration || decoration.border is! Border) return false;
  final side = (decoration.border! as Border).top;
  return side.width >= 2 && side.color.a == 1;
});

void main() {
  testWidgets('keyboard focus draws a ring and keeps control geometry', (tester) async {
    await _pumpCashCenter(tester);
    final tile = find.widgetWithText(PosOutlineButton, 'Entrada de efectivo');
    final before = tester.getRect(tile);
    FocusManager.instance.highlightStrategy = FocusHighlightStrategy.alwaysTraditional;
    var reached = false;
    for (var step = 0; step < 30; step++) {
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      final current = FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<PosOutlineButton>();
      if (identical(current, tester.widget(tile))) { reached = true; break; }
    }
    expect(reached, isTrue, reason: 'Keyboard traversal did not reach the cash action');
    expect(_hasFocusRing(tester, tile), isTrue);
    expect(tester.getRect(tile), before);
    FocusManager.instance.highlightStrategy = FocusHighlightStrategy.automatic;
  });
  testWidgets('a cash dialog contains keyboard focus and an editable amount', (tester) async {
    await _pumpCashCenter(tester);
    await tester.tap(find.widgetWithText(PosOutlineButton, 'Entrada de efectivo'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(PosAlertDialog), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    final focused = FocusManager.instance.primaryFocus?.context;
    expect(focused, isNotNull);
    expect(focused!.findAncestorWidgetOfExactType<PosAlertDialog>(), isNotNull);
    expect(find.descendant(of: find.byType(PosAlertDialog), matching: find.byType(EditableText)), findsWidgets);
  });
}
