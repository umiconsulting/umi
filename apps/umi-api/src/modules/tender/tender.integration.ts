import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import fc from 'fast-check';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import type { AuthUser } from '../auth/auth.types';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { PosCheckoutRepository } from '../pos-checkout/pos-checkout.repository';
import { PosCheckoutService } from '../pos-checkout/pos-checkout.service';
import { PosCartRepository } from '../pos-cart/pos-cart.repository';
import { ScriptedTerminalProvider } from './providers/scripted-terminal.provider';
import { TenderProviderRegistry } from './tender-provider.registry';
import { TenderRepository } from './tender.repository';
import { TenderService } from './tender.service';

/**
 * WORKSTREAM G · THE ACCEPTANCE, AGAINST THE REAL SCHEMA.
 *
 * §8G's acceptance is one sentence: "A retried payment never charges twice, a terminal
 * timeout never marks a sale paid, a cancelled sale cancels its fiscal document, and tests
 * prove all three." This file proves the first two; `fiscal.integration.ts` proves the
 * third, and `pos-sale`'s own suite proves the cancellation happens in ONE command.
 *
 * WHY THE FAKES ARE THE INSTRUMENT AND NOT A SHORTCUT. A provider that never answers, one
 * that answers only when asked again, and one that says "processed" while withholding the
 * payment id are the three shapes that a live merchant account would take weeks to produce
 * on purpose. The scripted provider produces them on demand, and it COUNTS what it was
 * asked — which is how "never charges twice" is asserted as a fact (`captureCalls.length
 * === 1`) rather than as a reading of the source code.
 *
 * WHAT IS ASSERTED WHERE. Every money claim is read back from SQL, not from the service's
 * return value: a service that returns the right object while writing the wrong row is
 * exactly the failure a mocked test cannot see. The constraint is exercised from RAW SQL
 * as well, because a rule the API enforces is a promise and a CHECK is enforcement.
 *
 *   set -a && . apps/umi-api/.env && set +a
 *   DATABASE_URL_APP=$(echo "$DATABASE_URL_APP" | sed 's#/umi_transition_rehearsal_20260901#/umi_tender_verify2#') \
 *   DATABASE_URL_WORKER=$(echo "$DATABASE_URL_WORKER" | sed 's#/umi_transition_rehearsal_20260901#/umi_tender_verify2#') \
 *   npx vitest run --config vitest.integration.config.ts src/modules/tender/tender.integration.ts
 */

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;

const JWT_SECRET = 'tender-harness-secret-000000000000';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const MERCHANT = '7d000000-0000-4000-8000-0000000000b1';
const LOCATION = '7d000000-0000-4000-8000-0000000000b2';
const NEIGHBOUR = '7d000000-0000-4000-8000-0000000000b3';
const NEIGHBOUR_LOCATION = '7d000000-0000-4000-8000-0000000000b4';
const USER = '7d000000-0000-4000-8000-0000000000c1';
const DEVICE = '7d000000-0000-4000-8000-0000000000c2';
const STAFF = '7d000000-0000-4000-8000-0000000000c3';
const SESSION = '7d000000-0000-4000-8000-0000000000c4';
const OPERATOR_SESSION = '7d000000-0000-4000-8000-0000000000c5';
const CART = '7d000000-0000-4000-8000-0000000000d1';

/**
 * The permission and the entitlement the checkout's own gate demands. Read from
 * `PosCheckoutRepository.authorize`, which the tender service calls rather than
 * duplicating: an unsigned operator session must not be able to move money, and the way
 * to prove the gate is on is to satisfy it exactly and then break it.
 */
// `checkout.terminal.confirm` is what the till itself requires before it puts a
// card terminal on a sale, so an operator who can take a terminal payment is
// exactly one who can settle one. `settle` asks for it and the last case below
// proves it refuses without it.
const PERMISSIONS = ['checkout.commit', 'sale.lifecycle', 'checkout.terminal.confirm'];
const ENTITLEMENTS = JSON.stringify([{ featureKey: 'pos', enabled: true }]);

const CHECK_VIOLATION = '23514';

const user: AuthUser = {
  id: USER,
  sessionId: SESSION,
  deviceId: DEVICE,
  email: 'tender@harness.test',
  displayName: 'Tender Harness',
} as AuthUser;

describe('the tender attempt model · §8G steps 2, 3 and 7', () => {
  let pg: PgService;
  let tender: TenderService;
  let succeeded: ScriptedTerminalProvider;
  let declined: ScriptedTerminalProvider;
  let silent: ScriptedTerminalProvider;
  let answersLater: ScriptedTerminalProvider;
  let withholdsProof: ScriptedTerminalProvider;
  let providers: ScriptedTerminalProvider[];

  const scoped = <T>(fn: () => Promise<T>, merchant = MERCHANT, location = LOCATION) =>
    runWithRequestContext(
      {
        merchantId: merchant,
        locationId: location,
        userId: USER,
        // The DEVICE matters, and its absence is silent. `merchant.pos_checkout_draft`
        // carries a RESTRICTIVE `device_scoping` policy — `current_device() is not
        // null and device_id = current_device()` — so a request context without a
        // device sees NO rows of it at all, and a service test then reads an empty
        // table while `tquery` (which runs as the BYPASSRLS worker) shows the row
        // sitting right there. Every row that passed through here before this line
        // was read with the worker role, which is why nothing had noticed.
        deviceId: DEVICE,
        requestId: randomUUID(),
      },
      fn,
    );

  const capture = (
    overrides: Partial<{
      provider: string;
      commandIdentity: string;
      idempotencyKey: string;
      tenderId: string;
      cartId: string;
      amountMinorUnits: number;
    }> = {},
  ) =>
    scoped(() =>
      tender.capture(user, MERCHANT, {
        cartId: overrides.cartId ?? CART,
        tenderId: overrides.tenderId ?? randomUUID(),
        locationId: LOCATION,
        operatorSessionId: OPERATOR_SESSION,
        commandIdentity: overrides.commandIdentity ?? randomUUID(),
        provider: overrides.provider ?? 'scripted_card_terminal',
        amount: { minorUnits: overrides.amountMinorUnits ?? 9_000, currency: 'MXN' },
        idempotencyKey: overrides.idempotencyKey ?? randomUUID(),
      }),
    );

  const askAgain = (commandIdentity: string, refresh: boolean) =>
    scoped(() =>
      tender.attempt(user, MERCHANT, commandIdentity, {
        locationId: LOCATION,
        operatorSessionId: OPERATOR_SESSION,
        refresh,
      }),
    );

  /** The row the database actually holds. Every money claim is read from here. */
  const attemptRow = async (commandIdentity: string) => {
    const { rows } = await pg.tquery<{
      id: string;
      status: string;
      query_only: boolean;
      proof_source: string | null;
      provider: string | null;
      provider_payment_id: string | null;
      provider_status: string | null;
      provider_capture_at: string | null;
      provider_query_count: number;
      amount_minor_units: string;
      tender_draft_id: string | null;
      tender_id: string | null;
    }>(
      MERCHANT,
      `SELECT id::text,status,query_only,proof_source,provider,provider_payment_id,
              provider_status,provider_capture_at::text AS provider_capture_at,
              provider_query_count,amount_minor_units::text AS amount_minor_units,
              tender_draft_id::text AS tender_draft_id,tender_id::text AS tender_id
         FROM merchant.pos_payment_attempt
        WHERE merchant_id=$1::uuid AND command_identity=$2::uuid`,
      [MERCHANT, commandIdentity],
    );
    return rows[0] ?? null;
  };

  /**
   * The audit trail, scoped to ONE entity.
   *
   * The scoping is what makes this suite re-runnable: a second run of the file on the
   * same database would otherwise count the first run's events and fail a `toHaveLength`
   * that is really about a single attempt.
   *
   * That argument needs the entity id to be fresh, and one case here has an entity id
   * that is not: the checkout draft is upserted on `(merchant_id, cart_id)`, so it
   * keeps its id across runs and its audit trail grew by one row per run — 1 event on
   * a fresh database, 4 on the fourth run. Pass the run's own `correlationId` when the
   * entity outlives the run.
   */
  const auditEvents = async (eventType: string, entityId: string, correlationId?: string) => {
    const { rows } = await pg.tquery<{
      event_type: string;
      reason_code: string | null;
      command_id: string;
    }>(
      MERCHANT,
      `SELECT event_type,reason_code,command_id::text AS command_id
         FROM merchant.audit_event
        WHERE merchant_id=$1::uuid AND event_type=$2 AND entity_id=$3::uuid
          AND ($4::text IS NULL OR correlation_id=$4)`,
      [MERCHANT, eventType, entityId, correlationId ?? null],
    );
    return rows;
  };

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN) {
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a DISPOSABLE build-v3 database.',
      );
    }
    pg = new PgService(makeConfig());
    await pg.onModuleInit();

    succeeded = new ScriptedTerminalProvider('scripted_card_terminal', ['succeed']);
    declined = new ScriptedTerminalProvider('scripted_declined', ['decline']);
    silent = new ScriptedTerminalProvider('scripted_silent', ['silent']);
    answersLater = new ScriptedTerminalProvider('scripted_late_answer', ['answer_on_query']);
    withholdsProof = new ScriptedTerminalProvider('scripted_no_proof', [
      'succeed_without_payment_id',
    ]);
    providers = [succeeded, declined, silent, answersLater, withholdsProof];

    const registry = new TenderProviderRegistry(providers);
    tender = new TenderService(
      new TenderRepository(pg, new PosCheckoutRepository(pg)),
      registry,
      new IntegrityService(new IntegrityRepository(pg)),
    );

    // ── The harness's own tenant, till, operator and cart ───────────────────
    await pg.query(
      `INSERT INTO merchant.merchant (id,name,handle) VALUES
         ($1::uuid,'Tender Harness','tender-harness'),
         ($2::uuid,'Vecino Tender','vecino-tender')
       ON CONFLICT (id) DO NOTHING`,
      [MERCHANT, NEIGHBOUR],
    );
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name) VALUES
         ($1::uuid,$3::uuid,'Congreso'),($2::uuid,$4::uuid,'Vecino')
       ON CONFLICT (id) DO NOTHING`,
      [LOCATION, NEIGHBOUR_LOCATION, MERCHANT, NEIGHBOUR],
    );
    await pg.query(
      `INSERT INTO umi."user" (id,full_name) VALUES ($1::uuid,'Cajera')
                    ON CONFLICT (id) DO NOTHING`,
      [USER],
    );
    await pg.query(
      `INSERT INTO runtime.session (id,merchant_id,principal_type,principal_id,token_hash,expires_at)
       VALUES ($1::uuid,$2::uuid,'user',$3::uuid,repeat('a',64),now()+interval '1 day')
       ON CONFLICT (id) DO NOTHING`,
      [SESSION, MERCHANT, USER],
    );
    await pg.query(
      `INSERT INTO merchant.device (id,merchant_id,name,status)
       VALUES ($1::uuid,$2::uuid,'Till 1','active') ON CONFLICT (id) DO NOTHING`,
      [DEVICE, MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.staff (id,merchant_id,user_id,role_id,name)
       SELECT $1::uuid,$2::uuid,$3::uuid,(SELECT id FROM umi.role WHERE key='cashier'),'Cajera'
       ON CONFLICT (id) DO NOTHING`,
      [STAFF, MERCHANT, USER],
    );
    await pg.query(
      `INSERT INTO runtime.operator_session
         (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,
          permissions,entitlements,expires_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
               $8::text[],$9::jsonb,now()+interval '1 day')
       -- DO UPDATE, not DO NOTHING: this database is REUSED across runs, and a
       -- session left behind by an earlier run would keep the permissions that run
       -- granted. Nothing here can then prove anything about a gate: adding the
       -- terminal permission to PERMISSIONS silently did nothing until this became
       -- an upsert, and the settlement route kept refusing.
       ON CONFLICT (id) DO UPDATE SET
         permissions=excluded.permissions,
         entitlements=excluded.entitlements,
         state='active',
         expires_at=excluded.expires_at`,
      [
        OPERATOR_SESSION,
        SESSION,
        USER,
        STAFF,
        DEVICE,
        MERCHANT,
        LOCATION,
        PERMISSIONS,
        ENTITLEMENTS,
      ],
    );
    await pg.query(
      `INSERT INTO merchant.pos_cart
         (id,merchant_id,location_id,operator_session_id,business_date,
          original_operator_session_id,original_operator_user_id,operator_user_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,current_date,$4::uuid,$5::uuid,$5::uuid)
       ON CONFLICT (id) DO NOTHING`,
      [CART, MERCHANT, LOCATION, OPERATOR_SESSION, USER],
    );
  }, 60_000);

  afterAll(async () => {
    // Nothing is deleted: every case makes its own command identity and tender draft, so
    // the unique indexes never collide across runs, and the audit assertions are scoped to
    // the entity they are about. A suite that had to clean up after itself would fail on
    // the first interrupted run instead of explaining itself.
    if (pg) await pg.onModuleDestroy();
  }, 60_000);

  beforeEach(() => {
    for (const provider of providers) {
      provider.reset();
    }
    succeeded.script(['succeed']);
    declined.script(['decline']);
    silent.script(['silent']);
    answersLater.script(['answer_on_query']);
    withholdsProof.script(['succeed_without_payment_id']);
  });

  // ── Sentence 1: a retried payment never charges twice ──────────────────────

  it('charges ONCE when the same command identity is captured twice', async () => {
    const commandIdentity = randomUUID();
    const idempotencyKey = randomUUID();
    const tenderId = randomUUID();

    const first = await capture({ commandIdentity, idempotencyKey, tenderId });
    expect(first.providerCalled).toBe(true);
    expect(first.idempotentReplay).toBe(false);
    expect(first.attempt.state).toBe('succeeded');
    expect(first.attempt.proofSource).toBe('provider');

    // The retry names the SAME command identity. It must not reach the provider.
    const second = await capture({ commandIdentity, idempotencyKey, tenderId });
    expect(second.idempotentReplay).toBe(true);
    expect(second.providerCalled).toBe(false);
    expect(second.attempt.id).toBe(first.attempt.id);
    expect(second.attempt.state).toBe('succeeded');

    // THE COUNT, from the fake that did the talking: one capture, ever.
    expect(succeeded.captureCalls).toEqual([commandIdentity]);
    const row = await attemptRow(commandIdentity);
    expect(row?.provider_capture_at).not.toBeNull();
  });

  it('LOGS every provider call with the five fields §7 item 1 asks for, and no secret', async () => {
    // §7 item 1: "every provider call logs the correlation id, the attempt id, the order id, the
    // status, and the latency. No token, ever." Asserted on the REAL call path — this suite drives
    // the real service through the real registry to a scripted provider — because a log line that
    // only appears in a unit test of the logger would prove nothing about a charge.
    const lines: string[] = [];
    const spy = vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      lines.push(String(message));
    });
    try {
      const commandIdentity = randomUUID();
      await capture({ commandIdentity, idempotencyKey: randomUUID(), tenderId: randomUUID() });
    } finally {
      spy.mockRestore();
    }

    const line = lines.find((entry) => entry.startsWith('tender_provider_call '));
    expect(line).toBeDefined();
    // Every field the plan names, and the outcome an operator reads first.
    expect(line).toMatch(/ op=capture /);
    expect(line).toMatch(/ attempt=[0-9a-f-]{36} /);
    expect(line).toMatch(/ correlation=\S+ /);
    expect(line).toMatch(/ status=\S+ /);
    expect(line).toMatch(/ outcome=\S+ /);
    expect(line).toMatch(/ latencyMs=\d+$/);
    // AND NOTHING THAT LOOKS LIKE CREDENTIAL MATERIAL. The provider here is a scripted fake, so
    // this asserts the SHAPE of the line rather than a redaction: nothing is interpolated into it
    // except ids, a vendor status and a number.
    expect(line).not.toMatch(/Bearer|APP_USR|TG-|accessToken/i);
  });

  it('charges ONCE when the same TENDER DRAFT is captured under a new identity', async () => {
    // A second tab, or an operator who pressed again after the till lost the first
    // response: same money, new command identity. The unique index on the draft is what
    // makes this a replay instead of a second charge.
    const tenderId = randomUUID();
    const first = await capture({ tenderId });
    const second = await capture({ tenderId });

    expect(first.attempt.id).toBe(second.attempt.id);
    expect(succeeded.captureCalls).toHaveLength(1);
    expect(second.providerCalled).toBe(false);
    expect(second.idempotentReplay).toBe(true);
  });

  it('charges once even when two captures RACE for the same draft', async () => {
    const tenderId = randomUUID();
    const [a, b] = await Promise.all([capture({ tenderId }), capture({ tenderId })]);
    expect(a.attempt.id).toBe(b.attempt.id);
    expect(succeeded.captureCalls).toHaveLength(1);
  });

  it('refuses a direct INSERT of a success with no proof, from raw SQL', async () => {
    // The CHECK, not the service: this is what makes the invariant true for a writer that
    // never asked the API — a backfill, a future service, or psql.
    await expect(
      pg.query(
        `INSERT INTO merchant.pos_payment_attempt
           (merchant_id,location_id,cart_id,method,amount_minor_units,currency,status,query_only,correlation_id)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'cash',100,'MXN','succeeded',false,'raw-sql')`,
        [MERCHANT, LOCATION, CART],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it('refuses provider proof with no payment id, from raw SQL', async () => {
    await expect(
      pg.query(
        `INSERT INTO merchant.pos_payment_attempt
           (merchant_id,location_id,cart_id,method,amount_minor_units,currency,status,query_only,
            correlation_id,proof_source)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'external_terminal',100,'MXN','succeeded',false,
                 'raw-sql','provider')`,
        [MERCHANT, LOCATION, CART],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  // ── Sentence 2: a terminal timeout never marks a sale paid ─────────────────

  it('stores a silent terminal as unknown and query-only, never as paid', async () => {
    const commandIdentity = randomUUID();
    const result = await capture({ provider: 'scripted_silent', commandIdentity });

    expect(result.outcome.kind).toBe('unknown');
    expect(result.attempt.state).toBe('unknown');
    expect(result.attempt.queryOnly).toBe(true);
    expect(result.attempt.proofSource).toBeNull();
    // The operator is told what to do, and it is not "take the card again".
    expect(result.ambiguity).toMatchObject({ queryOnly: true, canRetryAsNew: false });

    const row = await attemptRow(commandIdentity);
    expect(row?.status).toBe('unknown');
    expect(row?.query_only).toBe(true);
    expect(row?.proof_source).toBeNull();
    // The terminal's own word for it, kept verbatim.
    expect(row?.provider_status).toBe('action_required');
  });

  it('downgrades a "processed" that arrived without a payment id to unknown', async () => {
    const commandIdentity = randomUUID();
    const result = await capture({ provider: 'scripted_no_proof', commandIdentity });

    // This is the shape that would let a paid sale rest on nothing at all: the provider
    // says yes and gives us nothing to point at.
    expect(result.outcome.kind).toBe('unknown');
    expect(result.attempt.state).toBe('unknown');
    expect(result.attempt.proofSource).toBeNull();
    expect(result.attempt.providerPaymentId).toBeNull();

    const row = await attemptRow(commandIdentity);
    expect(row?.status).toBe('unknown');
    const events = await auditEvents('tender.capture_resolved', result.attempt.id);
    const downgrade = events.find(
      (event) => event.reason_code === 'PROVIDER_SUCCESS_WITHOUT_PAYMENT_ID',
    );
    expect(downgrade).toBeDefined();
  });

  it('resolves the unknown when the provider answers the query, and only then', async () => {
    const commandIdentity = randomUUID();
    const first = await capture({ provider: 'scripted_late_answer', commandIdentity });
    expect(first.attempt.state).toBe('unknown');

    // Reading without asking changes nothing: the obligation is to ASK.
    const read = await askAgain(commandIdentity, false);
    expect(read.providerAsked).toBe(false);
    expect(read.attempt.state).toBe('unknown');
    expect(answersLater.queryCalls).toHaveLength(0);

    const asked = await askAgain(commandIdentity, true);
    expect(asked.providerAsked).toBe(true);
    expect(asked.resolvedNow).toBe(true);
    expect(asked.attempt.state).toBe('succeeded');
    expect(asked.attempt.proofSource).toBe('provider');
    expect(answersLater.queryCalls).toEqual([commandIdentity]);
    // …and the question was asked of the SAME identity that started the attempt.
    expect(answersLater.captureCalls).toEqual([commandIdentity]);
  });

  it('answers a query about an unknown by its command identity, and 404s a stranger', async () => {
    const commandIdentity = randomUUID();
    await capture({ provider: 'scripted_silent', commandIdentity });
    const found = await askAgain(commandIdentity, false);
    expect(found.attempt.commandIdentity).toBe(commandIdentity);

    await expect(askAgain(randomUUID(), false)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps an operator\u2019s assertion out of the attempt, and records it as evidence', async () => {
    const commandIdentity = randomUUID();
    await capture({ provider: 'scripted_silent', commandIdentity });
    const before = await attemptRow(commandIdentity);

    const asserted = await scoped(() =>
      tender.assert(user, MERCHANT, commandIdentity, {
        locationId: LOCATION,
        operatorSessionId: OPERATOR_SESSION,
        assertion: 'customer_reports_paid',
        note: 'Dice que ya le cobraron',
        idempotencyKey: randomUUID(),
      }),
    );

    // `effect: 'none'` is the model saying so, and the row agrees with it.
    expect(asserted.effect).toBe('none');
    expect(asserted.attempt.state).toBe('unknown');
    expect(asserted.attempt.proofSource).toBeNull();
    const after = await attemptRow(commandIdentity);
    expect(after).toEqual(before);

    const events = await auditEvents('tender.operator_asserted', asserted.attempt.id);
    expect(events).toHaveLength(1);
    expect(events[0].reason_code).toBe('customer_reports_paid');
  });

  it('settles an unresolved attempt with the operator\u2019s word, and names the proof', async () => {
    const commandIdentity = randomUUID();
    await capture({ provider: 'scripted_silent', commandIdentity });
    const before = await attemptRow(commandIdentity);
    expect(before.status).toBe('unknown');

    const settled = await scoped(() =>
      tender.settle(user, MERCHANT, commandIdentity, {
        locationId: LOCATION,
        operatorSessionId: OPERATOR_SESSION,
        outcome: 'paid',
        evidence: 'terminal_screen_shows_paid',
        note: 'La terminal mostró aprobado y el cliente se fue con el comprobante',
        idempotencyKey: randomUUID(),
      }),
    );

    // Unlike an assertion, the attempt MOVES. And it says what moved it: a person.
    expect(settled.outcome).toBe('paid');
    expect(settled.proofSource).toBe('operator_attested');
    expect(settled.previousState).toBe('unknown');
    const row = await attemptRow(commandIdentity);
    expect(row.status).toBe('succeeded');
    expect(row.proof_source).toBe('operator_attested');
    // The one thing a human voice cannot manufacture: a provider's payment id.
    expect(row.provider_payment_id).toBeNull();
    // And the provider's own words are left where the provider put them. Settling
    // records a DECISION; it does not rewrite what the terminal said.
    expect(row.provider_status).toBe(before.provider_status);
    expect(row.query_only).toBe(false);

    const events = await auditEvents('tender.operator_settled', settled.attempt.id);
    expect(events).toHaveLength(1);
    expect(events[0].reason_code).toBe('paid');
  });

  it('settles the other way too, so a cart stops being blocked by a payment that never happened', async () => {
    const commandIdentity = randomUUID();
    await capture({ provider: 'scripted_silent', commandIdentity });

    const settled = await scoped(() =>
      tender.settle(user, MERCHANT, commandIdentity, {
        locationId: LOCATION,
        operatorSessionId: OPERATOR_SESSION,
        outcome: 'not_paid',
        evidence: 'terminal_screen_shows_declined',
        note: 'La terminal dijo rechazado',
        idempotencyKey: randomUUID(),
      }),
    );

    expect(settled.outcome).toBe('not_paid');
    const row = await attemptRow(commandIdentity);
    expect(row.status).toBe('declined');
    expect(row.proof_source).toBe('operator_attested');
    expect(row.query_only).toBe(false);
  });

  it('never lets a second settlement rewrite what the first one decided', async () => {
    const commandIdentity = randomUUID();
    await capture({ provider: 'scripted_silent', commandIdentity });
    const settle = (outcome: 'paid' | 'not_paid') =>
      scoped(() =>
        tender.settle(user, MERCHANT, commandIdentity, {
          locationId: LOCATION,
          operatorSessionId: OPERATOR_SESSION,
          outcome,
          evidence: outcome === 'paid' ? 'receipt_shown' : 'terminal_screen_shows_declined',
          note: null,
          idempotencyKey: randomUUID(),
        }),
      );

    await settle('paid');
    // The retry that matters: somebody presses again, or a manager disagrees.
    const second = await settle('not_paid');

    expect(second.outcome).toBe('not_paid');
    expect(second.previousState).toBe('succeeded');
    const row = await attemptRow(commandIdentity);
    // The row still says what the first decision said. A settlement is a decision
    // about an OPEN question; it is not a knob.
    expect(row.status).toBe('succeeded');
    expect(row.proof_source).toBe('operator_attested');
  });

  it('refuses a settlement from an operator who may not confirm a terminal', async () => {
    const commandIdentity = randomUUID();
    await capture({ provider: 'scripted_silent', commandIdentity });
    await pg.query(
      `UPDATE runtime.operator_session SET permissions='{checkout.commit}' WHERE id=$1::uuid`,
      [OPERATOR_SESSION],
    );
    try {
      await expect(
        scoped(() =>
          tender.settle(user, MERCHANT, commandIdentity, {
            locationId: LOCATION,
            operatorSessionId: OPERATOR_SESSION,
            outcome: 'paid',
            evidence: 'customer_reports_paid',
            note: null,
            idempotencyKey: randomUUID(),
          }),
        ),
      ).rejects.toMatchObject({ status: 403 });
      // And the attempt is untouched: a refusal decides nothing.
      expect((await attemptRow(commandIdentity)).status).toBe('unknown');
    } finally {
      await pg.query(
        `UPDATE runtime.operator_session SET permissions=$2::text[] WHERE id=$1::uuid`,
        [OPERATOR_SESSION, PERMISSIONS],
      );
    }
  });

  /**
   * §8G step 4's last piece, from the checkout side: withdrawing a terminal claim
   * the operator has read and found false.
   *
   * Same claim, other copy — the draft's. These live here because the fixtures are
   * the harness's own tenant, till, operator and cart, and because the point of the
   * route is the same sentence the tender cases are about: an operator's word is a
   * decision about an open question, and it is not a provider's proof.
   */
  const checkoutService = () =>
    new PosCheckoutService(
      new PosCheckoutRepository(pg),
      new PosCartRepository(pg),
      new IntegrityService(new IntegrityRepository(pg)),
    );

  /** A draft holding exactly one terminal claim, and its uncommitted fact. */
  const seedTerminalDraft = async (tenderDraftId: string, status: string) => {
    // `pos_checkout_draft` allows ONE draft per cart, and this harness reuses its
    // cart, so the seed converges on whatever is already there rather than
    // inserting a second one. (That is the same constraint the app's upsert is
    // built around.)
    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO merchant.pos_checkout_draft
         (id,merchant_id,location_id,cart_id,operator_session_id,device_id,state,
          tender_drafts,receipt_delivery,recovery_state,version)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,
               'collecting_payment',$7::jsonb,'{"destination":"display","channel":null,"customerContactId":null}'::jsonb,
               'invalid_amount',1)
       ON CONFLICT (merchant_id,cart_id) DO UPDATE SET
         operator_session_id=excluded.operator_session_id,
         device_id=excluded.device_id,
         state=excluded.state,
         tender_drafts=excluded.tender_drafts,
         receipt_delivery=excluded.receipt_delivery,
         recovery_state=excluded.recovery_state,
         updated_at=now()
       RETURNING id::text`,
      [
        randomUUID(),
        MERCHANT,
        LOCATION,
        CART,
        OPERATOR_SESSION,
        DEVICE,
        JSON.stringify([
          {
            id: tenderDraftId,
            type: 'manual_terminal',
            amount: { minorUnits: 5500, currency: 'MXN' },
            amountReceived: null,
            status,
            correlationId: `terminal-${tenderDraftId}`,
          },
        ]),
      ],
    );
    const checkoutId = rows[0].id;
    // One fact per position, and the draft id is reused across runs, so the slot
    // is cleared before it is claimed — the seed is setting a known state, not
    // adding to whatever a previous run left.
    await pg.query(
      `DELETE FROM merchant.pos_tender_fact
        WHERE checkout_id=$1::uuid AND position=0 AND status <> 'committed'`,
      [checkoutId],
    );
    await pg.query(
      `INSERT INTO merchant.pos_tender_fact
         (id,merchant_id,location_id,checkout_id,cart_id,position,tender_type,status,
          amount_minor_units,received_minor_units,change_minor_units,currency,correlation_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,0,'manual_terminal',$6,
               5500,null,0,'MXN',$7)
       ON CONFLICT (id) DO NOTHING`,
      [tenderDraftId, MERCHANT, LOCATION, checkoutId, CART, status, `terminal-${tenderDraftId}`],
    );
    return checkoutId;
  };

  // Read back as the same principal that acted: `pos_checkout_draft` carries a
  // RESTRICTIVE `device_scoping` policy, so `tquery` outside a request scope
  // returns zero rows here even though the worker pool can see the row sitting
  // right there. A read that quietly returns nothing is the failure mode the
  // device scope was added to prevent, so the read declares its device too.
  const draftRow = async (checkoutId: string) =>
    scoped(async () => {
      const { rows } = await pg.tquery<{
        state: string;
        recovery_state: string;
        tender_drafts: unknown[];
      }>(
        MERCHANT,
        `SELECT state,recovery_state,tender_drafts FROM merchant.pos_checkout_draft WHERE id=$1::uuid`,
        [checkoutId],
      );
      return rows[0];
    });

  const tenderFactCount = async (tenderDraftId: string) => {
    const { rows } = await pg.tquery<{ count: string }>(
      MERCHANT,
      `SELECT count(*)::text AS count FROM merchant.pos_tender_fact WHERE id=$1::uuid`,
      [tenderDraftId],
    );
    return Number(rows[0].count);
  };

  it('withdraws a terminal claim the operator has read and found false', async () => {
    const tenderDraftId = randomUUID();
    const checkoutId = await seedTerminalDraft(tenderDraftId, 'confirmed_success');

    const recovered = await scoped(() =>
      checkoutService().recoverTerminalClaim(user, MERCHANT, CART, {
        locationId: LOCATION,
        operatorSessionId: OPERATOR_SESSION,
        tenderDraftId,
        evidence: 'terminal_screen_shows_declined',
        note: 'La terminal dijo rechazado',
        idempotencyKey: randomUUID(),
      }),
    );

    expect(recovered.data.withdrawnTenderDraftId).toBe(tenderDraftId);
    expect(recovered.data.remainingTenderDrafts).toBe(0);
    // Read back from SQL, not from the return value: the claim has LEFT the draft,
    // the draft is usable again, and nothing financial was left behind.
    const draft = await draftRow(checkoutId);
    expect(draft.tender_drafts).toHaveLength(0);
    expect(draft.state).toBe('selecting_tender');
    expect(draft.recovery_state).toBe('none');
    expect(await tenderFactCount(tenderDraftId)).toBe(0);

    // This run's own event, not every withdrawal this draft has ever carried.
    const events = await auditEvents(
      'checkout.terminal_claim_withdrawn',
      checkoutId,
      recovered.data.correlationId,
    );
    expect(events).toHaveLength(1);
    expect(events[0].reason_code).toBe('terminal_screen_shows_declined');
  });

  it('refuses to withdraw a tender it was not pointed at', async () => {
    const tenderDraftId = randomUUID();
    await seedTerminalDraft(tenderDraftId, 'confirmed_success');

    await expect(
      scoped(() =>
        checkoutService().recoverTerminalClaim(user, MERCHANT, CART, {
          locationId: LOCATION,
          operatorSessionId: OPERATOR_SESSION,
          // A different tender. The route clears what it is NAMED, never "whatever
          // is there" — that is the erasure the guards exist to prevent.
          tenderDraftId: randomUUID(),
          evidence: 'terminal_never_used',
          note: null,
          idempotencyKey: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('blocks the cancel while the claim stands, and unblocks it once withdrawn', async () => {
    const tenderDraftId = randomUUID();
    await seedTerminalDraft(tenderDraftId, 'outcome_unknown');
    const service = checkoutService();
    const cancel = () =>
      scoped(() =>
        service.cancel(user, MERCHANT, CART, {
          locationId: LOCATION,
          operatorSessionId: OPERATOR_SESSION,
          reason: 'operator_cancelled',
          checkoutFingerprint: null,
          approvalIds: [],
          idempotencyKey: randomUUID(),
        }),
      );

    // This is the block the route exists for: a cart nobody could pay and nobody
    // could cancel.
    await expect(cancel()).rejects.toMatchObject({ status: 409 });

    await scoped(() =>
      service.recoverTerminalClaim(user, MERCHANT, CART, {
        locationId: LOCATION,
        operatorSessionId: OPERATOR_SESSION,
        tenderDraftId,
        evidence: 'customer_reports_declined',
        note: null,
        idempotencyKey: randomUUID(),
      }),
    );

    // And now the same cancel goes through.
    await expect(cancel()).resolves.toBeTruthy();
  });

  it('survives a provider that throws: a transport failure is an unknown, not a decline', async () => {
    const commandIdentity = randomUUID();
    declined.script(['throw']);
    const result = await capture({ provider: 'scripted_declined', commandIdentity });
    expect(result.outcome.kind).toBe('unknown');
    expect(result.outcome.code).toBe('PROVIDER_TRANSPORT_FAILURE');
    expect(result.attempt.state).toBe('timeout');
    expect(result.attempt.queryOnly).toBe(true);
  });

  it('refuses an unregistered or unavailable provider before an attempt exists', async () => {
    const commandIdentity = randomUUID();
    await expect(capture({ provider: 'conekta', commandIdentity })).rejects.toMatchObject({
      status: 409,
    });
    // Nothing was written: an attempt is only persisted when a provider can be reached.
    expect(await attemptRow(commandIdentity)).toBeNull();
  });

  it('refuses a capture at a location the operator session is not bound to', async () => {
    // The gate that answers first is the AUTHORISATION, not the cart lookup, and that is
    // the right order: an operator session is bound to one location, and a capture is the
    // last place to discover that the caller wandered outside it.
    await expect(
      scoped(
        () =>
          tender.capture(user, MERCHANT, {
            cartId: CART,
            tenderId: randomUUID(),
            locationId: NEIGHBOUR_LOCATION,
            operatorSessionId: OPERATOR_SESSION,
            commandIdentity: randomUUID(),
            provider: 'scripted_card_terminal',
            amount: { minorUnits: 9_000, currency: 'MXN' },
            idempotencyKey: randomUUID(),
          }),
        MERCHANT,
        NEIGHBOUR_LOCATION,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a capture for a cart that does not exist, and writes no attempt', async () => {
    const commandIdentity = randomUUID();
    await expect(capture({ commandIdentity, cartId: randomUUID() })).rejects.toMatchObject({
      status: 404,
    });
    expect(await attemptRow(commandIdentity)).toBeNull();
  });

  it('refuses a cart that is already committed', async () => {
    await pg.query(`UPDATE merchant.pos_cart SET status='committed' WHERE id=$1::uuid`, [CART]);
    try {
      await expect(capture({})).rejects.toMatchObject({ status: 409 });
    } finally {
      await pg.query(`UPDATE merchant.pos_cart SET status='draft' WHERE id=$1::uuid`, [CART]);
    }
  });

  it('refuses an operator session without checkout.commit', async () => {
    await pg.query(`UPDATE runtime.operator_session SET permissions='{}' WHERE id=$1::uuid`, [
      OPERATOR_SESSION,
    ]);
    try {
      await expect(capture({})).rejects.toMatchObject({ status: 403 });
    } finally {
      await pg.query(
        `UPDATE runtime.operator_session SET permissions=$2::text[] WHERE id=$1::uuid`,
        [OPERATOR_SESSION, PERMISSIONS],
      );
    }
  });

  // ── The stateful sequence §8G step 7 asks for ─────────────────────────────

  it('holds every invariant across an arbitrary success/failure/unknown sequence', async () => {
    /**
     * A STATEFUL test, in fast-check's sense: the model below says what each attempt's
     * state SHOULD be after each command, and the run then reads the database and holds
     * the two against each other. The generator picks the order of the four provider
     * behaviours and whether each command is a fresh attempt, a replay of the last
     * identity, or a query of an unresolved one.
     *
     * WHAT IT CATCHES THAT AN EXAMPLE CANNOT. "Never charges twice" is a statement about
     * EVERY history of commands, not about one. A sequence that captures, then replays
     * after a query, then captures the same draft under a new identity, then queries an
     * unknown twice — that is where a claim with a bug in it shows the bug.
     */
    const behaviours = ['succeed', 'decline', 'silent', 'answer_on_query'] as const;
    const providerFor = {
      succeed: succeeded,
      decline: declined,
      silent,
      answer_on_query: answersLater,
    } as const;
    const providerIdFor = {
      succeed: 'scripted_card_terminal',
      decline: 'scripted_declined',
      silent: 'scripted_silent',
      answer_on_query: 'scripted_late_answer',
    } as const;
    const expectedState = {
      succeed: 'succeeded',
      decline: 'declined',
      silent: 'unknown',
      // The question exists to be answered, so the attempt starts unresolved either way.
      answer_on_query: 'unknown',
    } as const;

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...behaviours), { minLength: 1, maxLength: 6 }),
        fc.array(fc.constantFrom('fresh', 'replay', 'query'), { minLength: 1, maxLength: 6 }),
        async (script, actions) => {
          for (const provider of providers) provider.reset();
          const identities: string[] = [];
          const drafts = new Map<string, string>();
          /**
           * WHICH PROVIDER OWNS EACH ATTEMPT.
           *
           * The first version of this test forgot this, and the generator found it: it
           * replayed a silent attempt's identity while naming a DIFFERENT provider, then
           * expected that provider to answer the query. The attempt's provider is the one
           * recorded when it was created — `pos.tenderAttempt` resolves it from the ROW,
           * never from the caller's request — and a test that expects otherwise is
           * asserting something the model deliberately does not do.
           */
          const owner = new Map<string, { id: string; provider: ScriptedTerminalProvider }>();

          for (const [index, behaviour] of script.entries()) {
            const action = actions[index % actions.length];
            const provider = providerFor[behaviour];
            provider.script([behaviour]);

            let commandIdentity: string;
            let tenderId: string;
            if (action === 'replay' && identities.length > 0) {
              commandIdentity = identities[identities.length - 1];
              tenderId = drafts.get(commandIdentity) as string;
              // Re-arm the provider that OWNS the attempt, because it is the one that will
              // be asked if this step queries.
              const existing = owner.get(commandIdentity);
              if (existing) existing.provider.script([behaviour]);
            } else {
              commandIdentity = randomUUID();
              tenderId = randomUUID();
              identities.push(commandIdentity);
              drafts.set(commandIdentity, tenderId);
              owner.set(commandIdentity, { id: providerIdFor[behaviour], provider });
            }

            try {
              // The return value is deliberately not used: every claim below is read back
              // from SQL, so a service that returned the right object while writing the
              // wrong row would still fail this property.
              await capture({
                provider: providerIdFor[behaviour],
                commandIdentity,
                tenderId,
              });
            } catch (error) {
              // The one legitimate refusal: a draft already captured under a DIFFERENT
              // identity must be refused rather than captured again. Anything else is a
              // failure of the property.
              const status = (error as { status?: number }).status;
              expect(status, 'a capture refused for a reason other than the draft guard').toBe(409);
              continue;
            }

            const row = await attemptRow(commandIdentity);
            expect(row).not.toBeNull();

            // INVARIANT A — the row is never a success without a named proof.
            if (row?.status === 'succeeded') {
              expect(row.proof_source).not.toBeNull();
            }
            // INVARIANT B — an unresolved attempt is query-only, always.
            if (row?.status === 'unknown' || row?.status === 'timeout') {
              expect(row.query_only).toBe(true);
              expect(row.proof_source).toBeNull();
            }
            // INVARIANT C — the provider was asked to CAPTURE at most once per identity.
            const capturesForIdentity = provider.captureCalls.filter(
              (call) => call === commandIdentity,
            );
            expect(capturesForIdentity.length).toBeLessThanOrEqual(1);
            // INVARIANT D — the attempt names the provider that created it, whichever
            // provider a later replay happened to name.
            expect(row?.provider).toBe(owner.get(commandIdentity)?.id);

            if (action === 'fresh') {
              expect(row?.status).toBe(expectedState[behaviour]);
            }

            // A query of an unresolved attempt must never invent a success: the answer is
            // the provider's, and when the fake is armed to answer, it is the same answer.
            if (row?.status === 'unknown') {
              const asked = await askAgain(commandIdentity, true);
              const after = await attemptRow(commandIdentity);
              const ownerId = owner.get(commandIdentity)?.id;
              // The late-answering terminal is the only one whose QUERY changes the
              // outcome. The others keep saying what they said, which is the point: a
              // question does not conjure an answer.
              if (ownerId === 'scripted_late_answer') {
                expect(asked.resolvedNow).toBe(true);
                expect(after?.status).toBe('succeeded');
                expect(after?.proof_source).toBe('provider');
                expect(after?.provider_payment_id).not.toBeNull();
              }
              // Whatever it answered, the invariants hold afterwards.
              if (after?.status === 'succeeded') {
                expect(after.proof_source).not.toBeNull();
              }
              if (after?.status === 'unknown' || after?.status === 'timeout') {
                expect(after.query_only).toBe(true);
              }
              // …and asking did not ask for the money again.
              expect(
                owner
                  .get(commandIdentity)!
                  .provider.captureCalls.filter((call) => call === commandIdentity),
              ).toHaveLength(1);
            }
          }
        },
      ),
      { numRuns: 40 },
    );
  }, 120_000);

  it('never lets a provider be asked to capture twice for one attempt, over many runs', async () => {
    const commandIdentity = randomUUID();
    const tenderId = randomUUID();
    await capture({ commandIdentity, tenderId });
    for (let i = 0; i < 5; i += 1) {
      await capture({ commandIdentity, tenderId });
      await capture({ commandIdentity, tenderId: randomUUID() });
    }
    expect(succeeded.captureCalls.filter((call) => call === commandIdentity)).toHaveLength(1);
  });
});
