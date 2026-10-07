import { expect, it } from 'vitest';
import { LoyaltyOperation } from './loyalty-operation.js';
it('retains the receipt, action, quantity and key until a definite response', () => {
  const operation = new LoyaltyOperation(() => 'stable-key');
  const original = operation.begin({
    cardNumber: 'C1',
    action: 'REDEEM_BASE',
    redeemQuantity: 1,
    externalReceiptNumber: 'R1',
  });
  operation.finish(503);
  expect(operation.begin({ cardNumber: 'C2', action: 'VISIT' })).toEqual(original);
  expect(operation.pending).toBe(true);
  operation.finish(200);
  expect(operation.pending).toBe(false);
});

it('describes selected reward cost and retained visits', async () => {
  const { rewardVisitCostLabel } = await import('./loyalty-operation.js');
  expect(rewardVisitCostLabel(8, 7)).toBe('7 visitas · quedan 1');
  expect(rewardVisitCostLabel(9, 7)).toBe('7 visitas · quedan 2');
  expect(rewardVisitCostLabel(9, 9)).toBe('9 visitas · quedan 0');
});
