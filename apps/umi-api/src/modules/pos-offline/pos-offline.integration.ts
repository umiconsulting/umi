import { createHash, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReplayResult, type Cart, type OfflineCommand } from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import type { AuthUser } from '../auth/auth.types';
import { canonicalJson } from '../integrity/canonical-json';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { PosCartRepository } from '../pos-cart/pos-cart.repository';
import { PosCartService } from '../pos-cart/pos-cart.service';
import type { KdsService } from '../kds/kds.service';
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
/** A synthetic ONCA-shaped branch. It deliberately has no offline-cash policy row. */
const ONCA_LOCATION = fixtureId(0xa3);

const INVENTORY_LOCATION = fixtureId(0xb1);
const STOCK_ITEM = fixtureId(0xb2);
const PRODUCT = fixtureId(0xb3);
const ONCA_INVENTORY_LOCATION = fixtureId(0xb4);

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
/** The till that exercises independent account streams. */
const TILL_STREAM = tillSpec('Caja flujos', 0x1500);
/** The till at the ONCA-shaped branch. No policy row exists for this location. */
const TILL_ONCA_DISABLED = tillSpec('Caja ONCA sin politica', 0x1600);
/** The till that replays a cash sale whose cart was cancelled/abandoned. */
const TILL_CANCELLED_CASH = tillSpec('Caja cancelada', 0x1700);
/** The till that replays orphaned cart/cash commands while Cart B is active. */
const TILL_ORPHAN_CART = tillSpec('Caja huerfana', 0x1800);
/** The till that replays a duplicate table assignment under a new session after lock. */
const TILL_TABLE_LOCK = tillSpec('Caja mesa bloqueada', 0x1900);
/** The till that resolves a refused KDS command conflict and reads its terminal outcome. */
const TILL_KDS_CONFLICT = tillSpec('Caja kds conflicto', 0x1a00);

const FLOOR_AREA = fixtureId(0x1940);
const TABLE_ONE = fixtureId(0x1950);
const TABLE_TWO = fixtureId(0x1951);

const TILLS = [
  TILL_MAIN,
  TILL_REFUSED,
  TILL_BATCH,
  TILL_OUT_OF_ORDER,
  TILL_BOUNDARY,
  TILL_STREAM,
  TILL_CANCELLED_CASH,
  TILL_ORPHAN_CART,
  TILL_TABLE_LOCK,
  TILL_KDS_CONFLICT,
];

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
  let offlineRepo: PosOfflineRepository;
  let offline: PosOfflineService;
  let checkout: PosCheckoutService;
  let carts: PosCartService;
  let tills: Map<string, Till>;

  /** Every call below happens on the request path, so the RLS GUCs are set. */
  const scopedAt = <T>(
    locationId: string,
    spec: TillSpec | Till,
    work: () => Promise<T>,
  ): Promise<T> =>
    runWithRequestContext(
      {
        merchantId: MERCHANT,
        locationId,
        // Not decoration: `merchant.pos_checkout_draft` carries a RESTRICTIVE device
        // policy, and the offline repository reads its own context from here.
        deviceId: spec.deviceId,
        userId: spec.userId,
        requestId: randomUUID(),
      },
      work,
    );

  const scoped = <T>(spec: TillSpec | Till, work: () => Promise<T>): Promise<T> =>
    scopedAt(LOCATION, spec, work);

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
  const readOnAt = async (
    locationId: string,
    spec: TillSpec | Till,
    sql: string,
    params: unknown[] = [],
  ): Promise<string> => {
    const { rows } = await scopedAt(locationId, spec, () =>
      pg.tquery<{ value: string }>(MERCHANT, sql, params),
    );
    return rows[0].value;
  };

  const readOn = async (
    spec: TillSpec | Till,
    sql: string,
    params: unknown[] = [],
  ): Promise<string> => readOnAt(LOCATION, spec, sql, params);

  const countOn = async (
    spec: TillSpec | Till,
    sql: string,
    params: unknown[] = [],
  ): Promise<number> => Number(await readOn(spec, sql, params));

  const countOnAt = async (
    locationId: string,
    spec: TillSpec | Till,
    sql: string,
    params: unknown[] = [],
  ): Promise<number> => Number(await readOnAt(locationId, spec, sql, params));

  /** Create the identity, staff, device, session and register of one till. */
  const seedTillRows = async (spec: TillSpec, locationId: string) => {
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
      [spec.staffId, MERCHANT, locationId, spec.userId, spec.name],
    );
    await pg.query(
      `INSERT INTO merchant.device (id,merchant_id,location_id,name,kind,status)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'pos_terminal','active')
       ON CONFLICT (id) DO UPDATE SET status='active',revoked_at=null`,
      [spec.deviceId, MERCHANT, locationId, spec.name],
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
        locationId,
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
        locationId,
        spec.name,
        // Unique per till and per run: the register's public reference is unique
        // within a location, and two of these tills have names that share a last
        // letter.
        `OFFLINE-${spec.deviceId.slice(-4)}-${RUN.slice(0, 4)}`,
        spec.deviceId,
      ],
    );
  };

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
    carts = new PosCartService(cartRepository, integrity);
    offlineRepo = new PosOfflineRepository(pg);
    offline = new PosOfflineService(offlineRepo, checkout, carts, {
      commandForReplay: async () => undefined,
    } as unknown as KdsService);
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
    // The ONCA-shaped branch. The release decision is default-deny: this location
    // receives NO row in `merchant.pos_offline_cash_policy`.
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name)
       VALUES ($1::uuid,$2::uuid,'ONCA') ON CONFLICT (id) DO NOTHING`,
      [ONCA_LOCATION, MERCHANT],
    );
    const floorPlan = {
      schemaVersion: 1,
      areas: [
        {
          id: FLOOR_AREA,
          name: 'Salon',
          width: 720,
          height: 480,
          elements: [
            {
              id: TABLE_ONE,
              label: 'Mesa 1',
              kind: 'table',
              shape: 'square',
              capacity: 4,
              x: 80,
              y: 80,
              width: 100,
              height: 100,
              rotation: 0,
            },
            {
              id: TABLE_TWO,
              label: 'Mesa 2',
              kind: 'table',
              shape: 'square',
              capacity: 4,
              x: 240,
              y: 80,
              width: 100,
              height: 100,
              rotation: 0,
            },
          ],
        },
      ],
    };
    await pg.query(
      `INSERT INTO merchant.floor_plan
         (merchant_id,location_id,version,draft,published_version,published,published_at)
       VALUES ($1::uuid,$2::uuid,1,$3::jsonb,1,$3::jsonb,now())
       ON CONFLICT (merchant_id,location_id) DO NOTHING`,
      [MERCHANT, LOCATION, JSON.stringify(floorPlan)],
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
    await pg.query(
      `INSERT INTO merchant.inventory_location
         (id,merchant_id,location_id,public_reference,display_name,location_type,active)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'ONCA-BODEGA','ONCA Bodega','stock_room',true)
       ON CONFLICT (id) DO NOTHING`,
      [ONCA_INVENTORY_LOCATION, MERCHANT, ONCA_LOCATION],
    );
    await pg.query(
      `INSERT INTO merchant.inventory_policy
         (merchant_id,location_id,inventory_location_id,version,tracking_enabled,
          maximum_reservation_lines,expires_at,fingerprint)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'offline-harness',true,50,
               now()+interval '1 day',repeat('b',64))
       ON CONFLICT (merchant_id,location_id) DO UPDATE
         SET version=excluded.version,expires_at=excluded.expires_at`,
      [MERCHANT, ONCA_LOCATION, ONCA_INVENTORY_LOCATION],
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
    // The ONCA branch has a cash-shift policy so its shift can open. It still has
    // no offline-cash policy, which is the condition under test.
    await pg.query(
      `INSERT INTO merchant.cash_shift_policy
         (merchant_id,location_id,currency,version,maximum_opening_float,
          allowed_movement_types,variance_tolerance,expires_at,fingerprint,
          denominations,count_method)
       VALUES ($1::uuid,$2::uuid,'MXN','offline-harness',1000000,'{}',0,
               now()+interval '1 day',repeat('c',64),$3::jsonb,'total_only')
       ON CONFLICT (merchant_id,location_id) DO UPDATE
         SET version=excluded.version,expires_at=excluded.expires_at`,
      [MERCHANT, ONCA_LOCATION, JSON.stringify(DENOMINATIONS)],
    );

    // ── The tills ──
    for (const spec of TILLS) {
      await seedTillRows(spec, LOCATION);
    }
    await seedTillRows(TILL_ONCA_DISABLED, ONCA_LOCATION);

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
    const oncaOpened = await scopedAt(ONCA_LOCATION, TILL_ONCA_DISABLED, () =>
      cash.open(TILL_ONCA_DISABLED.user, MERCHANT, {
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
        locationId: ONCA_LOCATION,
        operatorSessionId: TILL_ONCA_DISABLED.operatorSessionId,
        registerId: TILL_ONCA_DISABLED.registerId,
        openingFloat: { minorUnits: OPENING_FLOAT, currency: 'MXN' },
        denominations: DENOMINATIONS,
        businessDate: BUSINESS_DATE,
        note: null,
        expectedRegisterVersion: 1,
      }),
    );
    tills.set(TILL_ONCA_DISABLED.deviceId, {
      ...TILL_ONCA_DISABLED,
      shiftId: oncaOpened.shift.id,
    });
  }, 120_000);

  afterAll(async () => {
    // Clean up post-043 command_type rows created by this fixture so CI's migration
    // re-apply gate (which re-runs 043_local_first_order_replay.sql before 046) does
    // not fail its temporary CHECK constraint check on leftover test rows.
    if (process.env.DATABASE_URL_ADMIN) {
      const admin = new Client({ connectionString: process.env.DATABASE_URL_ADMIN });
      await admin.connect();
      try {
        await admin.query(
          `SELECT merchant.with_append_only_writable(
             'merchant.offline_replay_command',
             format(
               'DELETE FROM merchant.offline_replay_command WHERE merchant_id = %L::uuid AND command_type NOT IN (%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
               $1::text,
               'operational.ack',
               'pos.checkout.cash',
               'pos.cart.open',
               'pos.cart.line.add',
               'pos.cart.line.update',
               'pos.cart.line.remove',
               'pos.cart.clear',
               'pos.cart.prepare',
               'pos.cart.fire',
               'pos.cart.fulfillment.set'
             )
           )`,
          [MERCHANT],
        );
      } finally {
        await admin.end();
      }
    }
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
    locationId: string = LOCATION,
  ): Promise<{ command: OfflineCommand; cart: Cart }> {
    const till = tillOf(spec);
    const cart = await scopedAt(locationId, till, () =>
      carts.create(till.user, MERCHANT, {
        locationId,
        operatorSessionId: till.operatorSessionId,
        idempotencyKey: randomUUID(),
      }),
    );
    const filled = await scopedAt(locationId, till, () =>
      carts.add(till.user, MERCHANT, {
        cartId: cart.id,
        locationId,
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
    const policy = await scopedAt(locationId, till, () =>
      offline.issuePolicy(till.user, MERCHANT, {
        locationId,
        operatorSessionId: till.operatorSessionId,
        credentialVersion: CREDENTIAL_VERSION,
      }),
    );

    const commandId = randomUUID();
    const checkoutCommand = {
      commandId,
      cartId: filled.id,
      locationId,
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
    const preview = await scopedAt(locationId, till, () =>
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
        locationId,
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
      locationId,
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

  function tableAccountGroup(
    spec: TillSpec | Till,
    sequence: number,
    provisionalCartId: string,
    tableId: string,
  ): OfflineCommand {
    const until = tillOf(spec);
    const idempotencyKey = randomUUID();
    const unsigned = {
      commandId: randomUUID(),
      provisionalId: provisionalCartId,
      deviceId: until.deviceId,
      deviceCredentialVersion: CREDENTIAL_VERSION,
      deviceSequence: sequence,
      merchantId: MERCHANT,
      locationId: LOCATION,
      operatorSessionId: until.operatorSessionId,
      commandType: 'pos.command.group' as const,
      idempotencyKey,
      contractVersion: CONTRACT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      payload: {
        groupId: idempotencyKey,
        aggregateKeys: [`account:${provisionalCartId}`, `table:${tableId}`],
        effects: [
          {
            type: 'open_table_account',
            provisionalCartId,
            tableId,
            partySize: 2,
          },
        ],
      },
    };
    return { ...unsigned, fingerprint: fingerprintOf(unsigned) };
  }

  const replayAt = (locationId: string, spec: TillSpec | Till, commands: OfflineCommand[]) =>
    scopedAt(locationId, spec, () =>
      offline.batch(tillOf(spec).user, MERCHANT, { replaySessionId: randomUUID(), commands }),
    );

  const replay = (spec: TillSpec | Till, commands: OfflineCommand[]) =>
    replayAt(LOCATION, spec, commands);

  // ── Row counts, which is what "lands once" has to mean ─────────────────────

  const ordersForCartAt = (locationId: string, spec: TillSpec | Till, cartId: string) =>
    countOnAt(
      locationId,
      spec,
      `SELECT count(*)::text AS value FROM merchant.customer_order
        WHERE merchant_id=$1::uuid AND external_ref='pos-cart:'||$2::text`,
      [MERCHANT, cartId],
    );
  const ordersForCart = (spec: TillSpec | Till, cartId: string) =>
    ordersForCartAt(LOCATION, spec, cartId);
  const salesForCartAt = (locationId: string, spec: TillSpec | Till, cartId: string) =>
    countOnAt(
      locationId,
      spec,
      `SELECT count(*)::text AS value FROM merchant.pos_committed_sale
        WHERE merchant_id=$1::uuid AND cart_id=$2::uuid`,
      [MERCHANT, cartId],
    );
  const salesForCart = (spec: TillSpec | Till, cartId: string) =>
    salesForCartAt(LOCATION, spec, cartId);
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

  it('keeps independent account streams moving after refusals', async () => {
    const till = tillOf(TILL_STREAM);
    const accountA = randomUUID();
    const accountB = randomUUID();
    const groupA = tableAccountGroup(TILL_STREAM, 1, accountA, randomUUID());
    const groupB = tableAccountGroup(TILL_STREAM, 2, accountB, randomUUID());
    const groupAgainA = tableAccountGroup(TILL_STREAM, 3, accountA, randomUUID());
    const ack = ackCommand(TILL_STREAM, 4);

    const result = await replay(TILL_STREAM, [groupA, groupB, groupAgainA, ack]);

    expect(result.stopped).toBe(false);
    expect(result.results.map((item) => item.status)).toEqual([
      'conflict',
      'conflict',
      'conflict',
      'accepted',
    ]);
    expect(result.results.map((item) => item.failure?.classification ?? null)).toEqual([
      'table_unavailable',
      'table_unavailable',
      'stream_blocked',
      null,
    ]);
    expect(result.results[2].failure).toMatchObject({
      retryable: true,
      blocksFollowing: false,
    });
    expect(result.cursor).toMatchObject({
      lastAcceptedSequence: 4,
      lastProcessedSequence: 4,
    });
    expect(await journalRowsForDevice(till, till.deviceId)).toBe(1);
    expect(
      await readOn(
        till,
        `SELECT string_agg(classification,',' ORDER BY device_sequence) AS value
         FROM merchant.offline_replay_conflict
         WHERE merchant_id=$1::uuid AND device_id=$2::uuid`,
        [MERCHANT, till.deviceId],
      ),
    ).toBe('table_unavailable,table_unavailable,stream_blocked');
    expect(
      await readOn(
        till,
        `SELECT last_accepted_sequence::text||':'||last_processed_sequence::text AS value
         FROM merchant.device_replay_cursor
         WHERE device_id=$1::uuid AND credential_version=$2`,
        [till.deviceId, CREDENTIAL_VERSION],
      ),
    ).toBe('4:4');

    const resolved = await scoped(till, () =>
      offline.resolveConflict(
        till.user,
        MERCHANT,
        {
          locationId: LOCATION,
          operatorSessionId: till.operatorSessionId,
          credentialVersion: CREDENTIAL_VERSION,
        },
        groupA.commandId,
      ),
    );
    expect(resolved.resolved).toBe(true);
    expect(
      await readOn(
        till,
        `SELECT count(*)::text AS value
         FROM merchant.offline_replay_conflict
         WHERE merchant_id=$1::uuid AND device_id=$2::uuid
           AND stream_key=$3 AND resolution_state <> 'resolved'`,
        [MERCHANT, till.deviceId, `account:${accountA}`],
      ),
    ).toBe('0');
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
   * The platform issues ONE live cart per operator per location. Explicitly opening
   * another account parks the current cart first, then creates a distinct live cart;
   * `pos_cart_active_operator_uidx` still refuses two simultaneous live carts.
   *
   * WHAT THIS TEST PINS IS ONLY THE SAFETY PART: the queued sale must NOT commit against a
   * different live account. The observations around it — the new cart id, the parked prior
   * cart and `aggregate_version_conflict` as the classification — are the refusal the
   * recovery centre needs to explain.
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
    // The queued account already has a line, so opening another account parks it
    // and the next sale gets a distinct cart.
    expect(second.id).not.toBe(first.cart.id);
    expect(
      await countOn(
        till,
        `SELECT count(*)::text AS value FROM merchant.pos_cart
          WHERE merchant_id=$1::uuid AND operator_session_id=$2::uuid
            AND lifecycle_state IN ('building_cart','ready_for_checkout','recovered')`,
        [MERCHANT, till.operatorSessionId],
      ),
    ).toBe(1);

    // The queued account remains resumable but is no longer the live cart. The
    // second sale's line belongs to the distinct cart returned above.
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
    ).toBe('suspended');

    // The reconnection arrives. Its snapshot names the account that was parked when
    // the next sale began, so it cannot land against a different live cart.
    //
    // HOW THE REFUSAL IS WORDED, AND WHY THAT MATTERS. The stale `expectedCartVersion`
    // makes `lockCart` return nothing and the checkout answers
    // `OPTIMISTIC_VERSION_CONFLICT`. `PosCheckoutService.checkout` raises that as a
    // `ConflictException`, and it used to leave `PosOfflineService.batchLocked` at the
    // preview as an UNHANDLED 409: no `merchant.offline_replay_conflict` row, so the
    // recovery centre — the one place an operator is told what happened to a queued sale
    // — showed nothing at all. It is journalled now, like every other refusal. The
    // command's account stream stops; unrelated account streams can continue.
    const result = await replay(TILL_BOUNDARY, [first.command]);
    expect(result.stopped).toBe(false);
    expect(result.results[0].status).toBe('conflict');
    expect(result.results[0].failure?.classification).toBe('aggregate_version_conflict');
    expect(result.results[0].failure?.blocksFollowing).toBe(false);
    expect(result.cursor).toMatchObject({
      lastAcceptedSequence: 0,
      lastProcessedSequence: 1,
    });

    // Nothing landed: no order, no sale, no journal row, and the drawer still holds only
    // its float.
    expect(await ordersForCart(till, first.cart.id)).toBe(0);
    expect(await salesForCart(till, first.cart.id)).toBe(0);
    expect(await journalRowsForDevice(till, till.deviceId)).toBe(0);
    expect(await ledgerSumForShift(till, till.shiftId)).toBe(String(OPENING_FLOAT));
  });

  it('refuses offline cash at an ONCA-shaped location without a policy', async () => {
    const till = tillOf(TILL_ONCA_DISABLED);
    expect(
      await countOnAt(
        ONCA_LOCATION,
        till,
        `SELECT count(*)::text AS value FROM merchant.pos_offline_cash_policy
          WHERE merchant_id=$1::uuid AND location_id=$2::uuid`,
        [MERCHANT, ONCA_LOCATION],
      ),
    ).toBe(0);

    const { command, cart } = await queuedCashSale(TILL_ONCA_DISABLED, 1, ONCA_LOCATION);
    const issued = await scopedAt(ONCA_LOCATION, till, () =>
      offline.issuePolicy(till.user, MERCHANT, {
        locationId: ONCA_LOCATION,
        operatorSessionId: till.operatorSessionId,
        credentialVersion: CREDENTIAL_VERSION,
      }),
    );
    expect(issued.cash.enabled).toBe(false);
    expect(issued.cash.version).toBe('default-deny');

    const result = await replayAt(ONCA_LOCATION, TILL_ONCA_DISABLED, [command]);
    expect(result.stopped).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe('conflict');
    // The disabled policy does not list `pos.checkout.cash` as an allowed
    // command type, so the default-deny answer arrives before the cash gate.
    expect(result.results[0].failure?.classification).toBe('unsupported_offline_command');
    expect(result.results[0].failure?.blocksFollowing).toBe(true);

    // The refusal must not commit anything: no order, no sale, and no money entry
    // beyond the shift's opening float.
    expect(await ordersForCartAt(ONCA_LOCATION, till, cart.id)).toBe(0);
    expect(await salesForCartAt(ONCA_LOCATION, till, cart.id)).toBe(0);
    expect(
      await countOnAt(
        ONCA_LOCATION,
        till,
        `SELECT count(*)::text AS value FROM merchant.cash_ledger_entry
          WHERE merchant_id=$1::uuid AND shift_id=$2::uuid`,
        [MERCHANT, till.shiftId],
      ),
    ).toBe(1);
  });

  // ── 7. P0 financial integrity, cart isolation, post-lock table recovery, KDS discard ──

  it('records a manager-action financial conflict instead of silently accepting cash replay on a cancelled cart', async () => {
    const till = tillOf(TILL_CANCELLED_CASH);
    const { command, cart } = await queuedCashSale(TILL_CANCELLED_CASH, 1);
    const ack = ackCommand(TILL_CANCELLED_CASH, 2);

    // The account is cancelled/abandoned on the server before the till reconnects.
    await pg.query(
      `UPDATE merchant.pos_cart
          SET status='abandoned', lifecycle_state='cancelled', updated_at=clock_timestamp()
        WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [MERCHANT, cart.id],
    );

    const batch = await replay(TILL_CANCELLED_CASH, [command, ack]);
    expect(batch.stopped).toBe(false);
    expect(batch.results).toHaveLength(2);

    const cashResult = ReplayResult.parse(batch.results[0]);
    expect(cashResult.status).toBe('conflict');
    expect(cashResult.officialCommit).toBeNull();
    expect(cashResult.serverConflictReference).toBeTruthy();
    expect(cashResult.failure).toMatchObject({
      classification: 'reconciliation_required',
      retryable: false,
      blocksFollowing: false,
      operatorActionRequired: true,
      managerActionRequired: true,
      guidanceCode: 'cart_cancelled_after_cash_taken',
    });
    // Unrelated stream in the same batch must keep flowing.
    expect(batch.results[1].status).toBe('accepted');

    // Persisted conflict row in PostgreSQL with manager_action_required = true.
    expect(
      await readOn(
        till,
        `SELECT classification||':'||guidance_code||':'||
                operator_action_required::text||':'||manager_action_required::text||':'||
                blocks_following::text||':'||resolution_state AS value
           FROM merchant.offline_replay_conflict
          WHERE merchant_id=$1::uuid AND device_id=$2::uuid AND command_id=$3::uuid`,
        [MERCHANT, till.deviceId, command.commandId],
      ),
    ).toBe('reconciliation_required:cart_cancelled_after_cash_taken:true:true:false:open');

    // Zero silent no-op settlement: no journal command row, no sale, no order, no cash ledger row.
    expect(
      await countOn(
        till,
        `SELECT count(*)::text AS value FROM merchant.offline_replay_command
          WHERE merchant_id=$1::uuid AND device_id=$2::uuid AND command_id=$3::uuid`,
        [MERCHANT, till.deviceId, command.commandId],
      ),
    ).toBe(0);
    expect(await ordersForCart(till, cart.id)).toBe(0);
    expect(await salesForCart(till, cart.id)).toBe(0);
    expect(await ledgerSumForShift(till, till.shiftId)).toBe(String(OPENING_FLOAT));

    // A financial conflict must remain protected from operator discard.
    await expect(
      scoped(till, () =>
        offline.resolveConflict(
          till.user,
          MERCHANT,
          {
            locationId: LOCATION,
            operatorSessionId: till.operatorSessionId,
            credentialVersion: CREDENTIAL_VERSION,
          },
          command.commandId,
        ),
      ),
    ).rejects.toMatchObject({ response: { code: 'CONFLICT_NOT_RESOLVABLE' } });
  });

  it('records conflicts for orphaned cart/cash commands and leaves unrelated active Cart B untouched', async () => {
    const till = tillOf(TILL_ORPHAN_CART);
    // Build a valid cash sale command first, then retarget it to an unknown ghost cart id.
    const template = await queuedCashSale(TILL_ORPHAN_CART, 2);
    // Park/abandon the template cart so Cart B is the operator's sole active cart.
    await pg.query(
      `UPDATE merchant.pos_cart
          SET status='abandoned', lifecycle_state='cancelled', updated_at=clock_timestamp()
        WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [MERCHANT, template.cart.id],
    );

    // Operator opens Cart B online and adds one coffee.
    const cartBCreated = await scoped(till, () =>
      carts.create(till.user, MERCHANT, {
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        idempotencyKey: randomUUID(),
      }),
    );
    const cartB = await scoped(till, () =>
      carts.add(till.user, MERCHANT, {
        cartId: cartBCreated.id,
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        productId: PRODUCT,
        variantId: null,
        modifierSelections: [],
        quantity: 1,
        courseNumber: 1,
        note: null,
        expectedVersion: cartBCreated.version,
        idempotencyKey: randomUUID(),
      }),
    );
    const cartBVersionBefore = await readOn(
      till,
      `SELECT version::text AS value FROM merchant.pos_cart
        WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [MERCHANT, cartB.id],
    );
    const cartBItemsBefore = await countOn(
      till,
      `SELECT COALESCE(sum(quantity),0)::text AS value FROM merchant.pos_cart_line
        WHERE cart_id=$1::uuid`,
      [cartB.id],
    );
    expect(cartBItemsBefore).toBe(1);

    const ghostCartForLine = randomUUID();
    const ghostCartForCash = randomUUID();
    const orphanLineUnsigned = {
      commandId: randomUUID(),
      provisionalId: null,
      deviceId: till.deviceId,
      deviceCredentialVersion: CREDENTIAL_VERSION,
      deviceSequence: 1,
      merchantId: MERCHANT,
      locationId: LOCATION,
      operatorSessionId: till.operatorSessionId,
      commandType: 'pos.cart.line.add' as const,
      idempotencyKey: randomUUID(),
      contractVersion: CONTRACT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      payload: {
        cartId: ghostCartForLine,
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        productId: PRODUCT,
        variantId: null,
        modifierSelections: [],
        quantity: 3,
        courseNumber: 1,
        note: 'orphan-line',
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
      },
    };
    const orphanLineAdd: OfflineCommand = {
      ...orphanLineUnsigned,
      fingerprint: fingerprintOf(orphanLineUnsigned),
    };

    const rawTemplatePayload = template.command.payload as {
      policyVersion: string;
      policyFingerprint: string;
      checkoutIdentity: string;
      snapshot: {
        checkoutCommand: Record<string, unknown>;
        cartSnapshot: Record<string, unknown>;
        [key: string]: unknown;
      };
    };
    const orphanCashUnsigned = {
      commandId: randomUUID(),
      provisionalId: randomUUID(),
      deviceId: till.deviceId,
      deviceCredentialVersion: CREDENTIAL_VERSION,
      deviceSequence: 2,
      merchantId: MERCHANT,
      locationId: LOCATION,
      operatorSessionId: till.operatorSessionId,
      commandType: 'pos.checkout.cash' as const,
      idempotencyKey: randomUUID(),
      contractVersion: CONTRACT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      createdAt: template.command.createdAt,
      payload: {
        ...rawTemplatePayload,
        snapshot: {
          ...rawTemplatePayload.snapshot,
          checkoutCommand: {
            ...rawTemplatePayload.snapshot.checkoutCommand,
            cartId: ghostCartForCash,
          },
          cartSnapshot: {
            ...rawTemplatePayload.snapshot.cartSnapshot,
            id: ghostCartForCash,
          },
        },
      },
    };
    const orphanCash: OfflineCommand = {
      ...orphanCashUnsigned,
      fingerprint: fingerprintOf(orphanCashUnsigned),
    };

    const result = await replay(TILL_ORPHAN_CART, [orphanLineAdd, orphanCash]);
    expect(result.stopped).toBe(false);
    expect(result.results).toHaveLength(2);

    const lineResult = ReplayResult.parse(result.results[0]);
    expect(lineResult.status).toBe('conflict');
    expect(lineResult.failure).toMatchObject({
      classification: 'cart_mismatch',
      guidanceCode: 'cart_not_found',
      blocksFollowing: false,
    });

    const cashResult = ReplayResult.parse(result.results[1]);
    expect(cashResult.status).toBe('conflict');
    expect(cashResult.failure).toMatchObject({
      classification: 'cart_mismatch',
      guidanceCode: 'cart_not_found',
      blocksFollowing: false,
      managerActionRequired: true,
    });

    // Both orphaned commands recorded conflicts and zero accepted journal rows.
    expect(
      await countOn(
        till,
        `SELECT count(*)::text AS value FROM merchant.offline_replay_conflict
          WHERE merchant_id=$1::uuid AND device_id=$2::uuid
            AND classification='cart_mismatch' AND guidance_code='cart_not_found'
            AND resolution_state='open'`,
        [MERCHANT, till.deviceId],
      ),
    ).toBe(2);
    expect(await journalRowsForDevice(till, till.deviceId)).toBe(0);

    // Cart B is completely untouched in PostgreSQL (same version, same item count, 0 sales).
    expect(
      await readOn(
        till,
        `SELECT version::text AS value FROM merchant.pos_cart
          WHERE merchant_id=$1::uuid AND id=$2::uuid`,
        [MERCHANT, cartB.id],
      ),
    ).toBe(cartBVersionBefore);
    expect(
      await countOn(
        till,
        `SELECT COALESCE(sum(quantity),0)::text AS value FROM merchant.pos_cart_line
          WHERE cart_id=$1::uuid`,
        [cartB.id],
      ),
    ).toBe(cartBItemsBefore);
    expect(await salesForCart(till, cartB.id)).toBe(0);
    expect(await ledgerSumForShift(till, till.shiftId)).toBe(String(OPENING_FLOAT));
  });

  it('replays duplicate pos.cart.table.set under a new operatorSessionId after lock without 401/403', async () => {
    const till = tillOf(TILL_TABLE_LOCK);
    // Open a cart and assign TABLE_ONE under the original session.
    const cart = await scoped(till, () =>
      carts.create(till.user, MERCHANT, {
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        idempotencyKey: randomUUID(),
      }),
    );
    const assigned = await scoped(till, () =>
      carts.assignAccountTable(till.user, MERCHANT, cart.id, {
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        tableId: TABLE_ONE,
        expectedVersion: cart.version,
        idempotencyKey: randomUUID(),
      }),
    );
    expect(assigned.tableId).toBe(TABLE_ONE);

    // Simulate terminal lock + restart: end the original operator session and open a fresh one.
    const oldSessionId = till.operatorSessionId;
    const newSessionId = randomUUID();
    await pg.query(
      `UPDATE runtime.operator_session
          SET state='ended', ended_at=now(), last_activity_at=now()
        WHERE id=$1::uuid`,
      [oldSessionId],
    );
    await pg.query(
      `INSERT INTO runtime.operator_session
         (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,
          permissions,entitlements,expires_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
               $8::text[],$9::jsonb,now()+interval '2 hours')`,
      [
        newSessionId,
        till.durableSessionId,
        till.userId,
        till.staffId,
        till.deviceId,
        MERCHANT,
        LOCATION,
        PERMISSIONS,
        ENTITLEMENTS,
      ],
    );
    await pg.query(
      `UPDATE merchant.pos_cart
          SET operator_session_id=$2::uuid, updated_at=clock_timestamp()
        WHERE merchant_id=$1::uuid AND id=$3::uuid`,
      [MERCHANT, newSessionId, cart.id],
    );

    // 1) Duplicate table assignment for TABLE_ONE (written under oldSessionId, replayed under newSessionId).
    const dupTableSetUnsigned = {
      commandId: randomUUID(),
      provisionalId: null,
      deviceId: till.deviceId,
      deviceCredentialVersion: CREDENTIAL_VERSION,
      deviceSequence: 1,
      merchantId: MERCHANT,
      locationId: LOCATION,
      operatorSessionId: oldSessionId,
      commandType: 'pos.cart.table.set' as const,
      idempotencyKey: randomUUID(),
      contractVersion: CONTRACT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      payload: {
        cartId: cart.id,
        locationId: LOCATION,
        operatorSessionId: oldSessionId,
        tableId: TABLE_ONE,
        expectedVersion: cart.version,
        idempotencyKey: randomUUID(),
      },
    };
    const dupTableSet: OfflineCommand = {
      ...dupTableSetUnsigned,
      fingerprint: fingerprintOf(dupTableSetUnsigned),
    };

    // 2) Conflicting table assignment for TABLE_TWO while cart already holds TABLE_ONE:
    // exercises `CART_ALREADY_ASSIGNED -> this.cart.readAccount(..., scope.operatorSessionId)`
    // against PostgreSQL. Previously this threw 403 OPERATOR_SESSION_INVALID on the ended oldSessionId.
    const conflictTableSetUnsigned = {
      commandId: randomUUID(),
      provisionalId: null,
      deviceId: till.deviceId,
      deviceCredentialVersion: CREDENTIAL_VERSION,
      deviceSequence: 2,
      merchantId: MERCHANT,
      locationId: LOCATION,
      operatorSessionId: oldSessionId,
      commandType: 'pos.cart.table.set' as const,
      idempotencyKey: randomUUID(),
      contractVersion: CONTRACT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      payload: {
        cartId: cart.id,
        locationId: LOCATION,
        operatorSessionId: oldSessionId,
        tableId: TABLE_TWO,
        expectedVersion: assigned.version,
        idempotencyKey: randomUUID(),
      },
    };
    const conflictTableSet: OfflineCommand = {
      ...conflictTableSetUnsigned,
      fingerprint: fingerprintOf(conflictTableSetUnsigned),
    };

    const replayed = await scoped(till, () =>
      offline.batch(
        till.user,
        MERCHANT,
        { replaySessionId: randomUUID(), commands: [dupTableSet, conflictTableSet] },
        {
          locationId: LOCATION,
          operatorSessionId: newSessionId,
          credentialVersion: CREDENTIAL_VERSION,
        },
      ),
    );
    expect(replayed.stopped).toBe(false);
    expect(replayed.results).toHaveLength(2);
    expect(replayed.results[0].status).toBe('accepted');
    // Second command did not crash with 401/403 on stale oldSessionId and kept TABLE_ONE intact.
    expect(replayed.results[1].status).toBe('accepted');
    expect(
      await readOn(
        till,
        `SELECT table_id::text AS value FROM merchant.pos_cart
          WHERE merchant_id=$1::uuid AND id=$2::uuid`,
        [MERCHANT, cart.id],
      ),
    ).toBe(TABLE_ONE);
  });

  it('resolves a non-retryable pos.kds.command kitchen_refusal conflict and returns explicit conflict_discarded', async () => {
    const till = tillOf(TILL_KDS_CONFLICT);
    const makeKdsCommand = (sequence: number, kitchenOrderId: string): OfflineCommand => {
      const unsigned = {
        commandId: randomUUID(),
        provisionalId: null,
        deviceId: till.deviceId,
        deviceCredentialVersion: CREDENTIAL_VERSION,
        deviceSequence: sequence,
        merchantId: MERCHANT,
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        commandType: 'pos.kds.command' as const,
        idempotencyKey: randomUUID(),
        contractVersion: CONTRACT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        payload: {
          action: 'command',
          commandId: randomUUID(),
          idempotencyKey: randomUUID(),
          correlationId: randomUUID(),
          expectedVersion: 1,
          kitchenOrderId,
          commandType: 'mark_item_ready',
          itemIds: [randomUUID()],
          reasonCode: null,
          reasonNote: null,
          priority: null,
          courseNumber: null,
          locationId: LOCATION,
          operatorSessionId: till.operatorSessionId,
          actorDeviceId: till.deviceId,
        },
      };
      return { ...unsigned, fingerprint: fingerprintOf(unsigned) };
    };

    const resolvableKds = makeKdsCommand(1, randomUUID());
    const unresolvableKds = makeKdsCommand(2, randomUUID());

    await scoped(till, async () => {
      await offlineRepo.recordStreamConflict(
        resolvableKds,
        'server_validation_failed',
        `kitchen:${String(resolvableKds.payload.kitchenOrderId)}`,
        'kitchen_refusal:KITCHEN_INVALID_TRANSITION',
        false,
      );
      await offlineRepo.recordStreamConflict(
        unresolvableKds,
        'fingerprint_mismatch',
        `kitchen:${String(unresolvableKds.payload.kitchenOrderId)}`,
        'fingerprint_mismatch',
        false,
      );
    });

    const query = {
      locationId: LOCATION,
      operatorSessionId: till.operatorSessionId,
      credentialVersion: CREDENTIAL_VERSION,
    };

    // Guarded non-retryable kitchen_refusal:* KDS conflict resolves cleanly.
    const resolved = await scoped(till, () =>
      offline.resolveConflict(till.user, MERCHANT, query, resolvableKds.commandId),
    );
    expect(resolved).toMatchObject({
      resolved: true,
      commandId: resolvableKds.commandId,
      deviceSequence: 1,
    });

    // resultFor / commandResult returns explicit rejected + conflict_discarded.
    const terminalOutcome = ReplayResult.parse(
      await scoped(till, () =>
        offline.commandResult(till.user, MERCHANT, query, resolvableKds.commandId),
      ),
    );
    expect(terminalOutcome.status).toBe('rejected');
    expect(terminalOutcome.failure?.guidanceCode).toBe('conflict_discarded');

    // Non-guarded KDS conflict (fingerprint_mismatch) remains protected from discard.
    await expect(
      scoped(till, () =>
        offline.resolveConflict(till.user, MERCHANT, query, unresolvableKds.commandId),
      ),
    ).rejects.toMatchObject({ response: { code: 'CONFLICT_NOT_RESOLVABLE' } });

    const openOutcome = ReplayResult.parse(
      await scoped(till, () =>
        offline.commandResult(till.user, MERCHANT, query, unresolvableKds.commandId),
      ),
    );
    expect(openOutcome.status).toBe('conflict');
    expect(openOutcome.failure?.guidanceCode).toBe('fingerprint_mismatch');
  });
});
