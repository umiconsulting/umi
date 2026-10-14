import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/features/hardware/thermal_printer_adapter.dart';

/// THE PAPER SPEAKS THE CAFÉ'S LANGUAGE, NOT THE RENDERER'S.
///
/// The labels used to be English literals inside the renderer, so a Spanish café printed
/// "Subtotal / Tax / TOTAL" under a header that already said "Orden 004" (owner,
/// 2026-10-12). The language now arrives on the payload as `locale`, which the API takes
/// from `merchant.merchant.locale`; the tests below pin both the fallback and the switch.
void main() {
  Map<String, Object?> receipt() => {
    'receiptId': 'd9ff5023-137b-48c5-8e55-5dff58ad5cc8',
    'merchantName': 'ONCA',
    'locationName': 'ONCA',
    'registerName': null,
    'receiptNumber': '0003',
    'orderNumber': '004',
    'businessDate': '2026-10-12',
    'currency': 'MXN',
    'items': [
      {
        'name': 'Capuccino',
        'quantity': 1,
        'totalMinorUnits': 6000,
        'modifiers': <String>[],
      },
    ],
    'subtotalMinorUnits': 6000,
    'discountMinorUnits': 0,
    'taxMinorUnits': 826,
    'tipMinorUnits': 0,
    'totalMinorUnits': 6000,
    'tenders': [
      {'type': 'cash', 'amountMinorUnits': 6000, 'maskedReference': null},
    ],
    'changeMinorUnits': 500,
  };

  String paperFor({
    String? locale,
    bool copy = false,
    Map<String, Object?>? payload,
  }) => ThermalReceiptRenderer(
    widthColumns: 32,
    labels: ThermalReceiptLabels.forLanguage(locale),
  ).render(payload ?? receipt(), capabilities: const {}, copy: copy).plainText;

  test('a Spanish café prints Spanish words', () {
    final paper = paperFor(locale: 'es-MX');
    expect(paper, contains('Orden 004'));
    expect(paper, contains('Impuestos'));
    expect(paper, contains('Cambio'));
    expect(paper, contains('Efectivo'));
    expect(paper, isNot(contains('Tax')));
    expect(paper, isNot(contains('Cash')));
  });

  test('the paper carries the hour, in the café clock', () {
    final payload = receipt()..['issuedAt'] = '2026-10-14T11:12:34.000-07:00';

    final paper = paperFor(locale: 'es-MX', payload: payload);

    expect(paper, contains('Hora 11:12:34'));
    expect(paper, contains('2026-10-12'));
    // The café's clock, not the server's reading of the same instant: 18:12 is what a UTC
    // slice of this stamp prints, and it is the hour nobody in the café saw.
    expect(paper, isNot(contains('18:12')));
  });

  test('an English till words the hour in English', () {
    final payload = receipt()..['issuedAt'] = '2026-10-14T11:12:34.000-07:00';

    expect(
      paperFor(locale: 'en-US', payload: payload),
      contains('Time 11:12:34'),
    );
  });

  test('a payload frozen before the hour existed still prints', () {
    // The field carries jobs built by an older API. A missing instant is not an error: the
    // paper simply has no hour line, which is the paper it had before.
    final paper = paperFor(locale: 'es-MX');

    expect(paper, contains('2026-10-12'));
    expect(paper, isNot(contains('Hora')));
  });

  test('a bank transfer prints its own payment label', () {
    final payload = receipt();
    payload['tenders'] = [
      {
        'type': 'bank_transfer',
        'amountMinorUnits': 6000,
        'maskedReference': null,
      },
    ];
    final paper = ThermalReceiptRenderer(
      widthColumns: 32,
    ).render(payload, capabilities: const {}).plainText;
    expect(paper, contains('Transferencia bancaria'));
    expect(paper, isNot(contains('Otro')));
  });

  test('a payload with no locale still prints Spanish, not English', () {
    // The fallback is the language the document is filed in, so a payload written before
    // this field existed cannot come out in a language nobody at the café reads.
    final paper = paperFor();
    expect(paper, contains('Impuestos'));
    expect(paper, isNot(contains('Tax')));
  });

  test('an English café prints English words, copy legend included', () {
    final paper = paperFor(locale: 'en-US', copy: true);
    expect(paper, contains('Order 004'));
    expect(paper, contains('Tax'));
    expect(paper, contains('Cash'));
    expect(paper, contains('COPY'));
    expect(paper, contains('Powered by Umi: umiconsulting.co'));
  });

  test('the Umi signature follows the thank-you after two paper lines', () {
    final document = ThermalReceiptRenderer(
      widthColumns: 32,
    ).render(receipt(), capabilities: const {});
    final commands = document.commands;
    final thanks = commands.indexWhere(
      (command) =>
          command is ThermalTextCommand &&
          command.text == 'Gracias por su visita',
    );
    expect(thanks, greaterThanOrEqualTo(0));
    expect(commands[thanks + 1], isA<ThermalFeedCommand>());
    expect((commands[thanks + 1] as ThermalFeedCommand).lines, 2);
    expect(commands[thanks + 2], isA<ThermalTextCommand>());
    expect(
      (commands[thanks + 2] as ThermalTextCommand).text,
      'Powered by Umi: umiconsulting.co',
    );
  });
}
