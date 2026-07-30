import type {
  CashLedgerEntryType,
  CashReconciliationOutcome,
  CashShiftStatus,
  CashVariance,
  ExpectedCash,
} from '@umi/contract';

export interface CashFact {
  sequence: number;
  type: CashLedgerEntryType;
  amountMinorUnits: number;
  received: number;
  change: number;
}

const safe = (value: number) => {
  if (!Number.isSafeInteger(value)) throw new RangeError('Cash amount exceeds integer bounds.');
  return value;
};

export const cashEntryEffect = (received: number, change: number): number => {
  safe(received);
  safe(change);
  if (received < 0 || change < 0 || change > received) {
    throw new RangeError('Cash received and change are invalid.');
  }
  return safe(received - change);
};

export const calculateExpectedCash = (
  currency: string,
  facts: CashFact[],
  shiftVersion: number,
  calculatedAt = new Date(),
): ExpectedCash => {
  const totals = {
    opening: 0,
    gross: 0,
    change: 0,
    sales: 0,
    paidIn: 0,
    paidOut: 0,
    safeDrop: 0,
    adjustment: 0,
  };
  let priorSequence = 0;
  for (const fact of facts) {
    if (fact.sequence <= priorSequence || fact.amountMinorUnits < 0) {
      throw new RangeError('Cash ledger order or amount is invalid.');
    }
    priorSequence = fact.sequence;
    switch (fact.type) {
      case 'opening_float':
        totals.opening = safe(totals.opening + fact.amountMinorUnits);
        break;
      case 'cash_sale':
        totals.gross = safe(totals.gross + fact.received);
        totals.change = safe(totals.change + fact.change);
        totals.sales = safe(totals.sales + cashEntryEffect(fact.received, fact.change));
        break;
      case 'paid_in':
        totals.paidIn = safe(totals.paidIn + fact.amountMinorUnits);
        break;
      case 'paid_out':
        totals.paidOut = safe(totals.paidOut + fact.amountMinorUnits);
        break;
      case 'safe_drop':
        totals.safeDrop = safe(totals.safeDrop + fact.amountMinorUnits);
        break;
      case 'drawer_correction':
      case 'close_adjustment':
        totals.adjustment = safe(totals.adjustment + fact.amountMinorUnits);
        break;
      case 'handoff_transfer':
      case 'count_observation':
      case 'variance_resolution':
        break;
    }
  }
  const expected = safe(
    totals.opening +
      totals.sales +
      totals.paidIn -
      totals.paidOut -
      totals.safeDrop +
      totals.adjustment,
  );
  const money = (minorUnits: number) => ({ minorUnits, currency });
  return {
    openingFloat: money(totals.opening),
    grossCashReceived: money(totals.gross),
    changeGiven: money(totals.change),
    netCashSales: money(totals.sales),
    paidIn: money(totals.paidIn),
    paidOut: money(totals.paidOut),
    safeDrops: money(totals.safeDrop),
    adjustments: money(totals.adjustment),
    expectedDrawerCash: money(expected),
    currency,
    ledgerSequence: priorSequence,
    calculatedAt: calculatedAt.toISOString(),
    shiftVersion,
  };
};

export const calculateVariance = (
  expected: number,
  counted: number,
  tolerance: number,
  currency: string,
  ledgerSequence: number,
): CashVariance => {
  safe(expected);
  safe(counted);
  safe(tolerance);
  if (counted < 0 || tolerance < 0) throw new RangeError('Count or tolerance is invalid.');
  const signed = safe(counted - expected);
  const absolute = Math.abs(signed);
  const withinTolerance = absolute <= tolerance;
  const outcome: CashReconciliationOutcome =
    signed === 0 ? 'balanced' : withinTolerance ? 'within_tolerance' : 'approval_required';
  const money = (minorUnits: number) => ({ minorUnits, currency });
  return {
    expectedCash: money(expected),
    countedCash: money(counted),
    signedVariance: money(signed),
    absoluteVariance: money(absolute),
    tolerance: money(tolerance),
    withinTolerance,
    approvalRequired: !withinTolerance,
    reasonRequired: signed !== 0,
    outcome,
    ledgerSequence,
  };
};

const transitions: Record<CashShiftStatus, CashShiftStatus[]> = {
  opening: ['open', 'blocked'],
  open: ['suspended', 'handoff_pending', 'counting', 'blocked'],
  suspended: ['open', 'handoff_pending', 'blocked'],
  handoff_pending: ['open', 'blocked'],
  counting: ['reconciliation_required', 'blocked'],
  reconciliation_required: ['counting', 'closing', 'blocked'],
  closing: ['closed', 'blocked'],
  closed: [],
  blocked: [],
  recovered: ['open', 'suspended', 'counting', 'reconciliation_required', 'closed'],
};

export const canTransitionShift = (from: CashShiftStatus, to: CashShiftStatus): boolean =>
  transitions[from].includes(to);
