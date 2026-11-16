import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { MetricsId, MetricsRange } from '@umi/contract';
import { METRIC_RANGES } from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import type { AppConfig } from '../../shared/config/config.schema';
import type { AuthUser } from '../auth/auth.types';
import { DashboardOperationsRepository } from '../dashboard-operations/dashboard-operations.repository';
import { seedSalesAnalysis } from '../../../test/integration/sales-analysis-fixture';
import {
  aliasFixtureProducts,
  canonicalJson,
  MIGRATED_METRICS,
  normalizeFresh,
  normalizeLegacy,
  sha256,
} from '../../../test/integration/metrics-parity-normalize';
import { MetricsRepository } from './metrics.repository';

/**
 * Gate-2 parity matrix.
 *
 * Each case asks the new `metrics/query` read and the legacy `salesSummary`
 * read the same question over the same explicit window. The test normalizes
 * both answers with one canonical shape and compares all fourteen migrated
 * metrics. The committed ledger records one row per case with the two hashes.
 *
 * The matrix uses fixture A only. The seed is deterministic in its amounts and
 * random in its UUIDs. The ledger replaces the product UUIDs with their fixture
 * role, so a rerun produces the same bytes. The comparison uses the raw ids.
 */
const LEDGER_PATH = join(
  __dirname,
  '../../../../../docs/verification/2026-11-16-semantic-api-gate2-parity.json',
);

type Scope = 'all' | 'centro' | 'norte';
type Boundary =
  | 'single-day'
  | 'start-inclusive'
  | 'start-exclusive'
  | 'end-inclusive'
  | 'end-exclusive'
  | 'empty-cell';

interface MatrixCase {
  id: string;
  asOf: string;
  range: MetricsRange;
  scope: Scope;
  boundary: Boundary;
}

/**
 * Fixed `asOf` dates give each range a non-empty case and a boundary case.
 * The fixture has two Centro sales on 2026-11-02 and one Norte sale on
 * 2026-11-04.
 */
const CASES: MatrixCase[] = [
  { id: 'T01', asOf: '2026-11-02', range: 'today', scope: 'all', boundary: 'single-day' },
  { id: 'T02', asOf: '2026-11-02', range: 'today', scope: 'centro', boundary: 'single-day' },
  { id: 'T03', asOf: '2026-11-04', range: 'today', scope: 'norte', boundary: 'single-day' },
  { id: 'T04', asOf: '2026-11-05', range: 'today', scope: 'all', boundary: 'empty-cell' },
  { id: 'T05', asOf: '2026-11-04', range: 'today', scope: 'all', boundary: 'single-day' },
  { id: 'Y01', asOf: '2026-11-03', range: 'yesterday', scope: 'all', boundary: 'single-day' },
  { id: 'Y02', asOf: '2026-11-03', range: 'yesterday', scope: 'centro', boundary: 'single-day' },
  { id: 'Y03', asOf: '2026-11-05', range: 'yesterday', scope: 'norte', boundary: 'single-day' },
  { id: 'Y04', asOf: '2026-11-02', range: 'yesterday', scope: 'all', boundary: 'empty-cell' },
  { id: 'Y05', asOf: '2026-11-05', range: 'yesterday', scope: 'all', boundary: 'single-day' },
  { id: 'W01', asOf: '2026-11-04', range: 'last_7_days', scope: 'all', boundary: 'end-inclusive' },
  {
    id: 'W02',
    asOf: '2026-11-04',
    range: 'last_7_days',
    scope: 'centro',
    boundary: 'end-inclusive',
  },
  {
    id: 'W03',
    asOf: '2026-11-04',
    range: 'last_7_days',
    scope: 'norte',
    boundary: 'end-inclusive',
  },
  {
    id: 'W04',
    asOf: '2026-11-08',
    range: 'last_7_days',
    scope: 'all',
    boundary: 'start-inclusive',
  },
  {
    id: 'W05',
    asOf: '2026-11-09',
    range: 'last_7_days',
    scope: 'all',
    boundary: 'start-exclusive',
  },
  { id: 'W06', asOf: '2026-11-01', range: 'last_7_days', scope: 'all', boundary: 'empty-cell' },
  {
    id: 'W07',
    asOf: '2026-11-08',
    range: 'last_7_days',
    scope: 'centro',
    boundary: 'start-inclusive',
  },
  { id: 'M01', asOf: '2026-11-04', range: 'last_30_days', scope: 'all', boundary: 'end-inclusive' },
  {
    id: 'M02',
    asOf: '2026-11-04',
    range: 'last_30_days',
    scope: 'centro',
    boundary: 'end-inclusive',
  },
  {
    id: 'M03',
    asOf: '2026-11-04',
    range: 'last_30_days',
    scope: 'norte',
    boundary: 'end-inclusive',
  },
  { id: 'M04', asOf: '2026-11-03', range: 'last_30_days', scope: 'all', boundary: 'end-exclusive' },
  { id: 'M05', asOf: '2026-11-02', range: 'last_30_days', scope: 'all', boundary: 'end-inclusive' },
  { id: 'M06', asOf: '2026-10-05', range: 'last_30_days', scope: 'all', boundary: 'empty-cell' },
  { id: 'M07', asOf: '2026-11-08', range: 'last_30_days', scope: 'all', boundary: 'end-inclusive' },
];

const NORMALIZATION = [
  'Sort every list by its dimension tuple. The ranks are absent key, then JSON null, then text.',
  'payment_mix is a multiset. Sort by method and amount. Keep duplicate rows. Never deduplicate tenders and wallet allocations.',
  'product_mix sorts by productId, productName and category. The measure is netMinorUnits.',
  'operator_mix sorts by operator and hour_mix sorts by hour. The measure is netMinorUnits.',
  'channel_mix sorts by channel and series sorts by label.',
  'units_per_ticket keeps four decimals, half-up, and stays null at zero orders.',
  'A null field stays null. An absent field stays absent. The canonical row copies only keys that the source has.',
  'Exclude the envelope fields. The compared form has no truncated, limit, totalItems, total, capturedAt, scope or period.',
];

interface CaseRow {
  id: string;
  fixture: 'A';
  asOf: string;
  range: MetricsRange;
  scope: Scope;
  boundary: Boundary;
  metrics: number;
  freshSha256: string;
  legacySha256: string;
  result: 'match';
  nonEmpty: boolean;
  truncated: false;
}

function configFrom(env: Record<string, string | undefined>) {
  return { get: (key: string) => env[key] } as unknown as ConfigService<AppConfig, true>;
}

function locationFor(scope: Scope, ids: { location: string; branch: string }): string | null {
  if (scope === 'centro') return ids.location;
  if (scope === 'norte') return ids.branch;
  return null;
}

const DISTRIBUTIONS = [
  'payment_mix',
  'channel_mix',
  'product_mix',
  'operator_mix',
  'hour_mix',
  'series',
] as const;

describe('gate-2 parity matrix over fixture A', () => {
  let pg: PgService;
  let metrics: MetricsRepository;
  let legacy: DashboardOperationsRepository;
  let ids: Awaited<ReturnType<typeof seedSalesAnalysis>>;
  let user: AuthUser;
  const rows: CaseRow[] = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_APP || !process.env.DATABASE_URL_WORKER)
      throw new Error('Both database URLs are required');
    pg = new PgService(configFrom(process.env));
    await pg.onModuleInit();
    ids = await seedSalesAnalysis(pg.worker);
    metrics = new MetricsRepository(pg);
    legacy = new DashboardOperationsRepository(pg);
    user = { id: ids.user, email: null, sessionId: ids.session, deviceId: null };
  });

  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  it('has at least twenty unique cases', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CASES.map((item) => item.id)).size).toBe(CASES.length);
  });

  it.each(CASES)('$id compares all fourteen metrics: $range / $scope at $asOf', async (item) => {
    const locationId = locationFor(item.scope, ids);
    const query = {
      metrics: [...MIGRATED_METRICS] as MetricsId[],
      dimensions: [],
      range: item.range,
    };
    const [fresh, old] = await Promise.all([
      metrics.read(user.id, ids.merchant, locationId, query, item.asOf),
      legacy.salesSummary(user.id, ids.merchant, { range: item.range }, locationId, item.asOf),
    ]);

    expect(fresh.rows).toBeUndefined();
    expect(fresh.rowsTotal).toBeUndefined();
    expect(fresh.truncated).toBe(false);
    expect(fresh.totals?.values).toBeDefined();
    expect(Object.keys(fresh.totals?.values ?? {}).sort()).toEqual([...MIGRATED_METRICS].sort());

    for (const key of DISTRIBUTIONS) {
      const envelope = fresh.totals?.values[key] as
        { items: unknown[]; truncated: boolean; totalItems: number } | undefined;
      expect(envelope).toBeDefined();
      expect(envelope?.truncated).toBe(false);
      expect(envelope?.items.length).toBe(envelope?.totalItems);
    }

    const freshNormalized = normalizeFresh(fresh);
    const legacyNormalized = normalizeLegacy(old);
    expect(freshNormalized).toEqual(legacyNormalized);

    const aliases: Record<string, string> = {
      [ids.bread]: 'bread',
      [ids.coffee]: 'coffee',
      [ids.foreignProduct]: 'foreign',
    };
    const freshHashed = aliasFixtureProducts(freshNormalized, aliases);
    const legacyHashed = aliasFixtureProducts(legacyNormalized, aliases);
    const freshSha256 = sha256(canonicalJson(freshHashed));
    const legacySha256 = sha256(canonicalJson(legacyHashed));
    expect(freshSha256).toBe(legacySha256);

    rows.push({
      id: item.id,
      fixture: 'A',
      asOf: item.asOf,
      range: item.range,
      scope: item.scope,
      boundary: item.boundary,
      metrics: MIGRATED_METRICS.length,
      freshSha256,
      legacySha256,
      result: 'match',
      nonEmpty: freshNormalized.net_sales > 0,
      truncated: false,
    });
  });

  it('covers every range and scope with a non-empty case', () => {
    for (const range of METRIC_RANGES) {
      expect(rows.some((row) => row.range === range && row.nonEmpty)).toBe(true);
      for (const scope of ['all', 'centro', 'norte'] as const)
        expect(rows.some((row) => row.range === range && row.scope === scope && row.nonEmpty)).toBe(
          true,
        );
    }
    expect(new Set(rows.map((row) => row.range))).toEqual(new Set(METRIC_RANGES));
    expect(rows.filter((row) => !row.nonEmpty).length).toBeGreaterThanOrEqual(4);
    for (const boundary of ['start-inclusive', 'start-exclusive', 'end-exclusive'] as const)
      expect(rows.some((row) => row.boundary === boundary)).toBe(true);
  });

  it('commits a ledger that a rerun reproduces', () => {
    const ledger = buildLedger(rows);
    if (process.env.METRICS_GATE2_LEDGER_WRITE === '1')
      writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
    const committed = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as unknown;
    expect(committed).toEqual(ledger);
  });
});

function buildLedger(rows: CaseRow[]) {
  const nonEmptyByRangeScope: Record<string, Record<Scope, number>> = {};
  for (const range of METRIC_RANGES) {
    nonEmptyByRangeScope[range] = { all: 0, centro: 0, norte: 0 };
  }
  for (const row of rows) {
    if (row.nonEmpty) nonEmptyByRangeScope[row.range][row.scope] += 1;
  }

  const count = (predicate: (row: CaseRow) => boolean) => rows.filter(predicate).length;
  return {
    record: '2026-11-16-semantic-api-gate2-parity',
    gate: 2,
    fixture: 'A',
    fixtureDescription:
      'Two Centro sales on 2026-11-02 and one Norte sale on 2026-11-04, one cash tender of 19,500 and one wallet allocation of 5,000, one committed partial refund.',
    metrics: [...MIGRATED_METRICS],
    metricDefinitionVersion: '1.0.0',
    normalization: NORMALIZATION,
    cases: rows,
    coverage: {
      caseCount: rows.length,
      ranges: Object.fromEntries(
        METRIC_RANGES.map((range) => [range, count((row) => row.range === range)]),
      ),
      scopes: {
        all: count((row) => row.scope === 'all'),
        centro: count((row) => row.scope === 'centro'),
        norte: count((row) => row.scope === 'norte'),
      },
      nonEmptyByRangeScope,
      emptyCells: count((row) => !row.nonEmpty),
      boundaryCells: rows
        .filter((row) => row.boundary !== 'single-day' && row.boundary !== 'empty-cell')
        .map((row) => `${row.id}:${row.boundary}`),
      paymentMultiset: ['C01 cash 19,500 plus wallet 5,000 at Centro', 'all locations cash only'],
    },
    caseSetSha256: sha256(canonicalJson(rows)),
  };
}
