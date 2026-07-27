import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { PgService } from '../../shared/database/pg.service';
import { IntegrityRepository } from './integrity.repository';

describe('IntegrityRepository concurrency', () => {
  it('increments an aggregate only when the expected version matches', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ version: '4' }], rowCount: 1 }),
    } as unknown as PoolClient;
    const repository = new IntegrityRepository({} as PgService);

    await expect(
      repository.claimVersion(
        client,
        '10000000-0000-4000-8000-000000000001',
        'order',
        '20000000-0000-4000-8000-000000000001',
        3,
      ),
    ).resolves.toBe(4);
  });

  it('fails closed when another transaction already changed the version', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    } as unknown as PoolClient;
    const repository = new IntegrityRepository({} as PgService);

    await expect(
      repository.claimVersion(
        client,
        '10000000-0000-4000-8000-000000000001',
        'order',
        '20000000-0000-4000-8000-000000000001',
        3,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('uses the RLS-scoped transaction boundary', async () => {
    const pg = { withTenant: vi.fn().mockResolvedValue('committed') };
    const repository = new IntegrityRepository(pg as unknown as PgService);
    const work = vi.fn();

    await expect(repository.transaction(work)).resolves.toBe('committed');
    expect(pg.withTenant).toHaveBeenCalledWith(work);
  });
});
