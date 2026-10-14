import '../../core/errors/app_error.dart';
import '../../core/localization/app_localizations.dart';
import '../../core/theme/pos_ui.dart';
import 'receipt_document.dart';

// The dialog's own vocabulary travels with the action: a screen that asks for the
// print button is also the screen that shows the dialog, and one import for both is
// one fewer way to forget one of them.
export 'receipt_document.dart' show ReceiptPrintAction, ReceiptPrintRequest, showReceiptDocument;

/// The print button the receipt dialog shows — ONE implementation, two screens.
///
/// The dialog is shared (`showReceiptDocument`), so the ticket the customer reads
/// is the same whether the operator opened it from the sale's completion screen or
/// from Ventas. The print action was not: Ventas built its own closure, including
/// the refusal handling, and the completion screen simply had none — so the one
/// behaviour an owner asked for twice ("que en Ver comprobante también permita
/// reimprimir", "cuando me voy a Ventas y reimprimir recibo") lived in a single
/// screen and would have been copied, badly, into the second.
///
/// THE RULE FOR THE PAPER IS THE SAME ON BOTH SCREENS: what the SALE printed is the
/// original, and anything printed afterwards is a duplicate that says COPIA. That is
/// why this helper does not take a "copy" flag: it is not a property of the screen
/// but of the moment, and the server already decides it (an official print for this
/// receipt and printer exists → controlled reprint). The sale's own print does not
/// come through here.
///
/// Returns null when this screen must not offer a print at all: the operator lacks
/// `hardware.printer.print`, or there is no request to make (no receipt id, no
/// snapshot, no hardware service behind the screen).
ReceiptPrintAction? receiptPrintAction({
  required bool canPrint,
  required String? receiptId,
  required Map<String, Object?>? snapshot,
  required ReceiptPrintRequest? onPrint,
}) {
  if (!canPrint || receiptId == null || snapshot == null || onPrint == null) return null;
  return (dialogContext, onFailure) => PosButton.tonalIcon(
    onPressed: () async {
      try {
        await onPrint(receiptId, snapshot);
        // The dialog stays open on purpose: the paper is what tells the operator the
        // copy came out, and closing on the command's return hid the whole feed (the
        // owner asked for the animation at print time, iMin D3-504, 2026-10-11).
      } on AppException catch (error) {
        // A REFUSAL THE OPERATOR CAN READ, INSIDE THIS DIALOG.
        //
        // Awaiting the print unguarded turned a refusal into an unhandled exception
        // in an async gap: the button did nothing, said nothing, and the report was
        // "reimprimir no funciona" (iMin D3-504, 2026-10-11).
        onFailure(error.code);
      } catch (_) {
        // A fault the API did not name — no printer for this till is the common one
        // — still has to reach the person who pressed the button.
        onFailure('HARDWARE_RECEIPT_PRINTER_UNAVAILABLE');
      }
    },
    icon: const PosIcon(PosGlyphs.printOutlined),
    label: Text(AppLocalizations.of(dialogContext).reprintReceiptAction),
  );
}
