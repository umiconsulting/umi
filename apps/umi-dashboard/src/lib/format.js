import { i18n } from '@lingui/core';
import { localeTag } from './i18n.js';

/**
 * Locale-aware formatters. Every screen used to call `toLocaleString('es-MX')`
 * directly; the tag now follows the active language so an English owner reads
 * "Sep 5" and "$1,250.00" while a Spanish owner reads "5 sept" and "$1,250.00 MXN".
 *
 * Amounts arrive in centavos from the API; `formatMoney` divides by 100.
 * `formatMoneyUnits` takes whole currency units for the few legacy fields.
 */
const tag = () => localeTag(i18n.locale);

export function formatNumber(value, options) {
  if (value == null || Number.isNaN(Number(value))) return '–';
  return new Intl.NumberFormat(tag(), options).format(Number(value));
}

export function formatMoney(centavos, currency = 'MXN', options = {}) {
  if (centavos == null || Number.isNaN(Number(centavos))) return '–';
  return new Intl.NumberFormat(tag(), { style: 'currency', currency, ...options }).format(
    Number(centavos) / 100,
  );
}

export function formatMoneyUnits(units, currency = 'MXN', options = {}) {
  if (units == null || Number.isNaN(Number(units))) return '–';
  return new Intl.NumberFormat(tag(), { style: 'currency', currency, ...options }).format(
    Number(units),
  );
}

function toDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value, options = { day: 'numeric', month: 'short' }) {
  const d = toDate(value);
  return d ? new Intl.DateTimeFormat(tag(), options).format(d) : '–';
}

export function formatTime(value, options = { hour: '2-digit', minute: '2-digit' }) {
  const d = toDate(value);
  return d ? new Intl.DateTimeFormat(tag(), options).format(d) : '–';
}

export function formatDateTime(value, options = { dateStyle: 'medium', timeStyle: 'short' }) {
  const d = toDate(value);
  return d ? new Intl.DateTimeFormat(tag(), options).format(d) : '–';
}
