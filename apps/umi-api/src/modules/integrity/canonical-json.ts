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
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]),
  );
}
