import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'bullmq';
import type { AppConfig } from '../shared/config/config.schema';
import { ALL_QUEUES } from './queues';
import { JobPriority, toBullPriority } from './job-options';
import { EnqueueService } from './enqueue.service';
import { QueueRepository } from './queue.repository';
import { OutboxRouter } from './outbox-relay.service';

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
    // WHATWG URL keeps username/password percent-encoded; ioredis wants them
    // decoded, so special chars (@ : / # %) in the password authenticate correctly.
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
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
    // Register every queue with a non-zero default priority so a raw
    // `getQueue().add(...)` (e.g. repeatable jobs) can never default to BullMQ's
    // priority 0 — which is the MOST urgent and would preempt interactive turns.
    // `EnqueueService.enqueue` overrides this per-job with the mapped priority.
    ...ALL_QUEUES.map((name) =>
      BullModule.registerQueue({
        name,
        defaultJobOptions: { priority: toBullPriority(JobPriority.Default) },
      }),
    ),
  ],
  // Producer-side infra shared by both processes: the single enqueue entry
  // point, the queue.* durability repository, and the outbox route registry.
  // Consumers (processors, dead-letter wiring, the relay loop) live in
  // WorkerModule so they only run in the worker process.
  providers: [EnqueueService, QueueRepository, OutboxRouter],
  exports: [BullModule, EnqueueService, QueueRepository, OutboxRouter],
})
export class QueueModule {}
