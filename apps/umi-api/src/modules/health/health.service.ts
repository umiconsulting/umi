import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PgService } from '../../shared/database/pg.service';
import { QUEUES } from '../../jobs/queues';
import { MetricsService } from '../../shared/operations/metrics.service';
import { ReleaseIdentityService } from '../../shared/release/release-identity.service';

export interface HealthResult {
  status: 'ok' | 'degraded';
  state: 'Healthy' | 'Unready';
  db: boolean;
  redis: boolean;
  ts: string;
  release: ReturnType<ReleaseIdentityService['current']>;
  schema: { current: string | null; expected: string; compatible: boolean };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly pg: PgService,
    @InjectQueue(QUEUES.system) private readonly systemQueue: Queue,
    private readonly metrics: MetricsService,
    private readonly releaseIdentity: ReleaseIdentityService,
  ) {}

  live(): { status: 'ok'; state: 'Healthy'; release: object; ts: string } {
    return {
      status: 'ok',
      state: 'Healthy',
      release: this.releaseIdentity.current(),
      ts: new Date().toISOString(),
    };
  }

  async check(): Promise<HealthResult> {
    const [db, redis, schemaVersion] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.checkSchemaVersion(),
    ]);
    const release = this.releaseIdentity.current();
    const schemaCompatible = schemaVersion === release.expectedSchemaVersion;
    const ready = db && redis && schemaCompatible;
    return {
      status: ready ? 'ok' : 'degraded',
      state: ready ? 'Healthy' : 'Unready',
      db,
      redis,
      release,
      schema: {
        current: schemaVersion,
        expected: release.expectedSchemaVersion,
        compatible: schemaCompatible,
      },
      ts: new Date().toISOString(),
    };
  }

  diagnostics(): object {
    const memory = process.memoryUsage();
    return {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
      },
      metrics: this.metrics.snapshot(),
      release: this.releaseIdentity.current(),
      ts: new Date().toISOString(),
    };
  }

  release(): object {
    return this.releaseIdentity.current();
  }

  private async checkDb(): Promise<boolean> {
    try {
      return await this.pg.healthCheck();
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      const client = (await this.systemQueue.waitUntilReady()) as unknown as {
        ping(): Promise<string>;
      };
      return (await client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  private async checkSchemaVersion(): Promise<string | null> {
    try {
      return await this.pg.schemaVersion();
    } catch {
      return null;
    }
  }
}
