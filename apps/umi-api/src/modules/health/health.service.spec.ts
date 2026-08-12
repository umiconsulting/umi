import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { PgService } from '../../shared/database/pg.service';
import { MetricsService } from '../../shared/operations/metrics.service';
import { HealthService } from './health.service';
import type { ReleaseIdentityService } from '../../shared/release/release-identity.service';

const release = {
  current: vi.fn().mockReturnValue({
    application: 'umi-api',
    version: '6.0.0-pilot.1',
    gitCommit: 'a'.repeat(40),
    buildTimestamp: '2026-08-11T12:00:00.000Z',
    environment: 'pilot',
    contractVersion: '2.12.0',
    expectedSchemaVersion: 'build-v3-45',
    configurationSchemaVersion: '1',
  }),
};

describe('HealthService', () => {
  it('separates process liveness from dependency readiness', async () => {
    const pg = {
      healthCheck: vi.fn().mockResolvedValue(true),
      schemaVersion: vi.fn().mockResolvedValue('build-v3-45'),
    };
    const queue = {
      waitUntilReady: vi.fn().mockResolvedValue({ ping: vi.fn().mockResolvedValue('PONG') }),
    };
    const service = new HealthService(
      pg as unknown as PgService,
      queue as unknown as Queue,
      new MetricsService(),
      release as unknown as ReleaseIdentityService,
    );

    expect(service.live().status).toBe('ok');
    await expect(service.check()).resolves.toMatchObject({
      status: 'ok',
      state: 'Healthy',
      db: true,
      redis: true,
      schema: { current: 'build-v3-45', compatible: true },
      release: { version: '6.0.0-pilot.1' },
    });
  });

  it('reports degraded readiness without exposing dependency errors', async () => {
    const pg = {
      healthCheck: vi.fn().mockRejectedValue(new Error('private database host')),
      schemaVersion: vi.fn().mockRejectedValue(new Error('private database host')),
    };
    const queue = { waitUntilReady: vi.fn().mockRejectedValue(new Error('redis password')) };
    const service = new HealthService(
      pg as unknown as PgService,
      queue as unknown as Queue,
      new MetricsService(),
      release as unknown as ReleaseIdentityService,
    );

    await expect(service.check()).resolves.toMatchObject({
      status: 'degraded',
      db: false,
      redis: false,
      state: 'Unready',
    });
  });

  it('reports unready when the migration version is incompatible', async () => {
    const pg = {
      healthCheck: vi.fn().mockResolvedValue(true),
      schemaVersion: vi.fn().mockResolvedValue('build-v3-44'),
    };
    const queue = {
      waitUntilReady: vi.fn().mockResolvedValue({ ping: vi.fn().mockResolvedValue('PONG') }),
    };
    const service = new HealthService(
      pg as unknown as PgService,
      queue as unknown as Queue,
      new MetricsService(),
      release as unknown as ReleaseIdentityService,
    );

    await expect(service.check()).resolves.toMatchObject({
      state: 'Unready',
      schema: { current: 'build-v3-44', compatible: false },
    });
  });
});
