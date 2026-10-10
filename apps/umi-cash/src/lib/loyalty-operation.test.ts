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

it('renders wrapped API guard failures as text', async () => {
  const { loyaltyResponseMessage } = await import('./loyalty-operation');
  expect(loyaltyResponseMessage({ error: { message: 'Redeem historical rewards first' } })).toBe('Redeem historical rewards first');
  expect(loyaltyResponseMessage({ message: ['Quantity is invalid', 'Receipt is required'] })).toBe('Quantity is invalid. Receipt is required');
});

it('describes selected reward cost and retained visits', async () => {
  const { rewardVisitCostLabel } = await import('./loyalty-operation');
  expect(rewardVisitCostLabel(8, 7)).toBe('7 visitas · quedan 1');
  expect(rewardVisitCostLabel(9, 7)).toBe('7 visitas · quedan 2');
  expect(rewardVisitCostLabel(9, 9)).toBe('9 visitas · quedan 0');
});

it('defaults only to allowed visits and asks for an explicit reward choice at nine', async () => {
  const { defaultLoyaltyActions } = await import('./loyalty-operation');
  for (const visitsThisCycle of [7, 8]) expect(Array.from(defaultLoyaltyActions({ rewardPolicy: 'single_cycle', visitsThisCycle, visitsRequired: 9 }))).toEqual(['VISIT']);
  expect(Array.from(defaultLoyaltyActions({ rewardPolicy: 'single_cycle', visitsThisCycle: 9, visitsRequired: 9 }))).toEqual([]);
  expect(Array.from(defaultLoyaltyActions({ visitBlockedReason: 'REDEMPTION_REQUIRED' }))).toEqual([]);
});

it('routes enabled customer-detail redemption to the canonical receipt and choice flow', async () => {
  const { customerRedemptionDestination } = await import('./loyalty-operation');
  expect(customerRedemptionDestination('single_cycle', 'el-gran-ribera')).toBe('/el-gran-ribera/admin/scan');
  expect(customerRedemptionDestination('accumulate', 'other')).toBeNull();
});
