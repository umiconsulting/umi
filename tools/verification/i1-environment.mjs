#!/usr/bin/env node
// Record the execution environment. Every value is read from the machine or
// the selected database; nothing is invented.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { cpus, freemem, loadavg, totalmem } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] || '.');
const worktree = resolve(new URL('../..', import.meta.url).pathname);
const database = process.env.I1_DB || 'umi_i1_exec_2f52a6d5';
const exec = (command, args, cwd = worktree) => {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};
const sha256File = (path) => {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
};
const pg = (sql) => {
  try {
    return execFileSync(
      'docker',
      ['exec', 'umi-sales-analysis-pg', 'psql', '-U', 'postgres', '-d', database, '-Atc', sql],
      { encoding: 'utf8', timeout: 30000 },
    ).trim();
  } catch (error) {
    return String(error.message);
  }
};

const environment = {
  recordedAt: new Date().toISOString(),
  candidate: exec('git', ['rev-parse', 'HEAD']),
  baseline: 'b4ba45fc7ec111dd02e0a0f86dad324697a4ca48',
  worktree,
  os: {
    kernel: exec('uname', ['-r']),
    machine: exec('uname', ['-m']),
    cpu: cpus()[0]?.model,
    cpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
    loadAverage: loadavg(),
  },
  versions: {
    node: process.version,
    pnpm: exec('pnpm', ['--version']),
    git: exec('git', ['--version']),
    playwright: (() => {
      try {
        return JSON.parse(
          readFileSync(join(worktree, 'node_modules/@playwright/test/package.json'), 'utf8'),
        ).version;
      } catch {
        return null;
      }
    })(),
    chrome: exec('curl', ['-s', 'http://127.0.0.1:9222/json/version']),
    postgresServer: pg('select version()'),
    postgresClient: exec('psql', ['--version']),
  },
  database: {
    name: database,
    clock: pg("select pg_get_functiondef('i1_clock.now()'::regprocedure)"),
    searchPath: pg('show search_path'),
    migrationHead: pg(
      'select filename from runtime.migration_ledger order by filename desc limit 1',
    ),
    schemaVersion: pg(
      "select version from runtime.schema_migration where status='applied' order by applied_at desc limit 1",
    ),
    perfTickets: pg(
      "select count(*) from merchant.pos_committed_sale where merchant_id='44444444-4444-4444-8444-000000000001'",
    ),
  },
  builds: {
    apiMain: sha256File(join(worktree, 'apps/umi-api/dist/main.js')),
    dashboardIndex: sha256File(join(worktree, 'apps/umi-dashboard/dist/index.html')),
    contractRuntime: sha256File(join(worktree, 'packages/contract/dist/index.js')),
  },
  freeBefore: null,
};

try {
  environment.freeBefore = exec('free', ['-m']);
} catch {
  environment.freeBefore = null;
}
writeFileSync(join(out, 'environment.json'), JSON.stringify(environment, null, 2) + '\n');
console.log(JSON.stringify(environment, null, 2));
