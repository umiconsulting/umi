import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/security/operator_permissions.dart';
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
    MaterialApp(
      locale: const Locale('es'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: Scaffold(
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

/// The theme the screen hands to its own controls and to the dialogs it opens.
///
/// Read from inside the screen's own `AppBar`, which sits below the override —
/// the test's own `Scaffold` is above it and carries the app's untouched theme.
ThemeData _screenTheme(WidgetTester tester) =>
    Theme.of(tester.element(find.byType(AppBar)));

void main() {
  testWidgets(
    'every button style on this screen thickens its border on focus',
    (tester) async {
      await _pumpCashCenter(tester);
      final theme = _screenTheme(tester);
      const focused = {WidgetState.focused};

      final styles = <String, ButtonStyle?>{
        'filled': theme.filledButtonTheme.style,
        'text': theme.textButtonTheme.style,
        'icon': theme.iconButtonTheme.style,
        'outlined': theme.outlinedButtonTheme.style,
      };

      styles.forEach((name, style) {
        final side = style?.side?.resolve(focused);
        expect(
          side?.width,
          2,
          reason: 'the $name button has no ring when it takes focus',
        );
        // A ring that is only a hue change is a ring an operator who cannot see
        // the hue does not have. Two pixels against one is a change in shape.
        expect(side!.color.a, 1.0, reason: 'the $name ring is translucent');
      });
    },
  );

  testWidgets('nothing moves until something has focus', (tester) async {
    await _pumpCashCenter(tester);
    final theme = _screenTheme(tester);

    // Material draws no border on a filled, text or icon button at rest, and the
    // screen must not invent one: a focus state that is always on is not a state.
    expect(theme.filledButtonTheme.style?.side?.resolve({}), BorderSide.none);
    expect(theme.textButtonTheme.style?.side?.resolve({}), BorderSide.none);
    expect(theme.iconButtonTheme.style?.side?.resolve({}), BorderSide.none);

    // The movement tiles keep the hairline they rest with — the ring replaces it
    // rather than adding to it.
    final tile = tester.widget<OutlinedButton>(
      find.widgetWithText(OutlinedButton, 'Entrada de efectivo'),
    );
    expect(tile.style?.side?.resolve({})?.width, 1);
    expect(tile.style?.side?.resolve(const {WidgetState.focused})?.width, 2);
  });

  testWidgets('a dialog opened from this screen keeps the ring and the focus', (
    tester,
  ) async {
    await _pumpCashCenter(tester);
    await tester.tap(
      find.widgetWithText(OutlinedButton, 'Entrada de efectivo'),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    // The modal holds the keyboard: the operator who opened it is inside it, not
    // wandering the screen behind the barrier.
    expect(find.byType(AlertDialog), findsOneWidget);
    final focused = FocusManager.instance.primaryFocus?.context;
    expect(focused, isNotNull);
    expect(
      focused!.findAncestorWidgetOfExactType<AlertDialog>(),
      isNotNull,
      reason: 'focus escaped the dialog to the screen behind it',
    );

    // And the ring travels with it. `showDialog` captures the inherited themes of
    // the context that opens it, which is how a control inside a dialog inherits
    // the treatment this screen gives its own.
    final dialogTheme = Theme.of(tester.element(find.byType(AlertDialog)));
    expect(
      dialogTheme.filledButtonTheme.style?.side?.resolve(const {
        WidgetState.focused,
      })?.width,
      2,
    );
  });

  testWidgets('the ring is drawn against the surface, not against the accent', (
    tester,
  ) async {
    await _pumpCashCenter(tester);
    final theme = _screenTheme(tester);

    // On the brand-blue call to action a blue ring is invisible, so a filled
    // button rings in the surface's own text colour; a control sitting on the
    // surface rings in the accent.
    expect(
      theme.filledButtonTheme.style?.side?.resolve(const {
        WidgetState.focused,
      })?.color,
      theme.colorScheme.onSurface,
    );
    expect(
      theme.textButtonTheme.style?.side?.resolve(const {
        WidgetState.focused,
      })?.color,
      theme.colorScheme.primary,
    );
  });
}
