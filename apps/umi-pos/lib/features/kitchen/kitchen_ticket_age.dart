/// Show a ticket's age in minutes, hours or days without negative durations.
String formatTicketAge(
  Duration age, {
  required String now,
  required String Function(int minutes) minutes,
  required String Function(int hours, int minutes) hoursMinutes,
  required String Function(int days, int hours) daysHours,
}) {
  final safe = age.isNegative ? Duration.zero : age;
  if (safe.inMinutes <= 0) return now;
  if (safe.inDays >= 1) return daysHours(safe.inDays, safe.inHours % 24);
  if (safe.inHours >= 1) return hoursMinutes(safe.inHours, safe.inMinutes % 60);
  return minutes(safe.inMinutes);
}
