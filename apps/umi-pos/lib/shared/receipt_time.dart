/// The café's clock, as a document carries it.
///
/// A receipt's instant arrives as an ISO string in the LOCATION's timezone — the offset is in
/// the string — because the clock the guest and the cashier read is the café's, not the server's
/// and not whatever timezone a till happens to be set to. The wall-clock digits are therefore
/// already the ones to show, and re-converting them to the device's zone would move a 11:12
/// ticket to the afternoon on a till set to another country.
///
/// A value that arrives in UTC (`Z`) is the exception: nothing in it says what the café's clock
/// said, so this device's own zone is the best available reading of it. A value with no zone at
/// all is read as the wall clock it looks like.
String? receiptClockTime(String? issuedAt) {
  final value = issuedAt?.trim();
  if (value == null || value.isEmpty) return null;
  final separator = value.indexOf('T');
  if (separator == -1) return null;
  final wall = value.substring(separator + 1);
  if (value.endsWith('Z')) {
    final parsed = DateTime.tryParse(value);
    if (parsed == null) return null;
    return _clock(parsed.toLocal());
  }
  return wall.length >= 8 ? wall.substring(0, 8) : wall;
}

/// An instant as an ISO string carrying this device's own offset.
///
/// The provisional receipt is written on the till while nothing answers, and the paper has to
/// say when it was handed over. The shape matters beyond the paper: the value travels back to
/// the API when the journal replays, and the contract reads it as an instant — a string with no
/// offset would be refused there.
String receiptLocalInstant(DateTime at) {
  final local = at.isUtc ? at.toLocal() : at;
  final offset = local.timeZoneOffset;
  final sign = offset.isNegative ? '-' : '+';
  final hours = offset.inHours.abs().toString().padLeft(2, '0');
  final minutes = (offset.inMinutes.abs() % 60).toString().padLeft(2, '0');
  return '${_date(local)}T${_clock(local)}.${_milliseconds(local)}$sign$hours:$minutes';
}

String _date(DateTime at) =>
    '${at.year.toString().padLeft(4, '0')}-'
    '${at.month.toString().padLeft(2, '0')}-'
    '${at.day.toString().padLeft(2, '0')}';

String _clock(DateTime at) =>
    '${at.hour.toString().padLeft(2, '0')}:'
    '${at.minute.toString().padLeft(2, '0')}:'
    '${at.second.toString().padLeft(2, '0')}';

String _milliseconds(DateTime at) =>
    at.millisecond.toString().padLeft(3, '0');
