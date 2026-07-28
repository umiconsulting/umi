import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { PgService } from '../../shared/database/pg.service';
import { MetricsService } from '../../shared/operations/metrics.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('separates process liveness from dependency readiness', async () => {
    const pg = { healthCheck: vi.fn().mockResolvedValue(true) };
    const queue = {
      waitUntilReady: vi.fn().mockResolvedValue({ ping: vi.fn().mockResolvedValue('PONG') }),
    };
    const service = new HealthService(
      pg as unknown as PgService,
      queue as unknown as Queue,
      new MetricsService(),
    );

    expect(service.live().status).toBe('ok');
    await expect(service.check()).resolves.toMatchObject({ status: 'ok', db: true, redis: true });
  });

  it('reports degraded readiness without exposing dependency errors', async () => {
    const pg = { healthCheck: vi.fn().mockRejectedValue(new Error('private database host')) };
    const queue = { waitUntilReady: vi.fn().mockRejectedValue(new Error('redis password')) };
    const service = new HealthService(
      pg as unknown as PgService,
      queue as unknown as Queue,
      new MetricsService(),
    );

    await expect(service.check()).resolves.toMatchObject({
      status: 'degraded',
      db: false,
      redis: false,
    });
  });
});
