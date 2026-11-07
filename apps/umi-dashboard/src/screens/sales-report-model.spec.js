import { describe, expect, it } from 'vitest';
import {
  initialAnalysisQuery,
  previousReportPeriod,
  loadWidgetPreferences,
  salesReportLink,
} from './sales-report-model.js';

const options = {
  today: '2026-11-07',
  canCompareLocations: true,
  locations: [{ id: 'branch-a' }, { id: 'branch-b' }],
};
describe('Sales report context', () => {
  it('starts with the selected branch and seven dates from the server', () => {
    expect(initialAnalysisQuery(options, 'branch-b')).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-07',
      locationId: 'branch-b',
    });
  });
  it('preserves the explicit scope and dates of a widget drill-down', () => {
    const url = salesReportLink(
      { from: '2026-10-01', to: '2026-10-31', locationId: 'branch-a', refundView: 'sale_result' },
      'hours',
    );
    expect(
      initialAnalysisQuery(options, 'branch-b', new URL(url, 'http://local').searchParams),
    ).toMatchObject({ from: '2026-10-01', to: '2026-10-31', locationId: 'branch-a' });
  });
  it('rejects a foreign branch and an inverted period', () => {
    const query = initialAnalysisQuery(
      { ...options, canCompareLocations: false, locations: [{ id: 'branch-a' }] },
      '',
      new URLSearchParams('from=2026-11-07&to=2026-11-01&locationId=foreign'),
    );
    expect(query).toMatchObject({ from: '2026-11-01', to: '2026-11-07', locationId: 'branch-a' });
  });
  it('compares equal inclusive periods across a year boundary', () => {
    expect(previousReportPeriod({ from: '2026-01-01', to: '2026-01-07' })).toEqual({
      from: '2025-12-25',
      to: '2025-12-31',
    });
  });
});
describe('Widget preferences', () => {
  it('preserves an empty custom dashboard', () => {
    expect(loadWidgetPreferences({ getItem: () => '[]' }, 'key')).toEqual([]);
  });
  it('ignores unknown widgets and duplicates while preserving priority', () => {
    expect(
      loadWidgetPreferences({ getItem: () => '["pairs","foreign","net","pairs"]' }, 'key'),
    ).toEqual(['pairs', 'net']);
  });
  it('recovers from unavailable or damaged browser storage', () => {
    expect(
      loadWidgetPreferences(
        {
          getItem: () => {
            throw new Error('storage');
          },
        },
        'key',
      ),
    ).toContain('net');
    expect(loadWidgetPreferences({ getItem: () => 'broken' }, 'key')).toContain('net');
  });
});

describe('Daily sales chart', () => {
  it('shows confirmed days without recorded movements as zero and preserves negative movements', async () => {
    const { dailySalesRows } = await import('./sales-report-model.js');
    expect(
      dailySalesRows({
        from: '2026-11-01',
        to: '2026-11-03',
        byDay: [
          { key: '2026-11-01', label: '2026-11-01', netMinorUnits: 12500 },
          { key: '2026-11-03', label: '2026-11-03', netMinorUnits: -3000 },
        ],
      }).map(({ key, netMinorUnits }) => ({ key, netMinorUnits })),
    ).toEqual([
      { key: '2026-11-01', netMinorUnits: 12500 },
      { key: '2026-11-02', netMinorUnits: 0 },
      { key: '2026-11-03', netMinorUnits: -3000 },
    ]);
  });
});
