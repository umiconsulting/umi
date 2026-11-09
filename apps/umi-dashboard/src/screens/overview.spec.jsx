import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n.jsx';
import OverviewScreen from './overview.jsx';

const state = vi.hoisted(() => ({
  options: {
    data: { today: '2026-11-07', locations: [], canCompareLocations: true },
    loading: false,
  },
  report: { data: null, loading: false, error: null },
  context: {
    selectedMerchantId: 'merchant',
    selectedLocationId: '',
    capabilities: { membership: { permissions: ['sale.lifecycle'] } },
  },
}));
vi.mock('@/data.jsx', () => ({
  useOverviewData: () => ({
    data: { overview: { revenueThisMonth: 900000 }, stations: [], ticker: [] },
    loading: false,
  }),
  useSalesAnalysisOptions: () => state.options,
  useSalesAnalysis: () => state.report,
}));
vi.mock('@/lib/merchant-context.jsx', () => ({ useMerchant: () => state.context }));
vi.mock('@/shell.jsx', () => ({ RegionHead: ({ title }) => <h2>{title}</h2> }));
const render = () =>
  renderToStaticMarkup(
    withI18n(
      <StaticRouter location="/">
        <OverviewScreen onNavigate={() => {}} />
      </StaticRouter>,
    ),
  );
const report = (overrides = {}) => ({
  totals: {
    tickets: 2,
    units: 3,
    merchandiseMinorUnits: 10000,
    refundsMinorUnits: 0,
    netMinorUnits: 10000,
    averageTicketMinorUnits: 5000,
    unitsPerTicket: 1.5,
    tipsMinorUnits: 0,
    discountsMinorUnits: 0,
  },
  from: '2026-11-01',
  to: '2026-11-07',
  timezone: 'America/Mazatlan',
  currency: 'MXN',
  capturedAt: '2026-11-07T12:00:00.000Z',
  firstSaleDate: '2026-11-01',
  byHour: [],
  byDay: [],
  byWeekday: [],
  byMonth: [],
  byLocation: [],
  byCategory: [],
  coverage: { baskets: 2, ticketsWithoutProducts: 0, legacyDiscountTickets: 0 },
  unitsDistribution: [],
  pairs: [],
  selectedGroups: {
    a: null,
    b: null,
    basketsWithA: 0,
    basketsWithB: 0,
    basketsWithBoth: 0,
    support: null,
    confidenceAtoB: null,
    lift: null,
    overlappingProducts: 0,
  },
  basketState: { state: 'complete', code: null },
  ...overrides,
});
const loaded = (data, extra = {}) => ({
  data,
  loading: false,
  refreshing: false,
  error: null,
  refreshError: false,
  dataUpdatedAt: Date.parse('2026-11-07T12:00:00.000Z'),
  refetch: () => {},
  ...extra,
});

describe('Business overview', () => {
  beforeEach(() => {
    globalThis.window = { localStorage: { getItem: () => null } };
    state.report = { data: null, loading: false, error: null };
    state.context.capabilities.membership.permissions = ['sale.lifecycle'];
  });
  it('shows a report error with recovery instead of wallet revenue or a false zero', () => {
    state.report.error = 'Failed to fetch';
    const html = render();
    expect(html).toContain('role="alert"');
    expect(html).toContain('Reintentar');
    expect(html).not.toContain('Ingresos del mes');
    expect(html).not.toContain('900000');
    expect(html).not.toContain('Nada pendiente');
  });
  it('announces loading without displaying revenue from the previous context', () => {
    state.report.loading = true;
    expect(render()).toContain('role="status"');
    expect(render()).not.toContain('900000');
  });
  it('does not show financial reports to a user without sales permission', () => {
    state.context.capabilities.membership.permissions = ['kitchen.read'];
    expect(render()).not.toContain('Venta neta');
  });
  it('keeps the current values when a refresh fails', () => {
    state.report = loaded(report(), { error: 'Failed to fetch', refreshError: true });
    const html = render();
    expect(html).toContain('Venta neta');
    expect(html).toContain('No se pudo actualizar');
    expect(html).not.toContain('No se pudieron cargar las ventas');
  });
  it('shows a distinct no-tickets state and a zero-sales state', () => {
    state.report = loaded(
      report({
        totals: {
          ...report().totals,
          tickets: 0,
          netMinorUnits: 0,
          averageTicketMinorUnits: null,
          unitsPerTicket: null,
        },
      }),
    );
    expect(render()).toContain('No hay tickets de venta en este periodo.');
    state.report = loaded(
      report({
        totals: {
          ...report().totals,
          tickets: 0,
          refundsMinorUnits: 17000,
          netMinorUnits: -17000,
          averageTicketMinorUnits: null,
          unitsPerTicket: null,
        },
      }),
    );
    const refundOnly = render();
    expect(refundOnly).not.toContain('No hay tickets de venta en este periodo.');
    expect(refundOnly).toContain('Sin tickets para calcular');
  });
  it('keeps totals and categories when the affinity capability is unavailable', () => {
    state.report = loaded(
      report({
        basketState: { state: 'unavailable', code: 'BASKETS_TOO_COMPLEX' },
        coverage: undefined,
        unitsDistribution: undefined,
        pairs: undefined,
        selectedGroups: undefined,
      }),
    );
    const html = render();
    expect(html).toContain('Venta neta');
    expect(html).toContain('La afinidad de compras no está disponible');
    expect(html).toContain('Reintentar análisis');
  });
  it('lists the known gaps as partial coverage', () => {
    state.report = loaded(
      report({ coverage: { baskets: 2, ticketsWithoutProducts: 3, legacyDiscountTickets: 1 } }),
    );
    const html = render();
    expect(html).toContain('Cobertura parcial');
    expect(html).toContain('3 tickets carecen de productos identificados');
    expect(html).toContain('1 tickets usan un descuento anterior');
    expect(html).toContain('Venta neta');
  });
  it('shows the stale label when the last success is older than sixty seconds', () => {
    state.report = loaded(report(), { dataUpdatedAt: Date.now() - 120_000 });
    const html = render();
    expect(html).toContain('Datos de las');
    expect(html).toContain('Actualiza para ver el estado actual');
    expect(html).toContain('Venta neta');
  });
  it('uses the region h2 and one primary action before the widget grid', () => {
    state.report = loaded(report());
    const html = render();
    expect(html).toContain('<h2>Tu negocio en números</h2>');
    expect(html.indexOf('Explorar ventas')).toBeLessThan(html.indexOf('sales-widget-grid'));
    expect((html.match(/btn-primary/g) || []).length).toBe(1);
  });
});
