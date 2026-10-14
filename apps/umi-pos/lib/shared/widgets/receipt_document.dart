import 'dart:math' as math;

import 'package:umi_contract/umi_contract.dart';

import '../../core/config/api_assets.dart';
import '../../core/errors/operator_error_message.dart';
import '../../core/localization/app_localizations.dart';
import '../../core/theme/pos_ui.dart';
import '../../core/theme/umi_theme.dart';
import '../money.dart';
import '../receipt_time.dart';
import 'inline_notice.dart';
import 'receipt_paper.dart';
import 'station_document.dart';

/// What a screen has to provide so the receipt dialog can offer a print button.
///
/// The receipt's own id and the snapshot the paper was drawn from: the server
/// rebuilds the payload from its stored snapshot whatever the till sends (a till
/// must not be able to print a receipt nobody issued), so this map is what names
/// the document, not what decides its content.
typedef ReceiptPrintRequest =
    Future<void> Function(
      String receiptId,
      Map<String, Object?> receiptSnapshot,
    );

/// The print control the dialog renders, given a way to report a refusal.
typedef ReceiptPrintAction =
    Widget Function(
      BuildContext dialogContext,
      void Function(String code) onFailure,
    );

Future<void> showReceiptDocument(
  BuildContext context,
  ReceiptSnapshot receipt, {
  /**
   * The print action, plus the way for it to SAY WHY IT COULD NOT PRINT.
   *
   * The action is built by the caller, so the caller is the only one that can
   * catch its refusal — and until this callback existed nothing rendered it. A
   * till with no printer attached raised `Bad state:
   * HARDWARE_RECEIPT_PRINTER_UNAVAILABLE` into an unhandled async gap (iMin
   * D3-504, 2026-10-11): the button did nothing at all, no paper and no sentence,
   * on the reprint the owner was asking about. `onFailure` hands the code back to
   * the dialog that is already open, which is where the operator is looking.
   */
  ReceiptPrintAction? printAction,
}) => showPosDialog<void>(
  context: context,
  builder: (dialogContext) =>
      _ReceiptDialog(receipt: receipt, printAction: printAction),
);

class _ReceiptDialog extends StatefulWidget {
  const _ReceiptDialog({required this.receipt, this.printAction});
  final ReceiptSnapshot receipt;
  final ReceiptPrintAction? printAction;

  @override
  State<_ReceiptDialog> createState() => _ReceiptDialogState();
}

class _ReceiptDialogState extends State<_ReceiptDialog> {
  final controller = ScrollController(keepScrollOffset: false);

  /// Notified the moment the operator asks for a print: the paper's own cue to
  /// feed. Opening the dialog is reading, not printing.
  final _prints = _PrinterCue();

  /// The last refusal the print action reported, drawn inside this dialog because
  /// that is where the operator pressed the button.
  String? _printFailure;

  @override
  void dispose() {
    _prints.dispose();
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final side = MediaQuery.sizeOf(context).width < 500 ? 16.0 : 24.0;
    // The controller also owns keyboard scrolling from the fixed actions.
    return PrimaryScrollController(
      controller: controller,
      child: PosDialog(
        insetPadding: EdgeInsets.all(side),
        constraints: const BoxConstraints(maxWidth: 568),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(side, 24, side, 0),
              child: StationHeading(title: l.receiptDocumentTitle),
            ),
            Flexible(
              child: ReceiptPaper(
                slotLabel: l.receiptDocumentTitle,
                prints: _prints,
                child: ReceiptDocument(
                  receipt: widget.receipt,
                  // The extra tear's worth of room at the bottom keeps the
                  // closing lines — the thank-you — above the paper's teeth
                  // when the sheet is scrolled to its end.
                  padding: EdgeInsets.fromLTRB(
                    side,
                    16,
                    side,
                    24 + kReceiptTearDepth,
                  ),
                ),
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(side, 0, side, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_printFailure case final String code) ...[
                    InlineNotice(
                      message: operatorErrorMessage(context, code),
                      tone: InlineNoticeTone.error,
                    ),
                    const SizedBox(height: UmiSpacing.sm),
                  ],
                  Wrap(
                    alignment: WrapAlignment.end,
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      if (widget.printAction != null)
                        // A pointer down on the print action is the printer
                        // starting, whatever the action then does with it.
                        Listener(
                          onPointerDown: (_) => _prints.notify(),
                          child: widget.printAction!(context, (code) {
                            if (!mounted) return;
                            setState(() => _printFailure = code);
                          }),
                        ),
                      PosTextButton(
                        autofocus: true,
                        onPressed: () => Navigator.pop(context),
                        child: Text(l.closeAction),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The cue the dialog fires when the operator asks for a print, so the paper
/// feeds at that moment and not when the sheet is opened.
final class _PrinterCue extends ChangeNotifier {
  void notify() => notifyListeners();
}

/// A thermal receipt is monospaced paper: the platform's own mono face, so the
/// columns line up the way the photos of real receipts do.
TextStyle _mono(
  PosThemeData theme, {
  double? size,
  FontWeight? weight,
  Color? color,
}) => (theme.textTheme.bodyMedium ?? const TextStyle()).copyWith(
  fontFamily: 'monospace',
  fontSize: size,
  fontWeight: weight,
  color: color ?? theme.colorScheme.onSurface,
  fontFeatures: const [FontFeature.tabularFigures()],
);

/// The ticket folio the counter issues: four digits, and wider than four once a branch has
/// sold past 9999. A receipt that does not match is one issued before the counter existed
/// (`POS-<uuid>`), and it is set as fine print instead.
final _shortTicketFolio = RegExp(r'^\d{4,}$');

/// The dashed line a printer draws between sections of a receipt.
final class PosDashedRule extends StatelessWidget {
  const PosDashedRule({super.key});

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 1,
    width: double.infinity,
    child: CustomPaint(
      painter: _Dashes(color: PosTheme.of(context).colorScheme.outlineVariant),
    ),
  );
}

final class _Dashes extends CustomPainter {
  const _Dashes({required this.color});
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1;
    const dash = 3.0;
    const gap = 3.0;
    var x = 0.0;
    while (x < size.width) {
      canvas.drawLine(
        Offset(x, size.height / 2),
        Offset(math.min(x + dash, size.width), size.height / 2),
        paint,
      );
      x += dash + gap;
    }
  }

  @override
  bool shouldRepaint(_Dashes oldPainter) => oldPainter.color != color;
}

class ReceiptDocument extends StatelessWidget {
  const ReceiptDocument({
    required this.receipt,
    this.padding = EdgeInsets.zero,
    super.key,
  });
  final ReceiptSnapshot receipt;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) => CustomScrollView(
    primary: true,
    semanticChildCount: receipt.lines.length,
    // The dialog gives this viewport a finite height. Short documents keep
    // their natural height; long documents build only nearby line widgets.
    shrinkWrap: true,
    slivers: [
      SliverPadding(
        padding: padding,
        sliver: SliverMainAxisGroup(
          slivers: [
            SliverToBoxAdapter(child: _ReceiptHeader(receipt: receipt)),
            SliverList.builder(
              itemCount: receipt.lines.length,
              itemBuilder: (context, index) => _ReceiptLine(
                key: ValueKey('receipt-line-$index'),
                line: ReceiptLineSnapshot.fromJson(receipt.lines[index]),
              ),
            ),
            SliverToBoxAdapter(child: _ReceiptTotals(receipt: receipt)),
          ],
        ),
      ),
    ],
  );
}

class _ReceiptHeader extends StatelessWidget {
  const _ReceiptHeader({required this.receipt});
  final ReceiptSnapshot receipt;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = PosTheme.of(context);
    // The fine print, the size a real receipt uses for its date and operator.
    final small = _mono(
      theme,
      size: 11,
      color: theme.colorScheme.onSurfaceVariant,
    );
    // The hour the paper carries, in the café's own clock. What was here sliced the first eight
    // characters after the `T`, which is the right answer only for a value that is already
    // local: the instant arrives in the LOCATION's timezone, and a UTC value falls back to this
    // device's zone. See `receiptClockTime`.
    final clock = receiptClockTime(receipt.issuedAt);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (receipt.merchantLogoUrl case final String url when url.isNotEmpty)
          _ReceiptLogo(url: url),
        if (receipt.merchantName case final String name when name.isNotEmpty)
          Text(
            name.toUpperCase(),
            textAlign: TextAlign.center,
            style: _mono(theme, weight: FontWeight.w700, size: 15),
          ),
        if (receipt.locationName case final String name when name.isNotEmpty)
          Text(name, textAlign: TextAlign.center, style: small),
        const SizedBox(height: UmiSpacing.sm),
        const PosDashedRule(),
        const SizedBox(height: UmiSpacing.sm),
        // THE TICKET NUMBER, AT THE SIZE A PERSON READS — AND ONLY WHEN IT IS ONE.
        //
        // It is a short folio now — `0042`, from `merchant.receipt_counter` — so it takes
        // the clear line a receipt gives its number and the cashier can say it out loud.
        // A receipt issued before the counter existed carries `POS-<uuid>` in the same
        // field, and that is a KEY: it belongs in the code the PAPER carries (the real QR
        // the API builds into the print payload), and printing it again as fine print put
        // a string nobody can read, dictate or use in front of the guest (owner,
        // 2026-10-12). The frozen receipt is not rewritten; the line simply is not a
        // ticket number.
        if (_shortTicketFolio.hasMatch(receipt.receiptRef))
          PosSelectableText(
            '${l.receiptTicketLabel} ${receipt.receiptRef}'.toUpperCase(),
            textAlign: TextAlign.center,
            style: _mono(theme, weight: FontWeight.w700, size: 15),
          ),
        Text(
          '${l.businessDateLabel}: ${receipt.businessDate}',
          style: small,
        ),
        if (clock != null)
          Text('${l.localTimeLabel}: $clock', style: small),
        if (receipt.operatorName case final String name when name.isNotEmpty)
          Text('${l.operatorLabel}: $name', style: small),
        const SizedBox(height: UmiSpacing.sm),
        const PosDashedRule(),
      ],
    );
  }
}

/// The café's own mark at the head of the paper, the way a printed receipt carries
/// one above the name.
///
/// The URL is frozen into the snapshot and content-addressed, so it is the picture
/// the customer's copy showed — and the till may cache it for as long as it likes.
/// Two ways this must not matter: a café with no logo, and a till whose network is
/// down. Both render nothing where the mark would be rather than an empty frame or
/// a moved total, and the paper keeps its own height while the image loads.
class _ReceiptLogo extends StatelessWidget {
  const _ReceiptLogo({required this.url});

  final String url;

  /// Twice the 384-dot head of the paper, so the mark is crisp on a 2× display and
  /// still nowhere near dominating the sheet.
  static const double _height = 56;
  static const double _maxWidth = 220;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: UmiSpacing.sm),
    child: Center(
      child: Image.network(
        // The same repair the paper gets: a receipt frozen with the development
        // loopback address is fetched from the API this till is configured with, so
        // the mark on screen and the mark on the paper come from the same place.
        resolveApiAssetUrl(url),
        height: _height,
        // Aspect ratio is the café's, not ours: contain, never crop the mark.
        fit: BoxFit.contain,
        filterQuality: FilterQuality.medium,
        alignment: Alignment.center,
        errorBuilder: (_, _, _) => const SizedBox.shrink(),
        loadingBuilder: (context, child, progress) => progress == null
            ? child
            : const SizedBox(height: _height, width: _maxWidth),
      ),
    ),
  );
}

class _ReceiptTotals extends StatelessWidget {
  const _ReceiptTotals({required this.receipt});
  final ReceiptSnapshot receipt;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = PosTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        const PosDashedRule(),
        const SizedBox(height: UmiSpacing.sm),
        _ReceiptAmount(label: l.subtotalLabel, amount: receipt.subtotal),
        if (receipt.discountTotal case final Map<String, Object?> discount)
          if ((discount['minorUnits'] as num) != 0)
            _ReceiptAmount(label: l.discountLabel, amount: discount),
        _ReceiptAmount(label: l.receiptTaxLabel, amount: receipt.taxTotal),
        _ReceiptAmount(
          label: l.tipLabel,
          amount: receipt.tip ?? {...receipt.subtotal, 'minorUnits': 0},
        ),
        const SizedBox(height: UmiSpacing.sm),
        _ReceiptAmount(
          label: l.totalLabel,
          amount: receipt.grandTotal,
          emphasized: true,
        ),
        if (receipt.payment case final Map<String, Object?> payment) ...[
          const SizedBox(height: UmiSpacing.sm),
          const PosDashedRule(),
          const SizedBox(height: UmiSpacing.sm),
          if (payment['method'] case final String method when method.isNotEmpty)
            if (payment['applied'] case final Map<String, Object?> applied)
              _ReceiptAmount(label: _methodLabel(l, method), amount: applied),
          if (payment['received'] case final Map<String, Object?> received)
            _ReceiptAmount(label: l.cashReceivedLabel, amount: received),
          if (payment['change'] case final Map<String, Object?> change)
            if ((change['minorUnits'] as num?) != 0)
              _ReceiptAmount(label: l.changeDueLabel, amount: change),
        ],
        const SizedBox(height: UmiSpacing.sm),
        const PosDashedRule(),
        const SizedBox(height: UmiSpacing.sm),
        // What every thermal receipt ends with.
        Text(
          l.receiptThanksMessage,
          textAlign: TextAlign.center,
          style: _mono(theme, weight: FontWeight.w700),
        ),
        const SizedBox(height: UmiSpacing.lg),
        Text(
          'Powered by Umi: umiconsulting.co',
          textAlign: TextAlign.center,
          style: _mono(
            theme,
            size: 11,
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }

  String _methodLabel(AppLocalizations l, String method) => switch (method) {
    'cash' => l.cashPayment,
    'card' || 'card_terminal' || 'manual_terminal' => l.cardPayment,
    'bank_transfer' => l.bankTransferLabel,
    _ => method,
  };
}

class _ReceiptLine extends StatelessWidget {
  const _ReceiptLine({required this.line, super.key});
  final ReceiptLineSnapshot line;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final small = theme.textTheme.bodySmall!.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UmiSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(line.description, style: theme.textTheme.titleMedium),
          if (line.variantName case final String variant
              when variant.isNotEmpty)
            Text(variant, style: small),
          for (final modifier in line.modifiers ?? const <String>[])
            Text(modifier, style: small),
          if (line.note case final String note when note.isNotEmpty)
            Text(note, style: small),
          const SizedBox(height: UmiSpacing.xs),
          _ReceiptAmount(
            label: '${line.quantity} × ${_money(line.unitPrice)}',
            amount: line.lineTotal,
          ),
        ],
      ),
    );
  }
}

class _ReceiptAmount extends StatelessWidget {
  const _ReceiptAmount({
    required this.label,
    required this.amount,
    this.emphasized = false,
  });
  final String label;
  final Map<String, Object?> amount;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final style = emphasized
        ? theme.textTheme.titleLarge
        : theme.textTheme.bodyMedium;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UmiSpacing.xs),
      child: LayoutBuilder(
        builder: (context, box) {
          final name = Text(label, style: style);
          final value = Text(_money(amount), style: style);
          double width(String text) {
            final painter = TextPainter(
              text: TextSpan(text: text, style: style),
              textDirection: Directionality.of(context),
              textScaler: MediaQuery.textScalerOf(context),
            )..layout();
            final result = painter.width;
            painter.dispose();
            return result;
          }

          if (width(label) + width(_money(amount)) + UmiSpacing.md >
              box.maxWidth) {
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [name, value],
            );
          }
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: name),
              const SizedBox(width: UmiSpacing.md),
              value,
            ],
          );
        },
      ),
    );
  }
}

String _money(Map<String, Object?> amount) => formatMinorUnits(
  (amount['minorUnits'] as num).toInt(),
  amount['currency'] as String? ?? '',
);
