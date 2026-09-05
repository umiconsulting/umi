/// Reading a cash amount a person typed.
///
/// The old parser answered every input with a number, including the inputs that
/// were not amounts. `abc` came back as zero, `0.999` quietly became 0.99, and
/// `1,500.00` — an ordinary way to write one thousand five hundred pesos in
/// Mexico — came back as MXN 1.50. Nothing in the screen said so; the shift just
/// opened with the wrong money in the drawer.
///
/// So this one refuses. `null` means "that is not an amount", and the caller has
/// to deal with it rather than book a number nobody typed.
library;

import 'package:flutter/services.dart';

/// One peso short of a hundred million. Past this the input is a typo or a
/// paste, never a float somebody is counting into a till.
const int _maxMinorUnits = 9999999999;

/// Minor units for [value], or `null` when [value] is not a well-formed,
/// non-negative amount with at most two decimals.
///
/// Accepts what people actually type: `500`, `500.00`, `1,500.00`, `1.500,00`,
/// and thin/regular spaces as grouping. A lone separator followed by exactly
/// three digits is grouping (`1,500` is fifteen hundred pesos); followed by one
/// or two digits it is the decimal point (`2,50` is two pesos fifty).
int? parseMinorUnits(String value) {
  final trimmed = value.trim().replaceAll(' ', '').replaceAll(' ', '');
  if (trimmed.isEmpty) return null;
  // A minus sign is not a typo to be absorbed. There is no negative float.
  if (!RegExp(r'^[0-9.,]+$').hasMatch(trimmed)) return null;
  // Separators on their own are not a number.
  if (!RegExp(r'[0-9]').hasMatch(trimmed)) return null;

  final lastDot = trimmed.lastIndexOf('.');
  final lastComma = trimmed.lastIndexOf(',');
  final dots = '.'.allMatches(trimmed).length;
  final commas = ','.allMatches(trimmed).length;

  String whole;
  String fraction;

  if (dots > 0 && commas > 0) {
    // Both present: the last one separates the decimals, the other groups.
    final decimalAt = lastDot > lastComma ? lastDot : lastComma;
    final grouping = lastDot > lastComma ? ',' : '.';
    whole = trimmed.substring(0, decimalAt);
    fraction = trimmed.substring(decimalAt + 1);
    if (!_groupsWellFormed(whole, grouping)) return null;
    whole = whole.replaceAll(grouping, '');
  } else if (dots + commas == 0) {
    whole = trimmed;
    fraction = '';
  } else {
    final separator = dots > 0 ? '.' : ',';
    final at = dots > 0 ? lastDot : lastComma;
    final tail = trimmed.substring(at + 1);
    final onlyOne = (dots + commas) == 1;
    final lead = trimmed.substring(0, at);
    // `1,500` is fifteen hundred; `0.999` is somebody typing a third decimal.
    // A leading zero settles it — no one groups thousands behind a zero.
    if (onlyOne && tail.length == 3 && lead.isNotEmpty && lead != '0') {
      // `1,500` / `1.500` — grouping, not a decimal point.
      whole = trimmed.replaceAll(separator, '');
      fraction = '';
      if (!_groupsWellFormed(trimmed, separator)) return null;
    } else if (onlyOne) {
      whole = trimmed.substring(0, at);
      fraction = tail;
    } else {
      // Repeated separator: grouping only, and every group must be exact.
      if (!_groupsWellFormed(trimmed, separator)) return null;
      whole = trimmed.replaceAll(separator, '');
      fraction = '';
    }
  }

  if (whole.isEmpty) whole = '0';
  if (!RegExp(r'^[0-9]+$').hasMatch(whole)) return null;
  // Two decimals, no more. Truncating a third digit is a decision about money
  // that belongs to the person holding it, not to a parser.
  if (fraction.isNotEmpty && !RegExp(r'^[0-9]{1,2}$').hasMatch(fraction)) {
    return null;
  }

  final wholeValue = int.tryParse(whole);
  if (wholeValue == null) return null;
  final fractionValue = fraction.isEmpty
      ? 0
      : int.parse(fraction.padRight(2, '0'));
  if (wholeValue > _maxMinorUnits ~/ 100) return null;
  final total = wholeValue * 100 + fractionValue;
  if (total > _maxMinorUnits) return null;
  return total;
}

/// Grouping separators are only grouping when every group is exactly three
/// digits and the first is one to three. `1,50,0` is somebody's mistake.
bool _groupsWellFormed(String whole, String separator) {
  if (!whole.contains(separator)) return RegExp(r'^[0-9]*$').hasMatch(whole);
  final groups = whole.split(separator);
  if (groups.first.isEmpty || groups.first.length > 3) return false;
  for (final group in groups) {
    if (!RegExp(r'^[0-9]+$').hasMatch(group)) return false;
  }
  for (final group in groups.skip(1)) {
    if (group.length != 3) return false;
  }
  return true;
}

/// The amount as the field should show it once it is valid.
String formatMinorUnits(int minorUnits) =>
    (minorUnits / 100).toStringAsFixed(2);

/// Keeps a cash field to digits and separators, so most of the shapes
/// [parseMinorUnits] has to refuse never get typed in the first place. It is a
/// courtesy, not the guard: the parser is still the thing that decides.
final List<TextInputFormatter> cashAmountFormatters = [
  FilteringTextInputFormatter.allow(RegExp(r'[0-9.,   ]')),
  LengthLimitingTextInputFormatter(16),
];

/// Whether the tender fields still describe the total on screen.
///
/// A saved tender draft is written against the totals of the moment. Add a line
/// and reopen the sheet and the draft is a description of a bill that no longer
/// exists — the cashier was shown MXN 55.00 to collect on MXN 110.00, and the
/// checkout then refused to complete without saying why. So a draft that does
/// not add up to the total is replaced.
///
/// [tenderEdited] must mean *the cashier typed the split*, and nothing else. The
/// sheet's own `dirty` flag is raised by the customer-value preview before
/// anyone touches a field, which is why it cannot answer this question.
bool tenderNeedsReseed({
  required bool receivedEmpty,
  required bool tenderEdited,
  required int tenderedMinorUnits,
  required int grandTotalMinorUnits,
}) =>
    receivedEmpty ||
    (!tenderEdited && tenderedMinorUnits != grandTotalMinorUnits);
