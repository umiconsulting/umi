import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/shared/business_day.dart';

void main() {
  group('operationalDayStart', () {
    test('is today at four once the clock has passed it', () {
      expect(
        operationalDayStart(DateTime(2026, 10, 12, 11, 30)),
        DateTime(2026, 10, 12, 4),
      );
    });

    test('is yesterday at four during the early hours', () {
      expect(
        operationalDayStart(DateTime(2026, 10, 12, 1, 15)),
        DateTime(2026, 10, 11, 4),
      );
    });

    test('04:00 itself already belongs to the new day', () {
      expect(
        operationalDayStart(DateTime(2026, 10, 12, 4)),
        DateTime(2026, 10, 12, 4),
      );
    });
  });

  group('openedBeforeOperationalDayStart', () {
    final now = DateTime(2026, 10, 12, 11, 30);

    test('an account from last night is previous day', () {
      expect(
        openedBeforeOperationalDayStart(
          DateTime(2026, 10, 11, 20).toIso8601String(),
          now: now,
        ),
        isTrue,
      );
    });

    test('an account opened this morning is not', () {
      expect(
        openedBeforeOperationalDayStart(
          DateTime(2026, 10, 12, 9).toIso8601String(),
          now: now,
        ),
        isFalse,
      );
    });

    test('a stamp that cannot be read is not treated as stale', () {
      expect(openedBeforeOperationalDayStart(null, now: now), isFalse);
      expect(openedBeforeOperationalDayStart('nonsense', now: now), isFalse);
    });
  });

  group('elapsedSinceLabel', () {
    final now = DateTime(2026, 10, 12, 11, 30);

    test('says minutes under an hour', () {
      expect(
        elapsedSinceLabel(
          DateTime(2026, 10, 12, 11, 5).toIso8601String(),
          spanish: true,
          now: now,
        ),
        'hace 25 min',
      );
    });

    test('says hours up to two days', () {
      expect(
        elapsedSinceLabel(
          DateTime(2026, 10, 11, 20).toIso8601String(),
          spanish: true,
          now: now,
        ),
        'hace 15 h',
      );
    });

    test('says days beyond that', () {
      expect(
        elapsedSinceLabel(
          DateTime(2026, 10, 9, 10).toIso8601String(),
          spanish: true,
          now: now,
        ),
        'hace 3 días',
      );
    });

    test('reads in English when asked', () {
      expect(
        elapsedSinceLabel(
          DateTime(2026, 10, 12, 11, 5).toIso8601String(),
          spanish: false,
          now: now,
        ),
        '25 min ago',
      );
    });
  });
}
