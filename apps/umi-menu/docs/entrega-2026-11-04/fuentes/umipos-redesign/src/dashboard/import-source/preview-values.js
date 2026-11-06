import { fileError } from './schema.js';

export const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const cell = (row, column) => (row.values[column] ?? '').trim();
export const issue = (code, column, rowNumber) => ({ code, column, rowNumber });

// Remove insignificant zeroes before the precision and range checks.
export function decimal(text, maxScale, { positive = false, fixed = false } = {}) {
  const normalized = text.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw fileError('INVALID_NUMBER');
  const [digits, raw = ''] = normalized.split('.');
  const whole = digits.replace(/^0+/, '') || '0';
  const fraction = raw.replace(/0+$/, '');
  if (fraction.length > maxScale) throw fileError('PRECISION_OVERFLOW');
  if (whole.length > 16) throw fileError('UNSAFE_QUANTITY');
  const scale = fixed ? maxScale : fraction.length;
  const value = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');
  if (value > MAX_SAFE) throw fileError('UNSAFE_QUANTITY');
  if (positive && value === 0n) throw fileError('INVALID_NUMBER');
  return { value: Number(value), scale };
}

export function sameQuantity(a, b) {
  return (
    a?.unit === b?.unit &&
    BigInt(a.value) * 10n ** BigInt(b.scale) === BigInt(b.value) * 10n ** BigInt(a.scale)
  );
}

export function entryFor(rows, reference, label) {
  return {
    key: String(rows[0].rowNumber),
    rowNumbers: rows.map((row) => row.rowNumber),
    reference: reference.slice(0, 512),
    label: label.slice(0, 512),
    status: 'error',
    errors: rows.flatMap((row) =>
      (row.errors || []).map((error) => issue(error.code, error.column ?? null, row.rowNumber)),
    ),
    command: null,
  };
}

export function collect(entry, row, column, read) {
  try {
    return read();
  } catch (error) {
    entry.errors.push(issue(error.code || 'INVALID_VALUE', column, row.rowNumber));
    return null;
  }
}
