import 'dart:convert';

import 'hardware_runtime.dart';

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

final class ThermalReceiptRenderer {
  const ThermalReceiptRenderer({
    this.widthColumns = 42,
    this.maximumCharacters = 32000,
  }) : assert(widthColumns >= 20 && widthColumns <= 120),
       assert(maximumCharacters > 0);

  final int widthColumns;
  final int maximumCharacters;

  ThermalDocument render(
    Map<String, Object?> receipt, {
    required Set<String> capabilities,
    bool copy = false,
  }) {
    final commands = <ThermalCommand>[const ThermalInitializeCommand()];
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

    if (copy) text('COPY', alignment: ThermalAlignment.center, bold: true);
    text(
      _requiredString(receipt, 'merchantName'),
      alignment: ThermalAlignment.center,
      bold: true,
    );
    text(
      _requiredString(receipt, 'locationName'),
      alignment: ThermalAlignment.center,
    );
    final register = receipt['registerName'];
    if (register is String && register.trim().isNotEmpty) {
      text(register.trim(), alignment: ThermalAlignment.center);
    }
    text(
      'Receipt ${_requiredString(receipt, 'receiptNumber')}',
      alignment: ThermalAlignment.center,
    );
    text(
      _requiredString(receipt, 'businessDate'),
      alignment: ThermalAlignment.center,
    );
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
    _amountLine(text, receipt, 'Subtotal', 'subtotalMinorUnits');
    if (_int(receipt['discountMinorUnits']) > 0) {
      _amountLine(text, receipt, 'Discount', 'discountMinorUnits');
    }
    if (_int(receipt['taxMinorUnits']) > 0) {
      _amountLine(text, receipt, 'Tax', 'taxMinorUnits');
    }
    if (_int(receipt['tipMinorUnits']) > 0) {
      _amountLine(text, receipt, 'Tip', 'tipMinorUnits');
    }
    text(
      _columns('TOTAL', _money(receipt, _int(receipt['totalMinorUnits']))),
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
        _columns('Change', _money(receipt, _int(receipt['changeMinorUnits']))),
      );
    }

    for (final key in [
      'loyaltySummary',
      'customerValueSummary',
      'exceptionMarker',
    ]) {
      final value = receipt[key];
      if (value is String && value.trim().isNotEmpty) text(value.trim());
    }

    final qr = receipt['qrValue'];
    if (qr is String && qr.trim().isNotEmpty) {
      if (capabilities.contains('printer.qr')) {
        commands.add(ThermalQrCommand(qr.trim()));
      } else {
        text('QR: ${qr.trim()}');
      }
    }
    final footer = receipt['footer'];
    if (footer is String && footer.trim().isNotEmpty) {
      text(footer.trim(), alignment: ThermalAlignment.center);
    }
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
    'cash' => 'Cash',
    'manual_terminal' => 'Card',
    'wallet' => 'Wallet',
    'gift_card' => 'Gift card',
    _ => 'Other',
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

final class GenericThermalPrinterAdapter implements DeviceAdapter {
  GenericThermalPrinterAdapter({
    required this.byteTransport,
    required Set<String> capabilities,
    this.widthColumns = 42,
    this.maximumDocumentBytes = 65536,
    ThermalTextEncoder textEncoder = const ThermalTextEncoder.cp850(),
  }) : capabilities = Set.unmodifiable(capabilities),
       _encoder = ThermalEscPosEncoder(textEncoder: textEncoder);

  final HardwareByteTransport byteTransport;
  @override
  final Set<String> capabilities;
  final int widthColumns;
  final int maximumDocumentBytes;
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
    try {
      final document = command.type == 'print_test_page'
          ? _testDocument()
          : ThermalReceiptRenderer(widthColumns: widthColumns).render(
              command.safePayload,
              capabilities: capabilities,
              copy: command.type == 'controlled_reprint',
            );
      final bytes = _encoder.encode(document);
      if (bytes.length > maximumDocumentBytes) {
        return const RuntimeCommandResult(
          status: RuntimeCommandStatus.failed,
          failureCode: 'terminal_hardware_failure',
          retryable: false,
          recovered: false,
          safeMetadata: {'statusMessage': 'THERMAL_DOCUMENT_TOO_LARGE'},
        );
      }
      return _runtimeResult(await byteTransport.send(bytes));
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

RuntimeCommandResult _runtimeResult(HardwareByteTransportResult result) =>
    switch (result.outcome) {
      HardwareByteTransportOutcome.sent => const RuntimeCommandResult(
        status: RuntimeCommandStatus.succeeded,
        failureCode: null,
        retryable: false,
        recovered: false,
        safeMetadata: {'acknowledged': true},
      ),
      HardwareByteTransportOutcome.notSent => RuntimeCommandResult(
        status: RuntimeCommandStatus.retryable,
        failureCode: result.failureCode ?? 'retryable_transport_failure',
        retryable: true,
        recovered: false,
      ),
      HardwareByteTransportOutcome.unknown => RuntimeCommandResult(
        status: RuntimeCommandStatus.unknown,
        failureCode: result.failureCode ?? 'unknown_outcome',
        retryable: false,
        recovered: false,
      ),
    };
