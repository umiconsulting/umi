import { expect, it } from 'vitest';
import { activateTestLocale } from '../test/i18n.jsx';
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
  activateTestLocale('es');
  expect(rewardVisitCostLabel(8, 7)).toBe('7 visitas · 1 visita restante');
  expect(rewardVisitCostLabel(9, 7)).toBe('7 visitas · 2 visitas restantes');
  expect(rewardVisitCostLabel(9, 9)).toBe('9 visitas · 0 visitas restantes');
});

it('localizes reward costs and remaining visits in English', async () => {
  const { rewardVisitCostLabel } = await import('./loyalty-operation.js');
  activateTestLocale('en');
  expect(rewardVisitCostLabel(8, 7)).toBe('7 visits · 1 visit left');
  expect(rewardVisitCostLabel(9, 7)).toBe('7 visits · 2 visits left');
  activateTestLocale('es');
});
