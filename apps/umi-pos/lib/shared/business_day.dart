/// When the operational day turns.
///
/// A café's day does not end at midnight, and this product already decided where it
/// does end: at four in the morning. The authority is the server —
/// `merchant.business_day_start` in the merchant's own timezone feeds
/// `merchant.tg_business_date`, which is how every cart gets the `business_date` the
/// reports and the receipt folio key on. The till does not carry that timezone, so it
/// approximates with the device clock, the same approximation the cash centre already
/// makes for the carried-over shift notice.
///
/// It is deliberately a *boundary*, not a duration: an account opened at 22:00 is
/// yesterday's the moment the clock passes 04:00, however few hours it shows, because
/// that is what the money says.
library;

/// The instant the operational day containing [now] began.
DateTime operationalDayStart(DateTime now, {int startHour = 4}) {
  final todayStart = DateTime(now.year, now.month, now.day, startHour);
  return now.isBefore(todayStart)
      ? todayStart.subtract(const Duration(days: 1))
      : todayStart;
}

/// True when whatever [timestamp] stamps was opened before the current operational day
/// began — an account still alive from a previous trading day.
bool openedBeforeOperationalDayStart(String? timestamp, {DateTime? now}) {
  final opened = DateTime.tryParse(timestamp ?? '');
  if (opened == null) return false;
  return opened.isBefore(operationalDayStart(now ?? DateTime.now()));
}

/// How long ago [timestamp] was, in the words a person on the floor uses:
/// "hace 25 min", "hace 14 h", "hace 3 días". Null when the stamp cannot be read.
String? elapsedSinceLabel(
  String? timestamp, {
  required bool spanish,
  DateTime? now,
}) {
  final at = DateTime.tryParse(timestamp ?? '');
  if (at == null) return null;
  final elapsed = (now ?? DateTime.now()).difference(at);
  if (elapsed.isNegative || elapsed.inMinutes < 1) {
    return spanish ? 'hace un momento' : 'just now';
  }
  if (elapsed.inMinutes < 60) {
    return spanish
        ? 'hace ${elapsed.inMinutes} min'
        : '${elapsed.inMinutes} min ago';
  }
  if (elapsed.inHours < 48) {
    return spanish ? 'hace ${elapsed.inHours} h' : '${elapsed.inHours} h ago';
  }
  final days = elapsed.inDays;
  return spanish
      ? 'hace $days ${days == 1 ? 'día' : 'días'}'
      : '$days ${days == 1 ? 'day' : 'days'} ago';
}
