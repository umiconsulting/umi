import { expect, it } from 'vitest';
import { stampRewardReminderBody, stampRewardReminderKey } from './stamp-reward-expiry.processor';
it('groups equal reward names and formats expiry in the merchant timezone', () => {
  const body = stampRewardReminderBody({
    phone: 'whatsapp:+15005550006',
    name: 'Fixture customer',
    merchant: 'Fixture cafe',
    timezone: 'America/Mazatlan',
    expiresAt: '2026-11-06T18:00:00Z',
    units: [
      { reward_name: 'Base snapshot' },
      { reward_name: 'Base snapshot' },
      { reward_name: 'Upper snapshot' },
    ],
  });
  expect(body).toContain('2 × Base snapshot');
  expect(body).toContain('1 × Upper snapshot');
  expect(body).toContain('11:00');
});
it('uses one stable outbox identity for the card and exact deadline', () => {
  expect(stampRewardReminderKey('m', 'c', '2026-11-06 18:00:00.123456+00')).toBe(
    'stamp-reward-expiry:m:c:2026-11-06 18:00:00.123456+00',
  );
});

it('discards a pooled session if its delivery lock cannot be released', async () => {
  const { StampRewardExpiryProcessor } = await import('./stamp-reward-expiry.processor');
  let discarded = false;
  const client = {
    query: async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (sql.includes('pg_advisory_unlock')) throw new Error('fixture connection failure');
      return { rows: [] };
    },
    release: (destroy: boolean) => {
      discarded = destroy === true;
    },
  };
  const processor = new StampRewardExpiryProcessor(
    { worker: { connect: async () => client } } as never,
    {} as never,
    {} as never,
    { get: () => true } as never,
  );
  expect(
    await processor.deliverReminder({
      merchantId: 'fixture-merchant',
      cardId: 'fixture-card',
      expiresAt: '2026-11-06T18:00:00Z',
    }),
  ).toBe(false);
  expect(discarded).toBe(true);
});
