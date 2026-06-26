/**
 * Cross-cutting formatting used by the dashboard read modules (customers, cash).
 * Money is stored as integer centavos throughout; display is es-MX MXN with no
 * fraction digits — ported from server.js `fmt()`.
 */
const MXN = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatMxn(centavos: number | null | undefined): string {
  return MXN.format((centavos ?? 0) / 100);
}

// Transaction amounts (umi-cash `formatMXN`) show 2 fraction digits ($1.00).
const MXN2 = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
});

export function formatMxn2(centavos: number | null | undefined): string {
  return MXN2.format((centavos ?? 0) / 100);
}

/** Normalize a timestamp (Date or string) to an ISO string, or null. */
export function iso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
