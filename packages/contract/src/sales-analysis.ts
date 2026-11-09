import { z } from 'zod';
import { IsoTimestamp, Uuid } from './platform';

const Day = z.string().date();
const Amount = z.number().int().safe();
const Count = z.number().int().nonnegative().safe();
const Ratio = z.number().finite().nullable();

export const SalesAnalysisQuery = z
  .object({
    from: Day,
    to: Day,
    locationId: Uuid.optional(),
    refundView: z.enum(['sale_result', 'period_movements']).default('sale_result'),
    basketUnit: z.enum(['ticket', 'table_visit']).default('ticket'),
    groupA: z.string().max(80).optional(),
    groupB: z.string().max(80).optional(),
  })
  .strict()
  .superRefine((query, context) => {
    const days = (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000;
    if (days < 0 || days > 730) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'Elige un periodo de hasta 731 días, con inicio anterior al fin.',
      });
    }
  });
export type SalesAnalysisQuery = z.infer<typeof SalesAnalysisQuery>;

export const SalesAnalysisGroupInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    productIds: z
      .array(Uuid)
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, 'Cada producto aparece una sola vez.'),
  })
  .strict();
export type SalesAnalysisGroupInput = z.infer<typeof SalesAnalysisGroupInput>;
export const SalesAnalysisGroupWrite = SalesAnalysisGroupInput.extend({ expectedVersion: Count });
export type SalesAnalysisGroupWrite = z.infer<typeof SalesAnalysisGroupWrite>;

export const SalesAnalysisGroup = SalesAnalysisGroupInput.extend({
  id: Uuid,
  version: Count,
  productIds: z.array(Uuid).max(500),
});
export type SalesAnalysisGroup = z.infer<typeof SalesAnalysisGroup>;
const Product = z
  .object({
    id: Uuid,
    name: z.string(),
    categoryId: Uuid.nullable(),
    category: z.string().nullable(),
  })
  .strict();
export const SalesAnalysisOptions = z
  .object({
    timezone: z.string(),
    today: Day,
    firstSaleDate: Day.nullable(),
    products: z.array(Product).max(5000),
    groups: z.array(SalesAnalysisGroup).max(200),
    canManageGroups: z.boolean(),
    canCompareLocations: z.boolean(),
    locations: z.array(z.object({ id: Uuid, name: z.string() }).strict()),
  })
  .strict();
export type SalesAnalysisOptions = z.infer<typeof SalesAnalysisOptions>;

const Metrics = z
  .object({
    tickets: Count,
    units: Amount,
    merchandiseMinorUnits: Amount,
    refundsMinorUnits: Amount,
    netMinorUnits: Amount,
    averageTicketMinorUnits: Ratio,
    unitsPerTicket: Ratio,
    tipsMinorUnits: Amount,
    discountsMinorUnits: Amount,
  })
  .strict();
export type SalesAnalysisMetrics = z.infer<typeof Metrics>;

const Dimension = Metrics.extend({ key: z.string(), label: z.string() });
export const SalesAnalysisCategory = z
  .object({
    key: z.string().max(100),
    categoryId: Uuid.nullable(),
    label: z.string().nullable(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable(),
    merchandiseMinorUnits: Amount,
    refundsMinorUnits: Amount,
    netMinorUnits: Amount,
  })
  .strict();
export type SalesAnalysisCategory = z.infer<typeof SalesAnalysisCategory>;
const Pair = z
  .object({
    productAId: Uuid,
    productAName: z.string(),
    productBId: Uuid,
    productBName: z.string(),
    baskets: Count,
    basketsWithA: Count,
    basketsWithB: Count,
    support: Ratio,
    confidenceAtoB: Ratio,
    confidenceBtoA: Ratio,
    lift: Ratio,
  })
  .strict();

export const SalesAnalysisBasketState = z
  .object({
    state: z.enum(['complete', 'unavailable']),
    code: z.enum(['BASKETS_TOO_COMPLEX']).nullable(),
  })
  .strict();
export type SalesAnalysisBasketState = z.infer<typeof SalesAnalysisBasketState>;

export const SalesAnalysis = z
  .object({
    merchantId: Uuid,
    locationId: Uuid.nullable(),
    from: Day,
    to: Day,
    timezone: z.string(),
    currency: z.string(),
    refundView: z.enum(['sale_result', 'period_movements']),
    basketUnit: z.enum(['ticket', 'table_visit']),
    capturedAt: IsoTimestamp,
    firstSaleDate: Day.nullable(),
    totals: Metrics,
    byHour: z.array(Dimension).max(24),
    byDay: z.array(Dimension).max(731),
    byWeekday: z.array(Dimension).max(7),
    byMonth: z.array(Dimension).max(25),
    byLocation: z.array(Dimension).max(1000),
    byCategory: z.array(SalesAnalysisCategory).max(5002).optional(),
    basketState: SalesAnalysisBasketState.optional(),
    coverage: z
      .object({
        baskets: Count,
        ticketsWithVisit: Count,
        ticketsWithoutVisit: Count,
        ticketsWithoutProducts: Count,
        refundedUnits: Count,
        legacyDiscountTickets: Count,
        pairsAvailable: Count,
        categoriesUseCurrentCatalog: z.literal(true),
      })
      .strict()
      .optional(),
    unitsDistribution: z
      .array(z.object({ units: Count, tickets: Count }).strict())
      .max(20000)
      .optional(),
    pairs: z.array(Pair).max(100).optional(),
    selectedGroups: z
      .object({
        a: z.string().nullable(),
        b: z.string().nullable(),
        basketsWithA: Count,
        basketsWithB: Count,
        basketsWithBoth: Count,
        support: Ratio,
        confidenceAtoB: Ratio,
        lift: Ratio,
        overlappingProducts: Count,
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((report, context) => {
    const basketFields = ['coverage', 'unitsDistribution', 'pairs', 'selectedGroups'] as const;
    const missing = basketFields.filter((key) => report[key] === undefined);
    const present = basketFields.filter((key) => report[key] !== undefined);
    if (!report.basketState) {
      if (missing.length)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['basketState'],
          message: 'basketState is required when a basket field is absent',
        });
      return;
    }
    if (report.basketState.state === 'complete') {
      if (report.basketState.code !== null)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['basketState', 'code'],
          message: 'A complete basketState requires code null',
        });
      if (missing.length)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['basketState'],
          message: 'A complete basketState requires all four basket fields',
        });
      return;
    }
    if (report.basketState.code !== 'BASKETS_TOO_COMPLEX')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['basketState', 'code'],
        message: 'An unavailable basketState requires code BASKETS_TOO_COMPLEX',
      });
    if (present.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['basketState'],
        message: 'An unavailable basketState requires no basket fields',
      });
  });
export type SalesAnalysis = z.infer<typeof SalesAnalysis>;

export const SalesAnalysisOptionsQuery = z.object({ locationId: Uuid.optional() }).strict();
export const SalesAnalysisDeleteQuery = z
  .object({ expectedVersion: z.coerce.number().int().positive() })
  .strict();
export const SalesAnalysisGroupDeleted = z.object({ deleted: z.literal(true) }).strict();
export const salesAnalysisModels = {
  SalesAnalysisOptionsQuery,
  SalesAnalysisDeleteQuery,
  SalesAnalysisGroupDeleted,
  SalesAnalysisQuery,
  SalesAnalysisGroupInput,
  SalesAnalysisGroupWrite,
  SalesAnalysisGroup,
  SalesAnalysisOptions,
  SalesAnalysisBasketState,
  SalesAnalysis,
} as const;
