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
 * THE DRAWER BELONGS TO THE TERMINAL, AND THE TERMINAL CAN HAND IT ON.
 *
 * THE DEFECT THIS SUITE EXISTS FOR was measured on the iMin D3-504 on
 * 2026-10-11, and it is the ordinary shape of an app update rather than a fault
 * anybody did. The till holds register CAJA-1 with a drawer opened on 7 October
 * by the Caja 1 operator. The app is updated between shifts, so the drawer is
 * still held by this very terminal (`holding_device_id`) while
 * `operator_session_id` names a session that is gone — and the person standing
 * at the till is somebody else, which in that database means a different
 * `umi.user` row.
 *
 *   POST /cash/shifts/:id/resume   -> 500 INTERNAL_ERROR
 *   POST /checkout                 -> 409 CASH_SHIFT_REQUIRED, hold_state
 *                                     `held_by_this_device`
 *
 * The till was told the drawer was its own and that resuming it was the way out,
 * and the resume could not succeed. The WRITE matched the shift on
 * `responsible_operator_id = the acting operator` — a fact about the PERSON —
 * while the READ that offered the button matched on `holding_device_id` — a fact
 * about the TERMINAL. One predicate was answering two different questions, and
 * the whole cash surface was unreachable behind it: with the responsibility left
 * on somebody who had gone, a movement, a count and the close all match the same
 * column and fail the same way.
 *
 * Three things are asserted here, and only the database can prove two of them:
 *
 *   1. The resume succeeds for the operator standing at the terminal that holds
 *      the drawer, whoever opened it, and THE ONLINE SESSION AND THE
 *      RESPONSIBILITY BOTH MOVE. That second half is asserted by then recording a
 *      movement — the operation that failed before, because the responsibility
 *      never moved.
 *   2. The hand-over is a link in the chain of custody: `operator_resume`
 *      (migration 015) names the session that spoke for the drawer and the one
 *      that speaks for it now. The shape constraint still forbids a counted
 *      amount on it: nobody counted anything, and a resume may never claim
 *      otherwise.
 *   3. Every way the move can fail is a NAMED refusal with a status, never a
 *      bare `Error` that reaches the operator as a 500 — a stale version, a
 *      drawer on another terminal, and a status the move does not admit.
 *
 * Self-seeding and self-cleaning; the merchant stays because `audit_event` is
 * append-only and its foreign key is ON DELETE RESTRICT (see the seeding note in
 * register-reclaim.integration.ts, which this file follows).
 *
 *   DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
 *     npx vitest run --config vitest.integration.config.ts shift-resume
 */

const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:4003/umi_transition_rehearsal_20260901';
const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:4003/umi_transition_rehearsal_20260901';

const JWT_SECRET = 'shift-resume-harness-secret-0000000000000000';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const MERCHANT = '6d000000-0000-4000-8000-0000000000a1';
const LOCATION = '6d000000-0000-4000-8000-0000000000a2';

/** The operator standing at the till when the app comes back up. */
const ACTOR = '6d000000-0000-4000-8000-0000000000b1';
const ACTOR_STAFF = '6d000000-0000-4000-8000-0000000000b2';
const ACTOR_DURABLE = '6d000000-0000-4000-8000-0000000000b3';
const ACTOR_SESSION = '6d000000-0000-4000-8000-0000000000b4';

/** The operator who opened the drawer, whose session the update threw away. */
const GONE = '6d000000-0000-4000-8000-0000000000c1';
const GONE_STAFF = '6d000000-0000-4000-8000-0000000000c2';
const GONE_DURABLE = '6d000000-0000-4000-8000-0000000000c3';
const GONE_SESSION = '6d000000-0000-4000-8000-0000000000c4';

/** The terminal that holds the drawer — the same one in both sessions. */
const TILL = '6d000000-0000-4000-8000-0000000000d1';
/** A second, live terminal, for the refusal that must not touch its drawer. */
const OTHER_TILL = '6d000000-0000-4000-8000-0000000000d2';

/**
 * The operator on the OTHER terminal. `tg_cash_shift_scope` refuses an opening
 * row whose session belongs to a different device — correctly, since a shift
 * always opens on the terminal that opened it — so the second drawer needs its
 * own operator and session rather than the same one borrowed twice.
 */
const ELSEWHERE = '6d000000-0000-4000-8000-0000000000c5';
const ELSEWHERE_STAFF = '6d000000-0000-4000-8000-0000000000c6';
const ELSEWHERE_DURABLE = '6d000000-0000-4000-8000-0000000000c7';
const ELSEWHERE_SESSION = '6d000000-0000-4000-8000-0000000000c8';

const REGISTER = '6d000000-0000-4000-8000-0000000000e1';
const REGISTER_ELSEWHERE = '6d000000-0000-4000-8000-0000000000e2';
const SHIFT = '6d000000-0000-4000-8000-0000000000f1';
const SHIFT_ELSEWHERE = '6d000000-0000-4000-8000-0000000000f2';
const OPENING_FLOAT = 100_500;

const PERMISSIONS = [
  'cash.shift.open',
  'cash.shift.read',
  'cash.shift.resume',
  'cash.shift.suspend',
  'cash.shift.close',
  'cash.movement.paid_in',
  'cash.movement.paid_out',
];

type Refusal = {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
};

describe('a drawer held by this terminal returns to the operator standing at it', () => {
  let pg: PgService;
  let cash: PosCashService;

  const actor = {
    id: ACTOR,
    sessionId: ACTOR_DURABLE,
    deviceId: TILL,
    email: null,
  };

  const scoped = <T>(fn: () => Promise<T>) =>
    runWithRequestContext(
      {
        merchantId: MERCHANT,
        locationId: LOCATION,
        // `deviceId` is not decoration: it is what `withMerchant` puts into
        // `app.current_device`, and `device_scoping` on `merchant.cash_shift` is a
        // RESTRICTIVE policy over it.
        deviceId: TILL,
        userId: ACTOR,
        requestId: randomUUID(),
      },
      fn,
    );

  const refusal = async (work: () => Promise<unknown>): Promise<Refusal> => {
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
  };

  const shiftRow = async (id: string) => {
    const { rows } = await pg.tquery<{
      status: string;
      version: number;
      operatorSessionId: string;
      responsibleOperatorId: string;
      holdingDeviceId: string;
    }>(
      MERCHANT,
      `SELECT status,version,operator_session_id::text AS "operatorSessionId",
              responsible_operator_id::text AS "responsibleOperatorId",
              holding_device_id::text AS "holdingDeviceId"
         FROM merchant.cash_shift WHERE id=$1::uuid`,
      [id],
    );
    return rows[0] ?? null;
  };

  const custodyRows = async (shiftId: string) => {
    const { rows } = await pg.tquery<{
      eventType: string;
      previousOperatorSessionId: string;
      newOperatorSessionId: string | null;
      responsibleOperatorId: string;
      countedCashMinorUnits: string | null;
    }>(
      MERCHANT,
      `SELECT event_type AS "eventType",
              previous_operator_session_id::text AS "previousOperatorSessionId",
              new_operator_session_id::text AS "newOperatorSessionId",
              responsible_operator_id::text AS "responsibleOperatorId",
              counted_cash_minor_units::text AS "countedCashMinorUnits"
         FROM merchant.cash_shift_custody_event
        WHERE shift_id=$1::uuid ORDER BY occurred_at`,
      [shiftId],
    );
    return rows;
  };

  const resume = (shiftId: string, version: number) =>
    scoped(() =>
      cash.transition(
        actor,
        MERCHANT,
        shiftId,
        {
          locationId: LOCATION,
          operatorSessionId: ACTOR_SESSION,
          commandId: randomUUID(),
          idempotencyKey: randomUUID(),
          shiftId,
          expectedShiftVersion: version,
          reasonCode: 'operator_session_replaced',
        },
        'open',
      ),
    );

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
      `INSERT INTO merchant.merchant (id,name,handle,currency,timezone)
       VALUES ($1::uuid,'Shift Resume Harness','shift-resume-harness','MXN','America/Mexico_City')
       ON CONFLICT (id) DO NOTHING`,
      [MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name)
       VALUES ($1::uuid,$2::uuid,'Congreso') ON CONFLICT (id) DO NOTHING`,
      [LOCATION, MERCHANT],
    );
    await pg.query(
      `INSERT INTO umi."user" (id,full_name) VALUES
         ($1::uuid,'En Turno'),($2::uuid,'Se Fue'),($3::uuid,'Otra Caja')
       ON CONFLICT (id) DO NOTHING`,
      [ACTOR, GONE, ELSEWHERE],
    );
    await pg.query(
      `INSERT INTO merchant.staff (id,merchant_id,location_id,user_id,role_id,name)
       SELECT v.id,$2::uuid,$3::uuid,v.user_id,role.id,v.name
         FROM (VALUES
           ($1::uuid,$4::uuid,'En Turno'),
           ($5::uuid,$6::uuid,'Se Fue'),
           ($7::uuid,$8::uuid,'Otra Caja')
         )
              AS v(id,user_id,name)
        CROSS JOIN LATERAL (SELECT id FROM umi.role WHERE NOT is_platform LIMIT 1) AS role
       ON CONFLICT (id) DO NOTHING`,
      [ACTOR_STAFF, MERCHANT, LOCATION, ACTOR, GONE_STAFF, GONE, ELSEWHERE_STAFF, ELSEWHERE],
    );
    await pg.query(
      `INSERT INTO merchant.device (id,merchant_id,location_id,name,kind,status)
       VALUES ($1::uuid,$3::uuid,$4::uuid,'Caja 1','pos_terminal','active'),
              ($2::uuid,$3::uuid,$4::uuid,'Caja 2','pos_terminal','active')
       ON CONFLICT (id) DO UPDATE SET status='active',revoked_at=null`,
      [TILL, OTHER_TILL, MERCHANT, LOCATION],
    );
    await pg.query(
      `INSERT INTO runtime.session (id,merchant_id,principal_type,principal_id,token_hash)
       SELECT v.id,$2::uuid,'user',v.user_id,md5(v.id::text || clock_timestamp()::text)
         FROM (VALUES ($1::uuid,$3::uuid),($4::uuid,$5::uuid),($6::uuid,$7::uuid))
              AS v(id,user_id)
       ON CONFLICT (id) DO NOTHING`,
      [ACTOR_DURABLE, MERCHANT, ACTOR, GONE_DURABLE, GONE, ELSEWHERE_DURABLE, ELSEWHERE],
    );
    for (const held of [
      {
        sessionId: ACTOR_SESSION,
        durableId: ACTOR_DURABLE,
        userId: ACTOR,
        staffId: ACTOR_STAFF,
        deviceId: TILL,
      },
      {
        sessionId: GONE_SESSION,
        durableId: GONE_DURABLE,
        userId: GONE,
        staffId: GONE_STAFF,
        deviceId: TILL,
      },
      {
        sessionId: ELSEWHERE_SESSION,
        durableId: ELSEWHERE_DURABLE,
        userId: ELSEWHERE,
        staffId: ELSEWHERE_STAFF,
        deviceId: OTHER_TILL,
      },
    ]) {
      await pg.query(
        `INSERT INTO runtime.operator_session
           (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,
            permissions,entitlements,expires_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
                 $8::text[],'[{"featureKey":"pos","enabled":true}]',now()+interval '2 hours')
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
          // The first two sessions are on the SAME terminal, which is the whole
          // point: the app came back up on the till that holds the drawer, and
          // the only thing that changed is the person. The third is the neighbour
          // whose drawer this terminal must not touch.
          held.deviceId,
          MERCHANT,
          LOCATION,
          PERMISSIONS,
        ],
      );
    }
    await pg.query(
      `INSERT INTO merchant.cash_shift_policy
         (merchant_id,location_id,currency,version,maximum_opening_float,
          allowed_movement_types,variance_tolerance,movement_approval_threshold,
          close_approval_threshold,expires_at,fingerprint,
          denominations,count_method)
       VALUES ($1::uuid,$2::uuid,'MXN','resume-harness',1000000,
               ARRAY['paid_in','paid_out','safe_drop'],100,1000000,1000000,
               '2099-01-01T00:00:00Z',
               repeat('a',64),'[{"minorUnits":5000,"currency":"MXN"}]'::jsonb,
               'denomination_or_total')
       ON CONFLICT (merchant_id, location_id) DO UPDATE
         SET version=excluded.version,expires_at=excluded.expires_at,
             movement_approval_threshold=excluded.movement_approval_threshold,
             close_approval_threshold=excluded.close_approval_threshold`,
      [MERCHANT, LOCATION],
    );
  }, 90_000);

  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  /** Put the two registers and their shifts back to the shape of the defect. */
  const seed = async () => {
    await pg.query(
      `UPDATE merchant.physical_register SET current_shift_id=null,status='available',version=1
        WHERE merchant_id=$1::uuid`,
      [MERCHANT],
    );
    await pg.query(`DELETE FROM merchant.cash_shift_custody_event WHERE merchant_id=$1::uuid`, [
      MERCHANT,
    ]);
    await pg.query(
      `UPDATE merchant.cash_shift SET status='blocked'
        WHERE merchant_id=$1::uuid AND status NOT IN ('closed','blocked','recovered')`,
      [MERCHANT],
    );
    // The registers exist BEFORE the shifts do: `tg_cash_shift_scope` refuses an
    // opening row on a register that is already `in_use`, and a fixture that
    // needs the constraint turned off is not a fixture for this defect.
    await pg.query(
      `INSERT INTO merchant.physical_register
         (id,merchant_id,location_id,display_name,public_reference,currency,active,
          assignment_policy,status)
       VALUES ($1::uuid,$3::uuid,$4::uuid,'Caja 1','RESUME-1','MXN',true,
               'operator_selects','available'),
              ($2::uuid,$3::uuid,$4::uuid,'Caja 2','RESUME-2','MXN',true,
               'operator_selects','available')
       ON CONFLICT (id) DO UPDATE
         SET status='available',current_shift_id=null,version=1,archived_at=null`,
      [REGISTER, REGISTER_ELSEWHERE, MERCHANT, LOCATION],
    );
    // THE HISTORY, IN THE ORDER IT HAPPENED. The drawer opens on the till, under
    // the operator who has since gone — and it is still `open`, because nobody
    // ever closed it. The status is written directly only for the version and the
    // identity columns, which is exactly the state an app update leaves behind.
    for (const seeded of [
      { id: SHIFT, registerId: REGISTER, sessionId: GONE_SESSION, deviceId: TILL, by: GONE },
      {
        id: SHIFT_ELSEWHERE,
        registerId: REGISTER_ELSEWHERE,
        sessionId: ELSEWHERE_SESSION,
        deviceId: OTHER_TILL,
        by: ELSEWHERE,
      },
    ]) {
      await pg.query(
        `INSERT INTO merchant.cash_shift
           (id,merchant_id,location_id,register_id,device_id,device_credential_version,
            holding_device_id,holding_device_credential_version,opening_operator_id,
            responsible_operator_id,operator_session_id,currency,business_date,status,
            opening_command_id,opening_float_minor_units,opening_denominations,
            ledger_sequence,version)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,1,$5::uuid,1,
                 $6::uuid,$6::uuid,$7::uuid,'MXN','2026-10-07','open',
                 $8::uuid,$9,'[]'::jsonb,0,26)
         ON CONFLICT (id) DO UPDATE
           SET status='open',version=26,ledger_sequence=0,
               operator_session_id=excluded.operator_session_id,
               responsible_operator_id=excluded.responsible_operator_id,
               holding_device_id=excluded.holding_device_id,
               closed_at=null,suspended_at=null`,
        [
          seeded.id,
          MERCHANT,
          LOCATION,
          seeded.registerId,
          seeded.deviceId,
          seeded.by,
          seeded.sessionId,
          randomUUID(),
          OPENING_FLOAT,
        ],
      );
      await pg.query(
        `UPDATE merchant.physical_register SET status='in_use',current_shift_id=$2::uuid
          WHERE id=$1::uuid`,
        [seeded.registerId, seeded.id],
      );
    }
  };

  it('hands the drawer to the operator at the terminal, and records the hand-over', async () => {
    await seed();

    const before = await shiftRow(SHIFT);
    expect(before).toMatchObject({
      status: 'open',
      version: 26,
      operatorSessionId: GONE_SESSION,
      responsibleOperatorId: GONE,
      holdingDeviceId: TILL,
    });

    const resumed = await resume(SHIFT, 26);
    expect(resumed).toMatchObject({
      id: SHIFT,
      status: 'open',
      responsibleOperatorId: ACTOR,
      operatorSessionId: ACTOR_SESSION,
      holdingDeviceId: TILL,
    });

    // THE POINT OF MOVING THE RESPONSIBILITY, ASSERTED AS THE OPERATION THAT
    // COULD NOT BE MADE BEFORE. A movement matches `responsible_operator_id`; when
    // the resume re-pinned only the session, an operator who took their drawer
    // back still could not record a pay-in on it. The money path would have stayed
    // shut one screen later.
    const movement = await scoped(() =>
      cash.movement(actor, MERCHANT, SHIFT, {
        locationId: LOCATION,
        operatorSessionId: ACTOR_SESSION,
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
        shiftId: SHIFT,
        expectedShiftVersion: resumed.version,
        type: 'paid_in',
        amount: { minorUnits: 2_500, currency: 'MXN' },
        reasonCode: 'float_correction',
        note: null,
        approvalId: null,
        actionFingerprint: null,
      }),
    );
    expect(movement.type).toBe('paid_in');

    const custody = await custodyRows(SHIFT);
    expect(custody).toHaveLength(1);
    expect(custody[0]).toMatchObject({
      eventType: 'operator_resume',
      previousOperatorSessionId: GONE_SESSION,
      newOperatorSessionId: ACTOR_SESSION,
      responsibleOperatorId: ACTOR,
      countedCashMinorUnits: null,
    });
  });

  it('refuses a resume from a terminal that does not hold the drawer, by name', async () => {
    await seed();

    const refused = await refusal(() => resume(SHIFT_ELSEWHERE, 26));
    expect(refused).toMatchObject({
      status: 409,
      code: 'INVALID_SHIFT_TRANSITION',
      details: { reason: 'shift_held_by_another_device' },
    });
    // AND IT TOUCHED NOTHING. A refusal that half-wrote the shift would leave the
    // drawer speaking for the wrong person.
    expect(await shiftRow(SHIFT_ELSEWHERE)).toMatchObject({
      responsibleOperatorId: ELSEWHERE,
      operatorSessionId: ELSEWHERE_SESSION,
      holdingDeviceId: OTHER_TILL,
      version: 26,
    });
    expect(await custodyRows(SHIFT_ELSEWHERE)).toHaveLength(0);
  });

  it('refuses a resume whose version has moved, and says which one the drawer is on', async () => {
    await seed();

    const refused = await refusal(() => resume(SHIFT, 25));
    expect(refused).toMatchObject({
      status: 409,
      code: 'OPTIMISTIC_VERSION_CONFLICT',
      details: { reason: 'shift_changed', shiftVersion: 26, expectedShiftVersion: 25 },
    });
  });

  it('refuses a drawer under count by name, instead of reporting a move that did not happen', async () => {
    await seed();
    // The status the resume used to accept and then silently ignore. Four no-ops
    // like this one sit in the audit table as `cash.shift_open` `success` against
    // a drawer that never opened (bug-hunt §140).
    await pg.query(`UPDATE merchant.cash_shift SET status='counting' WHERE id=$1::uuid`, [SHIFT]);

    const refused = await refusal(() => resume(SHIFT, 26));
    expect(refused).toMatchObject({
      status: 409,
      code: 'INVALID_SHIFT_TRANSITION',
      details: { reason: 'shift_state_not_movable', from: 'counting', to: 'open' },
    });
    expect(await shiftRow(SHIFT)).toMatchObject({
      status: 'counting',
      version: 26,
      responsibleOperatorId: GONE,
      operatorSessionId: GONE_SESSION,
    });
  });

  it('answers with a status, never a bare Error, for every way the move can fail', async () => {
    await seed();
    // `unwrap` is what turns a `CashRefusal` into a response; anything else
    // travels as it did and the catch-all filter makes it a 500. So this asserts
    // the SHAPE of the failure, which is the half that reached the operator as
    // `INTERNAL_ERROR`: a status, and a code the contract publishes.
    for (const work of [() => resume(SHIFT, 25), () => resume(SHIFT_ELSEWHERE, 26)]) {
      const refused = await refusal(work);
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(refused.status).toBeLessThan(500);
      expect(refused.code).not.toBe('INTERNAL_ERROR');
    }
  });
});
