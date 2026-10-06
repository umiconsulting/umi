import { MetricsService } from '../../shared/operations/metrics.service';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import {
  SupplierInvoice,
  SupplierInvoiceList,
  type CreatePurchaseOrderRequest,
  type ReceivePurchaseOrderRequest,
} from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { AdministrativeCommandContextService } from '../administrative-commands/administrative-command-context.service';
import { AdministrativeCommandExecutionService } from '../administrative-commands/administrative-command-execution.service';
import { AdministrativeCommandRepository } from '../administrative-commands/administrative-command.repository';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { ProcurementRepository } from './procurement.repository';
import { ProcurementService } from './procurement.service';

/**
 * WORKSTREAM E, STEP 3 — "Add purchase orders, suppliers, and receiving", against
 * the REAL schema.
 *
 * What this spec is for, stated as the plan states it. The step's own words are the
 * subject; the invariants below are the review's, and each one is asserted where it
 * can only be true if the DATABASE says so:
 *
 *   · a purchase order cannot be OVER-RECEIVED — refused with a typed error naming
 *     the line, and NOTHING moves, which needs a two-line receipt to be visible at
 *     all (a one-line test cannot tell "refused before writing" from "wrote then
 *     rolled back" only if it looks at the OTHER line, so it does);
 *   · receiving is IDEMPOTENT per command identity — replayed, and counted;
 *   · the LEDGER and the BALANCE agree — the entry's effects and the projection's
 *     delta are read back from SQL, not from the API's return value;
 *   · CANCELLING a sent order releases its in_transit, and cancelling a draft posts
 *     nothing at all;
 *   · a receipt cannot reference another merchant's supplier, order or item;
 *   · the CONSTRAINT refuses an over-receipt even from raw SQL that bypasses every
 *     line of TypeScript.
 *
 * WHY THE ASSERTIONS ARE DELTAS. `merchant.stock_ledger_entry` is append-only (a
 * trigger refuses UPDATE and DELETE) and `merchant.stock_balance` is a projection
 * of it, so a run cannot reset the stock it created and a re-run inherits it. Every
 * quantity claim below is therefore a BEFORE/AFTER delta, which is also the claim
 * that actually matters: receiving moved THIS MUCH.
 *
 * Self-seeding. Each case uses its own inventory item, so no two cases share a
 * balance and the file can run in any order.
 *
 *   set -a && . apps/umi-api/.env && set +a
 *   npx vitest run --config vitest.integration.config.ts src/modules/procurement/procurement.integration.ts
 */

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;

const JWT_SECRET = 'procurement-harness-secret-000000000000';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const MERCHANT = '7c000000-0000-4000-8000-0000000000a1';
const LOCATION = '7c000000-0000-4000-8000-0000000000a2';
/** A second merchant, to prove the forced RLS isolates tenants. */
const NEIGHBOUR = '7c000000-0000-4000-8000-0000000000a3';
const NEIGHBOUR_LOCATION = '7c000000-0000-4000-8000-0000000000a4';

const USER = '7c000000-0000-4000-8000-0000000000c1';
const NEIGHBOUR_USER = '7c000000-0000-4000-8000-0000000000c2';

const STOCK_ROOM = '7c000000-0000-4000-8000-0000000000d1';
const NEIGHBOUR_STOCK_ROOM = '7c000000-0000-4000-8000-0000000000d2';

/**
 * One inventory item per case, so a case's balance is its own. `CAFE` is a
 * kilogram item at scale 3 (a café buys coffee by the kilo and weighs it in
 * grams), `SERV` is a whole-unit item at scale 0 — the two shapes the money
 * arithmetic has to handle.
 */
const ITEM_CAFE = '7c000000-0000-4000-8000-0000000000e1';
const ITEM_CAFE_PARTIAL = '7c000000-0000-4000-8000-0000000000e2';
const ITEM_CAFE_IDEMPOTENT = '7c000000-0000-4000-8000-0000000000e3';
const ITEM_CAFE_GUARD = '7c000000-0000-4000-8000-0000000000e4';
const ITEM_CAFE_CANCEL = '7c000000-0000-4000-8000-0000000000e5';
const ITEM_CAFE_CANCEL_DRAFT = '7c000000-0000-4000-8000-0000000000e6';
const ITEM_SERV_ORDERED = '7c000000-0000-4000-8000-0000000000e7';
const ITEM_NEIGHBOUR = '7c000000-0000-4000-8000-0000000000e8';

const SUPPLIER = '7c000000-0000-4000-8000-0000000000f1';
const SUPPLIER_ARCHIVED = '7c000000-0000-4000-8000-0000000000f2';
const NEIGHBOUR_SUPPLIER = '7c000000-0000-4000-8000-0000000000f3';

const CHECK_VIOLATION = '23514';

/**
 * The supplier reference this spec creates has to be NEW EVERY RUN.
 *
 * A supplier with no orders could be deleted afterwards, but the reference is also
 * what makes the "taken reference" case meaningful: the spec creates it, proves a
 * second create with the same reference is refused, and then archives it. Deriving
 * it per run keeps the case honest on a database that already carries the previous
 * run's rows.
 */
const SUPPLIER_NEW = `NUEVO-${randomUUID().slice(0, 8)}`;

/**
 * The invoice fixtures, DERIVED PER RUN.
 *
 * A CFDI UUID is the key the upload is idempotent on, and a receipt is an immutable
 * fact, so a second run of this file would meet the first run's rows. Deriving the
 * UUID, the item and the prices from this run's own tag keeps every claim about THIS
 * run's document true, exactly as the per-case inventory items above do.
 */
const RUN = randomUUID().replace(/-/g, '').slice(0, 6);
const runId = (suffix: number): string =>
  `7c${RUN}-0000-4000-8000-${suffix.toString(16).padStart(12, '0')}`;
const runUuid = (suffix: number): string =>
  `7c${RUN}-1000-4000-8000-${suffix.toString(16).padStart(12, '0')}`;

/**
 * THE INVOICE CASES OWN A MERCHANT OF THEIR OWN. A commit writes purchase orders and
 * receipts, and the order list above asserts that one page of a hundred covers this
 * merchant — so a case that keeps creating orders must not run against it. A third
 * tenant also puts the forced RLS policy under an invoice, which is where a merchant
 * scope bug would show up as another café's document.
 */
const INVOICE_MERCHANT = '7c000000-0000-4000-8000-0000000000b1';
const INVOICE_LOCATION = '7c000000-0000-4000-8000-0000000000b2';
const INVOICE_STOCK_ROOM = '7c000000-0000-4000-8000-0000000000b3';
const INVOICE_SUPPLIER = '7c000000-0000-4000-8000-0000000000b4';

/** The membership and the browser session the console's command door requires. */
const STAFF = '7c000000-0000-4000-8000-0000000000c9';
const DASHBOARD_SESSION = '7c000000-0000-4000-8000-0000000000ca';

/**
 * NEW IDS, NOT THE e/f SERIES ABOVE. `inventory_item.id` is the primary key, so an id
 * already used by the purchasing merchant's fixtures cannot also name an item in this
 * one; the insert would silently skip and every order here would refuse.
 */
const ITEM_INVOICE = '7c000000-0000-4000-8000-000000000104';
const ITEM_INVOICE_PHOTO = '7c000000-0000-4000-8000-000000000105';
/** The price case needs its own item, so its price history starts empty every run. */
const ITEM_INVOICE_PRICE = runId(0xf6);

const INVOICE_SKU = `SKU-${RUN}`;
const PRICE_SKU = `SKU-PRECIO-${RUN}`;
/** A description nothing in this merchant's catalogue resembles. */
const UNMATCHABLE = `Servicio inexistente ${RUN} zzz`;
/** The first price this run pays, and the higher one the next invoice charges. */
const PRICE_BEFORE_MINOR = 12050 + (Number.parseInt(RUN, 16) % 500);
const PRICE_AFTER_MINOR = PRICE_BEFORE_MINOR + 777;

/** A 1x1 PNG: real magic bytes, so the photo path's sniffing is exercised honestly. */
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * A CFDI 4.0 file with ONE concept, in the shape the SAT stamps. `importe` is written
 * out rather than derived, because the document is the authority on its own money and
 * the parser must prefer what it says.
 */
const cfdiWithOneConcept = (input: {
  uuid: string;
  folio: string;
  description: string;
  sku: string | null;
  cantidad: string;
  valorUnitario: string;
  importe: string;
  unidad?: string;
}): string => `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Folio="${input.folio}"
  Fecha="2026-09-17T09:15:00" SubTotal="${input.importe}" Moneda="MXN" Total="${input.importe}"
  TipoDeComprobante="I" LugarExpedicion="06000">
  <cfdi:Emisor Rfc="XAXX010101000" Nombre="Cafetería del Sur SA de CV" RegimenFiscal="601"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="50202300"${input.sku === null ? '' : ` NoIdentificacion="${input.sku}"`}
      Cantidad="${input.cantidad}" ClaveUnidad="KGM" Unidad="${input.unidad ?? 'Kilogramo'}"
      Descripcion="${input.description}" ValorUnitario="${input.valorUnitario}" Importe="${input.importe}"
      ObjetoImp="01"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1"
      UUID="${input.uuid}" FechaTimbrado="2026-09-17T09:16:00"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

const access: MerchantAccess = {
  merchantId: MERCHANT,
  locationId: LOCATION,
  name: 'Procurement test',
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

describe('purchasing · send, receive, cancel, and the stock they move', () => {
  let pg: PgService;
  let procurement: ProcurementService;
  let repo: ProcurementRepository;
  /** The console's own door, so the invoice cases drive the real command path. */
  let commands: AdministrativeCommandExecutionService;

  /**
   * Run a call the way the request path does: with a merchant AND a user in the
   * async context. The user matters here in a way it does not for the floor plan —
   * every ledger entry names its operator, because a stock movement with no person
   * behind it is not an audit trail.
   */
  const scoped = <T>(
    fn: () => Promise<T>,
    merchant = MERCHANT,
    location = LOCATION,
    userId: string | null = USER,
  ) =>
    runWithRequestContext(
      { merchantId: merchant, locationId: location, userId, requestId: randomUUID() },
      fn,
    );

  const command = (extra: Record<string, unknown> = {}) => ({
    locationId: LOCATION,
    idempotencyKey: randomUUID(),
    ...extra,
  });

  const createOrder = (
    lines: CreatePurchaseOrderRequest['lines'],
    options: { supplierId?: string; locationId?: string; inventoryLocationId?: string } = {},
  ) =>
    scoped(() =>
      procurement.createPurchaseOrder(access, {
        ...command(),
        locationId: options.locationId ?? LOCATION,
        inventoryLocationId: options.inventoryLocationId ?? STOCK_ROOM,
        supplierId: options.supplierId ?? SUPPLIER,
        currency: 'MXN',
        expectedOn: null,
        note: null,
        lines,
      }),
    );

  const send = (purchaseOrderId: string, expectedVersion: number, key = randomUUID()) =>
    scoped(() =>
      procurement.sendPurchaseOrder(access, {
        locationId: LOCATION,
        idempotencyKey: key,
        purchaseOrderId,
        expectedVersion,
      }),
    );

  const receive = (dto: {
    purchaseOrderId: string;
    expectedVersion: number;
    idempotencyKey?: string;
    note?: string | null;
    lines: ReceivePurchaseOrderRequest['lines'];
  }) =>
    scoped(() =>
      procurement.receivePurchaseOrder(access, {
        locationId: LOCATION,
        idempotencyKey: dto.idempotencyKey ?? randomUUID(),
        purchaseOrderId: dto.purchaseOrderId,
        expectedVersion: dto.expectedVersion,
        note: dto.note ?? null,
        lines: dto.lines,
      }),
    );

  const cancel = (purchaseOrderId: string, expectedVersion: number, reason: string | null = null) =>
    scoped(() =>
      procurement.cancelPurchaseOrder(access, {
        locationId: LOCATION,
        idempotencyKey: randomUUID(),
        purchaseOrderId,
        expectedVersion,
        reason,
      }),
    );

  /**
   * A refusal as three plain fields. A Nest `HttpException` keeps its typed `code`
   * inside `getResponse()`, so `rejects.toMatchObject({ code })` silently matches
   * nothing — which is how a suite can look like it asserts a typed refusal while
   * only asserting that something threw.
   */
  async function refusal(work: () => Promise<unknown>): Promise<{
    status: number;
    code: string;
    fieldErrors: Record<string, string[]> | undefined;
    details: Record<string, unknown> | undefined;
  }> {
    try {
      await work();
    } catch (thrown) {
      const error = thrown as { status?: number; getResponse?: () => unknown };
      const body = (typeof error.getResponse === 'function' ? error.getResponse() : {}) as {
        code?: unknown;
        fieldErrors?: Record<string, string[]>;
        details?: Record<string, unknown>;
      };
      return {
        status: error.status ?? 0,
        code: typeof body.code === 'string' ? body.code : '(no code)',
        fieldErrors: body.fieldErrors,
        details: body.details,
      };
    }
    throw new Error('the API ACCEPTED a command it was supposed to refuse');
  }

  /** The projection, as the database holds it. */
  const balance = (inventoryItemId: string) =>
    repo.stockPosition(MERCHANT, STOCK_ROOM, inventoryItemId);

  /** Every ledger row for one item, newest last: the facts the balance projects. */
  const ledger = async (inventoryItemId: string) => {
    const { rows } = await pg.tquery<{
      entry_type: string;
      quantity: string;
      effect_on_hand: string;
      effect_in_transit: string;
      source_aggregate_type: string;
      business_date: string;
    }>(
      MERCHANT,
      `SELECT entry_type,quantity::text AS quantity,effect_on_hand::text AS effect_on_hand,
              effect_in_transit::text AS effect_in_transit,source_aggregate_type,
              business_date::text AS business_date
         FROM merchant.stock_ledger_entry
        WHERE merchant_id=$1::uuid AND inventory_item_id=$2::uuid
        ORDER BY sequence`,
      [MERCHANT, inventoryItemId],
    );
    return rows;
  };

  const receiptsFor = (purchaseOrderId: string) =>
    pg.tquery<{ id: string; total_minor: string; business_date: string }>(
      MERCHANT,
      `SELECT id::text AS id,total_minor::text AS total_minor,business_date::text AS business_date
         FROM merchant.purchase_order_receipt
        WHERE merchant_id=$1::uuid AND purchase_order_id=$2::uuid
        ORDER BY created_at`,
      [MERCHANT, purchaseOrderId],
    );

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN)
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a disposable build-v3 database.',
      );
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    const integrity = new IntegrityService(new IntegrityRepository(pg));
    repo = new ProcurementRepository(pg);
    procurement = new ProcurementService(repo, integrity, new MetricsService());
    // The console's own door. Only the invoice dispatcher is reachable from the three
    // operations below; the rest are not exercised by this file.
    commands = new AdministrativeCommandExecutionService(
      new AdministrativeCommandContextService(new AdministrativeCommandRepository(pg)),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      procurement,
    );

    await pg.query(
      `INSERT INTO merchant.merchant (id,name,handle) VALUES
         ($1::uuid,'Procurement Harness','procurement-harness'),
         ($2::uuid,'Vecino Procurement','vecino-procurement')
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
      `INSERT INTO umi."user" (id,full_name) VALUES ($1::uuid,'Gerente'),($2::uuid,'Vecino Gerente')
       ON CONFLICT (id) DO NOTHING`,
      [USER, NEIGHBOUR_USER],
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
      `INSERT INTO merchant.inventory_item
         (id,merchant_id,public_reference,display_name,item_type,base_unit,quantity_scale)
       VALUES ($1::uuid,$7::uuid,'CAFE','Café en grano','ingredient','kilogram',3),
              ($2::uuid,$7::uuid,'CAFE-P','Café parcial','ingredient','kilogram',3),
              ($3::uuid,$7::uuid,'CAFE-I','Café idempotente','ingredient','kilogram',3),
              ($4::uuid,$7::uuid,'CAFE-G','Café guardado','ingredient','kilogram',3),
              ($5::uuid,$7::uuid,'CAFE-C','Café cancelado','ingredient','kilogram',3),
              ($6::uuid,$7::uuid,'CAFE-D','Café borrador','ingredient','kilogram',3),
              ($8::uuid,$7::uuid,'SERV','Servilletas','operational_supply','package',0),
              ($9::uuid,$10::uuid,'CAFE-V','Café vecino','ingredient','kilogram',3)
       ON CONFLICT (id) DO NOTHING`,
      [
        ITEM_CAFE,
        ITEM_CAFE_PARTIAL,
        ITEM_CAFE_IDEMPOTENT,
        ITEM_CAFE_GUARD,
        ITEM_CAFE_CANCEL,
        ITEM_CAFE_CANCEL_DRAFT,
        MERCHANT,
        ITEM_SERV_ORDERED,
        ITEM_NEIGHBOUR,
        NEIGHBOUR,
      ],
    );
    // A supplier per merchant, plus an archived one: `active` and `archived_at` are
    // tied together by a constraint, so both columns move.
    await pg.query(
      `INSERT INTO merchant.supplier
         (id,merchant_id,public_reference,display_name,note,active,archived_at)
       VALUES ($1::uuid,$4::uuid,'CAFETERIA','Cafetería del Sur',null,true,null),
              ($2::uuid,$4::uuid,'RETIRADO','Proveedor retirado',null,false,now()),
              ($3::uuid,$5::uuid,'VECINO','Vecino Proveedor',null,true,null)
       ON CONFLICT (id) DO NOTHING`,
      [SUPPLIER, SUPPLIER_ARCHIVED, NEIGHBOUR_SUPPLIER, MERCHANT, NEIGHBOUR],
    );
    /*
     * The command door's own prerequisites: an employment and a live browser session.
     * `merchant.administrative_command` names a membership and a session, because a
     * console write is a person acting in a shift, not an anonymous request.
     */
    const role = await pg.query<{ id: string }>(
      `SELECT id FROM umi.role WHERE NOT is_platform LIMIT 1`,
    );
    await pg.query(
      `INSERT INTO merchant.merchant (id,name,handle)
       VALUES ($1::uuid,'Facturas Harness','facturas-harness')
       ON CONFLICT (id) DO NOTHING`,
      [INVOICE_MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name)
       VALUES ($1::uuid,$2::uuid,'Centro')
       ON CONFLICT (id) DO NOTHING`,
      [INVOICE_LOCATION, INVOICE_MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.inventory_location
         (id,merchant_id,location_id,public_reference,display_name,location_type)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'ALMACEN','Almacén','stock_room')
       ON CONFLICT (id) DO NOTHING`,
      [INVOICE_STOCK_ROOM, INVOICE_MERCHANT, INVOICE_LOCATION],
    );
    await pg.query(
      `INSERT INTO merchant.supplier
         (id,merchant_id,public_reference,display_name,note,active,archived_at)
       VALUES ($1::uuid,$2::uuid,'FACTURAS','Proveedor de facturas',null,true,null)
       ON CONFLICT (id) DO NOTHING`,
      [INVOICE_SUPPLIER, INVOICE_MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.staff (id,merchant_id,location_id,user_id,role_id,name)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'Gerente de facturas')
       ON CONFLICT (id) DO NOTHING`,
      [STAFF, INVOICE_MERCHANT, INVOICE_LOCATION, USER, role.rows[0]?.id ?? null],
    );
    await pg.query(
      `INSERT INTO runtime.dashboard_session (id,user_id,token_hash,expires_at)
       VALUES ($1::uuid,$2::uuid,$3,now()+interval '1 hour')
       -- REFRESH on conflict instead of skipping. DO NOTHING made this fixture a time
       -- bomb: the row survives a re-run but its hour does not, so the suite passed all
       -- afternoon and then failed with SESSION_REVOKED for every run after that.
       ON CONFLICT (id) DO UPDATE SET expires_at=now()+interval '1 hour', is_active=true`,
      [DASHBOARD_SESSION, USER, createHash('sha256').update(DASHBOARD_SESSION).digest('hex')],
    );
    // The items the invoice cases receive into, in the invoice merchant. The price item
    // is per run, so its price history is empty at the top of every run; the other two
    // are shared and every claim about them is a delta.
    await pg.query(
      `INSERT INTO merchant.inventory_item
         (id,merchant_id,public_reference,display_name,item_type,base_unit,quantity_scale)
       VALUES ($1::uuid,$4::uuid,'FACT-1','Café de factura','ingredient','kilogram',3),
              ($2::uuid,$4::uuid,'FOTO-1','Factura fotografiada','operational_supply','unit',0),
              ($3::uuid,$4::uuid,$5,'Café con cambio de precio','ingredient','kilogram',3)
       ON CONFLICT (id) DO NOTHING`,
      [ITEM_INVOICE, ITEM_INVOICE_PHOTO, ITEM_INVOICE_PRICE, INVOICE_MERCHANT, `PRECIO-${RUN}`],
    );
  });

  afterAll(async () => {
    /**
     * NOTHING IS CLEANED UP, AND THAT IS THE SCHEMA'S DECISION, NOT A SHORTCUT.
     *
     * A receipt is an immutable fact — the migration grants `api`/`worker` SELECT
     * and INSERT on `purchase_order_receipt` and revokes UPDATE and DELETE — so a
     * delivered line cannot be removed by this spec, by the API, or by an operator.
     * The ledger rows it posted are append-only for the same reason, and the balance
     * is a projection of them, so the stock this spec received stays received. That
     * is what makes the BEFORE/AFTER deltas above the right assertion, and it is why
     * every case seeds its own inventory item: a re-run starts from whatever the
     * previous run left, and every claim is still about the difference this run made.
     *
     * `table-state.integration.ts` records the same stance for `audit_event`. The
     * alternative — wiping the tables between runs — would mean asserting against a
     * schema that permits a delete the real one refuses.
     */
    await pg.onModuleDestroy();
  });

  it('raises an order, sends it, and puts exactly the ordered quantity in transit', async () => {
    const before = await balance(ITEM_CAFE);
    const { purchaseOrder } = await createOrder([
      {
        inventoryItemId: ITEM_CAFE,
        supplierSku: 'MOLIENDA-1KG',
        description: 'Café molido',
        quantity: { value: 12500, scale: 3, unit: 'kilogram' },
        unitCostMinor: 12050,
        lineTotalMinor: 150625,
      },
    ]);
    expect(purchaseOrder.status).toBe('draft');
    expect(purchaseOrder.orderedTotalMinor).toBe(150625);
    expect(purchaseOrder.lines[0].outstandingQuantity).toBe(12500);
    expect(purchaseOrder.sentAt).toBeNull();
    // A draft is not a commitment: nothing is in transit yet.
    expect((await balance(ITEM_CAFE)).inTransit).toBe(before.inTransit);

    const sent = await send(purchaseOrder.id, purchaseOrder.version);
    expect(sent.purchaseOrder.status).toBe('sent');
    expect(sent.purchaseOrder.sentAt).not.toBeNull();
    const after = await balance(ITEM_CAFE);
    expect(after.inTransit - before.inTransit).toBe(12500);
    expect(after.onHand).toBe(before.onHand);

    const entries = await ledger(ITEM_CAFE);
    const ordered = entries.at(-1);
    expect(ordered?.entry_type).toBe('purchase_ordered');
    expect(Number(ordered?.effect_in_transit)).toBe(12500);
    expect(Number(ordered?.effect_on_hand)).toBe(0);
    /*
     * THE LEDGER CARRIES THE ORDER'S OWN TRADING DAY, which is not the UTC date of
     * `createdAt`: the merchant's day starts in America/Mexico_City, so a 00:30 UTC
     * order belongs to the previous trading day. Comparing against the date prefix
     * of the ISO timestamp would assert the wrong thing and pass or fail on the hour
     * the suite happened to run — so the order's own column is read back and the two
     * are compared to each other.
     */
    const tradingDay = await pg.tquery<{ business_date: string }>(
      MERCHANT,
      `SELECT business_date::text AS business_date FROM merchant.purchase_order
        WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [MERCHANT, purchaseOrder.id],
    );
    expect(ordered?.business_date).toBe(tradingDay.rows[0].business_date);
    expect(ordered?.business_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('receives part of an order, then the rest, and the ledger and the balance agree', async () => {
    const before = await balance(ITEM_CAFE_PARTIAL);
    const { purchaseOrder } = await createOrder([
      {
        inventoryItemId: ITEM_CAFE_PARTIAL,
        supplierSku: null,
        description: 'Café parcial',
        quantity: { value: 10000, scale: 3, unit: 'kilogram' },
        unitCostMinor: 10000,
        lineTotalMinor: 100000,
      },
    ]);
    const sent = await send(purchaseOrder.id, purchaseOrder.version);
    const lineId = sent.purchaseOrder.lines[0].id;

    // Half today: 4 kg of the 10 ordered.
    const partial = await receive({
      purchaseOrderId: purchaseOrder.id,
      expectedVersion: sent.purchaseOrder.version,
      lines: [
        {
          purchaseOrderLineId: lineId,
          quantity: { value: 4000, scale: 3, unit: 'kilogram' },
          actualUnitCostMinor: 10000,
          lineTotalMinor: 40000,
        },
      ],
    });
    expect(partial.purchaseOrder.status).toBe('partially_received');
    expect(partial.purchaseOrder.lines[0].receivedQuantity).toBe(4000);
    expect(partial.purchaseOrder.lines[0].outstandingQuantity).toBe(6000);
    expect(partial.purchaseOrder.receivedTotalMinor).toBe(40000);

    const midway = await balance(ITEM_CAFE_PARTIAL);
    expect(midway.onHand - before.onHand).toBe(4000);
    expect(midway.inTransit - before.inTransit).toBe(10000 - 4000);

    const receiptRows = await receiptsFor(purchaseOrder.id);
    expect(receiptRows.rowCount).toBe(1);
    // Derived by the same trigger the POS cart uses, never supplied by the client.
    expect(receiptRows.rows[0].business_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number(receiptRows.rows[0].total_minor)).toBe(40000);

    const received = (await ledger(ITEM_CAFE_PARTIAL)).at(-1);
    expect(received?.entry_type).toBe('purchase_received');
    expect(received?.source_aggregate_type).toBe('purchase_order_receipt_line');
    expect(Number(received?.effect_on_hand)).toBe(4000);
    expect(Number(received?.effect_in_transit)).toBe(-4000);

    // And the rest next week — the same order, a second command.
    const rest = await receive({
      purchaseOrderId: purchaseOrder.id,
      expectedVersion: partial.purchaseOrder.version,
      lines: [
        {
          purchaseOrderLineId: lineId,
          quantity: { value: 6000, scale: 3, unit: 'kilogram' },
          actualUnitCostMinor: 10500,
          lineTotalMinor: 63000,
        },
      ],
    });
    expect(rest.purchaseOrder.status).toBe('received');
    expect(rest.purchaseOrder.completedAt).not.toBeNull();
    expect(rest.purchaseOrder.receivedTotalMinor).toBe(103000);
    expect(rest.purchaseOrder.receipts.length).toBe(2);

    const after = await balance(ITEM_CAFE_PARTIAL);
    expect(after.onHand - before.onHand).toBe(10000);
    expect(after.inTransit).toBe(before.inTransit);
  });

  it('receives once when the same command is replayed', async () => {
    const before = await balance(ITEM_CAFE_IDEMPOTENT);
    const { purchaseOrder } = await createOrder([
      {
        inventoryItemId: ITEM_CAFE_IDEMPOTENT,
        supplierSku: null,
        description: 'Café idempotente',
        quantity: { value: 5000, scale: 3, unit: 'kilogram' },
        unitCostMinor: 9000,
        lineTotalMinor: 45000,
      },
    ]);
    const sent = await send(purchaseOrder.id, purchaseOrder.version);
    const key = randomUUID();
    const dto = {
      idempotencyKey: key,
      purchaseOrderId: purchaseOrder.id,
      expectedVersion: sent.purchaseOrder.version,
      lines: [
        {
          purchaseOrderLineId: sent.purchaseOrder.lines[0].id,
          quantity: { value: 5000, scale: 3, unit: 'kilogram' } as const,
          actualUnitCostMinor: 9000,
          lineTotalMinor: 45000,
        },
      ],
    };
    const first = await receive(dto);
    const replay = await receive(dto);

    expect(replay.purchaseOrder.status).toBe('received');
    expect(replay.purchaseOrder.receivedTotalMinor).toBe(first.purchaseOrder.receivedTotalMinor);
    expect(replay.purchaseOrder.receipts.length).toBe(1);
    expect((await receiptsFor(purchaseOrder.id)).rowCount).toBe(1);

    // The claim that matters: the stock moved ONCE.
    const after = await balance(ITEM_CAFE_IDEMPOTENT);
    expect(after.onHand - before.onHand).toBe(5000);
    expect(after.inTransit).toBe(before.inTransit);
    /*
     * COUNTED AGAINST THIS ORDER'S OWN LINE, not against every receipt the item has
     * ever had: the ledger is append-only, so a previous run's entry for the same
     * item is still there and a bare count would drift upward with every run while
     * saying nothing about this replay. The line id is the ledger's
     * `source_aggregate_id` for a receipt, which is exactly what makes this precise.
     */
    const posted = await pg.tquery<{ count: string }>(
      MERCHANT,
      `SELECT count(*)::text AS count FROM merchant.stock_ledger_entry
        WHERE merchant_id=$1::uuid AND inventory_item_id=$2::uuid
          AND entry_type='purchase_received' AND source_aggregate_id=$3::uuid`,
      [MERCHANT, ITEM_CAFE_IDEMPOTENT, dto.lines[0].purchaseOrderLineId],
    );
    expect(posted.rows[0].count).toBe('1');
  });

  it('refuses an over-receipt, names the line, and moves nothing at all', async () => {
    const before = await balance(ITEM_CAFE_GUARD);
    const { purchaseOrder } = await createOrder([
      {
        inventoryItemId: ITEM_CAFE_GUARD,
        supplierSku: null,
        description: 'Café guardado',
        quantity: { value: 2000, scale: 3, unit: 'kilogram' },
        unitCostMinor: 1000,
        lineTotalMinor: 2000,
      },
      {
        inventoryItemId: ITEM_SERV_ORDERED,
        supplierSku: 'SERV-500',
        description: 'Servilletas',
        quantity: { value: 10, scale: 0, unit: 'package' },
        unitCostMinor: 3500,
        lineTotalMinor: 35000,
      },
    ]);
    const sent = await send(purchaseOrder.id, purchaseOrder.version);
    const [firstLine, secondLine] = sent.purchaseOrder.lines;
    /*
     * THE BASELINE IS TAKEN AFTER THE SEND, and that is the only honest place to
     * take it. Sending legitimately put the ordered goods in transit — that is what
     * sending DOES — so a baseline from before the order would make the send look
     * like the receipt's doing. The claim being tested is narrower and exact: the
     * refused receipt changed nothing AT ALL.
     */
    const afterSend = await balance(ITEM_CAFE_GUARD);

    // The FIRST line is perfectly legal; the second asks for one package too many.
    const refused = await refusal(() =>
      receive({
        purchaseOrderId: purchaseOrder.id,
        expectedVersion: sent.purchaseOrder.version,
        lines: [
          {
            purchaseOrderLineId: firstLine.id,
            quantity: { value: 2000, scale: 3, unit: 'kilogram' },
            actualUnitCostMinor: 1000,
            lineTotalMinor: 2000,
          },
          {
            purchaseOrderLineId: secondLine.id,
            quantity: { value: 11, scale: 0, unit: 'package' },
            actualUnitCostMinor: 3500,
            lineTotalMinor: 38500,
          },
        ],
      }),
    );
    expect(refused.status).toBe(409);
    expect(refused.code).toBe('PURCHASE_ORDER_OVER_RECEIPT');
    // The refusal names the LINE, which is what makes it actionable.
    expect(refused.fieldErrors?.purchaseOrderLineId).toEqual([secondLine.id]);
    expect(refused.details?.outstanding).toBe(10);
    expect(refused.details?.requested).toBe(11);

    // NOTHING MOVED: neither line, and the order is still exactly as it was sent.
    const after = await balance(ITEM_CAFE_GUARD);
    expect(after).toEqual(afterSend);
    expect(after.onHand).toBe(before.onHand);
    expect((await receiptsFor(purchaseOrder.id)).rowCount).toBe(0);
    const order = await scoped(() =>
      procurement.getPurchaseOrder(access, { locationId: LOCATION }, purchaseOrder.id),
    );
    expect(order.status).toBe('sent');
    expect(order.lines.map((line) => line.receivedQuantity)).toEqual([0, 0]);
  });

  it('refuses an over-receipt from raw SQL, with no TypeScript in the path', async () => {
    const { purchaseOrder } = await createOrder([
      {
        inventoryItemId: ITEM_CAFE,
        supplierSku: null,
        description: 'Café',
        quantity: { value: 1000, scale: 3, unit: 'kilogram' },
        unitCostMinor: 1000,
        lineTotalMinor: 1000,
      },
    ]);
    const lineId = purchaseOrder.lines[0].id;
    // The constraint, not the service: this is the backstop that makes the refusal
    // true even for a writer that never asked the API.
    await expect(
      pg.query(
        `UPDATE merchant.purchase_order_line SET received_quantity = ordered_quantity + 1
          WHERE merchant_id=$1::uuid AND id=$2::uuid`,
        [MERCHANT, lineId],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it('cancels a sent order and releases what is still in transit', async () => {
    const before = await balance(ITEM_CAFE_CANCEL);
    const { purchaseOrder } = await createOrder([
      {
        inventoryItemId: ITEM_CAFE_CANCEL,
        supplierSku: null,
        description: 'Café cancelado',
        quantity: { value: 8000, scale: 3, unit: 'kilogram' },
        unitCostMinor: 10000,
        lineTotalMinor: 80000,
      },
    ]);
    const sent = await send(purchaseOrder.id, purchaseOrder.version);
    expect((await balance(ITEM_CAFE_CANCEL)).inTransit - before.inTransit).toBe(8000);

    const partial = await receive({
      purchaseOrderId: purchaseOrder.id,
      expectedVersion: sent.purchaseOrder.version,
      lines: [
        {
          purchaseOrderLineId: sent.purchaseOrder.lines[0].id,
          quantity: { value: 3000, scale: 3, unit: 'kilogram' },
          actualUnitCostMinor: 10000,
          lineTotalMinor: 30000,
        },
      ],
    });
    const cancelled = await cancel(
      purchaseOrder.id,
      partial.purchaseOrder.version,
      'El proveedor cerró',
    );
    expect(cancelled.purchaseOrder.status).toBe('cancelled');
    expect(cancelled.purchaseOrder.cancelledAt).not.toBeNull();
    expect(cancelled.purchaseOrder.note).toBe('El proveedor cerró');

    // 8000 went in, 3000 arrived, 5000 came back out: nothing is left in transit.
    const after = await balance(ITEM_CAFE_CANCEL);
    expect(after.inTransit).toBe(before.inTransit);
    expect(after.onHand - before.onHand).toBe(3000);
    const release = (await ledger(ITEM_CAFE_CANCEL)).at(-1);
    expect(release?.entry_type).toBe('purchase_order_cancelled');
    expect(Number(release?.effect_in_transit)).toBe(-5000);
  });

  it('cancels a draft without touching stock, because a draft was never in transit', async () => {
    const before = await balance(ITEM_CAFE_CANCEL_DRAFT);
    const { purchaseOrder } = await createOrder([
      {
        inventoryItemId: ITEM_CAFE_CANCEL_DRAFT,
        supplierSku: null,
        description: 'Café borrador',
        quantity: { value: 4000, scale: 3, unit: 'kilogram' },
        unitCostMinor: 10000,
        lineTotalMinor: 40000,
      },
    ]);
    const cancelled = await cancel(purchaseOrder.id, purchaseOrder.version);
    expect(cancelled.purchaseOrder.status).toBe('cancelled');
    expect(cancelled.purchaseOrder.sentAt).toBeNull();
    const after = await balance(ITEM_CAFE_CANCEL_DRAFT);
    expect(after).toEqual(before);
    expect((await ledger(ITEM_CAFE_CANCEL_DRAFT)).length).toBe(0);
  });

  it('refuses another merchant’s supplier, order and item, and reports them as absent', async () => {
    // A supplier of the neighbour, seen from this merchant: not found, because RLS
    // makes it invisible rather than because the API remembered to filter.
    expect(
      (
        await refusal(() =>
          createOrder(
            [
              {
                inventoryItemId: ITEM_CAFE,
                supplierSku: null,
                description: 'Café',
                quantity: { value: 1000, scale: 3, unit: 'kilogram' },
                unitCostMinor: 1000,
                lineTotalMinor: 1000,
              },
            ],
            { supplierId: NEIGHBOUR_SUPPLIER },
          ),
        )
      ).code,
    ).toBe('SUPPLIER_NOT_FOUND');

    // An item of the neighbour, ordered by this merchant: the same.
    expect(
      (
        await refusal(() =>
          createOrder([
            {
              inventoryItemId: ITEM_NEIGHBOUR,
              supplierSku: null,
              description: 'Café',
              quantity: { value: 1000, scale: 3, unit: 'kilogram' },
              unitCostMinor: 1000,
              lineTotalMinor: 1000,
            },
          ]),
        )
      ).code,
    ).toBe('INVENTORY_ITEM_ARCHIVED');

    // A STOCK LOCATION of the neighbour, addressed by this merchant. The reference
    // is (merchant, location, id), so the neighbour's stock room cannot be named
    // even by a manager who can switch locations inside their own business.
    expect(
      (
        await refusal(() =>
          createOrder(
            [
              {
                inventoryItemId: ITEM_CAFE,
                supplierSku: null,
                description: 'Café',
                quantity: { value: 1000, scale: 3, unit: 'kilogram' },
                unitCostMinor: 1000,
                lineTotalMinor: 1000,
              },
            ],
            { inventoryLocationId: NEIGHBOUR_STOCK_ROOM },
          ),
        )
      ).code,
    ).toBe('INVENTORY_LOCATION_CHANGED');

    // And the neighbour's own order, received by this merchant: absent, not "yours".
    const neighbourOrder = await scoped(
      () =>
        procurement.createPurchaseOrder(neighbourAccess, {
          locationId: NEIGHBOUR_LOCATION,
          idempotencyKey: randomUUID(),
          inventoryLocationId: NEIGHBOUR_STOCK_ROOM,
          supplierId: NEIGHBOUR_SUPPLIER,
          currency: 'MXN',
          expectedOn: null,
          note: null,
          lines: [
            {
              inventoryItemId: ITEM_NEIGHBOUR,
              supplierSku: null,
              description: 'Café vecino',
              quantity: { value: 1000, scale: 3, unit: 'kilogram' },
              unitCostMinor: 1000,
              lineTotalMinor: 1000,
            },
          ],
        }),
      NEIGHBOUR,
      NEIGHBOUR_LOCATION,
      NEIGHBOUR_USER,
    );
    expect(neighbourOrder.purchaseOrder.status).toBe('draft');
    const stolen = await refusal(() =>
      scoped(() =>
        procurement.getPurchaseOrder(
          access,
          { locationId: LOCATION },
          neighbourOrder.purchaseOrder.id,
        ),
      ),
    );
    expect(stolen.status).toBe(404);
    expect(stolen.code).toBe('PURCHASE_ORDER_NOT_FOUND');
  });

  it('refuses a line whose total does not follow from its own price, and names the line', async () => {
    const refused = await refusal(() =>
      createOrder([
        {
          inventoryItemId: ITEM_CAFE,
          supplierSku: null,
          description: 'Café',
          quantity: { value: 2000, scale: 3, unit: 'kilogram' },
          unitCostMinor: 10000,
          lineTotalMinor: 20000,
        },
        {
          inventoryItemId: ITEM_SERV_ORDERED,
          supplierSku: null,
          description: 'Servilletas',
          quantity: { value: 10, scale: 0, unit: 'package' },
          unitCostMinor: 3500,
          // 10 × $35.00 is $350.00; this is a hundred pesos more.
          lineTotalMinor: 45000,
        },
      ]),
    );
    expect(refused.code).toBe('PURCHASE_ORDER_LINE_TOTAL_MISMATCH');
    expect(refused.fieldErrors?.lineNumbers).toEqual(['2']);
    expect(refused.fieldErrors?.expectedMinorUnits).toEqual(['35000']);
  });

  it('refuses an order against an archived supplier, and receiving a draft', async () => {
    expect(
      (
        await refusal(() =>
          createOrder(
            [
              {
                inventoryItemId: ITEM_CAFE,
                supplierSku: null,
                description: 'Café',
                quantity: { value: 1000, scale: 3, unit: 'kilogram' },
                unitCostMinor: 1000,
                lineTotalMinor: 1000,
              },
            ],
            { supplierId: SUPPLIER_ARCHIVED },
          ),
        )
      ).code,
    ).toBe('SUPPLIER_ARCHIVED');

    // Receiving something that was never sent: a draft has nothing in transit, so
    // there is nothing that could have arrived.
    const { purchaseOrder } = await createOrder([
      {
        inventoryItemId: ITEM_CAFE,
        supplierSku: null,
        description: 'Café',
        quantity: { value: 1000, scale: 3, unit: 'kilogram' },
        unitCostMinor: 1000,
        lineTotalMinor: 1000,
      },
    ]);
    expect(
      (
        await refusal(() =>
          receive({
            purchaseOrderId: purchaseOrder.id,
            expectedVersion: purchaseOrder.version,
            lines: [
              {
                purchaseOrderLineId: purchaseOrder.lines[0].id,
                quantity: { value: 1000, scale: 3, unit: 'kilogram' },
                actualUnitCostMinor: 1000,
                lineTotalMinor: 1000,
              },
            ],
          }),
        )
      ).code,
    ).toBe('PURCHASE_ORDER_NOT_SENT');
  });

  it('lists purchases by supplier and status, and pages them', async () => {
    const list = await scoped(() =>
      procurement.listPurchaseOrders(access, {
        locationId: LOCATION,
        limit: 100,
      }),
    );
    // The cases above raised orders; the list must see them, newest first.
    expect(list.purchaseOrders.length).toBeGreaterThan(0);
    expect(list.page.limit).toBe(100);
    /*
     * THE CLAIM IS THAT PAGING WORKS, NOT THAT A HUNDRED COVERS THIS CAFÉ FOREVER.
     *
     * Nothing in this file deletes an order — a receipt is append-only and an order that
     * has one cannot go — so "one page holds everything" is a claim about how many times
     * the suite has run, not about the API. It held until this merchant passed a hundred
     * orders and then it failed for a reason no code change could fix. The assertion
     * below states what the route must do instead: offer the next page, and start that
     * page strictly after the last row of this one.
     */
    if (list.page.hasMore) {
      expect(list.page.nextCursor).not.toBeNull();
      const secondPage = await scoped(() =>
        procurement.listPurchaseOrders(access, {
          locationId: LOCATION,
          limit: 100,
          cursor: list.page.nextCursor as string,
        }),
      );
      expect(secondPage.purchaseOrders.length).toBeGreaterThan(0);
      expect(secondPage.purchaseOrders[0].createdAt <= list.purchaseOrders.at(-1)!.createdAt).toBe(
        true,
      );
    } else {
      expect(list.page.nextCursor).toBeNull();
    }

    const cancelledOnly = await scoped(() =>
      procurement.listPurchaseOrders(access, {
        locationId: LOCATION,
        status: 'cancelled',
        limit: 100,
      }),
    );
    expect(cancelledOnly.purchaseOrders.length).toBeGreaterThan(0);
    expect(cancelledOnly.purchaseOrders.every((order) => order.status === 'cancelled')).toBe(true);
    expect(cancelledOnly.purchaseOrders.every((order) => order.lines.length >= 1)).toBe(true);

    const bySupplier = await scoped(() =>
      procurement.listPurchaseOrders(access, {
        locationId: LOCATION,
        supplierId: SUPPLIER,
        limit: 100,
      }),
    );
    expect(bySupplier.purchaseOrders.every((order) => order.supplierId === SUPPLIER)).toBe(true);
    expect(bySupplier.purchaseOrders[0].supplierReference).toBe('CAFETERIA');
    expect(bySupplier.purchaseOrders[0].supplierName).toBe('Cafetería del Sur');
  });

  it('creates, lists and amends a supplier, refusing a taken reference and a stale version', async () => {
    const created = await scoped(() =>
      procurement.createSupplier(access, {
        locationId: LOCATION,
        idempotencyKey: randomUUID(),
        publicReference: SUPPLIER_NEW,
        displayName: 'Proveedor Nuevo',
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        note: null,
      }),
    );
    expect(created.supplier.active).toBe(true);

    expect(
      (
        await refusal(() =>
          scoped(() =>
            procurement.createSupplier(access, {
              locationId: LOCATION,
              idempotencyKey: randomUUID(),
              publicReference: SUPPLIER_NEW,
              displayName: 'Otro',
              contactName: null,
              contactEmail: null,
              contactPhone: null,
              note: null,
            }),
          ),
        )
      ).code,
    ).toBe('SUPPLIER_REFERENCE_TAKEN');

    const listed = await scoped(() =>
      procurement.listSuppliers(access, { includeArchived: true, limit: 100 }),
    );
    const mine = listed.suppliers.find((row) => row.publicReference === SUPPLIER_NEW);
    expect(mine).toBeDefined();

    const amended = await scoped(() =>
      procurement.updateSupplier(access, {
        locationId: LOCATION,
        idempotencyKey: randomUUID(),
        supplierId: created.supplier.id,
        expectedVersion: created.supplier.version,
        displayName: 'Proveedor Nuevo S.A.',
        active: false,
      }),
    );
    expect(amended.supplier.displayName).toBe('Proveedor Nuevo S.A.');
    expect(amended.supplier.active).toBe(false);
    expect(amended.supplier.archivedAt).not.toBeNull();

    expect(
      (
        await refusal(() =>
          scoped(() =>
            procurement.updateSupplier(access, {
              locationId: LOCATION,
              idempotencyKey: randomUUID(),
              supplierId: created.supplier.id,
              expectedVersion: created.supplier.version,
              displayName: 'Stale',
            }),
          ),
        )
      ).code,
    ).toBe('OPTIMISTIC_VERSION_CONFLICT');

    // Archived suppliers stay out of the default list, and the default is the one a
    // picker uses: an operator choosing a supplier must not be offered a retired one.
    const activeOnly = await scoped(() =>
      procurement.listSuppliers(access, { includeArchived: false, limit: 100 }),
    );
    expect(activeOnly.suppliers.some((row) => row.publicReference === SUPPLIER_NEW)).toBe(false);
  });

  /**
   * SUPPLIER INVOICES (plan §10 and §11, phase 5), driven through the console's own
   * command door.
   *
   * Every claim below is read back from the DATABASE or from a response parsed against
   * its contract model. The command door is the real one — the context service, the
   * policy and the fingerprint all run — because the upload, the match and the commit
   * are operations rather than routes (plan D15), and a test that called the service
   * directly would prove nothing about the door the console actually uses.
   */
  describe('supplier invoices · upload, match and commit', () => {
    const consoleUser: AuthUser = {
      id: USER,
      email: null,
      sessionId: DASHBOARD_SESSION,
      deviceId: null,
      commandContextType: 'dashboard_administrative',
    };

    /**
     * The two invoice keys migration 76 grants to a manager, plus the approval key it
     * grants to owner and admin alone. This persona is an owner, so it holds all three.
     */
    const invoiceAccess: MerchantAccess = {
      ...access,
      merchantId: INVOICE_MERCHANT,
      locationId: INVOICE_LOCATION,
      membershipId: STAFF,
      permissions: ['merchant.manage', 'inventory.invoice.capture', 'inventory.invoice.approve'],
    };

    type InvoiceOperation =
      'inventory.invoice.upload' | 'inventory.invoice.match' | 'inventory.invoice.commit';

    const command = (
      operation: InvoiceOperation,
      targetAggregateId: string,
      parameters: Record<string, unknown>,
      keys: { commandId?: string; idempotencyKey?: string } = {},
    ) =>
      scoped(
        () =>
          commands.execute(consoleUser, invoiceAccess, {
            operation,
            locationId: INVOICE_LOCATION,
            targetAggregateId,
            targetVersion: null,
            commandId: keys.commandId ?? randomUUID(),
            idempotencyKey: keys.idempotencyKey ?? randomUUID(),
            parameters,
            approvalId: null,
          }),
        INVOICE_MERCHANT,
        INVOICE_LOCATION,
      );

    /** An order in the invoice merchant, raised the way the console raises one. */
    const order = (lines: CreatePurchaseOrderRequest['lines']) =>
      scoped(
        () =>
          procurement.createPurchaseOrder(invoiceAccess, {
            locationId: INVOICE_LOCATION,
            idempotencyKey: randomUUID(),
            inventoryLocationId: INVOICE_STOCK_ROOM,
            supplierId: INVOICE_SUPPLIER,
            currency: 'MXN',
            expectedOn: null,
            note: null,
            lines,
          }),
        INVOICE_MERCHANT,
        INVOICE_LOCATION,
      );

    const sendOrder = (purchaseOrderId: string, expectedVersion: number) =>
      scoped(
        () =>
          procurement.sendPurchaseOrder(invoiceAccess, {
            locationId: INVOICE_LOCATION,
            idempotencyKey: randomUUID(),
            purchaseOrderId,
            expectedVersion,
          }),
        INVOICE_MERCHANT,
        INVOICE_LOCATION,
      );

    const receiveOrder = (dto: {
      purchaseOrderId: string;
      expectedVersion: number;
      lines: ReceivePurchaseOrderRequest['lines'];
    }) =>
      scoped(
        () =>
          procurement.receivePurchaseOrder(invoiceAccess, {
            locationId: INVOICE_LOCATION,
            idempotencyKey: randomUUID(),
            purchaseOrderId: dto.purchaseOrderId,
            expectedVersion: dto.expectedVersion,
            note: null,
            lines: dto.lines,
          }),
        INVOICE_MERCHANT,
        INVOICE_LOCATION,
      );

    const invoiceBalance = (inventoryItemId: string) =>
      repo.stockPosition(INVOICE_MERCHANT, INVOICE_STOCK_ROOM, inventoryItemId);

    const uploadXml = async (invoiceId: string, xml: string) => {
      const result = (await command('inventory.invoice.upload', invoiceId, {
        source: 'cfdi_xml',
        cfdiXml: xml,
        supplierId: INVOICE_SUPPLIER,
      })) as { supplierInvoice: unknown; created: boolean };
      return { invoice: SupplierInvoice.parse(result.supplierInvoice), created: result.created };
    };

    /** The invoice rows the upload wrote, with the number of lines each one carries. */
    const invoiceRows = (uuid: string) =>
      pg.tquery<{ id: string; status: string; line_count: string; folio: string | null }>(
        INVOICE_MERCHANT,
        `SELECT si.id::text AS id,si.status,si.folio,
                (SELECT count(*) FROM merchant.supplier_invoice_line l
                  WHERE l.merchant_id=si.merchant_id AND l.supplier_invoice_id=si.id)::text
                  AS line_count
           FROM merchant.supplier_invoice si
          WHERE si.merchant_id=$1::uuid AND si.cfdi_uuid=$2::uuid`,
        [INVOICE_MERCHANT, uuid],
      );

    /**
     * The inbox READ, paged until it names one invoice. Every page is parsed against
     * `SupplierInvoiceList`, which is the same check the console's own client makes.
     */
    const inboxInvoice = async (uuid: string) => {
      let cursor: string | undefined;
      for (let page = 0; page < 5; page += 1) {
        const parsed = SupplierInvoiceList.parse(
          await scoped(
            () =>
              procurement.listSupplierInvoices(invoiceAccess, {
                supplierId: INVOICE_SUPPLIER,
                limit: 100,
                ...(cursor === undefined ? {} : { cursor }),
              }),
            INVOICE_MERCHANT,
            INVOICE_LOCATION,
          ),
        );
        const found = parsed.invoices.find((invoice) => invoice.cfdiUuid === uuid);
        if (found) return found;
        if (parsed.page.nextCursor === null) return null;
        cursor = parsed.page.nextCursor;
      }
      return null;
    };

    /** A money attribute for this file's CFDI, written in integer arithmetic. */
    const money = (minorUnits: number): string =>
      `${Math.trunc(minorUnits / 100)}.${String(minorUnits % 100).padStart(2, '0')}`;

    it('answers the FIRST invoice on a second upload of the same UUID, and writes no second row', async () => {
      const uuid = runUuid(0x01);
      const xml = cfdiWithOneConcept({
        uuid,
        folio: `F-${RUN}-1`,
        description: 'Café de factura',
        sku: null,
        cantidad: '10.000',
        valorUnitario: '120.50',
        importe: '1205.00',
      });

      const first = await uploadXml(randomUUID(), xml);
      expect(first.created).toBe(true);
      expect(first.invoice.cfdiUuid).toBe(uuid);
      expect(first.invoice.folio).toBe(`F-${RUN}-1`);
      expect(first.invoice.issuedOn).toBe('2026-09-17');
      expect(first.invoice.subtotalMinor).toBe(120500);
      expect(first.invoice.lines).toHaveLength(1);
      expect(first.invoice.lines[0].quantity).toEqual({
        value: 10000,
        scale: 3,
        unit: 'kilogram',
      });
      expect(first.invoice.lines[0].unitCostMinor).toBe(12050);

      // THE SAME FILE AGAIN, under a DIFFERENT command identity: a second upload is not
      // an error, and it must answer the first invoice rather than write a second row.
      const second = await uploadXml(randomUUID(), xml);
      expect(second.created).toBe(false);
      expect(second.invoice.id).toBe(first.invoice.id);
      expect(second.invoice.lines).toHaveLength(1);
      expect(second.invoice.lines[0].id).toBe(first.invoice.lines[0].id);

      const rows = await invoiceRows(uuid);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].id).toBe(first.invoice.id);
      expect(rows.rows[0].line_count).toBe('1');

      const inbox = await inboxInvoice(uuid);
      expect(inbox).not.toBeNull();
      expect(inbox?.id).toBe(first.invoice.id);
    });

    it('refuses the commit while a line is unmatched, then remembers the manual match', async () => {
      const uploaded = await uploadXml(
        randomUUID(),
        cfdiWithOneConcept({
          uuid: runUuid(0x02),
          folio: `F-${RUN}-2`,
          description: UNMATCHABLE,
          sku: null,
          cantidad: '1.000',
          valorUnitario: '250.00',
          importe: '250.00',
        }),
      );
      expect(uploaded.invoice.status).toBe('uploaded');
      expect(uploaded.invoice.lines[0].matchMethod).toBe('unmatched');
      expect(uploaded.invoice.lines[0].matchConfidence).toBe(0);
      expect(uploaded.invoice.lines[0].matchedInventoryItemId).toBeNull();
      const line = uploaded.invoice.lines[0];

      const purchaseOrder = await order([
        {
          inventoryItemId: ITEM_INVOICE,
          supplierSku: null,
          description: 'Café de factura',
          quantity: { value: 1000, scale: 3, unit: 'kilogram' },
          unitCostMinor: 25000,
          lineTotalMinor: 25000,
        },
      ]);
      const sent = await sendOrder(
        purchaseOrder.purchaseOrder.id,
        purchaseOrder.purchaseOrder.version,
      );

      const blocked = await refusal(() =>
        command('inventory.invoice.commit', uploaded.invoice.id, {
          purchaseOrderId: sent.purchaseOrder.id,
          note: null,
          lines: [
            {
              lineId: line.id,
              purchaseOrderLineId: sent.purchaseOrder.lines[0].id,
              receivedQuantity: { value: 1000, scale: 3, unit: 'kilogram' },
              unitCostMinor: 25000,
              lotCode: null,
            },
          ],
        }),
      );
      expect(blocked.code).toBe('SUPPLIER_INVOICE_UNMATCHED_LINES');
      expect(blocked.details?.unmatchedLineIds).toEqual([line.id]);

      // The person answers. The answer is written back as the supplier's own code, which
      // is how the NEXT invoice of that supplier matches without anybody looking.
      const matched = (await command('inventory.invoice.match', uploaded.invoice.id, {
        lines: [{ lineId: line.id, inventoryItemId: ITEM_INVOICE, supplierSku: INVOICE_SKU }],
      })) as { supplierInvoice: unknown };
      const matchedInvoice = SupplierInvoice.parse(matched.supplierInvoice);
      expect(matchedInvoice.lines[0].matchMethod).toBe('manual');
      expect(matchedInvoice.lines[0].matchConfidence).toBe(100);
      expect(matchedInvoice.lines[0].matchedInventoryItemId).toBe(ITEM_INVOICE);
      expect(matchedInvoice.lines[0].matchedInventoryItemName).toBe('Café de factura');
      expect(matchedInvoice.lines[0].supplierSku).toBe(INVOICE_SKU);
      expect(matchedInvoice.status).toBe('matched');

      const remembered = await uploadXml(
        randomUUID(),
        cfdiWithOneConcept({
          uuid: runUuid(0x03),
          folio: `F-${RUN}-3`,
          description: `Nombre distinto ${RUN}`,
          sku: INVOICE_SKU,
          cantidad: '1.000',
          valorUnitario: '250.00',
          importe: '250.00',
        }),
      );
      expect(remembered.invoice.lines[0].matchMethod).toBe('supplier_sku');
      expect(remembered.invoice.lines[0].matchConfidence).toBe(100);
      expect(remembered.invoice.lines[0].matchedInventoryItemId).toBe(ITEM_INVOICE);

      // And the commit that was refused now goes through.
      const committed = (await command('inventory.invoice.commit', uploaded.invoice.id, {
        purchaseOrderId: sent.purchaseOrder.id,
        note: null,
        lines: [
          {
            lineId: line.id,
            purchaseOrderLineId: sent.purchaseOrder.lines[0].id,
            receivedQuantity: { value: 1000, scale: 3, unit: 'kilogram' },
            unitCostMinor: 25000,
            lotCode: null,
          },
        ],
      })) as { supplierInvoice: unknown };
      expect(SupplierInvoice.parse(committed.supplierInvoice).status).toBe('committed');
    });

    it('proposes the prior line history and a remembered match before it guesses', async () => {
      /*
       * RULE 3, THE PRIOR LINE HISTORY. A line that carries no supplier code is proposed
       * from the description this supplier already used on an ORDER — a different memory
       * from a description a person has already matched. The description carries this
       * run's tag, so no earlier run's line can answer it first.
       */
      const historyDescription = `Historial de compra ${RUN}`;
      await order([
        {
          inventoryItemId: ITEM_INVOICE,
          supplierSku: null,
          description: historyDescription,
          quantity: { value: 1000, scale: 3, unit: 'kilogram' },
          unitCostMinor: 25000,
          lineTotalMinor: 25000,
        },
      ]);
      const fromHistory = await uploadXml(
        randomUUID(),
        cfdiWithOneConcept({
          uuid: runUuid(0x07),
          folio: `F-${RUN}-7`,
          description: historyDescription,
          sku: null,
          cantidad: '1.000',
          valorUnitario: '250.00',
          importe: '250.00',
        }),
      );
      expect(fromHistory.invoice.lines[0].matchMethod).toBe('history');
      expect(fromHistory.invoice.lines[0].matchConfidence).toBe(90);
      expect(fromHistory.invoice.lines[0].matchedInventoryItemId).toBe(ITEM_INVOICE);

      /*
       * RULE 2, THE REMEMBERED MATCH. The description is answered once by a person, with
       * NO supplier code on the request, so the only thing the next invoice can be
       * matched from is the answer itself.
       */
      const rememberedDescription = `Recordado ${RUN}`;
      const firstSight = await uploadXml(
        randomUUID(),
        cfdiWithOneConcept({
          uuid: runUuid(0x08),
          folio: `F-${RUN}-8`,
          description: rememberedDescription,
          sku: null,
          cantidad: '1.000',
          valorUnitario: '300.00',
          importe: '300.00',
        }),
      );
      // Whether this first sight landed on a fuzzy guess or on nothing is not the claim;
      // either way a person answers it, and the answer is what the NEXT invoice must find.
      expect(firstSight.invoice.lines[0].matchedInventoryItemId).not.toBe(ITEM_INVOICE_PHOTO);
      const answered = (await command('inventory.invoice.match', firstSight.invoice.id, {
        lines: [
          {
            lineId: firstSight.invoice.lines[0].id,
            inventoryItemId: ITEM_INVOICE_PHOTO,
            supplierSku: null,
          },
        ],
      })) as { supplierInvoice: unknown };
      expect(SupplierInvoice.parse(answered.supplierInvoice).lines[0].matchMethod).toBe('manual');

      const secondSight = await uploadXml(
        randomUUID(),
        cfdiWithOneConcept({
          uuid: runUuid(0x09),
          folio: `F-${RUN}-9`,
          description: rememberedDescription,
          sku: null,
          cantidad: '2.000',
          valorUnitario: '300.00',
          importe: '600.00',
        }),
      );
      expect(secondSight.invoice.lines[0].matchMethod).toBe('remembered');
      expect(secondSight.invoice.lines[0].matchConfidence).toBe(95);
      expect(secondSight.invoice.lines[0].matchedInventoryItemId).toBe(ITEM_INVOICE_PHOTO);
      // The person sent no supplier code, so none was written: the memory is the
      // description, and inventing a code would be inventing evidence.
      expect(secondSight.invoice.lines[0].supplierSku).toBeNull();
    });

    it('writes the receipt through the receive path, and the cost basis names the invoice', async () => {
      const uuid = runUuid(0x04);
      const purchaseOrder = await order([
        {
          inventoryItemId: ITEM_INVOICE,
          supplierSku: INVOICE_SKU,
          description: 'Café de factura',
          quantity: { value: 20000, scale: 3, unit: 'kilogram' },
          unitCostMinor: 12050,
          lineTotalMinor: 241000,
        },
      ]);
      const sent = await sendOrder(
        purchaseOrder.purchaseOrder.id,
        purchaseOrder.purchaseOrder.version,
      );
      const before = await invoiceBalance(ITEM_INVOICE);

      const uploaded = await uploadXml(
        randomUUID(),
        cfdiWithOneConcept({
          uuid,
          folio: `F-${RUN}-4`,
          description: 'Café molido para la casa',
          sku: INVOICE_SKU,
          cantidad: '10.000',
          valorUnitario: '120.50',
          importe: '1205.00',
        }),
      );
      // The FIRST rule of the match order found it: the supplier's own code.
      expect(uploaded.invoice.lines[0].matchMethod).toBe('supplier_sku');
      expect(uploaded.invoice.lines[0].matchConfidence).toBe(100);
      expect(uploaded.invoice.status).toBe('matched');
      const line = uploaded.invoice.lines[0];

      const committed = (await command('inventory.invoice.commit', uploaded.invoice.id, {
        purchaseOrderId: sent.purchaseOrder.id,
        note: 'Entrega de la factura',
        lines: [
          {
            lineId: line.id,
            purchaseOrderLineId: sent.purchaseOrder.lines[0].id,
            receivedQuantity: { value: 10000, scale: 3, unit: 'kilogram' },
            unitCostMinor: 12050,
            lotCode: null,
          },
        ],
      })) as { supplierInvoice: unknown };
      expect(SupplierInvoice.parse(committed.supplierInvoice).status).toBe('committed');

      // A committed invoice's lines priced a receipt, and a receipt is immutable, so the
      // line can no longer be re-pointed at another item.
      const afterCommit = await refusal(() =>
        command('inventory.invoice.match', uploaded.invoice.id, {
          lines: [{ lineId: line.id, inventoryItemId: ITEM_INVOICE_PHOTO, supplierSku: null }],
        }),
      );
      expect(afterCommit.code).toBe('SUPPLIER_INVOICE_ALREADY_COMMITTED');

      // THE RECEIPT LINE NAMES THE DOCUMENT (§10.4), read from the tables themselves.
      const receiptLine = await pg.tquery<{
        invoice_line_id: string;
        received_quantity: string;
        actual_unit_cost_minor: string;
      }>(
        INVOICE_MERCHANT,
        `SELECT rl.invoice_line_id::text AS invoice_line_id,
                rl.received_quantity::text AS received_quantity,
                rl.actual_unit_cost_minor::text AS actual_unit_cost_minor
           FROM merchant.purchase_order_receipt_line rl
           JOIN merchant.purchase_order_receipt r
             ON r.merchant_id=rl.merchant_id AND r.id=rl.receipt_id
          WHERE rl.merchant_id=$1::uuid AND r.purchase_order_id=$2::uuid`,
        [INVOICE_MERCHANT, sent.purchaseOrder.id],
      );
      expect(receiptLine.rows).toHaveLength(1);
      expect(receiptLine.rows[0].invoice_line_id).toBe(line.id);
      expect(receiptLine.rows[0].received_quantity).toBe('10000');
      expect(receiptLine.rows[0].actual_unit_cost_minor).toBe('12050');

      // The same door the order's own receive uses moved the stock.
      const after = await invoiceBalance(ITEM_INVOICE);
      expect(after.onHand - before.onHand).toBe(10000);

      /*
       * THE COST BASIS NAMES ITS DOCUMENT. The basis the costing module answers with is
       * the quantity-weighted average of exactly these receipt lines; the join below is
       * what a document column on that read resolves to, and it is read from SQL rather
       * than from an API answer, per §12.4.
       */
      const named = await pg.tquery<{ folio: string | null; cfdi_uuid: string }>(
        INVOICE_MERCHANT,
        `SELECT si.folio,si.cfdi_uuid::text AS cfdi_uuid
           FROM merchant.purchase_order_receipt_line rl
           JOIN merchant.supplier_invoice_line sil
             ON sil.merchant_id=rl.merchant_id AND sil.id=rl.invoice_line_id
           JOIN merchant.supplier_invoice si
             ON si.merchant_id=sil.merchant_id AND si.id=sil.supplier_invoice_id
          WHERE rl.merchant_id=$1::uuid AND sil.id=$2::uuid`,
        [INVOICE_MERCHANT, line.id],
      );
      expect(named.rows).toHaveLength(1);
      expect(named.rows[0].folio).toBe(`F-${RUN}-4`);
      expect(named.rows[0].cfdi_uuid).toBe(uuid);

      const inbox = await inboxInvoice(uuid);
      expect(inbox?.status).toBe('committed');
    });

    it('flags a price that moved, with the last paid price and the order price on the line', async () => {
      const orderOne = await order([
        {
          inventoryItemId: ITEM_INVOICE_PRICE,
          supplierSku: PRICE_SKU,
          description: 'Café con cambio de precio',
          quantity: { value: 10000, scale: 3, unit: 'kilogram' },
          unitCostMinor: PRICE_BEFORE_MINOR,
          lineTotalMinor: 10 * PRICE_BEFORE_MINOR,
        },
      ]);
      const sentOne = await sendOrder(orderOne.purchaseOrder.id, orderOne.purchaseOrder.version);
      const delivered = await receiveOrder({
        purchaseOrderId: sentOne.purchaseOrder.id,
        expectedVersion: sentOne.purchaseOrder.version,
        lines: [
          {
            purchaseOrderLineId: sentOne.purchaseOrder.lines[0].id,
            quantity: { value: 10000, scale: 3, unit: 'kilogram' },
            actualUnitCostMinor: PRICE_BEFORE_MINOR,
            lineTotalMinor: 10 * PRICE_BEFORE_MINOR,
          },
        ],
      });
      expect(delivered.purchaseOrder.status).toBe('received');

      const orderTwo = await order([
        {
          inventoryItemId: ITEM_INVOICE_PRICE,
          supplierSku: PRICE_SKU,
          description: 'Café con cambio de precio',
          quantity: { value: 20000, scale: 3, unit: 'kilogram' },
          unitCostMinor: PRICE_BEFORE_MINOR,
          lineTotalMinor: 20 * PRICE_BEFORE_MINOR,
        },
      ]);
      const sentTwo = await sendOrder(orderTwo.purchaseOrder.id, orderTwo.purchaseOrder.version);

      const uuid = runUuid(0x05);
      const uploaded = await uploadXml(
        randomUUID(),
        cfdiWithOneConcept({
          uuid,
          folio: `F-${RUN}-5`,
          description: 'Café con cambio de precio',
          sku: PRICE_SKU,
          cantidad: '10.000',
          valorUnitario: money(PRICE_AFTER_MINOR),
          importe: money(10 * PRICE_AFTER_MINOR),
        }),
      );
      const line = uploaded.invoice.lines[0];
      expect(line.unitCostMinor).toBe(PRICE_AFTER_MINOR);
      // The last price this supplier charged for the item is the first order's own
      // receipt, and the open order expects that same price. This invoice charges more.
      expect(line.previousUnitCostMinor).toBe(PRICE_BEFORE_MINOR);
      expect(line.purchaseOrderUnitCostMinor).toBe(PRICE_BEFORE_MINOR);
      expect(line.priceChanged).toBe(true);

      await command('inventory.invoice.commit', uploaded.invoice.id, {
        purchaseOrderId: sentTwo.purchaseOrder.id,
        note: null,
        lines: [
          {
            lineId: line.id,
            purchaseOrderLineId: sentTwo.purchaseOrder.lines[0].id,
            receivedQuantity: { value: 10000, scale: 3, unit: 'kilogram' },
            unitCostMinor: PRICE_AFTER_MINOR,
            lotCode: null,
          },
        ],
      });

      // The flag survives the commit: the comparison excludes the receipt this invoice
      // itself wrote, so the number it moved FROM is still the earlier price.
      const inbox = await inboxInvoice(uuid);
      expect(inbox?.status).toBe('committed');
      expect(inbox?.lines[0].priceChanged).toBe(true);
      expect(inbox?.lines[0].previousUnitCostMinor).toBe(PRICE_BEFORE_MINOR);
      expect(inbox?.lines[0].purchaseOrderUnitCostMinor).toBe(PRICE_BEFORE_MINOR);
    });

    it('stores a photo and nothing else, and refuses to commit an invoice nobody confirmed', async () => {
      const invoiceId = randomUUID();
      const bytes = Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64');
      const result = (await command('inventory.invoice.upload', invoiceId, {
        source: 'photo',
        artifactBase64: ONE_PIXEL_PNG_BASE64,
        supplierId: INVOICE_SUPPLIER,
      })) as { supplierInvoice: unknown; created: boolean };
      const invoice = SupplierInvoice.parse(result.supplierInvoice);
      expect(result.created).toBe(true);
      expect(invoice.source).toBe('photo');
      expect(invoice.status).toBe('uploaded');
      expect(invoice.cfdiUuid).toBeNull();
      // D11: v1 has no extractor, so the image is stored and NO line is invented.
      expect(invoice.lines).toEqual([]);

      const stored = await pg.tquery<{ octets: number; content_type: string; lines: string }>(
        INVOICE_MERCHANT,
        `SELECT octet_length(si.artifact_bytes) AS octets,
                si.artifact_content_type AS content_type,
                (SELECT count(*) FROM merchant.supplier_invoice_line l
                  WHERE l.merchant_id=si.merchant_id AND l.supplier_invoice_id=si.id)::text
                  AS lines
           FROM merchant.supplier_invoice si
          WHERE si.merchant_id=$1::uuid AND si.id=$2::uuid`,
        [INVOICE_MERCHANT, invoiceId],
      );
      expect(stored.rows[0].octets).toBe(bytes.byteLength);
      expect(stored.rows[0].content_type).toBe('image/png');
      expect(stored.rows[0].lines).toBe('0');

      const purchaseOrder = await order([
        {
          inventoryItemId: ITEM_INVOICE_PHOTO,
          supplierSku: null,
          description: 'Factura fotografiada',
          quantity: { value: 4, scale: 0, unit: 'unit' },
          unitCostMinor: 100,
          lineTotalMinor: 400,
        },
      ]);
      const sent = await sendOrder(
        purchaseOrder.purchaseOrder.id,
        purchaseOrder.purchaseOrder.version,
      );
      const refused = await refusal(() =>
        command('inventory.invoice.commit', invoiceId, {
          purchaseOrderId: sent.purchaseOrder.id,
          note: null,
          lines: [
            {
              lineId: runUuid(0x06),
              purchaseOrderLineId: sent.purchaseOrder.lines[0].id,
              receivedQuantity: { value: 4, scale: 0, unit: 'unit' },
              unitCostMinor: 100,
              lotCode: null,
            },
          ],
        }),
      );
      // Nothing reaches the ledger from a document nobody confirmed (D11).
      expect(refused.code).toBe('SUPPLIER_INVOICE_HAS_NO_LINES');
    });
  });
});
