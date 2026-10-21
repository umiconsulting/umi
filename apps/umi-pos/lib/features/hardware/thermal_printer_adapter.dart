import 'dart:convert';

import '../../shared/receipt_time.dart';
import 'hardware_runtime.dart';
import 'print_trace.dart';
import 'thermal_logo.dart';

enum ThermalAlignment { left, center, right }

sealed class ThermalCommand {
  const ThermalCommand();
}

final class ThermalInitializeCommand extends ThermalCommand {
  const ThermalInitializeCommand();
}

final class ThermalTextCommand extends ThermalCommand {
  const ThermalTextCommand(
    this.text, {
    this.alignment = ThermalAlignment.left,
    this.bold = false,
  });

  final String text;
  final ThermalAlignment alignment;
  final bool bold;
}

final class ThermalFeedCommand extends ThermalCommand {
  const ThermalFeedCommand(this.lines);
  final int lines;
}

final class ThermalQrCommand extends ThermalCommand {
  const ThermalQrCommand(this.value);
  final String value;
}

/// The café's mark, already reduced to what the head draws.
final class ThermalImageCommand extends ThermalCommand {
  const ThermalImageCommand(this.raster);
  final ThermalRaster raster;
}

final class ThermalCutCommand extends ThermalCommand {
  const ThermalCutCommand();
}

final class ThermalDrawerPulseCommand extends ThermalCommand {
  const ThermalDrawerPulseCommand({this.pin = 0, this.onUnits = 25});
  final int pin;
  final int onUnits;
}

final class ThermalDocument {
  const ThermalDocument(this.commands);
  final List<ThermalCommand> commands;

  String get plainText => commands
      .whereType<ThermalTextCommand>()
      .map((command) => command.text)
      .join('\n');
}

/// The words a receipt says, in the language of the café that issues it.
///
/// The paper is read at the counter by a guest and filed for the tax authority, so its
/// language is the MERCHANT's — the API puts `locale` on the print payload from
/// `merchant.merchant.locale` — and not whichever language the operator chose for their
/// own screen. Before this existed the labels were English literals inside the renderer,
/// so a Spanish café printed "Subtotal / Tax / TOTAL" under a header that already said
/// "Orden 004" (owner, 2026-10-12).
final class ThermalReceiptLabels {
  const ThermalReceiptLabels({
    required this.order,
    required this.ticket,
    required this.originalTicket,
    required this.time,
    required this.refund,
    required this.voidSale,
    required this.subtotal,
    required this.discount,
    required this.tax,
    required this.tip,
    required this.total,
    required this.change,
    required this.copy,
    required this.thanks,
    required this.tender,
  });

  /// The label set for a locale tag: 'es-MX' and 'en-US' both land on a set, and
  /// anything unknown lands on Spanish — the language this pilot's documents are in.
  factory ThermalReceiptLabels.forLanguage(String? locale) {
    final language = (locale ?? '')
        .trim()
        .toLowerCase()
        .split(RegExp('[-_]'))
        .first;
    return language == 'en'
        ? ThermalReceiptLabels.english
        : ThermalReceiptLabels.spanish;
  }

  final String order;
  final String ticket;
  final String originalTicket;

  /// The word in front of the hour the paper carries.
  final String time;
  final String refund;
  final String voidSale;
  final String subtotal;
  final String discount;
  final String tax;
  final String tip;
  final String total;
  final String change;
  final String copy;

  /// The last line of the paper: what a customer reads when the transaction is over.
  final String thanks;

  /// Tender names by the contract's own vocabulary, not by whatever the tender printed.
  final Map<String, String> tender;

  static const spanish = ThermalReceiptLabels(
    order: 'Orden',
    ticket: 'Ticket',
    originalTicket: 'Ticket original',
    time: 'Hora',
    refund: 'REEMBOLSO',
    voidSale: 'ANULACIÓN',
    subtotal: 'Subtotal',
    discount: 'Descuento',
    tax: 'Impuestos',
    tip: 'Propina',
    total: 'TOTAL',
    change: 'Cambio',
    copy: 'COPIA',
    thanks: 'Gracias por su visita',
    tender: {
      'cash': 'Efectivo',
      'manual_terminal': 'Tarjeta',
      'bank_transfer': 'Transferencia bancaria',
      'wallet': 'Monedero',
      'gift_card': 'Tarjeta de regalo',
      'other': 'Otro',
    },
  );

  static const english = ThermalReceiptLabels(
    order: 'Order',
    ticket: 'Ticket',
    originalTicket: 'Original ticket',
    time: 'Time',
    refund: 'REFUND',
    voidSale: 'VOID',
    subtotal: 'Subtotal',
    discount: 'Discount',
    tax: 'Tax',
    tip: 'Tip',
    total: 'TOTAL',
    change: 'Change',
    copy: 'COPY',
    thanks: 'Thank you for your visit',
    tender: {
      'cash': 'Cash',
      'manual_terminal': 'Card',
      'bank_transfer': 'Bank transfer',
      'wallet': 'Wallet',
      'gift_card': 'Gift card',
      'other': 'Other',
    },
  );
}

final class ThermalReceiptRenderer {
  const ThermalReceiptRenderer({
    this.widthColumns = 42,
    this.maximumCharacters = 32000,
    this.labels = ThermalReceiptLabels.spanish,
  }) : assert(widthColumns >= 20 && widthColumns <= 120),
       assert(maximumCharacters > 0);

  final int widthColumns;
  final int maximumCharacters;

  /// The language the paper speaks. Spanish unless the café's locale says otherwise.
  final ThermalReceiptLabels labels;

  ThermalDocument render(
    Map<String, Object?> receipt, {
    required Set<String> capabilities,
    bool copy = false,
    ThermalRaster? logoRaster,

    /// The head's width in dots, for centring the mark. Zero means "derive it
    /// from the columns", which is what a caller that only knows the paper size
    /// should say.
    int paperWidthDots = 0,
  }) {
    final commands = <ThermalCommand>[const ThermalInitializeCommand()];
    final paperDots = paperWidthDots > 0 ? paperWidthDots : widthColumns * 12;
    void text(
      String value, {
      ThermalAlignment alignment = ThermalAlignment.left,
      bool bold = false,
    }) {
      for (final line in _wrap(value)) {
        commands.add(
          ThermalTextCommand(line, alignment: alignment, bold: bold),
        );
      }
    }

    // A REPRINT IS A COPY, AND THE PAPER SAYS WHICH COPY IT IS.
    //
    // The word is Spanish because the paper is read here, and the café answers to
    // PROFECO and the SAT in Spanish. The count comes from the receipt's own
    // impressions — the print jobs the API has already written for this receipt — so
    // the original goes out clean, the next one says COPIA, and the one after COPIA
    // 2. Two copies used to be indistinguishable from each other and from the sale's
    // own paper (owner, 2026-10-12).
    final copyIndex = switch (receipt['copyIndex']) {
      final num index when index > 0 => index.toInt(),
      _ => copy ? 1 : 0,
    };
    if (copyIndex > 0) {
      text(
        copyIndex == 1 ? labels.copy : '${labels.copy} $copyIndex',
        alignment: ThermalAlignment.center,
        bold: true,
      );
    }
    // The café's own mark, at the head of the paper, the way a printed receipt
    // carries one. Only when the head can draw it: a printer without
    // `printer.image` gets the same receipt without the picture rather than a
    // command it would print as garbage.
    if (logoRaster != null &&
        !logoRaster.isEmpty &&
        capabilities.contains('printer.image')) {
      // THE MARK IS CENTRED HERE, NOT BY THE HEAD.
      //
      // `GS v 0` draws from the left margin and this family ignores the
      // justification setting for a raster, so on an 80 mm head the mark sat at
      // the paper's left edge while the name under it was centred — the till's own
      // report, Epson TM-T20IIIL, 2026-10-11. `centredOn` pads the 1-bit layout
      // with white dots, which is the one way that is true of every head.
      //
      // The paper's dot width is derived from the columns the printer is
      // configured with, because that is the number the operator already set and
      // the standard font advances twelve dots per column. A 58 mm head is 32
      // columns (384 dots) and an 80 mm one 48 (576), which is what the mark is
      // measured against; a head configured narrower than the mark keeps the mark
      // as it is rather than cropping it.
      commands.add(ThermalImageCommand(logoRaster.centredOn(paperDots)));
      commands.add(const ThermalFeedCommand(1));
    }
    final merchantName = _requiredString(receipt, 'merchantName');
    text(merchantName, alignment: ThermalAlignment.center, bold: true);
    // THE BRANCH IS NAMED ONLY WHEN IT SAYS SOMETHING THE NAME DID NOT.
    //
    // Measured on the iMin D3-504, 2026-10-13: the merchant and its only location are both
    // called "ONCA", so the head of every receipt said it twice — two identical lines where
    // a customer looks for the café and, when there is one, for the branch. A café with one
    // shop prints its name; a café with several prints the one the guest is standing in,
    // which is the case the location line was added for.
    final locationName = _requiredString(receipt, 'locationName');
    if (locationName.trim().toLowerCase() !=
        merchantName.trim().toLowerCase()) {
      text(locationName, alignment: ThermalAlignment.center);
    }
    final register = receipt['registerName'];
    if (register is String && register.trim().isNotEmpty) {
      text(register.trim(), alignment: ThermalAlignment.center);
    }
    final exceptionMarker = receipt['exceptionMarker'];
    if (exceptionMarker == 'refund' || exceptionMarker == 'void') {
      text(
        exceptionMarker == 'void' ? labels.voidSale : labels.refund,
        alignment: ThermalAlignment.center,
        bold: true,
      );
    }
    // THE ORDER FIRST, THE DOCUMENT UNDER IT.
    //
    // "Orden 131" is the number the crew calls out and the guest recognises; the folio
    // below it is the document's own consecutive number, which is what the tax rule
    // asks for and what the back office counts with. Two questions, two numbers, each
    // where it is looked for (owner, 2026-10-12).
    final orderNumber = receipt['orderNumber'];
    if (orderNumber is String && orderNumber.trim().isNotEmpty) {
      text(
        '${labels.order} ${orderNumber.trim()}',
        alignment: ThermalAlignment.center,
        bold: true,
      );
    }
    // THE TICKET LINE IS FOR A NUMBER, NOT FOR A KEY.
    //
    // The folio the counter issues is four digits and wider once a branch sells past
    // 9999; a receipt frozen before the counter existed carries `POS-<uuid>` in the
    // same field, and printing that on the paper is exactly what the owner rejected
    // (2026-10-12): the UUID is the key, it belongs in the barcode, and a person
    // cannot read it, dictate it or use it. Those old papers keep the order number at
    // the head and no ticket line at all. `_shortTicketFolio` is the same rule the
    // receipt on screen follows.
    final ticketNumber = _requiredString(receipt, 'receiptNumber');
    if (RegExp(r'^\d{4,}$').hasMatch(ticketNumber) ||
        RegExp(r'^[A-Z]{2}-\d{3,}$').hasMatch(ticketNumber)) {
      text(
        // A refund receipt's own number arrives prefixed (`EX-0042`), so the line names
        // the document it is on.
        '${labels.ticket} $ticketNumber',
        alignment: ThermalAlignment.center,
      );
    }
    final originalTicket = receipt['originalReceiptNumber'];
    if (originalTicket is String &&
        (RegExp(r'^\d{4,}$').hasMatch(originalTicket) ||
            RegExp(r'^[A-Z]{2}-\d{3,}$').hasMatch(originalTicket))) {
      text(
        '${labels.originalTicket} $originalTicket',
        alignment: ThermalAlignment.center,
      );
    }
    text(
      _requiredString(receipt, 'businessDate'),
      alignment: ThermalAlignment.center,
    );
    // THE HOUR, so two tickets of one afternoon are not the same ticket. The value arrives in
    // the café's own timezone (see `receiptClockTime`), which is why it is printed as it comes
    // instead of being shifted into whatever zone this till is set to.
    final issuedAt = receipt['issuedAt'];
    final clock = issuedAt is String ? receiptClockTime(issuedAt) : null;
    if (clock != null) {
      text('${labels.time} $clock', alignment: ThermalAlignment.center);
    }
    text('-' * widthColumns);

    final items = receipt['items'];
    if (items is List) {
      for (final raw in items.take(500)) {
        if (raw is! Map) continue;
        final item = Map<String, Object?>.from(raw);
        final quantity = _int(item['quantity']);
        final total = _int(item['totalMinorUnits']);
        text(
          _columns(
            '$quantity x ${_string(item['name'])}',
            _money(receipt, total),
          ),
        );
        final modifiers = item['modifiers'];
        if (modifiers is List) {
          for (final modifier in modifiers.take(40)) {
            text('  + ${_string(modifier)}');
          }
        }
      }
    }

    text('-' * widthColumns);
    _amountLine(text, receipt, labels.subtotal, 'subtotalMinorUnits');
    if (_int(receipt['discountMinorUnits']) > 0) {
      _amountLine(text, receipt, labels.discount, 'discountMinorUnits');
    }
    _amountLine(text, receipt, labels.tax, 'taxMinorUnits');
    // THE TIP ALWAYS HAS ITS ROW, EVEN WHEN IT IS ZERO.
    //
    // A guest who leaves a tip looks for it, and one who does not leave one benefits from
    // seeing that nothing was added. The total above the tenders already includes the tip
    // (`amountDue = subtotal + tip` in the checkout calculator), so the row explains a figure
    // the reader can add up.
    _amountLine(text, receipt, labels.tip, 'tipMinorUnits');
    text(
      _columns(labels.total, _money(receipt, _int(receipt['totalMinorUnits']))),
      bold: true,
    );

    final tenders = receipt['tenders'];
    if (tenders is List && tenders.isNotEmpty) {
      text('-' * widthColumns);
      for (final raw in tenders.take(16)) {
        if (raw is! Map) continue;
        final tender = Map<String, Object?>.from(raw);
        final reference = tender['maskedReference'];
        final label = [
          _tenderLabel(_string(tender['type'])),
          if (reference is String && reference.trim().isNotEmpty)
            reference.trim(),
        ].join(' ');
        text(
          _columns(label, _money(receipt, _int(tender['amountMinorUnits']))),
        );
      }
    }
    if (_int(receipt['changeMinorUnits']) > 0) {
      text(
        _columns(
          labels.change,
          _money(receipt, _int(receipt['changeMinorUnits'])),
        ),
      );
    }

    for (final key in ['loyaltySummary', 'customerValueSummary']) {
      final value = receipt[key];
      if (value is String && value.trim().isNotEmpty) text(value.trim());
    }

    // NO QR AND NO PRINT CODE ON THE CUSTOMER'S PAPER (owner, 2026-10-13).
    //
    // The QR carried UMI's own expression (`UMI1|R=…|T=…`) and nothing could read it: the
    // till drew it and neither the app nor the dashboard resolved it, so it promised the
    // guest something the product does not do. On a head with no `printer.qr` it got worse
    // and printed the raw string. The `impressionId` line was a name for the print JOB, and
    // it belongs in `merchant.hardware_print_job`, where support reads it — not in the hand
    // of the person paying. Both stay in the payload and in the record: the expression is
    // the point of departure for a reader or a self-invoicing portal, and the paper simply
    // stops carrying them. What a customer reads at the end is a thank-you.
    final footer = receipt['footer'];
    if (footer is String && footer.trim().isNotEmpty) {
      text(footer.trim(), alignment: ThermalAlignment.center);
    }
    text(labels.thanks, alignment: ThermalAlignment.center);
    commands.add(const ThermalFeedCommand(2));
    text(
      'Powered by Umi: umiconsulting.co',
      alignment: ThermalAlignment.center,
    );
    commands.add(const ThermalFeedCommand(3));
    if (capabilities.contains('printer.cut')) {
      commands.add(const ThermalCutCommand());
    }

    final document = ThermalDocument(List.unmodifiable(commands));
    final characterCount =
        document.plainText.length +
        document.commands.whereType<ThermalQrCommand>().fold<int>(
          0,
          (total, command) => total + command.value.length,
        ) +
        document.commands.whereType<ThermalImageCommand>().fold<int>(
          0,
          (total, command) => total + command.raster.rows.length,
        );
    if (characterCount > maximumCharacters) {
      throw const FormatException('THERMAL_DOCUMENT_TOO_LARGE');
    }
    return document;
  }

  void _amountLine(
    void Function(String, {ThermalAlignment alignment, bool bold}) text,
    Map<String, Object?> receipt,
    String label,
    String key,
  ) => text(_columns(label, _money(receipt, _int(receipt[key]))));

  String _money(Map<String, Object?> receipt, int minorUnits) {
    final currency = _requiredString(receipt, 'currency');
    final sign = minorUnits < 0 ? '-' : '';
    final value = minorUnits.abs();
    return '$currency $sign${value ~/ 100}.${(value % 100).toString().padLeft(2, '0')}';
  }

  String _columns(String left, String right) {
    final rightWidth = right.length.clamp(0, widthColumns - 1);
    final leftWidth = widthColumns - rightWidth - 1;
    final safeLeft = left.length > leftWidth
        ? left.substring(0, leftWidth)
        : left;
    return '$safeLeft${' ' * (widthColumns - safeLeft.length - right.length)}$right';
  }

  Iterable<String> _wrap(String value) sync* {
    final normalized = value.replaceAll(RegExp(r'[\r\n\t]+'), ' ').trim();
    if (normalized.isEmpty) {
      yield '';
      return;
    }
    var remaining = normalized;
    while (remaining.length > widthColumns) {
      var split = remaining.lastIndexOf(' ', widthColumns);
      if (split < 1) split = widthColumns;
      yield remaining.substring(0, split).trimRight();
      remaining = remaining.substring(split).trimLeft();
    }
    yield remaining;
  }

  String _requiredString(Map<String, Object?> value, String key) {
    final result = _string(value[key]);
    if (result.isEmpty) throw FormatException('THERMAL_RECEIPT_MISSING_$key');
    return result;
  }

  String _string(Object? value) => value?.toString().trim() ?? '';
  int _int(Object? value) => value is num ? value.toInt() : 0;

  String _tenderLabel(String value) => switch (value) {
    'cash' => labels.tender['cash']!,
    'manual_terminal' => labels.tender['manual_terminal']!,
    'bank_transfer' => labels.tender['bank_transfer']!,
    'wallet' => labels.tender['wallet']!,
    'gift_card' => labels.tender['gift_card']!,
    _ => labels.tender['other']!,
  };
}

final class ThermalTextEncoder {
  const ThermalTextEncoder.cp850() : utf8Mode = false;
  const ThermalTextEncoder.utf8() : utf8Mode = true;

  final bool utf8Mode;

  List<int> encode(String value) {
    if (utf8Mode) return utf8.encode(value);
    return value.runes
        .map((rune) => _cp850[rune] ?? (rune <= 0x7f ? rune : 0x3f))
        .toList();
  }

  static const Map<int, int> _cp850 = {
    0x00c1: 0xb5,
    0x00c9: 0x90,
    0x00cd: 0xd6,
    0x00d3: 0xe0,
    0x00da: 0xe9,
    0x00dc: 0x9a,
    0x00d1: 0xa5,
    0x00e1: 0xa0,
    0x00e9: 0x82,
    0x00ed: 0xa1,
    0x00f3: 0xa2,
    0x00fa: 0xa3,
    0x00fc: 0x81,
    0x00f1: 0xa4,
    0x00bf: 0xa8,
    0x00a1: 0xad,
  };
}

final class ThermalEscPosEncoder {
  const ThermalEscPosEncoder({
    this.textEncoder = const ThermalTextEncoder.cp850(),
  });

  final ThermalTextEncoder textEncoder;

  List<int> encode(ThermalDocument document) {
    final bytes = <int>[];
    for (final command in document.commands) {
      switch (command) {
        case ThermalInitializeCommand():
          bytes.addAll([0x1b, 0x40]);
          if (!textEncoder.utf8Mode) bytes.addAll([0x1b, 0x74, 0x02]);
        case ThermalTextCommand(:final text, :final alignment, :final bold):
          bytes.addAll([0x1b, 0x61, alignment.index]);
          bytes.addAll([0x1b, 0x45, bold ? 1 : 0]);
          bytes.addAll(textEncoder.encode(text));
          bytes.add(0x0a);
        case ThermalFeedCommand(:final lines):
          bytes.addAll([0x1b, 0x64, lines.clamp(0, 255)]);
        case ThermalQrCommand(:final value):
          final data = utf8.encode(value);
          final size = data.length + 3;
          bytes.addAll([
            0x1d,
            0x28,
            0x6b,
            size & 0xff,
            size >> 8,
            0x31,
            0x50,
            0x30,
          ]);
          bytes.addAll(data);
          bytes.addAll([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);
        // `GS v 0` — raster bit image, normal density. The height and the bytes per
        // row travel in the command, so the head draws exactly the block it was
        // handed and nothing has to be inferred.
        case ThermalImageCommand(:final raster):
          final bytesPerRow = raster.bytesPerRow;
          bytes.addAll([
            0x1d,
            0x76,
            0x30,
            0x00,
            bytesPerRow & 0xff,
            (bytesPerRow >> 8) & 0xff,
            raster.heightDots & 0xff,
            (raster.heightDots >> 8) & 0xff,
          ]);
          bytes.addAll(raster.rows);
        case ThermalCutCommand():
          bytes.addAll([0x1d, 0x56, 0x00]);
        case ThermalDrawerPulseCommand(:final pin, :final onUnits):
          bytes.addAll([
            0x1b,
            0x70,
            pin.clamp(0, 1),
            onUnits.clamp(1, 255),
            0xfa,
          ]);
      }
    }
    return List.unmodifiable(bytes);
  }
}

enum HardwareByteTransportOutcome { sent, notSent, unknown }

final class HardwareByteTransportResult {
  const HardwareByteTransportResult.sent()
    : outcome = HardwareByteTransportOutcome.sent,
      failureCode = null;
  const HardwareByteTransportResult.notSent({this.failureCode = 'disconnected'})
    : outcome = HardwareByteTransportOutcome.notSent;
  const HardwareByteTransportResult.unknown({
    this.failureCode = 'unknown_outcome',
  }) : outcome = HardwareByteTransportOutcome.unknown;

  final HardwareByteTransportOutcome outcome;
  final String? failureCode;
}

final class HardwareByteTransportHealth {
  const HardwareByteTransportHealth.connected({required this.latencyMs})
    : state = 'connected',
      failureCode = null;
  const HardwareByteTransportHealth.disconnected({
    this.failureCode = 'disconnected',
  }) : state = 'disconnected',
       latencyMs = null;

  final String state;
  final int? latencyMs;
  final String? failureCode;
}

abstract interface class HardwareByteTransport {
  Future<HardwareByteTransportResult> send(List<int> bytes);
  Future<HardwareByteTransportHealth> health();
  Future<void> close();
}

/// A link whose routine health sweep can use what its last real operation
/// proved, instead of putting another command on the paper path.
///
/// USB is one serial resource: a background `DLE EOT` query and a receipt
/// cannot happen together. The hardware centre and a diagnostic call [health]
/// because the operator asked for a measurement now; the periodic sweep asks
/// this method and records the last send or probe.
abstract interface class BackgroundHardwareHealth {
  Future<HardwareByteTransportHealth> backgroundHealth();
}

final class GenericThermalPrinterAdapter implements DeviceAdapter {
  GenericThermalPrinterAdapter({
    required this.byteTransport,
    required Set<String> capabilities,
    this.widthColumns = 42,
    this.maximumDocumentBytes = 65536,
    this.imageWidthDots = kThermalLogoWidthDots,
    ThermalLogoSource? logoSource,
    ThermalTextEncoder textEncoder = const ThermalTextEncoder.cp850(),
  }) : capabilities = Set.unmodifiable(capabilities),
       _logoSource = logoSource,
       _encoder = ThermalEscPosEncoder(textEncoder: textEncoder);

  final HardwareByteTransport byteTransport;
  @override
  final Set<String> capabilities;
  final int widthColumns;
  final int maximumDocumentBytes;

  /// How wide a mark this head draws. 384 dots is the 58 mm full width and half
  /// the 80 mm one, which is where a receipt mark belongs on either.
  final int imageWidthDots;

  /// The head's own width in dots — what the mark is centred within.
  ///
  /// Twelve dots per column is the advance of the standard font every one of these
  /// heads prints with, so the configured column count is the paper width already
  /// stated in another unit: 32 columns is 384 dots (58 mm) and 48 is 576 (80 mm).
  int get paperWidthDots => widthColumns * 12;

  final ThermalLogoSource? _logoSource;
  final ThermalEscPosEncoder _encoder;

  @override
  String get deviceType => 'printer';
  @override
  String get transport => 'network_tcp';

  @override
  Future<RuntimeCommandResult> execute(RuntimeCommand command) async {
    if (command.type == 'query_printer_status' ||
        command.type == 'run_diagnostic') {
      final status = await byteTransport.health();
      return RuntimeCommandResult(
        status: status.state == 'connected'
            ? RuntimeCommandStatus.succeeded
            : RuntimeCommandStatus.retryable,
        failureCode: status.failureCode,
        retryable: status.state != 'connected',
        recovered: false,
        safeMetadata: {
          'latencyMs': status.latencyMs,
          'connectionState': status.state,
        },
      );
    }
    final dispatchStarted = Stopwatch()..start();
    var documentBuildMs = 0;
    var encodeMs = 0;
    var writeMs = 0;
    try {
      printTrace('printer.document_start', {
        'bytesLimit': maximumDocumentBytes,
        'columns': widthColumns,
      });
      final documentStarted = Stopwatch()..start();
      final document = command.type == 'print_test_page'
          ? _testDocument()
          : await _receiptDocument(command);
      documentBuildMs = documentStarted.elapsedMilliseconds;
      printTrace('printer.document_done', {
        'documentMs': documentBuildMs,
        'commands': document.commands.length,
      });
      final encodeStarted = Stopwatch()..start();
      final bytes = _encoder.encode(document);
      encodeMs = encodeStarted.elapsedMilliseconds;
      printTrace('printer.encode_done', {
        'encodeMs': encodeMs,
        'bytes': bytes.length,
      });
      if (bytes.length > maximumDocumentBytes) {
        return const RuntimeCommandResult(
          status: RuntimeCommandStatus.failed,
          failureCode: 'terminal_hardware_failure',
          retryable: false,
          recovered: false,
          safeMetadata: {'statusMessage': 'THERMAL_DOCUMENT_TOO_LARGE'},
        );
      }
      final writeStarted = Stopwatch()..start();
      printTrace('printer.usb_write_start', {'bytes': bytes.length});
      final result = await byteTransport.send(bytes);
      writeMs = writeStarted.elapsedMilliseconds;
      printTrace('printer.usb_write_done', {
        'writeMs': writeMs,
        'outcome': result.outcome.name,
        'failure': result.failureCode,
      });
      return _runtimeResult(
        result,
        latencyMs: dispatchStarted.elapsedMilliseconds,
      );
    } on FormatException catch (error) {
      return RuntimeCommandResult(
        status: RuntimeCommandStatus.failed,
        failureCode: 'terminal_hardware_failure',
        retryable: false,
        recovered: false,
        safeMetadata: {'statusMessage': error.message},
      );
    }
  }

  /// The receipt, with the café's mark fetched first when the head can draw one.
  ///
  /// The fetch is here and not in the renderer because it is the one part that
  /// needs a network: the renderer stays a pure function of what it is given, and a
  /// mark that cannot be fetched simply is not there.
  Future<ThermalDocument> _receiptDocument(RuntimeCommand command) async {
    final payload = command.safePayload;
    ThermalRaster? logo;
    final url = payload['logoUrl'];
    if (capabilities.contains('printer.image') &&
        _logoSource != null &&
        url is String &&
        url.trim().isNotEmpty) {
      logo = await _logoSource.raster(url.trim(), widthDots: imageWidthDots);
    }
    return ThermalReceiptRenderer(
      widthColumns: widthColumns,
      // The paper speaks the café's language: the API puts the merchant's locale on the
      // payload, and a payload from an older build (no locale) falls back to Spanish.
      labels: ThermalReceiptLabels.forLanguage(payload['locale'] as String?),
    ).render(
      payload,
      capabilities: capabilities,
      // A controlled reprint of an existing job, or the first impression of a
      // receipt printed from the sales history — both are duplicates of a sale
      // that has already happened, and the paper says so (see
      // `ReceiptPrintPayload.copy`).
      copy: command.type == 'controlled_reprint' || payload['copy'] == true,
      logoRaster: logo,
      paperWidthDots: paperWidthDots,
    );
  }

  ThermalDocument _testDocument() => ThermalDocument([
    const ThermalInitializeCommand(),
    const ThermalTextCommand(
      'UmiPOS printer test',
      alignment: ThermalAlignment.center,
      bold: true,
    ),
    const ThermalTextCommand(
      'Generic thermal adapter',
      alignment: ThermalAlignment.center,
    ),
    const ThermalFeedCommand(3),
    if (capabilities.contains('printer.cut')) const ThermalCutCommand(),
  ]);
}

final class PrinterAttachedDrawerAdapter implements DeviceAdapter {
  PrinterAttachedDrawerAdapter({
    required this.byteTransport,
    this.pin = 0,
    this.pulseOnUnits = 25,
  });

  final HardwareByteTransport byteTransport;
  final int pin;
  final int pulseOnUnits;

  @override
  Set<String> get capabilities => const {'drawer.open', 'drawer.status'};
  @override
  String get deviceType => 'cash_drawer';
  @override
  String get transport => 'printer_attached';

  @override
  Future<RuntimeCommandResult> execute(RuntimeCommand command) async {
    if (command.type == 'query_drawer_status' ||
        command.type == 'run_diagnostic') {
      final status = await byteTransport.health();
      return RuntimeCommandResult(
        status: status.state == 'connected'
            ? RuntimeCommandStatus.succeeded
            : RuntimeCommandStatus.retryable,
        failureCode: status.failureCode,
        retryable: status.state != 'connected',
        recovered: false,
        safeMetadata: {
          'latencyMs': status.latencyMs,
          'connectionState': status.state,
        },
      );
    }
    final bytes = const ThermalEscPosEncoder().encode(
      ThermalDocument([
        ThermalDrawerPulseCommand(pin: pin, onUnits: pulseOnUnits),
      ]),
    );
    return _runtimeResult(await byteTransport.send(bytes));
  }
}

RuntimeCommandResult _runtimeResult(
  HardwareByteTransportResult result, {
  int? latencyMs,
}) {
  final metadata = Map<String, Object?>.unmodifiable({'latencyMs': ?latencyMs});
  return switch (result.outcome) {
    HardwareByteTransportOutcome.sent => RuntimeCommandResult(
      status: RuntimeCommandStatus.succeeded,
      failureCode: null,
      retryable: false,
      recovered: false,
      safeMetadata: {'acknowledged': true, ...metadata},
    ),
    HardwareByteTransportOutcome.notSent => RuntimeCommandResult(
      status: RuntimeCommandStatus.retryable,
      failureCode: result.failureCode ?? 'retryable_transport_failure',
      retryable: true,
      recovered: false,
      safeMetadata: metadata,
    ),
    HardwareByteTransportOutcome.unknown => RuntimeCommandResult(
      status: RuntimeCommandStatus.unknown,
      failureCode: result.failureCode ?? 'unknown_outcome',
      retryable: false,
      recovered: false,
      safeMetadata: metadata,
    ),
  };
}
