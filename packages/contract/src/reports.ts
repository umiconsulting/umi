import { z } from 'zod';
import { IsoTimestamp, Uuid } from './platform';

// Reports — the cash shift reconciliation read model. The sales summary types moved
// to the semantic metrics contract in 2.58.0. This file keeps the cash-shift detail
// that the "Caja y turnos" view reads.

const Money = z.number().int().nonnegative();

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
  CashRole,
  CashDenomination,
  CashLedgerLine,
  CashCountRow,
  CashTrazaEntry,
  CashShiftMath,
  CashShiftDetail,
} as const;
