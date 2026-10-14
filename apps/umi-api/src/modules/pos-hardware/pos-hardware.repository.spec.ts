import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { PgService } from '../../shared/database/pg.service';
import { PosHardwareRepository } from './pos-hardware.repository';

const MERCHANT = '10000000-0000-4000-8000-000000000101';
const LOCATION = '10000000-0000-4000-8000-000000000102';
const SESSION = '10000000-0000-4000-8000-000000000103';
const USER = '30000000-0000-4000-8000-000000000001';

/**
 * THE QUEUE COSTS ONE STATEMENT, NOT ONE FOR EACH JOB.
 *
 * The runtime read carried the whole print queue of the location, and the repository
 * asked for each job with its own query. On 2026-10-12 the pilot location held 59 jobs,
 * so one status read ran about 64 statements, and the read grew slower while the day
 * ran: 28 ms at 06:00 and 48 ms at 08:20, with no code change. The till asks for that
 * read every ten seconds.
 */
function harness(jobs: number) {
  const statements: { text: string; values?: unknown[] }[] = [];
  const jobRow = (index: number) => ({
    jobId: `10000000-0000-4000-8000-0000000002${String(index).padStart(2, '0')}`,
    targetPrinterId: '10000000-0000-4000-8000-000000000301',
    type: 'official_receipt',
    sourceAggregateType: 'receipt',
    sourceAggregateId: `receipt-${index}`,
    correlationId: `correlation-${index}`,
    idempotencyKey: `idempotency-${index}`,
    payloadFingerprint: 'a'.repeat(64),
    copies: 1,
    status: 'printed',
    attempts: 1,
    createdAt: new Date('2026-10-12T00:00:00.000Z'),
    startedAt: new Date('2026-10-12T00:00:01.000Z'),
    completedAt: new Date('2026-10-12T00:00:02.000Z'),
    failureCode: null,
    originalJobId: null,
  });
  const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      statements.push({ text, values });
      if (text.includes('read_hardware_runtime')) return { rows: [], rowCount: 1 };
      if (text.includes('FROM merchant.hardware_print_job j')) {
        return { rows: Array.from({ length: jobs }, (_, index) => jobRow(index)), rowCount: jobs };
      }
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as PoolClient;
  const pg = {
    runWithMerchant: vi.fn(
      async (
        _merchantId: string,
        _userId: string | null,
        work: (c: PoolClient) => Promise<unknown>,
      ) => work(client),
    ),
  };
  return { statements, pg, repository: new PosHardwareRepository(pg as unknown as PgService) };
}

describe('PosHardwareRepository.snapshot', () => {
  it('reads the print queue with one statement, whatever the number of jobs', async () => {
    for (const jobs of [1, 12, 59]) {
      const { statements, repository } = harness(jobs);

      const snapshot = await repository.snapshot(USER, MERCHANT, {
        locationId: LOCATION,
        operatorSessionId: SESSION,
        includeDisabled: false,
      });

      const queueReads = statements.filter((entry) =>
        entry.text.includes('FROM merchant.hardware_print_job j'),
      );
      expect(queueReads).toHaveLength(1);
      expect(snapshot.printJobs).toHaveLength(jobs);
      // The state of a job is the state of its newest event: the lateral join is the
      // rule, and it must stay in the one statement.
      expect(queueReads[0].text).toContain('LEFT JOIN LATERAL');
      // The whole read stays a handful of statements, not a number that follows the
      // queue: one for the runtime, one for the devices, one for the queue, one for the
      // policy, and one for the unknown commands.
      expect(statements.length).toBeLessThanOrEqual(6);
    }
  });

  it('reports the state of the newest event of a job', async () => {
    const { repository } = harness(1);

    const snapshot = await repository.snapshot(USER, MERCHANT, {
      locationId: LOCATION,
      operatorSessionId: SESSION,
      includeDisabled: false,
    });

    expect(snapshot.printJobs?.[0].status).toBe('printed');
    expect(snapshot.printJobs?.[0].createdAt).toBe('2026-10-12T00:00:00.000Z');
    expect(snapshot.printJobs?.[0].failure).toBeNull();
  });
});
