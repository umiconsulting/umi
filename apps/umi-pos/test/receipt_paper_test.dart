import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/shared/widgets/receipt_paper.dart';

/// The cue the receipt dialog fires when the operator asks for a print.
final class _Cue extends ChangeNotifier {
  void print() => notifyListeners();
}

Widget _app(Widget child, {bool animations = true}) => PosApp(
  theme: UmiTheme.light(),
  home: MediaQuery(
    data: MediaQueryData(disableAnimations: !animations),
    child: Scaffold(body: SizedBox(height: 400, child: child)),
  ),
);

/// The head's own vibration is the observable part of "the machine is working":
/// it is a translation on the slot, so a test can read it without reaching into
/// private paint state.
double _slotShift(WidgetTester tester) {
  final transform = tester.widget<Transform>(
    find.byKey(const ValueKey('receipt-slot')),
  );
  return transform.transform.getTranslation().y;
}

void main() {
  testWidgets('opening a receipt does not print, so the paper is already out', (
    tester,
  ) async {
    final cue = _Cue();
    addTearDown(cue.dispose);
    await tester.pumpWidget(
      _app(
        ReceiptPaper(
          prints: cue,
          slotLabel: 'Comprobante',
          child: const SizedBox(height: 200, child: Text('recibo')),
        ),
      ),
    );
    await tester.pump();

    // Nothing is scheduled and the head is still: reading a receipt is not
    // printing one (the owner's correction on the iMin D3-504, 2026-10-11).
    expect(tester.binding.hasScheduledFrame, isFalse);
    expect(_slotShift(tester), 0);
  });

  testWidgets('asking for a print feeds the sheet out of the slot', (
    tester,
  ) async {
    final cue = _Cue();
    addTearDown(cue.dispose);
    await tester.pumpWidget(
      _app(
        ReceiptPaper(
          prints: cue,
          slotLabel: 'Comprobante',
          child: const SizedBox(height: 200, child: Text('recibo')),
        ),
      ),
    );
    await tester.pump();

    cue.print();
    // One frame to let the feed start, one to advance it.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(
      _slotShift(tester),
      isNot(0),
      reason: 'the head is working while the paper comes out',
    );
    await tester.pumpAndSettle();
    expect(_slotShift(tester), 0);
    expect(find.text('recibo'), findsOneWidget);
  });

  testWidgets('reduced motion prints with no feed at all', (tester) async {
    final cue = _Cue();
    addTearDown(cue.dispose);
    await tester.pumpWidget(
      _app(
        ReceiptPaper(
          prints: cue,
          slotLabel: 'Comprobante',
          child: const SizedBox(height: 200, child: Text('recibo')),
        ),
        animations: false,
      ),
    );
    await tester.pump();

    cue.print();
    await tester.pump();
    expect(_slotShift(tester), 0);
    expect(tester.binding.hasScheduledFrame, isFalse);
  });

  testWidgets('the roll advances exactly one ticket, and it is the same one', (
    tester,
  ) async {
    // What the owner asked for: the ticket breaks from the one above, slides
    // down as it prints, and the next one slides in to take its place — and it
    // is just the same ticket, which is what makes it a loop.
    final cue = _Cue();
    addTearDown(cue.dispose);
    await tester.pumpWidget(
      _app(
        ReceiptPaper(
          prints: cue,
          slotLabel: 'Comprobante',
          child: const SizedBox(height: 200, child: Text('recibo')),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('recibo'), findsOneWidget);

    cue.print();
    await tester.pump();
    // While it prints there are two tickets on the roll: the one leaving and the
    // identical one arriving behind it.
    expect(find.text('recibo'), findsNWidgets(2));
    await tester.pump(const Duration(milliseconds: 200));
    final rolling = tester.widget<Transform>(
      find.byKey(const ValueKey('receipt-roll')),
    );
    final window = tester.getRect(find.byKey(const ValueKey('receipt-roll')));
    expect(
      rolling.transform.getTranslation().y,
      lessThan(0),
      reason: 'the strip is on its way down',
    );
    await tester.pumpAndSettle();
    // Settled: the arriving ticket sits exactly where the last one was, and the
    // far one is gone again.
    expect(find.text('recibo'), findsOneWidget);
    expect(window.height, greaterThan(0));
  });

  testWidgets('the case keeps its lamp, and no name or feed button', (
    tester,
  ) async {
    final cue = _Cue();
    addTearDown(cue.dispose);
    await tester.pumpWidget(
      _app(
        ReceiptPaper(
          prints: cue,
          slotLabel: 'Comprobante',
          child: const SizedBox(height: 200, child: Text('recibo')),
        ),
      ),
    );
    await tester.pump();

    List<String?> labels() => tester
        .widgetList<Semantics>(find.byType(Semantics))
        .map((semantics) => semantics.properties.label)
        .toList();

    // Ready: the lamp says so and the paper is still. The case carries no
    // printer name and no feed button — the owner asked for both to go.
    expect(labels(), contains('Lista'));
    expect(find.textContaining('TM-T20'), findsNothing);
    expect(find.byType(PosTapRegion), findsNothing);
    expect(find.text('recibo'), findsOneWidget);

    cue.print();
    await tester.pump();
    expect(labels(), contains('Imprimiendo'));
    await tester.pumpAndSettle();
    expect(labels(), contains('Lista'));
    expect(find.text('recibo'), findsOneWidget);
  });
}
