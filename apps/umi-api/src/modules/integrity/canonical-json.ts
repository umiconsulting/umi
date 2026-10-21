import { createHash } from 'node:crypto';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /(?:password|secret|token|authorization|cookie|privatekey|cardnumber|cvv)/i;

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function commandFingerprint(commandType: string, payload: unknown): string {
  return createHash('sha256')
    .update(`${commandType}\n${canonicalJson(payload)}`)
    .digest('hex');
}

export function redactObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redactObject(child),
    ]),
  );
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      // Code-unit order, not `localeCompare`. The digest is compared against
      // one computed by the Dart client, and the two collations disagree the
      // moment a camelCase key pair orders differently under case-insensitive
      // rules: `taxVersion` sorts before `taxes` by code unit and after it by
      // ICU. That one pair is why every cash checkout replayed as
      // `fingerprint_mismatch` while the cart commands beside it were fine.
      // `localeCompare` is also locale- and ICU-version-dependent, which has no
      // business deciding whether a journal entry is authentic.
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, sortValue(child)]),
  );
}
