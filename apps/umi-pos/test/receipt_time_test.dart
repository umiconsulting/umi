import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/shared/receipt_time.dart';

/// THE HOUR ON THE PAPER, IN THE CAFÉ'S CLOCK.
///
/// The instant arrives in the LOCATION's timezone, so the wall-clock digits in the string are
/// the ones the guest and the cashier read. These tests pin the three shapes a receipt can
/// carry, because the difference between them is a ticket stamped with the wrong hour.
void main() {
  test('a value in the café timezone is printed as it arrives', () {
    expect(receiptClockTime('2026-10-14T11:12:34.000-07:00'), '11:12:34');
    expect(receiptClockTime('2026-10-14T23:59:59.999+02:00'), '23:59:59');
  });

  test('a UTC value is read on this device clock, because nothing else can say', () {
    final utc = '2026-10-14T18:12:34.000Z';
    final expected = DateTime.parse(utc).toLocal();
    final clock = receiptClockTime(utc);

    expect(clock, isNotNull);
    expect(
      clock,
      '${expected.hour.toString().padLeft(2, '0')}:'
      '${expected.minute.toString().padLeft(2, '0')}:'
      '${expected.second.toString().padLeft(2, '0')}',
    );
  });

  test('nothing to read is null, not midnight', () {
    expect(receiptClockTime(null), isNull);
    expect(receiptClockTime(''), isNull);
    expect(receiptClockTime('2026-10-14'), isNull);
  });

  test('the till stamps a provisional receipt as an instant the API accepts', () {
    final stamp = receiptLocalInstant(DateTime(2026, 10, 14, 11, 12, 34, 500));

    // The shape the contract reads as an instant: local wall clock plus its own offset.
    expect(
      stamp,
      matches(RegExp(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$')),
    );
    expect(receiptClockTime(stamp), '11:12:34');
  });
}
