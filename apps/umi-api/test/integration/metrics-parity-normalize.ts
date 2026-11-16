import { createHash } from 'node:crypto';
import type { MetricsResponse, ReportsSalesSummary } from '@umi/contract';

/**
 * One canonical shape for the fourteen metrics that exist on both sides.
 *
 * The shape is the comparison surface of the gate-2 parity matrix. It removes
 * the two different envelopes, renames the measure fields, and sorts every
 * list. Two rules are deliberate:
 *
 * - The payment mix is a multiset. The normal form sorts the rows and keeps
 *   duplicate methods. The legacy method concatenates tenders and wallet
 *   allocations, so the same method can appear twice. This matrix does not
 *   deduplicate it.
 * - A null field and an absent field stay different. A row copies a field only
 *   when the source object has the key. The sort key gives an absent field, a
 *   null field and a text value three different ranks.
 */
export interface NormalizedMetrics {
  net_sales: number;
  orders: number;
  average_ticket: number;
  items_sold: number;
  units_per_ticket: number | null;
  discounts: number;
  tips: number;
  prior_net_sales: number;
  payment_mix: Record<string, unknown>[];
  channel_mix: Record<string, unknown>[];
  product_mix: Record<string, unknown>[];
  operator_mix: Record<string, unknown>[];
  hour_mix: Record<string, unknown>[];
  series: Record<string, unknown>[];
}

export const MIGRATED_METRICS = [
  'net_sales',
  'orders',
  'average_ticket',
  'items_sold',
  'units_per_ticket',
  'discounts',
  'tips',
  'prior_net_sales',
  'payment_mix',
  'channel_mix',
  'product_mix',
  'operator_mix',
  'hour_mix',
  'series',
] as const;

const number = (value: unknown): number => Number(value ?? 0);

/** The ratio keeps four decimals. A null stays null at zero orders. */
const ratio = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(Number(value).toFixed(4));

/**
 * The sort rank of one field.
 *
 * `\u0000` is an absent key, `\u0001` is a JSON null, and `\u0002` prefixes a
 * text or number value. The order is therefore total and stable.
 */
function rank(source: Record<string, unknown>, key: string): string {
  if (!(key in source)) return '\u0000';
  const value = source[key];
  if (value === null) return '\u0001';
  return `\u0002${String(value)}`;
}

function compareRanks(left: string[], right: string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? '';
    const b = right[index] ?? '';
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

function copyPresent(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of keys) if (key in source) row[key] = source[key];
  return row;
}

function itemsOf(value: unknown): Record<string, unknown>[] {
  if (value === null || typeof value !== 'object') {
    throw new Error('a preset metric is not an object');
  }
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) throw new Error('a preset metric has no items array');
  return items as Record<string, unknown>[];
}

function paymentRows(items: Record<string, unknown>[]) {
  return items
    .map((item) => copyPresent(item, ['method', 'amountMinorUnits']))
    .sort((left, right) =>
      compareRanks(
        [rank(left, 'method'), rank(left, 'amountMinorUnits')],
        [rank(right, 'method'), rank(right, 'amountMinorUnits')],
      ),
    );
}

function channelRows(items: Record<string, unknown>[]) {
  return items
    .map((item) => copyPresent(item, ['channel', 'netSalesMinorUnits', 'orders']))
    .sort((left, right) => compareRanks([rank(left, 'channel')], [rank(right, 'channel')]));
}

function productRows(items: Record<string, unknown>[]) {
  return items
    .map((item) => {
      const row = copyPresent(item, ['productId', 'productName', 'category', 'units']);
      const measure = 'netMinorUnits' in item ? item.netMinorUnits : item.merchandiseMinorUnits;
      if (measure !== undefined) row.netMinorUnits = measure;
      return row;
    })
    .sort((left, right) =>
      compareRanks(
        [rank(left, 'productId'), rank(left, 'productName'), rank(left, 'category')],
        [rank(right, 'productId'), rank(right, 'productName'), rank(right, 'category')],
      ),
    );
}

function operatorRows(items: Record<string, unknown>[]) {
  return items
    .map((item) => {
      const row = copyPresent(item, ['operator', 'units']);
      const measure = 'netMinorUnits' in item ? item.netMinorUnits : item.merchandiseMinorUnits;
      if (measure !== undefined) row.netMinorUnits = measure;
      return row;
    })
    .sort((left, right) => compareRanks([rank(left, 'operator')], [rank(right, 'operator')]));
}

function hourRows(items: Record<string, unknown>[]) {
  return items
    .map((item) => {
      const row = copyPresent(item, ['hour', 'units']);
      const measure = 'netMinorUnits' in item ? item.netMinorUnits : item.merchandiseMinorUnits;
      if (measure !== undefined) row.netMinorUnits = measure;
      return row;
    })
    .sort((left, right) => compareRanks([rank(left, 'hour')], [rank(right, 'hour')]));
}

function seriesRows(items: Record<string, unknown>[]) {
  return items
    .map((item) => copyPresent(item, ['label', 'netSalesMinorUnits']))
    .sort((left, right) => compareRanks([rank(left, 'label')], [rank(right, 'label')]));
}

/** The canonical form of a fresh `metrics/query` totals read. */
export function normalizeFresh(response: MetricsResponse): NormalizedMetrics {
  if (!response.totals) throw new Error('the fresh read returned rows, not totals');
  const values = response.totals.values;
  return {
    net_sales: number(values.net_sales),
    orders: number(values.orders),
    average_ticket: number(values.average_ticket),
    items_sold: number(values.items_sold),
    units_per_ticket: ratio(values.units_per_ticket),
    discounts: number(values.discounts),
    tips: number(values.tips),
    prior_net_sales: number(values.prior_net_sales),
    payment_mix: paymentRows(itemsOf(values.payment_mix)),
    channel_mix: channelRows(itemsOf(values.channel_mix)),
    product_mix: productRows(itemsOf(values.product_mix)),
    operator_mix: operatorRows(itemsOf(values.operator_mix)),
    hour_mix: hourRows(itemsOf(values.hour_mix)),
    series: seriesRows(itemsOf(values.series)),
  };
}

/**
 * The canonical form of the legacy `salesSummary` read.
 *
 * `units_per_ticket` is derived here, because the legacy response has no such
 * field. The formula is the same integer half-up rule as the catalogue. The
 * legacy mix names differ: `byOperator` and `byHour`.
 */
export function normalizeLegacy(summary: ReportsSalesSummary): NormalizedMetrics {
  const totals = summary.totals;
  return {
    net_sales: totals.netSalesMinorUnits,
    orders: totals.orders,
    average_ticket: totals.averageTicketMinorUnits,
    items_sold: totals.itemsSold,
    units_per_ticket: ratio(legacyUnitsPerTicket(totals.itemsSold, totals.orders)),
    discounts: totals.discountMinorUnits,
    tips: totals.tipsMinorUnits,
    prior_net_sales: number(totals.priorNetSalesMinorUnits),
    payment_mix: paymentRows(summary.paymentMix),
    channel_mix: channelRows(summary.channelMix),
    product_mix: productRows(summary.productMix),
    operator_mix: operatorRows(
      summary.byOperator.map((row) => ({
        operator: row.key,
        units: row.units,
        netMinorUnits: row.netMinorUnits,
      })),
    ),
    hour_mix: hourRows(
      summary.byHour.map((row) => ({
        hour: row.key,
        units: row.units,
        netMinorUnits: row.netMinorUnits,
      })),
    ),
    series: seriesRows(
      summary.series.map((row) => ({
        label: row.label,
        netSalesMinorUnits: row.amountMinorUnits,
      })),
    ),
  };
}

/** Units per ticket at four decimals, half-up. */
export function legacyUnitsPerTicket(itemsSold: number, orders: number): number | null {
  if (orders === 0) return null;
  return Math.floor((itemsSold * 20000 + orders) / (2 * orders)) / 10000;
}

/** The exact bytes that the ledger hashes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Replace the random fixture UUIDs with their fixture role.
 *
 * The matrix ledger must keep the same hashes on every run. The seed generates
 * random product ids, so the ledger hash uses this stable alias. The parity
 * comparison itself uses the raw normalized form, with the real ids.
 */
export function aliasFixtureProducts(
  normalized: NormalizedMetrics,
  aliases: Readonly<Record<string, string>>,
): NormalizedMetrics {
  return {
    ...normalized,
    product_mix: normalized.product_mix
      .map((row) => {
        const productId = row.productId;
        if (typeof productId !== 'string') return { ...row };
        const alias = aliases[productId];
        if (!alias) throw new Error(`the fixture has no alias for product ${productId}`);
        return { ...row, productId: alias };
      })
      .sort((left, right) =>
        compareRanks(
          [rank(left, 'productId'), rank(left, 'productName'), rank(left, 'category')],
          [rank(right, 'productId'), rank(right, 'productName'), rank(right, 'category')],
        ),
      ),
  };
}
