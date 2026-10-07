import { expect, it } from 'vitest';
import { SystemProcessor } from './system.processor';
import { OutboundProcessor } from './outbound.processor';
import { StampRewardExpiryScheduler } from './stamp-reward-expiry.scheduler';
import { OutboxRouter } from './outbox-relay.service';
import {
  STAMP_REWARD_EXPIRY_JOB,
  STAMP_REWARD_REMINDER_TOPIC,
} from './stamp-reward-expiry.processor';

it('routes expiry jobs through the existing system consumer', async () => {
  const batches: number[] = [];
  const processor = new SystemProcessor(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      sweep: async (batch: number) => {
        batches.push(batch);
      },
    } as never,
  );
  await processor.process({ name: STAMP_REWARD_EXPIRY_JOB, data: { batchSize: 12 } } as never);
  expect(batches).toEqual([12]);
});
it('routes reminder jobs through the existing outbound consumer', async () => {
  const groups: unknown[] = [];
  const processor = new OutboundProcessor(
    {} as never,
    {} as never,
    {} as never,
    {
      deliverReminder: async (group: unknown) => {
        groups.push(group);
      },
    } as never,
  );
  const group = {
    merchantId: 'fixture-merchant',
    cardId: 'fixture-card',
    expiresAt: '2026-11-06T18:00:00Z',
  };
  await processor.process({ name: STAMP_REWARD_REMINDER_TOPIC, data: group } as never);
  expect(groups).toEqual([group]);
});
it('registers one bounded recurring job and the existing outbound route', async () => {
  const schedules: unknown[] = [];
  const router = new OutboxRouter();
  const scheduler = new StampRewardExpiryScheduler(
    {
      getQueue: () => ({
        upsertJobScheduler: async (...args: unknown[]) => {
          schedules.push(args);
        },
      }),
    } as never,
    router,
  );
  await scheduler.onModuleInit();
  expect(schedules).toEqual([
    [
      'stamp-reward-expiry',
      { every: 60_000 },
      { name: STAMP_REWARD_EXPIRY_JOB, data: { batchSize: 100 } },
    ],
  ]);
  expect(router.resolve(STAMP_REWARD_REMINDER_TOPIC)?.queue).toBe('outbound');
});
