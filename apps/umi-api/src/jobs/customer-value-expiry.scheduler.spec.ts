import { describe, expect, it, vi } from 'vitest';
import { CustomerValueExpiryScheduler } from './customer-value-expiry.scheduler';

describe('customer value authorization expiry scheduler', () => {
  it('registers one bounded recurring processor', async () => {
    const queue = { upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn() };
    const scheduler = new CustomerValueExpiryScheduler(
      { getQueue: vi.fn().mockReturnValue(queue) } as never,
      { get: vi.fn().mockReturnValue(true) } as never,
    );
    await scheduler.onModuleInit();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'customer-value:authorization-expiry',
      { every: 60_000 },
      { name: 'customer_value_authorization_expiry', data: { batchSize: 100 } },
    );
  });

  it('removes the recurring processor when policy disables expiry', async () => {
    const queue = {
      upsertJobScheduler: vi.fn(),
      removeJobScheduler: vi.fn().mockResolvedValue(undefined),
    };
    const scheduler = new CustomerValueExpiryScheduler(
      { getQueue: vi.fn().mockReturnValue(queue) } as never,
      { get: vi.fn().mockReturnValue(false) } as never,
    );
    await scheduler.onModuleInit();
    expect(queue.removeJobScheduler).toHaveBeenCalledWith('customer-value:authorization-expiry');
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });
});
