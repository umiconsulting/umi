/**
 * Tenant timezone utilities.
 *
 * Use these instead of calling `new Date().getDay()`, `getHours()`, or
 * hand-rolling `toLocaleString` → `new Date()` roundtrips. Those approaches
 * use the server's local timezone (UTC on Vercel), not the tenant's.
 */

import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { startOfDay } from 'date-fns';

export const DEFAULT_TZ = 'America/Mexico_City';

/** Day of week (0=Sun..6=Sat) in tenant timezone. */
export function tenantWeekday(tz: string | null | undefined, at: Date = new Date()): number {
  return toZonedTime(at, tz || DEFAULT_TZ).getDay();
}

/** Hour of day (0..23) in tenant timezone. */
export function tenantHour(tz: string | null | undefined, at: Date = new Date()): number {
  return toZonedTime(at, tz || DEFAULT_TZ).getHours();
}

/**
 * UTC Date representing 00:00:00 of the tenant's local calendar day that
 * contains `at`. DST-safe via date-fns-tz.
 */
export function tenantStartOfDay(tz: string | null | undefined, at: Date = new Date()): Date {
  const zone = tz || DEFAULT_TZ;
  const zoned = toZonedTime(at, zone);
  return fromZonedTime(startOfDay(zoned), zone);
}
