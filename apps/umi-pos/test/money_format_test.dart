import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// One money formatter, and this is where the rule is kept.
///
/// `lib/shared/money.dart` owns how an amount of money is written: grouped
/// thousands, two decimals, the currency it was given, and the true minus for a
/// negative. The till used to write money by hand in nine places, so the same
/// figure came out two ways on two screens — measured on the iMin D3-504 on
/// 2026-10-11, `Centro de caja` read `MXN 1,877.60` while `Ventas` read
/// `MXN 1303.00`, and `Pedidos entrantes` priced a web order in dollars
/// (`$330.00`) on a till that says `MXN` everywhere else.
///
/// Every hand-rolled division that survives is one an operator types into: the
/// checkout sheet pre-fills an editable amount field, and a field is input, not
/// display. That is the whole allowance, and it is counted so that a new one —
/// or a new file — cannot slip in unnoticed: whoever adds one has to come here
/// and say why.
void main() {
  test('the only hand-rolled money divisions left are editable field values', () {
    const allowances = {
      // Pre-fills of `cashApplied`, `cashReceived`, `cardAmount`,
      // `terminalAmount`, `bankAmount`, `customTipPercent`, `customTipFixed`
      // and `discountPercent`. The bank amount is a read-only field, but its
      // decimal string is parsed back into the tender command. These are
      // command values, while visible totals use `formatMinorUnits`.
      'lib/features/checkout/checkout_surface.dart': 16,
      // The partial-payment form pre-fills editable portion, tip, and cash
      // received fields. Its visible balances and charge use formatMinorUnits.
      'lib/features/checkout/partial_checkout_surface.dart': 6,
    };

    final found = <String, int>{};
    for (final entity in Directory('lib').listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;
      final count = 'toStringAsFixed(2)'
          .allMatches(entity.readAsStringSync())
          .length;
      if (count > 0) found[entity.path] = count;
    }

    expect(
      found,
      allowances,
      reason:
          'Money is written by `formatMinorUnits` from `lib/shared/money.dart`. '
          'If this failed, either use it or add the file here with the reason '
          'its hand-rolled division is not a displayed amount.',
    );
  });
}
