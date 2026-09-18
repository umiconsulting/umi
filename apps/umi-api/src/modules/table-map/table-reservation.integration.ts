import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';

/**
 * A DOUBLE BOOKING IS IMPOSSIBLE BECAUSE THE DATABASE REFUSES IT.
 *
 * The plan's acceptance line for workstream D is "a double booking is impossible
 * at the database level, and the tests prove both". The word that carries the
 * weight is *database*: "the table is free, so insert" is two statements, and
 * two tills that run them at the same moment both read free and both write. A
 * constraint the API is merely supposed to consult is not a guarantee, it is a
 * convention with a window in it.
 *
 * So every case below runs against the REAL schema, as the REAL `api` role,
 * with RLS forced, and asserts what PostgreSQL actually answers — including the
 * SQLSTATE. It never asserts what the migration file says it would do.
 *
 * The pair that matters is the status one. `merchant.table_reservation_no_double_booking`
 * is a PARTIAL exclusion constraint (`where status in ('booked','seated')`), so
 * the same guarantee that refuses the second hold is also what releases a window
 * when a booking is cancelled. A test suite that only proved one direction would
 * pass with an unconditional constraint, and the table could never be re-booked.
 *
 * Numbered against the doors in this file rather than the doors in production:
 *
 *   1. second overlapping hold on one table    → REFUSED, 23P01, names the constraint
 *   2. the same window on another table        → allowed (no false conflict)
 *   3. the adjacent window on the same table   → allowed (half-open `[)`)
 *   4. cancelled releases, seated does not     → the partial predicate, both ways
 *   5. same table, different location          → allowed (location is part of the key)
 *   6. a move onto an occupied window          → REFUSED (the constraint covers UPDATE)
 *   7. a move onto a free table                → allowed (the acceptance line's move)
 *   8. an unknown status                       → REFUSED (a typo must not escape the predicate)
 *   9. another merchant's bookings             → invisible to read, refused on write
 *
 * Self-seeding and self-cleaning; everything it writes is removed.
 *
 *   DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
 *     npx vitest run --config vitest.integration.config.ts table-reservation
 */

const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:5233/umi_backfill_v3';
const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3';

const JWT_SECRET = 'table-reservation-harness-secret-000000000000';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const MERCHANT = '7a000000-0000-4000-8000-0000000000a1';
const LOCATION = '7a000000-0000-4000-8000-0000000000a2';
const OTHER_LOCATION = '7a000000-0000-4000-8000-0000000000a3';
const TABLE = '7a000000-0000-4000-8000-0000000000b1';
const OTHER_TABLE = '7a000000-0000-4000-8000-0000000000b2';
const FREE_TABLE = '7a000000-0000-4000-8000-0000000000b3';
/** A second merchant, to prove this table's forced RLS isolates tenants too. */
const NEIGHBOUR = '7a000000-0000-4000-8000-0000000000a4';
const NEIGHBOUR_LOCATION = '7a000000-0000-4000-8000-0000000000a5';

const CONSTRAINT = 'table_reservation_no_double_booking';
/** The PostgreSQL SQLSTATE for `exclusion_violation`. */
const EXCLUSION_VIOLATION = '23P01';
/** The SQLSTATE for `check_violation`. */
const CHECK_VIOLATION = '23514';
/** The SQLSTATE for `insufficient_privilege`, which is how RLS refuses a write. */
const RLS_VIOLATION = '42501';

/**
 * One evening, and the windows that relate to it. 18:00-20:00 is the base; the
 * 19:00 start overlaps it by an hour; the 20:00 start touches its end and must
 * NOT be treated as an overlap.
 */
const WINDOW = { start: '2026-10-01T18:00:00Z', end: '2026-10-01T20:00:00Z' };
const OVERLAPPING = { start: '2026-10-01T19:00:00Z', end: '2026-10-01T21:00:00Z' };
const ADJACENT = { start: '2026-10-01T20:00:00Z', end: '2026-10-01T22:00:00Z' };

interface Window {
  start: string;
  end: string;
}

/** The shape node-postgres gives a server-side error: the SQLSTATE and the object it names. */
interface PgError {
  code?: string;
  constraint?: string;
  message?: string;
}

describe('table reservation · the exclusion constraint is the guarantee', () => {
  let pg: PgService;

  /**
   * Book as the REQUEST PATH: `tquery` runs on the RLS-enforced `api` pool with
   * `app.current_merchant` set for the transaction, so every write below also
   * exercises the forced row-level security the API would meet in production.
   */
  async function book(input: {
    locationId?: string;
    tableId: string;
    window: Window;
    status?: string;
    guest?: string;
    /** When false, the upper bound is sent as NULL — an unbounded hold. */
    bounded?: boolean;
  }): Promise<string> {
    const { rows } = await pg.tquery<{ id: string }>(
      MERCHANT,
      `INSERT INTO merchant.table_reservation
         (merchant_id, location_id, table_id, guest_name, party_size, during, status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, 8,
               tstzrange($5::timestamptz, $6::timestamptz, '[)'), $7::text)
       RETURNING id`,
      [
        MERCHANT,
        input.locationId ?? LOCATION,
        input.tableId,
        input.guest ?? 'Mesa ocho',
        input.window.start,
        // `bounded: false` sends the upper bound as NULL: an unbounded hold.
        input.bounded === false ? null : input.window.end,
        input.status ?? 'booked',
      ],
    );
    return rows[0].id;
  }

  /** Run a write and hand back the error instead of throwing, so the test can read it. */
  async function expectRefused(work: () => Promise<unknown>): Promise<PgError> {
    try {
      await work();
    } catch (err) {
      return err as PgError;
    }
    throw new Error('the database ACCEPTED a write it was supposed to refuse');
  }

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();

    await pg.query(`DELETE FROM merchant.merchant WHERE id = $1::uuid`, [MERCHANT]);
    await pg.query(`INSERT INTO merchant.merchant (id, name, handle) VALUES ($1::uuid, $2, $3)`, [
      MERCHANT,
      'Table Reservation Harness',
      'table-reservation-harness',
    ]);
    await pg.query(
      `INSERT INTO merchant.location (id, merchant_id, name) VALUES
         ($1::uuid, $3::uuid, 'Salón'), ($2::uuid, $3::uuid, 'Terraza')`,
      [LOCATION, OTHER_LOCATION, MERCHANT],
    );

    // The neighbour owns a location of its own, so the only thing standing
    // between it and merchant.table_reservation is the policy.
    await pg.query(`DELETE FROM merchant.merchant WHERE id = $1::uuid`, [NEIGHBOUR]);
    await pg.query(`INSERT INTO merchant.merchant (id, name, handle) VALUES ($1::uuid, $2, $3)`, [
      NEIGHBOUR,
      'Vecino Harness',
      'vecino-table-reservation-harness',
    ]);
    await pg.query(
      `INSERT INTO merchant.location (id, merchant_id, name) VALUES ($1::uuid, $2::uuid, 'Vecino')`,
      [NEIGHBOUR_LOCATION, NEIGHBOUR],
    );
  });

  // Each case starts from an empty book, so none of them depends on another's
  // leftovers — an order-dependent guarantee proof is not a proof.
  beforeEach(async () => {
    await pg.query(`DELETE FROM merchant.table_reservation WHERE merchant_id = ANY($1::uuid[])`, [
      [MERCHANT, NEIGHBOUR],
    ]);
  });

  afterAll(async () => {
    await pg?.query(`DELETE FROM merchant.table_reservation WHERE merchant_id = ANY($1::uuid[])`, [
      [MERCHANT, NEIGHBOUR],
    ]);
    await pg?.query(`DELETE FROM merchant.merchant WHERE id = ANY($1::uuid[])`, [
      [MERCHANT, NEIGHBOUR],
    ]);
    await pg?.onModuleDestroy?.();
  });

  it('REFUSES the second overlapping hold on one table, and names the constraint', async () => {
    const first = await book({ tableId: TABLE, window: WINDOW });
    expect(first).toBeTruthy();

    const error = await expectRefused(() =>
      book({ tableId: TABLE, window: OVERLAPPING, guest: 'La segunda' }),
    );

    expect(error.code, `expected ${EXCLUSION_VIOLATION}, got ${error.code}`).toBe(
      EXCLUSION_VIOLATION,
    );
    expect(error.constraint).toBe(CONSTRAINT);
    expect(error.message).toContain(CONSTRAINT);

    // The refusal is not a phantom: exactly one hold is on the table, and it is
    // the first one. A constraint that refused BOTH writes would also "pass" a
    // test that only looked for an error.
    const { rows } = await pg.tquery<{ holding: string; total: string }>(
      MERCHANT,
      `SELECT count(*) FILTER (WHERE status IN ('booked','seated'))::text AS holding,
              count(*)::text AS total
         FROM merchant.table_reservation
        WHERE merchant_id = $1::uuid AND table_id = $2::uuid`,
      [MERCHANT, TABLE],
    );
    expect(rows[0].holding).toBe('1');
    expect(rows[0].total).toBe('1');
  });

  it('allows the same window on a DIFFERENT table — no false conflict', async () => {
    await book({ tableId: TABLE, window: WINDOW });
    await expect(
      book({ tableId: OTHER_TABLE, window: WINDOW, guest: 'Otra mesa' }),
    ).resolves.toBeTruthy();
  });

  it('allows the ADJACENT window on the same table — `[)` does not overlap', async () => {
    await book({ tableId: TABLE, window: WINDOW });
    // 20:00 starts exactly where 18:00-20:00 ends.
    await expect(
      book({ tableId: TABLE, window: ADJACENT, guest: 'Segundo turno' }),
    ).resolves.toBeTruthy();
  });

  it('frees the window when the hold is CANCELLED', async () => {
    const held = await book({ tableId: TABLE, window: WINDOW });
    await pg.tquery(
      MERCHANT,
      `UPDATE merchant.table_reservation SET status = 'cancelled' WHERE id = $1::uuid`,
      [held],
    );
    await expect(
      book({ tableId: TABLE, window: OVERLAPPING, guest: 'La nueva' }),
    ).resolves.toBeTruthy();
  });

  it('KEEPS the window when the party is SEATED — the release is the status, not a lapse', async () => {
    const held = await book({ tableId: TABLE, window: WINDOW, status: 'seated' });
    const error = await expectRefused(() =>
      book({ tableId: TABLE, window: OVERLAPPING, guest: 'La segunda' }),
    );
    expect(error.code).toBe(EXCLUSION_VIOLATION);
    expect(held).toBeTruthy();
  });

  it('does not conflict with the same table id in a different LOCATION', async () => {
    await book({ locationId: LOCATION, tableId: TABLE, window: WINDOW });
    await expect(
      book({ locationId: OTHER_LOCATION, tableId: TABLE, window: WINDOW, guest: 'Terraza' }),
    ).resolves.toBeTruthy();
  });

  it('REFUSES to move a party onto a window that is already held', async () => {
    const eight = await book({ tableId: OTHER_TABLE, window: WINDOW, guest: 'Mesa ocho' });
    await book({ tableId: TABLE, window: OVERLAPPING, guest: 'La que ya estaba' });

    // The move the acceptance line names, refused. The constraint covers UPDATE,
    // so "move this party to table X" cannot become the way to double-book.
    const error = await expectRefused(() =>
      pg.tquery(
        MERCHANT,
        `UPDATE merchant.table_reservation SET table_id = $2::uuid WHERE id = $1::uuid`,
        [eight, TABLE],
      ),
    );
    expect(error.code).toBe(EXCLUSION_VIOLATION);
    expect(error.constraint).toBe(CONSTRAINT);
  });

  it('allows the move when the destination is FREE — the guarantee does not block the move', async () => {
    const eight = await book({ tableId: OTHER_TABLE, window: WINDOW, guest: 'Mesa ocho' });
    await pg.tquery(
      MERCHANT,
      `UPDATE merchant.table_reservation SET table_id = $2::uuid WHERE id = $1::uuid`,
      [eight, FREE_TABLE],
    );
    const { rows } = await pg.tquery<{ table_id: string }>(
      MERCHANT,
      `SELECT table_id::text FROM merchant.table_reservation WHERE id = $1::uuid`,
      [eight],
    );
    expect(rows[0].table_id).toBe(FREE_TABLE);
  });

  it('REFUSES an unknown status, so a typo cannot slip past the partial predicate', async () => {
    // 'canceled' (one L) is not in the vocabulary, so it matches neither the
    // constraint's predicate nor the "released" set: the row would occupy the
    // table for ever while reading like a cancellation. The CHECK is what keeps
    // the status load-bearing.
    const error = await expectRefused(() =>
      book({ tableId: TABLE, window: WINDOW, status: 'canceled' }),
    );
    expect(error.code).toBe(CHECK_VIOLATION);
  });

  it('REFUSES a window with no end, which would occupy the table for ever', async () => {
    const error = await expectRefused(() =>
      book({ tableId: TABLE, window: WINDOW, bounded: false }),
    );
    expect(error.code).toBe(CHECK_VIOLATION);
  });

  it('hides the bookings from another merchant, on READ', async () => {
    await book({ tableId: TABLE, window: WINDOW });
    const { rows } = await pg.tquery<{ visible: string }>(
      NEIGHBOUR,
      `SELECT count(*)::text AS visible FROM merchant.table_reservation`,
    );
    expect(rows[0].visible).toBe('0');
  });

  it('REFUSES a write that claims another merchant, on WRITE', async () => {
    // The policy's WITH CHECK applies before the composite foreign key, so the
    // refusal names row-level security rather than the FK — verified against the
    // real database rather than assumed.
    const error = await expectRefused(() =>
      pg.tquery(
        NEIGHBOUR,
        `INSERT INTO merchant.table_reservation
           (merchant_id, location_id, table_id, party_size, during)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 8,
                 tstzrange($4::timestamptz, $5::timestamptz, '[)'))`,
        [MERCHANT, LOCATION, TABLE, WINDOW.start, WINDOW.end],
      ),
    );
    expect(error.code, `expected ${RLS_VIOLATION}, got ${error.code}`).toBe(RLS_VIOLATION);
  });
});
