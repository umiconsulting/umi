import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/shared/widgets/receipt_document.dart';

import 'support/receipt_fixture.dart';

Future<void> fonts() async {
  for (final family in <String, List<String>>{
    'IBM Plex Sans': [
      'Regular',
      'Medium',
      'SemiBold',
      'Bold',
    ].map((weight) => 'assets/fonts/IBMPlexSans-$weight.ttf').toList(),
    'Bricolage Grotesque': ['SemiBold', 'Bold']
        .map((weight) => 'assets/fonts/BricolageGrotesque12pt-$weight.ttf')
        .toList(),
  }.entries) {
    final loader = FontLoader(family.key);
    for (final path in family.value) {
      loader.addFont(rootBundle.load(path));
    }
    await loader.load();
  }
}

void main() {
  testWidgets('the on-screen receipt names a bank transfer', (tester) async {
    tester.view.physicalSize = const Size(800, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final receipt = ReceiptSnapshot.fromJson({
      ...receiptTestSnapshot().toJson(),
      'payment': {
        'method': 'bank_transfer',
        'applied': {'minorUnits': 18500, 'currency': 'MXN'},
      },
    });
    await tester.pumpWidget(
      PosApp(
        theme: UmiTheme.light(),
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        home: Builder(
          builder: (context) => PosPage(
            body: PosButton(
              onPressed: () => showReceiptDocument(context, receipt),
              child: const Text('Abrir'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();
    expect(find.text('Transferencia bancaria'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  for (final locale in ['es', 'en']) {
    for (final scale in [1.0, 2.0]) {
      testWidgets(
        'receipt preserves canonical amounts and reachable lines in $locale at $scale',
        (tester) async {
          tester.view.physicalSize = const Size(375, 812);
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
                    onPressed: () =>
                        showReceiptDocument(context, receiptTestSnapshot()),
                    child: const Text('Abrir'),
                  ),
                ),
              ),
            ),
          );
          await tester.tap(find.text('Abrir'));
          await tester.pumpAndSettle();
          expect(find.byType(ListView), findsNothing);
          final scrolling = find
              .descendant(
                of: find.byType(ReceiptDocument),
                matching: find.byType(Scrollable),
              )
              .first;
          final viewport = tester.getRect(scrolling);
          for (final label in [
            'Cappuccino con leche de avena',
            'Chico',
            'Leche de avena',
            'Café de piñón · sin azúcar',
            '3 × MXN 62.00',
            'MXN 181.00',
            'MXN 186.00',
            'MXN 12.30',
            'MXN 5.00',
            'MXN 4.00',
            'MXN 185.00',
            'Powered by Umi: umiconsulting.co',
          ]) {
            final target = find.descendant(
              of: find.byType(ReceiptDocument),
              matching: find.text(label),
            );
            await tester.ensureVisible(target);
            await tester.pumpAndSettle();
            final rect = tester.getRect(target);
            expect(
              rect.top,
              greaterThanOrEqualTo(viewport.top - 1),
              reason: label,
            );
            expect(
              rect.bottom,
              lessThanOrEqualTo(viewport.bottom + 1),
              reason: label,
            );
            expect(
              rect.left,
              greaterThanOrEqualTo(viewport.left - 1),
              reason: label,
            );
            expect(
              rect.right,
              lessThanOrEqualTo(viewport.right + 1),
              reason: label,
            );
          }
          expect(
            find.text(locale == 'es' ? 'Impuestos' : 'Tax'),
            findsOneWidget,
          );
          expect(find.text('MXN 12.30'), findsOneWidget);
          final thanks = find.text(
            locale == 'es'
                ? 'Gracias por su visita'
                : 'Thank you for your visit',
          );
          final signature = find.text('Powered by Umi: umiconsulting.co');
          expect(
            tester.getRect(signature).top - tester.getRect(thanks).bottom,
            closeTo(UmiSpacing.lg, 1),
          );
          expect(tester.takeException(), isNull);
          await tester.sendKeyEvent(LogicalKeyboardKey.escape);
          await tester.pumpAndSettle();
          expect(find.byType(ReceiptDocument), findsNothing);
        },
      );
    }
  }

  testWidgets('the paper carries the café logo when the snapshot names one', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await fonts();
    const logo = 'https://api.example.test/logos/cafe-0123456789abcdef.png';
    await tester.pumpWidget(
      PosApp(
        theme: UmiTheme.light(),
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        home: Builder(
          builder: (context) => PosPage(
            body: PosButton(
              onPressed: () => showReceiptDocument(
                context,
                receiptTestSnapshot(merchantLogoUrl: logo),
              ),
              child: const Text('Abrir'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Abrir'));
    // ONE pump, not settle: the image is in the tree the frame after the dialog
    // opens. What settles afterwards is the fetch, which no test environment has.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 16));

    final image = tester.widget<Image>(
      find.descendant(
        of: find.byType(ReceiptDocument),
        matching: find.byType(Image),
      ),
    );
    expect((image.image as NetworkImage).url, logo);
    // And the mark sits above the name, the way a printed receipt carries one.
    expect(
      tester.getRect(find.byType(Image)).top,
      lessThan(tester.getRect(find.text('CAFÉ ESTACIÓN')).top),
    );
  });

  testWidgets('a café with no logo gets paper, not an empty frame', (
    tester,
  ) async {
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
        home: Builder(
          builder: (context) => PosPage(
            body: PosButton(
              onPressed: () =>
                  showReceiptDocument(context, receiptTestSnapshot()),
              child: const Text('Abrir'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();

    expect(find.byType(Image), findsNothing);
    expect(find.text('CAFÉ ESTACIÓN'), findsOneWidget);
  });
}
