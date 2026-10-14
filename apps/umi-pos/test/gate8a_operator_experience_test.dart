import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/errors/operator_error_message.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/entry/entry_surface.dart';

import 'support/fakes.dart';

void main() {
  test('design tokens preserve brand and pilot control dimensions', () {
    final theme = UmiTheme.light();
    expect(theme.colorScheme.primary, isNot(equals(PosColors.green)));
    expect(UmiTouchTarget.minimum, 48);
    expect(UmiTouchTarget.primary, greaterThanOrEqualTo(52));
    expect(theme.colorScheme.primary.a, 1);
  });

  testWidgets('enrollment and PIN actions explain invalid input by state', (
    tester,
  ) async {
    final root = testRoot();
    await root.controller.initialize();
    await root.entry.initialize();
    await tester.pumpWidget(
      PosApp(
        theme: UmiTheme.light(),
        localizationsDelegates: const [
          AppLocalizations.delegate,

          GlobalWidgetsLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: EntrySurface(controller: root.entry),
      ),
    );

    expect(tester.widget<PosButton>(find.byType(PosButton)).enabled, isFalse);
    await tester.enterText(find.byType(PosField), 'ABCDEFGH');
    await tester.pump();
    expect(tester.widget<PosButton>(find.byType(PosButton)).enabled, isTrue);
  });

  testWidgets('operator errors use Spanish business language', (tester) async {
    late BuildContext context;
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,

          GlobalWidgetsLocalizations.delegate,
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
    expect(
      operatorErrorMessage(
        context,
        'CART_ACCOUNT_BUSY',
        details: {'operatorName': 'Mesero 2', 'deviceName': 'Tablet A9'},
      ),
      'Mesero 2 tiene esta cuenta abierta en Tablet A9. Pídele guardar la cuenta desde Cuentas antes de recuperarla aquí.',
    );
    // A body the server refuses before the domain sees it: the operator is told
    // what to do about it, and never reads the code. Three surfaces showed a
    // generic sentence for this code on the iMin D3-504 on 2026-10-11.
    expect(
      operatorErrorMessage(context, 'VALIDATION_FAILED'),
      'El servidor no aceptó el formato de esta operación. Actualiza la '
      'pantalla y vuelve a intentarlo; si sigue igual, avisa a soporte.',
    );
    expect(
      operatorErrorMessage(context, 'VALIDATION_FAILED'),
      isNot(contains('VALIDATION')),
    );
    // The rule is the warehouse's, not the session's — a till that had restarted
    // could not see the count its previous session had started, and the second
    // attempt answered with a raw duplicate-key 500 before this existed.
    expect(
      operatorErrorMessage(context, 'INVENTORY_COUNT_ALREADY_ACTIVE'),
      'Ya hay un conteo abierto en este almacén. No se puede iniciar otro '
      'hasta que se cierre.',
    );
    // The rest of the inventory refusals that only became publishable today: the
    // contract's allow-list was silently re-labelling every one of them
    // `CONFLICT`, so the till answered `La información cambió` to operators who
    // had done nothing wrong.
    expect(
      operatorErrorMessage(context, 'INVENTORY_VARIANCE_REASON_REQUIRED'),
      'Cada diferencia necesita un motivo antes de conciliar el conteo.',
    );
    expect(
      operatorErrorMessage(context, 'INVENTORY_CURSOR_INVALID'),
      'La lista cambió mientras la leías. Vuelve a abrirla.',
    );
    expect(
      operatorErrorMessage(context, 'DUPLICATE_RESTOCK_COMPONENT'),
      'La reposición llevaba un componente repetido. Vuelve a intentarlo.',
    );
    expect(
      operatorErrorMessage(context, 'PERMISSION_REVOKED'),
      'Tu perfil ya no permite esta operación.',
    );
    // A cash shift that cannot make the move the till asked for. Measured on the
    // iMin D3-504, 2026-10-11: the cash screen offered to resume the drawer this
    // very terminal was holding, and the API answered a bare 500 INTERNAL_ERROR
    // for three different reasons (a version that had moved, a drawer on another
    // terminal, a status that does not admit the move). One sentence covers the
    // three, because the operator's next step is the same in all of them.
    expect(
      operatorErrorMessage(context, 'INVALID_SHIFT_TRANSITION'),
      'El turno no se puede mover así en este momento. Actualiza la pantalla '
      'de Caja para ver en qué estado quedó.',
    );
    expect(
      operatorErrorMessage(context, 'INVALID_SHIFT_TRANSITION'),
      isNot(contains('INVALID_SHIFT')),
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
        child: PosApp(
          theme: UmiTheme.light(),
          localizationsDelegates: const [
            AppLocalizations.delegate,

            GlobalWidgetsLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          home: EntrySurface(controller: root.entry),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    expect(find.byType(PosField), findsOneWidget);
    expect(find.byType(PosButton), findsOneWidget);
  });
}
