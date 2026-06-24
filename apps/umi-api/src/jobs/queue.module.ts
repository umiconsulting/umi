import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'bullmq';
import type { AppConfig } from '../shared/config/config.schema';
import { ALL_QUEUES } from './queues';

/** Parse REDIS_URL into BullMQ-compatible RedisOptions (no ioredis instance). */
function redisOptionsFromUrl(url: string): RedisOptions {
  const u = new URL(url);
  const db =
    u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0;
  if (!Number.isInteger(db) || db < 0) {
    throw new Error(`Invalid REDIS_URL database index: "${u.pathname}"`);
  }
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    db,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    // Required by BullMQ for blocking operations.
    maxRetriesPerRequest: null,
  };
}

/**
 * BullMQ wiring shared by the web (producer) and worker (consumer) processes.
 * Registers the Redis connection and every queue from `queues.ts`. Processors
 * are NOT here — they're provided by WorkerModule so they only run in the
 * worker process.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: redisOptionsFromUrl(
          config.get('REDIS_URL', { infer: true }),
        ),
      }),
    }),
    ...ALL_QUEUES.map((name) => BullModule.registerQueue({ name })),
  ],
  exports: [BullModule],
})
export class QueueModule {}
