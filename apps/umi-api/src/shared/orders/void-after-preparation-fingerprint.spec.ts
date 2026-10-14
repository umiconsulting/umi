import { describe, expect, it } from 'vitest';
import { voidAfterPreparationFingerprint } from './void-after-preparation-fingerprint';

/**
 * The hash is a CONTRACT BETWEEN TWO LANGUAGES, and nothing else in the build would
 * notice it breaking.
 *
 * The till computes this string to ask a manager for an approval; the API computes it
 * again to spend that approval. If the two ever disagreed, the failure would be a manager
 * typing a correct PIN and being told it "does not authorize this movement" — a symptom
 * that points at the PIN, not at the hash.
 *
 * So the expected value below is written out and the Dart twin
 * (`test/void_after_preparation_fingerprint_test.dart`) writes out the SAME value for the
 * SAME six fields. Changing the field order, the separator or the algorithm fails both
 * tests, and the message says which two files must move together.
 */
describe('voidAfterPreparationFingerprint', () => {
  it('hashes the six fields of the cancel in one documented order', () => {
    expect(
      voidAfterPreparationFingerprint({
        merchantId: '10000000-0000-4000-8000-000000000001',
        locationId: '20000000-0000-4000-8000-000000000001',
        cartId: '40000000-0000-4000-8000-000000000001',
        lineId: '70000000-0000-4000-8000-000000000001',
        reasonCode: 'duplicate',
        expectedVersion: 7,
      }),
    ).toBe('58f5524002a547e4ffeb5b0d3c27f3a7fd0c97fc0557e2349191279eef517134');
  });

  it('follows the cart version, because an approval for another version is stale', () => {
    const base = {
      merchantId: '10000000-0000-4000-8000-000000000001',
      locationId: '20000000-0000-4000-8000-000000000001',
      cartId: '40000000-0000-4000-8000-000000000001',
      lineId: '70000000-0000-4000-8000-000000000001',
      reasonCode: 'duplicate',
    };
    expect(voidAfterPreparationFingerprint({ ...base, expectedVersion: 7 })).not.toBe(
      voidAfterPreparationFingerprint({ ...base, expectedVersion: 8 }),
    );
  });
});
