import type { ConfigService } from '@nestjs/config';
import { API_MAJOR_VERSION, CONTRACT_VERSION } from '@umi/contract';
import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import type { PgService } from '../../shared/database/pg.service';
import { MetricsService } from '../../shared/operations/metrics.service';
import {
  ReleaseIdentityService,
  type ReleaseIdentity,
} from '../../shared/release/release-identity.service';
import { HealthService } from './health.service';

const release = {
  current: vi.fn().mockReturnValue({
    application: 'umi-api',
    version: '6.0.0-pilot.1',
    gitCommit: 'a'.repeat(40),
    buildTimestamp: '2026-08-11T12:00:00.000Z',
    environment: 'pilot',
    apiMajorVersion: API_MAJOR_VERSION,
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
      release: { version: '6.0.0-pilot.1', apiMajorVersion: API_MAJOR_VERSION },
    });
  });

  it('reports the generated HTTP major and the generated artifact version', () => {
    const values: Record<string, string> = {
      UMI_ENVIRONMENT: 'pilot',
      CONFIG_SCHEMA_VERSION: '1',
      MINIMUM_POS_VERSION: '0.1.0',
      MINIMUM_DASHBOARD_VERSION: '0.1.0',
    };
    const config = {
      get: (key: string) => values[key],
    };
    const identity: ReleaseIdentity = new ReleaseIdentityService(
      config as unknown as ConfigService<AppConfig, true>,
    ).current();

    expect(identity.apiMajorVersion).toBe(API_MAJOR_VERSION);
    expect(identity.apiMajorVersion).toBe(1);
    expect(identity.contractVersion).toBe(CONTRACT_VERSION);
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
