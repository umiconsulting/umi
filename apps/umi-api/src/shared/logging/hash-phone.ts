import { createHash } from 'node:crypto';

/**
 * A stable, non-reversible handle for a phone number.
 *
 * Used where a row or a log line must identify a person WITHOUT holding their
 * number: `runtime.inbound_event.payload.phone_hash` is the current caller. Two
 * events from the same number get the same handle, so a duplicate is still
 * visible, and nothing stored can be read back into a phone number.
 *
 * ⚠️ This is a HANDLE, not a secret. sha256 over a phone number is cheap to
 * reverse by trying every number in a country, so it protects a reader of the
 * row, not an attacker with the whole table. Do not use it to authenticate.
 *
 * 16 hex characters is 64 bits. Collisions need about 4 billion numbers before
 * they are likely, and Mexico has about 130 million.
 *
 * Moved here from `trace.service.ts` when that service was deleted. It was the
 * one piece of that file with a live caller.
 */
export function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex').slice(0, 16);
}
