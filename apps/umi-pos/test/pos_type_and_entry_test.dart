import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/features/entry/entry_surface.dart';
import 'package:umi_pos/shared/widgets/station_signature.dart';
import 'support/fakes.dart';

void main() {
  setUpAll(() async {
    for (final entry in {
      'IBM Plex Sans': 'IBMPlexSans-Regular.ttf',
      'Bricolage Grotesque': 'BricolageGrotesque12pt-SemiBold.ttf',
    }.entries) {
      final loader = FontLoader(entry.key)
        ..addFont(
          Future.value(
            ByteData.sublistView(
              File('assets/fonts/${entry.value}').readAsBytesSync(),
            ),
          ),
        );
      await loader.load();
    }
  });
  test('operational font gives all digits the same advance with tnum', () {
    final widths = [
      for (var n = 0; n < 10; n++)
        (TextPainter(
          text: TextSpan(text: '$n', style: PosThemeData().textTheme.bodyLarge),
          textDirection: TextDirection.ltr,
        )..layout()).width,
    ];
    expect(widths.first, greaterThan(0));
    for (final width in widths) {
      expect(width, closeTo(widths.first, .001));
    }
  });

  testWidgets('enrollment retains focus when the Android keyboard opens', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1920, 1080);
    tester.view.devicePixelRatio = 1.375;
    addTearDown(tester.view.reset);
    final root = testRoot();
    await root.entry.initialize();
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        supportedLocales: const [Locale('es')],
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        home: EntrySurface(controller: root.entry),
      ),
    );
    await tester.pumpAndSettle();
    final focus = tester
        .widget<EditableText>(find.byType(EditableText))
        .focusNode;
    await tester.tap(find.byType(EditableText));
    await tester.pump();
    expect(focus.hasFocus, isTrue);
    tester.view.viewInsets = const FakeViewPadding(bottom: 440);
    await tester.pumpAndSettle();
    expect(
      tester.widget<EditableText>(find.byType(EditableText)).focusNode,
      same(focus),
    );
    expect(focus.hasFocus, isTrue);
    expect(tester.testTextInput.isVisible, isTrue);
    tester.testTextInput.enterText('ABCDEFGH');
    await tester.pump();
    tester.view.viewInsets = const FakeViewPadding();
    await tester.pumpAndSettle();
    expect(
      tester.widget<EditableText>(find.byType(EditableText)).controller.text,
      'ABCDEFGH',
    );
    expect(focus.hasFocus, isTrue);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    root.dispose();
  });

  for (final scale in [1.0, 2.0]) {
    testWidgets(
      'entry loading retains context at enlarged phone scale $scale',
      (tester) async {
        tester.view.physicalSize = const Size(375, 812);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final root = testRoot();
        await tester.pumpWidget(
          PosApp(
            locale: const Locale('es'),
            supportedLocales: const [Locale('es')],
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
            ],
            home: MediaQuery(
              data: MediaQueryData(
                size: const Size(375, 812),
                textScaler: TextScaler.linear(scale),
              ),
              child: EntrySurface(controller: root.entry),
            ),
          ),
        );
        await tester.pump();
        expect(tester.takeException(), isNull);
        expect(find.text('Comprobando tu terminal'), findsOneWidget);
        expect(find.text('umi'), findsOneWidget);
        expect(find.text('Estación'), findsNothing);
        expect(
          find.descendant(
            of: find.byType(StationSignature),
            matching: find.byType(CustomPaint),
          ),
          findsNothing,
        );
        expect(
          tester.getRect(find.text('Comprobando tu terminal')).right,
          lessThanOrEqualTo(375),
        );
        expect(find.byType(PosPage), findsOneWidget);
      },
    );
  }
}
