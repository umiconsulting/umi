import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  OutboxRelayService,
  OutboxRouter,
} from './outbox-relay.service';
import type { EnqueueService } from './enqueue.service';
import type { OutboxEventRow, QueueRepository } from './queue.repository';
import { QUEUES } from './queues';
import { JobPriority } from './job-options';

function event(overrides: Partial<OutboxEventRow> = {}): OutboxEventRow {
  return {
    id: 'evt-1',
    tenantId: 't1',
    eventType: 'turn.completed',
    aggregateId: null,
    idempotencyKey: 'idem-1',
    payload: { tenantId: 't1', turnId: 'x' },
    attempts: 0,
    maxAttempts: 5,
    ...overrides,
  };
}

function harness(enabled = false) {
  const repo = {
    claimPendingOutbox: vi.fn().mockResolvedValue([]),
    markOutboxDelivered: vi.fn().mockResolvedValue(undefined),
    markOutboxFailed: vi.fn().mockResolvedValue(undefined),
    deferOutbox: vi.fn().mockResolvedValue(undefined),
  };
  const enqueue = { enqueue: vi.fn().mockResolvedValue('job-1') };
  const router = new OutboxRouter();
  const config = {
    get: () => enabled,
  } as unknown as ConfigService<Record<string, unknown>, true>;
  const svc = new OutboxRelayService(
    config,
    repo as unknown as QueueRepository,
    router,
    enqueue as unknown as EnqueueService,
  );
  return { svc, repo, enqueue, router };
}

describe('OutboxRelayService', () => {
  it('stays inert when disabled (no poll timer scheduled)', () => {
    const { svc } = harness(false);
    const spy = vi.spyOn(global, 'setInterval');
    svc.onModuleInit();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    svc.onModuleDestroy();
  });

  it('delivers a routed event into the mapped queue and marks it delivered', async () => {
    const { svc, repo, enqueue, router } = harness();
    router.register('turn.completed', {
      queue: QUEUES.outbound,
      jobName: 'twilio.reply',
      priority: JobPriority.Interactive,
    });

    await svc.relayOne(event());

    expect(enqueue.enqueue).toHaveBeenCalledWith(
      QUEUES.outbound,
      'twilio.reply',
      { tenantId: 't1', turnId: 'x' },
      expect.objectContaining({
        priority: JobPriority.Interactive,
        jobId: 'idem-1', // defaults to the row idempotency_key
      }),
    );
    expect(repo.markOutboxDelivered).toHaveBeenCalledWith('evt-1');
    expect(repo.markOutboxFailed).not.toHaveBeenCalled();
  });

  it('defers (does NOT fail) an event with no registered route', async () => {
    const { svc, repo, enqueue } = harness();
    await svc.relayOne(event({ eventType: 'unmapped.event' }));

    expect(enqueue.enqueue).not.toHaveBeenCalled();
    expect(repo.deferOutbox).toHaveBeenCalledWith('evt-1', expect.any(Number));
    // a missing route must never count against attempts → 'dead'
    expect(repo.markOutboxFailed).not.toHaveBeenCalled();
  });

  it('does NOT re-deliver when only the ack fails after a successful enqueue', async () => {
    const { svc, repo, enqueue, router } = harness();
    router.register('turn.completed', {
      queue: QUEUES.outbound,
      jobName: 'twilio.reply',
    });
    // enqueue succeeds; the post-enqueue ack write fails.
    repo.markOutboxDelivered.mockRejectedValueOnce(new Error('db blip'));

    await svc.relayOne(event());

    expect(enqueue.enqueue).toHaveBeenCalledOnce();
    // must not mark failed (would re-enqueue an already-accepted job)
    expect(repo.markOutboxFailed).not.toHaveBeenCalled();
  });

  it('marks the row failed when enqueue throws', async () => {
    const { svc, repo, enqueue, router } = harness();
    router.register('turn.completed', {
      queue: QUEUES.outbound,
      jobName: 'twilio.reply',
    });
    enqueue.enqueue.mockRejectedValueOnce(new Error('redis down'));

    await svc.relayOne(event());

    expect(repo.markOutboxFailed).toHaveBeenCalledWith('evt-1', 'redis down');
    expect(repo.markOutboxDelivered).not.toHaveBeenCalled();
  });

  it('drains a claimed batch through relayOne on tick', async () => {
    const { svc, repo, router } = harness();
    router.register('turn.completed', {
      queue: QUEUES.outbound,
      jobName: 'twilio.reply',
    });
    repo.claimPendingOutbox.mockResolvedValueOnce([event(), event({ id: 'evt-2', idempotencyKey: 'idem-2' })]);

    await svc.tick();

    expect(repo.claimPendingOutbox).toHaveBeenCalledOnce();
    expect(repo.markOutboxDelivered).toHaveBeenCalledTimes(2);
  });
});
