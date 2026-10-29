import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/catalog/service_context_prototype.dart';

/// Renders the isolated account-location prototype.
///
/// This file is deliberately not named `*_test.dart`, because it writes PNGs.
/// Run it by name:
///
///   RENDER_VIEWPORT=1920x1080 flutter test \
///     test/render/service_context_render.dart --update-goldens
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final viewport = _parseViewport(
    Platform.environment['RENDER_VIEWPORT'] ?? '900x1000',
  );

  setUpAll(() async {
    final body = FontLoader('IBM Plex Sans');
    for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
      body.addFont(rootBundle.load('assets/fonts/IBMPlexSans-$weight.ttf'));
    }
    await body.load();
    final headings = FontLoader('Bricolage Grotesque');
    for (final weight in ['SemiBold', 'Bold']) {
      headings.addFont(
        rootBundle.load('assets/fonts/BricolageGrotesque12pt-$weight.ttf'),
      );
    }
    await headings.load();
  });

  testWidgets('renders the account location states', (tester) async {
    tester.view.physicalSize = viewport;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final rootKey = GlobalKey();
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        theme: UmiTheme.light(),
        home: RepaintBoundary(
          key: rootKey,
          child: const ServiceContextPrototype(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await _capture(rootKey, viewport, '01-choose');

    await tester.tap(find.byKey(const ValueKey('service-table')));
    await tester.pumpAndSettle();
    await _capture(rootKey, viewport, '02-table');

    await tester.tap(find.byKey(const ValueKey('table-mesa-2')));
    await tester.pumpAndSettle();
    await _capture(rootKey, viewport, '03-account');

    await tester.tap(find.byKey(const ValueKey('send-to-kitchen')));
    await tester.pumpAndSettle();
    await _capture(rootKey, viewport, '04-sent');

    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        theme: UmiTheme.light(),
        home: RepaintBoundary(
          key: rootKey,
          child: const ServiceContextPrototype(
            key: ValueKey('legacy-prototype'),
            startWithLegacyAccount: true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await _capture(rootKey, viewport, '05-legacy');

    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        theme: UmiTheme.light(),
        home: RepaintBoundary(
          key: rootKey,
          child: const ServiceContextPrototype(
            key: ValueKey('retry-prototype'),
            failFirstSend: true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('service-table')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('table-mesa-2')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('send-to-kitchen')));
    await tester.pumpAndSettle();
    await _capture(rootKey, viewport, '06-retry');
  });
}

Future<void> _capture(GlobalKey rootKey, Size viewport, String state) async {
  Directory('test/render/shots/service-context').createSync(recursive: true);
  await expectLater(
    find.byKey(rootKey),
    matchesGoldenFile(
      'shots/service-context/$state-'
      '${viewport.width.toInt()}x${viewport.height.toInt()}.png',
    ),
  );
}

Size _parseViewport(String raw) {
  final parts = raw.split('x');
  if (parts.length != 2) {
    throw FormatException('RENDER_VIEWPORT must be WxH, got "$raw"');
  }
  return Size(double.parse(parts[0]), double.parse(parts[1]));
}
