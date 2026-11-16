/**
 * Historical capture harness for the 29 frozen gate-3 legacy cases.
 *
 * This file was run at the before head `dfa7a78a` from this location:
 *
 *   apps/umi-api/src/modules/metrics/capture-legacy-oracle.integration.ts
 *
 * It imports the legacy repository on purpose. Never run it at the after head.
 * The after-head oracle test reads the static JSON only.
 *
 * Usage in a clean worktree at dfa7a78a:
 *   cp tools/verification/fixtures/semantic-gate3/capture-legacy-oracle.ts \
 *      apps/umi-api/src/modules/metrics/capture-legacy-oracle.integration.ts
 *   cd apps/umi-api
 *   DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
 *     npx vitest run --config vitest.integration.config.ts \
 *     src/modules/metrics/capture-legacy-oracle.integration.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { ReportsSalesQuery } from '@umi/contract';
import { describe, it } from 'vitest';
import { PgService } from '../../shared/database/pg.service';
import type { AppConfig } from '../../shared/config/config.schema';
import { seedSalesAnalysis } from '../../../test/integration/sales-analysis-fixture';
import { DashboardOperationsRepository } from '../dashboard-operations/dashboard-operations.repository';

const LEGACY = 'dfa7a78a94e696eb67fc4606b281268746128ec8';
const ROOT = join(__dirname, '../../../test/fixtures/semantic-gate3/legacy');
const REPO = join(__dirname, '../../../../');

function configFrom(env: Record<string, string | undefined>) {
  return { get: (key: string) => env[key] } as unknown as ConfigService<AppConfig, true>;
}

interface Frozen {
  caseId: string;
  capturedAt: string;
  productAliases: Record<string, string>;
  request: { range: string; locationId: string | null; asOf: string | null };
  response: { productMix?: { productId: string | null }[] };
}

function frozen(file: string): Frozen | null {
  const path = join(ROOT, file);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Frozen) : null;
}

function write(file: string, value: unknown) {
  writeFileSync(join(ROOT, file), `${JSON.stringify(value, null, 2)}\n`);
}

/** Keep the frozen product ids so the raw bytes stay stable across a reseed. */
function remapProducts(
  response: Frozen['response'],
  current: Record<string, string>,
  old: Frozen | null,
) {
  if (!old) return response;
  const roleOf = (id: string) => current[id];
  const oldIdOf = (role: string) =>
    Object.entries(old.productAliases).find(([, value]) => value === role)?.[0];
  for (const row of response.productMix ?? []) {
    const role = row.productId ? roleOf(row.productId) : undefined;
    const frozenId = role ? oldIdOf(role) : undefined;
    if (frozenId) row.productId = frozenId;
  }
  return response;
}

describe('capture the gate-3 legacy oracle', () => {
  it('writes the 29 frozen cases and route-live', async () => {
    const pg = new PgService(configFrom(process.env));
    await pg.onModuleInit();
    const ids = await seedSalesAnalysis(pg.worker);
    const repo = new DashboardOperationsRepository(pg);
    const ledger = JSON.parse(
      readFileSync(
        join(REPO, 'docs/verification/2026-11-16-semantic-api-gate2-parity.json'),
        'utf8',
      ),
    ) as { cases: { id: string; asOf: string; range: string; scope: string }[] };
    const aliases = {
      [ids.bread]: 'bread',
      [ids.coffee]: 'coffee',
      [ids.foreignProduct]: 'foreign',
    };

    for (const row of ledger.cases) {
      const file = `gate2/${row.id}.json`;
      const old = frozen(file);
      const location =
        row.scope === 'centro' ? ids.location : row.scope === 'norte' ? ids.branch : null;
      const response = await repo.salesSummary(
        ids.user,
        ids.merchant,
        { range: row.range } as ReportsSalesQuery,
        location,
        row.asOf,
      );
      write(file, {
        caseId: row.id,
        capturedAt: old?.capturedAt ?? new Date().toISOString(),
        legacyCommit: LEGACY,
        request: {
          range: row.range,
          locationId: old?.request.locationId ?? location,
          asOf: row.asOf,
        },
        productAliases: old?.productAliases ?? {},
        response: remapProducts(response as Frozen['response'], aliases, old),
      });
    }

    const gate1 = [
      ['fixture-a-all', null],
      ['fixture-a-centro', ids.location],
      ['fixture-a-day-series', null],
      ['fixture-a-payment', ids.location],
    ] as const;
    for (const [caseId, location] of gate1) {
      const file = `gate1/${caseId}.json`;
      const old = frozen(file);
      const response = await repo.salesSummary(
        ids.user,
        ids.merchant,
        { range: 'last_7_days' } as ReportsSalesQuery,
        location,
        '2026-11-04',
      );
      write(file, {
        caseId,
        capturedAt: old?.capturedAt ?? new Date().toISOString(),
        legacyCommit: LEGACY,
        request: {
          range: 'last_7_days',
          locationId: old?.request.locationId ?? location,
          asOf: '2026-11-04',
        },
        productAliases: old?.productAliases ?? {},
        response: remapProducts(response as Frozen['response'], aliases, old),
      });
    }

    // Fixture B was captured from the I1 METRIC database. When that database is
    // not available, keep the frozen bytes and say so. The after test is hash-only.
    if (!process.env.GATE3_I1_DATABASE_URL) {
      console.log('fixture-b-i1: frozen bytes kept; set GATE3_I1_DATABASE_URL to recapture');
    }

    const routeOld = frozen('gate1/route-live.json');
    const route = await repo.salesSummary(
      ids.user,
      '55555555-5555-4555-8555-000000000001',
      { range: 'last_30_days' } as ReportsSalesQuery,
      '55555555-5555-4555-8555-000000000011',
    );
    write('gate1/route-live.json', {
      caseId: 'route-live',
      capturedAt: routeOld?.capturedAt ?? new Date().toISOString(),
      legacyCommit: LEGACY,
      request: {
        method: 'GET',
        range: 'last_30_days',
        locationId: '55555555-5555-4555-8555-000000000011',
        asOf: null,
      },
      productAliases: {},
      response: route,
    });

    await pg.onModuleDestroy();
  }, 60_000);
});
