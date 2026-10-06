import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/errors/operator_error_message.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/entry/entry_surface.dart';

import 'support/fakes.dart';

void main() {
  test('design tokens preserve brand and pilot control dimensions', () {
    final theme = UmiTheme.light();
    expect(theme.colorScheme.primary, isNot(equals(Colors.green)));
    expect(
      theme.elevatedButtonTheme.style?.minimumSize?.resolve({}),
      const Size(UmiTouchTarget.minimum, UmiTouchTarget.primary),
    );
    expect(theme.focusColor.a, greaterThan(0));
  });

  testWidgets('enrollment and PIN actions explain invalid input by state', (
    tester,
  ) async {
    final root = testRoot();
    await root.controller.initialize();
    await root.entry.initialize();
    await tester.pumpWidget(
      MaterialApp(
        theme: UmiTheme.light(),
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: EntrySurface(controller: root.entry),
      ),
    );

    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton)).enabled,
      isFalse,
    );
    await tester.enterText(find.byType(TextField), 'ABCDEFGH');
    await tester.pump();
    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton)).enabled,
      isTrue,
    );
  });

  testWidgets('operator errors use Spanish business language', (tester) async {
    late BuildContext context;
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
        home: Builder(
          builder: (value) {
            context = value;
            return const SizedBox();
          },
        ),
      ),
    );
    expect(
      operatorErrorMessage(context, 'IDEMPOTENCY_CONFLICT'),
      'La información cambió. Revisa los datos e intenta de nuevo.',
    );
    expect(
      operatorErrorMessage(context, 'IDEMPOTENCY_CONFLICT'),
      isNot(contains('IDEMPOTENCY')),
    );
  });

  testWidgets('entry remains usable at compact width and 200 percent text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(600, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final root = testRoot();
    await root.controller.initialize();
    await root.entry.initialize();
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(2)),
        child: MaterialApp(
          theme: UmiTheme.light(),
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          home: EntrySurface(controller: root.entry),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    expect(find.byType(TextField), findsOneWidget);
    expect(find.byType(ElevatedButton), findsOneWidget);
  });
}
