import { createHash, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Cart, OfflineCommand } from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import type { AuthUser } from '../auth/auth.types';
import { canonicalJson } from '../integrity/canonical-json';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { PosCartRepository } from '../pos-cart/pos-cart.repository';
import { PosCartService } from '../pos-cart/pos-cart.service';
import { PosCashRepository } from '../pos-cash/pos-cash.repository';
import { PosCashService } from '../pos-cash/pos-cash.service';
import { PosCheckoutRepository } from '../pos-checkout/pos-checkout.repository';
import { PosCheckoutService } from '../pos-checkout/pos-checkout.service';
import { PosOfflineRepository } from './pos-offline.repository';
import { PosOfflineService } from './pos-offline.service';

/**
 * WORKSTREAM K · THE ACCEPTANCE SENTENCE, AGAINST THE REAL SCHEMA.
 *
 * §8K's acceptance is one sentence:
 *
 *   "A cash sale made offline lands once after reconnection, and the shift total
 *    matches the ledger."
 *
 * Until this file existed that sentence had NO evidence anywhere in the repository. A
 * grep for it returned the plan, and nothing but the plan: no test asserted it, no
 * comment claimed it. `src/modules/pos-offline/` held `pos-offline.service.spec.ts` and
 * nothing else that ran, and that file drives a hand-written mock of its own repository
 * — so the replay machinery (device sequences, canonical fingerprints, the journal,
 * conflict recording, cash exposure) had never once been driven against PostgreSQL.
 *
 * WHAT IS ASSERTED WHERE, AND WHY IT IS NOT THE SERVICE'S RETURN VALUE.
 *
 *   · "lands ONCE" is a count of ROWS, read back with SQL: one `merchant.customer_order`
 *     for the cart, one `merchant.pos_committed_sale`, one `stock_ledger_entry` of type
 *     `sale_committed`. A service that returned `duplicate` while committing a second
 *     time would satisfy an assertion about its own answer and fail these.
 *   · "the shift total matches the ledger" is the ledger SUMMED IN SQL and compared to
 *     the number the product computes from the same rows (the expression is the one the
 *     caja dashboard uses, quoted below). The sale's contribution is also written out
 *     by hand — 20000 of opening float plus 2500 taken in cash, with 500 handed back —
 *     so the assertion is an amount, not a shape.
 *
 * THE FIXTURE GOES THROUGH THE PRODUCT'S OWN DOORS, because a fixture that hand-writes
 * the rows under test can only prove that the rows are writable:
 *
 *   · the offline POLICY is issued by `PosOfflineService.issuePolicy` — the same call the
 *     till makes at `GET /offline/policy` — and its fingerprint is what the command
 *     carries, so the client half of the policy handshake is exercised rather than
 *     imitated;
 *   · the CART is created, filled and priced by `PosCartService`, so the totals the
 *     snapshot freezes are totals the product produced;
 *   · the SNAPSHOT's `totalsFingerprint` comes from a real `checkout()` preview, which is
 *     exactly where the till gets it (`_submitOffline` reads the server's confirmation);
 *   · the SHIFT is opened by `PosCashService.open`, so its opening float, its business
 *     date and its `ledger_sequence` are the domain's, not this file's;
 *   · the replay itself is `PosOfflineService.batch`, taking the same `ReplayBatch` the
 *     POS's replay engine posts.
 *
 * SELF-SEEDING AND NOT SELF-CLEANING, and the reason is the same one the costing suite
 * gives: `cash_ledger_entry` is append-only and a committed sale is history, so a re-run
 * cannot take its fixture back. Every id below is therefore derived from a per-run
 * prefix, which is what makes a SECOND RUN against the same database green rather than a
 * collision. `tender/point-refund.integration.ts` is the counter-example this file was
 * written to avoid — fixed ids plus `ON CONFLICT DO NOTHING` collide on a unique column
 * that is not the conflict target, and the suite dies on its second run.
 *
 * ONE CONSTRAINT OF THE SCHEMA SHAPES THIS FIXTURE, and it is worth stating because it
 * constrains what a batch can carry. A replayed `pos.checkout.cash` command names a
 * `cartId` that must still exist and still be owned by the replaying operator session
 * (`PosCheckoutRepository.lockCart`), and the platform allows ONE live cart per operator
 * per location (`pos_cart_active_operator_uidx`, plus the `ON CONFLICT` target in
 * `PosCartRepository.create`). So a replay batch can hold at most one UNCOMMITTED cash
 * sale, and several offline sales have to arrive as several batches. The batching and
 * ordering rules themselves are proved here with a mixed batch (one cash sale and one
 * `operational.ack`), which is a command type any device can queue at any time.
 *
 *   DATABASE_URL_APP=$(echo "$DATABASE_URL_APP" | sed 's#/umi_transition_rehearsal_20260901#/umi_courses_verify#') \
 *   DATABASE_URL_WORKER=$(echo "$DATABASE_URL_WORKER" | sed 's#/umi_transition_rehearsal_20260901#/umi_courses_verify#') \
 *     npx vitest run --config vitest.integration.config.ts src/modules/pos-offline/pos-offline.integration.ts
 */

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;

const JWT_SECRET = 'pos-offline-harness-secret-000000000000';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

/**
 * A FRESH SET OF IDS ON EVERY RUN, so the suite is green twice in a row.
 *
 * The `8f` prefix is this file's own — no other harness claims it — and the six hex
 * digits after it are the run's. A fresh MERCHANT is what makes the absolute numbers
 * safe as well as the ids: the shift's ledger holds this run's opening float and this
 * run's sale, and nothing an earlier run left behind can appear in the sum.
 */
const RUN = randomUUID().replace(/-/g, '').slice(0, 6);
const fixtureId = (suffix: number): string =>
  `8f${RUN}-0000-4000-8000-${suffix.toString(16).padStart(12, '0')}`;

const MERCHANT = fixtureId(0xa1);
const LOCATION = fixtureId(0xa2);

const INVENTORY_LOCATION = fixtureId(0xb1);
const STOCK_ITEM = fixtureId(0xb2);
const PRODUCT = fixtureId(0xb3);

/**
 * THE ARITHMETIC, WRITTEN OUT, because every money assertion below is an amount.
 *
 *   one coffee at 2500, tax-inclusive at 0 basis points  → due  2500
 *   the customer pays with a 3000 note                    → received 3000
 *   the drawer hands back                                 → change     500
 *   the shift opened with                                 → float    20000
 *   the drawer must therefore hold                        → expected 22500
 *
 * The tax rate is 0 on purpose: a rate that extracts cents would put a rounding step
 * between the price and the drawer, and the subject here is where money LANDS, not how
 * it is rounded. (Inventory-costing owns the rounding.)
 */
const UNIT_PRICE = 2500;
const AMOUNT_DUE = 2500;
const AMOUNT_RECEIVED = 3000;
const CHANGE_DUE = 500;
const OPENING_FLOAT = 20_000;
const EXPECTED_DRAWER_CASH = OPENING_FLOAT + AMOUNT_DUE;

/** Stock on hand before the sale, posted through `merchant.append_stock_ledger`. */
const OPENING_STOCK = 10;
/** One coffee takes one unit off the shelf, through a `direct` 1:1 mapping. */
const STOCK_AFTER_ONE_SALE = OPENING_STOCK - 1;

const DENOMINATIONS = [
  {
    denomination: { minorUnits: OPENING_FLOAT, currency: 'MXN' },
    quantity: 1,
    lineTotal: { minorUnits: OPENING_FLOAT, currency: 'MXN' },
  },
];

/**
 * The values the till itself stamps on a queued command. `schemaVersion` is the POS's
 * `offlineJournalSchemaVersion`; `contractVersion` is the contract the API reports at
 * `GET /offline/diagnostics`. Neither is validated during replay — `schema_version` only
 * has to be positive and `contract_version` is stored verbatim — and that is stated here
 * rather than implied, because it means a mismatch would NOT be caught by this suite.
 */
const CONTRACT_VERSION = '1.6.0';
const SCHEMA_VERSION = 1;
const CREDENTIAL_VERSION = 1;

/**
 * The permission set the offline till actually needs, read off the gates it has to pass:
 * `offline.replay` (PosOfflineService.authorize), `offline.cash.checkout`
 * (the policy's requiredPermission), `cart.write` (PosCartRepository.authorize),
 * `checkout.commit` (PosCheckoutRepository.authorize) and `cash.shift.open`
 * (PosCashService.authorize). No `*`, so the gates are satisfied exactly.
 */
const PERMISSIONS = [
  'offline.replay',
  'offline.cash.checkout',
  'cart.write',
  'checkout.commit',
  'cash.shift.open',
];

/**
 * Both entitlements, because the two gates read different keys:
 * `pos` for the cart and checkout paths, `pos.offline_cash` for the cash policy.
 */
const ENTITLEMENTS = JSON.stringify([
  { featureKey: 'pos', enabled: true },
  { featureKey: 'pos.offline_cash', enabled: true },
]);

const fingerprintOf = (unsigned: Record<string, unknown>): string =>
  createHash('sha256').update(canonicalJson(unsigned)).digest('hex');

/**
 * One till: the identities a replayed command is scoped to, plus everything that has to
 * exist for its operator to be allowed to move money. Four of these exist, one per
 * scenario, so that each scenario's device sequence starts at zero and no test can
 * disturb another by consuming a sequence number.
 */
type Till = {
  name: string;
  userId: string;
  staffId: string;
  durableSessionId: string;
  operatorSessionId: string;
  deviceId: string;
  registerId: string;
  shiftId: string;
  user: AuthUser;
};

/** A till's identities, declared before its rows exist. */
type TillSpec = {
  name: string;
  userId: string;
  staffId: string;
  durableSessionId: string;
  operatorSessionId: string;
  deviceId: string;
  registerId: string;
  user: AuthUser;
};

function tillSpec(name: string, base: number): TillSpec {
  const userId = fixtureId(base + 1);
  const staffId = fixtureId(base + 2);
  const durableSessionId = fixtureId(base + 3);
  const operatorSessionId = fixtureId(base + 4);
  const deviceId = fixtureId(base + 5);
  return {
    name,
    userId,
    staffId,
    durableSessionId,
    operatorSessionId,
    deviceId,
    registerId: fixtureId(base + 6),
    user: {
      id: userId,
      sessionId: durableSessionId,
      deviceId,
      email: `${name.toLowerCase().replace(/\s+/g, '-')}@offline-harness.test`,
    },
  };
}

/** The till that rings the first sale; the one §8K's sentence is about. */
const TILL_MAIN = tillSpec('Caja principal', 0x1000);
/** The till whose commands must be REFUSED: a bad fingerprint, then a sequence gap. */
const TILL_REFUSED = tillSpec('Caja rechazada', 0x1100);
/** The till that replays a two-command batch. */
const TILL_BATCH = tillSpec('Caja lote', 0x1200);
/** The till whose retry arrives OUT OF ORDER. */
const TILL_OUT_OF_ORDER = tillSpec('Caja desordenada', 0x1300);
/** The till that measures what happens when a SECOND sale is rung before the first syncs. */
const TILL_BOUNDARY = tillSpec('Caja limite', 0x1400);

const TILLS = [TILL_MAIN, TILL_REFUSED, TILL_BATCH, TILL_OUT_OF_ORDER, TILL_BOUNDARY];

/**
 * The merchant's own trading day, read from the same expression the trigger uses
 * (`merchant.tg_business_date`) and the shift opener uses. No test below names a date:
 * a literal would make the suite pass on the day it was written and fail the next
 * morning, which is the defect `inventory-costing.integration.ts` records in its own
 * header.
 */
let BUSINESS_DATE = '1970-01-01';

describe('offline cash replay · §8K, "a cash sale made offline lands once"', () => {
  let pg: PgService;
  let offline: PosOfflineService;
  let checkout: PosCheckoutService;
  let carts: PosCartService;
  let tills: Map<string, Till>;

  /** Every call below happens on the request path, so the RLS GUCs are set. */
  const scoped = <T>(spec: TillSpec | Till, work: () => Promise<T>): Promise<T> =>
    runWithRequestContext(
      {
        merchantId: MERCHANT,
        locationId: LOCATION,
        // Not decoration: `merchant.pos_checkout_draft` carries a RESTRICTIVE device
        // policy, and the offline repository reads its own context from here.
        deviceId: spec.deviceId,
        userId: spec.userId,
        requestId: randomUUID(),
      },
      work,
    );

  const tillOf = (spec: TillSpec | Till): Till => {
    const seeded = tills.get(spec.deviceId);
    if (!seeded) throw new Error(`no seeded till for device ${spec.deviceId}`);
    return seeded;
  };

  /**
   * A single scalar, read through the RLS-CONFINED pool AS THE TILL, device included.
   *
   * The device is not decoration and its absence is silent. `merchant.offline_replay_command`,
   * `merchant.offline_replay_conflict`, `merchant.device_replay_cursor` and
   * `merchant.offline_provisional_mapping` each carry a RESTRICTIVE `device_scoping`
   * policy — `current_device() is not null and device_id = current_device()` — so a read
   * with no device in the context returns ZERO rows while the row sits in the table.
   * Written the other way, this suite reported "the journal is empty" and "nothing was
   * committed" at the same time as a committed sale, which is the tender suite's trap
   * (`pg.service.ts`: every row that passed through here before this line was read with
   * the worker role, which is why nothing had noticed).
   */
  const readOn = async (
    spec: TillSpec | Till,
    sql: string,
    params: unknown[] = [],
  ): Promise<string> => {
    const { rows } = await scoped(spec, () => pg.tquery<{ value: string }>(MERCHANT, sql, params));
    return rows[0].value;
  };

  const countOn = async (
    spec: TillSpec | Till,
    sql: string,
    params: unknown[] = [],
  ): Promise<number> => Number(await readOn(spec, sql, params));

  // ── The fixture ────────────────────────────────────────────────────────────

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN) {
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a DISPOSABLE build-v3 database.',
      );
    }
    pg = new PgService(makeConfig());
    await pg.onModuleInit();

    const integrity = new IntegrityService(new IntegrityRepository(pg));
    const cartRepository = new PosCartRepository(pg);
    // ONE checkout service, handed to the fixture AND to the offline service, so the
    // preview this file runs and the preview the replay runs are the same object.
    checkout = new PosCheckoutService(new PosCheckoutRepository(pg), cartRepository, integrity);
    offline = new PosOfflineService(new PosOfflineRepository(pg), checkout);
    carts = new PosCartService(cartRepository, integrity);
    const cash = new PosCashService(new PosCashRepository(pg), integrity);

    // ── The merchant, its branch, its catalog and its inventory authority ──
    await pg.query(
      `INSERT INTO merchant.merchant (id,name,handle,currency,timezone)
       VALUES ($1::uuid,'Offline Acceptance Harness',$2,'MXN','America/Mexico_City')
       ON CONFLICT (id) DO NOTHING`,
      [MERCHANT, `offline-acceptance-${RUN}`],
    );
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name)
       VALUES ($1::uuid,$2::uuid,'Congreso') ON CONFLICT (id) DO NOTHING`,
      [LOCATION, MERCHANT],
    );
    BUSINESS_DATE = (
      await pg.query<{ value: string }>(
        `SELECT (((now() at time zone b.timezone) - b.business_day_start::interval))::date::text
                AS value
           FROM merchant.merchant b WHERE b.id=$1::uuid`,
        [MERCHANT],
      )
    ).rows[0].value;

    await pg.query(
      `INSERT INTO merchant.product (id,merchant_id,name,price,tax_rate_basis_points,active)
       VALUES ($1::uuid,$2::uuid,'Cafe Americano',$3,0,true) ON CONFLICT (id) DO NOTHING`,
      [PRODUCT, MERCHANT, UNIT_PRICE],
    );

    // A tracked location, one stock item, and a DIRECT 1:1 mapping from the product to
    // it — so a sale posts exactly ONE committed movement and the count is not a
    // coincidence of a recipe that expands to nothing.
    await pg.query(
      `INSERT INTO merchant.inventory_location
         (id,merchant_id,location_id,public_reference,display_name,location_type,active)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'BODEGA','Bodega','stock_room',true)
       ON CONFLICT (id) DO NOTHING`,
      [INVENTORY_LOCATION, MERCHANT, LOCATION],
    );
    await pg.query(
      `INSERT INTO merchant.inventory_item
         (id,merchant_id,public_reference,display_name,item_type,base_unit,quantity_scale,
          tracking_policy,negative_stock_policy,reservation_required,active)
       VALUES ($1::uuid,$2::uuid,'CAFE','Cafe en grano','ingredient','unit',0,
               'tracked','allow_and_flag',true,true)
       ON CONFLICT (id) DO NOTHING`,
      [STOCK_ITEM, MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.inventory_catalog_mapping
         (merchant_id,product_id,mapping_type,inventory_item_id,conversion_numerator,
          conversion_denominator,version,active)
       VALUES ($1::uuid,$2::uuid,'direct',$3::uuid,1,1,1,true)
       ON CONFLICT DO NOTHING`,
      [MERCHANT, PRODUCT, STOCK_ITEM],
    );
    await pg.query(
      `INSERT INTO merchant.inventory_policy
         (merchant_id,location_id,inventory_location_id,version,tracking_enabled,
          maximum_reservation_lines,expires_at,fingerprint)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'offline-harness',true,50,
               now()+interval '1 day',repeat('b',64))
       ON CONFLICT (merchant_id,location_id) DO UPDATE
         SET version=excluded.version,expires_at=excluded.expires_at`,
      [MERCHANT, LOCATION, INVENTORY_LOCATION],
    );
    // ── The offline cash policy, and the cash-shift policy ──
    //
    // Every bound is generous except the ones under test: nothing below is meant to be
    // refused for a limit. `expires_at` is in the future, because the replay re-issues
    // the policy and refuses the command when it has expired.
    await pg.query(
      `INSERT INTO merchant.pos_offline_cash_policy
         (merchant_id,location_id,enabled,version,currency,max_policy_age_seconds,
          max_single_sale_minor_units,max_accumulated_minor_units,max_offline_sale_count,
          max_active_queue_depth,max_command_age_seconds,max_catalog_age_seconds,
          max_pricing_age_seconds,max_tax_age_seconds,allowed_device_classes,
          issued_at,expires_at)
       VALUES ($1::uuid,$2::uuid,true,'offline-harness-1','MXN',3600,
               500000,5000000,50,50,3600,3600,3600,3600,ARRAY['pos_terminal'],
               now(),now()+interval '1 day')
       ON CONFLICT (merchant_id,location_id) DO UPDATE
         SET enabled=true,version=excluded.version,expires_at=excluded.expires_at,
             allowed_device_classes=excluded.allowed_device_classes`,
      [MERCHANT, LOCATION],
    );
    await pg.query(
      `INSERT INTO merchant.cash_shift_policy
         (merchant_id,location_id,currency,version,maximum_opening_float,
          allowed_movement_types,variance_tolerance,expires_at,fingerprint,
          denominations,count_method)
       VALUES ($1::uuid,$2::uuid,'MXN','offline-harness',1000000,'{}',0,
               now()+interval '1 day',repeat('c',64),$3::jsonb,'total_only')
       ON CONFLICT (merchant_id,location_id) DO UPDATE
         SET version=excluded.version,expires_at=excluded.expires_at`,
      [MERCHANT, LOCATION, JSON.stringify(DENOMINATIONS)],
    );

    // ── The four tills ──
    for (const spec of TILLS) {
      await pg.query(
        `INSERT INTO umi."user" (id,full_name) VALUES ($1::uuid,$2)
         ON CONFLICT (id) DO NOTHING`,
        [spec.userId, spec.name],
      );
      await pg.query(
        `INSERT INTO merchant.staff (id,merchant_id,location_id,user_id,role_id,name)
         SELECT $1::uuid,$2::uuid,$3::uuid,$4::uuid,
                (SELECT id FROM umi.role WHERE key='cashier'),$5
         ON CONFLICT (id) DO NOTHING`,
        [spec.staffId, MERCHANT, LOCATION, spec.userId, spec.name],
      );
      await pg.query(
        `INSERT INTO merchant.device (id,merchant_id,location_id,name,kind,status)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'pos_terminal','active')
         ON CONFLICT (id) DO UPDATE SET status='active',revoked_at=null`,
        [spec.deviceId, MERCHANT, LOCATION, spec.name],
      );
      await pg.query(
        `INSERT INTO runtime.session
           (id,merchant_id,principal_type,principal_id,token_hash,expires_at)
         VALUES ($1::uuid,$2::uuid,'user',$3::uuid,md5($1::text||clock_timestamp()::text),
                 now()+interval '2 hours')
         ON CONFLICT (id) DO NOTHING`,
        [spec.durableSessionId, MERCHANT, spec.userId],
      );
      // DO UPDATE, not DO NOTHING: the database is reused across runs, and a session an
      // earlier run left behind would keep that run's permissions.
      await pg.query(
        `INSERT INTO runtime.operator_session
           (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,
            permissions,entitlements,expires_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
                 $8::text[],$9::jsonb,now()+interval '2 hours')
         ON CONFLICT (id) DO UPDATE SET
           durable_session_id=excluded.durable_session_id,user_id=excluded.user_id,
           staff_id=excluded.staff_id,device_id=excluded.device_id,
           merchant_id=excluded.merchant_id,location_id=excluded.location_id,
           permissions=excluded.permissions,entitlements=excluded.entitlements,
           state='active',ended_at=null,expires_at=excluded.expires_at`,
        [
          spec.operatorSessionId,
          spec.durableSessionId,
          spec.userId,
          spec.staffId,
          spec.deviceId,
          MERCHANT,
          LOCATION,
          PERMISSIONS,
          ENTITLEMENTS,
        ],
      );
      await pg.query(
        `INSERT INTO merchant.physical_register
           (id,merchant_id,location_id,display_name,public_reference,currency,active,
            assignment_policy,assigned_device_id,allowed_device_classes,status)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,'MXN',true,'device_required',
                 $6::uuid,ARRAY['pos_terminal'],'available')
         ON CONFLICT (id) DO UPDATE
           SET status='available',current_shift_id=null,active=true`,
        [
          spec.registerId,
          MERCHANT,
          LOCATION,
          spec.name,
          // Unique per till and per run: the register's public reference is unique
          // within a location, and two of these tills have names that share a last
          // letter.
          `OFFLINE-${spec.deviceId.slice(-4)}-${RUN.slice(0, 4)}`,
          spec.deviceId,
        ],
      );
    }

    // The opening balance, posted through the function the receiving path posts through
    // — not an UPDATE of `stock_balance`, which the schema does not grant anyone. It
    // comes after the users, because the ledger names the operator who posted it.
    await pg.runWithMerchant(
      MERCHANT,
      TILL_MAIN.userId,
      (client) =>
        client.query(
          `SELECT merchant.append_stock_ledger(
             $1::uuid,$2::uuid,$3::uuid,$4::uuid,'opening_balance',$5,$6::uuid,$7::uuid,$8,
             'inventory_opening',$6::uuid,$9::uuid,$10::uuid,$11,$12::date,$13,
             null,null,null,null,'{}'::jsonb)`,
          [
            MERCHANT,
            LOCATION,
            INVENTORY_LOCATION,
            STOCK_ITEM,
            OPENING_STOCK,
            randomUUID(),
            randomUUID(),
            fingerprintOf({ openingBalance: OPENING_STOCK, run: RUN }),
            TILL_MAIN.userId,
            TILL_MAIN.deviceId,
            CREDENTIAL_VERSION,
            BUSINESS_DATE,
            `offline-harness-opening-${RUN}`,
          ],
        ),
      LOCATION,
    );

    // The shifts, opened through the product's own door so the business date, the
    // opening-float entry and `ledger_sequence` are the domain's.
    tills = new Map();
    for (const spec of TILLS) {
      const opened = await scoped(spec, () =>
        cash.open(spec.user, MERCHANT, {
          commandId: randomUUID(),
          idempotencyKey: randomUUID(),
          locationId: LOCATION,
          operatorSessionId: spec.operatorSessionId,
          registerId: spec.registerId,
          openingFloat: { minorUnits: OPENING_FLOAT, currency: 'MXN' },
          denominations: DENOMINATIONS,
          businessDate: BUSINESS_DATE,
          note: null,
          expectedRegisterVersion: 1,
        }),
      );
      tills.set(spec.deviceId, { ...spec, shiftId: opened.shift.id });
    }
  }, 120_000);

  afterAll(async () => {
    // Nothing is deleted. `cash_ledger_entry` is append-only, `cash_shift` refuses
    // deletion outright, and a committed sale is history — so the fixture is the run's
    // own merchant and the run's own ids, and a second run simply has its own.
    if (pg) await pg.onModuleDestroy();
  }, 60_000);

  // ── The commands ───────────────────────────────────────────────────────────

  /**
   * A cash sale as the till queues it: a cart it created and priced, the totals the
   * server confirmed, the policy the server issued, and the fingerprint over all of it.
   */
  async function queuedCashSale(
    spec: TillSpec | Till,
    sequence: number,
  ): Promise<{ command: OfflineCommand; cart: Cart }> {
    const till = tillOf(spec);
    const cart = await scoped(till, () =>
      carts.create(till.user, MERCHANT, {
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        idempotencyKey: randomUUID(),
      }),
    );
    const filled = await scoped(till, () =>
      carts.add(till.user, MERCHANT, {
        cartId: cart.id,
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        productId: PRODUCT,
        variantId: null,
        modifierSelections: [],
        quantity: 1,
        courseNumber: 1,
        note: null,
        expectedVersion: cart.version,
        idempotencyKey: randomUUID(),
      }),
    );

    // The policy the till would have fetched, fingerprinted for THIS device — the
    // fingerprint input includes the device id, so a policy minted for another terminal
    // is refused at replay. That is why each till asks for its own.
    const policy = await scoped(till, () =>
      offline.issuePolicy(till.user, MERCHANT, {
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        credentialVersion: CREDENTIAL_VERSION,
      }),
    );

    const commandId = randomUUID();
    const checkoutCommand = {
      commandId,
      cartId: filled.id,
      locationId: LOCATION,
      operatorSessionId: till.operatorSessionId,
      cashShiftId: till.shiftId,
      expectedCartVersion: filled.version,
      paymentMethod: 'cash' as const,
      totalsFingerprint: null,
      idempotencyKey: randomUUID(),
      tenderDrafts: [
        {
          id: randomUUID(),
          type: 'cash' as const,
          amount: { minorUnits: AMOUNT_DUE, currency: 'MXN' },
          amountReceived: { minorUnits: AMOUNT_RECEIVED, currency: 'MXN' },
          status: 'draft' as const,
          correlationId: null,
        },
      ],
      tipDraft: null,
      discountDrafts: [],
      approvalIds: [],
      receiptDelivery: { destination: 'display' as const, channel: null, customerContactId: null },
      customerValue: null,
    };

    // A REAL preview, on a throwaway command identity — exactly what the offline
    // service does before it commits.
    const preview = await scoped(till, () =>
      checkout.checkout(till.user, MERCHANT, {
        ...checkoutCommand,
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
      }),
    );
    if (preview.status !== 'confirmation_required') {
      throw new Error(
        `the fixture could not reach a confirmation_required preview: ${preview.status}` +
          ` (${preview.failure?.code ?? 'no failure code'})`,
      );
    }
    const totals = preview.confirmation;
    const due = totals.totals.grandTotal.minorUnits;
    if (due !== AMOUNT_DUE) {
      throw new Error(
        `the fixture's price arithmetic is wrong: the server says ${due}, this file says ${AMOUNT_DUE}`,
      );
    }

    const at = new Date().toISOString();
    const snapshot = {
      checkoutCommand: { ...checkoutCommand, totalsFingerprint: totals.fingerprint },
      cartSnapshot: filled,
      totals,
      catalogVersion: `catalog-${RUN}`,
      pricingVersion: `pricing-${RUN}`,
      taxVersion: `tax-${RUN}`,
      catalogSnapshotAt: at,
      pricingSnapshotAt: at,
      taxSnapshotAt: at,
      currency: 'MXN',
      amountDueMinorUnits: due,
      amountReceivedMinorUnits: AMOUNT_RECEIVED,
      changeDueMinorUnits: AMOUNT_RECEIVED - due,
      businessDate: filled.totals.businessDate,
    };
    const payload = {
      policyVersion: policy.cash.version,
      policyFingerprint: policy.cash.fingerprint,
      checkoutIdentity: fingerprintOf({
        merchantId: MERCHANT,
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        deviceId: till.deviceId,
        credentialVersion: CREDENTIAL_VERSION,
        cartId: filled.id,
        cartVersion: filled.version,
        totalsFingerprint: totals.fingerprint,
        paymentMethod: 'cash',
      }),
      snapshot,
    };
    const unsigned = {
      commandId,
      provisionalId: randomUUID(),
      deviceId: till.deviceId,
      deviceCredentialVersion: CREDENTIAL_VERSION,
      deviceSequence: sequence,
      merchantId: MERCHANT,
      locationId: LOCATION,
      operatorSessionId: till.operatorSessionId,
      commandType: 'pos.checkout.cash' as const,
      idempotencyKey: randomUUID(),
      contractVersion: CONTRACT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      createdAt: at,
      payload,
    };
    return {
      command: { ...unsigned, fingerprint: fingerprintOf(unsigned) },
      cart: filled,
    };
  }

  /**
   * An `operational.ack`, the second command type the policy allows. It needs no cart,
   * which is what lets a batch hold more than one command at all (see the header).
   */
  function ackCommand(spec: TillSpec | Till, sequence: number): OfflineCommand {
    const until = tillOf(spec);
    const unsigned = {
      commandId: randomUUID(),
      provisionalId: null,
      deviceId: until.deviceId,
      deviceCredentialVersion: CREDENTIAL_VERSION,
      deviceSequence: sequence,
      merchantId: MERCHANT,
      locationId: LOCATION,
      operatorSessionId: until.operatorSessionId,
      commandType: 'operational.ack' as const,
      idempotencyKey: randomUUID(),
      contractVersion: CONTRACT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      payload: { acknowledgement: 'safe' },
    };
    return { ...unsigned, fingerprint: fingerprintOf(unsigned) };
  }

  const replay = (spec: TillSpec | Till, commands: OfflineCommand[]) =>
    scoped(spec, () =>
      offline.batch(tillOf(spec).user, MERCHANT, { replaySessionId: randomUUID(), commands }),
    );

  // ── Row counts, which is what "lands once" has to mean ─────────────────────

  const ordersForCart = (spec: TillSpec | Till, cartId: string) =>
    countOn(
      spec,
      `SELECT count(*)::text AS value FROM merchant.customer_order
        WHERE merchant_id=$1::uuid AND external_ref='pos-cart:'||$2::text`,
      [MERCHANT, cartId],
    );
  const salesForCart = (spec: TillSpec | Till, cartId: string) =>
    countOn(
      spec,
      `SELECT count(*)::text AS value FROM merchant.pos_committed_sale
        WHERE merchant_id=$1::uuid AND cart_id=$2::uuid`,
      [MERCHANT, cartId],
    );
  const committedMovementsForSale = (spec: TillSpec | Till, saleId: string) =>
    countOn(
      spec,
      `SELECT count(*)::text AS value FROM merchant.stock_ledger_entry
        WHERE merchant_id=$1::uuid AND sale_id=$2::uuid AND entry_type='sale_committed'`,
      [MERCHANT, saleId],
    );
  const journalRowsForDevice = (spec: TillSpec | Till, deviceId: string) =>
    countOn(
      spec,
      `SELECT count(*)::text AS value FROM merchant.offline_replay_command
        WHERE merchant_id=$1::uuid AND device_id=$2::uuid`,
      [MERCHANT, deviceId],
    );
  const cursorForDevice = (spec: TillSpec | Till, deviceId: string) =>
    readOn(
      spec,
      `SELECT COALESCE(max(last_accepted_sequence),0)::text AS value
         FROM merchant.device_replay_cursor
        WHERE merchant_id=$1::uuid AND device_id=$2::uuid`,
      [MERCHANT, deviceId],
    );
  const ledgerEntriesForShift = (spec: TillSpec | Till, shiftId: string) =>
    countOn(
      spec,
      `SELECT count(*)::text AS value FROM merchant.cash_ledger_entry
        WHERE merchant_id=$1::uuid AND shift_id=$2::uuid`,
      [MERCHANT, shiftId],
    );

  /**
   * THE LEDGER SUM, IN SQL.
   *
   * This is the expression the caja dashboard uses
   * (`dashboard-operations.repository.ts`: `CASE le.entry_type WHEN 'opening_float' …
   * WHEN 'cash_sale' THEN coalesce(cash_received_minor_units,0)-coalesce(change_given_minor_units,0)
   * …`), name for name, and it is the same set of terms `calculateExpectedCash` folds
   * in `cash-domain.ts`. Written out here rather than called, so the number under test
   * does not come from the code being tested.
   */
  const ledgerSumForShift = (spec: TillSpec | Till, shiftId: string) =>
    readOn(
      spec,
      `SELECT COALESCE(sum(CASE entry_type
                WHEN 'opening_float'     THEN amount_minor_units
                WHEN 'cash_sale'         THEN cash_received_minor_units - change_given_minor_units
                WHEN 'cash_refund'       THEN -amount_minor_units
                WHEN 'paid_in'           THEN amount_minor_units
                WHEN 'paid_out'          THEN -amount_minor_units
                WHEN 'safe_drop'         THEN -amount_minor_units
                WHEN 'drawer_correction' THEN amount_minor_units
                WHEN 'close_adjustment'  THEN amount_minor_units
                ELSE 0 END),0)::text AS value
         FROM merchant.cash_ledger_entry
        WHERE merchant_id=$1::uuid AND shift_id=$2::uuid`,
      [MERCHANT, shiftId],
    );

  /** The product's OWN reading of the same shift, for the two to be compared. */
  const productExpectedCash = (spec: TillSpec | Till, shiftId: string) =>
    scoped(spec, () =>
      pg.runWithMerchant(
        MERCHANT,
        spec.userId,
        (client) => new PosCashRepository(pg).expectedCash(client, shiftId),
        LOCATION,
      ),
    );

  // ── 1. It lands once ───────────────────────────────────────────────────────

  it('lands the offline cash sale ONCE, and answers the reconnected retry from the journal', async () => {
    const till = tillOf(TILL_MAIN);
    const { command, cart } = await queuedCashSale(TILL_MAIN, 1);

    // The reconnection: the device posts its batch.
    const first = await replay(TILL_MAIN, [command]);
    expect(first.stopped).toBe(false);
    expect(first.results).toHaveLength(1);
    expect(first.results[0].status).toBe('accepted');
    expect(first.results[0].serverConflictReference).toBeNull();
    expect(first.cursor.lastAcceptedSequence).toBe(1);
    // The command carried a provisional id and got an official sale back.
    const official = first.results[0].officialCommit;
    expect(official).not.toBeNull();
    expect(official!.provisionalSaleId).toBe(command.provisionalId);
    expect(official!.businessDate).toBe(BUSINESS_DATE);

    // ── THE COUNT, FROM THE DATABASE ──
    expect(await ordersForCart(till, cart.id)).toBe(1);
    expect(await salesForCart(till, cart.id)).toBe(1);
    expect(await committedMovementsForSale(till, official!.officialSaleId)).toBe(1);
    expect(await journalRowsForDevice(till, till.deviceId)).toBe(1);

    // The provisional mapping is what turns a provisional receipt into an official one,
    // and the schema makes it unique in every direction.
    expect(
      await readOn(
        till,
        `SELECT official_sale_id::text AS value FROM merchant.offline_provisional_mapping
          WHERE merchant_id=$1::uuid AND provisional_id=$2::uuid`,
        [MERCHANT, command.provisionalId],
      ),
    ).toBe(official!.officialSaleId);

    // ── THE SAME BATCH AGAIN: the link came back and the device retried ──
    const second = await replay(TILL_MAIN, [command]);
    expect(second.results).toHaveLength(1);
    expect(second.results[0].status).toBe('duplicate');
    expect(second.results[0].failure).toBeNull();
    // Answered with the SAME official ids, which is only possible from the journal.
    expect(second.results[0].officialId).toBe(official!.officialSaleId);
    expect(second.results[0].officialCommit?.officialSaleId).toBe(official!.officialSaleId);
    expect(second.results[0].officialCommit?.officialReceiptNumber).toBe(
      official!.officialReceiptNumber,
    );
    expect(second.cursor.lastAcceptedSequence).toBe(1);

    // Nothing moved: still one order, one sale, one committed movement, one journal row.
    expect(await ordersForCart(till, cart.id)).toBe(1);
    expect(await salesForCart(till, cart.id)).toBe(1);
    expect(await committedMovementsForSale(till, official!.officialSaleId)).toBe(1);
    expect(await journalRowsForDevice(till, till.deviceId)).toBe(1);
    expect(
      await readOn(
        till,
        `SELECT on_hand::text AS value FROM merchant.stock_balance
          WHERE merchant_id=$1::uuid AND inventory_location_id=$2::uuid
            AND inventory_item_id=$3::uuid`,
        [MERCHANT, INVENTORY_LOCATION, STOCK_ITEM],
      ),
    ).toBe(String(STOCK_AFTER_ONE_SALE));
  });

  // ── 2. The shift total matches the ledger ──────────────────────────────────

  it('the shift the offline sale paid into holds exactly what its ledger says', async () => {
    const till = tillOf(TILL_MAIN);

    // The drawer's truth, summed in SQL from the immutable facts.
    expect(await ledgerSumForShift(till, till.shiftId)).toBe(String(EXPECTED_DRAWER_CASH));
    // The product's own reading of the same rows.
    const expected = await productExpectedCash(till, till.shiftId);
    expect(expected.expectedDrawerCash.minorUnits).toBe(EXPECTED_DRAWER_CASH);
    expect(expected.expectedDrawerCash.currency).toBe('MXN');
    expect(expected.openingFloat.minorUnits).toBe(OPENING_FLOAT);
    expect(expected.netCashSales.minorUnits).toBe(AMOUNT_DUE);
    expect(expected.grossCashReceived.minorUnits).toBe(AMOUNT_RECEIVED);
    expect(expected.changeGiven.minorUnits).toBe(CHANGE_DUE);
    expect(expected.ledgerSequence).toBe(2);

    // Two entries, in order, with no gap: the opening float and the one sale.
    expect(await ledgerEntriesForShift(till, till.shiftId)).toBe(2);
    expect(
      await readOn(
        till,
        `SELECT ledger_sequence::text AS value FROM merchant.cash_shift
          WHERE merchant_id=$1::uuid AND id=$2::uuid`,
        [MERCHANT, till.shiftId],
      ),
    ).toBe('2');

    // The sale names the drawer it was paid out of, and the cash fact names the sale.
    expect(
      await readOn(
        till,
        `SELECT count(*)::text AS value FROM merchant.pos_committed_sale
          WHERE merchant_id=$1::uuid AND cash_shift_id=$2::uuid`,
        [MERCHANT, till.shiftId],
      ),
    ).toBe('1');
    expect(
      await readOn(
        till,
        `SELECT (sale_id is not null)::text AS value FROM merchant.cash_ledger_entry
          WHERE merchant_id=$1::uuid AND shift_id=$2::uuid AND entry_type='cash_sale'`,
        [MERCHANT, till.shiftId],
      ),
    ).toBe('true');
  });

  // ── 3. The ordering rules ──────────────────────────────────────────────────

  it('refuses a command whose fingerprint does not match its payload, and commits nothing', async () => {
    const till = tillOf(TILL_REFUSED);
    const { command, cart } = await queuedCashSale(TILL_REFUSED, 1);

    // ONE FIELD IS WRONG, and it is the fingerprint rather than the money: the payload
    // says one policy version while the fingerprint was computed over another.
    // Everything else about this command — the cart, the shift, the totals, the policy
    // it names — is real, which is what makes "nothing was committed" a statement about
    // the fingerprint check rather than about a fixture that could never have worked.
    const payload = command.payload;
    const tampered = {
      ...command,
      payload: { ...payload, policyVersion: `${String(payload.policyVersion)}-tampered` },
    };
    // The service hashes `{...command}` with `fingerprint` removed, so that is what the
    // assertion recomputes — and it disagrees, which is the whole command's defect.
    expect(tampered.fingerprint).not.toBe(
      fingerprintOf(
        Object.fromEntries(Object.entries(tampered).filter(([key]) => key !== 'fingerprint')),
      ),
    );

    const result = await replay(TILL_REFUSED, [tampered]);
    expect(result.stopped).toBe(true);
    expect(result.results[0].status).toBe('conflict');
    expect(result.results[0].failure?.classification).toBe('fingerprint_mismatch');
    expect(result.results[0].failure?.blocksFollowing).toBe(true);
    expect(result.cursor.lastAcceptedSequence).toBe(0);

    // The conflict is recorded where a human will find it, with the sequence on it.
    expect(
      await countOn(
        till,
        `SELECT count(*)::text AS value FROM merchant.offline_replay_conflict
          WHERE merchant_id=$1::uuid AND device_id=$2::uuid
            AND classification='fingerprint_mismatch' AND device_sequence=1
            AND resolution_state='open'`,
        [MERCHANT, till.deviceId],
      ),
    ).toBe(1);

    // NOTHING was committed: the cart has no order, no sale, and the journal is empty
    // (a refusal is not an accepted command).
    expect(await ordersForCart(till, cart.id)).toBe(0);
    expect(await salesForCart(till, cart.id)).toBe(0);
    expect(await journalRowsForDevice(till, till.deviceId)).toBe(0);
    expect(await cursorForDevice(till, till.deviceId)).toBe('0');
  });

  it('refuses a sequence gap, stops the batch, and commits nothing', async () => {
    const till = tillOf(TILL_REFUSED);

    // Sequence 3 while the server has accepted nothing: 1 and 2 are missing, so this
    // command cannot be applied out of order.
    const gap = ackCommand(TILL_REFUSED, 3);
    const result = await replay(TILL_REFUSED, [gap]);
    expect(result.stopped).toBe(true);
    expect(result.results[0].status).toBe('conflict');
    expect(result.results[0].failure?.classification).toBe('sequence_gap');
    expect(result.results[0].failure?.blocksFollowing).toBe(true);
    // The SERVER accepted nothing, and the cursor table is where that is true:
    // `device_replay_cursor.last_accepted_sequence` is still 0 and there is no accepted
    // command to go with it.
    //
    // The cursor IN THIS RESPONSE must agree with it. This used to say 2 — a batch whose
    // FIRST command was refused reported `sorted[0].deviceSequence - 1`, the sequence
    // BELOW the one it had just refused, so a client that read
    // `result.cursor.lastAcceptedSequence` as "the server accepted up to here" would
    // conclude that 1 and 2 were acknowledged and never re-send them. The till never read
    // it (`replay_engine.dart` applies each `ReplayResult` and re-reads
    // `GET /offline/replay/cursor` for the truth), which is why the field was misleading
    // rather than a live data-loss path — but a future client would reasonably trust it.
    // `PosOfflineService.batchLocked` now seeds that reduce with the cursor in force when
    // the batch started, so this reads the same number the table does.
    expect(result.cursor.lastAcceptedSequence).toBe(0);
    expect(result.cursor.lastAcceptedSequence).toBe(
      Number(await cursorForDevice(till, till.deviceId)),
    );

    expect(
      await countOn(
        till,
        `SELECT count(*)::text AS value FROM merchant.offline_replay_conflict
          WHERE merchant_id=$1::uuid AND device_id=$2::uuid
            AND classification='sequence_gap' AND device_sequence=3
            AND resolution_state='open'`,
        [MERCHANT, till.deviceId],
      ),
    ).toBe(1);

    // The whole battery of refusals left this till's journal EMPTY — no command was
    // accepted, so no cursor moved and no sale exists to be counted.
    expect(await journalRowsForDevice(till, till.deviceId)).toBe(0);
    expect(await cursorForDevice(till, till.deviceId)).toBe('0');
    expect(
      await countOn(
        till,
        `SELECT count(*)::text AS value FROM merchant.pos_committed_sale
          WHERE merchant_id=$1::uuid AND cash_shift_id=$2::uuid`,
        [MERCHANT, till.shiftId],
      ),
    ).toBe(0);
    // Its drawer holds only the float, because nothing was taken out of it.
    expect(await ledgerSumForShift(till, till.shiftId)).toBe(String(OPENING_FLOAT));
  });

  // ── 4. One batch, two commands, once each ──────────────────────────────────

  it('lands a two-command batch once, and answers each re-delivered sequence from the journal', async () => {
    const till = tillOf(TILL_BATCH);
    const sale = await queuedCashSale(TILL_BATCH, 1);
    const ack = ackCommand(TILL_BATCH, 2);

    const first = await replay(TILL_BATCH, [sale.command, ack]);
    expect(first.stopped).toBe(false);
    expect(first.results.map((result) => result.status)).toEqual(['accepted', 'accepted']);
    expect(first.results.map((result) => result.deviceSequence)).toEqual([1, 2]);
    expect(first.cursor.lastAcceptedSequence).toBe(2);
    const officialSaleId = first.results[0].officialCommit!.officialSaleId;

    expect(await ordersForCart(till, sale.cart.id)).toBe(1);
    expect(await salesForCart(till, sale.cart.id)).toBe(1);
    expect(await committedMovementsForSale(till, officialSaleId)).toBe(1);
    expect(await journalRowsForDevice(till, till.deviceId)).toBe(2);
    // The second command committed no money, and must not have: an `operational.ack` is
    // the command a device queues precisely so that it has nothing to do with money.
    expect(await ledgerSumForShift(till, till.shiftId)).toBe(String(EXPECTED_DRAWER_CASH));

    // The whole batch again — the ordinary retry — and then JUST the acknowledged
    // sequence, which is what a device does when it cannot tell what got through.
    const again = await replay(TILL_BATCH, [sale.command, ack]);
    expect(again.results.map((result) => result.status)).toEqual(['duplicate', 'duplicate']);
    expect(again.results[0].officialId).toBe(officialSaleId);
    expect(again.cursor.lastAcceptedSequence).toBe(2);

    const justTheAck = await replay(TILL_BATCH, [ack]);
    expect(justTheAck.results.map((result) => result.status)).toEqual(['duplicate']);
    expect(justTheAck.results[0].deviceSequence).toBe(2);
    expect(justTheAck.cursor.lastAcceptedSequence).toBe(2);

    expect(await ordersForCart(till, sale.cart.id)).toBe(1);
    expect(await salesForCart(till, sale.cart.id)).toBe(1);
    expect(await committedMovementsForSale(till, officialSaleId)).toBe(1);
    expect(await journalRowsForDevice(till, till.deviceId)).toBe(2);
  });

  // ── 5. Out of order ────────────────────────────────────────────────────────

  it('commits nothing when a retry arrives out of order, and nothing twice when it arrives again', async () => {
    const till = tillOf(TILL_OUT_OF_ORDER);
    // Queued at the same moment: the sale is sequence 1, the ack is sequence 2. The
    // device lost the first one and re-sent the second.
    const sale = await queuedCashSale(TILL_OUT_OF_ORDER, 1);
    const ack = ackCommand(TILL_OUT_OF_ORDER, 2);

    const outOfOrder = await replay(TILL_OUT_OF_ORDER, [ack]);
    expect(outOfOrder.stopped).toBe(true);
    expect(outOfOrder.results[0].failure?.classification).toBe('sequence_gap');
    // The sale behind the gap was NOT committed, even though its cart exists and its
    // snapshot is frozen and valid.
    expect(await ordersForCart(till, sale.cart.id)).toBe(0);
    expect(await salesForCart(till, sale.cart.id)).toBe(0);
    expect(await journalRowsForDevice(till, till.deviceId)).toBe(0);
    expect(await cursorForDevice(till, till.deviceId)).toBe('0');

    // The missing command arrives. Both are applied, in order, once.
    const ordered = await replay(TILL_OUT_OF_ORDER, [sale.command, ack]);
    expect(ordered.results.map((result) => result.status)).toEqual(['accepted', 'accepted']);
    expect(ordered.cursor.lastAcceptedSequence).toBe(2);
    const officialSaleId = ordered.results[0].officialCommit!.officialSaleId;
    expect(await ordersForCart(till, sale.cart.id)).toBe(1);
    expect(await salesForCart(till, sale.cart.id)).toBe(1);
    expect(await committedMovementsForSale(till, officialSaleId)).toBe(1);
    // The same arithmetic as the first till, on a different register: the drawer holds
    // the float plus the sale, and its ledger says the same thing.
    expect(await ledgerSumForShift(till, till.shiftId)).toBe(String(EXPECTED_DRAWER_CASH));
    expect((await productExpectedCash(till, till.shiftId)).expectedDrawerCash.minorUnits).toBe(
      EXPECTED_DRAWER_CASH,
    );

    // The retry that arrives out of order, again, and then the sale on its own.
    const retry = await replay(TILL_OUT_OF_ORDER, [sale.command, ack]);
    expect(retry.results.map((result) => result.status)).toEqual(['duplicate', 'duplicate']);
    expect(retry.results[0].officialId).toBe(officialSaleId);
    const saleOnly = await replay(TILL_OUT_OF_ORDER, [sale.command]);
    expect(saleOnly.results.map((result) => result.status)).toEqual(['duplicate']);
    expect(saleOnly.results[0].officialId).toBe(officialSaleId);

    // One order, one sale, one committed movement, one journal row each — and the drawer
    // did not move a second time.
    expect(await ordersForCart(till, sale.cart.id)).toBe(1);
    expect(await salesForCart(till, sale.cart.id)).toBe(1);
    expect(await committedMovementsForSale(till, officialSaleId)).toBe(1);
    expect(await journalRowsForDevice(till, till.deviceId)).toBe(2);
    expect(await ledgerEntriesForShift(till, till.shiftId)).toBe(2);
    expect(await ledgerSumForShift(till, till.shiftId)).toBe(String(EXPECTED_DRAWER_CASH));
  });

  // ── 6. The boundary the sentence does not cover ────────────────────────────

  /**
   * THIS IS A MEASUREMENT, NOT A REQUIREMENT, and it is here because it bounds what the
   * acceptance sentence can mean in practice.
   *
   * §8K's acceptance is about ONE offline cash sale landing once, and the five cases
   * above prove it. What they cannot show is how many such sales a till may carry at the
   * same time, because that is decided by the CART, not by the replay: the snapshot freezes
   * a `cartId` and a cart version, and the commit re-reads both.
   *
   * The platform issues ONE live cart per operator per location — `PosCartRepository.create`
   * upserts on `(merchant_id, location_id, operator_user_id)` for every non-terminal cart,
   * and `pos_cart_active_operator_uidx` refuses a second row anyway. So a cashier who rings
   * a second sale before the first has synced is handed the SAME cart back, and the line
   * goes into the cart the queued command already froze.
   *
   * WHAT THIS TEST PINS IS ONLY THE SAFETY PART: the queued sale must NOT commit against a
   * cart that has moved under it. The observations around it — the same cart id, the single
   * cart row, and `price_changed` as the classification — are stated in the comments rather
   * than asserted, because they are how the refusal is worded today and a better-handled
   * cart should not fail this file for improving.
   */
  it('refuses to land a queued sale whose cart moved under it, instead of committing a total nobody agreed to', async () => {
    const till = tillOf(TILL_BOUNDARY);
    const first = await queuedCashSale(TILL_BOUNDARY, 1);

    // The next sale starts: the till asks for a cart, exactly as it does at the start of
    // every sale.
    const second = await scoped(till, () =>
      carts.create(till.user, MERCHANT, {
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        idempotencyKey: randomUUID(),
      }),
    );
    // OBSERVED: the same cart comes back — `create` upserts rather than inserting.
    expect(second.id).toBe(first.cart.id);
    expect(
      await countOn(
        till,
        `SELECT count(*)::text AS value FROM merchant.pos_cart
          WHERE merchant_id=$1::uuid AND operator_session_id=$2::uuid`,
        [MERCHANT, till.operatorSessionId],
      ),
    ).toBe(1);

    // And it is still writable: the second `create` left it in `recovered`, which is one
    // of the lifecycle states the line path accepts (`PosCartRepository.bump`), so the
    // second sale's line goes into the SAME cart — and moves it back to `building_cart`.
    await scoped(till, () =>
      carts.add(till.user, MERCHANT, {
        cartId: second.id,
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        productId: PRODUCT,
        variantId: null,
        modifierSelections: [],
        quantity: 1,
        courseNumber: 1,
        note: null,
        expectedVersion: second.version,
        idempotencyKey: randomUUID(),
      }),
    );
    expect(
      await readOn(
        till,
        `SELECT lifecycle_state AS value FROM merchant.pos_cart
          WHERE merchant_id=$1::uuid AND id=$2::uuid`,
        [MERCHANT, first.cart.id],
      ),
    ).toBe('building_cart');

    // The reconnection arrives. The queued command's snapshot holds the OLD cart version
    // and the OLD totals fingerprint; the server recomputes both and disagrees.
    //
    // HOW THE REFUSAL IS WORDED, AND WHY THAT MATTERS. The stale `expectedCartVersion`
    // makes `lockCart` return nothing and the checkout answers
    // `OPTIMISTIC_VERSION_CONFLICT`. `PosCheckoutService.checkout` raises that as a
    // `ConflictException`, and it used to leave `PosOfflineService.batchLocked` at the
    // preview as an UNHANDLED 409: no `merchant.offline_replay_conflict` row, so the
    // recovery centre — the one place an operator is told what happened to a queued sale
    // — showed nothing at all. It is journalled now, like every other refusal, and the
    // batch stops. This test is the one that made that visible.
    const result = await replay(TILL_BOUNDARY, [first.command]);
    expect(result.stopped).toBe(true);
    expect(result.results[0].status).toBe('conflict');
    expect(result.results[0].failure?.classification).toBe('aggregate_version_conflict');
    expect(result.results[0].failure?.blocksFollowing).toBe(true);

    // Nothing landed: no order, no sale, no journal row, and the drawer still holds only
    // its float.
    expect(await ordersForCart(till, first.cart.id)).toBe(0);
    expect(await salesForCart(till, first.cart.id)).toBe(0);
    expect(await journalRowsForDevice(till, till.deviceId)).toBe(0);
    expect(await ledgerSumForShift(till, till.shiftId)).toBe(String(OPENING_FLOAT));
  });
});
