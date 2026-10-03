/**
 * Caja y turnos — the pure part.
 *
 * The screen is a view over one operations feed. Everything that decides *what*
 * is shown lives here, so it can be tested without a browser: the variance, the
 * business-day series, the triage buckets, the filter, and the sort.
 *
 * All money is in minor units, as it arrives from the API.
 */

export const OPEN_STATUSES = new Set(['open', 'opening']);
export const ATTENTION_STATUSES = new Set([
  'reconciliation_required',
  'counting',
  'closing',
  'handoff_pending',
]);
export const CLOSED_STATUS = 'closed';

export const BUCKETS = ['all', 'open', 'attention', 'closed'];

/** Counted − expected, or null when the shift has not been counted. */
export function varianceOf(facts) {
  const counted = facts?.countedCashMinorUnits;
  if (counted == null) return null;
  return counted - (facts?.expectedCashMinorUnits ?? 0);
}

export function countBuckets(items) {
  return {
    all: items.length,
    open: items.filter((s) => OPEN_STATUSES.has(s.status)).length,
    attention: items.filter((s) => ATTENTION_STATUSES.has(s.status)).length,
    closed: items.filter((s) => s.status === CLOSED_STATUS).length,
  };
}

export function filterShifts(items, { bucket = 'all', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return items.filter((s) => {
    if (bucket === 'open' && !OPEN_STATUSES.has(s.status)) return false;
    if (bucket === 'attention' && !ATTENTION_STATUSES.has(s.status)) return false;
    if (bucket === 'closed' && s.status !== CLOSED_STATUS) return false;
    if (!q) return true;
    return `${s.facts?.register ?? ''} ${s.facts?.operator ?? ''} ${s.facts?.businessDate ?? ''}`
      .toLowerCase()
      .includes(q);
  });
}

/**
 * The business day of a shift. The API sends `facts.businessDate`, which is
 * derived from the merchant's day-start — never the calendar date of the
 * timestamp. The timestamp is only a fallback for an older payload.
 */
export function businessDayOf(shift) {
  return shift?.facts?.businessDate || (shift?.occurredAt || '').slice(0, 10) || null;
}

export function sortShifts(items, { key = 'date', dir = 'desc' } = {}) {
  const sign = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (key === 'variance') {
      const va = varianceOf(a.facts);
      const vb = varianceOf(b.facts);
      // A drawer nobody has counted has no variance. It is not balanced, so it
      // never sorts between a shortage and an overage; it goes last either way.
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * sign;
    }
    if (key === 'expected') {
      return (
        ((a.facts?.expectedCashMinorUnits ?? 0) - (b.facts?.expectedCashMinorUnits ?? 0)) * sign
      );
    }
    const da = businessDayOf(a) ?? '';
    const db = businessDayOf(b) ?? '';
    return da < db ? -sign : da > db ? sign : 0;
  });
}

/**
 * The back-office form of the difference: one point per business day, summed
 * over the shifts that closed that day, oldest first.
 *
 * Only closed shifts carry a variance, so only they contribute. A day with no
 * close does not appear at all — a gap in the series is honest; a zero would be
 * a claim that the day balanced.
 */
export function buildVarianceSeries(items, maxDays = 7) {
  const byDay = new Map();
  for (const shift of items) {
    if (shift.status !== CLOSED_STATUS) continue;
    const day = businessDayOf(shift);
    if (!day) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + (varianceOf(shift.facts) ?? 0));
  }
  return Array.from(byDay.entries())
    .map(([businessDate, varianceMinorUnits]) => ({ businessDate, varianceMinorUnits }))
    .sort((a, b) => (a.businessDate < b.businessDate ? -1 : 1))
    .slice(-maxDays);
}
