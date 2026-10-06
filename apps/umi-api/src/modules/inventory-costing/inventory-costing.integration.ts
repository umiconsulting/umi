import { MetricsService } from '../../shared/operations/metrics.service';
import { createHash, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InventoryRecipeCostHistory,
  InventoryUsageVariance,
  MenuEngineering,
  type CreatePurchaseOrderRequest,
} from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import { writeOrder } from '../../shared/orders/order-writer';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { AdministrativeCommandContextService } from '../administrative-commands/administrative-command-context.service';
import { AdministrativeCommandExecutionService } from '../administrative-commands/administrative-command-execution.service';
import { AdministrativeCommandRepository } from '../administrative-commands/administrative-command.repository';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { InventoryAuthoringRepository } from '../inventory-authoring/inventory-authoring.repository';
import { InventoryAuthoringService } from '../inventory-authoring/inventory-authoring.service';
import { ProcurementRepository } from '../procurement/procurement.repository';
import { ProcurementService } from '../procurement/procurement.service';
import { shiftBusinessDate } from './inventory-costing-domain';
import { InventoryCostingRepository } from './inventory-costing.repository';
import { InventoryCostingService } from './inventory-costing.service';

/**
 * WORKSTREAM E, STEPS 5 AND 6 — "Add a costing view per plate and per day" and "Add
 * a low-stock forecast from the last 28 days of sales", against the REAL schema.
 *
 * WHAT THIS SPEC IS FOR, STATED AS THE PLAN STATES IT. The acceptance line is "a
 * plate shows its cost, its margin, and the stock it consumed", and the invariant the
 * workstream rests on is that a cost is a fact about money that arrived on a supplier's
 * invoice — so nothing below is asserted from a shape or a count. Every money claim is
 * an EXACT number, written out, computed by hand from the fixtures above it, and the
 * fixtures are built through the product's own doors:
 *
 *   · the COSTS come from real purchase orders sent and received through
 *     `ProcurementService`, so the weighted average is measured over rows the receiving
 *     path wrote;
 *   · the SALE FACTS come from `writeOrder` and `merchant.commit_sale_inventory` — the
 *     same door the till posts its consumption through — so the ledger rows the reading
 *     side sums are rows the writing side produced;
 *   · the RECIPE EXPANSION is not re-implemented here: the reservation lines are seeded
 *     from quantities this spec computes BY HAND, and the plate read must agree with
 *     them. A copy of the checkout's expression that drifted would show up as the two
 *     disagreeing.
 *
 * THE HARD CASES ARE THE POINT. Two receipts at different prices and quantities, because
 * a basis that is not quantity-weighted is invisible under a single-receipt fixture. One
 * item with NO receipt, because that is what an item with no cost basis looks like. One
 * component that exists ONLY as a modifier, because the difference between what a plate
 * is made of and what a sale took off the shelf is exactly where a costing view lies.
 * One receipt pair that averages to a half centavo, because half-up rounding is the step
 * that quietly goes wrong.
 *
 * SELF-SEEDING AND NOT SELF-CLEANING: `stock_ledger_entry` is append-only and a receipt
 * is immutable, so neither the stock nor the money can be taken back. Every fixture lives
 * under this spec's own merchant id and every assertion is about that merchant, which is
 * also what makes the cross-tenant case meaningful.
 *
 *   set -a && . apps/umi-api/.env && set +a
 *   npx vitest run --config vitest.integration.config.ts inventory-costing
 */

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;

const JWT_SECRET = 'inventory-costing-harness-secret-000000000000';

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
 * A FRESH SET OF IDS ON EVERY RUN, and this is not tidiness — it is the only way the
 * numbers below can be exact.
 *
 * `stock_ledger_entry` is append-only and a receipt is immutable, so a re-run starts on
 * top of the previous run's stock. The procurement suite answers that with BEFORE/AFTER
 * deltas, which is right for it, but a costing view's whole subject is an ABSOLUTE cost
 * — "this plate costs 840 centavos" — and a delta cannot express that. So each run gets
 * its own merchant, and the numbers are the numbers.
 *
 * The `7e` prefix is this spec's own: no other harness claims it, and the six hex digits
 * after it are the run's, so two runs cannot collide.
 */
const RUN = randomUUID().replace(/-/g, '').slice(0, 6);
const fixtureId = (suffix: number): string =>
  `7e${RUN}-0000-4000-8000-${suffix.toString(16).padStart(12, '0')}`;

/**
 * THE SUITE OWNS ITS CLOCK.
 *
 * `lowStock` takes its window from the merchant's CURRENT business date — `to` is
 * `now() at the merchant's timezone, shifted by its business-day start`, and `from` is
 * twenty-seven days before that. So a fixture written against literal dates is not
 * testing the window; it is testing what day the suite happened to run on, and it passes
 * exactly once. Measured: written on 2026-09-16, `forecast.to` came back `2026-09-17` the
 * next day and two assertions moved with it.
 *
 * The fixture therefore reads the SAME expression the repository reads, immediately
 * after it creates the merchant, and states every business date as an offset from it.
 * The arithmetic in the comments is untouched — only the day it is anchored to is.
 */
let TODAY = '2026-01-01';
/** A business date `offset` days from the merchant's current one (negative = earlier). */
const dayAt = (offset: number): string => shiftBusinessDate(TODAY, offset);

const MERCHANT = fixtureId(0xa1);
const LOCATION = fixtureId(0xa2);
/** A second merchant, to prove the forced RLS isolates tenants on every read. */
const NEIGHBOUR = fixtureId(0xa3);
const NEIGHBOUR_LOCATION = fixtureId(0xa4);

const USER = fixtureId(0xc1);
const NEIGHBOUR_USER = fixtureId(0xc2);
const DEVICE = fixtureId(0xc3);
const SESSION = fixtureId(0xc4);
const OPERATOR_SESSION = fixtureId(0xc5);
const STAFF = fixtureId(0xc6);
/** The console session the phase 4 recipe write drives, exactly as the console does. */
const DASHBOARD_SESSION = fixtureId(0xc8);

const STOCK_ROOM = fixtureId(0xd1);
const NEIGHBOUR_STOCK_ROOM = fixtureId(0xd2);

const SUPPLIER = fixtureId(0xf1);
const NEIGHBOUR_SUPPLIER = fixtureId(0xf2);

/**
 * The ingredients. `CAFE-GRANO` and `LECHE` are received; `AZUCAR` is deliberately
 * NEVER received — it is the item with no cost basis; `REDONDEO` exists only to make a
 * weighted average land on a half centavo.
 */
const ITEM_BEANS = fixtureId(0x101);
const ITEM_MILK = fixtureId(0x102);
const ITEM_SYRUP = fixtureId(0x103);
const ITEM_CUP = fixtureId(0x104);
const ITEM_SUGAR = fixtureId(0x105);
const ITEM_NAPKIN = fixtureId(0x106);
const ITEM_ROUNDING = fixtureId(0x107);
const ITEM_NEIGHBOUR = fixtureId(0x108);
/** The prep the yield-loss case produces. It is an item with stock and no recipe. */
const ITEM_PREP = fixtureId(0x109);
/**
 * The three items the phase 4 cases measure on their OWN shelf, so the older cases
 * keep the numbers they were written with: the star's ingredient, the dog's ingredient,
 * and the item whose waste, damage and count correction are named.
 */
const ITEM_STAR = fixtureId(0x10a);
const ITEM_DOG = fixtureId(0x10b);
const ITEM_LOSS = fixtureId(0x10c);

const PRODUCT_LATTE = fixtureId(0x201);
const PRODUCT_OLLA = fixtureId(0x202);
const PRODUCT_CUP = fixtureId(0x203);
const PRODUCT_CAKE = fixtureId(0x204);
const PRODUCT_UNMAPPED = fixtureId(0x205);
/** One plate of a gram of beans: a high margin sold often, so it is a star. */
const PRODUCT_STAR = fixtureId(0x206);
/** One plate of a cup priced below its own cost: rarely sold, so it is a dog. */
const PRODUCT_DOG = fixtureId(0x207);
/** The product whose recipe is written through the command door in the cost history. */
const PRODUCT_STORED = fixtureId(0x208);

const RECIPE_LATTE = fixtureId(0x301);
const RECIPE_OLLA = fixtureId(0x302);
const RECIPE_CAKE = fixtureId(0x303);
const RECIPE_STORED = fixtureId(0x304);

const OPTION_GROUP_LATTE = fixtureId(0x401);
const MODIFIER_SYRUP = fixtureId(0x402);

const MAPPING_LATTE = fixtureId(0x501);
const MAPPING_OLLA = fixtureId(0x502);
const MAPPING_CUP = fixtureId(0x503);
const MAPPING_CAKE = fixtureId(0x504);
const MAPPING_STAR = fixtureId(0x505);
const MAPPING_DOG = fixtureId(0x506);

/**
 * THE COSTS, AND THE ARITHMETIC THEY PRODUCE — worked out here so every assertion below
 * is a number and not a shape.
 *
 *   beans   10.000 kg at $120.50 and 5.000 kg at $110.00
 *           → (10000×12050 + 5000×11000) / 15000 = 175500000/15000 = 11700 exactly.
 *             The unweighted mean, 11525, is the number a spreadsheet would print.
 *   milk    20.000 L at $35.00 → 3500.
 *   syrup    5.000 L at $80.00 → 8000.
 *   cup        500 units at $1.80 → 180.
 *   napkin     200 packages at $2.50 → 250.
 *   redondeo   1 at 100 and 1 at 201 → 301/2 = 150.5 → 151 half-up.
 */
const BEANS_UNIT_COST = 11700n;
const MILK_UNIT_COST = 3500n;
const SYRUP_UNIT_COST = 8000n;
const CUP_UNIT_COST = 180n;
const NAPKIN_UNIT_COST = 250n;
const ROUNDING_UNIT_COST = 151n;

/**
 * The latte, one plate: 12 g of beans, 200 ml of milk, and a vanilla syrup reachable
 * ONLY as a modifier.
 *
 *   beans  12 × 11700 / 1000 = 140.4
 *   milk  200 ×  3500 / 1000 = 700.0
 *   cost = round(840.4) = 840; price 4500 → margin 3660, 81.33 % → 8133 bps
 */
const LATTE_PRICE = 4500n;
const LATTE_BASE_COST = 840n;
const LATTE_MARGIN = 3660n;
const LATTE_MARGIN_BPS = 8133n;

/**
 * The olla, one plate of a ten-plate batch: 600 g and 1.5 L per batch.
 *
 *   beans  60 × 11700 / 1000 = 702
 *   milk  150 ×  3500 / 1000 = 525
 *   cost = 1227; price 3800 → margin 2573, 67.71 % → 6771 bps
 */
const OLLA_COST = 1227n;
const OLLA_MARGIN = 2573n;
const OLLA_MARGIN_BPS = 6771n;

/** The day of the lattes: revenue 9000, cost round(280.8 + 2100 + 480) = 2861. */
const LATTE_DAY_COST = 2861n;
const LATTE_DAY_MARGIN = 6139n;
const LATTE_DAY_MARGIN_BPS = 6821n;

/**
 * PHASE 4, WORKED OUT HERE SO EVERY ASSERTION BELOW IS A NUMBER.
 *
 *   beans     received 15000 g. Sold in the window: 2 lattes × 12 + 1 olla × 60
 *             = 84 g. So the ledger used exactly what the recipes say.
 *   milk      sold 2 × 200 (recipe) + 1 × 150 = 550. The till consumed 750: each
 *             latte also carries the 100 ml MODIFIER, which the explosion excludes.
 *             The 200 ml difference is therefore UNEXPLAINED, and that is the point.
 *   cups      received 500, and the four sold are the four the recipe accounted for.
 *   merma     the item the period names 5 wasted, 2 damaged and a count correction
 *             that took 3 more. Actual usage 10, all of it explained.
 *   prep      the batch declared 10 and 2 were lost, so the loss IS the usage.
 */
const LOSS_RECEIVED = 100;
const LOSS_WASTE = 5;
const LOSS_DAMAGE = 2;
const LOSS_COUNT_DECREASE = 3;
const PREP_DECLARED = 10;
const PREP_SHORTFALL = 2;
const BEANS_SOLD_IN_WINDOW = 84;
const BEANS_RECEIVED = 15000;
const MILK_USED_IN_WINDOW = 750;
const MILK_THEORETICAL = 550;
const MILK_UNEXPLAINED = MILK_USED_IN_WINDOW - MILK_THEORETICAL;

/** The star: one package of its own ingredient per plate, 6 sold at $30.00. */
const STAR_UNIT_COST = 400n;
const STAR_PRICE_MINOR = 3000n;
const STAR_SOLD = 6;
/** The dog: a cup sold for $2.00 against its own $1.80 cost, sold once. */
const DOG_UNIT_COST = 180n;
const DOG_PRICE_MINOR = 200n;
const DOG_SOLD = 1;

/** The recipe written through the console's own command door: 200 ml of milk, then 100. */
const STORED_RECIPE_COST = 700n;
const STORED_RECIPE_UPDATED_COST = 350n;

const CHECK_VIOLATION = '23514';

const access: MerchantAccess = {
  merchantId: MERCHANT,
  locationId: LOCATION,
  name: 'Costing test',
  handle: null,
  timezone: null,
  membershipId: null,
  role: 'owner',
  roles: ['owner'],
  permissions: ['merchant.manage'],
};

const neighbourAccess: MerchantAccess = {
  ...access,
  merchantId: NEIGHBOUR,
  locationId: NEIGHBOUR_LOCATION,
};

/**
 * The console's own session, for the ONE write this spec makes: the recipe whose
 * stored cost the history read has to answer. Everything else here is a read.
 */
const dashboardUser: AuthUser = {
  id: USER,
  email: null,
  sessionId: DASHBOARD_SESSION,
  deviceId: null,
  commandContextType: 'dashboard_administrative',
};

const writeAccess: MerchantAccess = {
  ...access,
  membershipId: STAFF,
  permissions: ['merchant.manage', 'inventory.recipe.manage'],
};

/** A timestamp on a given trading day, in the merchant's own timezone (UTC-6). */
const at = (businessDate: string): string => `${businessDate} 18:00:00-06`;

type SeededLine = {
  productId: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  /** What ONE unit of this line takes out of stock, computed by hand. */
  consumes: {
    inventoryItemId: string;
    scale: number;
    unit: string;
    quantity: number;
    mappingId: string;
  }[];
};

describe('costing · the basis, the plate, the day, and the forecast', () => {
  let pg: PgService;
  let costing: InventoryCostingService;
  let procurement: ProcurementService;
  let commands: AdministrativeCommandExecutionService;

  /** One administrative command, exactly as the console posts it. */
  const send = (
    operation: Parameters<AdministrativeCommandExecutionService['execute']>[2]['operation'],
    input: { targetAggregateId: string; targetVersion?: number | null; parameters?: unknown },
  ) =>
    scoped(() =>
      commands.execute(dashboardUser, writeAccess, {
        operation,
        locationId: LOCATION,
        targetAggregateId: input.targetAggregateId,
        targetVersion: input.targetVersion ?? null,
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
        parameters: (input.parameters ?? {}) as Record<string, unknown>,
        approvalId: null,
      }),
    );

  const scoped = <T>(fn: () => Promise<T>) =>
    runWithRequestContext(
      { merchantId: MERCHANT, locationId: LOCATION, userId: USER, requestId: randomUUID() },
      fn,
    );

  const scopedAsNeighbour = <T>(fn: () => Promise<T>) =>
    runWithRequestContext(
      {
        merchantId: NEIGHBOUR,
        locationId: NEIGHBOUR_LOCATION,
        userId: NEIGHBOUR_USER,
        requestId: randomUUID(),
      },
      fn,
    );

  /** One purchase order, sent and received through the product's own routes. */
  const receive = async (
    input: {
      inventoryItemId: string;
      quantity: { value: number; scale: number; unit: string };
      unitCostMinor: number;
    },
    audience: { access: MerchantAccess; supplierId: string; stockRoom: string },
  ): Promise<void> => {
    const lineTotalMinor = Math.round(
      (input.quantity.value * input.unitCostMinor) / 10 ** input.quantity.scale,
    );
    const run = <T>(fn: () => Promise<T>): Promise<T> =>
      audience.access.merchantId === MERCHANT ? scoped(fn) : scopedAsNeighbour(fn);
    const quantity = input.quantity as CreatePurchaseOrderRequest['lines'][0]['quantity'];
    // `MerchantAccess.locationId` is nullable on the type and always set on the
    // request path; this spec's two audiences both carry one.
    const locationId = audience.access.locationId ?? LOCATION;

    const created = await run(() =>
      procurement.createPurchaseOrder(audience.access, {
        locationId,
        idempotencyKey: randomUUID(),
        inventoryLocationId: audience.stockRoom,
        supplierId: audience.supplierId,
        currency: 'MXN',
        expectedOn: null,
        note: null,
        lines: [
          {
            inventoryItemId: input.inventoryItemId,
            supplierSku: null,
            description: null,
            quantity,
            unitCostMinor: input.unitCostMinor,
            lineTotalMinor,
          },
        ],
      }),
    );
    const sent = await run(() =>
      procurement.sendPurchaseOrder(audience.access, {
        locationId,
        idempotencyKey: randomUUID(),
        purchaseOrderId: created.purchaseOrder.id,
        expectedVersion: created.purchaseOrder.version,
      }),
    );
    await run(() =>
      procurement.receivePurchaseOrder(audience.access, {
        locationId,
        idempotencyKey: randomUUID(),
        purchaseOrderId: sent.purchaseOrder.id,
        expectedVersion: sent.purchaseOrder.version,
        note: null,
        lines: [
          {
            purchaseOrderLineId: sent.purchaseOrder.lines[0].id,
            quantity,
            actualUnitCostMinor: input.unitCostMinor,
            lineTotalMinor,
          },
        ],
      }),
    );
  };

  const menu = { access, supplierId: SUPPLIER, stockRoom: STOCK_ROOM };
  const neighbourMenu = {
    access: neighbourAccess,
    supplierId: NEIGHBOUR_SUPPLIER,
    stockRoom: NEIGHBOUR_STOCK_ROOM,
  };

  /**
   * A committed sale, in one transaction, through the product's own writers.
   *
   * `writeOrder` writes the order and its opening event; `commit_sale_inventory` — the
   * function the till commits through — posts the consumption ledger from the
   * reservation lines. The one thing this spec types by hand is each reservation line's
   * quantity, and it types it from the arithmetic in its own header, which is what makes
   * the plate read's agreement with it evidence rather than a tautology.
   */
  const seedSale = (input: {
    businessDate: string;
    lines: SeededLine[];
    subtotalMinor: number;
    taxMinor: number;
  }): Promise<{ saleId: string; cartId: string; lineIds: string[] }> =>
    pg.runWithMerchant(
      MERCHANT,
      USER,
      async (client) => {
        const cartId = (
          await client.query<{ id: string }>(
            `INSERT INTO merchant.pos_cart
               (merchant_id, location_id, operator_session_id, original_operator_session_id,
                original_operator_user_id, operator_user_id, status, lifecycle_state, created_at)
             VALUES ($1::uuid,$2::uuid,$3::uuid,$3::uuid,$4::uuid,$4::uuid,
                     'committed','committed',$5::timestamptz)
             RETURNING id::text AS id`,
            [MERCHANT, LOCATION, OPERATOR_SESSION, USER, at(input.businessDate)],
          )
        ).rows[0].id;

        const lineIds: string[] = [];
        for (const line of input.lines) {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO merchant.pos_cart_line
               (merchant_id, cart_id, product_id, identity_key, product_name, quantity,
                base_price, tax_rate_basis_points)
             VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,1600)
             RETURNING id::text AS id`,
            [
              MERCHANT,
              cartId,
              line.productId,
              createHash('sha256').update(randomUUID()).digest('hex'),
              line.name,
              line.quantity,
              line.unitPriceMinor,
            ],
          );
          lineIds.push(inserted.rows[0].id);
        }

        const written = await writeOrder(client, {
          merchantId: MERCHANT,
          locationId: LOCATION,
          source: 'pos',
          fulfillmentType: 'dine_in',
          lines: input.lines.map((line) => ({
            productId: line.productId,
            name: line.name,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceMinor,
          })),
        });

        const paymentAttemptId = randomUUID();
        const grandTotal = input.subtotalMinor + input.taxMinor;
        // `proof_source` is NOT optional for a success: `payment_attempt_success_provenance_ck`
        // (70_tender.sql) requires every `succeeded` attempt to NAME what proved it, so a fixture
        // written before that rule fails outright — and it failed here, on a pristine database,
        // because this suite is one of the ones no scoped integration script runs. The sale this
        // fixture writes is a cash one, which is also what the till writes for cash, so the proof
        // is `cash`.
        await client.query(
          `INSERT INTO merchant.pos_payment_attempt
             (id, merchant_id, location_id, cart_id, method, amount_minor_units, currency,
              status, proof_source, correlation_id, resolved_at)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'cash',$5,'MXN','succeeded','cash',$6,now())`,
          [paymentAttemptId, MERCHANT, LOCATION, cartId, grandTotal, `costing-${paymentAttemptId}`],
        );

        const receiptId = (
          await client.query<{ id: string }>(
            `INSERT INTO merchant.receipt_snapshot
               (merchant_id, location_id, order_id, payment_attempt_id, receipt_number,
                business_date, currency, grand_total, snapshot)
             VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::date,'MXN',$7,$8::jsonb)
             RETURNING id::text AS id`,
            [
              MERCHANT,
              LOCATION,
              written.orderId,
              paymentAttemptId,
              `COSTEO-${randomUUID().slice(0, 8)}`,
              input.businessDate,
              grandTotal,
              JSON.stringify({
                subtotal: { minorUnits: input.subtotalMinor, currency: 'MXN' },
                taxTotal: { minorUnits: input.taxMinor, currency: 'MXN' },
                grandTotal: { minorUnits: grandTotal, currency: 'MXN' },
              }),
            ],
          )
        ).rows[0].id;

        const saleId = (
          await client.query<{ id: string }>(
            `INSERT INTO merchant.pos_committed_sale
               (merchant_id, location_id, cart_id, order_id, payment_attempt_id,
                receipt_snapshot_id, totals_fingerprint, committed_at)
             VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8::timestamptz)
             RETURNING id::text AS id`,
            [
              MERCHANT,
              LOCATION,
              cartId,
              written.orderId,
              paymentAttemptId,
              receiptId,
              createHash('sha256').update(`${cartId}:${grandTotal}`).digest('hex'),
              at(input.businessDate),
            ],
          )
        ).rows[0].id;

        const reservationId = randomUUID();
        const commandId = randomUUID();
        await client.query(
          `INSERT INTO merchant.inventory_reservation
             (id, merchant_id, location_id, cart_id, status, cart_version, line_snapshot,
              expires_at)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'reserved',1,'{}'::jsonb,
                   now()+interval '10 minutes')`,
          [reservationId, MERCHANT, LOCATION, cartId],
        );

        for (const [index, line] of input.lines.entries()) {
          for (const consumed of line.consumes) {
            const mappingId = consumed.mappingId;
            await client.query(
              `INSERT INTO merchant.inventory_reservation_line
                 (merchant_id, location_id, reservation_id, inventory_location_id,
                  inventory_item_id, sale_line_id, required_quantity, quantity_scale, unit,
                  mapping_id, mapping_version, availability_sequence)
               VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,
                       $10::uuid,1,0)`,
              [
                MERCHANT,
                LOCATION,
                reservationId,
                STOCK_ROOM,
                consumed.inventoryItemId,
                lineIds[index],
                consumed.quantity * line.quantity,
                consumed.scale,
                consumed.unit,
                mappingId,
              ],
            );
            /*
             * The reservation has to be POSTED, not merely recorded. `append_stock_ledger`
             * is the only door onto stock, and it refuses a commit that would drive
             * `reserved` below zero — which is exactly what a hand-written reservation
             * without its `reservation_created` entries would do. Using the real function
             * here is what keeps this fixture honest.
             */
            await client.query(
              `SELECT merchant.append_stock_ledger(
                 $1::uuid,$2::uuid,$3::uuid,$4::uuid,'reservation_created',$5,$6::uuid,
                 $6::uuid,$7,'inventory_reservation',$8::uuid,$9::uuid,$10::uuid,1,$11::date,$12,
                 null,$13::uuid,null,null,'{}'::jsonb)`,
              [
                MERCHANT,
                LOCATION,
                STOCK_ROOM,
                consumed.inventoryItemId,
                consumed.quantity * line.quantity,
                commandId,
                createHash('sha256').update(`${reservationId}:${mappingId}`).digest('hex'),
                reservationId,
                USER,
                DEVICE,
                input.businessDate,
                `costing-reserve-${reservationId}`,
                lineIds[index],
              ],
            );
          }
        }

        await client.query(
          `SELECT merchant.commit_sale_inventory(
             $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,1,$6::date,$7)`,
          [
            reservationId,
            saleId,
            randomUUID(),
            USER,
            DEVICE,
            input.businessDate,
            `costing-sale-${saleId}`,
          ],
        );

        return { saleId, cartId, lineIds };
      },
      LOCATION,
    );

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN) {
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a disposable build-v3 database.',
      );
    }
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    const integrity = new IntegrityService(new IntegrityRepository(pg));
    procurement = new ProcurementService(
      new ProcurementRepository(pg),
      integrity,
      new MetricsService(),
    );
    costing = new InventoryCostingService(new InventoryCostingRepository(pg), new MetricsService());
    // The console's own write path, wired exactly as `InventoryAuthoringModule` wires
    // it: the cost history's stored points are written by THIS service, not by the test.
    const authoring = new InventoryAuthoringService(
      new InventoryAuthoringRepository(pg),
      integrity,
      new InventoryCostingService(new InventoryCostingRepository(pg), new MetricsService()),
    );
    const contexts = new AdministrativeCommandContextService(
      new AdministrativeCommandRepository(pg),
    );
    // Only the context service and the inventory-authoring service are reachable from
    // the one command below; the other dispatchers are not exercised here.
    commands = new AdministrativeCommandExecutionService(
      contexts,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      authoring,
    );

    // ── the two merchants, and the till one of them owns ─────────────────────
    await pg.query(
      `INSERT INTO merchant.merchant (id,name,handle) VALUES
         ($1::uuid,'Costing Harness',$3),
         ($2::uuid,'Vecino Costing',$4)
       ON CONFLICT (id) DO NOTHING`,
      [MERCHANT, NEIGHBOUR, `costing-harness-${RUN}`, `vecino-costing-${RUN}`],
    );
    // The clock, read from the same expression `currentBusinessDate` uses, so the
    // fixture and the read cannot disagree about what day it is.
    const clock = await pg.query<{ businessDate: string }>(
      `SELECT ((now() AT TIME ZONE m.timezone) - m.business_day_start::interval)::date::text
              AS "businessDate"
         FROM merchant.merchant m WHERE m.id = $1::uuid`,
      [MERCHANT],
    );
    TODAY = clock.rows[0].businessDate;
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name) VALUES
         ($1::uuid,$3::uuid,'Centro'),($2::uuid,$4::uuid,'Vecino')
       ON CONFLICT (id) DO NOTHING`,
      [LOCATION, NEIGHBOUR_LOCATION, MERCHANT, NEIGHBOUR],
    );
    await pg.query(
      `INSERT INTO umi."user" (id,full_name) VALUES
         ($1::uuid,'Gerente Costeo'),($2::uuid,'Vecino')
       ON CONFLICT (id) DO NOTHING`,
      [USER, NEIGHBOUR_USER],
    );
    const role = await pg.query<{ id: string }>(
      `SELECT id FROM umi.role WHERE NOT is_platform LIMIT 1`,
    );
    await pg.query(
      `INSERT INTO merchant.device (id, merchant_id, location_id, name, kind, status)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Costeo','pos_terminal','active')
       ON CONFLICT (id) DO NOTHING`,
      [DEVICE, MERCHANT, LOCATION],
    );
    await pg.query(
      `INSERT INTO merchant.staff (id, merchant_id, location_id, user_id, role_id, name)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'Gerente Costeo')
       ON CONFLICT (id) DO NOTHING`,
      [STAFF, MERCHANT, LOCATION, USER, role.rows[0]?.id ?? null],
    );
    await pg.query(
      `INSERT INTO runtime.session (id, merchant_id, principal_type, principal_id, token_hash)
       VALUES ($1::uuid,$2::uuid,'user',$3::uuid,$4)
       ON CONFLICT (id) DO NOTHING`,
      [SESSION, MERCHANT, USER, randomUUID()],
    );
    // The console's administrative-command door resolves the DASHBOARD session, which is
    // a different table from the durable session above.
    await pg.query(
      `INSERT INTO runtime.dashboard_session (id,user_id,token_hash,is_active,expires_at)
       VALUES ($1::uuid,$2::uuid,$3,true,now()+interval '8 hours')
       -- REFRESH on conflict instead of skipping: a fixture that only inserts is a
       -- fixture that expires.
       ON CONFLICT (id) DO UPDATE SET expires_at=now()+interval '8 hours', is_active=true`,
      [
        DASHBOARD_SESSION,
        USER,
        createHash('sha256').update(`costing-dashboard:${DASHBOARD_SESSION}`).digest('hex'),
      ],
    );

    await pg.query(
      `INSERT INTO runtime.operator_session
         (id, durable_session_id, user_id, staff_id, device_id, merchant_id, location_id,
          permissions, entitlements, expires_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
               ARRAY['sale.lifecycle'],'[{"featureKey":"pos","enabled":true}]',
               now()+interval '8 hours')
       ON CONFLICT (id) DO NOTHING`,
      [OPERATOR_SESSION, SESSION, USER, STAFF, DEVICE, MERCHANT, LOCATION],
    );
    await pg.query(
      `INSERT INTO merchant.inventory_location
         (id,merchant_id,location_id,public_reference,display_name,location_type)
       VALUES ($1::uuid,$3::uuid,$4::uuid,'ALMACEN','Almacén','stock_room'),
              ($2::uuid,$5::uuid,$6::uuid,'ALMACEN','Almacén','stock_room')
       ON CONFLICT (id) DO NOTHING`,
      [STOCK_ROOM, NEIGHBOUR_STOCK_ROOM, MERCHANT, LOCATION, NEIGHBOUR, NEIGHBOUR_LOCATION],
    );
    await pg.query(
      `INSERT INTO merchant.supplier (id, merchant_id, public_reference, display_name)
       VALUES ($1::uuid,$3::uuid,'PROVEEDOR','Proveedor'),
              ($2::uuid,$4::uuid,'PROVEEDOR','Vecino')
       ON CONFLICT (id) DO NOTHING`,
      [SUPPLIER, NEIGHBOUR_SUPPLIER, MERCHANT, NEIGHBOUR],
    );

    // ── the ingredients ──────────────────────────────────────────────────────
    await pg.query(
      `INSERT INTO merchant.inventory_item
         (id,merchant_id,public_reference,display_name,item_type,base_unit,quantity_scale,
          low_stock_threshold)
       VALUES
         ($1::uuid,$9::uuid,'CAFE-GRANO','Café en grano','ingredient','kilogram',3,null),
         ($2::uuid,$9::uuid,'LECHE','Leche entera','ingredient','liter',3,null),
         ($3::uuid,$9::uuid,'JARABE','Jarabe de vainilla','ingredient','liter',3,null),
         ($4::uuid,$9::uuid,'VASO','Vaso 12 oz','packaging','unit',0,null),
         ($5::uuid,$9::uuid,'AZUCAR','Azúcar','ingredient','kilogram',3,null),
         ($6::uuid,$9::uuid,'SERVILLETA','Servilleta','operational_supply','package',0,150),
         ($7::uuid,$9::uuid,'REDONDEO','Artículo de redondeo','operational_supply','package',0,null),
         ($8::uuid,$10::uuid,'CAFE-VECINO','Café vecino','ingredient','kilogram',3,null)
       ON CONFLICT (id) DO NOTHING`,
      [
        ITEM_BEANS,
        ITEM_MILK,
        ITEM_SYRUP,
        ITEM_CUP,
        ITEM_SUGAR,
        ITEM_NAPKIN,
        ITEM_ROUNDING,
        ITEM_NEIGHBOUR,
        MERCHANT,
        NEIGHBOUR,
      ],
    );

    // ── the menu ─────────────────────────────────────────────────────────────
    await pg.query(
      `INSERT INTO merchant.product (id,merchant_id,name,price,active) VALUES
         ($1::uuid,$5::uuid,'Latte',4500,true),
         ($2::uuid,$5::uuid,'Café de olla',3800,true),
         ($3::uuid,$5::uuid,'Vaso extra',500,true),
         ($4::uuid,$5::uuid,'Panqué',3500,true),
         ($6::uuid,$5::uuid,'Producto sin receta',9900,true)
       ON CONFLICT (id) DO NOTHING`,
      [PRODUCT_LATTE, PRODUCT_OLLA, PRODUCT_CUP, PRODUCT_CAKE, MERCHANT, PRODUCT_UNMAPPED],
    );
    await pg.query(
      `INSERT INTO merchant.product_option_group (id,product_id,name,min_select,max_select)
       VALUES ($1::uuid,$2::uuid,'Extras',0,3)
       ON CONFLICT (id) DO NOTHING`,
      [OPTION_GROUP_LATTE, PRODUCT_LATTE],
    );
    await pg.query(
      `INSERT INTO merchant.product_modifier (id,option_group_id,name,price_delta)
       VALUES ($1::uuid,$2::uuid,'Jarabe de vainilla',500)
       ON CONFLICT (id) DO NOTHING`,
      [MODIFIER_SYRUP, OPTION_GROUP_LATTE],
    );

    /*
     * THE RECIPES. A component is written at its own `quantity_scale`, and the
     * checkout's expression converts it into the ITEM's scale:
     *
     *   required = quantity × conversion_numerator × 10^(yield_scale + item_scale)
     *              / (yield_quantity × conversion_denominator × 10^(component_scale))
     *
     * Written at the item's own scale with a 1:1 conversion, that is
     * `quantity / yield_quantity`: the latte's 12 g of beans is 12 at scale 3, and the
     * olla's 600 g across a batch of ten is 60 per plate.
     */
    await pg.query(
      `INSERT INTO merchant.inventory_recipe
         (id,merchant_id,product_id,version,yield_quantity,yield_scale,yield_unit,active)
       VALUES ($1::uuid,$4::uuid,$5::uuid,1,1,0,'portion',true),
              ($2::uuid,$4::uuid,$6::uuid,1,10,0,'portion',true),
              ($3::uuid,$4::uuid,$7::uuid,1,1,0,'portion',true)
       ON CONFLICT (id) DO NOTHING`,
      [RECIPE_LATTE, RECIPE_OLLA, RECIPE_CAKE, MERCHANT, PRODUCT_LATTE, PRODUCT_OLLA, PRODUCT_CAKE],
    );
    await pg.query(
      `INSERT INTO merchant.inventory_recipe_component
         (merchant_id,recipe_id,inventory_item_id,modifier_id,quantity,unit,quantity_scale,
          conversion_numerator,conversion_denominator)
       VALUES
         ($1::uuid,$2::uuid,$5::uuid,null,12,'gram',3,1,1),
         ($1::uuid,$2::uuid,$6::uuid,null,200,'milliliter',3,1,1),
         ($1::uuid,$2::uuid,$7::uuid,$8::uuid,30,'milliliter',3,1,1),
         ($1::uuid,$3::uuid,$5::uuid,null,600,'gram',3,1,1),
         ($1::uuid,$3::uuid,$6::uuid,null,1500,'milliliter',3,1,1),
         ($1::uuid,$4::uuid,$9::uuid,null,50,'gram',3,1,1)
       ON CONFLICT (recipe_id,inventory_item_id,modifier_id) DO NOTHING`,
      [
        MERCHANT,
        RECIPE_LATTE,
        RECIPE_OLLA,
        RECIPE_CAKE,
        ITEM_BEANS,
        ITEM_MILK,
        ITEM_SYRUP,
        MODIFIER_SYRUP,
        ITEM_SUGAR,
      ],
    );
    await pg.query(
      `INSERT INTO merchant.inventory_catalog_mapping
         (id,merchant_id,product_id,mapping_type,inventory_item_id,recipe_id,
          conversion_numerator,conversion_denominator,version,active)
       VALUES
         ($1::uuid,$5::uuid,$6::uuid,'recipe',null,$7::uuid,1,1,1,true),
         ($2::uuid,$5::uuid,$8::uuid,'recipe',null,$9::uuid,1,1,1,true),
         ($3::uuid,$5::uuid,$10::uuid,'direct',$11::uuid,null,1,1,1,true),
         ($4::uuid,$5::uuid,$12::uuid,'recipe',null,$13::uuid,1,1,1,true)
       ON CONFLICT (id) DO NOTHING`,
      [
        MAPPING_LATTE,
        MAPPING_OLLA,
        MAPPING_CUP,
        MAPPING_CAKE,
        MERCHANT,
        PRODUCT_LATTE,
        RECIPE_LATTE,
        PRODUCT_OLLA,
        RECIPE_OLLA,
        PRODUCT_CUP,
        ITEM_CUP,
        PRODUCT_CAKE,
        RECIPE_CAKE,
      ],
    );

    /*
     * THE PHASE 4 FIXTURES. A prep item the kitchen produces (so a yield loss has
     * something to be short OF), two products whose plate margins make a star and a dog
     * — the four menu classes need four items, and the two plates above are a plow horse
     * and a puzzle — and one item that exists to carry the named losses.
     *
     * THEY ALL SIT ON THEIR OWN ITEMS, deliberately: the cases above assert exact
     * quantities for the beans, the cups and the napkins, and a new fixture that
     * consumed them would silently move those numbers.
     */
    await pg.query(
      `INSERT INTO merchant.inventory_item
         (id,merchant_id,public_reference,display_name,item_type,base_unit,quantity_scale)
       VALUES ($1::uuid,$2::uuid,'PREP-COSTEO','Prep de costeo','composite_component',
               'portion',0),
              ($3::uuid,$2::uuid,'GRANOLA-COSTEO','Granola de costeo','ingredient',
               'package',0),
              ($4::uuid,$2::uuid,'VASO-COSTEO','Vaso de costeo','packaging','unit',0),
              ($5::uuid,$2::uuid,'MERMA-COSTEO','Merma de costeo','operational_supply',
               'package',0)
       ON CONFLICT (id) DO NOTHING`,
      [ITEM_PREP, MERCHANT, ITEM_STAR, ITEM_DOG, ITEM_LOSS],
    );
    await pg.query(
      `INSERT INTO merchant.product (id,merchant_id,name,price,active) VALUES
         ($1::uuid,$4::uuid,'Estrella de costeo',3000,true),
         ($2::uuid,$4::uuid,'Perro de costeo',200,true),
         ($3::uuid,$4::uuid,'Plato con costo guardado',5000,true)
       ON CONFLICT (id) DO NOTHING`,
      [PRODUCT_STAR, PRODUCT_DOG, PRODUCT_STORED, MERCHANT],
    );
    // One package per star, one unit per dog: direct mappings, so the plate cost is one
    // unit of the item at the item's own scale.
    await pg.query(
      `INSERT INTO merchant.inventory_catalog_mapping
         (id,merchant_id,product_id,mapping_type,inventory_item_id,recipe_id,
          conversion_numerator,conversion_denominator,version,active)
       VALUES ($1::uuid,$3::uuid,$4::uuid,'direct',$5::uuid,null,1,1,1,true),
              ($2::uuid,$3::uuid,$6::uuid,'direct',$7::uuid,null,1,1,1,true)
       ON CONFLICT (id) DO NOTHING`,
      [MAPPING_STAR, MAPPING_DOG, MERCHANT, PRODUCT_STAR, ITEM_STAR, PRODUCT_DOG, ITEM_DOG],
    );

    // ── what the suppliers actually charged ─────────────────────────────────
    await receive(
      {
        inventoryItemId: ITEM_BEANS,
        quantity: { value: 10000, scale: 3, unit: 'kilogram' },
        unitCostMinor: 12050,
      },
      menu,
    );
    await receive(
      {
        inventoryItemId: ITEM_BEANS,
        quantity: { value: 5000, scale: 3, unit: 'kilogram' },
        unitCostMinor: 11000,
      },
      menu,
    );
    await receive(
      {
        inventoryItemId: ITEM_MILK,
        quantity: { value: 20000, scale: 3, unit: 'liter' },
        unitCostMinor: 3500,
      },
      menu,
    );
    await receive(
      {
        inventoryItemId: ITEM_SYRUP,
        quantity: { value: 5000, scale: 3, unit: 'liter' },
        unitCostMinor: 8000,
      },
      menu,
    );
    await receive(
      {
        inventoryItemId: ITEM_CUP,
        quantity: { value: 500, scale: 0, unit: 'unit' },
        unitCostMinor: 180,
      },
      menu,
    );
    await receive(
      {
        inventoryItemId: ITEM_NAPKIN,
        quantity: { value: 100, scale: 0, unit: 'package' },
        unitCostMinor: 250,
      },
      menu,
    );
    // The half-centavo pair: 301/2 = 150.5, which must round UP to 151.
    await receive(
      {
        inventoryItemId: ITEM_ROUNDING,
        quantity: { value: 1, scale: 0, unit: 'package' },
        unitCostMinor: 100,
      },
      menu,
    );
    await receive(
      {
        inventoryItemId: ITEM_ROUNDING,
        quantity: { value: 1, scale: 0, unit: 'package' },
        unitCostMinor: 201,
      },
      menu,
    );
    // The phase 4 items, each priced by its own receipt.
    await receive(
      {
        inventoryItemId: ITEM_STAR,
        quantity: { value: 1000, scale: 0, unit: 'package' },
        unitCostMinor: Number(STAR_UNIT_COST),
      },
      menu,
    );
    await receive(
      {
        inventoryItemId: ITEM_DOG,
        quantity: { value: 100, scale: 0, unit: 'unit' },
        unitCostMinor: Number(DOG_UNIT_COST),
      },
      menu,
    );
    await receive(
      {
        inventoryItemId: ITEM_LOSS,
        quantity: { value: LOSS_RECEIVED, scale: 0, unit: 'package' },
        unitCostMinor: 250,
      },
      menu,
    );
    // The neighbour's own receipt, so the isolation case compares two real numbers
    // rather than two empty sets.
    await receive(
      {
        inventoryItemId: ITEM_NEIGHBOUR,
        quantity: { value: 4000, scale: 3, unit: 'kilogram' },
        unitCostMinor: 9900,
      },
      neighbourMenu,
    );

    // ── the sales, on four trading days ─────────────────────────────────────

    /*
     * The sugar is on the shelf, and always has been — it was counted in when the café
     * started using this system, not bought through a purchase order. That is the real
     * shape of an item with STOCK and NO COST BASIS, and it is the case this suite
     * exists for: the stock is real, the price is unknown, and the read must say so.
     */
    await pg.runWithMerchant(
      MERCHANT,
      USER,
      (client) =>
        client.query(
          `SELECT merchant.append_stock_ledger(
             $1::uuid,$2::uuid,$3::uuid,$4::uuid,'opening_balance',2000,$5::uuid,$5::uuid,
             $6,'inventory_count',$7::uuid,$8::uuid,$9::uuid,1,'${dayAt(-120)}'::date,
             'costing-opening-balance',null,null,null,null,'{}'::jsonb)`,
          [
            MERCHANT,
            LOCATION,
            STOCK_ROOM,
            ITEM_SUGAR,
            randomUUID(),
            createHash('sha256').update(`opening:${ITEM_SUGAR}`).digest('hex'),
            randomUUID(),
            USER,
            DEVICE,
          ],
        ),
      LOCATION,
    );

    /*
     * THE PERIOD'S NAMED MOVEMENTS. Waste, damage and a count correction on the
     * napkins, and a production batch on the prep: it declared ten and two never
     * arrived, so the shortfall is written off under its own name.
     */
    const appendLedger = (input: {
      entryType: string;
      inventoryItemId: string;
      quantity: number;
      publicData?: Record<string, unknown>;
    }): Promise<unknown> =>
      pg.runWithMerchant(
        MERCHANT,
        USER,
        (client) =>
          client.query(
            `SELECT merchant.append_stock_ledger(
               $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::bigint,$7::uuid,$8::uuid,
               $9::text,'inventory_count',$10::uuid,$11::uuid,$12::uuid,1,$13::date,$14::text,
               null,null,null,null,$15::jsonb,null)`,
            [
              MERCHANT,
              LOCATION,
              STOCK_ROOM,
              input.inventoryItemId,
              input.entryType,
              input.quantity,
              randomUUID(),
              randomUUID(),
              createHash('sha256')
                .update(`costing-movement:${input.entryType}:${randomUUID()}`)
                .digest('hex'),
              randomUUID(),
              USER,
              DEVICE,
              TODAY,
              `costing-${input.entryType}`,
              JSON.stringify(input.publicData ?? {}),
            ],
          ),
        LOCATION,
      );
    await appendLedger({
      entryType: 'waste_recorded',
      inventoryItemId: ITEM_LOSS,
      quantity: LOSS_WASTE,
    });
    await appendLedger({
      entryType: 'damage_recorded',
      inventoryItemId: ITEM_LOSS,
      quantity: LOSS_DAMAGE,
    });
    await appendLedger({
      entryType: 'count_correction',
      inventoryItemId: ITEM_LOSS,
      quantity: LOSS_COUNT_DECREASE,
      publicData: { direction: 'decrease' },
    });
    // The credit lands FIRST: a shortfall on a fresh prep would otherwise drive the
    // balance below zero and the ledger would refuse an ordinary loss.
    await appendLedger({
      entryType: 'production_produced',
      inventoryItemId: ITEM_PREP,
      quantity: PREP_DECLARED,
    });
    await appendLedger({
      entryType: 'production_yield_loss',
      inventoryItemId: ITEM_PREP,
      quantity: PREP_SHORTFALL,
    });

    /*
     * TODAY-6 · two lattes. Each plate consumes 12 g of beans and 200 ml of milk,
     * plus the 30 ml of vanilla syrup the customer asked for — the component that
     * exists ONLY as a modifier, which the plate's recipe cost must exclude and whose
     * stock must still be counted. Cost of goods, by hand:
     *
     *   beans   2×12  = 24   →   24 × 11700 / 1000 =  280.8
     *   milk    2×300 = 600  →  600 ×  3500 / 1000 = 2100.0   (200 base + 100 modifier)
     *   syrup   2×30  = 60   →   60 ×  8000 / 1000 =  480.0
     *   → round(2860.8) = 2861; revenue 9000 → margin 6139, 68.21 % → 6821 bps
     */
    await seedSale({
      businessDate: dayAt(-6),
      lines: [
        {
          productId: PRODUCT_LATTE,
          name: 'Latte',
          quantity: 2,
          unitPriceMinor: 4500,
          consumes: [
            {
              inventoryItemId: ITEM_BEANS,
              scale: 3,
              unit: 'kilogram',
              quantity: 12,
              mappingId: MAPPING_LATTE,
            },
            {
              inventoryItemId: ITEM_MILK,
              scale: 3,
              unit: 'liter',
              quantity: 300,
              mappingId: MAPPING_LATTE,
            },
            {
              inventoryItemId: ITEM_SYRUP,
              scale: 3,
              unit: 'liter',
              quantity: 30,
              mappingId: MAPPING_LATTE,
            },
          ],
        },
      ],
      subtotalMinor: 9000,
      taxMinor: 1440,
    });

    /*
     * TODAY-1 · one café de olla from a batch of ten:
     *   beans 60 × 11700/1000 = 702, milk 150 × 3500/1000 = 525 → 1227;
     *   revenue 3800 → margin 2573, 67.71 % → 6771 bps.
     */
    await seedSale({
      businessDate: dayAt(-1),
      lines: [
        {
          productId: PRODUCT_OLLA,
          name: 'Café de olla',
          quantity: 1,
          unitPriceMinor: 3800,
          consumes: [
            {
              inventoryItemId: ITEM_BEANS,
              scale: 3,
              unit: 'kilogram',
              quantity: 60,
              mappingId: MAPPING_OLLA,
            },
            {
              inventoryItemId: ITEM_MILK,
              scale: 3,
              unit: 'liter',
              quantity: 150,
              mappingId: MAPPING_OLLA,
            },
          ],
        },
      ],
      subtotalMinor: 3800,
      taxMinor: 608,
    });

    /*
     * TODAY-46 · three extra cups, OUTSIDE the 28-day window. This is what proves the
     * window is a window: the forecast must count only what falls inside it.
     */
    await seedSale({
      businessDate: dayAt(-46),
      lines: [
        {
          productId: PRODUCT_CUP,
          name: 'Vaso extra',
          quantity: 3,
          unitPriceMinor: 500,
          consumes: [
            {
              inventoryItemId: ITEM_CUP,
              scale: 0,
              unit: 'unit',
              quantity: 1,
              mappingId: MAPPING_CUP,
            },
          ],
        },
      ],
      subtotalMinor: 1500,
      taxMinor: 240,
    });

    /* TODAY · four more cups, INSIDE the window. */
    await seedSale({
      businessDate: dayAt(0),
      lines: [
        {
          productId: PRODUCT_CUP,
          name: 'Vaso extra',
          quantity: 4,
          unitPriceMinor: 500,
          consumes: [
            {
              inventoryItemId: ITEM_CUP,
              scale: 0,
              unit: 'unit',
              quantity: 1,
              mappingId: MAPPING_CUP,
            },
          ],
        },
      ],
      subtotalMinor: 2000,
      taxMinor: 320,
    });

    /*
     * TODAY-63 · one panqué, whose only ingredient has never been received. The day's
     * cost is UNKNOWN, and the one answer that must never come back is zero — a hundred
     * percent margin on a plate whose ingredients nobody has priced.
     */
    await seedSale({
      businessDate: dayAt(-63),
      lines: [
        {
          productId: PRODUCT_CAKE,
          name: 'Panqué',
          quantity: 1,
          unitPriceMinor: 3500,
          consumes: [
            {
              inventoryItemId: ITEM_SUGAR,
              scale: 3,
              unit: 'kilogram',
              quantity: 50,
              mappingId: MAPPING_CAKE,
            },
          ],
        },
      ],
      subtotalMinor: 3500,
      taxMinor: 560,
    });

    /*
     * TODAY-62 · one product NOTHING maps. The kitchen made it, the till sold it, and
     * no recipe says what it consumed — so no stock reached the ledger. This is the day
     * the read must refuse to price: reporting it at zero cost would be a hundred percent
     * margin on a plate whose ingredients nobody recorded.
     */
    await seedSale({
      businessDate: dayAt(-62),
      lines: [
        {
          productId: PRODUCT_UNMAPPED,
          name: 'Producto sin receta',
          quantity: 1,
          unitPriceMinor: 9900,
          consumes: [],
        },
      ],
      subtotalMinor: 9900,
      taxMinor: 1584,
    });

    /*
     * TODAY · six stars and one dog. The two extremes the menu classes need: a plate of
     * a single gram of beans sold six times (high margin, popular) and a cup sold below
     * its own cost once (low margin, unpopular).
     */
    await seedSale({
      businessDate: dayAt(0),
      lines: [
        {
          productId: PRODUCT_STAR,
          name: 'Estrella de costeo',
          quantity: STAR_SOLD,
          unitPriceMinor: Number(STAR_PRICE_MINOR),
          consumes: [
            {
              inventoryItemId: ITEM_STAR,
              scale: 0,
              unit: 'package',
              quantity: 1,
              mappingId: MAPPING_STAR,
            },
          ],
        },
        {
          productId: PRODUCT_DOG,
          name: 'Perro de costeo',
          quantity: DOG_SOLD,
          unitPriceMinor: Number(DOG_PRICE_MINOR),
          consumes: [
            {
              inventoryItemId: ITEM_DOG,
              scale: 0,
              unit: 'unit',
              quantity: 1,
              mappingId: MAPPING_DOG,
            },
          ],
        },
      ],
      subtotalMinor: Number(STAR_PRICE_MINOR) * STAR_SOLD + Number(DOG_PRICE_MINOR) * DOG_SOLD,
      taxMinor: 0,
    });
  });

  afterAll(async () => {
    /**
     * NOTHING IS CLEANED UP, and this is the schema's decision rather than a shortcut: a
     * receipt and a ledger entry are immutable by construction, so the money this spec
     * spent and the stock it consumed cannot be taken back. Every fixture lives under
     * this spec's own merchant id and every assertion is scoped to it.
     */
    await pg.onModuleDestroy();
  });

  it('averages the ACTUAL received prices, weighted by quantity, not by invoice', async () => {
    const basis = await costing.costBasis(access, { includeWithoutReceipts: true });
    const beans = basis.items.find((item) => item.inventoryItemId === ITEM_BEANS)!;
    // 10 kg at $120.50 and 5 kg at $110.00 is $117.00 — not the $115.25 mean of two
    // invoices, which is what a per-invoice average would have printed.
    expect(beans.unitCostMinor).toBe(Number(BEANS_UNIT_COST));
    expect(beans.basis).toBe('weighted_average_of_receipts');
    expect(beans.receiptCount).toBe(2);
    expect(beans.receiptLineCount).toBe(2);
    expect(beans.receivedQuantity).toMatchObject({ value: 15000, scale: 3, unit: 'kilogram' });
    expect(beans.lowestUnitCostMinor).toBe(11000);
    expect(beans.highestUnitCostMinor).toBe(12050);

    const milk = basis.items.find((item) => item.inventoryItemId === ITEM_MILK)!;
    expect(milk.unitCostMinor).toBe(Number(MILK_UNIT_COST));
    expect(milk.receiptCount).toBe(1);
  });

  it('rounds the average half up, once, at the end', async () => {
    const basis = await costing.costBasis(access, { includeWithoutReceipts: true });
    const rounding = basis.items.find((item) => item.inventoryItemId === ITEM_ROUNDING)!;
    // (1×100 + 1×201)/2 = 150.5 → 151. Half-to-even would have said 150.
    expect(rounding.unitCostMinor).toBe(Number(ROUNDING_UNIT_COST));
    expect(rounding.receiptCount).toBe(2);
  });

  it('reports an item with no receipt as having NO basis, not as zero', async () => {
    const withGaps = await costing.costBasis(access, { includeWithoutReceipts: true });
    const sugar = withGaps.items.find((item) => item.inventoryItemId === ITEM_SUGAR)!;
    expect(sugar.basis).toBe('no_receipts');
    expect(sugar.unitCostMinor).toBeNull();
    expect(sugar.receiptCount).toBe(0);
    expect(sugar.receivedQuantity.value).toBe(0);

    // And the default read leaves it out entirely rather than showing a zero.
    const priced = await costing.costBasis(access, { includeWithoutReceipts: false });
    expect(priced.items.some((item) => item.inventoryItemId === ITEM_SUGAR)).toBe(false);
  });

  it('prices a plate to the centavo, and prices the batch divide correctly', async () => {
    const plates = await costing.plates(access, {
      includeUnmapped: false,
      limit: 200,
      consumptionFrom: dayAt(-27),
      consumptionTo: dayAt(0),
    });
    const latte = plates.plates.find((plate) => plate.productId === PRODUCT_LATTE)!;
    expect(latte.state).toBe('complete');
    expect(latte.mappingType).toBe('recipe');
    expect(latte.priceMinor).toBe(Number(LATTE_PRICE));
    expect(latte.costMinor).toBe(Number(LATTE_BASE_COST));
    expect(latte.marginMinor).toBe(Number(LATTE_MARGIN));
    expect(latte.marginBasisPoints).toBe(Number(LATTE_MARGIN_BPS));
    expect(latte.defects).toEqual([]);
    expect(latte.uncostedItems).toEqual([]);

    const beans = latte.components.find((c) => c.inventoryItemId === ITEM_BEANS)!;
    expect(beans).toMatchObject({ source: 'recipe_component', hasCostBasis: true });
    expect(beans.quantity).toMatchObject({ value: 12, scale: 3, unit: 'kilogram' });
    expect(beans.unitCostMinor).toBe(Number(BEANS_UNIT_COST));
    // 12 × 11700 / 1000 = 140.4 → the line's own cost rounds to 140.
    expect(beans.lineCostMinor).toBe(140);

    const olla = plates.plates.find((plate) => plate.productId === PRODUCT_OLLA)!;
    expect(olla.costMinor).toBe(Number(OLLA_COST));
    expect(olla.marginMinor).toBe(Number(OLLA_MARGIN));
    expect(olla.marginBasisPoints).toBe(Number(OLLA_MARGIN_BPS));
    // The yield divides: 600 g across a batch of ten is 60 g per plate.
    expect(olla.components.find((c) => c.inventoryItemId === ITEM_BEANS)!.quantity.value).toBe(60);
    expect(olla.components.find((c) => c.inventoryItemId === ITEM_MILK)!.quantity.value).toBe(150);

    const cup = plates.plates.find((plate) => plate.productId === PRODUCT_CUP)!;
    expect(cup.mappingType).toBe('direct');
    expect(cup.costMinor).toBe(Number(CUP_UNIT_COST));
    expect(cup.marginMinor).toBe(500 - Number(CUP_UNIT_COST));
  });

  it('reports the recipe cost WITHOUT the modifier and the consumption WITH it', async () => {
    const plates = await costing.plates(access, {
      productId: PRODUCT_LATTE,
      includeUnmapped: false,
      limit: 200,
      consumptionFrom: dayAt(-27),
      consumptionTo: dayAt(0),
    });
    const latte = plates.plates[0];
    // The base recipe is beans and milk. The syrup is a modifier, so it is not in the
    // plate's cost — 840 is the number a menu should be priced against.
    expect(latte.costMinor).toBe(Number(LATTE_BASE_COST));

    const milk = latte.components.find((c) => c.inventoryItemId === ITEM_MILK)!;
    // 200 ml is what the RECIPE says one plate is made of. What left the shelf is 600 ml:
    // two plates, each with its 200 ml plus the extra 100 ml the customer asked for.
    expect(milk.quantity.value).toBe(200);
    expect(milk.consumedQuantity.value).toBe(600);

    const syrup = latte.components.find((c) => c.inventoryItemId === ITEM_SYRUP)!;
    expect(syrup.source).toBe('modifier_component');
    expect(syrup.quantity.value).toBe(0);
    expect(syrup.consumedQuantity.value).toBe(60);
    // It has a cost basis, but it is not part of this plate's recipe cost.
    expect(syrup.hasCostBasis).toBe(true);
    expect(syrup.lineCostMinor).toBeNull();
  });

  it('reports a plate whose ingredient has no price as INCOMPLETE, naming the item', async () => {
    const plates = await costing.plates(access, {
      productId: PRODUCT_CAKE,
      includeUnmapped: false,
      limit: 200,
    });
    const cake = plates.plates[0];
    expect(cake.state).toBe('incomplete');
    expect(cake.defects).toContain('no_cost_basis');
    // The whole point: no cost and no margin, NOT a cheap plate at 100 % margin.
    expect(cake.costMinor).toBeNull();
    expect(cake.marginMinor).toBeNull();
    expect(cake.marginBasisPoints).toBeNull();
    expect(cake.uncostedItems).toEqual([
      {
        inventoryItemId: ITEM_SUGAR,
        publicReference: 'AZUCAR',
        displayName: 'Azúcar',
        defect: 'no_cost_basis',
      },
    ]);
    // The component is still on the plate, with its quantity, so the gap is visible
    // rather than hidden by the missing price.
    const sugar = cake.components.find((c) => c.inventoryItemId === ITEM_SUGAR)!;
    expect(sugar.quantity.value).toBe(50);
    expect(sugar.unitCostMinor).toBeNull();
    expect(sugar.lineCostMinor).toBeNull();
    expect(sugar.hasCostBasis).toBe(false);
  });

  it('names the products nothing maps, when asked', async () => {
    const plates = await costing.plates(access, { includeUnmapped: true, limit: 200 });
    const unmapped = plates.plates.find((plate) => plate.productId === PRODUCT_UNMAPPED)!;
    expect(unmapped.state).toBe('not_costed');
    expect(unmapped.mappingType).toBeNull();
    expect(unmapped.defects).toContain('no_inventory_mapping');
    expect(unmapped.costMinor).toBeNull();

    // And the default list leaves it off rather than pricing it at nothing.
    const mapped = await costing.plates(access, { includeUnmapped: false, limit: 200 });
    expect(mapped.plates.some((plate) => plate.productId === PRODUCT_UNMAPPED)).toBe(false);
  });

  it('reconciles a day: revenue, cost of goods and margin from the same sale', async () => {
    const days = await costing.days(access, { from: dayAt(-6), to: dayAt(-6) });
    expect(days.days).toHaveLength(1);
    const day = days.days[0];
    expect(day.businessDate).toBe(dayAt(-6));
    expect(day.revenueMinor).toBe(9000);
    expect(day.grandTotalMinor).toBe(10440);
    expect(day.salesCount).toBe(1);
    expect(day.platesSold).toBe(2);
    // 24 g of beans, 300 ml of milk, 60 ml of syrup: round(280.8 + 2100 + 480).
    expect(day.costMinor).toBe(Number(LATTE_DAY_COST));
    expect(day.marginMinor).toBe(Number(LATTE_DAY_MARGIN));
    expect(day.marginBasisPoints).toBe(Number(LATTE_DAY_MARGIN_BPS));
    expect(day.state).toBe('complete');
    expect(day.uncostedItems).toEqual([]);
    expect(day.salesLinesWithoutMapping).toBe(0);
    expect(day.uncostedProducts).toEqual([]);
  });

  it('reconciles the OTHER day from the sale that produced it', async () => {
    const days = await costing.days(access, { from: dayAt(-1), to: dayAt(-1) });
    const day = days.days[0];
    expect(day.revenueMinor).toBe(3800);
    expect(day.grandTotalMinor).toBe(4408);
    expect(day.platesSold).toBe(1);
    // 60 g of beans (702) and 150 ml of milk (525).
    expect(day.costMinor).toBe(Number(OLLA_COST));
    expect(day.marginMinor).toBe(3800 - Number(OLLA_COST));
  });

  it('takes the day’s consumption from the ledger the sale wrote, not from the recipe', async () => {
    // The ledger is the authority, and it is read back from SQL rather than trusted
    // from the API's own return value.
    const beans = await pg.tquery<{ quantity: string }>(
      MERCHANT,
      `SELECT sum(quantity)::text AS quantity
         FROM merchant.stock_ledger_entry
        WHERE merchant_id=$1::uuid AND entry_type='sale_committed'
          AND business_date='${dayAt(-6)}'::date AND inventory_item_id=$2::uuid`,
      [MERCHANT, ITEM_BEANS],
    );
    expect(beans.rows[0].quantity).toBe('24');
    // The day's ledger carries the RESERVATION as well as the commit, and the read must
    // count only the second: a reservation is a promise, not consumption.
    const types = await pg.tquery<{ entry_type: string; entries: string }>(
      MERCHANT,
      `SELECT entry_type, count(*)::text AS entries FROM merchant.stock_ledger_entry
        WHERE merchant_id=$1::uuid AND business_date='${dayAt(-6)}'::date
        GROUP BY 1 ORDER BY 1`,
      [MERCHANT],
    );
    expect(types.rows).toEqual([
      { entry_type: 'reservation_created', entries: '3' },
      { entry_type: 'sale_committed', entries: '3' },
    ]);

    /*
     * The day's cost, recomputed here from the LEDGER quantities and the basis — integer
     * numerator at a common denominator, rounded ONCE, exactly as the read must do it:
     *
     *   24 g beans × 11700 + 600 ml milk × 3500 + 60 ml syrup × 8000 = 2 860 800
     *   → round(2860800 / 1000) = 2861.
     */
    const days = await costing.days(access, { from: dayAt(-6), to: dayAt(-6) });
    const exactNumerator = 24n * BEANS_UNIT_COST + 600n * MILK_UNIT_COST + 60n * SYRUP_UNIT_COST;
    expect(days.days[0].costMinor).toBe(Number((exactNumerator + 500n) / 1000n));
    expect(Number(exactNumerator)).toBe(2860800);
  });

  it('reports a day it cannot cost as incomplete rather than as free', async () => {
    const days = await costing.days(access, { from: dayAt(-63), to: dayAt(-63) });
    const day = days.days[0];
    expect(day.revenueMinor).toBe(3500);
    expect(day.state).toBe('incomplete');
    expect(day.costMinor).toBeNull();
    expect(day.marginMinor).toBeNull();
    expect(day.uncostedItems.map((item) => item.publicReference)).toEqual(['AZUCAR']);
  });

  it('refuses to call an UNTRACKED day profitable', async () => {
    /*
     * The sale consumed nothing because nothing maps the product — not because the plate
     * was free. So the day has revenue, no cost, and no margin, and names what nobody
     * mapped. A zero here would be the most expensive kind of wrong this view can be: it
     * looks like good news.
     */
    const days = await costing.days(access, { from: dayAt(-62), to: dayAt(-62) });
    const day = days.days[0];
    expect(day.revenueMinor).toBe(9900);
    expect(day.platesSold).toBe(1);
    expect(day.state).toBe('incomplete');
    expect(day.costMinor).toBeNull();
    expect(day.marginMinor).toBeNull();
    expect(day.marginBasisPoints).toBeNull();
    expect(day.salesLinesWithoutMapping).toBe(1);
    expect(day.uncostedProducts).toEqual([
      { productId: PRODUCT_UNMAPPED, productName: 'Producto sin receta' },
    ]);
  });

  it('forecasts from the last 28 days, and says how many days it rested on', async () => {
    const forecast = await costing.lowStock(access, {
      windowDays: 28,
      belowThresholdOnly: false,
    });
    // The window is stated rather than implied.
    expect(forecast.windowDays).toBe(28);
    // The window ends on the merchant's OWN current business date, which is the
    // date this fixture seeded as "today".
    expect(forecast.to).toBe(TODAY);
    expect(forecast.from).toBe(dayAt(-27));

    const beans = forecast.items.find((item) => item.inventoryItemId === ITEM_BEANS)!;
    // 24 g on the 10th and 60 g on the 15th: 84 g over the SEVEN days since the first
    // sale, not over twenty-eight. A 28-day divisor would have called this 3 g a day.
    expect(beans.consumedQuantity.value).toBe(84);
    expect(beans.daysWithConsumption).toBe(2);
    expect(beans.observedDays).toBe(7);
    expect(beans.insufficientHistory).toBe(true);
    expect(beans.dailyRateQuantity!.value).toBe(12);
    // on hand 15000 − 84 = 14916, at 12 g a day: floor(14916 × 7 / 84) = 1243.
    expect(beans.onHand.value).toBe(14916);
    expect(beans.daysOfCover).toBe(1243);
    expect(beans.hasCostBasis).toBe(true);
    expect(beans.onHandValueMinor).toBe(Math.round((14916 * Number(BEANS_UNIT_COST)) / 1000));
  });

  it('counts only what falls inside the window', async () => {
    const forecast = await costing.lowStock(access, { windowDays: 28, belowThresholdOnly: false });
    const cup = forecast.items.find((item) => item.inventoryItemId === ITEM_CUP)!;
    // Four cups today are inside; the three sold on TODAY-46 are outside it.
    expect(cup.consumedQuantity.value).toBe(4);
    expect(cup.daysWithConsumption).toBe(1);
    expect(cup.observedDays).toBe(1);
    expect(cup.onHand.value).toBe(493);
    expect(cup.daysOfCover).toBe(123);
  });

  it('has no rate and no cover for an item nothing consumed, instead of infinite', async () => {
    const forecast = await costing.lowStock(access, { windowDays: 28, belowThresholdOnly: false });
    const napkin = forecast.items.find((item) => item.inventoryItemId === ITEM_NAPKIN)!;
    expect(napkin.consumedQuantity.value).toBe(0);
    expect(napkin.observedDays).toBe(0);
    expect(napkin.dailyRateQuantity).toBeNull();
    expect(napkin.daysOfCover).toBeNull();
    expect(napkin.insufficientHistory).toBe(true);
    // It has a basis even though nothing consumed it, so its shelf value is known:
    // 100 packages at $2.50.
    expect(napkin.hasCostBasis).toBe(true);
    expect(napkin.onHand.value).toBe(100);
    expect(napkin.onHandValueMinor).toBe(100 * Number(NAPKIN_UNIT_COST));
  });

  it('flags what is already below its own threshold, and nothing else', async () => {
    const only = await costing.lowStock(access, { windowDays: 28, belowThresholdOnly: true });
    expect(only.items.map((item) => item.inventoryItemId)).toEqual([ITEM_NAPKIN]);
    expect(only.items[0].belowThreshold).toBe(true);
    expect(only.items[0].lowStockThreshold).toEqual({ value: 150, scale: 0, unit: 'package' });
  });

  it('orders the items with the least cover first', async () => {
    const forecast = await costing.lowStock(access, { windowDays: 28, belowThresholdOnly: false });
    const covers = forecast.items
      .filter((item) => item.daysOfCover !== null)
      .map((item) => item.daysOfCover!);
    expect(covers).toEqual([...covers].sort((a, b) => a - b));
  });

  it('isolates tenants on every one of the four reads', async () => {
    const [basis, plates, days, forecast] = await Promise.all([
      costing.costBasis(neighbourAccess, { includeWithoutReceipts: true }),
      costing.plates(neighbourAccess, { includeUnmapped: false, limit: 200 }),
      costing.days(neighbourAccess, { from: dayAt(-46), to: dayAt(0) }),
      costing.lowStock(neighbourAccess, { windowDays: 28, belowThresholdOnly: false }),
    ]);

    // The neighbour sees its OWN item, and none of the merchant's.
    expect(basis.items.map((item) => item.inventoryItemId)).toEqual([ITEM_NEIGHBOUR]);
    expect(basis.items[0].unitCostMinor).toBe(9900);
    expect(basis.receiptLocations.map((location) => location.locationId)).toEqual([
      NEIGHBOUR_LOCATION,
    ]);

    // Nothing of the merchant's menu, no days of its trading, no items of its shelf.
    expect(plates.plates).toEqual([]);
    expect(days.days).toEqual([]);
    expect(forecast.items.map((item) => item.inventoryItemId)).toEqual([ITEM_NEIGHBOUR]);
    expect(forecast.items[0].daysOfCover).toBeNull();
  });

  it('refuses a window that runs backwards, and one that is unreasonably long', async () => {
    await expect(costing.days(access, { from: TODAY, to: dayAt(-15) })).rejects.toMatchObject({
      status: 400,
    });
    await expect(costing.days(access, { from: dayAt(-1000), to: TODAY })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('cannot hold a negative unit cost, whoever writes it', async () => {
    // The API would never send one; this proves the SCHEMA refuses one from a writer that
    // bypasses every line of TypeScript.
    await expect(
      pg.tquery(
        MERCHANT,
        `INSERT INTO merchant.purchase_order_receipt_line
           (merchant_id, receipt_id, purchase_order_id, purchase_order_line_id, inventory_item_id,
            received_quantity, quantity_scale, unit, actual_unit_cost_minor, line_total_minor)
         VALUES ($1::uuid,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),$2::uuid,
                 1,3,'kilogram',-1,0)`,
        [MERCHANT, ITEM_BEANS],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  // ── Phase 4: the variance, the cost history and the menu classes ───────────

  it('decomposes the variance by name, and the parts SUM to the variance', async () => {
    const variance = InventoryUsageVariance.parse(
      await costing.usageVariance(access, { from: dayAt(-27), to: dayAt(0) }),
    );
    expect(variance.basis).toBe('available_stock');
    expect(variance.from).toBe(dayAt(-27));
    expect(variance.to).toBe(TODAY);
    expect(variance.locationId).toBe(LOCATION);

    /*
     * THE INVARIANT THE WHOLE REPORT RESTS ON. Every line must reconcile three ways:
     * actual usage is the ledger's own subtraction, variance is actual minus
     * theoretical, and the named parts plus the remainder ARE the variance.
     */
    for (const line of variance.lines) {
      expect(line.actualUsageQuantity.value).toBe(
        line.openingQuantity.value +
          line.receivedQuantity.value +
          line.productionProducedQuantity.value -
          line.closingQuantity.value,
      );
      expect(line.varianceQuantity.value).toBe(
        line.actualUsageQuantity.value - line.theoreticalUsageQuantity.value,
      );
      expect(line.varianceQuantity.value).toBe(
        line.wasteQuantity.value +
          line.damageQuantity.value +
          line.countCorrectionQuantity.value +
          line.yieldLossQuantity.value +
          line.unexplainedQuantity.value,
      );
    }

    // And the totals are the sums of the lines, so the answer checks itself.
    const total = (pick: (line: (typeof variance.lines)[number]) => number): number =>
      variance.lines.reduce((sum, line) => sum + pick(line), 0);
    expect(variance.totalVarianceQuantity.value).toBe(total((line) => line.varianceQuantity.value));
    expect(variance.totalUnexplainedQuantity.value).toBe(
      total((line) => line.unexplainedQuantity.value),
    );

    const lineFor = (inventoryItemId: string) => {
      const line = variance.lines.find((entry) => entry.inventoryItemId === inventoryItemId);
      expect(line, `no variance line for ${inventoryItemId}`).toBeDefined();
      return line!;
    };

    // The beans: 15000 g in and 90 g out through three recipes, so nothing is unexplained.
    const beans = lineFor(ITEM_BEANS);
    expect(beans.receivedQuantity.value).toBe(BEANS_RECEIVED);
    expect(beans.openingQuantity.value).toBe(0);
    expect(beans.theoreticalUsageQuantity.value).toBe(BEANS_SOLD_IN_WINDOW);
    expect(beans.actualUsageQuantity.value).toBe(BEANS_SOLD_IN_WINDOW);
    expect(beans.varianceQuantity.value).toBe(0);
    expect(beans.unexplainedQuantity.value).toBe(0);

    /*
     * The milk: the recipes say 550 ml and the shelf gave up 750. The extra 200 ml is
     * the vanilla modifier, which the explosion excludes and only the ledger saw — so
     * the unexplained remainder is exactly the number an owner has to act on.
     */
    const milk = lineFor(ITEM_MILK);
    expect(milk.theoreticalUsageQuantity.value).toBe(MILK_THEORETICAL);
    expect(milk.actualUsageQuantity.value).toBe(MILK_USED_IN_WINDOW);
    expect(milk.varianceQuantity.value).toBe(MILK_UNEXPLAINED);
    expect(milk.unexplainedQuantity.value).toBe(MILK_UNEXPLAINED);
    expect(milk.wasteQuantity.value).toBe(0);

    // The loss item: nothing was sold, so all of the usage is named.
    const loss = lineFor(ITEM_LOSS);
    expect(loss.receivedQuantity.value).toBe(LOSS_RECEIVED);
    expect(loss.wasteQuantity.value).toBe(LOSS_WASTE);
    expect(loss.damageQuantity.value).toBe(LOSS_DAMAGE);
    expect(loss.countCorrectionQuantity.value).toBe(LOSS_COUNT_DECREASE);
    expect(loss.varianceQuantity.value).toBe(LOSS_WASTE + LOSS_DAMAGE + LOSS_COUNT_DECREASE);
    expect(loss.unexplainedQuantity.value).toBe(0);
    // Damage moves no on-hand, so only THIS basis reports it as usage at all.
    expect(loss.closingQuantity.value).toBe(
      LOSS_RECEIVED - LOSS_WASTE - LOSS_DAMAGE - LOSS_COUNT_DECREASE,
    );
    // THE LEDGER IS THE EVIDENCE FOR THE BASIS. On-hand is 92: waste and the count
    // correction moved it and the damage did not. The available pool the report measures
    // is 90, because damage DOES leave it — which is the whole reason for this basis.
    const balance = await pg.tquery<{ onHand: string }>(
      MERCHANT,
      `SELECT sum(on_hand)::text AS "onHand" FROM merchant.stock_balance
        WHERE merchant_id=$1::uuid AND inventory_item_id=$2::uuid`,
      [MERCHANT, ITEM_LOSS],
    );
    expect(balance.rows[0].onHand).toBe(String(LOSS_RECEIVED - LOSS_WASTE - LOSS_COUNT_DECREASE));
    expect(loss.closingQuantity.value).toBe(Number(balance.rows[0].onHand) - LOSS_DAMAGE);

    // The prep: the batch declared ten, two never arrived, and the loss is the usage.
    const prep = lineFor(ITEM_PREP);
    expect(prep.productionProducedQuantity.value).toBe(PREP_DECLARED);
    expect(prep.yieldLossQuantity.value).toBe(PREP_SHORTFALL);
    expect(prep.actualUsageQuantity.value).toBe(PREP_SHORTFALL);
    expect(prep.varianceQuantity.value).toBe(PREP_SHORTFALL);
    expect(prep.unexplainedQuantity.value).toBe(0);
  });

  it('answers the stored cost point and the read-time one, and tells them apart', async () => {
    /*
     * A VERSION WRITTEN BEFORE THIS PHASE has no stored point, so the read costs it
     * NOW and says so: `capturedAt` is the read's own moment.
     */
    const legacy = InventoryRecipeCostHistory.parse(
      await costing.recipeCostHistory(access, { recipeId: RECIPE_LATTE }),
    );
    expect(legacy.recipes).toHaveLength(1);
    expect(legacy.recipes[0].targetName).toBe('Latte');
    expect(legacy.recipes[0].points).toHaveLength(1);
    // 12 g of beans (140.4) and 200 ml of milk (700.0): round(840.4) = 840.
    expect(legacy.recipes[0].points[0].costMinor).toBe(Number(LATTE_BASE_COST));
    expect(legacy.recipes[0].points[0].defects).toEqual([]);
    expect(legacy.recipes[0].points[0].capturedAt).toBe(legacy.asOf);

    // A plate whose ingredient nobody priced is NULL with the reason, never zero.
    const cake = InventoryRecipeCostHistory.parse(
      await costing.recipeCostHistory(access, { recipeId: RECIPE_CAKE }),
    );
    expect(cake.recipes[0].points[0].costMinor).toBeNull();
    expect(cake.recipes[0].points[0].defects).toEqual(['no_cost_basis']);
    expect(cake.recipes[0].points[0].capturedAt).toBe(cake.asOf);

    // The olla's batch divides exactly: 60 g of beans and 150 ml of milk per plate.
    const olla = InventoryRecipeCostHistory.parse(
      await costing.recipeCostHistory(access, { recipeId: RECIPE_OLLA }),
    );
    expect(olla.recipes[0].points[0].costMinor).toBe(Number(OLLA_COST));
  });

  it('stores the cost on the version the console writes, and keeps it after an edit', async () => {
    await send('inventory.recipe.create', {
      targetAggregateId: RECIPE_STORED,
      parameters: {
        targetKind: 'product',
        productId: PRODUCT_STORED,
        yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
        components: [
          { inventoryItemId: ITEM_MILK, quantity: { value: 200, scale: 3, unit: 'milliliter' } },
        ],
      },
    });
    const stored = await pg.tquery<{
      cost: string | null;
      defects: string[] | null;
      at: string | null;
    }>(
      MERCHANT,
      `SELECT computed_cost_minor::text AS cost, computed_defects AS defects,
              computed_at::text AS at
         FROM merchant.inventory_recipe WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [MERCHANT, RECIPE_STORED],
    );
    // 200 ml of milk at the receipt-weighted $35.00 a litre is $7.00.
    expect(stored.rows[0].cost).toBe(String(STORED_RECIPE_COST));
    expect(stored.rows[0].defects).toEqual([]);
    expect(stored.rows[0].at).not.toBeNull();

    const first = InventoryRecipeCostHistory.parse(
      await costing.recipeCostHistory(access, { productId: PRODUCT_STORED }),
    );
    expect(first.recipes[0].targetName).toBe('Plato con costo guardado');
    expect(first.recipes[0].points).toHaveLength(1);
    // A STORED point names when it was computed, which is NOT the moment of this read.
    expect(first.recipes[0].points[0].costMinor).toBe(Number(STORED_RECIPE_COST));
    expect(first.recipes[0].points[0].capturedAt).not.toBe(first.asOf);
    expect(first.recipes[0].points[0].capturedAt).toBe(new Date(stored.rows[0].at!).toISOString());

    // An edit writes a NEW version with its own point, and the retired one keeps its own.
    await send('inventory.recipe.update', {
      targetAggregateId: RECIPE_STORED,
      targetVersion: 1,
      parameters: {
        expectedVersion: 1,
        components: [
          { inventoryItemId: ITEM_MILK, quantity: { value: 100, scale: 3, unit: 'milliliter' } },
        ],
      },
    });
    const after = InventoryRecipeCostHistory.parse(
      await costing.recipeCostHistory(access, { productId: PRODUCT_STORED }),
    );
    expect(after.recipes[0].points.map((point) => [point.version, point.costMinor])).toEqual([
      [1, Number(STORED_RECIPE_COST)],
      [2, Number(STORED_RECIPE_UPDATED_COST)],
    ]);
    // The entry names the NEWEST version, and the retired one says when it retired.
    expect(after.recipes[0].recipeId).toBe(after.recipes[0].points[1].recipeId);
    expect(after.recipes[0].points[0].retiredAt).not.toBeNull();
    expect(after.recipes[0].points[1].retiredAt).toBeNull();
  });

  it('classifies the menu by the mean of margin and popularity', async () => {
    const menu = MenuEngineering.parse(
      await costing.menuEngineering(access, { from: dayAt(-27), to: dayAt(0), limit: 200 }),
    );
    const byProduct = new Map(menu.items.map((item) => [item.productId, item]));
    // Every product sold inside the window is here, and nothing from outside it.
    expect([...byProduct.keys()].sort()).toEqual(
      [PRODUCT_LATTE, PRODUCT_OLLA, PRODUCT_CUP, PRODUCT_STAR, PRODUCT_DOG].sort(),
    );

    const star = byProduct.get(PRODUCT_STAR)!;
    expect(star.soldQuantity).toBe(STAR_SOLD);
    expect(star.priceMinor).toBe(Number(STAR_PRICE_MINOR));
    // One package of its own ingredient, priced by its receipt at $4.00.
    expect(star.plateCostMinor).toBe(Number(STAR_UNIT_COST));
    expect(star.marginMinor).toBe(Number(STAR_PRICE_MINOR - STAR_UNIT_COST));
    expect(star.marginBasisPoints).toBe(8667);
    // 6 of the 14 units sold, and 15600 of the 26793 centavos of margin.
    expect(star.popularityShareBasisPoints).toBe(4286);
    expect(star.marginShareBasisPoints).toBe(5822);
    expect(star.classification).toBe('star');

    const latte = byProduct.get(PRODUCT_LATTE)!;
    expect(latte.plateCostMinor).toBe(Number(LATTE_BASE_COST));
    expect(latte.marginMinor).toBe(Number(LATTE_MARGIN));
    expect(latte.classification).toBe('plow_horse');

    const cup = byProduct.get(PRODUCT_CUP)!;
    expect(cup.plateCostMinor).toBe(Number(CUP_UNIT_COST));
    expect(cup.classification).toBe('puzzle');

    const dog = byProduct.get(PRODUCT_DOG)!;
    expect(dog.plateCostMinor).toBe(Number(DOG_UNIT_COST));
    expect(dog.marginMinor).toBe(Number(DOG_PRICE_MINOR - DOG_UNIT_COST));
    expect(dog.classification).toBe('dog');

    // The four classes all show, which is the phase's own acceptance line.
    expect(new Set(menu.items.map((item) => item.classification))).toEqual(
      new Set(['star', 'plow_horse', 'puzzle', 'dog']),
    );
    // Popularity is a share of the period's units, so the shares add to 10000.
    expect(menu.items.reduce((sum, item) => sum + item.popularityShareBasisPoints, 0)).toBe(10000);
  });
});
