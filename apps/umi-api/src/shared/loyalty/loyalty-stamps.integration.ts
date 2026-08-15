import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema';
import { PgService } from '../database/pg.service';
import { LOYALTY_CARD_STATE_SQL } from './card-state.sql';

/**
 * A STAMP HAS A MAGNITUDE — proven against a real database.
 *
 * `merchant.loyalty_visit` is one row per INTERACTION, and an interaction can be
 * worth up to 50 stamps: the "Agregar sellos" catch-up path credits a customer
 * who arrived from an external loyalty system. Reward maths must therefore read
 * `sum(stamps)`, never `count(*)`.
 *
 * The bug this file exists to prevent already happened, and it is invisible from
 * every direction that normally reports one:
 *
 *   - The customer keeps a card that opens and scans. Only the NUMBER is short.
 *   - `reconcile_v3.sql` balanced, because the backfill invented synthetic rows
 *     to make `count(*)` match the stamp total it had just discarded.
 *   - Measured cost: 18 Kalala customers, 87 stamps, worst card 20 -> 5.
 *
 * A unit test cannot catch it. The formula is SQL, the defect is in what the SQL
 * counts, and a mocked repository returns whatever the mock was told to return.
 * `cash-write.service.spec.ts` mocks the repository and stayed green throughout.
 *
 * Self-seeding, so it runs against any build-v3 database — including the pristine
 * one CI builds. Every row it writes is removed in afterAll.
 *
 *   PGPORT=5233 DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
 *     npx vitest run --config vitest.integration.config.ts loyalty-stamps
 */

const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:5233/umi_backfill_v3';
const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const MERCHANT = '9f000000-0000-4000-8000-0000000000a1';
const CUSTOMER = '9f000000-0000-4000-8000-0000000000a2';
const CARD = '9f000000-0000-4000-8000-0000000000a3';
/** The café requires 10 stamps per reward, so the arithmetic below is legible. */
const REQUIRED = 10;

interface CardState {
  total_visits: number;
  visits_this_cycle: number;
  pending_rewards: number;
  visits_required: number;
}

describe('loyalty stamps · a row is not a magnitude', () => {
  let pg: PgService;

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();

    await pg.query(`DELETE FROM merchant.merchant WHERE id = $1::uuid`, [MERCHANT]);
    await pg.query(
      `INSERT INTO merchant.merchant (id, name, handle) VALUES ($1::uuid, 'Stamp Test', 'stamptest')`,
      [MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.customer (id, merchant_id, name) VALUES ($1::uuid, $2::uuid, 'Ana')`,
      [CUSTOMER, MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.loyalty_card (id, merchant_id, customer_id, card_number)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'STAMP-1')`,
      [CARD, MERCHANT, CUSTOMER],
    );
    await pg.query(
      `INSERT INTO merchant.loyalty_reward (merchant_id, name, type, stamps_required, active)
       VALUES ($1::uuid, 'Café gratis', 'stamps_free_item', $2, true)`,
      [MERCHANT, REQUIRED],
    );
  });

  afterAll(async () => {
    await pg?.query(`DELETE FROM merchant.merchant WHERE id = $1::uuid`, [MERCHANT]);
    await pg?.onModuleDestroy?.();
  });

  const clearVisits = () =>
    pg.query(`DELETE FROM merchant.loyalty_visit WHERE merchant_id = $1::uuid`, [MERCHANT]);

  const addVisit = (stamps: number, source = 'scan') =>
    pg.query(
      `INSERT INTO merchant.loyalty_visit (merchant_id, card_id, source, stamps)
       VALUES ($1::uuid, $2::uuid, $3, $4)`,
      [MERCHANT, CARD, source, stamps],
    );

  const state = async (): Promise<CardState> => {
    const { rows } = await pg.query<CardState>(LOYALTY_CARD_STATE_SQL, [MERCHANT, CARD]);
    return rows[0];
  };

  it('a scan defaults to one stamp, so nothing about the ordinary path changed', async () => {
    await clearVisits();
    await addVisit(1);
    await addVisit(1);
    await addVisit(1);
    const s = await state();
    expect(s.total_visits).toBe(3);
    expect(s.visits_this_cycle).toBe(3);
    expect(s.pending_rewards).toBe(0);
  });

  it('THE REGRESSION · one bulk credit of 9 is worth 9 stamps, not 1', async () => {
    await clearVisits();
    await addVisit(1);
    await addVisit(9, 'manual_bulk');

    const s = await state();
    // count(*) would say 2 here, and that is exactly the defect: a customer who
    // was credited 9 stamps for her migrated card would see 2.
    expect(s.total_visits).toBe(10);
    expect(s.visits_this_cycle).toBe(0); // 10 % 10
    expect(s.pending_rewards).toBe(1); // she has earned the reward
  });

  it('the worst measured card · 20 stamps must not read as 5', async () => {
    await clearVisits();
    // The shape that cost the real customer: four interactions, one of them a
    // large catch-up. count(*) = 5, sum(stamps) = 20.
    await addVisit(1);
    await addVisit(1);
    await addVisit(1);
    await addVisit(1);
    await addVisit(16, 'manual_bulk');

    const s = await state();
    expect(s.total_visits).toBe(20);
    expect(s.pending_rewards).toBe(2);
    // And the interaction count is still available and still true.
    const { rows } = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM merchant.loyalty_visit
        WHERE merchant_id = $1::uuid AND card_id = $2::uuid`,
      [MERCHANT, CARD],
    );
    expect(rows[0].n).toBe(5);
  });

  it('a card with no visits reads 0, not NULL', async () => {
    await clearVisits();
    const s = await state();
    expect(s.total_visits).toBe(0);
    expect(s.pending_rewards).toBe(0);
  });

  it('the CHECK bounds the magnitude · 51 is rejected', async () => {
    await clearVisits();
    await expect(addVisit(51, 'manual_bulk')).rejects.toThrow(/loyalty_visit_stamps_check/);
    await expect(addVisit(0)).rejects.toThrow(/loyalty_visit_stamps_check/);
    // 50 is the documented cap and must still be accepted.
    await expect(addVisit(50, 'manual_bulk')).resolves.toBeDefined();
  });

  it("the source CHECK rejects 'migration' · the fabrication label is gone", async () => {
    await clearVisits();
    await expect(addVisit(1, 'migration')).rejects.toThrow(/loyalty_visit_source_check/);
    await expect(addVisit(1, 'manual_bulk')).resolves.toBeDefined();
  });

  it('a retried catch-up credit is idempotent per merchant', async () => {
    await clearVisits();
    const key = 'catchup-retry-1';
    const insert = () =>
      pg.query(
        `INSERT INTO merchant.loyalty_visit
           (merchant_id, card_id, source, stamps, idempotency_key)
         VALUES ($1::uuid, $2::uuid, 'manual_bulk', 5, $3)`,
        [MERCHANT, CARD, key],
      );
    await insert();
    // The second attempt is the retry, and it must not credit another 5 stamps.
    await expect(insert()).rejects.toThrow(/loyalty_visit_idem_uq/);

    const s = await state();
    expect(s.total_visits).toBe(5);
  });

  it('multi_seal_enabled has a typed home, so the bulk gate can be read on build-v3', async () => {
    // The umi-cash endpoint answers 403 when this is off. On build-v3 there is no
    // branding jsonb to read it from, so it must exist as a column or the gate
    // has nowhere to look.
    await pg.query(
      `INSERT INTO merchant.loyalty_program (merchant_id, multi_seal_enabled)
       VALUES ($1::uuid, true)
       ON CONFLICT (merchant_id) DO UPDATE SET multi_seal_enabled = excluded.multi_seal_enabled`,
      [MERCHANT],
    );
    const { rows } = await pg.query<{ multi_seal_enabled: boolean }>(
      `SELECT multi_seal_enabled FROM merchant.loyalty_program WHERE merchant_id = $1::uuid`,
      [MERCHANT],
    );
    expect(rows[0].multi_seal_enabled).toBe(true);
  });
});
