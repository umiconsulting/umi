import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/features/cash/money_input.dart';

void main() {
  group('reads what a cashier actually types', () {
    test('plain amounts', () {
      expect(parseMinorUnits('500'), 50000);
      expect(parseMinorUnits('500.00'), 50000);
      expect(parseMinorUnits('0'), 0);
      expect(parseMinorUnits('0.00'), 0);
      expect(parseMinorUnits('  12.34  '), 1234);
      expect(parseMinorUnits('.5'), 50);
      expect(parseMinorUnits('7.5'), 750);
    });

    test('grouping separators, both conventions', () {
      // The one that used to come back as MXN 1.50.
      expect(parseMinorUnits('1,500.00'), 150000);
      expect(parseMinorUnits('1.500,00'), 150000);
      expect(parseMinorUnits('1,500'), 150000);
      expect(parseMinorUnits('1.500'), 150000);
      expect(parseMinorUnits('1 500'), 150000);
      expect(parseMinorUnits('12,345,678.90'), 1234567890);
    });

    test('a lone separator with one or two digits is the decimal point', () {
      expect(parseMinorUnits('2,50'), 250);
      expect(parseMinorUnits('2.5'), 250);
    });
  });

  group('refuses what is not an amount', () {
    test('the input that opened a shift with zero', () {
      // Typing 50000 into a field pre-filled with "0.00" appends. It used to
      // parse as MXN 0.00 and open the shift on an empty drawer.
      expect(parseMinorUnits('0.0050000'), isNull);
    });

    test('junk is not zero', () {
      expect(parseMinorUnits('abc'), isNull);
      expect(parseMinorUnits('12abc'), isNull);
      expect(parseMinorUnits(''), isNull);
      expect(parseMinorUnits('   '), isNull);
      expect(parseMinorUnits('.'), isNull);
      expect(parseMinorUnits(','), isNull);
    });

    test('a third decimal is a question, not something to truncate', () {
      expect(parseMinorUnits('0.999'), isNull);
      expect(parseMinorUnits('1.2345'), isNull);
      expect(parseMinorUnits('0,001'), isNull);
    });

    test('three digits after a lone separator are thousands, as in es-MX', () {
      // `10.001` is ten thousand and one pesos, the ordinary reading here. The
      // input formatter on the field is what keeps a mistyped third decimal
      // from ever reaching this point.
      expect(parseMinorUnits('10.001'), 1000100);
      expect(parseMinorUnits('7,123'), 712300);
    });

    test('malformed grouping', () {
      expect(parseMinorUnits('1.2.3'), isNull);
      expect(parseMinorUnits('1,50,0'), isNull);
      expect(parseMinorUnits('1234,56,78'), isNull);
    });

    test('there is no negative opening float', () {
      expect(parseMinorUnits('-5'), isNull);
      expect(parseMinorUnits('-0.01'), isNull);
    });

    test('an amount past the cap is a paste or a typo', () {
      expect(parseMinorUnits('99999999.99'), 9999999999);
      expect(parseMinorUnits('100000000.00'), isNull);
    });
  });

  test('formats back for the field', () {
    expect(formatMinorUnits(50000), '500.00');
    expect(formatMinorUnits(0), '0.00');
    expect(formatMinorUnits(7), '0.07');
  });

  group('a tender draft that no longer matches the bill', () {
    test('is replaced when the cashier has not set the split', () {
      // The exact case: a MXN 55.00 draft left on a cart that now costs 110.
      expect(
        tenderNeedsReseed(
          receivedEmpty: false,
          tenderEdited: false,
          tenderedMinorUnits: 5500,
          grandTotalMinorUnits: 11000,
        ),
        isTrue,
      );
    });

    test('is kept once the cashier typed the split themselves', () {
      expect(
        tenderNeedsReseed(
          receivedEmpty: false,
          tenderEdited: true,
          tenderedMinorUnits: 5500,
          grandTotalMinorUnits: 11000,
        ),
        isFalse,
      );
    });

    test('an empty field is always seeded from the total', () {
      expect(
        tenderNeedsReseed(
          receivedEmpty: true,
          tenderEdited: true,
          tenderedMinorUnits: 0,
          grandTotalMinorUnits: 11000,
        ),
        isTrue,
      );
    });

    test('a matching draft is left alone', () {
      expect(
        tenderNeedsReseed(
          receivedEmpty: false,
          tenderEdited: false,
          tenderedMinorUnits: 11000,
          grandTotalMinorUnits: 11000,
        ),
        isFalse,
      );
    });
  });
}
