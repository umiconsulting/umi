import { createHash } from 'node:crypto';

/**
 * A stable handle for a phone number.
 *
 * Use it where a row or a log line must identify a person, but must not hold
 * their number. Two events from the same number get the same handle. A duplicate
 * stays visible, and the stored value holds no phone number.
 *
 * The callers are `runtime.inbound_event.payload.phone_hash` and the security
 * log lines in `security-event.ts`.
 *
 * ⚠️ Do not use this handle to authenticate. It is not a secret. A country holds
 * a limited count of phone numbers, and an attacker can hash each one. The
 * handle protects a person who reads one row. It does not protect against an
 * attacker who holds the whole table.
 *
 * 16 hex characters is 64 bits. A collision becomes likely at about 4 billion
 * numbers, and Mexico has about 130 million.
 *
 * This function comes from `trace.service.ts`. It was the one part of that
 * deleted service with a live caller.
 */
export function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex').slice(0, 16);
}
