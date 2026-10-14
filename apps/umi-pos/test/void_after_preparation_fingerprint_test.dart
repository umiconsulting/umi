import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';

/// The till's half of a two-language contract.
///
/// The till computes this string to ask a manager for an approval, and the API computes
/// it again to spend that approval. The expected value is the SAME one written out in
/// `apps/umi-api/src/shared/orders/void-after-preparation-fingerprint.spec.ts` for the
/// same six fields: if the two hashes ever drift, a manager types a correct PIN and is
/// told it does not authorize the movement — a symptom that blames the PIN.
void main() {
  test('hashes the six fields of the cancel in the order the API expects', () {
    expect(
      voidAfterPreparationFingerprint(
        merchantId: '10000000-0000-4000-8000-000000000001',
        locationId: '20000000-0000-4000-8000-000000000001',
        cartId: '40000000-0000-4000-8000-000000000001',
        lineId: '70000000-0000-4000-8000-000000000001',
        reasonCode: 'duplicate',
        expectedVersion: 7,
      ),
      '58f5524002a547e4ffeb5b0d3c27f3a7fd0c97fc0557e2349191279eef517134',
    );
  });

  test('a different reason is a different act, so it hashes differently', () {
    final asDuplicate = voidAfterPreparationFingerprint(
      merchantId: '10000000-0000-4000-8000-000000000001',
      locationId: '20000000-0000-4000-8000-000000000001',
      cartId: '40000000-0000-4000-8000-000000000001',
      lineId: '70000000-0000-4000-8000-000000000001',
      reasonCode: 'duplicate',
      expectedVersion: 7,
    );
    final asMistake = voidAfterPreparationFingerprint(
      merchantId: '10000000-0000-4000-8000-000000000001',
      locationId: '20000000-0000-4000-8000-000000000001',
      cartId: '40000000-0000-4000-8000-000000000001',
      lineId: '70000000-0000-4000-8000-000000000001',
      reasonCode: 'operator_mistake',
      expectedVersion: 7,
    );
    expect(asDuplicate, isNot(asMistake));
  });
}
