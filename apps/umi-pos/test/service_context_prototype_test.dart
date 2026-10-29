import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/catalog/service_context_prototype.dart';

void main() {
  testWidgets('table flow reaches a sent account', (tester) async {
    await _pumpPrototype(tester);

    expect(find.text('Nueva cuenta'), findsOneWidget);
    expect(find.text('Mesa'), findsOneWidget);
    expect(find.text('Sin mesa'), findsOneWidget);
    expect(find.text('Para llevar'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('service-table')));
    await tester.pumpAndSettle();
    expect(find.text('Elige una mesa'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('table-mesa-2')));
    await tester.pumpAndSettle();
    expect(find.text('Cuenta 010'), findsOneWidget);
    expect(find.text('Mesa 2 · Comer aquí'), findsOneWidget);
    expect(find.text('Por enviar'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('send-to-kitchen')));
    await tester.pumpAndSettle();
    expect(find.text('Enviada · 19:27'), findsOneWidget);
    expect(
      find.text('Enviado a cocina · 19:27 · Cuenta abierta'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('send-to-kitchen')), findsNothing);
  });

  testWidgets('missing location is repaired before send', (tester) async {
    await _pumpPrototype(tester, startWithLegacyAccount: true);

    expect(find.text('Falta indicar dónde se sirve'), findsOneWidget);
    expect(find.text('Elige la ubicación para enviar'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('repair-no-table')));
    await tester.pumpAndSettle();

    expect(find.text('Sin mesa · Barra o mostrador'), findsOneWidget);
    expect(find.byKey(const ValueKey('send-to-kitchen')), findsOneWidget);
  });

  testWidgets('send failure keeps one retry action', (tester) async {
    await _pumpPrototype(
      tester,
      startWithLegacyAccount: true,
      failFirstSend: true,
    );
    await tester.tap(find.byKey(const ValueKey('repair-takeout')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('send-to-kitchen')));
    await tester.pumpAndSettle();

    expect(
      find.text('No se pudo enviar. Los 2 artículos siguen pendientes.'),
      findsOneWidget,
    );
    expect(find.text('Reintentar envío'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('send-to-kitchen')));
    await tester.pumpAndSettle();
    expect(find.text('Enviada · 19:27'), findsOneWidget);
  });
}

Future<void> _pumpPrototype(
  WidgetTester tester, {
  bool startWithLegacyAccount = false,
  bool failFirstSend = false,
}) async {
  tester.view.physicalSize = const Size(900, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    PosApp(
      locale: const Locale('es'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      theme: UmiTheme.light(),
      home: ServiceContextPrototype(
        startWithLegacyAccount: startWithLegacyAccount,
        failFirstSend: failFirstSend,
      ),
    ),
  );
  await tester.pumpAndSettle();
}
