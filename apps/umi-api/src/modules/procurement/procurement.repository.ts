import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreatePurchaseOrderRequest,
  CreateSupplierRequest,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderQuery,
  PurchaseOrderReceipt,
  Supplier,
  SupplierInvoice,
  SupplierInvoiceLine,
  SupplierInvoiceLineMatchMethod,
  SupplierInvoiceQuery,
  SupplierQuery,
  UpdateSupplierRequest,
} from '@umi/contract';
import type { PoolClient } from 'pg';
import { randomBytes } from 'node:crypto';
import { PgService } from '../../shared/database/pg.service';
import type { ParsedCfdiInvoice } from './cfdi-parser';
import {
  extendedLineTotalMinor,
  lineTotalWithinRounding,
  overReceivedLine,
  outstandingQuantity,
  receiptTotalMinor,
  statusAfterReceipt,
} from './procurement-domain';
import { purchaseOrderReference } from './procurement-errors';

/** The unit union the database and the contract share, named once for casts. */
type PurchaseUnit =
  'unit' | 'gram' | 'kilogram' | 'milliliter' | 'liter' | 'portion' | 'package' | 'box';

/**
 * Purchasing, against the real schema (plan §8E step 3).
 *
 * WHERE EACH REFUSAL IS DECIDED, and why it is decided there:
 *
 *   · The version check is decided by `SELECT … FOR UPDATE` against the order row,
 *     in the caller's transaction, exactly as the floor plan does it. Two clerks
 *     receiving against one delivery must not both win.
 *   · The OVER-RECEIPT check is decided here, in TypeScript, for every line BEFORE
 *     any write. The database also refuses it
 *     (`purchase_order_line_not_over_received`), and that redundancy is deliberate:
 *     the constraint is the guarantee, and this is the refusal that can name the
 *     line and explain itself. Checking first is also what makes "nothing moves"
 *     true even for a two-line receipt whose second line is too large.
 *   · The STOCK consequences are decided by the database and nowhere else: every
 *     movement goes through `merchant.append_stock_ledger`, the same function the
 *     sale path posts through, so `stock_balance` has one writer and the ledger
 *     stays the authority.
 */

type SupplierRow = {
  id: string;
  merchant_id: string;
  public_reference: string;
  display_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  note: string | null;
  active: boolean;
  version: number;
  created_at: Date;
  archived_at: Date | null;
};

const SUPPLIER_COLUMNS = `id::text AS id,merchant_id::text AS merchant_id,public_reference,
  display_name,contact_name,contact_email,contact_phone,note,active,version,created_at,archived_at`;

export function supplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    publicReference: row.public_reference,
    displayName: row.display_name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    note: row.note,
    active: row.active,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    archivedAt: row.archived_at?.toISOString() ?? null,
  };
}

type OrderRow = {
  id: string;
  merchant_id: string;
  location_id: string;
  inventory_location_id: string;
  supplier_id: string;
  supplier_reference: string;
  supplier_name: string;
  public_reference: string;
  status: PurchaseOrder['status'];
  currency: string;
  expected_on: string | null;
  ordered_total_minor: string;
  received_total_minor: string;
  version: number;
  raised_by: string;
  note: string | null;
  created_at: Date;
  updated_at: Date;
  sent_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
};

type LineRow = {
  id: string;
  purchase_order_id: string;
  line_number: number;
  inventory_item_id: string;
  supplier_sku: string | null;
  description: string | null;
  ordered_quantity: string;
  quantity_scale: number;
  unit: string;
  received_quantity: string;
  unit_cost_minor: string;
  line_total_minor: string;
  received_line_total_minor: string;
};

type ReceiptRow = {
  id: string;
  purchase_order_id: string;
  inventory_location_id: string;
  received_by: string;
  business_date: string;
  total_minor: string;
  note: string | null;
  created_at: Date;
};

type ReceiptLineRow = {
  id: string;
  receipt_id: string;
  purchase_order_line_id: string;
  inventory_item_id: string;
  received_quantity: string;
  quantity_scale: number;
  unit: string;
  actual_unit_cost_minor: string;
  line_total_minor: string;
  stock_ledger_entry_id: string | null;
};

/**
 * `bigint` arrives as a STRING from node-postgres, and that is a feature: money and
 * scaled quantities stay exact through the driver instead of passing through a
 * double. The conversion to `number` happens here, once, with a range check — the
 * schema bounds every one of these columns well below `Number.MAX_SAFE_INTEGER`.
 */
const int = (value: string | number): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RangeError('PROCUREMENT_VALUE_OUT_OF_RANGE');
  return parsed;
};

function orderLine(row: LineRow): PurchaseOrderLine {
  const ordered = int(row.ordered_quantity);
  const received = int(row.received_quantity);
  return {
    id: row.id,
    lineNumber: row.line_number,
    inventoryItemId: row.inventory_item_id,
    supplierSku: row.supplier_sku,
    description: row.description,
    orderedQuantity: { value: ordered, scale: row.quantity_scale, unit: row.unit as PurchaseUnit },
    receivedQuantity: received,
    outstandingQuantity: outstandingQuantity(ordered, received),
    unitCostMinor: int(row.unit_cost_minor),
    lineTotalMinor: int(row.line_total_minor),
    receivedLineTotalMinor: int(row.received_line_total_minor),
  };
}

function receiptLine(row: ReceiptLineRow) {
  return {
    id: row.id,
    purchaseOrderLineId: row.purchase_order_line_id,
    inventoryItemId: row.inventory_item_id,
    receivedQuantity: {
      value: int(row.received_quantity),
      scale: row.quantity_scale,
      unit: row.unit as PurchaseUnit,
    },
    actualUnitCostMinor: int(row.actual_unit_cost_minor),
    lineTotalMinor: int(row.line_total_minor),
    stockLedgerEntryId: row.stock_ledger_entry_id,
  };
}

// ── Supplier invoices (recipes module plan §10) ─────────────────────────────

type InvoiceRow = {
  id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  folio: string | null;
  cfdi_uuid: string | null;
  issued_on: string | null;
  currency: string;
  subtotal_minor: string;
  tax_minor: string;
  total_minor: string;
  source: SupplierInvoice['source'];
  status: SupplierInvoice['status'];
  correlation_id: string | null;
};

/**
 * One invoice line as the READ publishes it. Three of the columns are not stored:
 * `matched_item_name` is the item the join names, and the two price columns are
 * computed from the receipts and the open orders. A stored flag would go stale the
 * moment another delivery moved the last paid price, so the comparison is made when
 * the question is asked.
 */
type InvoiceLineRow = {
  id: string;
  supplier_invoice_id: string;
  line_number: number;
  raw_description: string;
  supplier_sku: string | null;
  quantity: string;
  quantity_scale: number;
  unit: string;
  unit_cost_minor: string;
  line_total_minor: string;
  matched_inventory_item_id: string | null;
  matched_item_name: string | null;
  match_method: SupplierInvoiceLineMatchMethod;
  match_confidence: number;
  previous_unit_cost_minor: string | null;
  purchase_order_unit_cost_minor: string | null;
};

function invoiceLine(row: InvoiceLineRow): SupplierInvoiceLine {
  const unitCostMinor = int(row.unit_cost_minor);
  const previous = row.previous_unit_cost_minor === null ? null : int(row.previous_unit_cost_minor);
  const expected =
    row.purchase_order_unit_cost_minor === null ? null : int(row.purchase_order_unit_cost_minor);
  return {
    id: row.id,
    lineNumber: row.line_number,
    rawDescription: row.raw_description,
    quantity: {
      value: int(row.quantity),
      scale: row.quantity_scale,
      unit: row.unit as PurchaseUnit,
    },
    unitCostMinor,
    lineTotalMinor: int(row.line_total_minor),
    matchedInventoryItemId: row.matched_inventory_item_id,
    matchedInventoryItemName: row.matched_item_name,
    matchMethod: row.match_method,
    matchConfidence: row.match_confidence,
    supplierSku: row.supplier_sku,
    // BOTH numbers travel with the flag, because "the price changed" without "from
    // what, to what" is a warning nobody can act on (plan §10.3).
    priceChanged:
      (previous !== null && previous !== unitCostMinor) ||
      (expected !== null && expected !== unitCostMinor),
    previousUnitCostMinor: previous,
    purchaseOrderUnitCostMinor: expected,
  };
}

/** `INV-<day>-<16 hex>`. Generated, like the order's reference, and unguessable. */
function supplierInvoiceReference(now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10).replaceAll('-', '');
  return `INV-${day}-${randomBytes(8).toString('hex')}`;
}

@Injectable()
export class ProcurementRepository {
  constructor(private readonly pg: PgService) {}

  // ── Suppliers ────────────────────────────────────────────────────────────

  listSuppliers(
    merchantId: string,
    query: SupplierQuery,
    cursor: { name: string; id: string } | null,
  ): Promise<{ rows: Supplier[]; hasMore: boolean }> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<SupplierRow>(
        `SELECT ${SUPPLIER_COLUMNS} FROM merchant.supplier
          WHERE merchant_id=$1::uuid
            AND ($2::boolean OR active)
            AND ($3::text IS NULL OR (display_name,id) > ($3::text,$4::uuid))
          ORDER BY display_name,id
          LIMIT $5`,
        [
          merchantId,
          query.includeArchived,
          cursor?.name ?? null,
          cursor?.id ?? null,
          query.limit + 1,
        ],
      );
      const hasMore = result.rows.length > query.limit;
      return { rows: result.rows.slice(0, query.limit).map(supplier), hasMore };
    });
  }

  async createSupplier(
    client: PoolClient,
    merchantId: string,
    dto: CreateSupplierRequest,
  ): Promise<Supplier> {
    const inserted = await client.query<SupplierRow>(
      `INSERT INTO merchant.supplier
         (merchant_id,public_reference,display_name,contact_name,contact_email,contact_phone,note)
       VALUES ($1::uuid,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (merchant_id,public_reference) DO NOTHING
       RETURNING ${SUPPLIER_COLUMNS}`,
      [
        merchantId,
        dto.publicReference,
        dto.displayName,
        dto.contactName,
        dto.contactEmail,
        dto.contactPhone,
        dto.note,
      ],
    );
    if (!inserted.rows[0])
      throw new ConflictException({
        code: 'SUPPLIER_REFERENCE_TAKEN',
        fieldErrors: { publicReference: [dto.publicReference] },
      });
    return supplier(inserted.rows[0]);
  }

  async updateSupplier(
    client: PoolClient,
    merchantId: string,
    dto: UpdateSupplierRequest,
  ): Promise<Supplier> {
    const locked = await client.query<SupplierRow>(
      `SELECT ${SUPPLIER_COLUMNS} FROM merchant.supplier
        WHERE merchant_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
      [merchantId, dto.supplierId],
    );
    const current = locked.rows[0];
    if (!current) throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND' });
    if (current.version !== dto.expectedVersion)
      throw new ConflictException({
        code: 'OPTIMISTIC_VERSION_CONFLICT',
        currentVersion: current.version,
      });
    // `active` is not a free switch: `supplier_supplier_archived_at_active` ties it
    // to `archived_at`, so the two move together and the timestamp is the audit
    // trail of when the merchant stopped buying from them.
    const active = dto.active ?? current.active;
    const updated = await client.query<SupplierRow>(
      `UPDATE merchant.supplier SET
         display_name=coalesce($3,display_name),
         contact_name=coalesce($4,contact_name),
         contact_email=coalesce($5,contact_email),
         contact_phone=coalesce($6,contact_phone),
         note=coalesce($7,note),
         active=$8,
         archived_at=CASE WHEN $8 THEN NULL ELSE coalesce(archived_at,clock_timestamp()) END,
         version=version+1
       WHERE merchant_id=$1::uuid AND id=$2::uuid
       RETURNING ${SUPPLIER_COLUMNS}`,
      [
        merchantId,
        dto.supplierId,
        dto.displayName ?? null,
        dto.contactName ?? null,
        dto.contactEmail ?? null,
        dto.contactPhone ?? null,
        dto.note ?? null,
        active,
      ],
    );
    return supplier(updated.rows[0]);
  }

  // ── Purchase orders ──────────────────────────────────────────────────────

  /**
   * Create an order, its lines and its money, in one transaction.
   *
   * `location_id` and `inventory_location_id` are checked against
   * `merchant.inventory_location` rather than trusted: a stock location that
   * belongs to another branch would put the goods in transit somewhere nobody can
   * receive them. The supplier is checked for the same reason and one more — an
   * archived supplier is a party the merchant has stopped buying from, and raising
   * a new order against one is a mistake worth naming.
   */
  async createPurchaseOrder(
    client: PoolClient,
    merchantId: string,
    userId: string,
    dto: CreatePurchaseOrderRequest,
  ): Promise<PurchaseOrder> {
    const supplier = await client.query<{ id: string; active: boolean }>(
      `SELECT id::text AS id, active FROM merchant.supplier
        WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [merchantId, dto.supplierId],
    );
    if (!supplier.rows[0]) throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND' });
    if (!supplier.rows[0].active) throw new ConflictException({ code: 'SUPPLIER_ARCHIVED' });

    const stockLocation = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM merchant.inventory_location
        WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND id=$3::uuid AND active`,
      [merchantId, dto.locationId, dto.inventoryLocationId],
    );
    if (!stockLocation.rows[0]) throw new NotFoundException({ code: 'INVENTORY_LOCATION_CHANGED' });

    // Every item has to belong to this merchant and still be tracked, or the line
    // would order stock that no balance row can ever hold.
    const itemIds = dto.lines.map((line) => line.inventoryItemId);
    const items = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM merchant.inventory_item
        WHERE merchant_id=$1::uuid AND id=ANY($2::uuid[]) AND active`,
      [merchantId, itemIds],
    );
    const known = new Set(items.rows.map((row) => row.id));
    const missing = itemIds.filter((id) => !known.has(id));
    if (missing.length > 0)
      throw new NotFoundException({
        code: 'INVENTORY_ITEM_ARCHIVED',
        fieldErrors: { inventoryItemIds: missing },
      });

    const lines = dto.lines.map((line, index) => {
      const check = lineTotalWithinRounding({
        value: line.quantity.value,
        scale: line.quantity.scale,
        unitCostMinor: line.unitCostMinor,
        lineTotalMinor: line.lineTotalMinor,
      });
      if (!check.ok)
        throw new ConflictException({
          code: 'PURCHASE_ORDER_LINE_TOTAL_MISMATCH',
          fieldErrors: {
            lineNumbers: [String(index + 1)],
            expectedMinorUnits: [String(check.expectedMinor)],
          },
        });
      return { ...line, lineNumber: index + 1 };
    });
    const orderedTotal = lines.reduce((total, line) => total + line.lineTotalMinor, 0);

    // The reference is generated, and a collision is retried once rather than
    // returned: the caller never chose it, so making them choose another would be
    // asking them to fix a problem this function created.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reference = purchaseOrderReference();
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO merchant.purchase_order
           (merchant_id,location_id,inventory_location_id,supplier_id,public_reference,currency,
            expected_on,ordered_total_minor,raised_by,note)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::date,$8,$9::uuid,$10)
         ON CONFLICT (merchant_id,public_reference) DO NOTHING
         RETURNING id::text AS id`,
        [
          merchantId,
          dto.locationId,
          dto.inventoryLocationId,
          dto.supplierId,
          reference,
          dto.currency,
          dto.expectedOn,
          orderedTotal,
          userId,
          dto.note,
        ],
      );
      const orderId = inserted.rows[0]?.id;
      if (!orderId) continue;
      for (const line of lines) {
        await client.query(
          `INSERT INTO merchant.purchase_order_line
             (merchant_id,purchase_order_id,line_number,inventory_item_id,supplier_sku,
              description,ordered_quantity,quantity_scale,unit,unit_cost_minor,line_total_minor)
           VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9,$10,$11)`,
          [
            merchantId,
            orderId,
            line.lineNumber,
            line.inventoryItemId,
            line.supplierSku,
            line.description,
            line.quantity.value,
            line.quantity.scale,
            line.quantity.unit,
            line.unitCostMinor,
            line.lineTotalMinor,
          ],
        );
      }
      return (await this.loadPurchaseOrder(client, merchantId, orderId)) as PurchaseOrder;
    }
    throw new ConflictException({ code: 'PURCHASE_ORDER_REFERENCE_TAKEN' });
  }

  listPurchaseOrders(
    merchantId: string,
    query: PurchaseOrderQuery,
    cursor: { createdAt: string; id: string } | null,
  ): Promise<{ rows: PurchaseOrder[]; hasMore: boolean }> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT po.id::text AS id FROM merchant.purchase_order po
          WHERE po.merchant_id=$1::uuid AND po.location_id=$2::uuid
            AND ($3::text IS NULL OR po.status=$3::text)
            AND ($4::uuid IS NULL OR po.supplier_id=$4::uuid)
            AND ($5::timestamptz IS NULL OR (po.created_at,po.id) < ($5::timestamptz,$6::uuid))
          ORDER BY po.created_at DESC,po.id DESC
          LIMIT $7`,
        [
          merchantId,
          query.locationId,
          query.status ?? null,
          query.supplierId ?? null,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          query.limit + 1,
        ],
      );
      const hasMore = result.rows.length > query.limit;
      const ids = result.rows.slice(0, query.limit).map((row) => row.id);
      return { rows: await this.loadPurchaseOrders(client, merchantId, ids), hasMore };
    });
  }

  /** One order, with its lines and receipts. `FOR UPDATE` when the caller writes. */
  loadPurchaseOrder(
    client: PoolClient,
    merchantId: string,
    orderId: string,
    lock = false,
  ): Promise<PurchaseOrder | null> {
    return this.loadPurchaseOrders(client, merchantId, [orderId], lock).then(
      (orders) => orders[0] ?? null,
    );
  }

  /**
   * The console's read of one order, narrowed to a location.
   *
   * The location check happens AFTER the merchant-scoped read rather than inside
   * its SQL, and that is deliberate: a row that exists in another branch must be
   * indistinguishable from one that does not exist, and comparing here means the
   * only thing the caller learns is `PURCHASE_ORDER_NOT_FOUND` either way.
   */
  loadPurchaseOrderScoped(
    merchantId: string,
    locationId: string,
    orderId: string,
  ): Promise<PurchaseOrder | null> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const order = await this.loadPurchaseOrder(client, merchantId, orderId);
      if (!order || order.locationId !== locationId) return null;
      return order;
    });
  }

  private async loadPurchaseOrders(
    client: PoolClient,
    merchantId: string,
    orderIds: string[],
    lock = false,
  ): Promise<PurchaseOrder[]> {
    if (orderIds.length === 0) return [];
    const orders = await client.query<OrderRow>(
      `SELECT po.id::text AS id,po.merchant_id::text AS merchant_id,po.location_id::text AS location_id,
              po.inventory_location_id::text AS inventory_location_id,
              po.supplier_id::text AS supplier_id,s.public_reference AS supplier_reference,
              s.display_name AS supplier_name,po.public_reference,po.status,po.currency,
              po.expected_on::text AS expected_on,po.ordered_total_minor::text AS ordered_total_minor,
              po.received_total_minor::text AS received_total_minor,po.version,
              po.raised_by::text AS raised_by,po.note,po.created_at,po.updated_at,po.sent_at,
              po.completed_at,po.cancelled_at
         FROM merchant.purchase_order po
         JOIN merchant.supplier s ON s.merchant_id=po.merchant_id AND s.id=po.supplier_id
        WHERE po.merchant_id=$1::uuid AND po.id=ANY($2::uuid[])
        ORDER BY po.created_at DESC,po.id DESC
        ${lock ? 'FOR UPDATE OF po' : ''}`,
      [merchantId, orderIds],
    );
    if (orders.rows.length === 0) return [];
    const ids = orders.rows.map((row) => row.id);
    const lines = await client.query<LineRow>(
      `SELECT l.id::text AS id,l.purchase_order_id::text AS purchase_order_id,
              l.line_number,l.inventory_item_id::text AS inventory_item_id,
              l.supplier_sku,l.description,l.ordered_quantity::text AS ordered_quantity,
              l.quantity_scale,l.unit,l.received_quantity::text AS received_quantity,
              l.unit_cost_minor::text AS unit_cost_minor,l.line_total_minor::text AS line_total_minor,
              coalesce((
                SELECT sum(rl.line_total_minor) FROM merchant.purchase_order_receipt_line rl
                 WHERE rl.merchant_id=l.merchant_id AND rl.purchase_order_line_id=l.id
              ),0)::text AS received_line_total_minor
         FROM merchant.purchase_order_line l
        WHERE l.merchant_id=$1::uuid AND l.purchase_order_id=ANY($2::uuid[])
        ORDER BY l.purchase_order_id,l.line_number`,
      [merchantId, ids],
    );
    const receipts = await client.query<ReceiptRow>(
      `SELECT r.id::text AS id,r.purchase_order_id::text AS purchase_order_id,
              r.inventory_location_id::text AS inventory_location_id,
              r.received_by::text AS received_by,r.business_date::text AS business_date,
              r.total_minor::text AS total_minor,r.note,r.created_at
         FROM merchant.purchase_order_receipt r
        WHERE r.merchant_id=$1::uuid AND r.purchase_order_id=ANY($2::uuid[])
        ORDER BY r.created_at,r.id`,
      [merchantId, ids],
    );
    const receiptLines = await client.query<ReceiptLineRow & { receipt_id: string }>(
      `SELECT rl.id::text AS id,rl.receipt_id::text AS receipt_id,
              rl.purchase_order_line_id::text AS purchase_order_line_id,
              rl.inventory_item_id::text AS inventory_item_id,
              rl.received_quantity::text AS received_quantity,rl.quantity_scale,rl.unit,
              rl.actual_unit_cost_minor::text AS actual_unit_cost_minor,
              rl.line_total_minor::text AS line_total_minor,
              rl.stock_ledger_entry_id::text AS stock_ledger_entry_id
         FROM merchant.purchase_order_receipt_line rl
        WHERE rl.merchant_id=$1::uuid AND rl.receipt_id=ANY($2::uuid[])
        ORDER BY rl.created_at,rl.id`,
      [merchantId, receipts.rows.map((row) => row.id)],
    );

    const linesByOrder = new Map<string, PurchaseOrderLine[]>();
    for (const row of lines.rows) {
      const list = linesByOrder.get(row.purchase_order_id) ?? [];
      list.push(orderLine(row));
      linesByOrder.set(row.purchase_order_id, list);
    }
    const receiptLinesByReceipt = new Map<string, ReturnType<typeof receiptLine>[]>();
    for (const row of receiptLines.rows) {
      const list = receiptLinesByReceipt.get(row.receipt_id) ?? [];
      list.push(receiptLine(row));
      receiptLinesByReceipt.set(row.receipt_id, list);
    }
    const receiptsByOrder = new Map<string, PurchaseOrderReceipt[]>();
    for (const row of receipts.rows) {
      const list = receiptsByOrder.get(row.purchase_order_id) ?? [];
      list.push({
        id: row.id,
        purchaseOrderId: row.purchase_order_id,
        inventoryLocationId: row.inventory_location_id,
        receivedBy: row.received_by,
        businessDate: row.business_date,
        totalMinor: int(row.total_minor),
        note: row.note,
        createdAt: row.created_at.toISOString(),
        lines: receiptLinesByReceipt.get(row.id) ?? [],
      });
      receiptsByOrder.set(row.purchase_order_id, list);
    }

    return orders.rows.map((row) => ({
      id: row.id,
      merchantId: row.merchant_id,
      locationId: row.location_id,
      inventoryLocationId: row.inventory_location_id,
      supplierId: row.supplier_id,
      supplierReference: row.supplier_reference,
      supplierName: row.supplier_name,
      publicReference: row.public_reference,
      status: row.status,
      currency: row.currency,
      expectedOn: row.expected_on,
      orderedTotalMinor: int(row.ordered_total_minor),
      receivedTotalMinor: int(row.received_total_minor),
      version: row.version,
      raisedBy: row.raised_by,
      note: row.note,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      sentAt: row.sent_at?.toISOString() ?? null,
      completedAt: row.completed_at?.toISOString() ?? null,
      cancelledAt: row.cancelled_at?.toISOString() ?? null,
      lines: linesByOrder.get(row.id) ?? [],
      receipts: receiptsByOrder.get(row.id) ?? [],
    }));
  }

  /**
   * SEND: the draft becomes a commitment and the ordered goods become `in_transit`.
   *
   * One ledger entry per line, at the order's stock location, for the line's own
   * quantity and scale. The entry's `source_aggregate_id` is the ORDER LINE, which
   * is what makes sending twice with one command identity a no-op rather than a
   * double reservation of stock.
   */
  async sendPurchaseOrder(
    client: PoolClient,
    merchantId: string,
    dto: { locationId: string; purchaseOrderId: string; commandId: string; idempotencyKey: string },
    userId: string,
    fingerprint: string,
    correlationId: string,
  ): Promise<PurchaseOrder> {
    const locked = await client.query<{
      id: string;
      status: string;
      version: number;
      inventory_location_id: string;
      business_date: string;
    }>(
      `SELECT id::text AS id,status,version,inventory_location_id::text AS inventory_location_id,
              business_date::text AS business_date
         FROM merchant.purchase_order
        WHERE merchant_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
      [merchantId, dto.purchaseOrderId],
    );
    const order = locked.rows[0];
    if (!order) throw new NotFoundException({ code: 'PURCHASE_ORDER_NOT_FOUND' });
    if (order.status === 'received' || order.status === 'cancelled')
      throw new ConflictException({
        code: 'PURCHASE_ORDER_CLOSED',
        details: { status: order.status },
      });
    if (order.status !== 'draft')
      throw new ConflictException({
        code: 'PURCHASE_ORDER_NOT_DRAFT',
        details: { status: order.status },
      });

    const lines = await this.orderLinesForPosting(client, merchantId, dto.purchaseOrderId);
    if (lines.length === 0) throw new ConflictException({ code: 'VALIDATION_FAILED' });

    for (const line of lines) {
      await this.postLedger(client, merchantId, {
        locationId: dto.locationId,
        inventoryLocationId: order.inventory_location_id,
        inventoryItemId: line.inventory_item_id,
        entryType: 'purchase_ordered',
        quantity: int(line.ordered_quantity),
        commandId: dto.commandId,
        idempotencyKey: dto.idempotencyKey,
        fingerprint,
        sourceType: 'purchase_order_line',
        sourceId: line.id,
        operatorId: userId,
        correlationId,
        // The order's own trading day: a retried send posts the same day the first
        // attempt would have, whatever the wall clock says now.
        businessDate: order.business_date,
        publicData: { purchaseOrderId: dto.purchaseOrderId, purchaseOrderLineId: line.id },
      });
    }

    await client.query(
      `UPDATE merchant.purchase_order
          SET status='sent',sent_at=clock_timestamp(),version=version+1
        WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [merchantId, dto.purchaseOrderId],
    );
    return (await this.loadPurchaseOrder(client, merchantId, dto.purchaseOrderId)) as PurchaseOrder;
  }

  /**
   * RECEIVE: what arrived becomes on-hand and leaves transit, and the order's
   * quantities and money follow.
   *
   * The order of operations matters and is deliberate: lock the order, read every
   * line, check EVERY requested quantity against what is outstanding, and only then
   * write. A two-line receipt with one bad line therefore refuses before the good
   * line has posted anything — the difference between a refusal and a half-applied
   * delivery.
   */
  async receivePurchaseOrder(
    client: PoolClient,
    merchantId: string,
    dto: {
      locationId: string;
      purchaseOrderId: string;
      expectedVersion: number;
      commandId: string;
      idempotencyKey: string;
      note: string | null;
      lines: Array<{
        purchaseOrderLineId: string;
        quantity: { value: number; scale: number; unit: string };
        actualUnitCostMinor: number;
        lineTotalMinor: number;
        /**
         * The supplier-invoice line this delivery was priced from, when a supplier
         * invoice is what wrote the receipt (§10.4). It is written WITH the line
         * because a receipt line is append-only: the value cannot be patched in
         * afterwards, and the document that produced a cost has to be named by the
         * row that carries the cost.
         */
        invoiceLineId?: string | null;
      }>;
    },
    userId: string,
    fingerprint: string,
    correlationId: string,
  ): Promise<PurchaseOrder> {
    const locked = await client.query<{
      id: string;
      status: string;
      version: number;
      inventory_location_id: string;
      business_date: string;
    }>(
      `SELECT id::text AS id,status,version,inventory_location_id::text AS inventory_location_id,
              business_date::text AS business_date
         FROM merchant.purchase_order
        WHERE merchant_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
      [merchantId, dto.purchaseOrderId],
    );
    const order = locked.rows[0];
    if (!order) throw new NotFoundException({ code: 'PURCHASE_ORDER_NOT_FOUND' });
    if (order.version !== dto.expectedVersion)
      throw new ConflictException({
        code: 'OPTIMISTIC_VERSION_CONFLICT',
        currentVersion: order.version,
      });
    if (order.status === 'draft') throw new ConflictException({ code: 'PURCHASE_ORDER_NOT_SENT' });
    if (order.status === 'received' || order.status === 'cancelled')
      throw new ConflictException({
        code: 'PURCHASE_ORDER_CLOSED',
        details: { status: order.status },
      });

    const known = await this.orderLinesForPosting(client, merchantId, dto.purchaseOrderId);
    const over = overReceivedLine(
      known.map((line) => ({
        id: line.id,
        orderedQuantity: int(line.ordered_quantity),
        receivedQuantity: int(line.received_quantity),
      })),
      dto.lines.map((line) => ({
        purchaseOrderLineId: line.purchaseOrderLineId,
        quantity: line.quantity.value,
      })),
    );
    if (over) {
      const onOrder = known.some((line) => line.id === over.purchaseOrderLineId);
      throw new ConflictException({
        code: onOrder ? 'PURCHASE_ORDER_OVER_RECEIPT' : 'PURCHASE_ORDER_LINE_NOT_FOUND',
        message: onOrder
          ? 'A receipt may not exceed the quantity still outstanding on a line.'
          : 'That line is not on this purchase order.',
        fieldErrors: { purchaseOrderLineId: [over.purchaseOrderLineId] },
        details: { outstanding: over.outstanding, requested: over.requested },
      });
    }
    for (const line of dto.lines) {
      const check = lineTotalWithinRounding({
        value: line.quantity.value,
        scale: line.quantity.scale,
        unitCostMinor: line.actualUnitCostMinor,
        lineTotalMinor: line.lineTotalMinor,
      });
      if (!check.ok)
        throw new ConflictException({
          code: 'PURCHASE_ORDER_LINE_TOTAL_MISMATCH',
          fieldErrors: {
            purchaseOrderLineId: [line.purchaseOrderLineId],
            expectedMinorUnits: [String(check.expectedMinor)],
          },
        });
    }

    const receipt = await client.query<{ id: string; business_date: string }>(
      `INSERT INTO merchant.purchase_order_receipt
         (merchant_id,location_id,inventory_location_id,purchase_order_id,command_id,
          idempotency_key,command_fingerprint,received_by,correlation_id,total_minor,note)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8::uuid,$9,$10,$11)
       RETURNING id::text AS id,business_date::text AS business_date`,
      [
        merchantId,
        dto.locationId,
        order.inventory_location_id,
        dto.purchaseOrderId,
        dto.commandId,
        dto.idempotencyKey,
        fingerprint,
        userId,
        correlationId,
        receiptTotalMinor(dto.lines.map((line) => ({ lineTotalMinor: line.lineTotalMinor }))),
        dto.note,
      ],
    );
    const receiptId = receipt.rows[0].id;
    const businessDate = receipt.rows[0].business_date;
    const byId = new Map(known.map((line) => [line.id, line]));

    for (const line of dto.lines) {
      const onOrder = byId.get(line.purchaseOrderLineId);
      // Unreachable: `overReceivedLine` refused an unknown line above. Kept as a
      // hard failure rather than a `!` so a future edit cannot silently skip a line.
      if (!onOrder) throw new ConflictException({ code: 'PURCHASE_ORDER_LINE_NOT_FOUND' });

      /*
       * THE LEDGER FIRST, THE RECEIPT LINE SECOND, AND THE ORDER MATTERS.
       *
       * A receipt line is immutable — the migration revokes UPDATE and grants only
       * SELECT and INSERT, and `purchase_order_receipt_line_append_only` refuses an
       * UPDATE even to the `api` role. So the line cannot be written first and then
       * have its ledger id filled in afterwards; it is written once, already knowing
       * which ledger fact it belongs to. That is also the truthful order of events:
       * a receipt line that moved no stock must not exist at all, and writing it
       * second means the only way it exists is with a ledger row behind it.
       *
       * The ledger entry's `source_aggregate_id` is therefore the ORDER LINE rather
       * than the receipt line. That is what makes a second delivery against the same
       * line possible: two receipts of one order-line are two commands, and the
       * ledger's unique key is (command_id, item, entry_type, source_id), so the
       * second delivery posts its own entry while a REPLAY of the first returns the
       * first's row.
       */
      const quantity = line.quantity;
      const ledger = await this.postLedger(client, merchantId, {
        locationId: dto.locationId,
        inventoryLocationId: order.inventory_location_id,
        inventoryItemId: onOrder.inventory_item_id,
        entryType: 'purchase_received',
        quantity: quantity.value,
        commandId: dto.commandId,
        idempotencyKey: dto.idempotencyKey,
        fingerprint,
        sourceType: 'purchase_order_receipt_line',
        sourceId: line.purchaseOrderLineId,
        operatorId: userId,
        correlationId,
        businessDate,
        publicData: {
          purchaseOrderId: dto.purchaseOrderId,
          purchaseOrderLineId: line.purchaseOrderLineId,
          receiptId,
        },
      });
      await client.query(
        `INSERT INTO merchant.purchase_order_receipt_line
           (merchant_id,receipt_id,purchase_order_id,purchase_order_line_id,inventory_item_id,
            stock_ledger_entry_id,received_quantity,quantity_scale,unit,actual_unit_cost_minor,
            line_total_minor,invoice_line_id)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,$10,$11,$12::uuid)`,
        [
          merchantId,
          receiptId,
          dto.purchaseOrderId,
          line.purchaseOrderLineId,
          onOrder.inventory_item_id,
          ledger.id,
          quantity.value,
          quantity.scale,
          quantity.unit,
          line.actualUnitCostMinor,
          line.lineTotalMinor,
          line.invoiceLineId ?? null,
        ],
      );
      await client.query(
        `UPDATE merchant.purchase_order_line
            SET received_quantity=received_quantity+$3
          WHERE merchant_id=$1::uuid AND id=$2::uuid`,
        [merchantId, line.purchaseOrderLineId, line.quantity.value],
      );
    }

    // The header follows its lines, in the same transaction: the status from the
    // quantities and the money from what was invoiced. The money is summed from the
    // RECEIPT lines rather than accumulated in TypeScript, so a header can only ever
    // report a total its own rows support.
    const receivedTotal = await client.query<{ received_total_minor: string }>(
      `SELECT coalesce(sum(rl.line_total_minor),0)::text AS received_total_minor
         FROM merchant.purchase_order_receipt_line rl
        WHERE rl.merchant_id=$1::uuid AND rl.purchase_order_id=$2::uuid`,
      [merchantId, dto.purchaseOrderId],
    );
    const lineState = await client.query<{ ordered_quantity: string; received_quantity: string }>(
      `SELECT ordered_quantity::text AS ordered_quantity,received_quantity::text AS received_quantity
         FROM merchant.purchase_order_line
        WHERE merchant_id=$1::uuid AND purchase_order_id=$2::uuid`,
      [merchantId, dto.purchaseOrderId],
    );
    const status = statusAfterReceipt(
      lineState.rows.map((row) => ({
        orderedQuantity: int(row.ordered_quantity),
        receivedQuantity: int(row.received_quantity),
      })),
    );
    await client.query(
      `UPDATE merchant.purchase_order
          SET status=$3,received_total_minor=$4::bigint,
              completed_at=CASE WHEN $3='received' THEN clock_timestamp() ELSE NULL END,
              version=version+1
        WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [merchantId, dto.purchaseOrderId, status, int(receivedTotal.rows[0].received_total_minor)],
    );
    return (await this.loadPurchaseOrder(client, merchantId, dto.purchaseOrderId)) as PurchaseOrder;
  }

  /**
   * CANCEL: the order stops, and whatever is still in transit is released.
   *
   * `outstanding` is per line — ordered minus received — because the goods that
   * already arrived are not in transit any more and releasing them would take the
   * transit balance negative. A draft has nothing in transit at all, so cancelling
   * one posts no ledger entry; the guard is the status, not a special case.
   */
  async cancelPurchaseOrder(
    client: PoolClient,
    merchantId: string,
    dto: {
      locationId: string;
      purchaseOrderId: string;
      expectedVersion: number;
      commandId: string;
      idempotencyKey: string;
      reason: string | null;
    },
    userId: string,
    fingerprint: string,
    correlationId: string,
  ): Promise<PurchaseOrder> {
    const locked = await client.query<{
      id: string;
      status: string;
      version: number;
      inventory_location_id: string;
      business_date: string;
    }>(
      `SELECT id::text AS id,status,version,inventory_location_id::text AS inventory_location_id,
              business_date::text AS business_date
         FROM merchant.purchase_order
        WHERE merchant_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
      [merchantId, dto.purchaseOrderId],
    );
    const order = locked.rows[0];
    if (!order) throw new NotFoundException({ code: 'PURCHASE_ORDER_NOT_FOUND' });
    if (order.version !== dto.expectedVersion)
      throw new ConflictException({
        code: 'OPTIMISTIC_VERSION_CONFLICT',
        currentVersion: order.version,
      });
    if (order.status === 'received' || order.status === 'cancelled')
      throw new ConflictException({
        code: 'PURCHASE_ORDER_CLOSED',
        details: { status: order.status },
      });

    if (order.status !== 'draft') {
      const lines = await this.orderLinesForPosting(client, merchantId, dto.purchaseOrderId);
      for (const line of lines) {
        const outstanding = outstandingQuantity(
          int(line.ordered_quantity),
          int(line.received_quantity),
        );
        if (outstanding <= 0) continue;
        await this.postLedger(client, merchantId, {
          locationId: dto.locationId,
          inventoryLocationId: order.inventory_location_id,
          inventoryItemId: line.inventory_item_id,
          entryType: 'purchase_order_cancelled',
          quantity: outstanding,
          commandId: dto.commandId,
          idempotencyKey: dto.idempotencyKey,
          fingerprint,
          sourceType: 'purchase_order_line',
          sourceId: line.id,
          operatorId: userId,
          correlationId,
          businessDate: order.business_date,
          publicData: {
            purchaseOrderId: dto.purchaseOrderId,
            purchaseOrderLineId: line.id,
            reason: dto.reason,
          },
        });
      }
    }

    await client.query(
      `UPDATE merchant.purchase_order
          SET status='cancelled',cancelled_at=clock_timestamp(),
              note=coalesce($3,note),version=version+1
        WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [merchantId, dto.purchaseOrderId, dto.reason],
    );
    return (await this.loadPurchaseOrder(client, merchantId, dto.purchaseOrderId)) as PurchaseOrder;
  }

  /**
   * The lines as the database holds them, with the two quantities a posting needs.
   * Ordered by `line_number` so a ledger entry's order is the document's order —
   * the balance projection only accepts a strictly increasing `sequence`, and a
   * shuffled set of entries would make its replay non-deterministic.
   */
  private async orderLinesForPosting(
    client: PoolClient,
    merchantId: string,
    purchaseOrderId: string,
  ): Promise<
    Array<{
      id: string;
      inventory_item_id: string;
      ordered_quantity: string;
      received_quantity: string;
      quantity_scale: number;
      unit: string;
    }>
  > {
    const result = await client.query<{
      id: string;
      inventory_item_id: string;
      ordered_quantity: string;
      received_quantity: string;
      quantity_scale: number;
      unit: string;
    }>(
      `SELECT id::text AS id,inventory_item_id::text AS inventory_item_id,
              ordered_quantity::text AS ordered_quantity,
              received_quantity::text AS received_quantity,quantity_scale,unit
         FROM merchant.purchase_order_line
        WHERE merchant_id=$1::uuid AND purchase_order_id=$2::uuid
        ORDER BY line_number FOR UPDATE`,
      [merchantId, purchaseOrderId],
    );
    return result.rows;
  }

  /**
   * The ONE door to the stock ledger, shared with the sale path.
   *
   * `device_id` and `credential_version` are null here and non-null on the till:
   * this is a console command with no enrolled terminal behind it, and the ledger's
   * `stock_ledger_command_context_ck` allows exactly those two states — a device
   * with a credential version, or neither. The operator is the dashboard user,
   * which is what makes the audit trail name a person.
   */
  private async postLedger(
    client: PoolClient,
    merchantId: string,
    input: {
      locationId: string;
      inventoryLocationId: string;
      inventoryItemId: string;
      entryType: 'purchase_ordered' | 'purchase_received' | 'purchase_order_cancelled';
      quantity: number;
      commandId: string;
      idempotencyKey: string;
      fingerprint: string;
      sourceType: string;
      sourceId: string;
      operatorId: string;
      correlationId: string;
      businessDate?: string | null;
      publicData: Record<string, unknown>;
    },
  ): Promise<{ id: string; sequence: string }> {
    /*
     * THE FUNCTION IS CALLED IN `FROM`, NOT IN THE SELECT LIST, AND THE DIFFERENCE
     * IS NOT STYLE — IT IS CORRECTNESS.
     *
     * `SELECT (merchant.append_stock_ledger(...)).*` expands the composite's columns
     * in the target list, and Postgres may evaluate the function ONCE PER COLUMN.
     * For an entry type whose guard is happy to be replayed that is invisible: the
     * second invocation inserts nothing (the command's unique key catches it),
     * re-reads the row it posted, and returns it. For a RECEIPT it is fatal — the
     * first invocation takes the goods out of transit, the second finds in_transit
     * short by exactly that quantity and raises INVENTORY_SOURCE_STATE_INSUFFICIENT,
     * so a perfectly legal delivery is refused on a database where the stock was
     * empty beforehand and accepted on one that already had slack in transit. The
     * measured symptom was exactly that: three cases failing on a pristine build and
     * passing on the rehearsal clone.
     *
     * A function in `FROM` is evaluated exactly once, which is what this call needs.
     * (`pos-inventory.repository.ts` uses the `(…).*` form for adjustments and waste;
     * those entry types survive it, but the form is not safe in general and this
     * comment is the record of why this call does not use it.)
     */
    const result = await client.query<{ id: string; sequence: string }>(
      `SELECT id::text AS id, sequence::text AS sequence
         FROM merchant.append_stock_ledger(
          $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::uuid,$8::uuid,$9,$10,$11::uuid,
          $12::uuid,null,null,$13::date,$14,null,null,null,null,$15::jsonb)
       `,
      [
        merchantId,
        input.locationId,
        input.inventoryLocationId,
        input.inventoryItemId,
        input.entryType,
        input.quantity,
        input.commandId,
        input.idempotencyKey,
        input.fingerprint,
        input.sourceType,
        input.sourceId,
        input.operatorId,
        input.businessDate ?? null,
        input.correlationId,
        JSON.stringify(input.publicData),
      ],
    );
    return { id: result.rows[0].id, sequence: result.rows[0].sequence };
  }

  /** The stock position the purchasing work is supposed to move, for the tests. */
  stockPosition(merchantId: string, inventoryLocationId: string, inventoryItemId: string) {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<{ on_hand: string; in_transit: string }>(
        `SELECT on_hand::text AS on_hand,in_transit::text AS in_transit
           FROM merchant.stock_balance
          WHERE merchant_id=$1::uuid AND inventory_location_id=$2::uuid AND inventory_item_id=$3::uuid`,
        [merchantId, inventoryLocationId, inventoryItemId],
      );
      if (!result.rows[0]) return { onHand: 0, inTransit: 0 };
      return {
        onHand: int(result.rows[0].on_hand),
        inTransit: int(result.rows[0].in_transit),
      };
    });
  }

  // ── Supplier invoices ────────────────────────────────────────────────────

  /**
   * The console's invoice inbox, newest first, keyset-paged like the order list.
   *
   * The lines are loaded in ONE second query for the whole page rather than per
   * invoice, because a page of 25 invoices would otherwise be 26 round trips.
   */
  listSupplierInvoices(
    merchantId: string,
    query: SupplierInvoiceQuery,
    cursor: { createdAt: string; id: string } | null,
    correlationId: string,
  ): Promise<{
    rows: SupplierInvoice[];
    hasMore: boolean;
    nextCursor: { createdAt: string; id: string } | null;
  }> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<{ id: string; created_at: Date }>(
        `SELECT si.id::text AS id,si.created_at FROM merchant.supplier_invoice si
          WHERE si.merchant_id=$1::uuid
            AND ($2::text IS NULL OR si.status=$2::text)
            AND ($3::uuid IS NULL OR si.supplier_id=$3::uuid)
            AND ($4::timestamptz IS NULL OR (si.created_at,si.id) < ($4::timestamptz,$5::uuid))
          ORDER BY si.created_at DESC,si.id DESC
          LIMIT $6`,
        [
          merchantId,
          query.status ?? null,
          query.supplierId ?? null,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          query.limit + 1,
        ],
      );
      const hasMore = result.rows.length > query.limit;
      const page = result.rows.slice(0, query.limit);
      const ids = page.map((row) => row.id);
      // The cursor names the LAST row of the page, which is the next page's starting
      // point. It cannot be read off the contract model, because an invoice has no
      // `createdAt` there: paging metadata is not part of the document.
      const last = page.at(-1);
      return {
        rows: await this.loadSupplierInvoices(client, merchantId, ids, correlationId),
        hasMore,
        nextCursor:
          hasMore && last ? { createdAt: last.created_at.toISOString(), id: last.id } : null,
      };
    });
  }

  /** One invoice by id, for a command's own answer. Null when it is not there. */
  async loadSupplierInvoice(
    client: PoolClient,
    merchantId: string,
    invoiceId: string,
    correlationId: string,
  ): Promise<SupplierInvoice | null> {
    const rows = await this.loadSupplierInvoices(client, merchantId, [invoiceId], correlationId);
    return rows[0] ?? null;
  }

  /** One invoice by its CFDI UUID, which is the key the upload is idempotent on. */
  async loadSupplierInvoiceByUuid(
    client: PoolClient,
    merchantId: string,
    uuid: string,
    correlationId: string,
  ): Promise<SupplierInvoice | null> {
    const found = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM merchant.supplier_invoice
        WHERE merchant_id=$1::uuid AND cfdi_uuid=$2::uuid`,
      [merchantId, uuid],
    );
    const id = found.rows[0]?.id;
    if (!id) return null;
    return this.loadSupplierInvoice(client, merchantId, id, correlationId);
  }

  /**
   * THE UPLOAD. One header and its lines, or nothing at all.
   *
   * IDEMPOTENT ON THE UUID, IN THE DATABASE. The ON CONFLICT below targets the
   * partial unique index `supplier_invoice_cfdi_uuid_uidx`, so a second upload of the
   * same CFDI, from the console, from a retry or from any future writer, writes no
   * second row and this method hands back the FIRST invoice with its lines. That is
   * why the check is not in TypeScript: a read-then-insert would race, and the index
   * is the only thing that cannot.
   *
   * A PHOTO CREATES NO LINES. v1 has no extractor, and D11 forbids anything reaching
   * the ledger from an unconfirmed extraction, so the image is stored and that is all
   * that is written. An invoice that cannot be confirmed therefore cannot be
   * committed either, which is the honest state of the capability.
   */
  async createSupplierInvoice(
    client: PoolClient,
    merchantId: string,
    invoiceId: string,
    input: {
      source: 'cfdi_xml' | 'photo' | 'manual';
      supplierId: string | null;
      capturedBy: string;
      fingerprint: string;
      correlationId: string;
      parsed: ParsedCfdiInvoice | null;
      artifactBytes: Buffer | null;
      artifactContentType: string | null;
    },
  ): Promise<{ invoice: SupplierInvoice; created: boolean }> {
    const parsed = input.parsed;
    const proposals =
      parsed === null
        ? []
        : await this.proposeMatches(client, merchantId, input.supplierId, parsed.concepts);
    const status: SupplierInvoice['status'] =
      parsed !== null && proposals.every((line) => line.matchMethod !== 'unmatched')
        ? 'matched'
        : 'uploaded';

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO merchant.supplier_invoice
         (id,merchant_id,supplier_id,public_reference,folio,cfdi_uuid,issued_on,currency,
          subtotal_minor,tax_minor,total_minor,source,status,artifact_bytes,artifact_content_type,
          command_id,idempotency_key,command_fingerprint,captured_by)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7::date,$8,$9,$10,$11,$12,$13,$14,$15,
               $16::uuid,$17::uuid,$18,$19::uuid)
       ON CONFLICT (merchant_id,cfdi_uuid) WHERE cfdi_uuid IS NOT NULL DO NOTHING
       RETURNING id::text AS id`,
      [
        invoiceId,
        merchantId,
        input.supplierId,
        supplierInvoiceReference(),
        parsed?.folio ?? null,
        parsed?.uuid ?? null,
        parsed?.issuedOn ?? null,
        parsed?.currency ?? 'MXN',
        parsed?.subtotalMinor ?? 0,
        parsed?.taxMinor ?? 0,
        parsed?.totalMinor ?? 0,
        input.source,
        status,
        input.artifactBytes,
        input.artifactContentType,
        // The invoice carries the command's OWN identity. A replayed upload is caught
        // by the journal before it gets here, and the two unique keys on
        // (merchant_id,command_id) and (merchant_id,idempotency_key) mean a
        // concurrent duplicate cannot be stored twice either.
        invoiceId,
        invoiceId,
        input.fingerprint,
        input.capturedBy,
      ],
    );
    if (!inserted.rows[0]) {
      // The CFDI is already on file. Answer the FIRST invoice rather than refusing: a
      // re-upload is not an error, it is a duplicate of a fact already held.
      const existing = await this.loadSupplierInvoiceByUuid(
        client,
        merchantId,
        parsed?.uuid ?? '',
        input.correlationId,
      );
      if (!existing) throw new ConflictException({ code: 'SUPPLIER_INVOICE_UPLOAD_CONFLICT' });
      return { invoice: existing, created: false };
    }

    for (const [index, concept] of (parsed?.concepts ?? []).entries()) {
      const proposal = proposals[index];
      await client.query(
        `INSERT INTO merchant.supplier_invoice_line
           (merchant_id,supplier_invoice_id,line_number,raw_description,supplier_sku,quantity,
            quantity_scale,unit,unit_cost_minor,line_total_minor,matched_inventory_item_id,
            match_method,match_confidence)
         VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$12,$13)`,
        [
          merchantId,
          invoiceId,
          concept.lineNumber,
          concept.description,
          // A remembered match wins over what the file said: the person who confirmed
          // the line knows which code the supplier uses for it.
          proposal.supplierSku ?? concept.supplierSku,
          concept.quantity.value,
          concept.quantity.scale,
          concept.quantity.unit,
          concept.unitCostMinor,
          concept.lineTotalMinor,
          proposal.matchedInventoryItemId,
          proposal.matchMethod,
          proposal.matchConfidence,
        ],
      );
    }

    return {
      invoice: (await this.loadSupplierInvoice(
        client,
        merchantId,
        invoiceId,
        input.correlationId,
      )) as SupplierInvoice,
      created: true,
    };
  }

  /**
   * MATCH: a person overrides the proposal for the lines they name (§10.3 step 5).
   *
   * The supplier SKU travels back onto the line when the request carries one, and
   * that is the whole memory of a manual match: the next upload of the same
   * supplier's code finds it through the first rule of the match order, so a person
   * answers once per code rather than once per invoice.
   */
  async matchSupplierInvoiceLines(
    client: PoolClient,
    merchantId: string,
    dto: {
      supplierInvoiceId: string;
      lines: Array<{ lineId: string; inventoryItemId: string; supplierSku: string | null }>;
    },
  ): Promise<void> {
    const locked = await client.query<{ status: string }>(
      `SELECT status FROM merchant.supplier_invoice
        WHERE merchant_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
      [merchantId, dto.supplierInvoiceId],
    );
    if (!locked.rows[0]) throw new NotFoundException({ code: 'SUPPLIER_INVOICE_NOT_FOUND' });
    // A COMMITTED INVOICE IS NO LONGER EDITABLE. Its lines priced a receipt, and a receipt
    // is immutable; re-pointing a line afterwards would make the invoice describe an item
    // the stock movement never received.
    if (locked.rows[0].status === 'committed')
      throw new ConflictException({ code: 'SUPPLIER_INVOICE_ALREADY_COMMITTED' });

    for (const line of dto.lines) {
      const updated = await client.query(
        `UPDATE merchant.supplier_invoice_line l
            SET matched_inventory_item_id=$3::uuid,
                match_method='manual',
                match_confidence=100,
                supplier_sku=coalesce($4,l.supplier_sku)
          WHERE l.merchant_id=$1::uuid AND l.supplier_invoice_id=$2::uuid AND l.id=$5::uuid
            AND EXISTS (
              SELECT 1 FROM merchant.inventory_item i
               WHERE i.merchant_id=l.merchant_id AND i.id=$3::uuid
            )`,
        [merchantId, dto.supplierInvoiceId, line.inventoryItemId, line.supplierSku, line.lineId],
      );
      // A line of another merchant, a line of another invoice, and an item this
      // merchant does not own all land here. The item is checked in the same
      // statement as the write, so the update either happens or it does not.
      if (updated.rowCount === 0) {
        throw new NotFoundException({ code: 'SUPPLIER_INVOICE_LINE_NOT_FOUND' });
      }
    }
    await this.refreshInvoiceStatus(client, merchantId, dto.supplierInvoiceId);
  }

  /**
   * COMMIT: the invoice's lines become a RECEIPT, through the receipt path the
   * purchase-order receive already uses (§10.4).
   *
   * THE RECEIPT IS NOT REIMPLEMENTED HERE. Stock moves through `receivePurchaseOrder`
   * — the same over-receipt check, the same ledger door, the same receipt tables and
   * the same order status. What this method adds is `invoice_line_id` on every receipt
   * line, which is what makes the cost basis name its document.
   *
   * NOTHING IS WRITTEN BEFORE EVERY REFUSAL IS DECIDED: the invoice is locked, its
   * lines are read, an unmatched line stops the whole command, and every line the
   * caller named is proved to belong to this invoice. Only then does the receipt post.
   */
  async commitSupplierInvoice(
    client: PoolClient,
    merchantId: string,
    dto: {
      supplierInvoiceId: string;
      purchaseOrderId: string;
      lines: Array<{
        lineId: string;
        purchaseOrderLineId: string;
        receivedQuantity: { value: number; scale: number; unit: string };
        unitCostMinor: number;
      }>;
      note: string | null;
      commandId: string;
      idempotencyKey: string;
      correlationId: string;
    },
    userId: string,
    fingerprint: string,
  ): Promise<SupplierInvoice> {
    const locked = await client.query<{ id: string; status: string }>(
      `SELECT id::text AS id,status FROM merchant.supplier_invoice
        WHERE merchant_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
      [merchantId, dto.supplierInvoiceId],
    );
    if (!locked.rows[0]) throw new NotFoundException({ code: 'SUPPLIER_INVOICE_NOT_FOUND' });
    if (locked.rows[0].status === 'committed')
      throw new ConflictException({ code: 'SUPPLIER_INVOICE_ALREADY_COMMITTED' });

    const stored = await client.query<{ id: string; match_method: string }>(
      `SELECT id::text AS id,match_method FROM merchant.supplier_invoice_line
        WHERE merchant_id=$1::uuid AND supplier_invoice_id=$2::uuid
        ORDER BY line_number`,
      [merchantId, dto.supplierInvoiceId],
    );
    if (stored.rows.length === 0)
      throw new ConflictException({ code: 'SUPPLIER_INVOICE_HAS_NO_LINES' });

    const unmatched = stored.rows.filter((row) => row.match_method === 'unmatched');
    if (unmatched.length > 0) {
      throw new ConflictException({
        code: 'SUPPLIER_INVOICE_UNMATCHED_LINES',
        details: { unmatchedLineIds: unmatched.map((row) => row.id) },
      });
    }

    const onInvoice = new Set(stored.rows.map((row) => row.id));
    const missing = dto.lines.filter((line) => !onInvoice.has(line.lineId));
    if (missing.length > 0) {
      throw new ConflictException({
        code: 'SUPPLIER_INVOICE_LINE_NOT_FOUND',
        fieldErrors: { lineIds: missing.map((line) => line.lineId) },
      });
    }

    // The order's version is read here and handed to the receive path: the invoice
    // commit carries no version of its own, because the command identity is its guard.
    // This read only keeps the receipt path's own check honest.
    const order = await this.lockPurchaseOrderForInvoice(client, merchantId, dto.purchaseOrderId);

    const receiptLines = dto.lines.map((line) => ({
      purchaseOrderLineId: line.purchaseOrderLineId,
      quantity: line.receivedQuantity,
      actualUnitCostMinor: line.unitCostMinor,
      lineTotalMinor: extendedLineTotalMinor({
        value: line.receivedQuantity.value,
        scale: line.receivedQuantity.scale,
        unitCostMinor: line.unitCostMinor,
      }),
      invoiceLineId: line.lineId,
    }));

    await this.receivePurchaseOrder(
      client,
      merchantId,
      {
        locationId: order.location_id,
        purchaseOrderId: dto.purchaseOrderId,
        expectedVersion: order.version,
        commandId: dto.commandId,
        idempotencyKey: dto.idempotencyKey,
        note: dto.note,
        lines: receiptLines,
      },
      userId,
      fingerprint,
      dto.correlationId,
    );

    const committed = await client.query(
      `UPDATE merchant.supplier_invoice
          SET status='committed',committed_at=clock_timestamp()
        WHERE merchant_id=$1::uuid AND id=$2::uuid AND committed_at IS NULL`,
      [merchantId, dto.supplierInvoiceId],
    );
    if (committed.rowCount === 0)
      throw new ConflictException({ code: 'SUPPLIER_INVOICE_ALREADY_COMMITTED' });

    return (await this.loadSupplierInvoice(
      client,
      merchantId,
      dto.supplierInvoiceId,
      dto.correlationId,
    )) as SupplierInvoice;
  }

  /**
   * The order a commit is about to receive against: its version, its location and its
   * status, locked so a second clerk cannot move it under the receipt.
   */
  private async lockPurchaseOrderForInvoice(
    client: PoolClient,
    merchantId: string,
    purchaseOrderId: string,
  ): Promise<{ version: number; location_id: string; status: string }> {
    const result = await client.query<{
      version: number;
      location_id: string;
      status: string;
    }>(
      `SELECT version,location_id::text AS location_id,status
         FROM merchant.purchase_order
        WHERE merchant_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
      [merchantId, purchaseOrderId],
    );
    const order = result.rows[0];
    if (!order) throw new NotFoundException({ code: 'PURCHASE_ORDER_NOT_FOUND' });
    return order;
  }

  /**
   * The status an invoice's lines imply: `matched` when every line has an item,
   * `uploaded` while any line is unmatched. A committed invoice is left alone, and an
   * invoice with no lines stays `uploaded` — the photo path has nothing to match and
   * must not look ready.
   */
  private async refreshInvoiceStatus(
    client: PoolClient,
    merchantId: string,
    invoiceId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE merchant.supplier_invoice si
          SET status = CASE
                WHEN NOT EXISTS (
                  SELECT 1 FROM merchant.supplier_invoice_line l
                   WHERE l.merchant_id=si.merchant_id AND l.supplier_invoice_id=si.id)
                  THEN 'uploaded'
                WHEN EXISTS (
                  SELECT 1 FROM merchant.supplier_invoice_line l
                   WHERE l.merchant_id=si.merchant_id AND l.supplier_invoice_id=si.id
                     AND l.match_method='unmatched')
                  THEN 'uploaded'
                ELSE 'matched' END
        WHERE si.merchant_id=$1::uuid AND si.id=$2::uuid AND si.status<>'committed'`,
      [merchantId, invoiceId],
    );
  }

  /**
   * THE MATCH ORDER of §10.3, applied to every line at upload time.
   *
   * The three memories are loaded once per upload and not once per line: an invoice
   * with forty lines would otherwise run a hundred and twenty queries to get the same
   * answer forty times.
   *
   *   · the supplier's own SKU, learned from the orders and the invoices already on
   *     file for this supplier;
   *   · a remembered match: the same description, already matched for this supplier;
   *   · the prior line history: the same description as this supplier wrote it on an
   *     earlier order;
   *   · a fuzzy description match against the merchant's own item names.
   */
  private async proposeMatches(
    client: PoolClient,
    merchantId: string,
    supplierId: string | null,
    concepts: ParsedCfdiInvoice['concepts'],
  ): Promise<
    Array<{
      matchedInventoryItemId: string | null;
      matchMethod: SupplierInvoiceLineMatchMethod;
      matchConfidence: number;
      supplierSku: string | null;
    }>
  > {
    const bySku = new Map<string, string>();
    const remembered = new Map<string, string>();
    const history = new Map<string, string>();

    if (supplierId !== null) {
      const skus = await client.query<{ supplier_sku: string; inventory_item_id: string }>(
        `SELECT supplier_sku,inventory_item_id::text AS inventory_item_id FROM (
           SELECT l.supplier_sku,l.inventory_item_id,po.created_at
             FROM merchant.purchase_order_line l
             JOIN merchant.purchase_order po
               ON po.merchant_id=l.merchant_id AND po.id=l.purchase_order_id
            WHERE l.merchant_id=$1::uuid AND po.supplier_id=$2::uuid
              AND l.supplier_sku IS NOT NULL
           UNION ALL
           SELECT sil.supplier_sku,sil.matched_inventory_item_id,si.created_at
             FROM merchant.supplier_invoice_line sil
             JOIN merchant.supplier_invoice si
               ON si.merchant_id=sil.merchant_id AND si.id=sil.supplier_invoice_id
            WHERE sil.merchant_id=$1::uuid AND si.supplier_id=$2::uuid
              AND sil.supplier_sku IS NOT NULL AND sil.matched_inventory_item_id IS NOT NULL
         ) known
         ORDER BY created_at DESC`,
        [merchantId, supplierId],
      );
      for (const row of skus.rows) {
        const key = skuKey(row.supplier_sku);
        // Newest first, so the first row for a code is the answer this supplier's code
        // last received.
        if (!bySku.has(key)) bySku.set(key, row.inventory_item_id);
      }

      // RULE 2: the ANSWER this supplier's description already received, from a supplier
      // document whose line somebody matched. This is the memory of a decision.
      const rememberedRows = await client.query<{
        raw_description: string;
        inventory_item_id: string;
      }>(
        `SELECT sil.raw_description,sil.matched_inventory_item_id::text AS inventory_item_id
           FROM merchant.supplier_invoice_line sil
           JOIN merchant.supplier_invoice si
             ON si.merchant_id=sil.merchant_id AND si.id=sil.supplier_invoice_id
          WHERE sil.merchant_id=$1::uuid AND si.supplier_id=$2::uuid
            AND sil.matched_inventory_item_id IS NOT NULL
          ORDER BY sil.created_at DESC`,
        [merchantId, supplierId],
      );
      for (const row of rememberedRows.rows) {
        const key = normalizedText(row.raw_description);
        if (key === '') continue;
        if (!remembered.has(key)) remembered.set(key, row.inventory_item_id);
      }

      // RULE 3: THE PRIOR LINE HISTORY, which is a different memory. It is what this
      // supplier called the article when the ORDER was raised, before any document was
      // matched — the description the person who orders already agreed to.
      const historyRows = await client.query<{
        description: string;
        inventory_item_id: string;
      }>(
        `SELECT l.description,l.inventory_item_id::text AS inventory_item_id
           FROM merchant.purchase_order_line l
           JOIN merchant.purchase_order po
             ON po.merchant_id=l.merchant_id AND po.id=l.purchase_order_id
          WHERE l.merchant_id=$1::uuid AND po.supplier_id=$2::uuid AND l.description IS NOT NULL
          ORDER BY po.created_at DESC`,
        [merchantId, supplierId],
      );
      for (const row of historyRows.rows) {
        const key = normalizedText(row.description);
        if (key === '') continue;
        if (!history.has(key)) history.set(key, row.inventory_item_id);
      }
    }

    const items = await client.query<{
      id: string;
      display_name: string;
      public_reference: string;
    }>(
      `SELECT id::text AS id,display_name,public_reference FROM merchant.inventory_item
        WHERE merchant_id=$1::uuid AND active`,
      [merchantId],
    );

    return concepts.map((concept) => {
      const sku = concept.supplierSku === null ? '' : skuKey(concept.supplierSku);
      if (sku !== '' && bySku.has(sku)) {
        return {
          matchedInventoryItemId: bySku.get(sku) as string,
          matchMethod: 'supplier_sku' as const,
          matchConfidence: 100,
          supplierSku: concept.supplierSku,
        };
      }
      const key = normalizedText(concept.description);
      if (key !== '' && remembered.has(key)) {
        return {
          matchedInventoryItemId: remembered.get(key) as string,
          matchMethod: 'remembered' as const,
          matchConfidence: 95,
          supplierSku: concept.supplierSku,
        };
      }
      if (key !== '' && history.has(key)) {
        return {
          matchedInventoryItemId: history.get(key) as string,
          matchMethod: 'history' as const,
          matchConfidence: 90,
          supplierSku: concept.supplierSku,
        };
      }
      const fuzzy = bestFuzzyMatch(key, items.rows);
      if (fuzzy) {
        return {
          matchedInventoryItemId: fuzzy.id,
          matchMethod: 'fuzzy' as const,
          // A fuzzy match never claims certainty: a person still confirms it, and a
          // confidence of 100 would say there is nothing left to confirm.
          matchConfidence: Math.min(85, Math.round(fuzzy.score * 100)),
          supplierSku: concept.supplierSku,
        };
      }
      return {
        matchedInventoryItemId: null,
        matchMethod: 'unmatched' as const,
        matchConfidence: 0,
        supplierSku: concept.supplierSku,
      };
    });
  }

  /**
   * The invoices the read answers with, their lines, and the two prices that decide
   * whether a price moved.
   *
   * `correlationId` is the fallback for a row whose originating command can no longer
   * be joined; the stored command's own correlation is preferred, because that is the
   * id an operator can search the logs with.
   */
  private async loadSupplierInvoices(
    client: PoolClient,
    merchantId: string,
    invoiceIds: string[],
    correlationId: string,
  ): Promise<SupplierInvoice[]> {
    if (invoiceIds.length === 0) return [];
    const invoices = await client.query<InvoiceRow>(
      `SELECT si.id::text AS id,si.supplier_id::text AS supplier_id,
              s.display_name AS supplier_name,si.folio,si.cfdi_uuid::text AS cfdi_uuid,
              si.issued_on::text AS issued_on,si.currency,
              si.subtotal_minor::text AS subtotal_minor,si.tax_minor::text AS tax_minor,
              si.total_minor::text AS total_minor,si.source,si.status,bc.correlation_id
         FROM merchant.supplier_invoice si
         LEFT JOIN merchant.supplier s
           ON s.merchant_id=si.merchant_id AND s.id=si.supplier_id
         LEFT JOIN merchant.business_command bc
           ON bc.merchant_id=si.merchant_id AND bc.command_id=si.command_id
        WHERE si.merchant_id=$1::uuid AND si.id=ANY($2::uuid[])
        ORDER BY si.created_at DESC,si.id DESC`,
      [merchantId, invoiceIds],
    );
    if (invoices.rows.length === 0) return [];

    const lines = await client.query<InvoiceLineRow>(
      `SELECT l.id::text AS id,l.supplier_invoice_id::text AS supplier_invoice_id,
              l.line_number,l.raw_description,l.supplier_sku,
              l.quantity::text AS quantity,l.quantity_scale,l.unit,
              l.unit_cost_minor::text AS unit_cost_minor,
              l.line_total_minor::text AS line_total_minor,
              l.matched_inventory_item_id::text AS matched_inventory_item_id,
              i.display_name AS matched_item_name,l.match_method,l.match_confidence,
              (SELECT rl.actual_unit_cost_minor::text
                 FROM merchant.purchase_order_receipt_line rl
                 JOIN merchant.purchase_order_receipt r
                   ON r.merchant_id=rl.merchant_id AND r.id=rl.receipt_id
                 JOIN merchant.purchase_order po
                   ON po.merchant_id=r.merchant_id AND po.id=r.purchase_order_id
                WHERE rl.merchant_id=l.merchant_id
                  AND rl.inventory_item_id=l.matched_inventory_item_id
                  AND po.supplier_id=si.supplier_id
                  AND (rl.invoice_line_id IS NULL OR NOT EXISTS (
                        SELECT 1 FROM merchant.supplier_invoice_line own
                         WHERE own.merchant_id=rl.merchant_id
                           AND own.id=rl.invoice_line_id
                           AND own.supplier_invoice_id=l.supplier_invoice_id))
                ORDER BY r.created_at DESC,rl.created_at DESC
                LIMIT 1) AS previous_unit_cost_minor,
              coalesce(
                (SELECT pol_own.unit_cost_minor::text
                   FROM merchant.purchase_order_receipt_line rl_own
                   JOIN merchant.purchase_order_line pol_own
                     ON pol_own.merchant_id=rl_own.merchant_id
                    AND pol_own.id=rl_own.purchase_order_line_id
                  WHERE rl_own.merchant_id=l.merchant_id AND rl_own.invoice_line_id=l.id
                  LIMIT 1),
                (SELECT pol.unit_cost_minor::text
                   FROM merchant.purchase_order_line pol
                   JOIN merchant.purchase_order po2
                     ON po2.merchant_id=pol.merchant_id AND po2.id=pol.purchase_order_id
                  WHERE pol.merchant_id=l.merchant_id
                    AND pol.inventory_item_id=l.matched_inventory_item_id
                    AND po2.supplier_id=si.supplier_id
                    AND po2.status IN ('sent','partially_received')
                  ORDER BY po2.created_at DESC,pol.line_number
                  LIMIT 1)) AS purchase_order_unit_cost_minor
         FROM merchant.supplier_invoice_line l
         JOIN merchant.supplier_invoice si
           ON si.merchant_id=l.merchant_id AND si.id=l.supplier_invoice_id
         LEFT JOIN merchant.inventory_item i
           ON i.merchant_id=l.merchant_id AND i.id=l.matched_inventory_item_id
        WHERE l.merchant_id=$1::uuid AND l.supplier_invoice_id=ANY($2::uuid[])
        ORDER BY l.supplier_invoice_id,l.line_number`,
      [merchantId, invoiceIds],
    );

    const linesByInvoice = new Map<string, SupplierInvoiceLine[]>();
    for (const row of lines.rows) {
      const list = linesByInvoice.get(row.supplier_invoice_id) ?? [];
      list.push(invoiceLine(row));
      linesByInvoice.set(row.supplier_invoice_id, list);
    }

    return invoices.rows.map((row) => ({
      id: row.id,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      folio: row.folio,
      cfdiUuid: row.cfdi_uuid,
      issuedOn: row.issued_on,
      currency: row.currency,
      subtotalMinor: int(row.subtotal_minor),
      taxMinor: int(row.tax_minor),
      totalMinor: int(row.total_minor),
      source: row.source,
      status: row.status,
      lines: linesByInvoice.get(row.id) ?? [],
      correlationId: row.correlation_id ?? correlationId,
    }));
  }
}

// ── The matcher's arithmetic ────────────────────────────────────────────────

/** Supplier codes differ only in case and padding, so both are removed. */
function skuKey(sku: string): string {
  return sku.trim().toUpperCase();
}

/**
 * Lower-case, accent-free, punctuation-free. Two descriptions that differ only in how
 * a supplier's program capitalised or accented them are the SAME description, and
 * treating them as different is how a matcher forgets what a person already answered.
 */
function normalizedText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function trigrams(value: string): Set<string> {
  const padded = ` ${value} `;
  const grams = new Set<string>();
  for (let index = 0; index + 3 <= padded.length; index += 1) {
    grams.add(padded.slice(index, index + 3));
  }
  return grams;
}

/** The Dice coefficient over character trigrams: 1 identical, 0 unrelated. */
function descriptionSimilarity(left: string, right: string): number {
  if (left === '' || right === '') return 0;
  if (left === right) return 1;
  const a = trigrams(left);
  const b = trigrams(right);
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/** Below this a proposal is noise: a wrong proposal costs more than no proposal. */
const FUZZY_THRESHOLD = 0.5;

function bestFuzzyMatch(
  description: string,
  items: ReadonlyArray<{ id: string; display_name: string; public_reference: string }>,
): { id: string; score: number } | null {
  if (description === '') return null;
  let best: { id: string; score: number } | null = null;
  for (const item of items) {
    const score = Math.max(
      descriptionSimilarity(description, normalizedText(item.display_name)),
      descriptionSimilarity(description, normalizedText(item.public_reference)),
    );
    if (score < FUZZY_THRESHOLD) continue;
    if (!best || score > best.score) best = { id: item.id, score };
  }
  return best;
}
