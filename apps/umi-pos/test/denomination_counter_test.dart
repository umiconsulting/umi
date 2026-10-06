import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/features/cash/denomination_counter.dart';

/// The drawer counter is read with a finger on a terminal and with a keyboard on
/// a desk. These tests pin the half that has no buttons: typing.
Future<void> _pump(
  WidgetTester tester,
  ValueChanged<DenominationTally> onChanged, {
  List<int> denominations = const [100000, 50000, 20000],
}) => tester.pumpWidget(
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
      body: SingleChildScrollView(
        child: DenominationCounter(
          currency: 'MXN',
          denominations: denominations,
          onChanged: onChanged,
        ),
      ),
    ),
  ),
);

void main() {
  testWidgets('typing a quantity feeds the tally and the line total', (
    tester,
  ) async {
    DenominationTally? tally;
    await _pump(tester, (value) => tally = value);

    await tester.enterText(find.byType(TextField).first, '12');
    await tester.pump();

    expect(tally?.totalMinorUnits, 1200000);
    expect(tally?.lines.single['quantity'], 12);
    expect(tally?.lines.single['lineTotal'], {
      'minorUnits': 1200000,
      'currency': 'MXN',
    });
    // The row states what the quantity is worth, in the same money format the
    // rest of the screen uses, and the running total agrees with it.
    expect(find.text('= MXN 12,000.00'), findsOneWidget);
    expect(find.text('MXN 12,000.00'), findsOneWidget);
  });

  testWidgets('the field takes digits only, and never four of them', (
    tester,
  ) async {
    DenominationTally? tally;
    await _pump(tester, (value) => tally = value);
    final field = find.byType(TextField).first;

    await tester.enterText(field, '1a2');
    await tester.pump();
    expect(tester.widget<TextField>(field).controller?.text, '12');

    await tester.enterText(field, '12345');
    await tester.pump();
    // A drawer with twelve thousand of one note is a typo, not a count.
    expect(tester.widget<TextField>(field).controller?.text, '123');
    expect(tally?.totalMinorUnits, 12300000);
  });

  testWidgets('the buttons write the number into the field', (tester) async {
    DenominationTally? tally;
    await _pump(tester, (value) => tally = value);
    final field = find.byType(TextField).first;

    await tester.tap(find.byTooltip('Aumentar cantidad').first);
    await tester.pump();
    expect(tester.widget<TextField>(field).controller?.text, '1');
    expect(tally?.totalMinorUnits, 100000);

    await tester.tap(find.byTooltip('Disminuir cantidad').first);
    await tester.pump();
    expect(tester.widget<TextField>(field).controller?.text, '');
    expect(tally?.totalMinorUnits, 0);
  });

  testWidgets('focus selects the whole quantity, so typing replaces it', (
    tester,
  ) async {
    await _pump(tester, (_) {});
    final field = find.byType(TextField).first;

    await tester.enterText(field, '12');
    await tester.pump();
    final controller = tester.widget<TextField>(field).controller!;
    final focus = tester.widget<TextField>(field).focusNode!;

    focus.unfocus();
    await tester.pump();
    focus.requestFocus();
    await tester.pump();

    expect(controller.selection.baseOffset, 0);
    expect(controller.selection.extentOffset, 2);
  });

  testWidgets('the field names the denomination it counts', (tester) async {
    final handle = tester.ensureSemantics();
    await _pump(tester, (_) {});

    final node = tester.getSemantics(find.byType(TextField).first);
    // A screen reader on a row that says "Cantidad de MXN 1,000.00" and nothing
    // else is the difference between a count and a guess.
    expect(node.label, contains('MXN 1,000.00'));
    expect(node.flagsCollection.isTextField, isTrue);

    handle.dispose();
  });

  testWidgets('a row fits the box a phone-width dialog leaves it', (
    tester,
  ) async {
    // 310 px is what a 390 px window leaves inside the blind-count dialog: the
    // dialog's own insets, its content padding, and nothing else. The row's
    // width is not negotiable — two 48 px tap targets and a field sit in it — so
    // this is where the count used to run 10 px past its own card.
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
          body: Align(
            alignment: Alignment.topLeft,
            child: SizedBox(
              width: 310,
              child: DenominationCounter(
                currency: 'MXN',
                denominations: const [100000, 50000, 20000],
                onChanged: (_) {},
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    // The assertion is the layout itself: a row that does not fit raises the
    // renderer's overflow, and a widget test fails on it. Nothing else to check —
    // a row that fits is the whole claim.
    expect(find.text('Total contado'), findsOneWidget);
    expect(tester.getSize(find.byType(DenominationCounter)).width, 310);
  });

  testWidgets('drops to one column before a name can be cut short', (
    tester,
  ) async {
    Future<void> pump(double scale) async {
      tester.platformDispatcher.textScaleFactorTestValue = scale;
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
            body: Align(
              alignment: Alignment.topLeft,
              child: SizedBox(
                // The width the blind-count dialog gives the counter.
                width: 660,
                child: DenominationCounter(
                  currency: 'MXN',
                  denominations: const [100000, 50000],
                  onChanged: (_) {},
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
    }

    await pump(1);
    // Two columns at the usual scale: the second denomination sits beside the
    // first.
    expect(
      tester.getTopLeft(find.text('MXN 500.00')).dy,
      tester.getTopLeft(find.text('MXN 1,000.00')).dy,
    );

    await pump(2);
    // At 200 % a cell of 330 px cannot hold "MXN 1,000.00" — the old maths kept
    // two columns and rendered it as "MXN 1,0…", which left two rows reading the
    // same thing. One column keeps every name whole; the count scrolls instead.
    expect(
      tester.getTopLeft(find.text('MXN 500.00')).dy,
      greaterThan(tester.getTopLeft(find.text('MXN 1,000.00')).dy),
    );
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
  });

  testWidgets('a denomination set that changes keeps its own field', (
    tester,
  ) async {
    DenominationTally? tally;
    await _pump(
      tester,
      (value) => tally = value,
      denominations: const [100000],
    );
    await tester.enterText(find.byType(TextField).first, '3');
    await tester.pump();
    expect(tally?.totalMinorUnits, 300000);

    // The policy can hand the counter a different set on a reload. The count is
    // read from the live state either way, and no field outlives its row.
    await _pump(
      tester,
      (value) => tally = value,
      denominations: const [100000, 50000],
    );
    await tester.pump();
    expect(find.byType(TextField), findsNWidgets(2));
  });
}
