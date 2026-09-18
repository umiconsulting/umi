import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FloorPlanDocument,
  PlaceTableOrderRequest,
  TableOrderMenuItem,
  type PlaceTableOrderRequest as PlaceRequest,
} from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import { RequestContextMiddleware } from '../../shared/database/request-context.middleware';
import { ClassValidationPipe } from '../../shared/http/class-validation.pipe';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { FloorPlanRepository } from '../floor-plan/floor-plan.repository';
import { FloorPlanService } from '../floor-plan/floor-plan.service';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { PosCartRepository } from '../pos-cart/pos-cart.repository';
import { PosCartService } from '../pos-cart/pos-cart.service';
import { PosCatalogRepository } from '../pos-catalog/pos-catalog.repository';
import { TableOrderController } from './table-order.controller';
import { TableOrderCredentialGuard } from './table-order-credential.guard';
import { TableOrderRateLimitGuard } from './table-order-rate-limit.guard';
import {
  TableOrderRepository,
  hashTableOrderToken,
  type ResolvedTableOrderCredential,
} from './table-order.repository';
import { TableOrderService, tableOrderReference } from './table-order.service';

/**
 * WORKSTREAM I, STEP 2 · THE ACCEPTANCE SENTENCE, AGAINST THE REAL SCHEMA.
 *
 * §8I's acceptance is one sentence:
 *
 *   "A QR order appears in the POS cart and on the kitchen board with no manual step."
 *
 * The decision that made it buildable is `docs/architecture/2026-09-13-pos-channel-
 * attribution-adr.md` §9 (resolved 2026-09-17): the table channel ships as ORDER INTAKE,
 * payment stays at the counter, and the order is written through the ONE writer with the
 * channel identity `web`.
 *
 * WHAT IS ASSERTED, AND WHY IT IS ASSERTED IN SQL. Every claim below is read back out of
 * the database rather than taken from the service's return value, because a service that
 * returned `{created: true}` while writing nothing would satisfy an assertion about its
 * own answer:
 *
 *   · the ORDER is a `merchant.customer_order` row with `source='web'` and
 *     `fulfillment_type='dine_in'`, its `order_item` lines, and its opening
 *     `order_event` — the rows `ORDER_MODEL.md` §1 says an order IS;
 *   · the KITCHEN TICKET is a `merchant.kitchen_order` plus its `kitchen_order_item`
 *     rows, produced by `projectKitchenOrder` INSIDE the writer. "No manual step" is
 *     exactly this claim: nothing in this suite touches the kitchen after the order;
 *   · the TILL's read — `PosCartService.incomingOrders`, the call behind the POS's
 *     incoming-orders surface — returns it with channel `web` and a reference that names
 *     the table;
 *   · the intake LINK is one `merchant.table_order` row, carrying the guest's identity.
 *
 * THE FIXTURE GOES THROUGH THE PRODUCT'S DOORS where a door exists, because a fixture
 * that hand-writes the rows under test can only prove that the rows are writable:
 *
 *   · the FLOOR PLAN is saved and published by `FloorPlanService`, so the table a
 *     credential is minted for is a table the room is really operating against;
 *   · the CREDENTIAL is issued by `TableOrderService.issueCredential` — the console's own
 *     operation — and the token it returns is RESOLVED the way the public guard resolves
 *     it (`hashTableOrderToken` + `resolveCredential`), so the hashing and the lookup are
 *     exercised rather than imitated;
 *   · the MENU and the ORDER go through `TableOrderService`;
 *   · the till's read is `PosCartService.incomingOrders`, under an operator session
 *     seeded the way the POS's own suites seed one.
 *
 * TWO SETUP ROWS ARE WRITTEN DIRECTLY, named here rather than left to be discovered: the
 * `merchant.table_state` rows (`table-map/table-state.integration.ts` owns the seating
 * rules; this suite needs parties already on tables) and the one
 * `product_location_availability` row (the catalog's own suite owns that write).
 *
 * SELF-SEEDING AND NOT SELF-CLEANING, for the reason `pos-offline.integration.ts` gives:
 * an order is history, and `business_command`, `audit_event` and the kitchen ticket are
 * journals. Every id below comes from a per-run prefix, which is what makes a SECOND RUN
 * against the same database green instead of a collision masked by `DO NOTHING`.
 *
 *   DATABASE_URL_APP=$(echo "$DATABASE_URL_APP" | sed 's#/umi_transition_rehearsal_20260901#/umi_courses_verify#') \
 *   DATABASE_URL_WORKER=$(echo "$DATABASE_URL_WORKER" | sed 's#/umi_transition_rehearsal_20260901#/umi_courses_verify#') \
 *     npx vitest run --config vitest.integration.config.ts src/modules/table-order/table-order.integration.ts
 */

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;

const JWT_SECRET = 'table-order-harness-secret-00000000000';

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
 * A FRESH SET OF IDS ON EVERY RUN, so the suite is green twice in a row. The `9d` prefix
 * is this file's own — no other harness claims it — and the six hex digits after it are
 * the run's.
 */
const RUN = randomUUID().replace(/-/g, '').slice(0, 6);
const fixtureId = (suffix: number): string =>
  `9d${RUN}-0000-4000-8000-${suffix.toString(16).padStart(12, '0')}`;

const MERCHANT = fixtureId(0xa1);
const LOCATION = fixtureId(0xa2);

/**
 * ONE TABLE PER CASE. A test that issues a credential must own the table it issues it
 * for, because `table_order_credential_live_table_uidx` allows exactly one live code per
 * table — so a shared table would make the SECOND test refuse for a reason it did not
 * intend to test, and the suite would pass while proving nothing about rotation.
 *
 * `TABLE_OPEN_STATE` is the trap, kept as a fixture: its state is literally `open`, which
 * in `merchant.table_state` means NOBODY IS ON IT.
 */
const SEATED_TABLES: ReadonlyArray<readonly [string, string]> = [
  [fixtureId(0xb1), 'M1'], // the acceptance
  [fixtureId(0xb9), 'M9'], // revocation
  [fixtureId(0xb4), 'M4'], // the retry
  [fixtureId(0xb5), 'M5'], // 86'd product and foreign modifier
  [fixtureId(0xb6), 'M6'], // the till's price
  [fixtureId(0xb7), 'M7'], // rotation
  [fixtureId(0xb8), 'M8'], // a body that tries to name another table
  [fixtureId(0xba), 'M10'], // the public menu over HTTP
  [fixtureId(0xbb), 'M11'], // the public rate limit
  [fixtureId(0xbc), 'M12'], // the public body schema at the edge
  [fixtureId(0xbd), 'M13'], // linking the order into the till's cart
  [fixtureId(0xbe), 'M14'], // §8.5, the derived allergen list on the menu
];
const TABLE_ONE = SEATED_TABLES[0][0];
const TABLE_REVOKE = SEATED_TABLES[1][0];
const TABLE_RETRY = SEATED_TABLES[2][0];
const TABLE_REFUSALS = SEATED_TABLES[3][0];
const TABLE_PRICE = SEATED_TABLES[4][0];
const TABLE_ROTATION = SEATED_TABLES[5][0];
const TABLE_REDIRECT = SEATED_TABLES[6][0];
const TABLE_HTTP_MENU = SEATED_TABLES[7][0];
const TABLE_HTTP_LIMIT = SEATED_TABLES[8][0];
const TABLE_HTTP_PIPE = SEATED_TABLES[9][0];
const TABLE_LINKED = SEATED_TABLES[10][0];
const TABLE_MENU_ALLERGENS = SEATED_TABLES[11][0];
/** The state literally named `open`: a table nobody is sitting at. */
const TABLE_OPEN_STATE = fixtureId(0xb2);
/** A table in the plan with no state row at all: never seated. */
const TABLE_NEVER_USED = fixtureId(0xb3);

const STATION = fixtureId(0xc1);
const KITCHEN_ROUTE = fixtureId(0xc2);

const PRODUCT = fixtureId(0xd1);
const PRODUCT_SOLD_OUT = fixtureId(0xd2);
const PRODUCT_OTHER = fixtureId(0xd3);
/** §8.5: a product whose recipe carries an allergen label, and one with no recipe. */
const PRODUCT_ALLERGEN = fixtureId(0xd4);
const PRODUCT_NO_RECIPE = fixtureId(0xd5);
const INGREDIENT = fixtureId(0xd6);
const ALLERGEN = fixtureId(0xd7);
const RECIPE = fixtureId(0xd8);
const MAPPING = fixtureId(0xd9);
const ALLERGEN_LABEL = 'Mostaza';

const OPTION_GROUP = fixtureId(0xe1);
const MODIFIER = fixtureId(0xe2);
const FOREIGN_GROUP = fixtureId(0xe3);
const FOREIGN_MODIFIER = fixtureId(0xe4);

const USER = fixtureId(0xf1);
const DEVICE = fixtureId(0xf2);
const DURABLE_SESSION = fixtureId(0xf3);
const OPERATOR_SESSION = fixtureId(0xf4);
/** The employment edge the operator session names: `staff_id` is NOT NULL there. */
const STAFF = fixtureId(0xf5);

/**
 * THE ARITHMETIC, WRITTEN OUT, because every money assertion below is an amount and not a
 * shape.
 *
 *   the Americano, tax-inclusive at 0 basis points     →  2500
 *   one extra shot (the modifier's own delta)          →  +300
 *   the line's unit price the server must store        →  2800
 *   two of them                                        →  5600
 *
 * Tax is 0 on purpose: a rate that extracts cents would put a rounding step between the
 * price and the total, and the subject here is where an order LANDS, not how it rounds.
 */
const BASE_PRICE = 2500;
const MODIFIER_DELTA = 300;
const LINE_UNIT_PRICE = BASE_PRICE + MODIFIER_DELTA;
const LINE_QUANTITY = 2;
const ORDER_TOTAL = LINE_UNIT_PRICE * LINE_QUANTITY;

const PERMISSIONS = ['cart.write'];
const ENTITLEMENTS = JSON.stringify([{ featureKey: 'pos', enabled: true }]);

describe('table-order intake · §8I, "a QR order appears in the POS cart and on the kitchen board"', () => {
  let pg: PgService;
  let orders: TableOrderService;
  let carts: PosCartService;
  let cartRepository: PosCartRepository;
  let credentials: TableOrderRepository;
  /**
   * The HTTP surface, booted for the last three cases only.
   *
   * EVERYTHING ABOVE THIS POINT CALLS THE SERVICE DIRECTLY, which is how the rest of the
   * repository's integration suites are written and is the right level for the pricing,
   * journal and kitchen claims. It is the WRONG level for the public surface: `@Public()`,
   * the credential guard, its refusal, the body schema at the edge and the rate limiter
   * are all decided before a service method is reached, so a service-level suite would
   * report a green intake while the route answered 401 to every guest.
   */
  let app: NestFastifyApplication | undefined;

  const user: AuthUser = {
    id: USER,
    sessionId: DURABLE_SESSION,
    deviceId: DEVICE,
    email: 'mesero@table-order-harness.test',
  };

  const access: MerchantAccess = {
    merchantId: MERCHANT,
    handle: null,
    name: 'Table order harness',
    timezone: 'America/Mexico_City',
    membershipId: null,
    role: 'owner',
    roles: ['owner'],
    permissions: ['merchant.manage', 'table_order.credential.manage'],
    locationId: LOCATION,
  };

  /** Every call below happens on the request path, so the RLS GUCs are set. */
  const scoped = <T>(work: () => Promise<T>): Promise<T> =>
    runWithRequestContext(
      {
        merchantId: MERCHANT,
        locationId: LOCATION,
        deviceId: DEVICE,
        userId: USER,
        requestId: randomUUID(),
      },
      work,
    );

  /**
   * A single scalar, read through the RLS-CONFINED pool as this merchant AND this
   * location. BOTH halves are load-bearing: `merchant.table_order` and
   * `merchant.table_order_credential` carry location-narrowed policies, so a read with no
   * location in the context returns ZERO rows while the row sits in the table — the shape
   * that once made another suite report "nothing was committed" beside a committed sale.
   */
  const readValue = async (sql: string, params: unknown[] = []): Promise<string> => {
    const { rows } = await scoped(() => pg.tquery<{ value: string }>(MERCHANT, sql, params));
    return rows[0].value;
  };

  const count = (sql: string, params: unknown[] = []): Promise<number> =>
    readValue(sql, params).then(Number);

  /**
   * Run a call that MUST be refused and hand back the refusal as plain fields.
   *
   * A Nest `HttpException` keeps its status on the instance and its typed `code` inside
   * `getResponse()`, so `rejects.toMatchObject({ code })` silently matches nothing — which
   * is how a suite comes to look like it asserts a typed refusal while only asserting that
   * something threw. `table-state.integration.ts` records the same trap.
   */
  async function refusal(work: () => Promise<unknown>): Promise<{ status: number; code: string }> {
    try {
      await work();
    } catch (thrown) {
      const error = thrown as { status?: number; getResponse?: () => unknown };
      const body = (typeof error.getResponse === 'function' ? error.getResponse() : {}) as {
        code?: unknown;
      };
      return {
        status: error.status ?? 0,
        code: typeof body.code === 'string' ? body.code : '(none)',
      };
    }
    throw new Error('the API ACCEPTED a request it was supposed to refuse');
  }

  /** Resolve a raw token the way the public guard resolves it. */
  const resolve = (token: string): Promise<ResolvedTableOrderCredential | null> =>
    scoped(() => credentials.resolveCredential(hashTableOrderToken(token)));

  const issue = (tableId: string): Promise<{ credentialId: string; token: string }> =>
    scoped(() =>
      orders.issueCredential(user, access, {
        locationId: LOCATION,
        tableId,
        idempotencyKey: randomUUID(),
      }),
    );

  const body = (overrides: Partial<PlaceRequest> = {}): PlaceRequest =>
    PlaceTableOrderRequest.parse({
      idempotencyKey: randomUUID(),
      lines: [
        {
          productId: PRODUCT,
          quantity: LINE_QUANTITY,
          modifiers: [{ modifierId: MODIFIER, quantity: 1 }],
          note: 'sin sal',
        },
      ],
      guestName: 'Ana',
      guestPhone: '+525512345678',
      note: 'Junto a la ventana',
      ...overrides,
    });

  const seat = (tableId: string, state = 'seated'): Promise<unknown> =>
    pg.query(
      `INSERT INTO merchant.table_state
         (merchant_id,location_id,table_id,state,seated_at,party_size,group_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,now(),2,null)
       ON CONFLICT (merchant_id,location_id,table_id) DO UPDATE
         SET state=$4,seated_at=now(),party_size=2`,
      [MERCHANT, LOCATION, tableId, state],
    );

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
    const floorPlan = new FloorPlanService(new FloorPlanRepository(pg), integrity);
    cartRepository = new PosCartRepository(pg);
    carts = new PosCartService(cartRepository, integrity);
    credentials = new TableOrderRepository(pg);
    orders = new TableOrderService(
      credentials,
      pg,
      new PosCatalogRepository(pg),
      cartRepository,
      integrity,
    );

    // ── The merchant, its branch, its kitchen and its catalog ──
    await pg.query(
      `INSERT INTO merchant.merchant (id,name,handle,currency,timezone)
       VALUES ($1::uuid,'Table Order Harness',$2,'MXN','America/Mexico_City')
       ON CONFLICT (id) DO NOTHING`,
      [MERCHANT, `table-order-${RUN}`],
    );
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name)
       VALUES ($1::uuid,$2::uuid,'Salón') ON CONFLICT (id) DO NOTHING`,
      [LOCATION, MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.station (id,merchant_id,location_id,key,name,status)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'Cocina','active')
       ON CONFLICT (id) DO NOTHING`,
      [STATION, MERCHANT, LOCATION, `cocina-${RUN}`],
    );

    // `requires_preparation` is what makes a line a KITCHEN line at all
    // (`resolveKitchenRoutes`), and the route is what gives it a station.
    for (const [id, name, price] of [
      [PRODUCT, 'Americano con shot', BASE_PRICE],
      [PRODUCT_OTHER, 'Té chai', 2000],
      [PRODUCT_SOLD_OUT, 'Croissant', 1800],
      [PRODUCT_ALLERGEN, 'Sándwich de la casa', 3200],
      [PRODUCT_NO_RECIPE, 'Agua embotellada', 1500],
    ] as const) {
      await pg.query(
        `INSERT INTO merchant.product
           (id,merchant_id,name,price,tax_rate_basis_points,active,requires_preparation)
         VALUES ($1::uuid,$2::uuid,$3,$4,0,true,true)
         ON CONFLICT (id) DO NOTHING`,
        [id, MERCHANT, name, price],
      );
    }
    // The one catalog row written directly: this location is out of the croissant.
    await pg.query(
      `INSERT INTO merchant.product_location_availability (product_id,location_id,status)
       VALUES ($1::uuid,$2::uuid,'temporarily_unavailable')
       ON CONFLICT (product_id,location_id) DO UPDATE SET status=excluded.status`,
      [PRODUCT_SOLD_OUT, LOCATION],
    );
    await pg.query(
      `INSERT INTO merchant.product_option_group (id,product_id,name,min_select,max_select)
       VALUES ($1::uuid,$2::uuid,'Extras',0,2)
       ON CONFLICT (id) DO NOTHING`,
      [OPTION_GROUP, PRODUCT],
    );
    await pg.query(
      `INSERT INTO merchant.product_modifier (id,option_group_id,name,price_delta)
       VALUES ($1::uuid,$2::uuid,'Shot extra',$3) ON CONFLICT (id) DO NOTHING`,
      [MODIFIER, OPTION_GROUP, MODIFIER_DELTA],
    );
    // A group belonging to ANOTHER product: naming its modifier on our product must be
    // refused, because a modifier is a PRICE the server would otherwise honour.
    await pg.query(
      `INSERT INTO merchant.product_option_group (id,product_id,name,min_select,max_select)
       VALUES ($1::uuid,$2::uuid,'Extras',0,2)
       ON CONFLICT (id) DO NOTHING`,
      [FOREIGN_GROUP, PRODUCT_OTHER],
    );
    await pg.query(
      `INSERT INTO merchant.product_modifier (id,option_group_id,name,price_delta)
       VALUES ($1::uuid,$2::uuid,'Shot extra',$3) ON CONFLICT (id) DO NOTHING`,
      [FOREIGN_MODIFIER, FOREIGN_GROUP, MODIFIER_DELTA],
    );
    await pg.query(
      `INSERT INTO merchant.kitchen_route
         (id,merchant_id,location_id,product_id,station_id,requires_preparation,
          route_priority,active)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,true,10,true)
       ON CONFLICT (id) DO NOTHING`,
      [KITCHEN_ROUTE, MERCHANT, LOCATION, PRODUCT, STATION],
    );

    // ── One till, so the POS's own read can be called ──
    //
    // Seeded BEFORE the floor plan is published, and the order is load-bearing: every
    // command in this platform appends a `merchant.audit_event` whose `actor_user_id` is
    // a foreign key into `umi."user"`, so a fixture that publishes first dies on the FK
    // with a message about `audit_event` — one frame away from the missing row that
    // caused it.
    await pg.query(
      `INSERT INTO umi."user" (id,full_name) VALUES ($1::uuid,'Mesero')
       ON CONFLICT (id) DO NOTHING`,
      [USER],
    );
    await pg.query(
      `INSERT INTO merchant.staff (id,merchant_id,location_id,user_id,role_id,name)
       SELECT $1::uuid,$2::uuid,$3::uuid,$4::uuid,
              (SELECT id FROM umi.role WHERE key='cashier'),'Mesero'
       ON CONFLICT (id) DO NOTHING`,
      [STAFF, MERCHANT, LOCATION, USER],
    );
    await pg.query(
      `INSERT INTO merchant.device (id,merchant_id,location_id,name,kind,status)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Caja salón','pos_terminal','active')
       ON CONFLICT (id) DO UPDATE SET status='active',revoked_at=null`,
      [DEVICE, MERCHANT, LOCATION],
    );
    await pg.query(
      `INSERT INTO runtime.session
         (id,merchant_id,principal_type,principal_id,token_hash,expires_at)
       VALUES ($1::uuid,$2::uuid,'user',$3::uuid,md5($1::text||clock_timestamp()::text),
               now()+interval '2 hours')
       ON CONFLICT (id) DO NOTHING`,
      [DURABLE_SESSION, MERCHANT, USER],
    );
    await pg.query(
      `INSERT INTO runtime.operator_session
         (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,
          permissions,entitlements,expires_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
               $8::text[],$9::jsonb,now()+interval '2 hours')
       ON CONFLICT (id) DO UPDATE SET
         permissions=excluded.permissions,entitlements=excluded.entitlements,
         state='active',ended_at=null,expires_at=excluded.expires_at`,
      [
        OPERATOR_SESSION,
        DURABLE_SESSION,
        USER,
        STAFF,
        DEVICE,
        MERCHANT,
        LOCATION,
        PERMISSIONS,
        ENTITLEMENTS,
      ],
    );

    // ── The floor plan, through its own service (save, then publish) ──
    const document = FloorPlanDocument.parse({
      schemaVersion: 1,
      areas: [
        {
          id: randomUUID(),
          name: 'Salón',
          width: 1200,
          height: 800,
          elements: [
            ...[
              ...SEATED_TABLES,
              [TABLE_OPEN_STATE, 'M2'] as const,
              [TABLE_NEVER_USED, 'M3'] as const,
            ].map(([id, label], index) => ({
              id,
              kind: 'table' as const,
              shape: index % 2 === 0 ? ('round' as const) : ('square' as const),
              label,
              capacity: 4,
              // Ten tables per row: the plan validator refuses an element that reaches
              // outside the 1200-wide room, and this suite grew past ten cases.
              x: 80 + (index % 10) * 90,
              y: 120 + Math.floor(index / 10) * 90,
              width: 76,
              height: 76,
              rotation: 0,
            })),
          ],
        },
      ],
    });
    const saved = await scoped(() =>
      floorPlan.change(access, {
        locationId: LOCATION,
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        document,
      }),
    );
    await scoped(() =>
      floorPlan.change(access, {
        locationId: LOCATION,
        expectedVersion: saved.version,
        idempotencyKey: randomUUID(),
      }),
    );

    // ── The parties on the tables ──
    for (const [tableId] of SEATED_TABLES) await seat(tableId);
    // AND THE TRAP, AS A FIXTURE: the state literally named `open` means "nobody is on
    // it". A reader testing `state='open'` would admit exactly this table and refuse
    // every party above.
    await pg.query(
      `INSERT INTO merchant.table_state
         (merchant_id,location_id,table_id,state,seated_at,party_size,group_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'open',null,null,null)
       ON CONFLICT (merchant_id,location_id,table_id) DO UPDATE
         SET state='open',seated_at=null,party_size=null`,
      [MERCHANT, LOCATION, TABLE_OPEN_STATE],
    );

    // ── The public HTTP surface, with the REAL guards ──
    //
    // Not overridden, deliberately. The three facts that make this route public are all
    // guard-level facts — `@Public()` (no credential needed), the token resolving to a
    // merchant AND a location, and the limiter that must run AFTER that resolution to be
    // able to bound the credential — so a stubbed guard would prove nothing about any of
    // them. Only the request-context middleware and the validation pipe are registered,
    // because those are what the real bootstrap registers for every route.
    const moduleRef = await Test.createTestingModule({
      controllers: [TableOrderController],
      providers: [
        { provide: TableOrderService, useValue: orders },
        { provide: TableOrderRepository, useValue: credentials },
        TableOrderCredentialGuard,
        TableOrderRateLimitGuard,
        RateLimitService,
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    const middleware = new RequestContextMiddleware();
    app.use(middleware.use.bind(middleware));
    app.useGlobalPipes(new ClassValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 180_000);

  afterAll(async () => {
    // Nothing is deleted. An order is history, `business_command` and `audit_event` are
    // journals, and the kitchen ticket is append-only — so the fixture is the run's own
    // merchant and the run's own ids, and a second run simply has its own.
    if (app) await app.close();
    if (pg) await pg.onModuleDestroy();
  }, 60_000);

  // ── 1 · The acceptance ───────────────────────────────────────────────────────

  it('writes the order through the one writer, and the kitchen ticket with it', async () => {
    const { token } = await issue(TABLE_ONE);
    const credential = await resolve(token);
    expect(credential).toMatchObject({
      merchantId: MERCHANT,
      locationId: LOCATION,
      tableId: TABLE_ONE,
    });

    // The menu the guest reads: the location's catalog, the server's price, and the one
    // sentence the ADR requires the surface to state about itself.
    const menu = await scoped(() => orders.menu(credential!));
    expect(menu).toMatchObject({
      merchantName: 'Table Order Harness',
      locationName: 'Salón',
      tableLabel: 'M1',
      currency: 'MXN',
      paymentAtCounter: true,
    });
    const item = menu.items.find((row) => row.productId === PRODUCT)!;
    expect(item).toMatchObject({
      price: { minorUnits: BASE_PRICE, currency: 'MXN' },
      availability: 'enabled',
      hasVariants: false,
    });
    expect(item.optionGroups.map((group) => group.id)).toContain(OPTION_GROUP);
    expect(item.optionGroups[0].modifiers[0]).toMatchObject({
      id: MODIFIER,
      priceDelta: { minorUnits: MODIFIER_DELTA, currency: 'MXN' },
    });

    const dto = body();
    const placed = await scoped(() => orders.placeOrder(credential!, dto));
    expect(placed).toMatchObject({
      status: 'placed',
      created: true,
      unitCount: LINE_QUANTITY,
      total: { minorUnits: ORDER_TOTAL, currency: 'MXN' },
    });
    expect(placed.reference).toBe(tableOrderReference('M1', dto.idempotencyKey));

    // ── The order, read back in SQL ──
    expect(
      await readValue(
        `SELECT (source || '/' || fulfillment_type || '/' || status) AS value
           FROM merchant.customer_order WHERE merchant_id=$1::uuid AND id=$2::uuid`,
        [MERCHANT, placed.orderId],
      ),
    ).toBe('web/dine_in/placed');

    // One live line, at the SERVER's price: the base price plus the modifier's own delta
    // — not any number a guest could have sent (there is no field for one).
    expect(
      await readValue(
        `SELECT count(*)::text AS value FROM merchant.order_item
          WHERE order_id=$1::uuid AND voided_at IS NULL`,
        [placed.orderId],
      ),
    ).toBe('1');
    expect(
      await readValue(
        `SELECT (unit_price::text || '/' || quantity::text || '/' || name || '/' ||
                 coalesce(notes,'')) AS value
           FROM merchant.order_item WHERE order_id=$1::uuid`,
        [placed.orderId],
      ),
    ).toBe(`${LINE_UNIT_PRICE}/${LINE_QUANTITY}/Americano con shot/sin sal`);
    expect(
      await readValue(
        `SELECT count(*)::text AS value FROM merchant.order_item_modifier m
           JOIN merchant.order_item i ON i.id=m.order_item_id
          WHERE i.order_id=$1::uuid`,
        [placed.orderId],
      ),
    ).toBe('1');

    // The opening event. Without it the order is invisible to the kitchen and to customer
    // status notifications — silently (`order-writer.ts`).
    expect(
      await readValue(
        `SELECT (count(*)::text || '/' || max(kind) || '/' || max(status)::text) AS value
           FROM merchant.order_event WHERE order_id=$1::uuid`,
        [placed.orderId],
      ),
    ).toBe('1/status_changed/placed');

    // ── "On the kitchen board with no manual step" ──
    expect(
      await readValue(
        `SELECT (ko.source || '/' || ko.fulfillment_type || '/' || ko.public_reference) AS value
           FROM merchant.kitchen_order ko
          WHERE ko.merchant_id=$1::uuid AND ko.source_order_id=$2::uuid`,
        [MERCHANT, placed.orderId],
      ),
    ).toBe(`web/dine_in/${placed.reference}`);
    expect(
      await readValue(
        `SELECT (ki.status || '/' || ki.quantity::text || '/' || ki.product_name) AS value
           FROM merchant.kitchen_order_item ki
           JOIN merchant.kitchen_order ko ON ko.id=ki.kitchen_order_id
          WHERE ko.source_order_id=$1::uuid AND ki.station_id=$2::uuid`,
        [placed.orderId, STATION],
      ),
    ).toBe(`queued/${LINE_QUANTITY}/Americano con shot`);

    // ── The intake link, with the guest's own identity on it ──
    expect(
      await readValue(
        `SELECT (table_id::text || '/' || credential_id::text || '/' || coalesce(guest_name,'') ||
                 '/' || coalesce(guest_phone,'')) AS value
           FROM merchant.table_order WHERE order_id=$1::uuid`,
        [placed.orderId],
      ),
    ).toBe(`${TABLE_ONE}/${credential!.credentialId}/Ana/+525512345678`);

    // ── "Appears in the POS cart" ── the till's own read, not a re-implementation.
    const incoming = await scoped(() =>
      carts.incomingOrders(user, MERCHANT, LOCATION, OPERATOR_SESSION),
    );
    expect(incoming.orders.find((order) => order.orderId === placed.orderId)).toMatchObject({
      channel: 'web',
      status: 'placed',
      reference: placed.reference,
      // The TILL's field counts LINES, not units — its SQL is `count(*)` over the order's
      // live items. One line of two coffees is therefore 1 here, while the guest's own
      // answer says `unitCount: 2` (see the contract). Asserting the difference is the
      // point: one name, one meaning, and neither is quietly rendered as the other.
      itemCount: 1,
      totalMinorUnits: ORDER_TOTAL,
      customerName: null,
    });
  }, 180_000);

  // ── 2 · What the guest may not name ─────────────────────────────────────────

  it('refuses a price, a discount, a customer and another table, because the body has no such field', () => {
    const base = {
      idempotencyKey: randomUUID(),
      lines: [{ productId: PRODUCT, quantity: 1, modifiers: [], note: null }],
      guestName: null,
      guestPhone: null,
      note: null,
    };
    expect(PlaceTableOrderRequest.safeParse(base).success).toBe(true);

    // `.strict()` makes each of these a REFUSAL rather than a silently dropped field: a
    // request that tried to name a price must be visible, not look like one that did not.
    const rejected: Record<string, unknown> = {
      'a price on the line': {
        ...base,
        lines: [{ ...base.lines[0], price: { minorUnits: 1, currency: 'MXN' } }],
      },
      'a line price in centavos': { ...base, lines: [{ ...base.lines[0], unitPriceCents: 1 }] },
      'an order discount': {
        ...base,
        discounts: [{ kind: 'comp', code: 'X', label: 'X', amountCents: 100 }],
      },
      'a customer id': { ...base, customerId: USER },
      'another table': { ...base, tableId: TABLE_NEVER_USED },
      'a status of its own': { ...base, status: 'completed' },
      'an empty cart': { ...base, lines: [] },
      'a quantity of zero': { ...base, lines: [{ ...base.lines[0], quantity: 0 }] },
      'a quantity past the bound': { ...base, lines: [{ ...base.lines[0], quantity: 51 }] },
      'a negative quantity': { ...base, lines: [{ ...base.lines[0], quantity: -1 }] },
      'a phone that reaches nobody': { ...base, guestPhone: '+5212345' },
      'markup in a note': { ...base, note: '<script>' },
    };
    for (const [what, request] of Object.entries(rejected)) {
      expect(PlaceTableOrderRequest.safeParse(request).success, `${what} must be refused`).toBe(
        false,
      );
    }
  });

  // ── 3 · Refusals that come from the catalog, not from the schema ─────────────

  it('refuses a product this location is out of, and a modifier that is another product’s', async () => {
    const { token } = await issue(TABLE_REFUSALS);
    const credential = await resolve(token);

    // 86'd at this location: `product_location_availability` says so, and the till's own
    // catalog expression is what refuses it — not a second availability rule here.
    expect(
      await refusal(() =>
        scoped(() =>
          orders.placeOrder(
            credential!,
            body({
              lines: [{ productId: PRODUCT_SOLD_OUT, quantity: 1, modifiers: [], note: null }],
            }),
          ),
        ),
      ),
    ).toEqual({ status: 409, code: 'PRODUCT_UNAVAILABLE' });

    // A modifier that belongs to ANOTHER product is a price the server would have
    // honoured. The product prices, so the refusal is the selection's.
    expect(
      await refusal(() =>
        scoped(() =>
          orders.placeOrder(
            credential!,
            body({
              lines: [
                {
                  productId: PRODUCT,
                  quantity: 1,
                  modifiers: [{ modifierId: FOREIGN_MODIFIER, quantity: 1 }],
                  note: null,
                },
              ],
            }),
          ),
        ),
      ),
    ).toEqual({ status: 409, code: 'MODIFIER_SELECTION_INVALID' });

    // A group's max_select is 2, and three of the same modifier is over it.
    expect(
      await refusal(() =>
        scoped(() =>
          orders.placeOrder(
            credential!,
            body({
              lines: [
                {
                  productId: PRODUCT,
                  quantity: 1,
                  modifiers: [{ modifierId: MODIFIER, quantity: 3 }],
                  note: null,
                },
              ],
            }),
          ),
        ),
      ),
    ).toEqual({ status: 409, code: 'MODIFIER_SELECTION_INVALID' });

    // None of the three refusals wrote anything.
    expect(
      await count(
        `SELECT count(*)::text AS value FROM merchant.table_order WHERE table_id=$1::uuid`,
        [TABLE_REFUSALS],
      ),
    ).toBe(0);
  }, 180_000);

  // ── 4 · The table must have a party on it ───────────────────────────────────

  it('refuses a table with nobody on it — including one whose state is literally "open"', async () => {
    const { token } = await issue(TABLE_OPEN_STATE);
    const credential = await resolve(token);

    // The state row reads `open`, which is the state meaning NOBODY IS ON IT. Written the
    // other way — `WHERE state='open'` — this order would be ACCEPTED and the party at
    // table one REFUSED, which is the whole product backwards.
    expect(
      await readValue(
        `SELECT (state || '/' || (seated_at IS NULL)::text) AS value FROM merchant.table_state
          WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id=$3::uuid`,
        [MERCHANT, LOCATION, TABLE_OPEN_STATE],
      ),
    ).toBe('open/true');

    expect(await refusal(() => scoped(() => orders.placeOrder(credential!, body())))).toEqual({
      status: 409,
      code: 'TABLE_NOT_OCCUPIED',
    });
    expect(
      await count(
        `SELECT count(*)::text AS value FROM merchant.table_order WHERE table_id=$1::uuid`,
        [TABLE_OPEN_STATE],
      ),
    ).toBe(0);

    // A table in the plan with NO state row at all is the same refusal: never seated.
    const never = await issue(TABLE_NEVER_USED);
    const neverCredential = await resolve(never.token);
    expect(await refusal(() => scoped(() => orders.placeOrder(neverCredential!, body())))).toEqual({
      status: 409,
      code: 'TABLE_NOT_OCCUPIED',
    });
  }, 180_000);

  // ── 5 · A revoked credential ────────────────────────────────────────────────

  it('refuses a credential the owner revoked, without deleting the record', async () => {
    const { credentialId, token } = await issue(TABLE_REVOKE);
    expect(await resolve(token)).not.toBeNull();

    await scoped(() =>
      orders.revokeCredential(user, access, credentialId, LOCATION, {
        idempotencyKey: randomUUID(),
      }),
    );

    // The guard's decision, and the ONLY one a guest can tell apart: the token no longer
    // resolves. Unknown and revoked are the same answer on purpose.
    expect(await resolve(token)).toBeNull();
    // And a token nobody ever minted is refused the same way.
    expect(await resolve(randomUUID().replace(/-/g, ''))).toBeNull();

    // The record stays, and it says WHO killed it — an incident review has to be able to
    // answer that. Deleting it would have taken the `table_order` rows with it.
    expect(
      await readValue(
        `SELECT ((revoked_at IS NOT NULL)::text || '/' ||
                 (revoked_by_user_id=$2::uuid)::text) AS value
           FROM merchant.table_order_credential WHERE id=$1::uuid`,
        [credentialId, USER],
      ),
    ).toBe('true/true');
  }, 180_000);

  // ── 6 · The retry ───────────────────────────────────────────────────────────

  it('lands exactly one order when a flaky phone submits the same body twice', async () => {
    const { token } = await issue(TABLE_RETRY);
    const credential = await resolve(token);
    const dto = body();

    const first = await scoped(() => orders.placeOrder(credential!, dto));
    const second = await scoped(() => orders.placeOrder(credential!, dto));

    expect(first.created).toBe(true);
    // THE REPLAY IS THE ORIGINAL ANSWER, verbatim — including `created`. The command
    // journal stores the first response and returns it, so the guest's page cannot tell a
    // retry from the original, which is exactly what a retry key is for. The property that
    // matters is therefore identity, not a flag: the same order, the same total, and one
    // set of rows behind them.
    expect(second).toEqual(first);

    // One order, one ticket, one link — counted in SQL, not taken from the answer.
    expect(
      await count(
        `SELECT count(*)::text AS value FROM merchant.customer_order
          WHERE merchant_id=$1::uuid AND external_ref=$2 AND source='web'`,
        [MERCHANT, first.reference],
      ),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*)::text AS value FROM merchant.kitchen_order
          WHERE merchant_id=$1::uuid AND source_order_id=$2::uuid`,
        [MERCHANT, first.orderId],
      ),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*)::text AS value FROM merchant.table_order WHERE table_id=$1::uuid`,
        [TABLE_RETRY],
      ),
    ).toBe(1);

    // THE SAME KEY WITH A DIFFERENT BODY IS NOT A RETRY. It is refused, and no second
    // order is written — the fingerprint rule in `business_command`.
    const tampered = {
      ...dto,
      lines: [{ productId: PRODUCT, quantity: 5, modifiers: [], note: null }],
    };
    expect(await refusal(() => scoped(() => orders.placeOrder(credential!, tampered)))).toEqual({
      status: 409,
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(
      await count(
        `SELECT count(*)::text AS value FROM merchant.customer_order
          WHERE merchant_id=$1::uuid AND external_ref=$2`,
        [MERCHANT, first.reference],
      ),
    ).toBe(1);
  }, 180_000);

  // ── 7 · The guest is charged what the till would charge ─────────────────────

  it('prices the guest’s line exactly as the till would, from the same catalog', async () => {
    const { token } = await issue(TABLE_PRICE);
    const credential = await resolve(token);

    // THE SAME CALL THE TILL MAKES, on the same selection — so the two numbers are
    // comparable and neither is a re-telling of the other.
    const tillPrice = await scoped(() =>
      pg.runWithMerchant(
        MERCHANT,
        USER,
        (client) =>
          cartRepository.price(client, MERCHANT, LOCATION, {
            productId: PRODUCT,
            variantId: null,
            modifierSelections: [{ modifierId: MODIFIER, quantity: 1 }],
          }),
        LOCATION,
      ),
    );
    expect(tillPrice).not.toBeNull();
    const tillUnit =
      tillPrice!.basePrice +
      tillPrice!.variantDelta +
      tillPrice!.modifiers.reduce((sum, row) => sum + row.priceDelta * row.quantity, 0);
    expect(tillUnit).toBe(LINE_UNIT_PRICE);

    const placed = await scoped(() =>
      orders.placeOrder(
        credential!,
        body({
          lines: [
            {
              productId: PRODUCT,
              quantity: 1,
              modifiers: [{ modifierId: MODIFIER, quantity: 1 }],
              note: null,
            },
          ],
        }),
      ),
    );
    expect(
      await readValue(
        `SELECT unit_price::text AS value FROM merchant.order_item WHERE order_id=$1::uuid`,
        [placed.orderId],
      ),
    ).toBe(String(tillUnit));
    expect(placed.total.minorUnits).toBe(LINE_UNIT_PRICE);
  }, 180_000);

  // ── 8 · Rotation, and one live code per table ───────────────────────────────

  it('refuses a second live code for one table until the first is revoked', async () => {
    const first = await issue(TABLE_ROTATION);
    expect(
      await refusal(() =>
        scoped(() =>
          orders.issueCredential(user, access, {
            locationId: LOCATION,
            tableId: TABLE_ROTATION,
            idempotencyKey: randomUUID(),
          }),
        ),
      ),
    ).toEqual({ status: 409, code: 'TABLE_ORDER_CREDENTIAL_ALREADY_LIVE' });

    // Rotation is revoke-then-issue, and only then does the new token resolve.
    await scoped(() =>
      orders.revokeCredential(user, access, first.credentialId, LOCATION, {
        idempotencyKey: randomUUID(),
      }),
    );
    const second = await issue(TABLE_ROTATION);
    expect(second.token).not.toBe(first.token);
    expect(await resolve(first.token)).toBeNull();
    expect(await resolve(second.token)).not.toBeNull();

    // THE STORE KEEPS ONLY THE HASH. A database read cannot reproduce a working QR: the
    // RAW tokens are in no column, and what is stored is the sha256 of one of them.
    expect(
      await count(
        `SELECT count(*)::text AS value FROM merchant.table_order_credential
          WHERE table_id=$1::uuid AND token_hash IN ($2,$3)`,
        [TABLE_ROTATION, first.token, second.token],
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::text AS value FROM merchant.table_order_credential
          WHERE table_id=$1::uuid AND token_hash=$2`,
        [TABLE_ROTATION, hashTableOrderToken(second.token)],
      ),
    ).toBe(1);

    // The owner's own view of the room: the LIVE code and the dead one beside it, with the
    // token replaced by null because the database cannot reproduce it. This is what makes
    // revocation legible rather than merely possible.
    const listed = await scoped(() => orders.listCredentials(access, LOCATION));
    const history = listed.credentials.filter((row) => row.tableId === TABLE_ROTATION);
    expect(history).toHaveLength(2);
    expect(history.filter((row) => row.revokedAt === null)).toHaveLength(1);
    for (const row of history) expect(row.token).toBeNull();
  }, 180_000);

  // ── 9 · The order lands on the credential's table, never on a named one ─────

  it('writes the order to the table the credential names, and the body cannot change it', async () => {
    const { token } = await issue(TABLE_REDIRECT);
    const credential = await resolve(token);
    expect(credential!.tableId).toBe(TABLE_REDIRECT);

    const placed = await scoped(() =>
      orders.placeOrder(credential!, {
        idempotencyKey: randomUUID(),
        lines: [{ productId: PRODUCT, quantity: 1, modifiers: [], note: null }],
        guestName: null,
        guestPhone: null,
        note: null,
      }),
    );
    expect(
      await readValue(
        `SELECT table_id::text AS value FROM merchant.table_order WHERE order_id=$1::uuid`,
        [placed.orderId],
      ),
    ).toBe(TABLE_REDIRECT);
    // And the same table the kitchen ticket was projected for.
    expect(
      await readValue(
        `SELECT (location_id::text || '/' || status) AS value FROM merchant.kitchen_order
          WHERE source_order_id=$1::uuid`,
        [placed.orderId],
      ),
    ).toBe(`${LOCATION}/queued`);
  }, 180_000);

  // ── 10 · The PUBLIC surface itself ──────────────────────────────────────────
  //
  // Everything above calls the service. These four cases go through the real route, the
  // real guards and the real pipe, because that is where "public" is decided: a guest
  // holds no cookie and no bearer token, so a route that is not `@Public()` answers 401 to
  // every one of them and no service-level suite would notice.

  it('serves the menu over HTTP to a caller holding nothing but the token', async () => {
    const { token } = await issue(TABLE_HTTP_MENU);
    const response = await app!.inject({
      method: 'GET',
      url: `/api/public/table-order/${token}`,
    });
    expect(response.statusCode).toBe(200);
    const menu = response.json();
    expect(menu).toMatchObject({
      merchantName: 'Table Order Harness',
      locationName: 'Salón',
      tableLabel: 'M10',
      currency: 'MXN',
      paymentAtCounter: true,
    });
    expect(
      menu.items.find((row: { productId: string }) => row.productId === PRODUCT),
    ).toMatchObject({
      name: 'Americano con shot',
      price: { minorUnits: BASE_PRICE, currency: 'MXN' },
    });
  }, 180_000);

  it('refuses an unknown or revoked token the same way, and says nothing about which it was', async () => {
    for (const token of [randomUUID().replace(/-/g, ''), await revokedToken()]) {
      const response = await app!.inject({
        method: 'GET',
        url: `/api/public/table-order/${token}`,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'TABLE_ORDER_CREDENTIAL_INVALID' });
    }
  }, 180_000);

  it('refuses a body that names a price, at the edge, before any service is reached', async () => {
    const { token } = await issue(TABLE_HTTP_PIPE);
    const response = await app!.inject({
      method: 'POST',
      url: `/api/public/table-order/${token}/orders`,
      payload: {
        idempotencyKey: randomUUID(),
        lines: [
          {
            productId: PRODUCT,
            quantity: 1,
            price: { minorUnits: 1, currency: 'MXN' },
            note: null,
          },
        ],
        guestName: null,
        guestPhone: null,
        note: null,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  }, 180_000);

  it('accepts the order over HTTP and bounds one table’s code at its twelfth attempt', async () => {
    const { token } = await issue(TABLE_HTTP_LIMIT);
    const payload = body();

    const first = await app!.inject({
      method: 'POST',
      url: `/api/public/table-order/${token}/orders`,
      payload,
    });
    expect(first.statusCode).toBe(201);
    const placed = first.json();
    expect(placed).toMatchObject({ status: 'placed', unitCount: LINE_QUANTITY });
    // And the order is really there, written by the route and not by the suite.
    expect(
      await readValue(
        `SELECT (source || '/' || fulfillment_type) AS value FROM merchant.customer_order
          WHERE merchant_id=$1::uuid AND id=$2::uuid`,
        [MERCHANT, placed.orderId],
      ),
    ).toBe('web/dine_in');

    // ELEVEN more attempts on the SAME credential, all of them the same submission (so
    // they replay and create nothing). The twelfth attempt in the window is the last one
    // allowed; the thirteenth is refused.
    let last = first.statusCode;
    for (let attempt = 2; attempt <= 12; attempt += 1) {
      last = (
        await app!.inject({
          method: 'POST',
          url: `/api/public/table-order/${token}/orders`,
          payload,
        })
      ).statusCode;
    }
    expect(last).toBe(201);

    // THE ASSERTION THAT PROVES THE GUARD ORDER. The per-credential bucket can only be
    // charged by a guard that runs AFTER the token is resolved, so if the limiter ran
    // first this request would fall to the (looser) per-address bucket and be answered
    // 201 again.
    const refused = await app!.inject({
      method: 'POST',
      url: `/api/public/table-order/${token}/orders`,
      payload,
    });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(refused.headers['retry-after']).toBeDefined();

    // Twelve accepted attempts, ONE order: the limiter counts requests and the journal
    // counts writes, and neither leaks into the other.
    expect(
      await count(
        `SELECT count(*)::text AS value FROM merchant.table_order WHERE table_id=$1::uuid`,
        [TABLE_HTTP_LIMIT],
      ),
    ).toBe(1);
  }, 180_000);

  // ── 11 · "In the POS cart", made literal ────────────────────────────────────

  it('can be linked into the till’s own cart, which is how a channel order is settled', async () => {
    const { token } = await issue(TABLE_LINKED);
    const credential = await resolve(token);
    const placed = await scoped(() => orders.placeOrder(credential!, body()));

    // A cart as the till creates it, then the bind the incoming-orders surface performs
    // when the operator picks the order up. This is the ADR's "link, don't merge": the
    // commercial order keeps its identity and the POS sale will be its own row.
    const cart = await scoped(() =>
      carts.create(user, MERCHANT, {
        locationId: LOCATION,
        operatorSessionId: OPERATOR_SESSION,
        idempotencyKey: randomUUID(),
      }),
    );
    const bound = await scoped(() =>
      carts.bindOrigin(user, MERCHANT, {
        cartId: cart.id,
        locationId: LOCATION,
        operatorSessionId: OPERATOR_SESSION,
        originOrderId: placed.orderId,
        expectedVersion: cart.version,
        idempotencyKey: randomUUID(),
      }),
    );
    expect(bound.id).toBe(cart.id);

    // The channel is FROZEN onto the cart from the order's own source, so the sale that
    // settles it cannot lose the attribution if the order changes afterwards.
    expect(
      await readValue(
        `SELECT (coalesce(origin_channel,'-') || '/' || (origin_order_id=$2::uuid)::text) AS value
           FROM merchant.pos_cart WHERE merchant_id=$1::uuid AND id=$3::uuid`,
        [MERCHANT, placed.orderId, cart.id],
      ),
    ).toBe('web/true');
  }, 180_000);

  /** A minted-then-revoked token, for the "indistinguishable" case above. */
  async function revokedToken(): Promise<string> {
    const { credentialId, token } = await issue(TABLE_REVOKE);
    await scoped(() =>
      orders.revokeCredential(user, access, credentialId, LOCATION, {
        idempotencyKey: randomUUID(),
      }),
    );
    return token;
  }

  // ── 11 · §8.5 · The menu's allergen list is DERIVED from the recipe ──────────
  //
  // The claim is a BEHAVIOUR, not a shape. A label is written on the INGREDIENT, the
  // ingredient is consumed by a recipe, and the product is mapped to that recipe; the
  // guest menu then carries the label. Retiring the recipe removes it from a FRESH read.
  // A list stored on the menu row would pass the first half and fail the second, which is
  // the staleness D8 refuses. A product with no recipe at all answers `[]` (no ingredient
  // is recorded) rather than a claim that the dish is free of an allergen.
  it('derives the menu item allergen from the recipe, and drops it when the recipe retires', async () => {
    const code = `mostaza_${RUN}`;

    // The ingredient, its label, the recipe and the product's mapping to it, written as
    // rows through the RLS-confined pool: the explosion below has real rows to walk.
    await scoped(() =>
      pg.tquery(
        MERCHANT,
        `INSERT INTO merchant.inventory_item
           (id,merchant_id,public_reference,display_name,item_type,base_unit)
         VALUES ($1::uuid,$2::uuid,$3,'Mostaza','ingredient','gram')`,
        [INGREDIENT, MERCHANT, `allergen-ingredient-${RUN}`],
      ),
    );
    await scoped(() =>
      pg.tquery(
        MERCHANT,
        `INSERT INTO merchant.inventory_allergen (id,merchant_id,code,label)
         VALUES ($1::uuid,$2::uuid,$3,$4)`,
        [ALLERGEN, MERCHANT, code, ALLERGEN_LABEL],
      ),
    );
    await scoped(() =>
      pg.tquery(
        MERCHANT,
        `INSERT INTO merchant.inventory_item_allergen
           (merchant_id,inventory_item_id,inventory_allergen_id)
         VALUES ($1::uuid,$2::uuid,$3::uuid)`,
        [MERCHANT, INGREDIENT, ALLERGEN],
      ),
    );
    await scoped(() =>
      pg.tquery(
        MERCHANT,
        `INSERT INTO merchant.inventory_recipe
           (id,merchant_id,product_id,version,yield_quantity,yield_scale,yield_unit,active)
         VALUES ($1::uuid,$2::uuid,$3::uuid,1,1,0,'portion',true)`,
        [RECIPE, MERCHANT, PRODUCT_ALLERGEN],
      ),
    );
    await scoped(() =>
      pg.tquery(
        MERCHANT,
        `INSERT INTO merchant.inventory_recipe_component
           (merchant_id,recipe_id,inventory_item_id,quantity,unit,quantity_scale)
         VALUES ($1::uuid,$2::uuid,$3::uuid,1,'gram',0)`,
        [MERCHANT, RECIPE, INGREDIENT],
      ),
    );
    await scoped(() =>
      pg.tquery(
        MERCHANT,
        `INSERT INTO merchant.inventory_catalog_mapping
           (id,merchant_id,product_id,mapping_type,recipe_id,version,active)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'recipe',$4::uuid,1,true)`,
        [MAPPING, MERCHANT, PRODUCT_ALLERGEN, RECIPE],
      ),
    );

    const { token } = await issue(TABLE_MENU_ALLERGENS);
    const credential = await resolve(token);
    expect(credential).not.toBeNull();

    // A FRESH read, and the strict contract on it: the field is required now, so a menu
    // that omitted the list would fail here rather than reach the guest's page.
    const menu = await scoped(() => orders.menu(credential!));
    const item = menu.items.find((row) => row.productId === PRODUCT_ALLERGEN)!;
    expect(TableOrderMenuItem.safeParse(item).success).toBe(true);
    expect(item.allergens).toEqual([{ code, label: ALLERGEN_LABEL }]);
    // No recipe, no rows, and therefore an empty list, not a missing key.
    expect(menu.items.find((row) => row.productId === PRODUCT_NO_RECIPE)?.allergens).toEqual([]);

    // Retire the recipe and the mapping that points at it: `inventory_catalog_mapping.active`
    // is the catalog-side statement that the product no longer uses that recipe, and the
    // explosion is keyed on it.
    await scoped(() =>
      pg.tquery(
        MERCHANT,
        `UPDATE merchant.inventory_catalog_mapping
            SET active=false,retired_at=clock_timestamp()
          WHERE merchant_id=$1::uuid AND id=$2::uuid`,
        [MERCHANT, MAPPING],
      ),
    );
    await scoped(() =>
      pg.tquery(
        MERCHANT,
        `UPDATE merchant.inventory_recipe
            SET active=false,retired_at=clock_timestamp()
          WHERE merchant_id=$1::uuid AND id=$2::uuid`,
        [MERCHANT, RECIPE],
      ),
    );

    const after = await scoped(() => orders.menu(credential!));
    expect(after.items.find((row) => row.productId === PRODUCT_ALLERGEN)?.allergens).toEqual([]);
  }, 180_000);
});
