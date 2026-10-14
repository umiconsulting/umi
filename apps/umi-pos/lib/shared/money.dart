/// How the till writes an amount of money.
///
/// One formatter, so the same amount cannot appear two ways on two screens. The
/// rule was written down when the drawer equation and the cash cards disagreed
/// (`1458.50` beside `MXN 1,458.50`); it now lives here, next to nothing in
/// particular, because every surface needs it — the catalogue's order panel, the
/// checkout sheet, the sales list, a printed receipt — and a library under
/// `features/cash/` was the wrong address for a rule the whole app follows.
library;

/// `MXN 1,500.00`, from minor units. One division, at the edge of the system.
///
/// The currency is optional for the field helpers that format a bare amount, and
/// the sign is the true minus (−), never the hyphen, because a figure is read
/// beside other figures and a hyphen reads as a dash.
String formatMinorUnits(int minorUnits, [String currency = '']) {
  final sign = minorUnits < 0 ? '−' : '';
  final value = minorUnits.abs();
  final whole = (value ~/ 100).toString();
  final cents = (value % 100).toString().padLeft(2, '0');
  final grouped = StringBuffer();
  for (var i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 == 0) grouped.write(',');
    grouped.write(whole[i]);
  }
  final prefix = currency.isEmpty ? '' : '$currency ';
  return '$sign$prefix$grouped.$cents';
}
