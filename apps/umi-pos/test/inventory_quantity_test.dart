import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/features/inventory/inventory_quantity.dart';

void main() {
  test(
    'decimal quantity preserves exact integer values for all contract scales',
    () {
      for (var scale = 0; scale <= 6; scale++) {
        for (final value in [0, 1, 10, 1250, 9007199254740991]) {
          final text = InventoryQuantityText.format(value, scale);
          expect(
            InventoryQuantityText.parse(text, scale),
            value,
            reason: '$value at $scale',
          );
        }
      }
      expect(InventoryQuantityText.parse('1.25', 3), 1250);
      expect(
        InventoryQuantityText.label({
          'value': 1250,
          'scale': 3,
          'unit': 'gram',
        }),
        '1.25 g',
      );
      expect(InventoryQuantityText.format(-1250, 3), '-1.25');
    },
  );

  test(
    'quantity input refuses rounding, ambiguous grouping and unsafe integers',
    () {
      for (final text in [
        '1.2345',
        '1,250',
        '1 250',
        '-1',
        '1e3',
        '',
        '.',
        'NaN',
        '9007199254740992',
      ]) {
        expect(InventoryQuantityText.parse(text, 3), isNull, reason: text);
      }
      expect(InventoryQuantityText.parse('1.5', 0), isNull);
      expect(InventoryQuantityText.parse('1', 7), isNull);
      expect(InventoryQuantityText.parse('0', 0), 0);
    },
  );
}
