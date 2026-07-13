import { defineConfig } from 'vitest/config';

/**
 * Live-DB integration suite (closes gate item H1). Separate from the default
 * `npm test` (mocked units) — it boots the REAL `api` + `worker` Postgres pools
 * against a local build-v3 database and asserts behavior against real RLS.
 *
 * Prereqs (see test/integration/harness-roles.sql):
 *   1. Build the DB:  PGPORT=5233 docs/migration/build-v3/backfill/00_run_backfill.sh
 *   2. Provision the login roles ONCE (superuser):
 *        psql -p 5233 -d umi_backfill_v3 -f apps/umi-api/test/integration/harness-roles.sql
 *
 * Run:  npm run test:integration
 * The default `vitest run` ignores these files (`.integration.ts` matches neither
 * the `.spec.` nor `.test.` default globs), so mocked units stay DB-free.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // One shared database — serialize so RLS/GUC state never overlaps across files.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
