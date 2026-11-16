import { METRIC_DIMENSIONS_BY_ID, type MetricsDimension, type MetricsId } from '@umi/contract';

/**
 * One metric definition. It is data, not code: the formula text is the contract
 * the verifier reads, and the repository implements the same text. A new metric
 * needs a definition here and a formula there, and nothing in between.
 */
export interface MetricDefinition {
  readonly id: MetricsId;
  readonly kind: 'sale' | 'line' | 'derived' | 'period' | 'preset';
  readonly unit: 'minor_units' | 'count' | 'ratio' | 'distribution';
  readonly granularity:
    | 'sale'
    | 'line'
    | 'derived'
    | 'period'
    | 'method'
    | 'channel'
    | 'product'
    | 'operator'
    | 'hour'
    | 'day_or_hour';
  /** The tables the definition reads. The response coverage is their union. */
  readonly sources: readonly string[];
  readonly additive: boolean;
  readonly dimensions: readonly MetricsDimension[];
  readonly nullPolicy: string;
  readonly formula: string;
  readonly version: '1.0.0';
}

const SALE_SOURCES = ['pos_committed_sale', 'receipt_snapshot'] as const;
const LINE_SOURCES = ['pos_committed_sale', 'receipt_snapshot', 'pos_cart_line'] as const;
const ZERO_WHEN_EMPTY = '0 when the set is empty';

export const METRIC_CATALOG: readonly MetricDefinition[] = [
  {
    id: 'net_sales',
    kind: 'sale',
    unit: 'minor_units',
    granularity: 'sale',
    sources: SALE_SOURCES,
    additive: true,
    dimensions: METRIC_DIMENSIONS_BY_ID.net_sales,
    nullPolicy: ZERO_WHEN_EMPTY,
    formula:
      'coalesce(sum(r.grand_total), 0)::bigint over committed sales in the business-date window',
    version: '1.0.0',
  },
  {
    id: 'orders',
    kind: 'sale',
    unit: 'count',
    granularity: 'sale',
    sources: SALE_SOURCES,
    additive: true,
    dimensions: METRIC_DIMENSIONS_BY_ID.orders,
    nullPolicy: ZERO_WHEN_EMPTY,
    formula: 'count(*)::bigint over committed sales in the business-date window',
    version: '1.0.0',
  },
  {
    id: 'average_ticket',
    kind: 'derived',
    unit: 'minor_units',
    granularity: 'sale',
    sources: SALE_SOURCES,
    additive: false,
    dimensions: METRIC_DIMENSIONS_BY_ID.average_ticket,
    nullPolicy: '0 when orders = 0. This is the documented exception to the null rule.',
    formula: 'orders = 0 ? 0 : Math.round(net_sales / orders)',
    version: '1.0.0',
  },
  {
    id: 'items_sold',
    kind: 'line',
    unit: 'count',
    granularity: 'line',
    sources: LINE_SOURCES,
    additive: true,
    dimensions: METRIC_DIMENSIONS_BY_ID.items_sold,
    nullPolicy: ZERO_WHEN_EMPTY,
    formula:
      'coalesce(sum(cl.quantity), 0)::bigint over the cart lines of the same committed sales',
    version: '1.0.0',
  },
  {
    id: 'units_per_ticket',
    kind: 'derived',
    unit: 'ratio',
    granularity: 'line',
    sources: LINE_SOURCES,
    additive: false,
    dimensions: METRIC_DIMENSIONS_BY_ID.units_per_ticket,
    nullPolicy: 'null when orders = 0; 0 when orders > 0 and items = 0; else 4 decimals, half-up',
    formula: 'orders = 0 ? null : items = 0 ? 0 : roundHalfUp(items / orders, 4)',
    version: '1.0.0',
  },
  {
    id: 'discounts',
    kind: 'sale',
    unit: 'minor_units',
    granularity: 'sale',
    sources: SALE_SOURCES,
    additive: true,
    dimensions: METRIC_DIMENSIONS_BY_ID.discounts,
    nullPolicy: ZERO_WHEN_EMPTY,
    formula: "coalesce(sum((r.snapshot->'discountTotal'->>'minorUnits')::bigint), 0)",
    version: '1.0.0',
  },
  {
    id: 'tips',
    kind: 'sale',
    unit: 'minor_units',
    granularity: 'sale',
    sources: SALE_SOURCES,
    additive: true,
    dimensions: METRIC_DIMENSIONS_BY_ID.tips,
    nullPolicy: ZERO_WHEN_EMPTY,
    formula: "coalesce(sum((r.snapshot->'tip'->>'minorUnits')::bigint), 0)",
    version: '1.0.0',
  },
  {
    id: 'prior_net_sales',
    kind: 'period',
    unit: 'minor_units',
    granularity: 'period',
    sources: SALE_SOURCES,
    additive: true,
    dimensions: METRIC_DIMENSIONS_BY_ID.prior_net_sales,
    nullPolicy: ZERO_WHEN_EMPTY,
    formula: 'net_sales over the prior window of the same size',
    version: '1.0.0',
  },
  {
    id: 'refunds',
    kind: 'sale',
    unit: 'minor_units',
    granularity: 'sale',
    sources: ['pos_sale_exception', ...SALE_SOURCES],
    additive: true,
    dimensions: METRIC_DIMENSIONS_BY_ID.refunds,
    nullPolicy: ZERO_WHEN_EMPTY,
    formula:
      'coalesce(sum(x.total_minor_units - x.tip_minor_units), 0) over committed exceptions, attributed to the sale business_date',
    version: '1.0.0',
  },
  {
    id: 'payment_mix',
    kind: 'preset',
    unit: 'distribution',
    granularity: 'method',
    sources: [...SALE_SOURCES, 'pos_tender_fact', 'customer_value_tender_allocation'],
    additive: true,
    dimensions: METRIC_DIMENSIONS_BY_ID.payment_mix,
    nullPolicy: 'empty items and zero total when the set is empty',
    formula:
      'pos_tender_fact with status committed, concatenated with customer_value_tender_allocation; no dedupe',
    version: '1.0.0',
  },
  {
    id: 'channel_mix',
    kind: 'preset',
    unit: 'distribution',
    granularity: 'channel',
    sources: SALE_SOURCES,
    additive: true,
    dimensions: METRIC_DIMENSIONS_BY_ID.channel_mix,
    nullPolicy: 'empty items and zero total when the set is empty',
    formula: "group by coalesce(s.origin_channel, 'walk_in'); sum(r.grand_total), count(*)",
    version: '1.0.0',
  },
  {
    id: 'product_mix',
    kind: 'preset',
    unit: 'distribution',
    granularity: 'product',
    sources: [...LINE_SOURCES, 'product', 'product_category'],
    additive: true,
    dimensions: METRIC_DIMENSIONS_BY_ID.product_mix,
    nullPolicy: 'empty items and zero total when the set is empty',
    formula:
      'group by cl.product_id; units sum(cl.quantity); merchandise sum(cl.quantity * (cl.base_price + cl.variant_delta + cl.modifier_total))',
    version: '1.0.0',
  },
  {
    id: 'operator_mix',
    kind: 'preset',
    unit: 'distribution',
    granularity: 'operator',
    sources: [...LINE_SOURCES, 'cash_shift', 'staff'],
    additive: true,
    dimensions: METRIC_DIMENSIONS_BY_ID.operator_mix,
    nullPolicy: 'empty items and zero total when the set is empty',
    formula: "group by coalesce(st.name, '—') through cash_shift and staff; units and merchandise",
    version: '1.0.0',
  },
  {
    id: 'hour_mix',
    kind: 'preset',
    unit: 'distribution',
    granularity: 'hour',
    sources: LINE_SOURCES,
    additive: true,
    dimensions: METRIC_DIMENSIONS_BY_ID.hour_mix,
    nullPolicy: 'empty items and zero total when the set is empty',
    formula:
      "group by to_char(s.committed_at AT TIME ZONE merchant.timezone, 'HH24'); units and merchandise",
    version: '1.0.0',
  },
  {
    id: 'series',
    kind: 'preset',
    unit: 'distribution',
    granularity: 'day_or_hour',
    sources: SALE_SOURCES,
    additive: true,
    dimensions: METRIC_DIMENSIONS_BY_ID.series,
    nullPolicy: 'empty items and zero total when the set is empty',
    formula:
      'group by r.business_date for a day range, or by local hour for an hour range; sum(r.grand_total)',
    version: '1.0.0',
  },
];

const byId = new Map(METRIC_CATALOG.map((metric) => [metric.id, metric]));

export function metricDefinition(id: MetricsId): MetricDefinition {
  const found = byId.get(id);
  if (!found) throw new Error(`Unknown metric definition: ${id}`);
  return found;
}

export const DEFINITION_VERSION = '1.0.0' as const;

/** The coverage order: the first metric that names a source puts it there. */
export function coverageSources(ids: readonly MetricsId[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of ids) {
    for (const source of metricDefinition(id).sources) {
      if (seen.has(source)) continue;
      seen.add(source);
      ordered.push(source);
    }
  }
  return ordered;
}
