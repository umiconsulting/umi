import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { MetricsId, MetricsRange } from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import type { AppConfig } from '../../shared/config/config.schema';
import type { AuthUser } from '../auth/auth.types';
import { seedSalesAnalysis } from '../../../test/integration/sales-analysis-fixture';
import { MetricsRepository } from './metrics.repository';
import {
  MIGRATED_METRICS,
  aliasFixtureProducts,
  normalizeFresh,
  normalizeLegacy,
  sha256,
  type LegacySalesSummary,
  type NormalizedMetrics,
} from './gate3-normalize';

/**
 * The gate-3 frozen legacy oracle.
 *
 * The old route is gone. This test reads static JSON only. It recomputes the
 * metrics side for the 28 fixture-A cases and compares the 14-field normalized
 * hash. The fixture-B case and the route-live capture are hash-only because
 * their source databases are historical.
 */
const ROOT = join(__dirname, '../../../test/fixtures/semantic-gate3/legacy');
const REPO = join(__dirname, '../../../../../');

interface ManifestCase {
  caseId: string;
  file: string;
  rawSha256: string;
  normalizedLegacySha256: string;
}

interface Manifest {
  record: string;
  legacyCommit: string;
  captureCommand: string;
  cases: ManifestCase[];
}

interface FrozenCase {
  caseId: string;
  capturedAt: string;
  legacyCommit: string;
  request: { range: string; locationId: string | null; asOf: string | null };
  productAliases: Record<string, string>;
  response: LegacySalesSummary;
}

function configFrom(env: Record<string, string | undefined>) {
  return { get: (key: string) => env[key] } as unknown as ConfigService<AppConfig, true>;
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) as Manifest;

function load(entry: ManifestCase): { text: string; body: FrozenCase } {
  const text = readFileSync(join(ROOT, entry.file), 'utf8');
  return { text, body: JSON.parse(text) as FrozenCase };
}

function hashOf(value: NormalizedMetrics): string {
  return sha256(JSON.stringify(value));
}

function ledgerScopes(): Record<string, string> {
  const path = join(REPO, 'docs/verification/2026-11-16-semantic-api-gate2-parity.json');
  const ledger = JSON.parse(readFileSync(path, 'utf8')) as {
    cases: { id: string; scope: string }[];
  };
  return Object.fromEntries(ledger.cases.map((row) => [row.id, row.scope]));
}

function liveCases(): ManifestCase[] {
  return manifest.cases.filter(
    (entry) => entry.caseId !== 'fixture-b-i1' && entry.caseId !== 'route-live',
  );
}

describe('gate-3 frozen legacy oracle', () => {
  let pg: PgService;
  let metrics: MetricsRepository;
  let seeded: Awaited<ReturnType<typeof seedSalesAnalysis>>;
  let user: AuthUser;
  let aliases: Record<string, string>;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_APP || !process.env.DATABASE_URL_WORKER)
      throw new Error('Both database URLs are required');
    pg = new PgService(configFrom(process.env));
    await pg.onModuleInit();
    seeded = await seedSalesAnalysis(pg.worker);
    metrics = new MetricsRepository(pg);
    user = { id: seeded.user, email: null, sessionId: seeded.session, deviceId: null };
    aliases = {
      [seeded.bread]: 'bread',
      [seeded.coffee]: 'coffee',
      [seeded.foreignProduct]: 'foreign',
    };
  });

  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  it('freezes 29 cases plus route-live and every raw hash matches', () => {
    expect(manifest.record).toBe('2026-11-16-semantic-api-gate3-legacy-oracle');
    expect(manifest.legacyCommit).toBe('dfa7a78a94e696eb67fc4606b281268746128ec8');
    expect(manifest.cases).toHaveLength(30);
    expect(manifest.cases.filter((entry) => entry.file.startsWith('gate2/'))).toHaveLength(24);
    expect(
      manifest.cases.filter((entry) => entry.file.startsWith('gate1/fixture-a-')),
    ).toHaveLength(4);
    expect(manifest.cases.filter((entry) => entry.caseId === 'fixture-b-i1')).toHaveLength(1);
    expect(manifest.cases.filter((entry) => entry.caseId === 'route-live')).toHaveLength(1);

    for (const entry of manifest.cases) {
      const { text, body } = load(entry);
      expect(sha256(text), `${entry.caseId} raw`).toBe(entry.rawSha256);
      expect(body.caseId, `${entry.caseId} id`).toBe(entry.caseId);
      const normalized = normalizeLegacy(body.response);
      expect(Object.keys(normalized), `${entry.caseId} fields`).toEqual([...MIGRATED_METRICS]);
      const aliased =
        Object.keys(body.productAliases).length > 0
          ? aliasFixtureProducts(normalized, body.productAliases)
          : normalized;
      expect(hashOf(aliased), `${entry.caseId} normalized`).toBe(entry.normalizedLegacySha256);
    }
  });

  it('matches the metrics read on all 28 fixture-A cases', async () => {
    const matched: string[] = [];
    const scopes = ledgerScopes();
    for (const entry of liveCases()) {
      const { body } = load(entry);
      const frozenLocation = body.request.locationId;
      const locationId = frozenLocation
        ? scopes[entry.caseId] === 'norte'
          ? seeded.branch
          : seeded.location
        : null;
      const result = await metrics.read(
        user.id,
        seeded.merchant,
        locationId,
        {
          metrics: [...MIGRATED_METRICS] as MetricsId[],
          dimensions: [],
          range: body.request.range as MetricsRange,
        },
        body.request.asOf ?? undefined,
      );
      const fresh = aliasFixtureProducts(normalizeFresh(result), aliases);
      expect(Object.keys(fresh), `${entry.caseId} fields`).toEqual([...MIGRATED_METRICS]);
      expect(hashOf(fresh), `${entry.caseId} live`).toBe(entry.normalizedLegacySha256);
      matched.push(entry.caseId);
    }
    expect(matched).toHaveLength(28);
  });

  it('keeps 20 non-empty gate-2 cases and 14 metrics in each', () => {
    const gate2 = manifest.cases.filter((entry) => entry.file.startsWith('gate2/'));
    const nonEmpty = gate2.filter((entry) => {
      const { body } = load(entry);
      return body.response.totals.orders > 0;
    });
    expect(gate2).toHaveLength(24);
    expect(nonEmpty).toHaveLength(20);
    for (const entry of gate2) expect(entry.normalizedLegacySha256).toHaveLength(64);
  });

  it('does not change the gate-2 ledger or its case-set hash', () => {
    const path = join(REPO, 'docs/verification/2026-11-16-semantic-api-gate2-parity.json');
    const text = readFileSync(path, 'utf8');
    expect(sha256(text)).toBe('8986d5ebdb6deea83da5c0215d91d85c892cc5a5c1a41495119d6ee9d6e5377e');
    const ledger = JSON.parse(text) as { cases: unknown[]; caseSetSha256: string };
    expect(sha256(JSON.stringify(ledger.cases))).toBe(
      'fe1365f872f364448a05384ffa2e7e63d9977463b4d8bd4753fc45cacd26f4c5',
    );
    expect(ledger.caseSetSha256).toBe(
      'fe1365f872f364448a05384ffa2e7e63d9977463b4d8bd4753fc45cacd26f4c5',
    );
  });
});
