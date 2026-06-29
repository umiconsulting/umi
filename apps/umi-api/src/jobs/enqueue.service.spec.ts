import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { EnqueueService } from './enqueue.service';
import { QUEUES } from './queues';
import { JobPriority, toBullPriority } from './job-options';

function makeQueue(): Queue {
  return { add: vi.fn().mockResolvedValue({ id: 'job-1' }) } as unknown as Queue;
}

function serviceWithQueues(): { svc: EnqueueService; queues: Record<string, Queue> } {
  const queues: Record<string, Queue> = {};
  for (const name of Object.values(QUEUES)) queues[name] = makeQueue();
  const svc = new EnqueueService(
    queues[QUEUES.system],
    queues[QUEUES.turns],
    queues[QUEUES.enrichment],
    queues[QUEUES.outbound],
    queues[QUEUES.integrations],
    queues[QUEUES.lifecycle],
  );
  return { svc, queues };
}

describe('EnqueueService', () => {
  it('applies queue defaults + inverted priority + deterministic jobId', async () => {
    const { svc, queues } = serviceWithQueues();
    const id = await svc.enqueue(
      QUEUES.turns,
      'turn.process',
      { tenantId: 't1' },
      { priority: JobPriority.Interactive, jobId: 'msg-abc' },
    );

    expect(id).toBe('job-1');
    expect(queues[QUEUES.turns].add).toHaveBeenCalledWith(
      'turn.process',
      { tenantId: 't1' },
      expect.objectContaining({
        priority: toBullPriority(JobPriority.Interactive),
        jobId: 'msg-abc',
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
      }),
    );
  });

  it('sanitizes ":" out of the jobId (BullMQ rejects it in custom ids)', async () => {
    const { svc, queues } = serviceWithQueues();
    await svc.enqueue(
      QUEUES.turns,
      'turn.process',
      { tenantId: 't1' },
      { jobId: 'turn_process:11111111-2222-3333-4444-555555555555' },
    );

    expect(queues[QUEUES.turns].add).toHaveBeenCalledWith(
      'turn.process',
      { tenantId: 't1' },
      expect.objectContaining({
        jobId: 'turn_process_11111111-2222-3333-4444-555555555555',
      }),
    );
  });

  it('routes to the requested queue and defaults priority', async () => {
    const { svc, queues } = serviceWithQueues();
    await svc.enqueue(QUEUES.outbound, 'twilio.reply', { tenantId: 't1' });

    expect(queues[QUEUES.turns].add).not.toHaveBeenCalled();
    expect(queues[QUEUES.outbound].add).toHaveBeenCalledWith(
      'twilio.reply',
      { tenantId: 't1' },
      expect.objectContaining({
        priority: toBullPriority(JobPriority.Default),
        attempts: 5, // outbound keeps the legacy outbox max_attempts
      }),
    );
  });
});
