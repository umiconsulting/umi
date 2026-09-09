import { z } from 'zod';
import { IsoTimestamp, Uuid } from './platform';

// Reports — the commercial read model. A sales summary aggregates committed sales
// (pos_committed_sale + receipt_snapshot) plus their cart lines and tenders into the
// figures the owner reads: net sales, product mix, payment mix, and a time series.
// This is the aggregate the "Reportes → Ventas" view needs and the old generic
// transaction list could not give. Read-only, RLS-scoped, gated by the sales permission.

const Money = z.number().int().nonnegative();

export const ReportsRange = z.enum(['today', 'yesterday', 'last_7_days', 'last_30_days']);
export type ReportsRange = z.infer<typeof ReportsRange>;

export const ReportsSalesQuery = z
  .object({
    range: ReportsRange.default('today'),
    locationId: Uuid.optional(),
  })
  .strict();
export type ReportsSalesQuery = z.infer<typeof ReportsSalesQuery>;

export const ReportsSalesTotals = z
  .object({
    netSalesMinorUnits: Money,
    orders: z.number().int().nonnegative(),
    averageTicketMinorUnits: Money,
    itemsSold: z.number().int().nonnegative(),
    discountMinorUnits: Money,
    // Tips captured on the receipt (snapshot->'tip'). Zero when the POS took none.
    tipsMinorUnits: Money,
    // Net sales in the equally-sized window immediately before this one, for a delta.
    priorNetSalesMinorUnits: Money.nullable(),
  })
  .strict();

// The real tender universe: cash + external (manual) terminal (pos_tender_fact) plus
// wallet + gift_card (customer_value_tender_allocation). No integrated card exists yet
// (that needs a payments gateway), so the mix is honest about the four it does capture.
export const ReportsPaymentSlice = z
  .object({
    method: z.enum(['cash', 'manual_terminal', 'wallet', 'gift_card']),
    amountMinorUnits: Money,
  })
  .strict();

// A generic grouped row for the pivot's Barista and Hora dimensions (Producto/Categoría
// come from productMix). `key` is the operator name or the hour label.
export const ReportsGroupRow = z
  .object({
    key: z.string().min(1).max(240),
    units: z.number().int().nonnegative(),
    netMinorUnits: Money,
  })
  .strict();

export const ReportsProductRow = z
  .object({
    productId: Uuid.nullable(),
    productName: z.string().min(1).max(240),
    category: z.string().max(240).nullable(),
    units: z.number().int().nonnegative(),
    // Gross merchandise for the product (line price × quantity), pre-tax. No COGS: the
    // cart line carries no cost, so margin is not derivable here without a recipe join.
    netMinorUnits: Money,
  })
  .strict();

export const ReportsSeriesPoint = z
  .object({
    // An hour ("08") for a single day, or a business date ("2026-09-06") for a range.
    label: z.string().min(1).max(24),
    amountMinorUnits: Money,
  })
  .strict();

export const ReportsSalesSummary = z
  .object({
    merchantId: Uuid,
    locationId: Uuid.nullable(),
    range: ReportsRange,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    bucket: z.enum(['hour', 'day']),
    totals: ReportsSalesTotals,
    paymentMix: z.array(ReportsPaymentSlice).max(8),
    productMix: z.array(ReportsProductRow).max(200),
    byOperator: z.array(ReportsGroupRow).max(100),
    byHour: z.array(ReportsGroupRow).max(31),
    series: z.array(ReportsSeriesPoint).max(31),
    capturedAt: IsoTimestamp,
  })
  .strict();
export type ReportsSalesSummary = z.infer<typeof ReportsSalesSummary>;

// ── Cash shift detail — the reconciliation drill-down the "Caja y turnos" view needs.
// All of it already exists in the schema (cash_shift, cash_ledger_entry, cash_count_attempt,
// cash_variance_resolution, cash_shift_custody_event); this read model just exposes it.

export const CashRole = z
  .object({ name: z.string().max(240).nullable(), at: IsoTimestamp.nullable() })
  .strict();

export const CashDenomination = z
  .object({
    label: z.string().min(1).max(40),
    count: z.number().int().nonnegative().nullable(),
    valueMinorUnits: Money,
  })
  .strict();

export const CashLedgerLine = z
  .object({
    type: z.string().min(1).max(40),
    // Signed: positive adds to the drawer, negative removes. `count_observation` is neutral.
    amountMinorUnits: z.number().int(),
    occurredAt: IsoTimestamp,
    saleId: Uuid.nullable(),
    receiptNumber: z.string().max(100).nullable(),
    reasonCode: z.string().max(80).nullable(),
    note: z.string().max(500).nullable(),
  })
  .strict();

export const CashCountRow = z
  .object({
    attempt: z.number().int().positive(),
    countedMinorUnits: Money,
    state: z.string().min(1).max(40),
  })
  .strict();

export const CashTrazaEntry = z
  .object({
    kind: z.enum(['open', 'movement', 'count', 'resolution', 'custody', 'nosale']),
    text: z.string().min(1).max(300),
    at: IsoTimestamp.nullable(),
  })
  .strict();

export const CashShiftMath = z
  .object({
    openingMinorUnits: Money,
    cashSalesMinorUnits: z.number().int(),
    paidInMinorUnits: Money,
    paidOutMinorUnits: Money,
    safeDropMinorUnits: Money,
    refundsMinorUnits: Money,
    expectedMinorUnits: z.number().int(),
    countedMinorUnits: z.number().int().nullable(),
    varianceMinorUnits: z.number().int().nullable(),
    toleranceMinorUnits: Money,
  })
  .strict();

export const CashShiftDetail = z
  .object({
    shiftId: Uuid,
    register: z.string().max(240).nullable(),
    status: z.string().min(1).max(40),
    businessDate: z.string().max(24),
    openedAt: IsoTimestamp.nullable(),
    closedAt: IsoTimestamp.nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    roles: z
      .object({ opened: CashRole, counted: CashRole.nullable(), approved: CashRole.nullable() })
      .strict(),
    math: CashShiftMath,
    openingDenominations: z.array(CashDenomination).max(64),
    countDenominations: z.array(CashDenomination).max(64).nullable(),
    ledger: z.array(CashLedgerLine).max(500),
    counts: z.array(CashCountRow).max(10),
    traza: z.array(CashTrazaEntry).max(200),
    capturedAt: IsoTimestamp,
  })
  .strict();
export type CashShiftDetail = z.infer<typeof CashShiftDetail>;

export const reportsModels = {
  ReportsSalesQuery,
  ReportsSalesTotals,
  ReportsPaymentSlice,
  ReportsProductRow,
  ReportsGroupRow,
  ReportsSeriesPoint,
  ReportsSalesSummary,
  CashRole,
  CashDenomination,
  CashLedgerLine,
  CashCountRow,
  CashTrazaEntry,
  CashShiftMath,
  CashShiftDetail,
} as const;
