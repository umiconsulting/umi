import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PgService } from '../../shared/database/pg.service';
import { QUEUES } from '../../jobs/queues';

export interface HealthResult {
  status: 'ok' | 'degraded';
  db: boolean;
  redis: boolean;
  ts: string;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly pg: PgService,
    @InjectQueue(QUEUES.system) private readonly systemQueue: Queue,
  ) {}

  async check(): Promise<HealthResult> {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    return {
      status: db && redis ? 'ok' : 'degraded',
      db,
      redis,
      ts: new Date().toISOString(),
    };
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
}
