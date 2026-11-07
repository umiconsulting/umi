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

function metricEvents(sales: AnalysisSale[], query: SalesAnalysisQuery): MetricEvent[] {
  return sales.flatMap((sale) => {
    const purchased = within(sale.day, query);
    const events = purchased ? [saleEvent(sale)] : [];
    for (const refund of sale.refunds) {
      const included = query.refundView === 'sale_result' ? purchased : within(refund.day, query);
      if (included) events.push(refundEvent(sale, refund, query));
    }
    return events;
  });
}

function summarizeDimension(
  events: MetricEvent[],
  keyOf: (event: MetricEvent) => string,
  labelOf = keyOf,
) {
  const groups = new Map<string, { label: string; metrics: MetricAccumulator }>();
  for (const event of events) {
    const key = keyOf(event);
    let group = groups.get(key);
    if (!group) {
      group = { label: labelOf(event), metrics: emptyMetrics() };
      groups.set(key, group);
    }
    addMetrics(group.metrics, event);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => ({ key, label: group.label, ...finishMetrics(group.metrics) }));
}

export function analyzePurchases(
  sales: AnalysisSale[],
  query: SalesAnalysisQuery,
  groups: AnalysisGroup[],
) {
  const events = metricEvents(sales, query);
  const totals = emptyMetrics();
  for (const event of events) addMetrics(totals, event);
  return {
    ...analyzeBaskets(sales, query, groups),
    totals: finishMetrics(totals),
    byHour: summarizeDimension(events, (event) => event.hour),
    byDay: summarizeDimension(events, (event) => event.day),
    byWeekday: summarizeDimension(events, (event) => event.weekday),
    byMonth: summarizeDimension(events, (event) => event.day.slice(0, 7)),
    byLocation: summarizeDimension(
      events,
      (event) => event.locationId,
      (event) => event.locationName,
    ),
  };
}
