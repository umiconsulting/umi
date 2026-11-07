import type { SalesAnalysisMetrics, SalesAnalysisQuery } from '@umi/contract';
import { analyzeBaskets } from './purchase-baskets';

export interface AnalysisLine {
  id: string;
  productId: string | null;
  name: string;
  quantity: number;
  merchandiseMinorUnits?: number | null;
}

export interface AnalysisRefund {
  id: string;
  day: string;
  hour: string;
  weekday: string;
  merchandiseMinorUnits: number;
  tipsMinorUnits: number;
  quantities: { lineId: string; quantity: number; merchandiseMinorUnits?: number | null }[];
}

export interface AnalysisSale {
  id: string;
  locationId: string;
  locationName: string;
  day: string;
  hour: string;
  weekday: string;
  visitId: string | null;
  merchandiseMinorUnits: number;
  tipsMinorUnits: number;
  discountsMinorUnits: number;
  legacyDiscount: boolean;
  lines: AnalysisLine[];
  refunds: AnalysisRefund[];
}

export interface AnalysisGroup {
  key: string;
  name: string;
  productIds: string[];
}

interface MetricAccumulator {
  tickets: number;
  units: number;
  merchandiseMinorUnits: number;
  refundsMinorUnits: number;
  tipsMinorUnits: number;
  discountsMinorUnits: number;
}

interface MetricEvent extends MetricAccumulator {
  day: string;
  hour: string;
  weekday: string;
  locationId: string;
  locationName: string;
}

const emptyMetrics = (): MetricAccumulator => ({
  tickets: 0,
  units: 0,
  merchandiseMinorUnits: 0,
  refundsMinorUnits: 0,
  tipsMinorUnits: 0,
  discountsMinorUnits: 0,
});
const within = (day: string, query: SalesAnalysisQuery) => day >= query.from && day <= query.to;
const totalUnits = (lines: AnalysisLine[]) => lines.reduce((sum, line) => sum + line.quantity, 0);

function addMetrics(total: MetricAccumulator, entry: MetricAccumulator): void {
  for (const key of Object.keys(total) as (keyof MetricAccumulator)[]) {
    total[key] += entry[key];
    if (!Number.isSafeInteger(total[key])) throw new RangeError('REPORT_AMOUNT_OUT_OF_RANGE');
  }
}

function finishMetrics(total: MetricAccumulator): SalesAnalysisMetrics {
  const netMinorUnits = total.merchandiseMinorUnits - total.refundsMinorUnits;
  if (!Number.isSafeInteger(netMinorUnits)) throw new RangeError('REPORT_AMOUNT_OUT_OF_RANGE');
  return {
    ...total,
    netMinorUnits,
    averageTicketMinorUnits: total.tickets ? Math.round(netMinorUnits / total.tickets) : null,
    unitsPerTicket: total.tickets ? total.units / total.tickets : null,
  };
}

function saleEvent(sale: AnalysisSale): MetricEvent {
  return {
    ...emptyMetrics(),
    day: sale.day,
    hour: sale.hour,
    weekday: sale.weekday,
    locationId: sale.locationId,
    locationName: sale.locationName,
    tickets: 1,
    units: totalUnits(sale.lines),
    merchandiseMinorUnits: sale.merchandiseMinorUnits,
    tipsMinorUnits: sale.tipsMinorUnits,
    discountsMinorUnits: sale.discountsMinorUnits,
  };
}

function refundEvent(
  sale: AnalysisSale,
  refund: AnalysisRefund,
  query: SalesAnalysisQuery,
): MetricEvent {
  const date = query.refundView === 'sale_result' ? sale : refund;
  return {
    ...emptyMetrics(),
    day: date.day,
    hour: date.hour,
    weekday: date.weekday,
    locationId: sale.locationId,
    locationName: sale.locationName,
    units: -refund.quantities.reduce((sum, line) => sum + line.quantity, 0),
    refundsMinorUnits: refund.merchandiseMinorUnits,
    tipsMinorUnits: -refund.tipsMinorUnits,
  };
}

function* metricEvents(sales: AnalysisSale[], query: SalesAnalysisQuery): Generator<MetricEvent> {
  for (const sale of sales) {
    const purchased = within(sale.day, query);
    if (purchased) yield saleEvent(sale);
    for (const refund of sale.refunds) {
      const included = query.refundView === 'sale_result' ? purchased : within(refund.day, query);
      if (included) yield refundEvent(sale, refund, query);
    }
  }
}

type MetricGroups = Map<string, { label: string; metrics: MetricAccumulator }>;

function addDimension(groups: MetricGroups, key: string, event: MetricEvent, label = key) {
  let group = groups.get(key);
  if (!group) {
    group = { label, metrics: emptyMetrics() };
    groups.set(key, group);
  }
  addMetrics(group.metrics, event);
}

function finishDimension(groups: MetricGroups) {
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => ({ key, label: group.label, ...finishMetrics(group.metrics) }));
}

export function analyzePurchases(
  sales: AnalysisSale[],
  query: SalesAnalysisQuery,
  groups: AnalysisGroup[],
) {
  const totals = emptyMetrics();
  const byHour: MetricGroups = new Map();
  const byDay: MetricGroups = new Map();
  const byWeekday: MetricGroups = new Map();
  const byMonth: MetricGroups = new Map();
  const byLocation: MetricGroups = new Map();
  for (const event of metricEvents(sales, query)) {
    addMetrics(totals, event);
    addDimension(byHour, event.hour, event);
    addDimension(byDay, event.day, event);
    addDimension(byWeekday, event.weekday, event);
    addDimension(byMonth, event.day.slice(0, 7), event);
    addDimension(byLocation, event.locationId, event, event.locationName);
  }
  return {
    ...analyzeBaskets(sales, query, groups),
    totals: finishMetrics(totals),
    byHour: finishDimension(byHour),
    byDay: finishDimension(byDay),
    byWeekday: finishDimension(byWeekday),
    byMonth: finishDimension(byMonth),
    byLocation: finishDimension(byLocation),
  };
}
