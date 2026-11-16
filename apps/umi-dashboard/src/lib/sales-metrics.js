// The sales summary view model over the semantic metrics route.
//
// The screen keeps its current field names. This adapter owns the two requests
// that replace `GET reports/sales`: one for the seven scalars and one for the
// six presets. It also maps the preset envelopes to the old array shape.
//
// A preset accepts no dimension, so both requests send `dimensions: []`. The
// public request limit is ten metrics; A has seven and B has six.

export const SALES_SCALAR_METRICS = [
  'net_sales',
  'orders',
  'average_ticket',
  'items_sold',
  'discounts',
  'tips',
  'prior_net_sales',
];

export const SALES_PRESET_METRICS = [
  'payment_mix',
  'channel_mix',
  'product_mix',
  'operator_mix',
  'hour_mix',
  'series',
];

export const SALES_INSIGHT_METRICS = [
  'net_sales',
  'orders',
  'average_ticket',
  'tips',
  'discounts',
  'prior_net_sales',
  'payment_mix',
  'product_mix',
];

function requestBody(metrics, range, locationId) {
  const body = {
    metrics,
    dimensions: [],
    range: range || 'today',
  };
  if (locationId) body.locationId = locationId;
  return body;
}

export function buildSalesMetricsRequests(range, locationId) {
  return [
    requestBody(SALES_SCALAR_METRICS, range, locationId),
    requestBody(SALES_PRESET_METRICS, range, locationId),
  ];
}

export function buildSalesInsightRequest(range, locationId) {
  const body = { range: range || 'today' };
  if (locationId) body.locationId = locationId;
  return body;
}

function valuesOf(response) {
  return response?.totals?.values ?? {};
}

function itemsOf(value) {
  return Array.isArray(value?.items) ? value.items : [];
}

function number(value) {
  return Number(value ?? 0);
}

/**
 * Build the old sales summary view model from the two responses.
 * The function does not round, scale, or reorder a value. The screen keeps
 * its own formatting and its own pivot sort.
 */
export function adaptSalesSummary(scalars, presets) {
  const a = valuesOf(scalars);
  const b = valuesOf(presets);
  return {
    merchantId: presets?.scope?.merchantId ?? scalars?.scope?.merchantId ?? null,
    locationId: presets?.scope?.locationId ?? scalars?.scope?.locationId ?? null,
    range: presets?.period?.range ?? scalars?.period?.range ?? 'today',
    currency:
      presets?.scope?.currency !== undefined
        ? presets.scope.currency
        : (scalars?.scope?.currency ?? null),
    bucket: presets?.period?.bucket ?? 'day',
    totals: {
      netSalesMinorUnits: number(a.net_sales),
      orders: number(a.orders),
      averageTicketMinorUnits: number(a.average_ticket),
      itemsSold: number(a.items_sold),
      discountMinorUnits: number(a.discounts),
      tipsMinorUnits: number(a.tips),
      priorNetSalesMinorUnits: number(a.prior_net_sales),
    },
    paymentMix: itemsOf(b.payment_mix).map((item) => ({
      method: item.method,
      amountMinorUnits: number(item.amountMinorUnits),
    })),
    channelMix: itemsOf(b.channel_mix).map((item) => ({
      channel: item.channel,
      netSalesMinorUnits: number(item.netSalesMinorUnits),
      orders: number(item.orders),
    })),
    productMix: itemsOf(b.product_mix).map((item) => ({
      productId: item.productId ?? null,
      productName: item.productName,
      category: item.category ?? null,
      units: number(item.units),
      netMinorUnits: number(item.merchandiseMinorUnits),
    })),
    byOperator: itemsOf(b.operator_mix).map((item) => ({
      key: item.operator,
      units: number(item.units),
      netMinorUnits: number(item.merchandiseMinorUnits),
    })),
    byHour: itemsOf(b.hour_mix).map((item) => ({
      key: item.hour,
      units: number(item.units),
      netMinorUnits: number(item.merchandiseMinorUnits),
    })),
    series: itemsOf(b.series).map((item) => ({
      label: item.label,
      amountMinorUnits: number(item.netSalesMinorUnits),
    })),
    capturedAt: presets?.freshness?.capturedAt ?? scalars?.freshness?.capturedAt ?? null,
    truncated: Boolean(presets?.truncated || scalars?.truncated),
  };
}
