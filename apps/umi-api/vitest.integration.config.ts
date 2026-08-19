import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

/**
 * Live-DB integration suite (closes gate item H1). Separate from the default
 * `npm test` (mocked units) — it boots the REAL `api` + `worker` Postgres pools
 * against a local build-v3 database and asserts behavior against real RLS.
 *
 * TWO FAMILIES, TWO TARGETS. `npm run test:integration` runs both and therefore
 * needs a database that is both, which no database is. Use the scoped scripts:
 *
 *   `npm run test:integration:schema`     → a PRISTINE build (00_run.sh, no rows).
 *       Provable from the DDL alone. This is the set CI runs, and the set that
 *       seeds its own fixtures.
 *
 *   `npm run test:integration:migration`  → a BACKFILLED clone of production.
 *       Asks what the migration produced from real rows: RLS under real data,
 *       pooler isolation, phone normalization, and the endpoint smoke.
 *
 * Point either at the wrong target and it reports defects that are not there —
 * `wallet-carry` once read 89 unregistered passes off a rehearsal clone and
 * called it a regression when it was 89 customers who never installed a pass.
 *
 * Prereqs (see test/integration/harness-roles.sql):
 *   1. Build the DB:  PGPORT=5233 docs/migration/build-v3/backfill/00_run_backfill.sh
 *   2. Provision the login roles ONCE (superuser):
 *        psql -p 5233 -d umi_backfill_v3 -f apps/umi-api/test/integration/harness-roles.sql
 *
 * The default `vitest run` ignores these files (`.integration.ts` matches neither
 * the `.spec.` nor `.test.` default globs), so mocked units stay DB-free.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['src/**/*.integration.ts'],
      testTimeout: 20_000,
      hookTimeout: 30_000,
      // One shared database — serialize so RLS/GUC state never overlaps across files.
      fileParallelism: false,
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    },
  }),
);
