import { describe, expect, it, vi } from 'vitest';
import { PosOfflineRepository } from './pos-offline.repository';

describe('PosOfflineRepository conflict discard eligibility', () => {
  it('allows an operator to discard a refused KDS transition', async () => {
    let sql = '';
    const client = {
      query: vi.fn(async (text: string) => {
        sql = text;
        return {
          rows: [
            {
              hasConflict: true,
              resolved: true,
              deviceSequence: '9',
              nextAcceptedSequence: '17',
              nextProcessedSequence: '17',
            },
          ],
        };
      }),
    };
    const pg = {
      runWithMerchant: vi.fn(
        async (
          _merchant: string,
          _user: string | null,
          run: (value: unknown) => Promise<unknown>,
        ) => run(client),
      ),
    };
    const repository = new PosOfflineRepository(pg as never);

    const result = await repository.resolveConflict(
      '10000000-0000-4000-8000-000000000101',
      '20000000-0000-4000-8000-000000000101',
      'f6d062b2-0a74-4122-9f85-f42adeb6f91f',
      1,
      '249cdde8-a74e-471c-aab0-c2f4a3226b3e',
    );

    expect(result).toEqual({
      resolved: true,
      deviceSequence: 9,
      nextAcceptedSequence: 17,
      nextProcessedSequence: 17,
    });
    expect(sql).toContain("'pos.kds.command'");
    expect(sql).toContain('kitchen_refusal:%');
    expect(sql).toContain('c.retryable=false');
  });
});

describe('PosOfflineRepository terminal command outcome', () => {
  const row = (state: 'open' | 'resolved') => ({
    commandId: '249cdde8-a74e-471c-aab0-c2f4a3226b3e',
    deviceSequence: '9',
    classification: 'server_validation_failed',
    blocksFollowing: false,
    operatorActionRequired: true,
    managerActionRequired: false,
    guidanceCode: 'kitchen_refusal:KITCHEN_INVALID_TRANSITION',
    correlationId: '00000000-0000-4000-8000-000000000099',
    officialId: null,
    retryable: false,
    id: '11111111-1111-4111-8111-111111111111',
    resolutionState: state,
  });

  function repositoryFor(state: 'open' | 'resolved') {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [row(state)] }),
    };
    const pg = {
      runWithMerchant: vi.fn(
        async (
          _merchant: string,
          _user: string | null,
          run: (value: unknown) => Promise<unknown>,
        ) => run(client),
      ),
    };
    return new PosOfflineRepository(pg as never);
  }

  it('returns an explicit discarded outcome for a resolved conflict', async () => {
    const result = await repositoryFor('resolved').commandResult(
      '10000000-0000-4000-8000-000000000101',
      '20000000-0000-4000-8000-000000000101',
      'f6d062b2-0a74-4122-9f85-f42adeb6f91f',
      1,
      '249cdde8-a74e-471c-aab0-c2f4a3226b3e',
    );
    expect(result?.status).toBe('rejected');
    expect(result?.failure?.guidanceCode).toBe('conflict_discarded');
  });

  it('keeps an open conflict explicit', async () => {
    const result = await repositoryFor('open').commandResult(
      '10000000-0000-4000-8000-000000000101',
      '20000000-0000-4000-8000-000000000101',
      'f6d062b2-0a74-4122-9f85-f42adeb6f91f',
      1,
      '249cdde8-a74e-471c-aab0-c2f4a3226b3e',
    );
    expect(result?.status).toBe('conflict');
    expect(result?.failure?.guidanceCode).toBe('kitchen_refusal:KITCHEN_INVALID_TRANSITION');
  });
});
