import { z } from 'zod';
import {
  CorrelationId,
  CurrencyCode,
  IsoTimestamp,
  MerchantDate,
  OpaqueCursor,
  PageInfo,
  Uuid,
} from './platform';

/**
 * Purchasing — workstream E, step 3 of the plan: "Add purchase orders, suppliers,
 * and receiving."
 *
 * THE THREE THINGS, AND WHY THEY ARE THREE. A supplier is a party. A purchase
 * order is a DOCUMENT: an intention, editable while it is a draft, and a
 * commitment from the moment it is sent. A receipt is a FACT: what actually
 * turned up. The distinction is load-bearing, because only the fact moves stock —
 * an order that was never delivered must not change anyone's on-hand count, and a
 * receipt that is not in the stock ledger is not real. That is why `send` and
 * `receipt` are separate routes with separate models rather than one "update".
 *
 * MONEY IS INTEGER MINOR UNITS, AND IT TRAVELS AS A BARE INTEGER. The platform has
 * a `Money` shape (`{ minorUnits, currency }`) and the temptation here is to use it
 * per line. It is deliberately not used: a purchase order has exactly ONE currency
 * — it is a document from one supplier in one currency — so repeating the currency
 * on every line and on every total would create a field that CAN disagree with
 * itself while the database stores it once. The header carries `currency`; the
 * amounts carry integer minor units, named `…Minor`, exactly as the columns do.
 * There is no float anywhere in this file, and `z.number().int().safe()` is what
 * refuses one.
 *
 * QUANTITIES ARE SCALED INTEGERS, like every other inventory quantity on this
 * platform: a `value` with a `scale` and a `unit`, never "0.25 kg".
 */

export const PurchaseOrderStatus = z.enum([
  'draft',
  'sent',
  'partially_received',
  'received',
  'cancelled',
]);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatus>;

/**
 * The statuses in which an order still has stock in transit: sending put the
 * ordered quantity there, and only a receipt or a cancellation takes it out.
 */
export const OPEN_PURCHASE_ORDER_STATUSES = ['sent', 'partially_received'] as const;

/** Integer minor units. The one shape every amount in this file uses. */
const MinorUnits = z.number().int().min(0).safe();

/** A quantity with an explicit scale. Mirrors `inventory_item.quantity_scale`. */
export const PurchaseQuantity = z
  .object({
    value: z.number().int().min(1).max(9007199254740991).safe(),
    scale: z.number().int().min(0).max(6),
    unit: z.enum(['unit', 'gram', 'kilogram', 'milliliter', 'liter', 'portion', 'package', 'box']),
  })
  .strict();
export type PurchaseQuantity = z.infer<typeof PurchaseQuantity>;

/**
 * The command identity every write in this module carries. Same discipline as
 * `InventoryCommandContext` and the table map's command shape: an idempotency key
 * the server claims in `merchant.business_command`, and — where a row already
 * exists — the version the caller believed it was writing. A retried send or
 * receive therefore replays the first attempt's result instead of posting stock
 * twice, which is the whole point of the journal.
 *
 * There is no `operatorSessionId` and no `businessDate`: this is the CONSOLE's
 * surface, not the till's. It authenticates with a browser session, so there is no
 * operator session to assert, and `purchase_order_receipt.business_date` is derived
 * by `merchant.tg_business_date` from the merchant's timezone and business-day
 * start — never supplied, because a column a caller can write is a column a caller
 * can get wrong, and this one decides which day's cost lands in the books.
 */
export const ProcurementCommand = z
  .object({
    locationId: Uuid,
    idempotencyKey: Uuid,
  })
  .strict();

const commandShape = ProcurementCommand.shape;

/** A write against a row that already exists: the command plus its version. */
export const ProcurementVersionedCommand = z
  .object({
    ...commandShape,
    expectedVersion: z.number().int().positive(),
  })
  .strict();

// ── Suppliers ───────────────────────────────────────────────────────────────

export const Supplier = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    /** The merchant's own code for this supplier: the namespace its SKUs live in. */
    publicReference: z.string().min(1).max(80),
    displayName: z.string().min(1).max(160),
    contactName: z.string().min(1).max(160).nullable(),
    contactEmail: z.string().min(3).max(254).nullable(),
    contactPhone: z.string().min(1).max(40).nullable(),
    note: z.string().max(240).nullable(),
    active: z.boolean(),
    version: z.number().int().positive(),
    createdAt: IsoTimestamp,
    archivedAt: IsoTimestamp.nullable(),
  })
  .strict();
export type Supplier = z.infer<typeof Supplier>;

export const CreateSupplierRequest = z
  .object({
    ...commandShape,
    publicReference: z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/),
    displayName: z.string().trim().min(1).max(160),
    contactName: z.string().trim().min(1).max(160).nullable().default(null),
    contactEmail: z.string().trim().min(3).max(254).nullable().default(null),
    contactPhone: z.string().trim().min(1).max(40).nullable().default(null),
    note: z.string().trim().max(240).nullable().default(null),
  })
  .strict();
export type CreateSupplierRequest = z.infer<typeof CreateSupplierRequest>;

/**
 * Amending a supplier. `publicReference` is deliberately absent: it is the key
 * that purchase orders have already been written against, and rewriting it would
 * silently reinterpret history.
 */
export const UpdateSupplierRequest = z
  .object({
    ...ProcurementVersionedCommand.shape,
    supplierId: Uuid,
    displayName: z.string().trim().min(1).max(160).optional(),
    contactName: z.string().trim().min(1).max(160).nullable().optional(),
    contactEmail: z.string().trim().min(3).max(254).nullable().optional(),
    contactPhone: z.string().trim().min(1).max(40).nullable().optional(),
    note: z.string().trim().max(240).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateSupplierRequest = z.infer<typeof UpdateSupplierRequest>;

export const SupplierQuery = z
  .object({
    includeArchived: z.coerce.boolean().default(false),
    cursor: OpaqueCursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type SupplierQuery = z.infer<typeof SupplierQuery>;

export const SupplierList = z
  .object({
    suppliers: z.array(Supplier).max(100),
    page: PageInfo,
    correlationId: CorrelationId,
  })
  .strict();
export type SupplierList = z.infer<typeof SupplierList>;

export const SupplierResult = z
  .object({
    commandId: Uuid,
    supplier: Supplier,
    correlationId: CorrelationId,
  })
  .strict();
export type SupplierResult = z.infer<typeof SupplierResult>;

// ── Purchase orders ─────────────────────────────────────────────────────────

export const PurchaseOrderLine = z
  .object({
    id: Uuid,
    lineNumber: z.number().int().min(1).max(1000),
    inventoryItemId: Uuid,
    supplierSku: z.string().min(1).max(80).nullable(),
    description: z.string().min(1).max(160).nullable(),
    orderedQuantity: PurchaseQuantity,
    receivedQuantity: z.number().int().min(0).safe(),
    /** Outstanding = ordered − received, which is what a receipt is measured against. */
    outstandingQuantity: z.number().int().min(0).safe(),
    unitCostMinor: MinorUnits,
    lineTotalMinor: MinorUnits,
    receivedLineTotalMinor: MinorUnits,
  })
  .strict();
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLine>;

export const PurchaseOrderReceiptLine = z
  .object({
    id: Uuid,
    purchaseOrderLineId: Uuid,
    inventoryItemId: Uuid,
    receivedQuantity: PurchaseQuantity,
    actualUnitCostMinor: MinorUnits,
    lineTotalMinor: MinorUnits,
    stockLedgerEntryId: Uuid.nullable(),
  })
  .strict();
export type PurchaseOrderReceiptLine = z.infer<typeof PurchaseOrderReceiptLine>;

export const PurchaseOrderReceipt = z
  .object({
    id: Uuid,
    purchaseOrderId: Uuid,
    inventoryLocationId: Uuid,
    receivedBy: Uuid,
    businessDate: MerchantDate,
    totalMinor: MinorUnits,
    note: z.string().max(240).nullable(),
    createdAt: IsoTimestamp,
    lines: z.array(PurchaseOrderReceiptLine).max(500),
  })
  .strict();
export type PurchaseOrderReceipt = z.infer<typeof PurchaseOrderReceipt>;

export const PurchaseOrder = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    locationId: Uuid,
    inventoryLocationId: Uuid,
    supplierId: Uuid,
    supplierReference: z.string().min(1).max(80),
    supplierName: z.string().min(1).max(160),
    publicReference: z.string().min(1).max(80),
    status: PurchaseOrderStatus,
    currency: CurrencyCode,
    expectedOn: MerchantDate.nullable(),
    orderedTotalMinor: MinorUnits,
    receivedTotalMinor: MinorUnits,
    version: z.number().int().positive(),
    raisedBy: Uuid,
    note: z.string().max(240).nullable(),
    createdAt: IsoTimestamp,
    updatedAt: IsoTimestamp,
    sentAt: IsoTimestamp.nullable(),
    completedAt: IsoTimestamp.nullable(),
    cancelledAt: IsoTimestamp.nullable(),
    lines: z.array(PurchaseOrderLine).max(1000),
    receipts: z.array(PurchaseOrderReceipt).max(200),
  })
  .strict();
export type PurchaseOrder = z.infer<typeof PurchaseOrder>;

/**
 * One line of a new order. The caller sends BOTH the unit cost and the extended
 * total from the supplier's own document rather than one derived from the other:
 * an invoice says "12.5 kg × $120.50 = $1,506.25", and the API's job is to check
 * that those two agree within a rounding step, not to overwrite what the paper
 * says. See `procurement-domain.ts` for the one place that rule lives.
 */
export const CreatePurchaseOrderLine = z
  .object({
    inventoryItemId: Uuid,
    supplierSku: z.string().trim().min(1).max(80).nullable().default(null),
    description: z.string().trim().min(1).max(160).nullable().default(null),
    quantity: PurchaseQuantity,
    unitCostMinor: MinorUnits,
    lineTotalMinor: MinorUnits,
  })
  .strict();
export type CreatePurchaseOrderLine = z.infer<typeof CreatePurchaseOrderLine>;

export const CreatePurchaseOrderRequest = z
  .object({
    ...commandShape,
    inventoryLocationId: Uuid,
    supplierId: Uuid,
    currency: CurrencyCode.default('MXN'),
    expectedOn: MerchantDate.nullable().default(null),
    note: z.string().trim().max(240).nullable().default(null),
    lines: z.array(CreatePurchaseOrderLine).min(1).max(500),
  })
  .strict();
export type CreatePurchaseOrderRequest = z.infer<typeof CreatePurchaseOrderRequest>;

export const PurchaseOrderQuery = z
  .object({
    locationId: Uuid,
    status: PurchaseOrderStatus.optional(),
    supplierId: Uuid.optional(),
    cursor: OpaqueCursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type PurchaseOrderQuery = z.infer<typeof PurchaseOrderQuery>;

export const PurchaseOrderScopeQuery = z.object({ locationId: Uuid }).strict();
export type PurchaseOrderScopeQuery = z.infer<typeof PurchaseOrderScopeQuery>;

export const PurchaseOrderList = z
  .object({
    purchaseOrders: z.array(PurchaseOrder).max(100),
    page: PageInfo,
    correlationId: CorrelationId,
  })
  .strict();
export type PurchaseOrderList = z.infer<typeof PurchaseOrderList>;

/** Sending is the moment the ordered goods become `in_transit`. */
export const SendPurchaseOrderRequest = z
  .object({
    ...ProcurementVersionedCommand.shape,
    purchaseOrderId: Uuid,
  })
  .strict();
export type SendPurchaseOrderRequest = z.infer<typeof SendPurchaseOrderRequest>;

export const ReceivePurchaseOrderLine = z
  .object({
    purchaseOrderLineId: Uuid,
    quantity: PurchaseQuantity,
    actualUnitCostMinor: MinorUnits,
    lineTotalMinor: MinorUnits,
  })
  .strict();
export type ReceivePurchaseOrderLine = z.infer<typeof ReceivePurchaseOrderLine>;

/**
 * A receipt. Partial is the normal case and repeatable: a supplier who sends half
 * the order today and half next week produces two receipts against one order.
 * `expectedVersion` is the ORDER's version, so two clerks receiving at the same
 * time cannot both win.
 */
export const ReceivePurchaseOrderRequest = z
  .object({
    ...ProcurementVersionedCommand.shape,
    purchaseOrderId: Uuid,
    note: z.string().trim().max(240).nullable().default(null),
    lines: z.array(ReceivePurchaseOrderLine).min(1).max(500),
  })
  .strict();
export type ReceivePurchaseOrderRequest = z.infer<typeof ReceivePurchaseOrderRequest>;

export const CancelPurchaseOrderRequest = z
  .object({
    ...ProcurementVersionedCommand.shape,
    purchaseOrderId: Uuid,
    reason: z.string().trim().min(1).max(240).nullable().default(null),
  })
  .strict();
export type CancelPurchaseOrderRequest = z.infer<typeof CancelPurchaseOrderRequest>;

export const PurchaseOrderResult = z
  .object({
    commandId: Uuid,
    purchaseOrder: PurchaseOrder,
    correlationId: CorrelationId,
  })
  .strict();
export type PurchaseOrderResult = z.infer<typeof PurchaseOrderResult>;

// ── Supplier invoices (recipes module plan §10) ─────────────────────────────

/**
 * WHAT AN INVOICE IS, AND WHY IT IS NOT A RECEIPT. A receipt is the FACT that goods
 * arrived. An invoice is the DOCUMENT that priced them, and the two disagree often
 * enough that the platform must hold both: a short delivery against a full invoice
 * is a real event, and only the receipt moves stock. The invoice exists so the cost
 * basis can name the document that produced a price (plan §10.4).
 *
 * THE XML IS THE TRUSTWORTHY PATH, AND THE PHOTO IS ASSISTIVE (plan D11). A CFDI 4.0
 * file carries the issuer, the folio, the UUID and the unit prices, so the upload is
 * idempotent on the UUID. A photo only proposes lines, and a person confirms each
 * one before any write. Nothing reaches the ledger from an unconfirmed extraction.
 *
 * A LINE CARRIES THE MATCH AND THE PRICE CHANGE. `matchMethod` says how the item was
 * found, and `matchConfidence` says how sure the server was. An unmatched line
 * blocks the commit, and a price that moved carries both numbers.
 */
export const SupplierInvoiceSource = z.enum(['cfdi_xml', 'photo', 'manual']);
export type SupplierInvoiceSource = z.infer<typeof SupplierInvoiceSource>;

/**
 * The invoice writes carry `commandId`, not the `locationId` that
 * `ProcurementCommand` requires: an invoice arrives addressed to the business, and
 * only the upload may name the location it is filed against.
 */
const invoiceCommandShape = {
  commandId: Uuid,
  idempotencyKey: Uuid,
};

export const SupplierInvoiceStatus = z.enum([
  'uploaded',
  'extracted',
  'matched',
  'committed',
  'rejected',
]);
export type SupplierInvoiceStatus = z.infer<typeof SupplierInvoiceStatus>;

/**
 * How a line found its item, in the order the matcher tries (plan §10.3): the
 * supplier's own SKU, a remembered match, the line history, a fuzzy name, a manual
 * choice, or nothing.
 */
export const SupplierInvoiceLineMatchMethod = z.enum([
  'supplier_sku',
  'remembered',
  'history',
  'fuzzy',
  'manual',
  'unmatched',
]);
export type SupplierInvoiceLineMatchMethod = z.infer<typeof SupplierInvoiceLineMatchMethod>;

export const SupplierInvoiceLine = z
  .object({
    id: Uuid,
    lineNumber: z.number().int().min(1).max(1000),
    /** The description AS THE SUPPLIER WROTE IT. The raw text is the match evidence. */
    rawDescription: z.string().min(1).max(300),
    quantity: PurchaseQuantity,
    unitCostMinor: MinorUnits,
    lineTotalMinor: MinorUnits,
    matchedInventoryItemId: Uuid.nullable(),
    matchedInventoryItemName: z.string().min(1).max(160).nullable(),
    matchMethod: SupplierInvoiceLineMatchMethod,
    /** 0 to 100. Zero is honest for an unmatched line, so it is not nullable. */
    matchConfidence: z.number().int().min(0).max(100),
    supplierSku: z.string().min(1).max(80).nullable(),
    priceChanged: z.boolean(),
    /** The last price this supplier charged for the item, when there is one. */
    previousUnitCostMinor: MinorUnits.nullable(),
    /** The price the open order expected, so the two numbers are side by side. */
    purchaseOrderUnitCostMinor: MinorUnits.nullable(),
  })
  .strict();
export type SupplierInvoiceLine = z.infer<typeof SupplierInvoiceLine>;

export const SupplierInvoice = z
  .object({
    id: Uuid,
    /** Nullable: an invoice can arrive before the supplier is on file. */
    supplierId: Uuid.nullable(),
    supplierName: z.string().min(1).max(160).nullable(),
    folio: z.string().min(1).max(80).nullable(),
    /** The CFDI UUID. The upload is idempotent on it, so it is the natural key. */
    cfdiUuid: Uuid.nullable(),
    issuedOn: MerchantDate.nullable(),
    currency: CurrencyCode,
    subtotalMinor: MinorUnits,
    taxMinor: MinorUnits,
    totalMinor: MinorUnits,
    source: SupplierInvoiceSource,
    status: SupplierInvoiceStatus,
    lines: z.array(SupplierInvoiceLine).max(1000),
    correlationId: CorrelationId,
  })
  .strict();
export type SupplierInvoice = z.infer<typeof SupplierInvoice>;

export const SupplierInvoiceQuery = z
  .object({
    status: SupplierInvoiceStatus.optional(),
    supplierId: Uuid.optional(),
    cursor: OpaqueCursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type SupplierInvoiceQuery = z.infer<typeof SupplierInvoiceQuery>;

export const SupplierInvoiceList = z
  .object({
    invoices: z.array(SupplierInvoice).max(100),
    page: PageInfo,
    correlationId: CorrelationId,
  })
  .strict();
export type SupplierInvoiceList = z.infer<typeof SupplierInvoiceList>;

/**
 * The upload. ONE of the two payloads must be present, and the refine below is the
 * only place that rule lives: an upload with no document at all would create an
 * invoice nobody can check.
 *
 * `artifactBase64` is bounded because the photo path stores an image. A CFDI file is
 * text and bounded at one megabyte, which is far past any real document.
 */
export const SupplierInvoiceUploadRequest = z
  .object({
    ...invoiceCommandShape,
    source: SupplierInvoiceSource,
    cfdiXml: z.string().min(1).max(1_000_000).optional(),
    artifactBase64: z.string().min(1).max(20_000_000).optional(),
    supplierId: Uuid.optional(),
    locationId: Uuid.optional(),
  })
  .strict()
  .refine(
    (value) => value.cfdiXml !== undefined || value.artifactBase64 !== undefined,
    'Supply a CFDI XML file or a photo artifact.',
  );
export type SupplierInvoiceUploadRequest = z.infer<typeof SupplierInvoiceUploadRequest>;

export const SupplierInvoiceMatchLine = z
  .object({
    lineId: Uuid,
    inventoryItemId: Uuid,
    /** Remembered on the way in, so the next invoice matches without a person. */
    supplierSku: z.string().trim().min(1).max(80).nullable().default(null),
  })
  .strict();
export type SupplierInvoiceMatchLine = z.infer<typeof SupplierInvoiceMatchLine>;

export const SupplierInvoiceMatchRequest = z
  .object({
    ...invoiceCommandShape,
    supplierInvoiceId: Uuid,
    lines: z.array(SupplierInvoiceMatchLine).min(1).max(1000),
  })
  .strict();
export type SupplierInvoiceMatchRequest = z.infer<typeof SupplierInvoiceMatchRequest>;

export const SupplierInvoiceCommitLine = z
  .object({
    lineId: Uuid,
    purchaseOrderLineId: Uuid,
    receivedQuantity: PurchaseQuantity,
    unitCostMinor: MinorUnits,
    /** A lot code ties the received stock to the document that priced it (plan D9). */
    lotCode: z
      .string()
      .regex(/^[A-Za-z0-9._:-]{1,80}$/)
      .nullable()
      .default(null),
  })
  .strict();
export type SupplierInvoiceCommitLine = z.infer<typeof SupplierInvoiceCommitLine>;

/**
 * The commit writes the receipt. Every line must be matched first, so an unmatched
 * line refuses the whole commit rather than half-posting stock.
 */
export const SupplierInvoiceCommitRequest = z
  .object({
    ...invoiceCommandShape,
    supplierInvoiceId: Uuid,
    purchaseOrderId: Uuid,
    receiptId: Uuid.optional(),
    lines: z.array(SupplierInvoiceCommitLine).min(1).max(1000),
    note: z.string().trim().max(240).nullable().default(null),
  })
  .strict();
export type SupplierInvoiceCommitRequest = z.infer<typeof SupplierInvoiceCommitRequest>;

export const procurementModels = {
  PurchaseOrderStatus,
  PurchaseQuantity,
  ProcurementCommand,
  ProcurementVersionedCommand,
  Supplier,
  CreateSupplierRequest,
  UpdateSupplierRequest,
  SupplierQuery,
  SupplierList,
  SupplierResult,
  PurchaseOrderLine,
  PurchaseOrderReceiptLine,
  PurchaseOrderReceipt,
  PurchaseOrder,
  CreatePurchaseOrderLine,
  CreatePurchaseOrderRequest,
  PurchaseOrderQuery,
  PurchaseOrderScopeQuery,
  PurchaseOrderList,
  SendPurchaseOrderRequest,
  ReceivePurchaseOrderLine,
  ReceivePurchaseOrderRequest,
  CancelPurchaseOrderRequest,
  PurchaseOrderResult,
  SupplierInvoiceSource,
  SupplierInvoiceStatus,
  SupplierInvoiceLineMatchMethod,
  SupplierInvoiceLine,
  SupplierInvoice,
  SupplierInvoiceQuery,
  SupplierInvoiceList,
  SupplierInvoiceUploadRequest,
  SupplierInvoiceMatchLine,
  SupplierInvoiceMatchRequest,
  SupplierInvoiceCommitLine,
  SupplierInvoiceCommitRequest,
};
