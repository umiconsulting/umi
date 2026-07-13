import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../shared/config/config.schema';
import { EnqueueService } from './enqueue.service';
import { JobPriority } from './job-options';
import { QueueRepository, type OutboxEventRow } from './queue.repository';
import type { QueueName } from './queues';

/**
 * How to deliver a given outbox `event_type` into BullMQ. Domain modules
 * register their routes (Phase 3) — e.g. `turn.completed → outbound/twilio.reply`,
 * `order.completed → enrichment/...`. The registry is empty in Phase 1c.
 */
export interface OutboxRoute {
  queue: QueueName;
  jobName: string;
  priority?: JobPriority;
  /** Derive a deterministic BullMQ jobId; defaults to the row idempotency_key. */
  jobId?: (event: OutboxEventRow) => string | undefined;
}

/** Mutable `event_type → route` registry, populated at module init by domains. */
@Injectable()
export class OutboxRouter {
  private readonly routes = new Map<string, OutboxRoute>();

  register(eventType: string, route: OutboxRoute): void {
    this.routes.set(eventType, route);
  }

  resolve(eventType: string): OutboxRoute | undefined {
    return this.routes.get(eventType);
  }

  get size(): number {
    return this.routes.size;
  }
}

/**
 * The transactional-outbox relay (spec §10.4). A domain service writes its state
 * change + a `runtime.outbox_event` row in one DB transaction; this relay drains
 * pending rows and pushes each into the matching BullMQ queue, then stamps it
 * delivered — so a crash between "write" and "send" can never drop a customer
 * reply. BullMQ is the execution layer over this durable boundary.
 *
 * Built and unit-tested in Phase 1c but INERT by default (`OUTBOX_RELAY_ENABLED`
 * defaults false): no routes are registered until Phase 3 wires the domains, and
 * there are 0 pending rows on the live DB. Flip the flag on in Phase 3b once
 * routes exist. Worker-process only.
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly enabled: boolean;
  private readonly batchSize = 50;
  private readonly intervalMs = 1_000;
  /** No-route rows are deferred this long so the relay never hot-loops on them. */
  private readonly noRouteDeferSeconds = 60;
  /**
   * A 'delivering' row older than this is treated as a stale lease (crashed
   * relay) and reclaimed. Generous vs the sub-second enqueue it guards.
   */
  private readonly outboxLeaseSeconds = 120;
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly repo: QueueRepository,
    private readonly router: OutboxRouter,
    private readonly enqueue: EnqueueService,
  ) {
    this.enabled = config.get('OUTBOX_RELAY_ENABLED', { infer: true });
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(
        'outbox relay inert (OUTBOX_RELAY_ENABLED=false) — enable in Phase 3 once routes are registered',
      );
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    // Don't keep the event loop alive solely for the relay poll.
    this.timer.unref?.();
    this.logger.log(`outbox relay started (${this.router.size} routes registered)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One drain pass. Re-entrancy guarded so ticks never overlap. */
  async tick(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const events = await this.repo.claimPendingOutbox(
        this.batchSize,
        this.outboxLeaseSeconds,
      );
      for (const event of events) {
        await this.relayOne(event);
      }
    } catch (err) {
      this.logger.error(
        `outbox drain failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.draining = false;
    }
  }

  /** Deliver a single claimed ('delivering') outbox row into BullMQ. */
  async relayOne(event: OutboxEventRow): Promise<void> {
    const route = this.router.resolve(event.eventType);
    if (!route) {
      this.logger.warn(
        `no outbox route for event_type=${event.eventType} (id=${event.id}); deferring ${this.noRouteDeferSeconds}s`,
      );
      await this.repo.deferOutbox(event.id, this.noRouteDeferSeconds);
      return;
    }
    try {
      await this.enqueue.enqueue(route.queue, route.jobName, event.payload, {
        priority: route.priority,
        jobId: route.jobId?.(event) ?? event.idempotencyKey,
      });
    } catch (err) {
      // Enqueue itself failed — BullMQ did NOT accept the job. Safe to retry
      // with backoff (→ 'dead' at max_attempts).
      await this.repo.markOutboxFailed(
        event.id,
        err instanceof Error ? err.message : String(err),
      );
      return;
    }

    // Enqueue succeeded — BullMQ owns the job now. A failed ack must NOT
    // re-deliver (that would double-enqueue); leave the row 'delivering' and let
    // the stale-lease reclaim retry the ack, deduped by the deterministic jobId.
    try {
      await this.repo.markOutboxDelivered(event.id);
    } catch (err) {
      this.logger.error(
        `outbox ack failed for ${event.id} (already enqueued; lease will reconcile): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
