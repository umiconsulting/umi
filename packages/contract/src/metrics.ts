import { z } from 'zod';
import { CurrencyCode, IsoTimestamp, MerchantDate, Uuid } from './platform';

// The semantic analytics surface (gate 1): a typed metric catalogue and one
// query route. The catalogue author is this file for the parts a client needs to
// validate against: the metric ids, the dimension ids and the metric-implies-
// dimension matrix. The server keeps the formula text and the source tables.
//
// The route answers a question, not a screen. It returns one of two shapes:
// `totals` for an undimensioned answer and `rows` for a grouped answer. A
// distribution metric (a mix) returns an envelope with its own cut and total, so
// a truncated mix never hides how much it summed.

export const METRIC_IDS = [
  'net_sales',
  'orders',
  'average_ticket',
  'items_sold',
  'units_per_ticket',
  'discounts',
  'tips',
  'prior_net_sales',
  'refunds',
  'payment_mix',
  'channel_mix',
  'product_mix',
  'operator_mix',
  'hour_mix',
  'series',
] as const;
export const MetricsId = z.enum(METRIC_IDS);
export type MetricsId = z.infer<typeof MetricsId>;

export const METRIC_DIMENSION_IDS = [
  'day',
  'hour',
  'channel',
  'operator',
  'category',
  'product',
] as const;
export const MetricsDimension = z.enum(METRIC_DIMENSION_IDS);
export type MetricsDimension = z.infer<typeof MetricsDimension>;

export const PRESET_METRIC_IDS = [
  'payment_mix',
  'channel_mix',
  'product_mix',
  'operator_mix',
  'hour_mix',
  'series',
] as const;

/**
 * The dimensions each metric accepts. A request that asks for a metric at a
 * dimension outside this list is a 400 on `dimensions`, never a silent
 * reinterpretation. A period metric accepts no dimension: it is a scalar about
 * the prior window and has no row of its own.
 */
export const METRIC_DIMENSIONS_BY_ID: Readonly<Record<MetricsId, readonly MetricsDimension[]>> = {
  net_sales: ['day', 'hour', 'channel', 'operator'],
  orders: ['day', 'hour', 'channel', 'operator'],
  average_ticket: ['day', 'hour', 'channel', 'operator'],
  items_sold: ['day', 'hour', 'channel', 'operator', 'category', 'product'],
  units_per_ticket: ['day', 'hour', 'channel', 'operator'],
  discounts: ['day', 'hour', 'channel', 'operator'],
  tips: ['day', 'hour', 'channel', 'operator'],
  prior_net_sales: [],
  refunds: ['day', 'hour', 'channel', 'operator'],
  payment_mix: [],
  channel_mix: [],
  product_mix: [],
  operator_mix: [],
  hour_mix: [],
  series: [],
};

export const METRIC_RANGES = ['today', 'yesterday', 'last_7_days', 'last_30_days'] as const;
export const MetricsRange = z.enum(METRIC_RANGES);
export type MetricsRange = z.infer<typeof MetricsRange>;

/** The validated request the controller hands to the service. */
export interface MetricsQueryInput {
  metrics: MetricsId[];
  dimensions: MetricsDimension[];
  range: MetricsRange;
  locationId?: string;
  /** Omitted in the body means the default of 100. */
  limit?: number;
}

const METRIC_ID_SET = new Set<string>(METRIC_IDS);
const DIMENSION_ID_SET = new Set<string>(METRIC_DIMENSION_IDS);
const RANGE_SET = new Set<string>(METRIC_RANGES);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The request schema. Every field is parsed as `unknown` and checked in one
 * `superRefine`, because the public contract names the FIELD in `fieldErrors`
 * (`metrics`, `dimensions`, `limit`, `range`, `locationId`), not the item
 * (`metrics.0`). The shared `ZodValidationPipe` joins a zod path with dots, so a
 * per-item enum would publish the wrong key. The cast restores the typed output
 * that the refine has already proven.
 */
export const MetricsQuery = z
  .object({
    metrics: z.unknown(),
    dimensions: z.unknown().optional(),
    range: z.unknown(),
    locationId: z.unknown().optional(),
    limit: z.unknown().optional(),
  })
  .strict()
  .superRefine((body, context) => {
    const add = (path: string, message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    // ── metrics: 1..10 unique known ids ────────────────────────────────────
    const metrics: string[] = [];
    if (!Array.isArray(body.metrics)) {
      add('metrics', 'A metric list is required.');
    } else {
      if (body.metrics.length < 1 || body.metrics.length > 10)
        add('metrics', 'A query takes between 1 and 10 metrics.');
      const seen = new Set<string>();
      for (const value of body.metrics) {
        if (typeof value !== 'string' || !METRIC_ID_SET.has(value)) {
          add('metrics', 'A metric id is unknown.');
          continue;
        }
        if (seen.has(value)) {
          add('metrics', 'A metric id is repeated.');
          continue;
        }
        seen.add(value);
        metrics.push(value);
      }
    }

    // ── dimensions: 0..2 unique known ids ──────────────────────────────────
    const dimensions: string[] = [];
    if (body.dimensions !== undefined) {
      if (!Array.isArray(body.dimensions)) {
        add('dimensions', 'A dimension list is required when the field is present.');
      } else {
        if (body.dimensions.length > 2) add('dimensions', 'A query takes at most 2 dimensions.');
        const seen = new Set<string>();
        for (const value of body.dimensions) {
          if (typeof value !== 'string' || !DIMENSION_ID_SET.has(value)) {
            add('dimensions', 'A dimension id is unknown.');
            continue;
          }
          if (seen.has(value)) {
            add('dimensions', 'A dimension id is repeated.');
            continue;
          }
          seen.add(value);
          dimensions.push(value);
        }
      }
    }

    // ── metric × dimension compatibility ───────────────────────────────────
    if (metrics.length > 0 && dimensions.length > 0) {
      for (const metric of metrics) {
        const accepted = METRIC_DIMENSIONS_BY_ID[metric as MetricsId];
        if (!accepted) continue;
        if (accepted.length === 0) {
          add('dimensions', `Metric ${metric} accepts no dimension.`);
          break;
        }
        if (dimensions.some((dimension) => !accepted.includes(dimension as MetricsDimension))) {
          add('dimensions', `Metric ${metric} does not accept one of the requested dimensions.`);
          break;
        }
      }
    }

    // ── range ──────────────────────────────────────────────────────────────
    if (typeof body.range !== 'string' || !RANGE_SET.has(body.range))
      add('range', 'The range is not one of the four supported values.');

    // ── locationId ─────────────────────────────────────────────────────────
    if (body.locationId !== undefined) {
      if (typeof body.locationId !== 'string' || !UUID_PATTERN.test(body.locationId))
        add('locationId', 'The location id is not a UUID.');
    }

    // ── limit: only with dimensions, integer 1..1000 ───────────────────────
    if (body.limit !== undefined) {
      if (
        typeof body.limit !== 'number' ||
        !Number.isInteger(body.limit) ||
        body.limit < 1 ||
        body.limit > 1000
      )
        add('limit', 'The limit is not an integer between 1 and 1000.');
      if (dimensions.length === 0) add('limit', 'A limit requires at least one dimension.');
    }
  })
  // An omitted dimension list is the documented default. The refine proves the
  // values; the transform writes the default so the controller never sees
  // `undefined`.
  .transform((body) => ({
    ...body,
    dimensions: Array.isArray(body.dimensions) ? body.dimensions : [],
  })) as unknown as z.ZodType<MetricsQueryInput>;

// ── Response ────────────────────────────────────────────────────────────────

const DistributionLimit = z.number().int().positive();

export const MetricsPaymentItem = z
  .object({
    method: z.string().min(1).max(40),
    amountMinorUnits: z.number().int(),
  })
  .strict();
export const MetricsChannelItem = z
  .object({
    channel: z.string().min(1).max(40),
    netSalesMinorUnits: z.number().int(),
    orders: z.number().int().nonnegative(),
  })
  .strict();
export const MetricsProductItem = z
  .object({
    productId: Uuid.nullable(),
    productName: z.string().min(1).max(240),
    category: z.string().max(240).nullable(),
    units: z.number().int(),
    merchandiseMinorUnits: z.number().int(),
  })
  .strict();
export const MetricsOperatorItem = z
  .object({
    operator: z.string().min(1).max(240),
    units: z.number().int(),
    merchandiseMinorUnits: z.number().int(),
  })
  .strict();
export const MetricsHourItem = z
  .object({
    hour: z.string().length(2),
    units: z.number().int(),
    merchandiseMinorUnits: z.number().int(),
  })
  .strict();
export const MetricsSeriesItem = z
  .object({
    label: z.string().min(1).max(24),
    netSalesMinorUnits: z.number().int(),
  })
  .strict();

const envelope = <Item extends z.ZodTypeAny, Total extends z.ZodTypeAny>(
  item: Item,
  total: Total,
) =>
  z
    .object({
      items: z.array(item),
      truncated: z.boolean(),
      limit: DistributionLimit,
      totalItems: z.number().int().nonnegative(),
      total,
    })
    .strict();

export const MetricsPaymentDistribution = envelope(
  MetricsPaymentItem,
  z.object({ amountMinorUnits: z.number().int() }).strict(),
);
export const MetricsChannelDistribution = envelope(
  MetricsChannelItem,
  z
    .object({
      netSalesMinorUnits: z.number().int(),
      orders: z.number().int().nonnegative(),
    })
    .strict(),
);
export const MetricsProductDistribution = envelope(
  MetricsProductItem,
  z
    .object({
      units: z.number().int(),
      merchandiseMinorUnits: z.number().int(),
    })
    .strict(),
);
export const MetricsOperatorDistribution = envelope(
  MetricsOperatorItem,
  z
    .object({
      units: z.number().int(),
      merchandiseMinorUnits: z.number().int(),
    })
    .strict(),
);
export const MetricsHourDistribution = envelope(
  MetricsHourItem,
  z
    .object({
      units: z.number().int(),
      merchandiseMinorUnits: z.number().int(),
    })
    .strict(),
);
export const MetricsSeriesDistribution = envelope(
  MetricsSeriesItem,
  z.object({ netSalesMinorUnits: z.number().int() }).strict(),
);

/**
 * A metric value. A scalar is a number, and the only null is
 * `units_per_ticket` with no orders. A preset is its own distribution envelope.
 */
export const MetricsValue = z.union([
  z.number(),
  z.null(),
  MetricsPaymentDistribution,
  MetricsChannelDistribution,
  MetricsProductDistribution,
  MetricsOperatorDistribution,
  MetricsHourDistribution,
  MetricsSeriesDistribution,
]);
export type MetricsValue = z.infer<typeof MetricsValue>;

export const MetricsRow = z
  .object({
    dimensions: z.record(z.string()),
    values: z.record(MetricsValue),
  })
  .strict();
export const MetricsTotals = z.object({ values: z.record(MetricsValue) }).strict();

export const MetricsScope = z
  .object({
    merchantId: Uuid,
    locationId: Uuid.nullable(),
    currency: CurrencyCode.nullable(),
    timezone: z.string().min(1).max(64),
    // v1 reads the current category of a product. It is not an at-sale snapshot;
    // the field makes that limitation part of the contract.
    attribution: z.object({ category: z.literal('current') }).strict(),
  })
  .strict();

export const MetricsPeriod = z
  .object({
    range: MetricsRange,
    start: MerchantDate,
    end: MerchantDate,
    bucket: z.enum(['day', 'hour']),
    comparison: z.object({ start: MerchantDate, end: MerchantDate }).strict(),
  })
  .strict();

export const MetricsCoverage = z
  .object({
    sources: z.array(z.string().min(1).max(64)).max(12),
    committedOnly: z.literal(true),
    refundsIncluded: z.boolean(),
  })
  .strict();

/**
 * The narrative request and response. The request names the same period and
 * location as the summary. The response keeps the old fail-safe shape: a null
 * narrative hides the card, and a model failure never blocks the summary.
 */
export const MetricsInsightQuery = z
  .object({
    range: MetricsRange,
    locationId: Uuid.optional(),
  })
  .strict();
export type MetricsInsightQuery = z.infer<typeof MetricsInsightQuery>;

export const MetricsInsightResponse = z
  .object({
    narrative: z.string().max(600).nullable(),
    generated: z.boolean(),
    capturedAt: IsoTimestamp,
  })
  .strict();
export type MetricsInsightResponse = z.infer<typeof MetricsInsightResponse>;

export const MetricsResponse = z
  .object({
    definitionVersion: z.literal('1.0.0'),
    scope: MetricsScope,
    period: MetricsPeriod,
    coverage: MetricsCoverage,
    freshness: z.object({ capturedAt: IsoTimestamp }).strict(),
    truncated: z.boolean(),
    /** Present only when a row cut happened: the count before the cut. */
    rowsTotal: z.number().int().nonnegative().optional(),
    rows: z.array(MetricsRow).max(1000).optional(),
    totals: MetricsTotals.optional(),
  })
  .strict()
  .superRefine((response, context) => {
    if ((response.rows === undefined) === (response.totals === undefined))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rows'],
        message: 'Exactly one of rows or totals is required.',
      });
  });
export type MetricsResponse = z.infer<typeof MetricsResponse>;

export const metricsModels = {
  MetricsQuery,
  MetricsId,
  MetricsDimension,
  MetricsRange,
  MetricsPaymentItem,
  MetricsChannelItem,
  MetricsProductItem,
  MetricsOperatorItem,
  MetricsHourItem,
  MetricsSeriesItem,
  MetricsPaymentDistribution,
  MetricsChannelDistribution,
  MetricsProductDistribution,
  MetricsOperatorDistribution,
  MetricsHourDistribution,
  MetricsSeriesDistribution,
  MetricsValue,
  MetricsRow,
  MetricsTotals,
  MetricsScope,
  MetricsPeriod,
  MetricsCoverage,
  MetricsResponse,
  MetricsInsightQuery,
  MetricsInsightResponse,
} as const;
