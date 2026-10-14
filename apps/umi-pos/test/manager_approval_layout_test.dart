import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/shared/widgets/manager_approval.dart';

void main() {
  for (final scale in [1.0, 2.0]) {
    testWidgets('approval rejection keeps footer reachable at scale $scale', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1280, 720);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        PosApp(
          theme: UmiTheme.light(),
          locale: const Locale('es'),
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
                child: const Text('Abrir'),
                onPressed: () => showManagerApprovalDialog(
                  context,
                  request: const ManagerApprovalPrompt(
                    operation: 'Cancelar producto preparado',
                    amount: 'MXN 60.00',
                    reason: 'El cliente cambió el pedido',
                  ),
                  failure:
                      'Este PIN no tiene permiso. Solicita la autorización del administrador.',
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Abrir'));
      await tester.pumpAndSettle();
      final authorize = find.widgetWithText(PosButton, 'Autorizar');
      expect(authorize, findsOneWidget);
      expect(tester.getRect(authorize).bottom, lessThanOrEqualTo(720));
      expect(tester.takeException(), isNull);
      final digit = find.text('1');
      await tester.ensureVisible(digit);
      for (var i = 0; i < 4; i++) {
        await tester.tap(digit);
      }
      await tester.pumpAndSettle();
      expect(tester.widget<PosButton>(authorize).onPressed, isNotNull);
      await tester.tap(authorize);
      await tester.pumpAndSettle();
      expect(find.byType(ManagerApprovalDialog), findsNothing);
    });
  }
}
