import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/shared/widgets/receipt_document.dart';

import 'receipt_document_test.dart' show fonts;
import 'support/receipt_fixture.dart';

/// ⚠️ WRITTEN, NOT RUN. No Flutter SDK exists on the machine that wrote this, so the receipt
/// head is unverified there. The command that proves it, on a workstation with Flutter:
///
///     cd apps/umi-pos && flutter test test/receipt_ticket_folio_test.dart
void main() {
  Future<void> open(WidgetTester tester, String receiptRef) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await fonts();
    await tester.pumpWidget(
      PosApp(
        theme: UmiTheme.light(),
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        home: ReceiptDocument(receipt: receiptTestSnapshot(receiptRef: receiptRef)),
      ),
    );
  }

  List<String> selectable(WidgetTester tester) => tester
      .widgetList<PosSelectableText>(find.byType(PosSelectableText))
      .map((widget) => widget.data)
      .toList();

  testWidgets('the ticket folio is the receipt number a person reads', (tester) async {
    await open(tester, '0042');

    // The head names the ticket once, and not as fine print: the whole point of the folio is
    // that a cashier and a customer can say it out loud.
    expect(selectable(tester), contains('TICKET 0042'));
    expect(selectable(tester), isNot(contains('0042')));
  });

  testWidgets('a receipt issued before the counter prints no key as a ticket', (
    tester,
  ) async {
    await open(tester, 'POS-80b6d99a-9cca-4546-a84f-74897cde50f8');

    // The snapshot is frozen and never rewritten, and `POS-<uuid>` is a KEY, not a
    // number: it is already in the barcode at the foot of this sheet, and repeating it
    // as fine print put a string nobody can read, dictate or use in front of the guest
    // (owner, 2026-10-12). A legacy receipt shows no ticket line at all.
    expect(
      selectable(tester),
      isNot(contains('POS-80b6d99a-9cca-4546-a84f-74897cde50f8')),
    );
  });
}
