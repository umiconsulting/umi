import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { DeadLetterService } from './dead-letter.service';
import type { QueueRepository } from './queue.repository';

function makeJob(overrides: Partial<Job>): Job {
  return {
    id: 'j1',
    name: 'turn.process',
    queueName: 'turns',
    data: {},
    attemptsMade: 3,
    opts: { attempts: 3 },
    ...overrides,
  } as unknown as Job;
}

function serviceWithRepo() {
  const repo = { recordDeadLetter: vi.fn().mockResolvedValue(undefined) };
  const svc = new DeadLetterService(repo as unknown as QueueRepository);
  return { svc, repo };
}

describe('DeadLetterService', () => {
  it('persists a tenant-scoped job to runtime.dead_letters', async () => {
    const { svc, repo } = serviceWithRepo();
    await svc.recordTerminalFailure(
      makeJob({ data: { tenant_id: 't1', foo: 1 }, attemptsMade: 3 }),
      new Error('boom'),
    );
    expect(repo.recordDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        sourceTable: 'turns',
        eventType: 'turn.process',
        error: 'boom',
        attempts: 3,
      }),
    );
  });

  it('accepts camelCase tenantId too', async () => {
    const { svc, repo } = serviceWithRepo();
    await svc.recordTerminalFailure(
      makeJob({ data: { tenantId: 't2' } }),
      new Error('x'),
    );
    expect(repo.recordDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't2' }),
    );
  });

  it('is log-only for infra jobs with no tenant (FK would reject)', async () => {
    const { svc, repo } = serviceWithRepo();
    await svc.recordTerminalFailure(makeJob({ data: {} }), new Error('x'));
    expect(repo.recordDeadLetter).not.toHaveBeenCalled();
  });

  it('only sets source_id when the job id is a real uuid', async () => {
    const { svc, repo } = serviceWithRepo();
    const uuid = '11111111-2222-3333-4444-555555555555';
    await svc.recordTerminalFailure(
      makeJob({ id: uuid, data: { tenant_id: 't1' } }),
      new Error('x'),
    );
    expect(repo.recordDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: uuid }),
    );

    repo.recordDeadLetter.mockClear();
    await svc.recordTerminalFailure(
      makeJob({ id: '42', data: { tenant_id: 't1' } }),
      new Error('x'),
    );
    expect(repo.recordDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: null }),
    );
  });

  it('never throws when the dead-letter insert fails (best-effort)', async () => {
    const repo = {
      recordDeadLetter: vi.fn().mockRejectedValue(new Error('db down')),
    };
    const svc = new DeadLetterService(repo as unknown as QueueRepository);
    await expect(
      svc.recordTerminalFailure(
        makeJob({ data: { tenant_id: 't1' } }),
        new Error('x'),
      ),
    ).resolves.toBeUndefined();
  });
});
