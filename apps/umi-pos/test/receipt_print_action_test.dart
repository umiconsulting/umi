import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/shared/widgets/receipt_print_action.dart';

import 'support/receipt_fixture.dart';

/// THE PRINT BUTTON IS ONE BEHAVIOUR ON TWO SCREENS.
///
/// The sale's completion screen ("Ver comprobante") and Ventas ("Abrir recibo") show
/// the same dialog — one component, one ticket. The print action was the part that was
/// not shared: Ventas built its own, with its own refusal handling, and the completion
/// screen had none at all, so the owner's request ("que en Ver comprobante también
/// permita reimprimir") would have been a second copy of the same closure. These
/// assertions are about the shared one.
Widget app(Widget child) => PosApp(
  theme: UmiTheme.light(),
  locale: const Locale('es'),
  supportedLocales: AppLocalizations.supportedLocales,
  localizationsDelegates: const [
    AppLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ],
  home: PosPage(body: child),
);

void main() {
  const receiptId = '9f0a3c4e-1111-4222-8333-444455556666';
  final snapshot = receiptTestSnapshot().toJson();

  testWidgets('no button without the permission, the request or the hardware', (tester) async {
    // Three different reasons the till must NOT offer a print, and the same answer for
    // all three: no button. A button that cannot work is worse than no button.
    for (final action in [
      receiptPrintAction(
        canPrint: false,
        receiptId: receiptId,
        snapshot: snapshot,
        onPrint: (_, _) async {},
      ),
      receiptPrintAction(
        canPrint: true,
        receiptId: null,
        snapshot: snapshot,
        onPrint: (_, _) async {},
      ),
      receiptPrintAction(
        canPrint: true,
        receiptId: receiptId,
        snapshot: snapshot,
        onPrint: null,
      ),
    ]) {
      expect(action, isNull);
    }
  });

  testWidgets('the button prints this receipt, and the dialog stays open', (tester) async {
    String? printedId;
    Map<String, Object?>? printedSnapshot;
    await tester.pumpWidget(
      app(
        Builder(
          builder: (context) => PosButton(
            onPressed: () => showReceiptDocument(
              context,
              receiptTestSnapshot(),
              printAction: receiptPrintAction(
                canPrint: true,
                receiptId: receiptId,
                snapshot: snapshot,
                onPrint: (id, receipt) async {
                  printedId = id;
                  printedSnapshot = receipt;
                },
              ),
            ),
            child: const Text('Abrir'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Imprimir recibo').hitTestable());
    await tester.pumpAndSettle();

    expect(printedId, receiptId);
    expect(printedSnapshot?['receiptRef'], snapshot['receiptRef']);
    // The dialog is still there: the paper is what tells the operator the copy came
    // out, and closing on the command's return hid the whole feed.
    expect(find.text('Imprimir recibo').hitTestable(), findsOneWidget);
  });

  testWidgets('a refused print is a sentence inside the dialog, never a silent gap', (tester) async {
    // `printAuthoritativeReceipt` throws when there is no printer for this till. The
    // await used to be unguarded, so the refusal escaped into an async gap: the button
    // did nothing and said nothing ("reimprimir no funciona", iMin D3-504, 2026-10-11).
    await tester.pumpWidget(
      app(
        Builder(
          builder: (context) => PosButton(
            onPressed: () => showReceiptDocument(
              context,
              receiptTestSnapshot(),
              printAction: receiptPrintAction(
                canPrint: true,
                receiptId: receiptId,
                snapshot: snapshot,
                onPrint: (_, _) async => throw const AppException(
                  category: AppErrorCategory.configuration,
                  code: 'HARDWARE_RECEIPT_PRINTER_UNAVAILABLE',
                  recoverable: false,
                ),
              ),
            ),
            child: const Text('Abrir'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Imprimir recibo').hitTestable());
    await tester.pumpAndSettle();

    expect(
      find.textContaining('Centro de hardware'),
      findsOneWidget,
      reason: 'la frase que dice qué hacer, no el código',
    );
    expect(find.textContaining('HARDWARE_RECEIPT'), findsNothing);
  });
}
