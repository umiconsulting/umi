import { describe, expect, it, vi } from 'vitest';
import { PointAttemptHealthScheduler } from './mp-point-attempt-health.scheduler';

describe('the attempt-health scheduler', () => {
  it('schedules the count every five minutes, on the system queue', async () => {
    const queue = { upsertJobScheduler: vi.fn().mockResolvedValue(undefined) };
    const scheduler = new PointAttemptHealthScheduler({
      getQueue: vi.fn().mockReturnValue(queue),
    } as never);

    await scheduler.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'mercado-pago-point:attempt-health',
      { every: 5 * 60 * 1000 },
      { name: 'point_attempt_health' },
    );
  });
});
