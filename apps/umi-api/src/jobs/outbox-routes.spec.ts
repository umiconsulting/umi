import { describe, expect, it } from 'vitest';
import { OutboxRoutesRegistrar } from './outbox-routes';
import { OutboxRouter } from './outbox-relay.service';
import { QUEUES } from './queues';

describe('outbox routes for POS kitchen push', () => {
  it('routes item and order ready events to the outbound worker', () => {
    const router = new OutboxRouter();
    new OutboxRoutesRegistrar(router).onModuleInit();
    expect(router.resolve('pos.kitchen_item_ready')).toMatchObject({
      queue: QUEUES.outbound,
      jobName: 'pos.kitchen_item_ready',
    });
    expect(router.resolve('pos.kitchen_order_ready')).toMatchObject({
      queue: QUEUES.outbound,
      jobName: 'pos.kitchen_order_ready',
    });
  });
});
