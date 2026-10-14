import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/shared/widgets/station_document.dart';
import 'package:umi_pos/shared/widgets/station_signature.dart';

/// The station signs its own name in three places.
///
/// The owner asked for a quieter entry on 2026-10-11: the mark reads "umi"
/// without the trailing dot, the login cover carries no "ESTACIÓN / UMI POS"
/// line, and the PIN screen is the keypad alone. These assertions hold the
/// words; the pictures are in `test/render/` for a person to judge.
void main() {
  Widget app(Widget home) => PosApp(
    locale: const Locale('es'),
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: const [
      AppLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
    ],
    home: home,
  );

  testWidgets('the login cover signs "umi" with no dot and no station line', (
    tester,
  ) async {
    await tester.pumpWidget(app(const PosPage(body: StationEntryCover())));
    await tester.pump();

    expect(find.text('umi'), findsOneWidget);
    expect(find.text('umi·'), findsNothing);
    expect(find.textContaining('ESTACIÓN'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the signature signs "umi" with no dot and keeps the name', (
    tester,
  ) async {
    await tester.pumpWidget(
      app(const PosPage(body: Center(child: StationSignature()))),
    );
    await tester.pump();

    expect(find.text('umi'), findsOneWidget);
    expect(find.text('umi·'), findsNothing);
    // The signature still tells an operator on a shared counter which terminal
    // they are on.
    expect(find.text('Estación'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the navigation rail signs "umi" with no dot', (tester) async {
    tester.view.physicalSize = const Size(1920, 1080);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      app(
        PosPage(
          body: const SizedBox.shrink(),
          bottomNavigationBar: PosNavigation(
            destinations: const [
              PosDestination(
                icon: PosIcon(PosGlyphs.receiptLongOutlined),
                label: 'Comanda',
              ),
              PosDestination(
                icon: PosIcon(PosGlyphs.paymentsOutlined),
                label: 'Caja',
              ),
            ],
            onDestinationSelected: (_) {},
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('umi'), findsOneWidget);
    expect(find.text('umi·'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
