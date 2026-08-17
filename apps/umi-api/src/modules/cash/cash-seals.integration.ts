import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import { CashScanRepository } from './cash-scan.repository';

/**
 * THE BULK CREDIT IS IDEMPOTENT — proven against a real database.
 *
 * `loyalty-stamps.integration.ts` proves the SCHEMA holds the guarantee: a second
 * insert carrying the same key is rejected by `loyalty_visit_idem_uq`. This file
 * proves the REPOSITORY converts that guarantee into the right answer.
 *
 * The difference is what staff see. A retry that raises the unique violation is a
 * 500 on the register — for an action that already succeeded — and the barista
 * credits the stamps a second time by hand to "fix" it. The retry must instead
 * report that the seals already landed, which is what `ON CONFLICT … DO NOTHING`
 * plus "no returned row means replayed" buys.
 *
 * A unit test cannot show any of this: with a mocked repository, `replayed` is
 * whatever the mock was told to say, and the ON CONFLICT clause is never parsed
 * by a database at all.
 *
 * Runs on the APP pool, under RLS, exactly as a request does — so it also proves
 * the RLS-confined role may write the row.
 *
 * Self-seeding against any build-v3 database; everything it writes is removed.
 *
 *   DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
 *     npx vitest run --config vitest.integration.config.ts cash-seals
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

const MERCHANT = '9f000000-0000-4000-8000-0000000000b1';
const OTHER_MERCHANT = '9f000000-0000-4000-8000-0000000000b2';
const CUSTOMER = '9f000000-0000-4000-8000-0000000000b3';
const CARD = '9f000000-0000-4000-8000-0000000000b4';
const OTHER_CARD = '9f000000-0000-4000-8000-0000000000b5';
const OTHER_CUSTOMER = '9f000000-0000-4000-8000-0000000000b6';
const USER = '9f000000-0000-4000-8000-0000000000b7';
const ROLE = '9f000000-0000-4000-8000-0000000000b8';
const STAFF = '9f000000-0000-4000-8000-0000000000b9';
const OTHER_STAFF = '9f000000-0000-4000-8000-0000000000ba';
const STAMPS_PER_REWARD = 10;

describe('cash bulk seals · the credit lands once', () => {
  let pg: PgService;
  let repo: CashScanRepository;

  /** Run as the request would: RLS context set, app pool, this merchant. */
  const asMerchant = <T>(fn: () => Promise<T>, merchantId = MERCHANT) =>
    runWithRequestContext({ merchantId, userId: USER, requestId: 'seals-harness' }, fn);

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    repo = new CashScanRepository(pg);

    await pg.query(`DELETE FROM merchant.merchant WHERE id = ANY($1::uuid[])`, [
      [MERCHANT, OTHER_MERCHANT],
    ]);
    await pg.query(`DELETE FROM umi."user" WHERE id = $1::uuid`, [USER]);
    await pg.query(`DELETE FROM umi.role WHERE id = $1::uuid`, [ROLE]);

    await pg.query(
      `INSERT INTO merchant.merchant (id, name, handle) VALUES
         ($1::uuid, 'Seals Test', 'sealstest'),
         ($2::uuid, 'Other Cafe', 'sealsother')`,
      [MERCHANT, OTHER_MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.customer (id, merchant_id, name) VALUES
         ($1::uuid, $2::uuid, 'Ana'),
         ($3::uuid, $4::uuid, 'Beto')`,
      [CUSTOMER, MERCHANT, OTHER_CUSTOMER, OTHER_MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.loyalty_card (id, merchant_id, customer_id, card_number) VALUES
         ($1::uuid, $2::uuid, $3::uuid, 'SEAL-1'),
         ($4::uuid, $5::uuid, $6::uuid, 'SEAL-2')`,
      [CARD, MERCHANT, CUSTOMER, OTHER_CARD, OTHER_MERCHANT, OTHER_CUSTOMER],
    );
    await pg.query(
      `INSERT INTO merchant.loyalty_reward (merchant_id, name, type, stamps_required, active)
       VALUES ($1::uuid, 'Café gratis', 'stamps_free_item', $2, true)`,
      [MERCHANT, STAMPS_PER_REWARD],
    );
    // Attribution: the credit names a staff member, so the harness needs a real one.
    await pg.query(`INSERT INTO umi.role (id, key, name) VALUES ($1::uuid, 'staff', 'Staff')`, [
      ROLE,
    ]);
    await pg.query(`INSERT INTO umi."user" (id, full_name) VALUES ($1::uuid, 'Barista')`, [USER]);
    await pg.query(
      `INSERT INTO merchant.staff (id, merchant_id, user_id, role_id, name) VALUES
         ($1::uuid, $2::uuid, $5::uuid, $6::uuid, 'Barista'),
         ($3::uuid, $4::uuid, $5::uuid, $6::uuid, 'Barista')`,
      [STAFF, MERCHANT, OTHER_STAFF, OTHER_MERCHANT, USER, ROLE],
    );
  });

  afterAll(async () => {
    await pg?.query(`DELETE FROM merchant.merchant WHERE id = ANY($1::uuid[])`, [
      [MERCHANT, OTHER_MERCHANT],
    ]);
    await pg?.query(`DELETE FROM umi."user" WHERE id = $1::uuid`, [USER]);
    await pg?.query(`DELETE FROM umi.role WHERE id = $1::uuid`, [ROLE]);
    await pg?.onModuleDestroy?.();
  });

  const clearVisits = () =>
    pg.query(`DELETE FROM merchant.loyalty_visit WHERE merchant_id = $1::uuid`, [MERCHANT]);

  const visitRows = async () => {
    const { rows } = await pg.query<{
      stamps: number;
      source: string;
      note: string | null;
      idempotency_key: string | null;
      staff_id: string | null;
    }>(
      `SELECT stamps, source, note, idempotency_key, staff_id::text
         FROM merchant.loyalty_visit WHERE merchant_id = $1::uuid ORDER BY created_at`,
      [MERCHANT],
    );
    return rows;
  };

  const credit = (seals: number, idempotencyKey: string | null, note: string | null = null) =>
    asMerchant(() =>
      repo.creditSeals({
        merchantId: MERCHANT,
        cardId: CARD,
        staffMemberId: STAFF,
        seals,
        note,
        idempotencyKey,
      }),
    );

  it('writes ONE interaction carrying the whole magnitude', async () => {
    await clearVisits();

    const r = await credit(8, 'catchup-a', 'Cartilla anterior');

    expect(r.replayed).toBe(false);
    expect(r.card.total_visits).toBe(8);
    expect(r.card.visits_this_cycle).toBe(8);

    const rows = await visitRows();
    expect(rows).toHaveLength(1); // not 8 rows at the same microsecond
    expect(rows[0].stamps).toBe(8);
    expect(rows[0].source).toBe('manual_bulk');
    expect(rows[0].note).toBe('Cartilla anterior');
    expect(rows[0].staff_id).toBe(STAFF);
  });

  it('reports the cycle position BEFORE the credit, so the caller can price the reward', async () => {
    await clearVisits();
    await credit(3, 'catchup-before');

    const r = await credit(8, 'catchup-after');

    // 3 + 8 = 11 -> one threshold crossed, one stamp into the next card.
    expect(r.cycleBefore).toBe(3);
    expect(r.visitsRequired).toBe(STAMPS_PER_REWARD);
    expect(r.card.visits_this_cycle).toBe(1);
    expect(r.card.pending_rewards).toBe(1);
  });

  it('THE RETRY · the same key credits nothing more and does not raise', async () => {
    await clearVisits();
    await credit(8, 'catchup-retry');

    // The double-tap. It must be an answer, not a unique-violation 500.
    const again = await credit(8, 'catchup-retry');

    expect(again.replayed).toBe(true);
    expect(again.card.total_visits).toBe(8); // still 8, not 16
    expect(await visitRows()).toHaveLength(1);
  });

  it('a genuinely new credit still lands after a replay', async () => {
    await clearVisits();
    await credit(8, 'catchup-1');
    await credit(8, 'catchup-1');

    const r = await credit(5, 'catchup-2');

    expect(r.replayed).toBe(false);
    expect(r.card.total_visits).toBe(13);
    expect(await visitRows()).toHaveLength(2);
  });

  it('without a key every credit lands, because nothing claims otherwise', async () => {
    await clearVisits();
    await credit(2, null);
    const r = await credit(2, null);

    // Honest behaviour, not a silent loss: a caller that sends no key has asked
    // for no replay protection. The partial index simply does not apply.
    expect(r.replayed).toBe(false);
    expect(r.card.total_visits).toBe(4);
  });

  it('refuses a card that belongs to another café', async () => {
    await expect(
      asMerchant(() =>
        repo.creditSeals({
          merchantId: MERCHANT,
          cardId: OTHER_CARD,
          staffMemberId: STAFF,
          seals: 8,
          note: null,
          idempotencyKey: 'catchup-cross',
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the key is scoped per café · two cafés may reuse one key', async () => {
    await clearVisits();
    await credit(4, 'shared-key');

    // The other café credits its own card with the same key. Nothing collides:
    // the unique index is (merchant_id, idempotency_key).
    const other = await runWithRequestContext(
      { merchantId: OTHER_MERCHANT, userId: USER, requestId: 'seals-harness' },
      () =>
        repo.creditSeals({
          merchantId: OTHER_MERCHANT,
          cardId: OTHER_CARD,
          staffMemberId: OTHER_STAFF,
          seals: 4,
          note: null,
          idempotencyKey: 'shared-key',
        }),
    );

    expect(other.replayed).toBe(false);
    expect(other.card.total_visits).toBe(4);
  });
});
