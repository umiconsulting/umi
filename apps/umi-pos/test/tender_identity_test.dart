import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/features/checkout/tender_identity.dart';

void main() {
  const cartA = '5835d730-eb71-4d38-8a42-430d3e17d5e9';
  const cartB = '55bcc46e-14b4-4101-be88-24196368fccc';

  test('is stable, so retrying one checkout presents one tender', () {
    expect(tenderId(cartA, 'cash'), tenderId(cartA, 'cash'));
  });

  test('is unique per sale', () {
    // `pos_tender_fact.id` is a primary key across the platform. The old version
    // returned a constant per kind, so the first cash sale claimed it and every
    // later one failed with "Tender identity conflicts with another checkout".
    expect(tenderId(cartA, 'cash'), isNot(tenderId(cartB, 'cash')));
  });

  test('is unique per tender kind within one sale', () {
    expect(tenderId(cartA, 'cash'), isNot(tenderId(cartA, 'terminal')));
  });

  test('is a v4-shaped uuid, which is what the column accepts', () {
    final value = tenderId(cartA, 'cash');
    expect(
      RegExp(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      ).hasMatch(value),
      isTrue,
      reason: value,
    );
  });

  test('never returns the hardcoded id that caused the collision', () {
    expect(
      tenderId(cartA, 'cash'),
      isNot('00000000-0000-4000-8000-000000000301'),
    );
    expect(
      tenderId(cartA, 'terminal'),
      isNot('00000000-0000-4000-8000-000000000302'),
    );
  });
}
