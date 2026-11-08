export function shiftReportDate(day, days) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function reportPeriod(today, days) {
  return { from: shiftReportDate(today, 1 - days), to: today };
}

export function previousReportPeriod({ from, to }) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  return { from: shiftReportDate(from, -days), to: shiftReportDate(from, -1) };
}

export function salesReportLink(query, section = 'overview') {
  const params = new URLSearchParams(
    Object.entries({ ...query, section }).filter(([, value]) => value != null && value !== ''),
  );
  return `/reportes?${params}`;
}

export function initialAnalysisQuery(options, locationId, params = new URLSearchParams()) {
  const fallback = reportPeriod(options.today, 7);
  const from = params.get('from');
  const to = params.get('to');
  const validDays = /^\d{4}-\d{2}-\d{2}$/;
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  const valid =
    validDays.test(from) && validDays.test(to) && days >= 0 && days <= 730 && to <= options.today;
  const requestedLocation = params.get('locationId') ?? locationId;
  const allowedLocation = options.locations.some((location) => location.id === requestedLocation);
  return {
    ...(valid ? { from, to } : fallback),
    locationId: allowedLocation
      ? requestedLocation
      : options.canCompareLocations
        ? ''
        : (options.locations[0]?.id ?? ''),
    refundView:
      params.get('refundView') === 'period_movements' ? 'period_movements' : 'sale_result',
    basketUnit: params.get('basketUnit') === 'table_visit' ? 'table_visit' : 'ticket',
    groupA: params.get('groupA') || '',
    groupB: params.get('groupB') || '',
  };
}

export const DEFAULT_WIDGETS = [
  'net',
  'tickets',
  'average',
  'units',
  'trend',
  'categories',
  'hours',
  'pairs',
];
export const AVAILABLE_WIDGETS = [...DEFAULT_WIDGETS, 'distribution'];

export function loadWidgetPreferences(storage, key) {
  try {
    const saved = JSON.parse(storage.getItem(key));
    if (!Array.isArray(saved)) return DEFAULT_WIDGETS;
    return [...new Set(saved.filter((id) => AVAILABLE_WIDGETS.includes(id)))];
  } catch {
    return DEFAULT_WIDGETS;
  }
}

export function dailySalesRows(report) {
  const observed = new Map(report.byDay.map((row) => [row.key, row]));
  const rows = [];
  for (let day = report.from; day <= report.to; day = shiftReportDate(day, 1)) {
    rows.push(observed.get(day) ?? { key: day, label: day, netMinorUnits: 0 });
  }
  return rows;
}
