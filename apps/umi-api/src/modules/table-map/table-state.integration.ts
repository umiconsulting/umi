import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { FloorPlanDocument } from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import type { MerchantAccess } from '../auth/auth.types';
import { FloorPlanRepository } from '../floor-plan/floor-plan.repository';
import { FloorPlanService } from '../floor-plan/floor-plan.service';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { TableMapRepository } from './table-map.repository';
import { TableMapService } from './table-map.service';

/**
 * WORKSTREAM D, STEPS 3 TO 5 — the live state of a table, against the REAL schema.
 *
 * What this spec is for, stated as the plan states it: "Add table state on the map
 * itself: open, seated, ordered, served, awaiting payment, and dirty", "Add merge
 * and split of tables as one gesture", "Add a turn timer on every seated table" —
 * and the rule the floor-plan foundation document leaves binding on this increment:
 * "That increment must add occupied-table publication checks before it enables
 * visits."
 *
 * So nothing below asserts what a migration file says it does. Everything runs
 * against PostgreSQL as the REAL `api` role with RLS forced, and the two claims
 * that matter are asserted where they can only be true if the DATABASE says so:
 *
 *   · the turn timer cannot restart while a party stays — refused by
 *     `table_state_turn_timer_immutable`, asserted by SQLSTATE 23514 through a raw
 *     UPDATE that bypasses every line of TypeScript;
 *   · the party invariants (a party is present exactly when `seated_at` is set,
 *     `party_size` with it, `group_id` only with a party) — same mechanism;
 *   · publishing a layout that removes or moves an occupied table is refused, and
 *     NOTHING is published.
 *
 * The acceptance line's measurable half is the last case: "a server can move a
 * party of eight from one table to another in fewer than five seconds". It is
 * measured — requests counted, milliseconds wall-clock — and the case says out loud
 * that this is the SERVER path and not the operator flow, because the UI that would
 * let a person drag a party of eight does not exist yet.
 *
 * Self-seeding and self-cleaning; everything it writes is removed.
 *
 *   DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
 *     npx vitest run --config vitest.integration.config.ts table-state
 */

const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:4003/umi_transition_rehearsal_20260901';
const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:4003/umi_transition_rehearsal_20260901';

const JWT_SECRET = 'table-state-harness-secret-000000000000000';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const MERCHANT = '7b000000-0000-4000-8000-0000000000a1';
const LOCATION = '7b000000-0000-4000-8000-0000000000a2';
/** A location of the same merchant with NO floor plan at all. */
const BARE_LOCATION = '7b000000-0000-4000-8000-0000000000a3';
/** A second merchant, to prove the forced RLS isolates tenants. */
const NEIGHBOUR = '7b000000-0000-4000-8000-0000000000a4';
const NEIGHBOUR_LOCATION = '7b000000-0000-4000-8000-0000000000a5';

const USER = '7b000000-0000-4000-8000-0000000000c1';
const DEVICE = '7b000000-0000-4000-8000-0000000000c2';
const SESSION = '7b000000-0000-4000-8000-0000000000c3';
/** A durable session of its own for the bare-location operator: one ACTIVE
 * operator session is allowed per durable session, and that is deliberate. */
const SESSION_BARE = '7b000000-0000-4000-8000-0000000000c7';
/** And a device there, because a device is bound to ONE location and the forced
 * location narrowing is what makes that binding real. */
const DEVICE_BARE = '7b000000-0000-4000-8000-0000000000c8';
const OPERATOR_SESSION = '7b000000-0000-4000-8000-0000000000c4';
/** The same operator, at the location that has no floor plan. */
const OPERATOR_SESSION_BARE = '7b000000-0000-4000-8000-0000000000c6';
const STAFF = '7b000000-0000-4000-8000-0000000000c5';

/** Five tables: a two-top, two four-tops and two eights (the two eights are what the
 * acceptance line's "party of eight, moved to another table" needs). */
const T1 = '7b000000-0000-4000-8000-0000000000b1';
const T2 = '7b000000-0000-4000-8000-0000000000b2';
const T3 = '7b000000-0000-4000-8000-0000000000b3';
const T4 = '7b000000-0000-4000-8000-0000000000b4';
const T5 = '7b000000-0000-4000-8000-0000000000b5';
const UNKNOWN_TABLE = '7b000000-0000-4000-8000-0000000000b9';

const CHECK_VIOLATION = '23514';
const RLS_VIOLATION = '42501';

type TableElement = {
  id: string;
  kind: 'table';
  shape: 'rectangle' | 'round' | 'square';
  label: string;
  capacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

/** The layout the room is operated against. */
function plan(overrides: Partial<Record<string, Partial<TableElement>>> = {}): FloorPlanDocument {
  const table = (
    id: string,
    label: string,
    capacity: number,
    x: number,
    y: number,
  ): TableElement => ({
    id,
    kind: 'table',
    shape: 'square',
    label,
    capacity,
    x,
    y,
    width: 80,
    height: 80,
    rotation: 0,
    ...(overrides[id] ?? {}),
  });
  const document: FloorPlanDocument = {
    schemaVersion: 1,
    areas: [
      {
        id: '7b000000-0000-4000-8000-0000000000d1',
        name: 'Salón',
        width: 1200,
        height: 800,
        elements: [
          table(T1, 'T1', 2, 120, 120),
          table(T2, 'T2', 4, 320, 120),
          table(T3, 'T3', 4, 520, 120),
          table(T4, 'T4', 8, 720, 120),
          table(T5, 'T5', 8, 920, 120),
        ],
      },
    ],
  };
  return document;
}

describe('table state · the room, the turn timer, merge/split and the publish guard', () => {
  let pg: PgService;
  let tables: TableMapService;
  let plans: FloorPlanService;

  const user = { id: USER, deviceId: DEVICE, sessionId: SESSION, email: null };
  /** The same operator, in the durable session opened at the bare location. */
  const userBare = { id: USER, deviceId: DEVICE_BARE, sessionId: SESSION_BARE, email: null };
  const access: MerchantAccess = {
    merchantId: MERCHANT,
    locationId: LOCATION,
    name: 'Table state test',
    handle: null,
    timezone: null,
    membershipId: null,
    role: 'owner',
    roles: ['owner'],
    permissions: ['merchant.manage'],
  };
  const scoped = <T>(fn: () => Promise<T>, scope = LOCATION, merchant = MERCHANT) =>
    runWithRequestContext(
      { merchantId: merchant, locationId: scope, userId: null, requestId: randomUUID() },
      fn,
    );

  /** Every operation is a command, so every call mints its own idempotency key. */
  const command = () => ({
    locationId: LOCATION,
    operatorSessionId: OPERATOR_SESSION,
    idempotencyKey: randomUUID(),
  });
  const seat = (tableId: string, partySize: number, key = randomUUID()) =>
    scoped(() =>
      tables.seat(user, MERCHANT, { ...command(), idempotencyKey: key, tableId, partySize }),
    );
  const move = (fromTableId: string, toTableId: string) =>
    scoped(() => tables.move(user, MERCHANT, { ...command(), fromTableId, toTableId }));
  const merge = (tableIds: string[], partySize: number) =>
    scoped(() => tables.merge(user, MERCHANT, { ...command(), tableIds, partySize }));
  const split = (tableId: string) =>
    scoped(() => tables.split(user, MERCHANT, { ...command(), tableId }));
  const clear = (tableId: string) =>
    scoped(() => tables.clear(user, MERCHANT, { ...command(), tableId }));
  const openTable = (tableId: string) =>
    scoped(() => tables.openTable(user, MERCHANT, { ...command(), tableId }));
  const markOrdered = (tableId: string) =>
    scoped(() => tables.markOrdered(user, MERCHANT, { ...command(), tableId }));
  const markServed = (tableId: string) =>
    scoped(() => tables.markServed(user, MERCHANT, { ...command(), tableId }));
  const markAwaitingPayment = (tableId: string) =>
    scoped(() => tables.markAwaitingPayment(user, MERCHANT, { ...command(), tableId }));
  /**
   * The three service transitions, as `[the state they set, the call that sets it]`.
   * Every claim the plan makes about them is a claim about all three, so the cases
   * below are driven from this list rather than copied three times — a fourth
   * transition added later fails these tests until it is added here.
   */
  const TRANSITIONS = [
    ['ordered', markOrdered],
    ['served', markServed],
    ['awaiting_payment', markAwaitingPayment],
  ] as const;
  const read = () => scoped(() => tables.read(access, LOCATION));

  /**
   * Run a call that MUST be refused and hand back the refusal as three plain
   * fields. A Nest `HttpException` keeps its status on the instance and its typed
   * `code` inside `getResponse()`, so `rejects.toMatchObject({ code })` silently
   * matches nothing — which is how a suite can look like it is asserting a typed
   * refusal while only asserting that something threw.
   */
  async function refusal(work: () => Promise<unknown>): Promise<{
    status: number;
    code: string;
    message: string;
    fieldErrors: Record<string, string[]> | undefined;
  }> {
    try {
      await work();
    } catch (thrown) {
      const error = thrown as { status?: number; getResponse?: () => unknown };
      const body = (typeof error.getResponse === 'function' ? error.getResponse() : {}) as {
        code?: unknown;
        message?: unknown;
        fieldErrors?: Record<string, string[]>;
      };
      return {
        status: error.status ?? 0,
        code: typeof body.code === 'string' ? body.code : '(no code)',
        message: typeof body.message === 'string' ? body.message : '',
        fieldErrors: body.fieldErrors,
      };
    }
    throw new Error('the API ACCEPTED a command it was supposed to refuse');
  }

  /** The one state row for a table, straight from the database. */
  const row = async (tableId: string) => {
    const { rows } = await pg.tquery<{
      state: string;
      seated_at: Date | null;
      party_size: number | null;
      group_id: string | null;
    }>(
      MERCHANT,
      `SELECT state,seated_at,party_size,group_id::text AS group_id FROM merchant.table_state
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id=$3::uuid`,
      [MERCHANT, LOCATION, tableId],
    );
    return rows[0] ?? null;
  };

  /** Put the location back to "nothing has happened on the floor". */
  const emptyFloor = () =>
    pg.query(`DELETE FROM merchant.table_state WHERE merchant_id = ANY($1::uuid[])`, [
      [MERCHANT, NEIGHBOUR],
    ]);

  /** Write the floor plan row directly: a published layout with the same draft. */
  const publish = async (document: FloorPlanDocument, draft = document) =>
    pg.query(
      `INSERT INTO merchant.floor_plan
         (merchant_id,location_id,version,draft,published_version,published,published_at)
       VALUES ($1::uuid,$2::uuid,1,$3::jsonb,1,$3::jsonb,now())
       ON CONFLICT (merchant_id,location_id) DO UPDATE
         SET version=1,draft=$4::jsonb,published_version=1,published=$3::jsonb,published_at=now()`,
      [MERCHANT, LOCATION, JSON.stringify(document), JSON.stringify(draft)],
    );

  /** The publish command, through the real integrity service. */
  const publishCommand = (expectedVersion = 1) =>
    scoped(() =>
      plans.change(access, {
        locationId: LOCATION,
        expectedVersion,
        idempotencyKey: randomUUID(),
      }),
    );

  /**
   * SEEDING IS IDEMPOTENT AND CLEANUP IS PARTIAL, ON PURPOSE.
   *
   * The commands this spec issues write to `merchant.business_command`,
   * `merchant.audit_event` and `merchant.aggregate_version`, whose foreign keys to
   * `merchant.merchant` are ON DELETE RESTRICT — and `merchant.audit_event` is
   * append-only, so its rows cannot be deleted at all. The merchant therefore
   * cannot be removed, which is the same thing `floor-plan.integration.ts` records
   * in its own header ("Run against a disposable build-v3 database. Audit rows are
   * immutable"). So: whatever is CURRENT state is seeded idempotently and removed
   * afterwards, and the immutable trail stays in a database that is disposable by
   * design. A re-run must therefore be safe, which is what the `on conflict`
   * clauses below buy.
   */
  beforeAll(async () => {
    if (!process.env.DATABASE_URL_APP || !process.env.DATABASE_URL_WORKER)
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a disposable build-v3 database.',
      );
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    const integrity = new IntegrityService(new IntegrityRepository(pg));
    tables = new TableMapService(new TableMapRepository(pg), integrity);
    plans = new FloorPlanService(new FloorPlanRepository(pg), integrity);

    await pg.query(
      `INSERT INTO merchant.merchant (id,name,handle) VALUES
      ($1::uuid,'Table State Harness','table-state-harness'),
      ($2::uuid,'Vecino Harness','vecino-table-state-harness')
      ON CONFLICT (id) DO NOTHING`,
      [MERCHANT, NEIGHBOUR],
    );
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name) VALUES
         ($1::uuid,$4::uuid,'Congreso'), ($2::uuid,$4::uuid,'Sin plano'), ($3::uuid,$5::uuid,'Vecino')
       ON CONFLICT (id) DO NOTHING`,
      [LOCATION, BARE_LOCATION, NEIGHBOUR_LOCATION, MERCHANT, NEIGHBOUR],
    );
    await pg.query(
      `INSERT INTO umi."user" (id,full_name) VALUES ($1::uuid,'Operador')
      ON CONFLICT (id) DO NOTHING`,
      [USER],
    );
    await pg.query(
      `INSERT INTO merchant.staff (id,merchant_id,location_id,user_id,role_id,name)
       SELECT $1::uuid,$2::uuid,$3::uuid,$4::uuid,id,'Operador' FROM umi.role WHERE NOT is_platform LIMIT 1
       ON CONFLICT (id) DO NOTHING`,
      [STAFF, MERCHANT, LOCATION, USER],
    );
    await pg.query(
      `INSERT INTO merchant.device (id,merchant_id,location_id,name,kind)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Tablet','pos_terminal') ON CONFLICT (id) DO NOTHING`,
      [DEVICE, MERCHANT, LOCATION],
    );
    await pg.query(
      `INSERT INTO merchant.device (id,merchant_id,location_id,name,kind)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Tablet sin plano','pos_terminal')
       ON CONFLICT (id) DO NOTHING`,
      [DEVICE_BARE, MERCHANT, BARE_LOCATION],
    );
    await pg.query(
      `INSERT INTO runtime.session (id,merchant_id,principal_type,principal_id,token_hash)
       VALUES ($1::uuid,$2::uuid,'user',$3::uuid,$4) ON CONFLICT (id) DO NOTHING`,
      [SESSION, MERCHANT, USER, randomUUID()],
    );
    await pg.query(
      `INSERT INTO runtime.session (id,merchant_id,principal_type,principal_id,token_hash)
       VALUES ($1::uuid,$2::uuid,'user',$3::uuid,$4) ON CONFLICT (id) DO NOTHING`,
      [SESSION_BARE, MERCHANT, USER, randomUUID()],
    );
    // On conflict, RESET to the good operator: a previous run may have left this
    // session without `sale.lifecycle`, and a spec that inherits its predecessor's
    // state can report a failure that has nothing to do with the code under test.
    await pg.query(
      `INSERT INTO runtime.operator_session
         (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,permissions,entitlements,expires_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
               ARRAY['sale.lifecycle'],'[{"featureKey":"pos","enabled":true}]',now()+interval '2 hours')
       ON CONFLICT (id) DO UPDATE
         SET durable_session_id=excluded.durable_session_id,user_id=excluded.user_id,
             staff_id=excluded.staff_id,device_id=excluded.device_id,
             merchant_id=excluded.merchant_id,location_id=excluded.location_id,
             permissions=excluded.permissions,entitlements=excluded.entitlements,
             state='active',expires_at=excluded.expires_at`,
      [OPERATOR_SESSION, SESSION, USER, STAFF, DEVICE, MERCHANT, LOCATION],
    );
    // The same operator, opened at the location that has no floor plan: the refusal
    // this proves is about the missing PLAN, so the session has to be valid there.
    await pg.query(
      `INSERT INTO runtime.operator_session
         (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,permissions,entitlements,expires_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
               ARRAY['sale.lifecycle'],'[{"featureKey":"pos","enabled":true}]',now()+interval '2 hours')
       ON CONFLICT (id) DO UPDATE
         SET durable_session_id=excluded.durable_session_id,user_id=excluded.user_id,
             staff_id=excluded.staff_id,device_id=excluded.device_id,
             merchant_id=excluded.merchant_id,location_id=excluded.location_id,
             permissions=excluded.permissions,entitlements=excluded.entitlements,
             state='active',expires_at=excluded.expires_at`,
      [OPERATOR_SESSION_BARE, SESSION_BARE, USER, STAFF, DEVICE_BARE, MERCHANT, BARE_LOCATION],
    );
  });

  beforeEach(async () => {
    await emptyFloor();
    await publish(plan());
  });

  afterAll(async () => {
    await emptyFloor();
    await pg?.query(`DELETE FROM merchant.floor_plan WHERE merchant_id = ANY($1::uuid[])`, [
      [MERCHANT, NEIGHBOUR],
    ]);
    // Put the operator back to a good state rather than deleting it: the next run's
    // seeding is idempotent, and a session left short of `sale.lifecycle` by a
    // failed run would otherwise make the NEXT run look broken.
    await pg?.query(
      `UPDATE runtime.operator_session SET permissions=ARRAY['sale.lifecycle'],state='active',
         expires_at=now()+interval '2 hours' WHERE id=$1::uuid`,
      [OPERATOR_SESSION],
    );
    // The merchant itself stays: `business_command` and `audit_event` hold it with
    // ON DELETE RESTRICT and the audit trail is append-only. See the seeding note.
    await pg?.onModuleDestroy?.();
  });

  it('seats a party, and the row says seated with a timer and a party size', async () => {
    const result = await seat(T2, 4);
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]).toMatchObject({
      tableId: T2,
      state: 'seated',
      partySize: 4,
      groupId: null,
    });
    expect(result.changed[0].seatedAt).not.toBeNull();
    // The turn timer's origin is the SERVER's clock, and the response carries it.
    expect(
      Math.abs(Date.parse(result.changed[0].seatedAt as string) - Date.parse(result.serverTime)),
    ).toBeLessThan(10_000);
    expect(await row(T2)).toMatchObject({ state: 'seated', party_size: 4, group_id: null });
  });

  it('reads the room: only the tables something has happened on, and the server clock', async () => {
    // A table that was never seated has NO row — the layout says it exists, so the
    // reader defaults a missing table to `open` rather than to "unknown".
    const empty = await read();
    expect(empty.locationId).toBe(LOCATION);
    expect(empty.states).toEqual([]);
    expect(Math.abs(Date.parse(empty.serverTime) - Date.now())).toBeLessThan(10_000);

    await seat(T2, 4);
    const occupied = await read();
    expect(occupied.states).toHaveLength(1);
    expect(occupied.states[0]).toMatchObject({ tableId: T2, state: 'seated', partySize: 4 });
  });

  it('refuses a seat on an occupied table, and does not disturb the party that is there', async () => {
    await seat(T2, 4);
    expect(await refusal(() => seat(T2, 2))).toMatchObject({
      status: 409,
      code: 'TABLE_ALREADY_OCCUPIED',
    });
    expect(await row(T2)).toMatchObject({ state: 'seated', party_size: 4 });
  });

  it('refuses a party larger than the table, and names the table', async () => {
    const refused = await refusal(() => seat(T1, 3));
    expect(refused).toMatchObject({ status: 409, code: 'TABLE_CAPACITY_EXCEEDED' });
    expect(refused.fieldErrors?.tableId).toEqual([T1]);
    expect(await row(T1)).toBeNull();
  });

  it('refuses a table that is not in the served plan', async () => {
    expect(await refusal(() => seat(UNKNOWN_TABLE, 2))).toMatchObject({
      status: 409,
      code: 'TABLE_NOT_IN_PLAN',
    });
  });

  it('refuses every operation at a location with no floor plan at all', async () => {
    const seatThere = () =>
      scoped(
        () =>
          tables.seat(userBare, MERCHANT, {
            locationId: BARE_LOCATION,
            operatorSessionId: OPERATOR_SESSION_BARE,
            idempotencyKey: randomUUID(),
            tableId: T2,
            partySize: 2,
          }),
        BARE_LOCATION,
      );
    expect(await refusal(seatThere)).toMatchObject({
      status: 409,
      code: 'FLOOR_PLAN_NOT_PUBLISHED',
    });
    // And the operator is real: the refusal is the missing plan, not the session.
    await expect(
      scoped(
        () =>
          tables.readForPos(userBare, MERCHANT, {
            locationId: BARE_LOCATION,
            operatorSessionId: OPERATOR_SESSION_BARE,
          }),
        BARE_LOCATION,
      ),
    ).resolves.toMatchObject({ states: [] });
  });

  it('re-seats a table that is dirty — dirty is free, it is not occupied', async () => {
    await seat(T2, 4);
    await clear(T2);
    expect(await row(T2)).toMatchObject({ state: 'dirty' });
    const again = await seat(T2, 2);
    expect(again.changed[0]).toMatchObject({ state: 'seated', partySize: 2 });
  });

  it('MOVES a party without restarting its turn timer, and dirties the table it left', async () => {
    const seated = await seat(T2, 4);
    const seatedAt = seated.changed[0].seatedAt as string;
    // A real wait would be minutes; the assertion is that the value is CARRIED, not
    // reconstructed, so any difference at all fails it.
    const moved = await move(T2, T3);
    const target = moved.changed.find((entry) => entry.tableId === T3);
    const source = moved.changed.find((entry) => entry.tableId === T2);
    expect(target).toMatchObject({ state: 'seated', partySize: 4, seatedAt });
    expect(source).toMatchObject({ state: 'dirty', seatedAt: null, partySize: null });
    expect(await row(T3)).toMatchObject({
      state: 'seated',
      party_size: 4,
      seated_at: new Date(seatedAt),
    });
  });

  it('refuses a move onto an occupied table', async () => {
    await seat(T2, 4);
    await seat(T3, 2);
    expect(await refusal(() => move(T2, T3))).toMatchObject({
      status: 409,
      code: 'TABLE_ALREADY_OCCUPIED',
    });
    // Both parties are exactly where they were.
    expect(await row(T2)).toMatchObject({ state: 'seated', party_size: 4 });
    expect(await row(T3)).toMatchObject({ state: 'seated', party_size: 2 });
  });

  it('refuses a move onto a table too small for the party, and refuses an empty table', async () => {
    await seat(T4, 8);
    const small = await refusal(() => move(T4, T1));
    expect(small).toMatchObject({ status: 409, code: 'TABLE_CAPACITY_EXCEEDED' });
    expect(small.fieldErrors?.toTableId).toEqual([T1]);
    expect(await refusal(() => move(T1, T2))).toMatchObject({
      status: 409,
      code: 'TABLE_NOT_OCCUPIED',
    });
  });

  it('MERGES free tables into ONE party: one group id, one seated_at, all seated', async () => {
    const merged = await merge([T2, T3], 6);
    expect(merged.changed).toHaveLength(2);
    const group = new Set(merged.changed.map((entry) => entry.groupId));
    expect(group.size).toBe(1);
    expect([...group][0]).not.toBeNull();
    const timers = new Set(merged.changed.map((entry) => entry.seatedAt));
    expect(timers.size).toBe(1);
    for (const entry of merged.changed)
      expect(entry).toMatchObject({ state: 'seated', partySize: 6 });
    // And the database agrees, which is the part a service-side group id cannot fake.
    const rows = await pg.tquery<{ group_id: string; n: string }>(
      MERCHANT,
      `SELECT group_id::text AS group_id, count(*)::text AS n FROM merchant.table_state
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid GROUP BY group_id`,
      [MERCHANT, LOCATION],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].n).toBe('2');
  });

  it('refuses a merge that names an occupied table, and names it', async () => {
    await seat(T3, 2);
    const refused = await refusal(() => merge([T2, T3], 6));
    expect(refused).toMatchObject({ status: 409, code: 'TABLE_ALREADY_OCCUPIED' });
    expect(refused.fieldErrors?.tableIds).toEqual([T3]);
    // The free table in the group was not half-seated: the refusAL is the outcome.
    expect(await row(T2)).toBeNull();
    expect(await row(T3)).toMatchObject({ state: 'seated', party_size: 2, group_id: null });
  });

  it('refuses a merge the combined capacity cannot hold', async () => {
    expect(await refusal(() => merge([T1, T2], 7))).toMatchObject({
      status: 409,
      code: 'TABLE_CAPACITY_EXCEEDED',
    });
    // 2 + 4 = 6 seats; seven people is one too many.
    await expect(merge([T1, T2], 6)).resolves.toMatchObject({ commandId: expect.any(String) });
  });

  it('SPLITS a merged group: the nominated table keeps the party, the rest go dirty', async () => {
    await merge([T2, T3], 6);
    const splitResult = await split(T3);
    const survivor = splitResult.changed.find((entry) => entry.tableId === T3);
    const released = splitResult.changed.find((entry) => entry.tableId === T2);
    expect(survivor).toMatchObject({ state: 'seated', partySize: 6, groupId: null });
    expect(released).toMatchObject({
      state: 'dirty',
      seatedAt: null,
      partySize: null,
      groupId: null,
    });
  });

  it('refuses a split of a table that is not in a group, or has nobody on it', async () => {
    await seat(T2, 2);
    expect(await refusal(() => split(T2))).toMatchObject({
      status: 409,
      code: 'TABLE_NOT_GROUPED',
    });
    expect(await refusal(() => split(T3))).toMatchObject({
      status: 409,
      code: 'TABLE_NOT_OCCUPIED',
    });
  });

  it('MOVES a merged group whole: the target takes the party, the rest are released', async () => {
    const merged = await merge([T2, T3], 6);
    const seatedAt = merged.changed[0].seatedAt as string;
    const moved = await move(T2, T4);
    expect(moved.changed.find((entry) => entry.tableId === T4)).toMatchObject({
      state: 'seated',
      partySize: 6,
      seatedAt,
      groupId: null,
    });
    for (const tableId of [T2, T3])
      expect(moved.changed.find((entry) => entry.tableId === tableId)).toMatchObject({
        state: 'dirty',
        seatedAt: null,
      });
  });

  it('CLEARS a party to dirty, and clearing one table of a group clears the party', async () => {
    await seat(T2, 2);
    const cleared = await clear(T2);
    expect(cleared.changed[0]).toMatchObject({ state: 'dirty', seatedAt: null, partySize: null });
    expect(await refusal(() => clear(T2))).toMatchObject({
      status: 409,
      code: 'TABLE_NOT_OCCUPIED',
    });

    await merge([T2, T3], 6);
    const grouped = await clear(T3);
    expect(grouped.changed.map((entry) => entry.tableId).sort()).toEqual([T2, T3].sort());
    for (const entry of grouped.changed)
      expect(entry).toMatchObject({ state: 'dirty', groupId: null });
  });

  it('OPENS a wiped table, is idempotent, and refuses to wipe one with a party on it', async () => {
    await seat(T2, 2);
    await clear(T2);
    const opened = await openTable(T2);
    expect(opened.changed[0]).toMatchObject({ state: 'open', seatedAt: null, partySize: null });
    // Tapping twice is not an error: the second call is a no-op, not a refusal.
    await expect(openTable(T2)).resolves.toMatchObject({ changed: [{ state: 'open' }] });

    await seat(T2, 2);
    expect(await refusal(() => openTable(T2))).toMatchObject({
      status: 409,
      code: 'TABLE_ALREADY_OCCUPIED',
    });
  });

  // ── the three service transitions (plan §8D step 5's remainder) ─────────────
  //
  // A till could DRAW all six states but could only ever SET four, because nothing
  // exposed `ordered`, `served` or `awaiting_payment`. Each of the three gets the
  // same three claims below, driven from one list so they cannot drift apart.

  for (const [state, transition] of TRANSITIONS) {
    it(`advances a merged party to ${state} as ONE party, timer and identity untouched`, async () => {
      const merged = await merge([T2, T3], 6);
      const groupId = merged.changed[0].groupId as string;
      const before = await row(T2);
      expect(before?.seated_at).not.toBeNull();

      const result = await transition(T2);

      // Every table of the party moved, not only the one the operator tapped.
      expect(result.changed.map((entry) => entry.tableId).sort()).toEqual([T2, T3].sort());
      for (const entry of result.changed) expect(entry.state).toBe(state);

      // The party is the SAME party: the turn timer did not restart, the size did
      // not change, and the merge identity — what makes two tables one party — is
      // byte-identical. Read back from the database, not from the response.
      for (const tableId of [T2, T3]) {
        const after = await row(tableId);
        expect(after).toMatchObject({ state, party_size: 6, group_id: groupId });
        expect(after?.seated_at).toEqual(before?.seated_at);
      }
    });

    it(`refuses ${state} with no party on the table, and for a table not in the plan`, async () => {
      // A table with nothing on it — the one refusal these routes add.
      await seat(T2, 2);
      await clear(T2);
      expect(await refusal(() => transition(T2))).toMatchObject({
        status: 409,
        code: 'TABLE_NOT_OCCUPIED',
      });
      // A table the served plan does not draw, refused before anything is written.
      expect(await refusal(() => transition(UNKNOWN_TABLE))).toMatchObject({
        status: 409,
        code: 'TABLE_NOT_IN_PLAN',
      });
      // Nothing was written by either refusal: the table is still dirty.
      expect(await row(T2)).toMatchObject({ state: 'dirty', seated_at: null });
    });
  }

  it('imposes NO sequence: a served table is ordered again, a seated one asks for the bill', async () => {
    // Real service is not linear. A second round after food is out is an ordinary
    // fact, and a drinks-only table asks for the bill without ever being served.
    await seat(T2, 4);
    await markServed(T2);
    expect((await row(T2))?.state).toBe('served');
    await expect(markOrdered(T2)).resolves.toMatchObject({ changed: [{ state: 'ordered' }] });
    expect((await row(T2))?.state).toBe('ordered');

    await seat(T3, 2);
    await expect(markAwaitingPayment(T3)).resolves.toMatchObject({
      changed: [{ state: 'awaiting_payment' }],
    });
    expect((await row(T3))?.state).toBe('awaiting_payment');
  });

  it('is idempotent: the same transition tapped twice is a no-op, not a refusal', async () => {
    await seat(T2, 4);
    const first = await markOrdered(T2);
    // A waiter who taps twice must not be told off for it.
    await expect(markOrdered(T2)).resolves.toMatchObject({ changed: first.changed });
    expect((await row(T2))?.state).toBe('ordered');
  });

  it('refuses an operator whose session does not carry sale.lifecycle', async () => {
    // The permission is read from `runtime.operator_session`, not from the request.
    await pg.query(
      `UPDATE runtime.operator_session SET permissions=ARRAY['cart.write'] WHERE id=$1::uuid`,
      [OPERATOR_SESSION],
    );
    expect(await refusal(() => seat(T2, 2))).toMatchObject({
      status: 403,
      code: 'PERMISSION_DENIED',
    });
    await pg.query(
      `UPDATE runtime.operator_session SET permissions=ARRAY['sale.lifecycle'] WHERE id=$1::uuid`,
      [OPERATOR_SESSION],
    );
  });

  it('replays a command instead of seating a second party (the idempotency key)', async () => {
    const key = randomUUID();
    const first = await seat(T2, 4, key);
    const replay = await seat(T2, 4, key);
    expect(replay.changed).toEqual(first.changed);
    expect(replay.commandId).toBe(first.commandId);
    const { rows } = await pg.tquery<{ n: string }>(
      MERCHANT,
      `SELECT count(*)::text AS n FROM merchant.table_state
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid`,
      [MERCHANT, LOCATION],
    );
    expect(rows[0].n).toBe('1');
  });

  it('hides the state from another merchant and refuses its writes', async () => {
    await seat(T2, 4);
    const { rows } = await pg.tquery<{ n: string }>(
      NEIGHBOUR,
      `SELECT count(*)::text AS n FROM merchant.table_state`,
    );
    expect(rows[0].n).toBe('0');
    const error = await pg
      .tquery(
        NEIGHBOUR,
        `INSERT INTO merchant.table_state
           (merchant_id,location_id,table_id,state,seated_at,party_size)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'seated',now(),2)`,
        [MERCHANT, LOCATION, T3],
      )
      .catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ code: RLS_VIOLATION });
  });

  // ── the invariants, asserted where they are enforced: the database ──────────

  it('the DATABASE refuses a party row without a turn-timer origin, or without a size', async () => {
    const noTimer = await pg
      .tquery(
        MERCHANT,
        `INSERT INTO merchant.table_state (merchant_id,location_id,table_id,state,party_size)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'seated',4)`,
        [MERCHANT, LOCATION, T1],
      )
      .catch((thrown: unknown) => thrown);
    expect(noTimer).toMatchObject({ code: CHECK_VIOLATION });

    const noSize = await pg
      .tquery(
        MERCHANT,
        `INSERT INTO merchant.table_state (merchant_id,location_id,table_id,state,seated_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'seated',now())`,
        [MERCHANT, LOCATION, T1],
      )
      .catch((thrown: unknown) => thrown);
    expect(noSize).toMatchObject({ code: CHECK_VIOLATION });

    // And the reverse: a size with nobody there.
    const ghost = await pg
      .tquery(
        MERCHANT,
        `INSERT INTO merchant.table_state (merchant_id,location_id,table_id,state,party_size)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'open',4)`,
        [MERCHANT, LOCATION, T1],
      )
      .catch((thrown: unknown) => thrown);
    expect(ghost).toMatchObject({ code: CHECK_VIOLATION });
  });

  it('the DATABASE refuses a merge group with nobody in it', async () => {
    const error = await pg
      .tquery(
        MERCHANT,
        `INSERT INTO merchant.table_state (merchant_id,location_id,table_id,state,group_id)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'dirty',gen_random_uuid())`,
        [MERCHANT, LOCATION, T1],
      )
      .catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ code: CHECK_VIOLATION });
  });

  it('the DATABASE refuses to restart a turn timer while a party stays', async () => {
    const seated = await seat(T2, 4);
    const restart = await pg
      .tquery(
        MERCHANT,
        `UPDATE merchant.table_state SET seated_at = $4::timestamptz
         WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id=$3::uuid`,
        [MERCHANT, LOCATION, T2, new Date(Date.now() + 60_000).toISOString()],
      )
      .catch((thrown: unknown) => thrown);
    expect(restart).toMatchObject({ code: CHECK_VIOLATION });
    expect((restart as { message?: string }).message).toContain('TABLE_STATE_TURN_TIMER_RESTART');
    // The timer the party actually has is untouched.
    expect((await row(T2))?.seated_at).toEqual(new Date(seated.changed[0].seatedAt as string));
  });

  it('the DATABASE allows a service transition — seated to served — without touching the timer', async () => {
    const seated = await seat(T2, 4);
    await pg.tquery(
      MERCHANT,
      `UPDATE merchant.table_state SET state='served'
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id=$3::uuid`,
      [MERCHANT, LOCATION, T2],
    );
    expect(await row(T2)).toMatchObject({ state: 'served' });
    expect((await row(T2))?.seated_at).toEqual(new Date(seated.changed[0].seatedAt as string));
  });

  // ── the occupied-table publish guard (the foundation document's rule) ───────

  it('REFUSES to publish a layout that removes an occupied table, and publishes nothing', async () => {
    await seat(T2, 4);
    // A draft that simply drops T2 — the exact edit the rule exists for.
    const draft = plan();
    draft.areas[0].elements = draft.areas[0].elements.filter((element) => element.id !== T2);
    await pg.query(
      `UPDATE merchant.floor_plan SET draft=$3::jsonb,version=2
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid`,
      [MERCHANT, LOCATION, JSON.stringify(draft)],
    );

    const refused = await refusal(() => publishCommand(2));
    expect(refused).toMatchObject({ status: 409, code: 'FLOOR_PLAN_OCCUPIED_TABLE_CHANGED' });
    expect(refused.fieldErrors?.tableIds).toEqual([T2]);

    // NOTHING was published: the published document still has T2, the version did
    // not move, and the draft is still the one that was refused.
    const { rows } = await pg.tquery<{
      version: number;
      published_version: number;
      has_t2: boolean;
      draft_elements: number;
    }>(
      MERCHANT,
      `SELECT version,published_version,
              published->'areas'->0->'elements' @> $3::jsonb AS has_t2,
              jsonb_array_length(draft->'areas'->0->'elements') AS draft_elements
       FROM merchant.floor_plan WHERE merchant_id=$1::uuid AND location_id=$2::uuid`,
      [MERCHANT, LOCATION, JSON.stringify([{ kind: 'table', id: T2 }])],
    );
    expect(rows[0]).toMatchObject({
      version: 2,
      published_version: 1,
      // One table fewer than the layout started with, so this does not have to be
      // re-counted every time a table is added to the harness's plan.
      draft_elements: plan().areas[0].elements.length - 1,
    });
    expect(rows[0].has_t2).toBe(true);
  });

  it('REFUSES a draft that MOVES an occupied table, or changes its capacity or label', async () => {
    await seat(T2, 4);
    const cases: Array<[string, Partial<TableElement>]> = [
      ['a move', { x: 260 }],
      ['a rotation', { rotation: 90 }],
      ['a resize', { width: 140, height: 140 }],
      ['a capacity cut', { capacity: 2 }],
      ['a rename', { label: 'Barra' }],
    ];
    for (const [what, change] of cases) {
      const draft = plan({ [T2]: change });
      await pg.query(
        `UPDATE merchant.floor_plan SET draft=$3::jsonb,version=version+1
         WHERE merchant_id=$1::uuid AND location_id=$2::uuid`,
        [MERCHANT, LOCATION, JSON.stringify(draft)],
      );
      const { rows } = await pg.tquery<{ version: number }>(
        MERCHANT,
        `SELECT version FROM merchant.floor_plan WHERE merchant_id=$1::uuid AND location_id=$2::uuid`,
        [MERCHANT, LOCATION],
      );
      const refused = await refusal(() => publishCommand(rows[0].version));
      expect({ what, ...refused }).toMatchObject({
        what,
        status: 409,
        code: 'FLOOR_PLAN_OCCUPIED_TABLE_CHANGED',
      });
    }
  });

  it('ALLOWS the one change that does not disturb a party — the drawn shape', async () => {
    await seat(T2, 4);
    const draft = plan({ [T2]: { shape: 'round', width: 80, height: 80 } });
    await pg.query(
      `UPDATE merchant.floor_plan SET draft=$3::jsonb,version=2
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid`,
      [MERCHANT, LOCATION, JSON.stringify(draft)],
    );
    const published = await publishCommand(2);
    // The publish branch stamps `published_version = version + 1` alongside
    // `version = version + 1` (62_floor_plan's CHECK keeps the two ordered), so a
    // publish from version 2 lands both at 3.
    expect(published.publishedVersion).toBe(3);
    expect(published.version).toBe(3);
    expect(published.published?.areas[0].elements.find((element) => element.id === T2)?.shape).toBe(
      'round',
    );
  });

  it('publishes the same layout once the party has LEFT', async () => {
    await seat(T2, 4);
    const draft = plan();
    draft.areas[0].elements = draft.areas[0].elements.filter((element) => element.id !== T2);
    await pg.query(
      `UPDATE merchant.floor_plan SET draft=$3::jsonb,version=2
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid`,
      [MERCHANT, LOCATION, JSON.stringify(draft)],
    );
    expect(await refusal(() => publishCommand(2))).toMatchObject({
      status: 409,
      code: 'FLOOR_PLAN_OCCUPIED_TABLE_CHANGED',
    });

    await clear(T2);
    const published = await publishCommand(2);
    expect(published.publishedVersion).toBe(3);
    expect(published.published?.areas[0].elements.some((element) => element.id === T2)).toBe(false);
  });

  it('refuses to publish over a seated floor when the location has NO published layout', async () => {
    // A baseline that was never frozen cannot be read as "unchanged": the refusal is
    // the only safe answer while a party is on the floor.
    await pg.query(
      `UPDATE merchant.floor_plan SET published=NULL,published_at=NULL,published_version=0
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid`,
      [MERCHANT, LOCATION],
    );
    await seat(T2, 4);
    expect(await refusal(() => publishCommand(1))).toMatchObject({
      status: 409,
      code: 'FLOOR_PLAN_OCCUPIED_TABLE_CHANGED',
    });
  });

  it('the ACCEPTANCE LINE, measured: a party of eight moves table-to-table (server path)', async () => {
    // "A server can move a party of eight from one table to another in fewer than
    // five seconds." This measures the SERVER path — the requests a client makes —
    // and says plainly what it is NOT: the operator flow. A person dragging a party
    // of eight from one table to another does not exist as a gesture in the POS yet,
    // so the half of the acceptance line that involves a person is unmeasured, and
    // no number below should be read as covering it.
    //
    // Two requests: seat the party on the eight-top, then move it to the other
    // eight-top. Both are real commands through the integrity service — the seat
    // writes the command row, the audit event and the state row; the move carries the
    // turn timer across. What is timed is the wall clock around both awaits.
    const started = performance.now();
    const seated = await seat(T4, 8);
    const moved = await move(T4, T5);
    const elapsed = performance.now() - started;

    const target = moved.changed.find((entry) => entry.tableId === T5);
    expect(seated.changed[0]).toMatchObject({ tableId: T4, state: 'seated', partySize: 8 });
    expect(target).toMatchObject({
      tableId: T5,
      state: 'seated',
      partySize: 8,
      seatedAt: seated.changed[0].seatedAt,
    });
    expect(moved.changed.find((entry) => entry.tableId === T4)).toMatchObject({ state: 'dirty' });
    expect(elapsed).toBeLessThan(5000);
    // Printed so the run's own output carries the measurement rather than a claim.
    console.log(
      `[acceptance] party of 8: 2 requests (seat + move), ${elapsed.toFixed(1)} ms wall clock`,
    );
  });
});
