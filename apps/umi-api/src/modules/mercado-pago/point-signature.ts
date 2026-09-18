import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Mercado Pago Point webhook signature verification — PURE. No Nest, no I/O, no
 * clock of its own (`now` is injected), so the recipe of research note 02 §2.8 is
 * testable without a server and without a network.
 *
 * The vendor's recipe, in their documented order:
 *
 *   1. `x-signature: ts=<value>,v1=<value>`; split on `,`, then on the FIRST `=`.
 *   2. `x-request-id` header.
 *   3. `data.id` from the QUERY STRING (the official SDK helpers read it there,
 *      research note 02 §2.7), lowercased.
 *   4. Manifest `id:{id};request-id:{rid};ts:{ts};`, omitting the `id:` part when
 *      `data.id` is absent and the `request-id:` part when the header is absent.
 *      The trailing `;` always stays, so there are three legal shapes.
 *   5. HMAC-SHA256, lowercase hex, the panel secret as the key.
 *   6. Constant-time compare against `v1`.
 *   7. Optionally compare `ts` against now, inside a tolerance.
 *
 * Nothing here touches the payment: a verdict is a string, and the caller decides
 * what to do with it.
 */

export type PointSignatureFailure =
  /** No `MERCADO_PAGO_POINT_WEBHOOK_SECRET` configured: fail closed. */
  | 'missing_secret'
  /** No `x-signature` header (or an empty one). */
  | 'missing_signature'
  /** The header carries no usable `ts`/`v1` pair. */
  | 'malformed_signature'
  /** `ts` is outside the tolerance window. */
  | 'stale_timestamp'
  /** The recomputed HMAC differs from `v1`. */
  | 'mismatch';

export type PointSignatureVerdict = { ok: true } | { ok: false; reason: PointSignatureFailure };

/**
 * How far a notification's `ts` may drift from our clock.
 *
 * The vendor calls the freshness check OPTIONAL and publishes NO window (research
 * note 02 §2.6). We add one anyway, and the reason is documented: the body is not
 * part of the hash, so a captured request replays forever without it. 15 minutes is
 * wide enough for the documented 15-minute retry cadence plus client clock skew, and
 * narrow enough that a captured notification is not a permanent key.
 */
export const POINT_SIGNATURE_TOLERANCE_MS = 15 * 60 * 1000;

/**
 * The vendor's own examples disagree on the unit of `ts`: the general webhook page
 * shows 10 digits (`1704908010`, seconds) and the Point page shows 13
 * (`1742505638683`, milliseconds). Recorded as a conflict in research note 02 §2.1.
 * We accept both and derive the unit from the digit count — <= 10 digits is seconds,
 * anything longer is milliseconds — because a 10-digit value read as milliseconds
 * would land in January 1970 and be rejected as stale.
 */
const SECONDS_UNIT_MAX_DIGITS = 10;

/**
 * The signed manifest. The order of the parts and the separators are the vendor's
 * (research note 02 §2.2) and must not be rearranged: one saved byte changes the
 * HMAC. `data.id` arrives uppercase from Mercado Pago and is lowercased here, per
 * the note in §2.3; `x-request-id` and `ts` are used exactly as received.
 */
export function pointSignatureManifest(input: {
  dataId?: string | null;
  requestId?: string | null;
  ts: string;
}): string {
  const parts: string[] = [];
  if (input.dataId) parts.push(`id:${input.dataId.toLowerCase()}`);
  if (input.requestId) parts.push(`request-id:${input.requestId}`);
  parts.push(`ts:${input.ts}`);
  return `${parts.join(';')};`;
}

/**
 * Split `ts=...,v1=...,...` into its parts. Returns null when either value is
 * absent — that is the `malformed_signature` case, and it is the only one: a `v1`
 * of the wrong length is a `mismatch`, because telling a prober which of the two
 * failed is not worth the branch.
 */
function parseSignatureHeader(header: string): { ts: string; v1: string } | null {
  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 'ts') ts ??= value;
    else if (key === 'v1') v1 ??= value;
  }
  if (!ts || !v1) return null;
  return { ts, v1 };
}

/** `ts` as epoch milliseconds, accepting both documented units. Null if not numeric. */
function parseTimestampMs(ts: string): number | null {
  if (!/^\d+$/.test(ts)) return null;
  const value = Number(ts);
  if (!Number.isSafeInteger(value)) return null;
  return ts.length <= SECONDS_UNIT_MAX_DIGITS ? value * 1000 : value;
}

/**
 * Verify one notification. Order: secret, header, shape, freshness, HMAC — the
 * order the failure union above is written in, so `reason` alone tells an operator
 * (and the tests) which gate refused the request.
 *
 * A missing secret is `missing_secret` and NOT a bypass: with no secret configured
 * the receiver cannot tell a notification from a forgery, so it refuses every
 * notification instead of trusting an unsigned body.
 */
export function verifyPointSignature(input: {
  signatureHeader?: string | null;
  requestId?: string | null;
  dataId?: string | null;
  secret?: string | null;
  now?: Date;
}): PointSignatureVerdict {
  const secret = input.secret;
  if (!secret) return { ok: false, reason: 'missing_secret' };

  if (!input.signatureHeader) return { ok: false, reason: 'missing_signature' };
  const parsed = parseSignatureHeader(input.signatureHeader);
  if (!parsed) return { ok: false, reason: 'malformed_signature' };

  const timestampMs = parseTimestampMs(parsed.ts);
  if (timestampMs === null) return { ok: false, reason: 'malformed_signature' };

  const now = input.now ?? new Date();
  if (Math.abs(now.getTime() - timestampMs) > POINT_SIGNATURE_TOLERANCE_MS) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const manifest = pointSignatureManifest({
    dataId: input.dataId,
    requestId: input.requestId,
    ts: parsed.ts,
  });
  const expected = Buffer.from(createHmac('sha256', secret).update(manifest).digest('hex'), 'utf8');
  const provided = Buffer.from(parsed.v1, 'utf8');
  // Length first: `timingSafeEqual` THROWS on a length mismatch, and a throw here
  // would be a 500 on a forged request instead of the 401 it deserves.
  if (expected.length !== provided.length) return { ok: false, reason: 'mismatch' };
  return timingSafeEqual(expected, provided) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
