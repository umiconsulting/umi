import { describe, expect, it, vi } from 'vitest';
import { PointCredentialRenewalScheduler } from './mp-point-credential.scheduler';

describe('the Mercado Pago point credential renewal scheduler', () => {
  const queueWith = () => ({
    upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    removeJobScheduler: vi.fn().mockResolvedValue(undefined),
  });

  it('registers the sweep with its margin and batch in the payload', async () => {
    const queue = queueWith();
    const scheduler = new PointCredentialRenewalScheduler(
      { getQueue: vi.fn().mockReturnValue(queue) } as never,
      { get: vi.fn().mockReturnValue('client-id') } as never,
    );

    await scheduler.onModuleInit();

    // The policy travels WITH the job: the sweep states its own margin, so the number lives in
    // one place rather than in a scheduler and in the service that reads it.
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'mercado-pago-point:credential-renewal',
      { every: 6 * 60 * 60 * 1000 },
      { name: 'point_credential_renewal', data: { marginDays: 14, batchSize: 100 } },
    );
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it('REMOVES the sweep when the deployment has no application identity', async () => {
    const queue = queueWith();
    const scheduler = new PointCredentialRenewalScheduler(
      { getQueue: vi.fn().mockReturnValue(queue) } as never,
      // No client id: nothing can be renewed, and the scheduler must stop enqueueing work whose
      // only possible outcome is a warning.
      { get: vi.fn().mockReturnValue(undefined) } as never,
    );

    await scheduler.onModuleInit();

    expect(queue.removeJobScheduler).toHaveBeenCalledWith('mercado-pago-point:credential-renewal');
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });
});
