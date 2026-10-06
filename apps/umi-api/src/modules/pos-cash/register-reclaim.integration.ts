import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { PosCashRepository } from './pos-cash.repository';
import { PosCashService } from './pos-cash.service';

/**
 * A REGISTER HOLDING A DEAD SHIFT IS NOT A SERVER FAULT, AND THE TILL CAN GET OUT.
 *
 * THE DEFECT THIS SUITE EXISTS FOR was found by driving the real NATIVE POS
 * through a whole sale, and nothing smaller would have found it. Both registers
 * at Chapultepec were still held by shifts opened on 2026-09-03 and 2026-09-05 by
 * terminals that no longer existed. Opening a shift answered
 * **500 REGISTER_NOT_AVAILABLE**; taking any payment answered
 * **500 CASH_SHIFT_REQUIRED**; and the Caja screen still showed "Turno
 * abierto", so the operator saw a usable till and an unexplained 500. The only
 * way out was four hand-written SQL statements.
 *
 * Two separate things were wrong, and this spec asserts both against PostgreSQL
 * as the real `api` role with RLS forced:
 *
 *   1. THE REFUSAL WAS A FAULT. The repository raised a bare `Error`, nothing
 *      mapped it, and the catch-all filter turned it into a 500 whose body was
 *      `INTERNAL_ERROR` — no status, no shift, no terminal, no recovery action.
 *      It is now a 409 that keeps the code `REGISTER_NOT_AVAILABLE` and carries
 *      the facts in `details`: which shift holds the register, since when, which
 *      terminal, and whether that terminal is still usable.
 *
 *   2. THERE WAS NO WAY OUT. `recover` is the other door and it is the wrong one:
 *      a manager counts the drawer under their own name. Nobody counted these
 *      drawers. `POST /cash/registers/:registerId/reclaim` frees the register
 *      only when the API ITSELF proves the holding terminal is gone, moves the
 *      shift to the terminal status `blocked`, and touches no money.
 *
 * The claims that can only be true if the DATABASE says so are asserted as SQL:
 * the ledger is unchanged down to its sequence, the blocked shift is gone from
 * the active-shift predicate, and `cash_custody_shape` (build-v3-68) REFUSES a
 * custody row that would record a drawer count for a reclaim. That last one is
 * the rule the whole operation exists to respect: nothing may mark an uncounted
 * drawer as counted — not this code, not a future writer, not psql.
 *
 * Self-seeding and self-cleaning; everything it writes is removed (see the
 * seeding note for what cannot be).
 *
 *   DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
 *     npx vitest run --config vitest.integration.config.ts register-reclaim
 */

const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:4003/umi_transition_rehearsal_20260901';
const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:4003/umi_transition_rehearsal_20260901';

const JWT_SECRET = 'register-reclaim-harness-secret-000000000000';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const MERCHANT = '6c000000-0000-4000-8000-0000000000a1';
const LOCATION = '6c000000-0000-4000-8000-0000000000a2';
/** A second merchant, to prove the reclaim cannot reach across tenants. */
const NEIGHBOUR = '6c000000-0000-4000-8000-0000000000a3';
const NEIGHBOUR_LOCATION = '6c000000-0000-4000-8000-0000000000a4';

const OPERATOR = '6c000000-0000-4000-8000-0000000000b1';
const OPERATOR_STAFF = '6c000000-0000-4000-8000-0000000000b2';
const OPERATOR_SESSION = '6c000000-0000-4000-8000-0000000000b3';
const DURABLE_SESSION = '6c000000-0000-4000-8000-0000000000b4';
/** The terminal the operator is standing at. */
const CALLER_DEVICE = '6c000000-0000-4000-8000-0000000000b5';

/** The operator who opened the shift and is not coming back. */
const GONE_OPERATOR = '6c000000-0000-4000-8000-0000000000c1';
const GONE_STAFF = '6c000000-0000-4000-8000-0000000000c2';
const GONE_SESSION = '6c000000-0000-4000-8000-0000000000c3';
/** The terminal that operator used, revoked since. This is the whole defect. */
const DEAD_DEVICE = '6c000000-0000-4000-8000-0000000000c4';

/** A second operator whose shift sits on a terminal that IS still alive. */
const BUSY_OPERATOR = '6c000000-0000-4000-8000-0000000000d1';
const BUSY_STAFF = '6c000000-0000-4000-8000-0000000000d2';
const BUSY_SESSION = '6c000000-0000-4000-8000-0000000000d3';
const LIVE_DEVICE = '6c000000-0000-4000-8000-0000000000d4';

/** The register the dead terminal is holding. */
const REGISTER_ORPHANED = '6c000000-0000-4000-8000-0000000000e1';
/** The register a live terminal is holding. */
const REGISTER_HELD_LIVE = '6c000000-0000-4000-8000-0000000000e2';
/** A register that is simply free, for the "nothing to reclaim" case. */
const REGISTER_FREE = '6c000000-0000-4000-8000-0000000000e3';
/** The second merchant's register, which this operator must never reach. */
const REGISTER_NEIGHBOUR = '6c000000-0000-4000-8000-0000000000e4';

/** The orphaned shift itself — opened 2026-09-03, exactly like the real one. */
const ORPHAN_SHIFT = '6c000000-0000-4000-8000-0000000000f1';
const LIVE_SHIFT = '6c000000-0000-4000-8000-0000000000f2';
const OPENING_FLOAT = 50_000;

type Refusal = {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
};

describe('a register held by a terminal that is gone can be reclaimed', () => {
  let pg: PgService;
  let cash: PosCashService;

  const user = {
    id: OPERATOR,
    sessionId: DURABLE_SESSION,
    deviceId: CALLER_DEVICE,
    email: null,
  };

  const scoped = <T>(fn: () => Promise<T>) =>
    runWithRequestContext(
      {
        merchantId: MERCHANT,
        locationId: LOCATION,
        // `deviceId` is not decoration: it is what `withMerchant` puts into
        // `app.current_device`, and `device_scoping` on `merchant.cash_shift`
        // is a RESTRICTIVE `WITH CHECK` on it. A request context without a
        // device is a session that cannot write a shift at all.
        deviceId: CALLER_DEVICE,
        userId: OPERATOR,
        requestId: randomUUID(),
      },
      fn,
    );

  /**
   * Run a call that MUST be refused and hand back the refusal as plain fields.
   * A Nest `HttpException` keeps its status on the instance and its typed `code`
   * inside `getResponse()`, so `rejects.toMatchObject({ code })` silently matches
   * nothing — the suite would look like it was asserting a typed refusal while
   * only asserting that something threw.
   */
  async function refusal(work: () => Promise<unknown>): Promise<Refusal> {
    try {
      await work();
    } catch (thrown) {
      const error = thrown as { status?: number; getResponse?: () => unknown };
      const body = (typeof error.getResponse === 'function' ? error.getResponse() : {}) as {
        code?: unknown;
        message?: unknown;
        details?: Record<string, unknown>;
      };
      return {
        status: error.status ?? 0,
        code: typeof body.code === 'string' ? body.code : '(no code)',
        message: typeof body.message === 'string' ? body.message : '',
        details: body.details ?? {},
      };
    }
    throw new Error('the API ACCEPTED a command it was supposed to refuse');
  }

  const register = async (id: string) => {
    const { rows } = await pg.tquery<{
      status: string;
      version: number;
      current_shift_id: string | null;
    }>(
      MERCHANT,
      `SELECT status,version,current_shift_id::text AS current_shift_id
         FROM merchant.physical_register WHERE id=$1::uuid`,
      [id],
    );
    return rows[0] ?? null;
  };

  const shift = async (id: string) => {
    const { rows } = await pg.tquery<{ status: string; closed_at: Date | null; version: number }>(
      MERCHANT,
      `SELECT status,closed_at,version FROM merchant.cash_shift WHERE id=$1::uuid`,
      [id],
    );
    return rows[0] ?? null;
  };

  /** The ledger, as a fingerprint that ignores nothing: count, sum and sequence. */
  const ledger = async (shiftId: string) => {
    const { rows } = await pg.tquery<{ entries: string; total: string; last: string }>(
      MERCHANT,
      `SELECT count(*)::text AS entries,
              coalesce(sum(amount_minor_units),0)::text AS total,
              coalesce(max(sequence),0)::text AS last
         FROM merchant.cash_ledger_entry WHERE shift_id=$1::uuid`,
      [shiftId],
    );
    return rows[0];
  };

  /** What the live active-shift queries see: the predicate, not a paraphrase. */
  const activeShiftsAt = async () => {
    const { rows } = await pg.tquery<{ id: string }>(
      MERCHANT,
      `SELECT id::text FROM merchant.cash_shift
        WHERE merchant_id=$1::uuid AND location_id=$2::uuid
          AND status NOT IN ('closed','blocked','recovered')`,
      [MERCHANT, LOCATION],
    );
    return rows.map((row) => row.id);
  };

  const reclaim = (registerId: string, version: number, reasonCode = 'dead_terminal') =>
    scoped(() =>
      cash.reclaimRegister(user, MERCHANT, registerId, {
        locationId: LOCATION,
        operatorSessionId: OPERATOR_SESSION,
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
        registerId,
        expectedRegisterVersion: version,
        reasonCode,
      }),
    );

  const openShift = (registerId: string, version: number) =>
    scoped(() =>
      cash.open(user, MERCHANT, {
        locationId: LOCATION,
        operatorSessionId: OPERATOR_SESSION,
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
        registerId,
        openingFloat: { minorUnits: OPENING_FLOAT, currency: 'MXN' },
        denominations: [],
        businessDate: '2026-09-16',
        note: null,
        expectedRegisterVersion: version,
      }),
    );

  /**
   * SEEDING IS IDEMPOTENT AND CLEANUP IS PARTIAL, ON PURPOSE.
   *
   * The commands this spec issues write `merchant.business_command` and
   * `merchant.audit_event` rows, whose foreign keys to `merchant.merchant` are
   * ON DELETE RESTRICT — and the audit trail is append-only, so it cannot be
   * deleted at all. The merchant therefore stays. Everything that IS current
   * state (registers, shifts, ledger, custody) is removed afterwards, so a re-run
   * starts from the same place, which is what the `on conflict` clauses buy.
   */
  beforeAll(async () => {
    if (!process.env.DATABASE_URL_APP || !process.env.DATABASE_URL_WORKER)
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a disposable build-v3 database.',
      );
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    const integrity = new IntegrityService(new IntegrityRepository(pg));
    cash = new PosCashService(new PosCashRepository(pg), integrity);

    await pg.query(
      `INSERT INTO merchant.merchant (id,name,handle,currency,timezone) VALUES
         ($1::uuid,'Register Reclaim Harness','register-reclaim-harness','MXN','America/Mexico_City'),
         ($2::uuid,'Vecino Reclaim Harness','vecino-reclaim-harness','MXN','America/Mexico_City')
       ON CONFLICT (id) DO NOTHING`,
      [MERCHANT, NEIGHBOUR],
    );
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name) VALUES
         ($1::uuid,$3::uuid,'Congreso'), ($2::uuid,$4::uuid,'Vecino')
       ON CONFLICT (id) DO NOTHING`,
      [LOCATION, NEIGHBOUR_LOCATION, MERCHANT, NEIGHBOUR],
    );
    await pg.query(
      `INSERT INTO umi."user" (id,full_name) VALUES
         ($1::uuid,'Operador'), ($2::uuid,'Se Fue'), ($3::uuid,'Ocupado')
       ON CONFLICT (id) DO NOTHING`,
      [OPERATOR, GONE_OPERATOR, BUSY_OPERATOR],
    );
    // One employment row per operator: `runtime.operator_session.staff_id` is NOT
    // NULL, so a session cannot exist without one.
    await pg.query(
      `INSERT INTO merchant.staff (id,merchant_id,location_id,user_id,role_id,name)
       SELECT v.id,$2::uuid,$3::uuid,v.user_id,role.id,v.name
         FROM (VALUES
           ($1::uuid,$4::uuid,'Operador'),
           ($5::uuid,$6::uuid,'Se Fue'),
           ($7::uuid,$8::uuid,'Ocupado')
         ) AS v(id,user_id,name)
        CROSS JOIN LATERAL (SELECT id FROM umi.role WHERE NOT is_platform LIMIT 1) AS role
       ON CONFLICT (id) DO NOTHING`,
      [
        OPERATOR_STAFF,
        MERCHANT,
        LOCATION,
        OPERATOR,
        GONE_STAFF,
        GONE_OPERATOR,
        BUSY_STAFF,
        BUSY_OPERATOR,
      ],
    );
    await pg.query(
      `INSERT INTO merchant.device (id,merchant_id,location_id,name,kind,status,revoked_at)
       VALUES
         ($1::uuid,$4::uuid,$5::uuid,'Caja del operador','pos_terminal','active',null),
         ($2::uuid,$4::uuid,$5::uuid,'Caja Linux vieja','pos_terminal','revoked',now()),
         ($3::uuid,$4::uuid,$5::uuid,'Caja vivo','pos_terminal','active',null)
       ON CONFLICT (id) DO UPDATE
         SET status=excluded.status,revoked_at=excluded.revoked_at`,
      [CALLER_DEVICE, DEAD_DEVICE, LIVE_DEVICE, MERCHANT, LOCATION],
    );
    await pg.query(
      `INSERT INTO runtime.session (id,merchant_id,principal_type,principal_id,token_hash)
       SELECT v.id,$2::uuid,'user',v.user_id,md5(v.id::text || clock_timestamp()::text)
         FROM (VALUES
           ($1::uuid,$5::uuid),($3::uuid,$6::uuid),($4::uuid,$7::uuid)
         ) AS v(id,user_id)
       ON CONFLICT (id) DO NOTHING`,
      [
        DURABLE_SESSION,
        MERCHANT,
        GONE_SESSION,
        BUSY_SESSION,
        OPERATOR,
        GONE_OPERATOR,
        BUSY_OPERATOR,
      ],
    );
    // On conflict, RESET: a previous run may have left a session in a state that
    // makes THIS run look broken for reasons that have nothing to do with the code
    // under test.
    for (const held of [
      {
        sessionId: OPERATOR_SESSION,
        durableId: DURABLE_SESSION,
        userId: OPERATOR,
        staffId: OPERATOR_STAFF,
        deviceId: CALLER_DEVICE,
      },
      {
        sessionId: GONE_SESSION,
        durableId: GONE_SESSION,
        userId: GONE_OPERATOR,
        staffId: GONE_STAFF,
        deviceId: DEAD_DEVICE,
      },
      {
        sessionId: BUSY_SESSION,
        durableId: BUSY_SESSION,
        userId: BUSY_OPERATOR,
        staffId: BUSY_STAFF,
        deviceId: LIVE_DEVICE,
      },
    ]) {
      await pg.query(
        `INSERT INTO runtime.operator_session
           (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,
            permissions,entitlements,expires_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
                 ARRAY['cash.shift.open','cash.shift.read','cash.shift.close'],
                 '[{"featureKey":"pos","enabled":true}]',now()+interval '2 hours')
         ON CONFLICT (id) DO UPDATE
           SET durable_session_id=excluded.durable_session_id,user_id=excluded.user_id,
               staff_id=excluded.staff_id,device_id=excluded.device_id,
               merchant_id=excluded.merchant_id,location_id=excluded.location_id,
               permissions=excluded.permissions,entitlements=excluded.entitlements,
               state='active',ended_at=null,expires_at=excluded.expires_at`,
        [
          held.sessionId,
          held.durableId,
          held.userId,
          held.staffId,
          held.deviceId,
          MERCHANT,
          LOCATION,
        ],
      );
    }
    // The shift policy. Without one `policy()` is `default-deny` and opening a
    // shift is refused for a reason that is not under test here.
    for (const [merchantId, locationId, denominations] of [
      [MERCHANT, LOCATION, '[{"minorUnits":5000,"currency":"MXN"}]'],
      [NEIGHBOUR, NEIGHBOUR_LOCATION, '[]'],
    ] as const) {
      await pg.query(
        `INSERT INTO merchant.cash_shift_policy
           (merchant_id,location_id,currency,version,maximum_opening_float,
            allowed_movement_types,variance_tolerance,expires_at,fingerprint,
            denominations,count_method)
         VALUES ($1::uuid,$2::uuid,'MXN','reclaim-harness',1000000,
                 ARRAY['paid_in','paid_out','safe_drop'],100,'2099-01-01T00:00:00Z',
                 repeat('a',64),$3::jsonb,'denomination_or_total')
         ON CONFLICT (merchant_id, location_id) DO UPDATE
           SET version=excluded.version,expires_at=excluded.expires_at`,
        [merchantId, locationId, denominations],
      );
    }
  }, 90_000);

  /** Remove everything the holds touch, children first. */

  /**
   * Put the merchants back to "nothing has happened at the till".
   *
   * NOT A DELETE, AND THAT IS THE SCHEMA TALKING. `merchant.cash_shift` refuses
   * deletion outright (`tg_closed_cash_shift_immutable`: "cash shift deletion is
   * prohibited") and `merchant.cash_ledger_entry` is append-only
   * (`tg_cash_fact_immutable`). So the fixtures are brought to a terminal state
   * instead of being removed — which is what the domain does with them anyway.
   * The two things that ARE removable (custody events, and the register's
   * `current_shift_id` pointer) are cleared, so a re-run starts from the same
   * place and the unique indexes are free again.
   */
  const removeHolds = async () => {
    await pg.query(
      `UPDATE merchant.physical_register SET current_shift_id=null
        WHERE merchant_id = ANY($1::uuid[])`,
      [[MERCHANT, NEIGHBOUR]],
    );
    await pg.query(
      `DELETE FROM merchant.cash_shift_custody_event WHERE merchant_id = ANY($1::uuid[])`,
      [[MERCHANT, NEIGHBOUR]],
    );
    await pg.query(
      `UPDATE merchant.cash_shift SET status='blocked'
        WHERE merchant_id = ANY($1::uuid[])
          AND status NOT IN ('closed','blocked','recovered')`,
      [[MERCHANT, NEIGHBOUR]],
    );
  };

  /** Put the registers back exactly as the defect left them. */
  const seedHolds = async () => {
    await removeHolds();
    // THE ORDER HERE IS THE HISTORY, AND IT MATTERS.
    //
    // `merchant.tg_cash_shift_scope` refuses an opening row on a register that is
    // already `in_use`, and refuses a holding device that is not `active` — both
    // correctly. The condition this suite reproduces was not created by a bad
    // insert: the shift opened legitimately, on a live terminal, and the terminal
    // was revoked afterwards. So the seed walks the same path: registers
    // available, shifts opened against live devices, THEN the terminal dies and
    // the registers go to `in_use`. Writing it the other way round would need a
    // disabled trigger, and a fixture that needs the constraints turned off is
    // not a fixture for this defect.
    // (The `operator_session` rows are already seeded in the first `beforeAll`.)
    await pg.query(
      `INSERT INTO merchant.physical_register
         (id,merchant_id,location_id,display_name,public_reference,currency,active,
          assignment_policy,status)
       VALUES
         ($1::uuid,$4::uuid,$5::uuid,'Caja abandonada','RECLAIM-1','MXN',true,'operator_selects','available'),
         ($2::uuid,$4::uuid,$5::uuid,'Caja viva','RECLAIM-2','MXN',true,'operator_selects','available'),
         ($3::uuid,$4::uuid,$5::uuid,'Caja libre','RECLAIM-3','MXN',true,'operator_selects','available'),
         ($6::uuid,$7::uuid,$8::uuid,'Caja vecina','RECLAIM-4','MXN',true,'operator_selects','available')
       ON CONFLICT (id) DO UPDATE
         SET status=excluded.status,current_shift_id=null,version=1,archived_at=null`,
      [
        REGISTER_ORPHANED,
        REGISTER_HELD_LIVE,
        REGISTER_FREE,
        MERCHANT,
        LOCATION,
        REGISTER_NEIGHBOUR,
        NEIGHBOUR,
        NEIGHBOUR_LOCATION,
      ],
    );
    // Both terminals alive at opening time — the old one dies below, which is the
    // whole point.
    await pg.query(
      `UPDATE merchant.device SET status='active',revoked_at=null
        WHERE id=ANY($1::uuid[])`,
      [[CALLER_DEVICE, DEAD_DEVICE, LIVE_DEVICE]],
    );
    // The orphaned shift: opened 2026-09-03 on a terminal that has since been
    // revoked. This row is the whole defect, reproduced faithfully.
    //
    // ON CONFLICT rather than a plain insert, because the row cannot be deleted
    // (see `removeHolds`) — so a re-run RESETS it instead. The identity columns
    // are written identically, which is what `tg_closed_cash_shift_immutable`
    // requires of an update; only the state moves back to `open`.
    // `ledger_sequence` starts at 0 so the opening-float entry below satisfies
    // `tg_cash_ledger_open_shift`'s "sequence must be previous + 1" rule.
    await pg.query(
      `INSERT INTO merchant.cash_shift
         (id,merchant_id,location_id,register_id,device_id,device_credential_version,
          holding_device_id,holding_device_credential_version,opening_operator_id,
          responsible_operator_id,operator_session_id,currency,business_date,status,
          opening_command_id,opening_float_minor_units,ledger_sequence,opened_at)
       VALUES
         ($1::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,1,$7::uuid,1,$8::uuid,$8::uuid,
          $9::uuid,'MXN','2026-09-03','open',gen_random_uuid(),$10,0,
          '2026-09-03T07:15:28Z'),
         ($2::uuid,$4::uuid,$5::uuid,$3::uuid,$11::uuid,1,$11::uuid,1,$12::uuid,$12::uuid,
          $13::uuid,'MXN','2026-09-16','open',gen_random_uuid(),$10,0,
          now() - interval '10 minutes')
       ON CONFLICT (id) DO UPDATE
         SET status='open',closed_at=null,version=1,ledger_sequence=0,
             opened_at=excluded.opened_at`,
      [
        ORPHAN_SHIFT,
        LIVE_SHIFT,
        REGISTER_HELD_LIVE,
        MERCHANT,
        LOCATION,
        REGISTER_ORPHANED,
        DEAD_DEVICE,
        GONE_OPERATOR,
        GONE_SESSION,
        OPENING_FLOAT,
        LIVE_DEVICE,
        BUSY_OPERATOR,
        BUSY_SESSION,
      ],
    );
    // One ledger entry each, so "the ledger is untouched" has something to be
    // untouched: this is the cash that is still physically in those drawers.
    // Guarded, because these rows are append-only and a re-run must not add a
    // second `sequence 1` — the shift's ledger would then have grown by the shape
    // of the fixture rather than by anything the code did.
    await pg.query(
      `INSERT INTO merchant.cash_ledger_entry
         (merchant_id,location_id,register_id,shift_id,sequence,entry_type,
          amount_minor_units,currency,command_id,business_date)
       VALUES
         ($1::uuid,$2::uuid,$3::uuid,$4::uuid,1,'opening_float',$6,'MXN',gen_random_uuid(),'2026-09-03'),
         ($1::uuid,$2::uuid,$5::uuid,$7::uuid,1,'opening_float',$6,'MXN',gen_random_uuid(),'2026-09-16')
       ON CONFLICT (shift_id, sequence) DO NOTHING`,
      [
        MERCHANT,
        LOCATION,
        REGISTER_ORPHANED,
        ORPHAN_SHIFT,
        REGISTER_HELD_LIVE,
        OPENING_FLOAT,
        LIVE_SHIFT,
      ],
    );
    await pg.query(`UPDATE merchant.cash_shift SET ledger_sequence=1 WHERE id=ANY($1::uuid[])`, [
      [ORPHAN_SHIFT, LIVE_SHIFT],
    ]);
    // NOW the terminal dies. Everything above happened while it was alive.
    await pg.query(
      `UPDATE merchant.device SET status='revoked',revoked_at=now() WHERE id=$1::uuid`,
      [DEAD_DEVICE],
    );
    await pg.query(
      `UPDATE merchant.physical_register
          SET status='in_use',current_shift_id=$2::uuid WHERE id=$1::uuid`,
      [REGISTER_ORPHANED, ORPHAN_SHIFT],
    );
    await pg.query(
      `UPDATE merchant.physical_register
          SET status='in_use',current_shift_id=$2::uuid WHERE id=$1::uuid`,
      [REGISTER_HELD_LIVE, LIVE_SHIFT],
    );
  };

  beforeAll(async () => {
    await seedHolds();
  }, 60_000);

  afterAll(async () => {
    await removeHolds();
    // NOTHING IS DELETED, and every reason is a constraint rather than a
    // preference: the shifts are protected from deletion, which implies the
    // registers they point at (`cash_shift_register_id_fkey`, ON DELETE RESTRICT),
    // which implies the merchants; the ledger and the audit trail are append-only.
    // What is left behind is a set of rows in a terminal state, which the next run
    // resets in place. See the seeding note.
    await pg?.onModuleDestroy?.();
  });

  it('refuses an open on a held register with a typed conflict, not a server fault', async () => {
    const current = await register(REGISTER_ORPHANED);
    const refused = await refusal(() => openShift(REGISTER_ORPHANED, current.version));

    // 409, the code preserved, and the facts. A 500 here is the original defect.
    expect(refused.status).toBe(409);
    expect(refused.code).toBe('REGISTER_NOT_AVAILABLE');
    expect(refused.details).toMatchObject({
      reason: 'register_held',
      registerId: REGISTER_ORPHANED,
      registerStatus: 'in_use',
      registerVersion: current.version,
      expectedRegisterVersion: current.version,
      holdState: 'held_by_orphaned_till',
      shiftId: ORPHAN_SHIFT,
      shiftStatus: 'open',
      holdingDeviceId: DEAD_DEVICE,
      holdingOperatorSessionId: GONE_SESSION,
      reclaimable: true,
      action: 'reclaim_register',
    });
    // The facts the operator actually needs are present, not merely the code.
    expect(typeof refused.details.shiftOpenedAt).toBe('string');
    expect(refused.details.holdingDeviceStatus).toBe('revoked');
  });

  it('points a register held by a LIVE terminal at manager recovery instead', async () => {
    const current = await register(REGISTER_HELD_LIVE);
    const refused = await refusal(() => openShift(REGISTER_HELD_LIVE, current.version));

    expect(refused.status).toBe(409);
    expect(refused.code).toBe('REGISTER_NOT_AVAILABLE');
    expect(refused.details).toMatchObject({
      reason: 'register_held',
      holdState: 'held_by_active_till',
      holdingDeviceId: LIVE_DEVICE,
      holdingDeviceStatus: 'active',
      reclaimable: false,
      action: 'manager_recovery',
    });
  });

  it('reclaims the orphaned hold, blocks the shift and frees the register', async () => {
    const before = await register(REGISTER_ORPHANED);
    const ledgerBefore = await ledger(ORPHAN_SHIFT);
    const result = await reclaim(REGISTER_ORPHANED, before.version);

    // The shift is BLOCKED: the domain's terminal state with no way out, and
    // neither of the two states that imply somebody counted the drawer.
    expect(result.shift?.status).toBe('blocked');
    expect(await shift(ORPHAN_SHIFT)).toMatchObject({ status: 'blocked' });
    // ... and deliberately NOT closed: the drawer was abandoned, not shut.
    expect((await shift(ORPHAN_SHIFT)).closed_at).toBeNull();

    // The register is free and points at nothing, so a shift can open again.
    expect(result.register).toMatchObject({
      id: REGISTER_ORPHANED,
      status: 'available',
      currentShiftId: null,
      hold: { state: 'free', shiftId: null, reclaimable: false },
    });

    // THE LEDGER IS UNTOUCHED — the cash is still in the drawer.
    expect(await ledger(ORPHAN_SHIFT)).toEqual(ledgerBefore);

    // The custody event names who did it, why, and which terminal it was about.
    expect(result.custody).toMatchObject({
      eventType: 'orphan_reclaim',
      shiftId: ORPHAN_SHIFT,
      previousHoldingDeviceId: DEAD_DEVICE,
      newHoldingDeviceId: null,
      actingOperatorId: OPERATOR,
      responsibleOperatorId: GONE_OPERATOR,
      shiftStatusBefore: 'open',
      shiftStatusAfter: 'blocked',
      expectedCash: null,
      countedCash: null,
      reasonCode: 'dead_terminal',
    });
  }, 60_000);

  it('drops the blocked shift out of the active-shift queries', async () => {
    const active = await activeShiftsAt();
    expect(active).not.toContain(ORPHAN_SHIFT);
    expect(active).toContain(LIVE_SHIFT);
  });

  it('records the reclaim in the audit trail with the actor and the reason', async () => {
    const { rows } = await pg.tquery<{
      actor_user_id: string | null;
      entity_id: string | null;
      public_data: Record<string, unknown>;
    }>(
      MERCHANT,
      `SELECT actor_user_id::text AS actor_user_id,entity_id::text AS entity_id,public_data
         FROM merchant.audit_event
        WHERE merchant_id=$1::uuid AND event_type='cash.register_reclaimed'
          AND entity_id=$2::uuid
        ORDER BY occurred_at DESC LIMIT 1`,
      [MERCHANT, REGISTER_ORPHANED],
    );
    expect(rows[0]).toBeTruthy();
    expect(rows[0].actor_user_id).toBe(OPERATOR);
    expect(rows[0].entity_id).toBe(REGISTER_ORPHANED);
    expect(rows[0].public_data).toMatchObject({
      reasonCode: 'dead_terminal',
      shiftId: ORPHAN_SHIFT,
      holdingDeviceId: DEAD_DEVICE,
    });
  });

  it('lets a new shift open on the reclaimed register, with its own ledger', async () => {
    const freed = await register(REGISTER_ORPHANED);
    const opened = await openShift(REGISTER_ORPHANED, freed.version);

    expect(opened.shift.status).toBe('open');
    expect(opened.shift.registerId).toBe(REGISTER_ORPHANED);
    expect(opened.register).toMatchObject({
      status: 'in_use',
      hold: { state: 'held_by_this_device', reclaimable: false },
    });
    expect(opened.register.currentShiftId).toBe(opened.shift.id);
    // The new shift's own opening float is the only ledger entry it has, and the
    // blocked shift's ledger is still exactly as it was.
    expect(await ledger(opened.shift.id)).toEqual({
      entries: '1',
      total: String(OPENING_FLOAT),
      last: '1',
    });
    expect(await ledger(ORPHAN_SHIFT)).toMatchObject({
      entries: '1',
      total: String(OPENING_FLOAT),
    });
  }, 60_000);

  it('refuses to reclaim a register a LIVE terminal is holding, and moves nothing', async () => {
    const before = await register(REGISTER_HELD_LIVE);
    const refused = await refusal(() => reclaim(REGISTER_HELD_LIVE, before.version));

    expect(refused.status).toBe(409);
    expect(refused.code).toBe('REGISTER_HELD_BY_ACTIVE_TILL');
    expect(refused.details).toMatchObject({
      reason: 'register_held_by_active_till',
      action: 'manager_recovery',
      holdState: 'held_by_active_till',
      holdingDeviceId: LIVE_DEVICE,
      shiftId: LIVE_SHIFT,
    });
    // Nothing moved: the live shift is still open and still holds its register.
    expect(await shift(LIVE_SHIFT)).toMatchObject({ status: 'open' });
    expect(await register(REGISTER_HELD_LIVE)).toMatchObject({
      status: 'in_use',
      current_shift_id: LIVE_SHIFT,
    });
  });

  it('refuses a reclaim of another merchant\u2019s register, and moves nothing there', async () => {
    const { rows } = await pg.tquery<{ version: number }>(
      NEIGHBOUR,
      `SELECT version FROM merchant.physical_register WHERE id=$1::uuid`,
      [REGISTER_NEIGHBOUR],
    );
    const refused = await refusal(() => reclaim(REGISTER_NEIGHBOUR, rows[0].version));
    expect(refused.status).toBe(409);
    expect(refused.code).toBe('REGISTER_NOT_AVAILABLE');
    expect(refused.details.reason).toBe('register_not_found');
  });

  it('refuses a reclaim against a stale register version', async () => {
    const before = await register(REGISTER_HELD_LIVE);
    const refused = await refusal(() => reclaim(REGISTER_HELD_LIVE, before.version + 41));
    expect(refused.status).toBe(409);
    expect(refused.code).toBe('OPTIMISTIC_VERSION_CONFLICT');
    expect(refused.details).toMatchObject({
      registerVersion: before.version,
      expectedRegisterVersion: before.version + 41,
    });
  });

  it('is a no-op on a register nobody holds, and does not bump its version', async () => {
    const before = await register(REGISTER_FREE);
    const result = await reclaim(REGISTER_FREE, before.version);
    expect(result.shift).toBeNull();
    expect(result.custody).toBeNull();
    expect(result.register).toMatchObject({ status: 'available', hold: { state: 'free' } });
    // A register already free is left EXACTLY as it was: bumping its version for
    // nothing would fail a concurrent open that is entitled to win.
    expect((await register(REGISTER_FREE)).version).toBe(before.version);
  });

  it('refuses, in SQL, a custody row that records a count for a reclaim', async () => {
    // The rule the whole operation exists to respect, enforced by the database
    // rather than by this code: a drawer nobody counted may not be recorded as
    // counted. A raw INSERT bypasses every line of TypeScript.
    await expect(
      pg.query(
        `INSERT INTO merchant.cash_shift_custody_event
           (merchant_id,location_id,register_id,shift_id,event_type,
            previous_holding_device_id,previous_holding_credential_version,
            previous_operator_session_id,acting_operator_id,responsible_operator_id,
            shift_status_before,shift_status_after,counted_cash_minor_units,currency,
            reason_code,command_id,ledger_sequence)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'orphan_reclaim',
                 $5::uuid,1,$6::uuid,$7::uuid,$8::uuid,'open','blocked',12345,'MXN',
                 'dead_terminal',gen_random_uuid(),1)`,
        [
          MERCHANT,
          LOCATION,
          REGISTER_ORPHANED,
          ORPHAN_SHIFT,
          DEAD_DEVICE,
          GONE_SESSION,
          OPERATOR,
          GONE_OPERATOR,
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('shows the till a hold it can act on, and not a shift it cannot use', async () => {
    // The two layers agreeing, which is the reason the Caja screen is in this
    // story at all: the center's own active-shift query — device, operator and all
    // three terminal statuses — is what the screen reads.
    const center = await scoped(() =>
      new PosCashRepository(pg).center(
        OPERATOR,
        MERCHANT,
        LOCATION,
        OPERATOR_SESSION,
        CALLER_DEVICE,
        OPERATOR,
      ),
    );
    const orphaned = center.registers.find((entry) => entry.id === REGISTER_ORPHANED);
    // The register the operator just took is theirs; the blocked shift is not
    // offered as an open one.
    expect(orphaned?.hold.state).toBe('held_by_this_device');
    expect(center.currentShift?.id).not.toBe(ORPHAN_SHIFT);
    const live = center.registers.find((entry) => entry.id === REGISTER_HELD_LIVE);
    expect(live?.hold).toMatchObject({
      state: 'held_by_active_till',
      reclaimable: false,
      deviceStatus: 'active',
    });
  }, 60_000);
});
