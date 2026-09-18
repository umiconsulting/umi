import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { PointTerminalRepository } from './point-terminal.repository';

/**
 * THE TERMINAL BINDING AGAINST THE REAL SCHEMA — the half the unit suite stubs away.
 *
 * `point-terminal.spec.ts` proves what the SERVICE decides: which vendor call it makes, what it
 * refuses, and in what order. It cannot prove the two things that only PostgreSQL can say, and
 * those are exactly the two this file is for:
 *
 *   1. THE POLICY NARROWS BY LOCATION. `merchant.device_point_terminal` carries a location, so
 *      migration 72 gives it the location-narrowed predicate `67_table_state` uses. A session
 *      pinned to one branch must see that branch's rows and no others — a claim no amount of
 *      TypeScript can establish, because it is the DATABASE that decides it.
 *   2. A FOREIGN REGISTER IS REFUSED BY A CONSTRAINT. The composite foreign key
 *      `(merchant_id, location_id, device_id) → merchant.device` is the ownership proof: binding
 *      a register that belongs to another café is SQLSTATE 23503, not a service check somebody can
 *      forget to call. The last case drives that through the real repository and reads the SQL
 *      error code, which is the only evidence that means anything here.
 *
 * WHAT IT DOES NOT PROVE is the vendor half — nothing here reaches Mercado Pago — and it does not
 * replace the service's own cases. It is the schema's side of the same contract.
 *
 * Run it against a DISPOSABLE build-v3 database, the way the credential suite is run:
 *
 *   set -a && . apps/umi-api/.env && set +a
 *   DATABASE_URL_APP=$(echo "$DATABASE_URL_APP" | sed 's#/umi_transition_rehearsal_20260901#/umi_build_v3_mp#') \
 *   DATABASE_URL_WORKER=$(echo "$DATABASE_URL_WORKER" | sed 's#/umi_transition_rehearsal_20260901#/umi_build_v3_mp#') \
 *   npx vitest run --config vitest.integration.config.ts src/modules/mercado-pago/point-terminal.integration.ts
 */

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;
const JWT_SECRET = 'point-terminal-harness-secret-0000';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

/** Fixed uuids: the harness seeds idempotently and leaves its rows in place, the house style. */
const MERCHANT = '7f000000-0000-4000-8000-0000000000e1';
const OTHER_MERCHANT = '7f000000-0000-4000-8000-0000000000e2';
const LOCATION_A = '7f000000-0000-4000-8000-0000000000e3';
const LOCATION_B = '7f000000-0000-4000-8000-0000000000e4';
const OTHER_LOCATION = '7f000000-0000-4000-8000-0000000000e5';
const DEVICE_A = '7f000000-0000-4000-8000-0000000000e6';
const DEVICE_B = '7f000000-0000-4000-8000-0000000000e7';
const FOREIGN_DEVICE = '7f000000-0000-4000-8000-0000000000e8';

/** Two terminals of the account, in the vendor's own `type__serial` shape (migration 72's CHECK). */
const TERMINAL_A = 'NEWLAND_N950__ITEST000000001';
const TERMINAL_B = 'NEWLAND_N950__ITEST000000002';
const TERMINAL_C = 'NEWLAND_N950__ITEST000000003';

describe('the terminal binding · schema 72 (phase 5 step 3)', () => {
  let pg: PgService;
  let terminals: PointTerminalRepository;

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN) {
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a DISPOSABLE build-v3 database.',
      );
    }
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    terminals = new PointTerminalRepository(pg);

    for (const [id, name, handle] of [
      [MERCHANT, 'Terminal Harness', 'mp-terminal-harness'],
      [OTHER_MERCHANT, 'Terminal Harness Other', 'mp-terminal-harness-other'],
    ] as const) {
      await pg.query(
        `INSERT INTO merchant.merchant (id,name,handle) VALUES ($1::uuid,$2,$3)
         ON CONFLICT (id) DO NOTHING`,
        [id, name, handle],
      );
    }
    for (const [id, merchantId, name] of [
      [LOCATION_A, MERCHANT, 'Counter A'],
      [LOCATION_B, MERCHANT, 'Counter B'],
      [OTHER_LOCATION, OTHER_MERCHANT, 'Their counter'],
    ] as const) {
      await pg.query(
        `INSERT INTO merchant.location (id,merchant_id,name) VALUES ($1::uuid,$2::uuid,$3)
         ON CONFLICT (id) DO NOTHING`,
        [id, merchantId, name],
      );
    }
    for (const [id, merchantId, locationId, name] of [
      [DEVICE_A, MERCHANT, LOCATION_A, 'Register A'],
      [DEVICE_B, MERCHANT, LOCATION_B, 'Register B'],
      [FOREIGN_DEVICE, OTHER_MERCHANT, OTHER_LOCATION, 'Their register'],
    ] as const) {
      await pg.query(
        `INSERT INTO merchant.device (id,merchant_id,location_id,name,kind)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'pos_terminal')
         ON CONFLICT (id) DO NOTHING`,
        [id, merchantId, locationId, name],
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (pg) await pg.onModuleDestroy();
  }, 60_000);

  const bind = (deviceId: string, locationId: string, terminalId: string, merchantId = MERCHANT) =>
    terminals.bind({
      merchantId,
      locationId,
      deviceId,
      terminalId,
      storeId: null,
      posId: null,
      operatingMode: 'PDV',
    });

  it('binds a register to a terminal, and the ROW is the witness', async () => {
    const binding = await bind(DEVICE_A, LOCATION_A, TERMINAL_A);
    expect(binding).toMatchObject({
      deviceId: DEVICE_A,
      locationId: LOCATION_A,
      terminalId: TERMINAL_A,
      operatingMode: 'PDV',
    });

    // Read back through a scope that cannot see it if the policy is wrong.
    const found = await terminals.find(MERCHANT, TERMINAL_A);
    expect(found?.deviceId).toBe(DEVICE_A);
  }, 60_000);

  it('NARROWS BY LOCATION: a session pinned to one branch cannot see the other branch', async () => {
    await bind(DEVICE_B, LOCATION_B, TERMINAL_B);

    const atCounterA = await terminals.list(MERCHANT, LOCATION_A);
    const atCounterB = await terminals.list(MERCHANT, LOCATION_B);
    const unpinned = await terminals.list(MERCHANT, null);

    // The predicate is the database's, not a filter this file could have forgotten: a row bound at
    // counter B is INVISIBLE to a session scoped to counter A, and vice versa.
    expect(atCounterA.map((row) => row.terminalId)).toContain(TERMINAL_A);
    expect(atCounterA.map((row) => row.terminalId)).not.toContain(TERMINAL_B);
    expect(atCounterB.map((row) => row.terminalId)).toContain(TERMINAL_B);
    expect(atCounterB.map((row) => row.terminalId)).not.toContain(TERMINAL_A);
    // …and an unpinned session sees both, which is what makes the narrowing a scope rather than a
    // hole: the merchant-level read is the one the console's terminal list makes.
    expect(unpinned.map((row) => row.terminalId).sort()).toEqual([TERMINAL_A, TERMINAL_B].sort());
  }, 60_000);

  it("REFUSES another café's register, with the foreign key as the proof", async () => {
    // The register EXISTS and belongs to somebody else, and the bind is made under THIS café's
    // scope so that the row-level policy is satisfied and the only thing left that can refuse it
    // is the composite foreign key `(merchant_id, location_id, device_id) → merchant.device`.
    const error = await bind(FOREIGN_DEVICE, LOCATION_A, TERMINAL_C).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeDefined();
    // 23503 is foreign_key_violation. Asserting the CODE rather than the message is the difference
    // between proving the constraint fired and proving some string appeared.
    expect((error as { code?: string }).code).toBe('23503');

    // …and nothing was written: the terminal the attempt named is not bound to anything, and the
    // other café's register is still theirs.
    expect(await terminals.find(MERCHANT, TERMINAL_C)).toBeNull();
    expect(await terminals.list(OTHER_MERCHANT, null)).toEqual([]);
  }, 60_000);

  it('moves a register rather than adding one — `unique (device_id)` is one terminal per register', async () => {
    // Rebinding THIS register is a MOVE: the constraint says a register holds one terminal, so the
    // previous binding has to be released in the same transaction — which is the `DELETE` that
    // migration 72 originally granted no privilege for, and the reason this case exists.
    await bind(DEVICE_A, LOCATION_A, TERMINAL_C);

    const rows = await terminals.list(MERCHANT, LOCATION_A);
    const atRegisterA = rows.filter((row) => row.deviceId === DEVICE_A);
    expect(atRegisterA).toHaveLength(1);
    expect(atRegisterA[0].terminalId).toBe(TERMINAL_C);

    // Put the harness back the way the other cases found it, so a re-run is idempotent.
    await bind(DEVICE_A, LOCATION_A, TERMINAL_A);
  }, 60_000);

  it('REFUSES a move that would cross a branch, because the policy is the branch', async () => {
    // Register A sits at counter A and counter B's terminal belongs to counter B. `bind` scopes
    // the whole transaction to the DESTINATION branch, so the row at B is not visible to the
    // update that would have to move it — and the database says so rather than letting a session
    // pinned to one counter rearrange another's. That is the policy working, not a gap: a
    // merchant-wide move is a merchant-wide session's job.
    const error = await bind(DEVICE_A, LOCATION_A, TERMINAL_B).catch((caught: unknown) => caught);

    expect(error).toBeDefined();
    expect(String((error as Error).message)).toContain('row-level security');
    // …and counter B still holds its own terminal.
    expect((await terminals.find(MERCHANT, TERMINAL_B))?.locationId).toBe(LOCATION_B);
  }, 60_000);
});
