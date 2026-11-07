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
});
