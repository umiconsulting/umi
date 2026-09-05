import { formatDateTime, formatMoney } from '@/lib/format.js';

/** Money in an operations row. The API sends centavos plus the ISO currency. */
export function formatOperationMoney(value, currency) {
  if (value == null || !currency) return '—';
  return formatMoney(value, currency);
}

export function formatOperationDate(value) {
  if (!value) return '—';
  return formatDateTime(value);
}
