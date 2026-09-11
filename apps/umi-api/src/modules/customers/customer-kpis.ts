/**
 * Per-customer KPI math for the Customer 360 Overview tab. Pure and framework-free
 * so it unit-tests without a database (mirrors the `buildStatusClause` convention
 * in orders.repository). The restaurant model is CLV ≈ frequency × average ticket ×
 * tenure; the tiles follow the Toast/Square/SevenRooms guest-card core (spend ·
 * visits · average ticket · recency) plus one RFM-style segment badge.
 */

export type CustomerSegment =
  | 'prospect' // no orders yet — a contact or loyalty lead, not a buyer
  | 'new' // has ordered, but has no habit yet
  | 'regular' // orders often and is currently active
  | 'vip' // orders often AND spends a lot, and is currently active
  | 'at_risk' // was a repeat buyer, now overdue against their own rhythm
  | 'lapsed'; // no order for a long time (more than lapsedDays)

/**
 * First-pass thresholds. Café cadence is weekly, so "current" is about six weeks
 * and "lapsed" is Toast's six-month mark. These are the single edit point; a later
 * step can make them per-venue or merchant-relative (spend percentiles).
 */
export const SEGMENT_THRESHOLDS = {
  lapsedDays: 180,
  activeWindowDays: 45,
  regularMinVisits: 3,
  vipMinVisits: 8,
  vipMinSpendCents: 100_000, // 1,000 MXN lifetime
  atRiskMinVisits: 3,
  atRiskGapMultiplier: 3,
};

export type SegmentThresholds = typeof SEGMENT_THRESHOLDS;

export interface SegmentInput {
  orders: number;
  visits: number;
  totalSpendCents: number;
  recencyDays: number | null;
  tenureDays: number | null;
}

/**
 * Put a customer in one RFM-style bucket. Order matters: a lapsed or at-risk
 * signal wins over "regular", because a churn signal is the more useful thing to
 * show an owner. "At risk" needs the buyer to be overdue against their OWN rhythm
 * (average gap over their tenure), not a fixed calendar rule.
 */
export function classifyCustomerSegment(
  input: SegmentInput,
  thresholds: SegmentThresholds = SEGMENT_THRESHOLDS,
): CustomerSegment {
  const { orders, visits, totalSpendCents, recencyDays, tenureDays } = input;

  if (orders <= 0) return 'prospect';
  if (recencyDays != null && recencyDays > thresholds.lapsedDays) return 'lapsed';

  const isCurrent = recencyDays != null && recencyDays <= thresholds.activeWindowDays;

  // Their own rhythm: average days between visits over the tenure. Needs at least
  // two visits to define a gap; otherwise fall back to the active window.
  const typicalGapDays = tenureDays != null && visits >= 2 ? tenureDays / visits : null;
  const overdue =
    recencyDays != null &&
    (typicalGapDays != null
      ? recencyDays > thresholds.atRiskGapMultiplier * typicalGapDays
      : recencyDays > thresholds.activeWindowDays);

  if (visits >= thresholds.atRiskMinVisits && overdue) return 'at_risk';
  if (
    isCurrent &&
    visits >= thresholds.vipMinVisits &&
    totalSpendCents >= thresholds.vipMinSpendCents
  )
    return 'vip';
  if (isCurrent && visits >= thresholds.regularMinVisits) return 'regular';
  return 'new';
}

/** Average ticket in centavos (0 when there are no orders — no divide-by-zero). */
export function averageTicketCents(totalSpendCents: number, orders: number): number {
  if (orders <= 0) return 0;
  return Math.round(totalSpendCents / orders);
}

/**
 * Visits per 30-day month over the tenure, to one decimal. The tenure floor is one
 * month so a customer seen three times in their first week is not reported as
 * "12 per month".
 */
export function visitsPerMonth(visits: number, tenureDays: number | null): number {
  if (visits <= 0) return 0;
  const months = Math.max(1, (tenureDays ?? 0) / 30);
  return Math.round((visits / months) * 10) / 10;
}

/** Whole days between two instants; null when either side is missing or unparseable. */
export function daysBetween(
  fromIso: string | null | undefined,
  toIso: string | null | undefined,
): number | null {
  if (!fromIso || !toIso) return null;
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}
