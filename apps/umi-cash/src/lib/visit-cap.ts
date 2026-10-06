/**
 * Barista-facing copy for the one-visit-per-day cap (enforced server-side per
 * calendar day in the tenant's timezone). The cap lifts at midnight, so this copy
 * must always say "mañana" — never a lastVisitAt+24h countdown, which overstates
 * the wait.
 */

/** Sublabel for the disabled "Registrar visita" checkbox. */
export const VISIT_CAP_HINT = 'Ya registrada hoy · disponible mañana';

/**
 * Full notice for the scan preview banner. `timeZone` is for tests; in the app it
 * stays undefined so the time renders in the device's zone — the barista's device
 * is at the store, which tracks the tenant timezone better than a pinned zone
 * (intl.ts pins Mexico City; Culiacán tenants are an hour off).
 */
export function visitCapNotice(lastVisitAt: string | null, timeZone?: string): string {
  const at = lastVisitAt
    ? ` a las ${new Date(lastVisitAt).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', timeZone })}`
    : '';
  return `Visita ya registrada hoy${at}. La próxima visita se podrá registrar mañana.`;
}
