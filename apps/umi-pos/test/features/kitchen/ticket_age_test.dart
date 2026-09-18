import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/features/kitchen/kitchen_board_surface.dart';

/// The kitchen board's ticket age.
///
/// Found on the live screen (defect D33): every ticket rendered its age in
/// minutes, so one from ten days ago read `14747 min`. A cook cannot turn that
/// into "that is from last week" while plating, and a board that has been full
/// for a week is exactly when the number matters most.
void main() {
  // The three unit strings the surface passes in, so this is a pure-function
  // test rather than a widget test.
  String age(Duration d) => formatTicketAge(
    d,
    now: 'now',
    minutes: (m) => '${m}min',
    hoursMinutes: (h, m) => '${h}h ${m}min',
    daysHours: (d, h) => '${d}d ${h}h',
  );

  test('a fresh ticket reads now', () {
    expect(age(Duration.zero), 'now');
    expect(age(const Duration(seconds: 30)), 'now');
  });

  test('minutes below an hour', () {
    expect(age(const Duration(minutes: 1)), '1min');
    expect(age(const Duration(minutes: 59)), '59min');
  });

  test('the hour boundary carries the second unit', () {
    expect(age(const Duration(minutes: 60)), '1h 0min');
    expect(age(const Duration(hours: 2, minutes: 5)), '2h 5min');
    expect(age(const Duration(hours: 23, minutes: 59)), '23h 59min');
  });

  test('the day boundary drops minutes, which are noise at that distance', () {
    expect(age(const Duration(hours: 24)), '1d 0h');
    expect(age(const Duration(days: 10, hours: 5, minutes: 47)), '10d 5h');
  });

  test('the ticket the sweep found reads as days, not as 14747 minutes', () {
    expect(age(const Duration(minutes: 14747)), '10d 5h');
  });

  test(
    'a clock that disagrees with the server cannot produce a negative age',
    () {
      expect(age(const Duration(minutes: -5)), 'now');
    },
  );
}
