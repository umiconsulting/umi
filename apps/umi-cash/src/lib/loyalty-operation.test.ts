import { describe, expect, it } from 'vitest';
import { LoyaltyOperation, toggleLoyaltyAction } from './loyalty-operation';

describe('loyalty operation', () => {
  it('keeps the original request and key after an uncertain response', () => {
    const operation = new LoyaltyOperation(() => 'stable-key');
    const original = operation.begin({ qrPayload: 'card', actions: ['REDEEM_BASE'], redeemQuantity: 1, externalReceiptNumber: 'R-01' });
    operation.finish(503);
    expect(operation.begin({ qrPayload: 'other', actions: ['VISIT'], externalReceiptNumber: 'changed' })).toEqual(original);
    expect(original.idempotencyKey).toBe('stable-key');
    expect(operation.pending).toBe(true);
    operation.finish(200);
    expect(operation.pending).toBe(false);
  });
  it('releases the request after a definite rejection', () => {
    const operation = new LoyaltyOperation(() => 'key');
    operation.begin({ qrPayload: 'card', actions: ['VISIT'] });
    operation.finish(400);
    expect(operation.pending).toBe(false);
  });
  it('selects cycle redemption and visit exclusively', () => {
    expect(Array.from(toggleLoyaltyAction(new Set(['VISIT', 'BIRTHDAY_REDEEM']), 'REDEEM_BASE', true))).toEqual(['BIRTHDAY_REDEEM', 'REDEEM_BASE']);
    expect(Array.from(toggleLoyaltyAction(new Set(['REDEEM']), 'REDEEM_BASE', false))).toEqual(['REDEEM_BASE']);
  });
});
