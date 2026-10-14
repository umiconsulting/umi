import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/shared/widgets/receipt_document.dart';

import 'receipt_document_test.dart' show fonts;
import 'support/receipt_fixture.dart';

ReceiptSnapshot longReceipt() => ReceiptSnapshot.fromJson({
  ...receiptTestSnapshot(receiptRef: '0042').toJson(),
  'lines': [
    for (var i = 1; i <= 500; i++)
      ReceiptLineSnapshot(
        lineRef: 'line-$i',
        description: 'Artículo $i · Café de piñón',
        quantity: 3,
        unitPrice: money(6200),
        lineTotal: money(18100),
        variantName: 'Chico',
        modifiers: [
          'Leche de avena',
          if (i % 3 == 0) 'Por separado, con hielo y sin azúcar adicional',
        ],
        note: i % 2 == 0
            ? 'Servir después del plato principal. La nota conserva el texto completo.'
            : 'Sin azúcar',
      ).toJson(),
  ],
});

void main() {
  for (final locale in ['es', 'en']) {
    for (final scale in [1.0, 2.0]) {
      for (final size in [const Size(375, 812), const Size(812, 375)]) {
        testWidgets(
          '500 variable receipt lines keep keyboard, total and bounded content in $locale at $scale $size',
          (tester) async {
            tester.view.physicalSize = size;
            tester.view.devicePixelRatio = 1;
            addTearDown(tester.view.reset);
            await fonts();
            await tester.pumpWidget(
              PosApp(
                theme: UmiTheme.light(),
                locale: Locale(locale),
                supportedLocales: AppLocalizations.supportedLocales,
                localizationsDelegates: const [
                  AppLocalizations.delegate,
                  GlobalWidgetsLocalizations.delegate,
                ],
                builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(
                    context,
                  ).copyWith(textScaler: TextScaler.linear(scale)),
                  child: child!,
                ),
                home: Builder(
                  builder: (context) => PosPage(
                    body: PosButton(
                      onPressed: () => showReceiptDocument(
                        context,
                        longReceipt(),
                        printAction: (_, _) => PosButton(
                          onPressed: () {},
                          child: Text(
                            locale == 'es'
                                ? 'Imprimir recibo'
                                : 'Print receipt',
                          ),
                        ),
                      ),
                      child: const Text('Open'),
                    ),
                  ),
                ),
              ),
            );
            await tester.tap(find.text('Open'));
            await tester.pumpAndSettle();
            final scrolling = find.descendant(
              of: find.byType(ReceiptDocument),
              matching: find.byType(Scrollable),
            );
            expect(scrolling, findsOneWidget);
            final state = tester.state<ScrollableState>(scrolling);
            final row = find.byWidgetPredicate(
              (w) => w.runtimeType.toString() == '_ReceiptLine',
              skipOffstage: false,
            );
            expect(row.evaluate().length, lessThan(20));
            expect(state.position.pixels, 0);
            await tester.sendKeyEvent(LogicalKeyboardKey.pageDown);
            await tester.pumpAndSettle();
            expect(state.position.pixels, greaterThan(0));
            await tester.sendKeyEvent(LogicalKeyboardKey.pageUp);
            await tester.pumpAndSettle();
            expect(state.position.pixels, closeTo(0, 1));
            final last = find.text('Artículo 500 · Café de piñón');
            await tester.scrollUntilVisible(
              last,
              240,
              scrollable: scrolling,
              maxScrolls: 2000,
            );
            await tester.pumpAndSettle();
            await tester.ensureVisible(last);
            await tester.pumpAndSettle();
            final viewport = tester.getRect(scrolling);
            expect(
              tester.getRect(last).top,
              greaterThanOrEqualTo(viewport.top - 1),
            );
            expect(
              tester.getRect(last).bottom,
              lessThanOrEqualTo(viewport.bottom + 1),
            );
            final total = find.text('MXN 185.00', skipOffstage: false);
            await tester.ensureVisible(total);
            await tester.pumpAndSettle();
            expect(
              tester.getRect(total).top,
              greaterThanOrEqualTo(viewport.top - 1),
            );
            expect(
              tester.getRect(total).bottom,
              lessThanOrEqualTo(viewport.bottom + 1),
            );
            expect(row.evaluate().length, lessThan(20));
            // Tab from the safe close action reveals the retained number. The fixture
            // keeps the legacy `POS-<uuid>` reference on purpose (most tests want the
            // receipt a café already has), and that shape no longer prints a line of its
            // own — the key lives in the barcode (owner, 2026-10-12). This case is about
            // the ticket number staying reachable at 2× text, so it asks for a folio.
            await tester.sendKeyEvent(LogicalKeyboardKey.tab);
            await tester.pumpAndSettle();
            final reference = find.byType(SelectableRegion);
            final referenceRect = tester.getRect(reference);
            expect(referenceRect.top, greaterThanOrEqualTo(viewport.top - 1));
            expect(
              referenceRect.bottom,
              lessThanOrEqualTo(viewport.bottom + 1),
            );
            expect(
              tester.widget<SelectableRegion>(reference).focusNode!.hasFocus,
              isTrue,
            );
            expect(tester.takeException(), isNull);
            await tester.sendKeyEvent(LogicalKeyboardKey.escape);
            await tester.pumpAndSettle();
            expect(find.byType(ReceiptDocument), findsNothing);
          },
        );
      }
    }
  }
}
