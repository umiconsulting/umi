#!/usr/bin/env node
// I1 acceptance runner.
//
// One command executes the case inventory against a selected base URL. Each
// case writes its own directory with result.json and sha256.txt. The runner
// owns the API process when --start-api is set, so the state cases can pause
// and restart the same process. The dashboard preview and the CDP Chromium are
// existing services; the runbook in builder/HANDOFF.md shows how to start them.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ApiClient,
  ApiProcess,
  BrowserSession,
  CANDIDATE,
  BASELINE,
  DEFAULT_API,
  DEFAULT_BASE,
  DEFAULT_CDP,
  DEFAULT_DB,
  DEFAULT_DEV,
  Database,
  USERS,
  Checks,
  canonical,
  ensureDir,
  sha256,
  sha256File,
  sleep,
  writeJson,
} from './i1-lib.mjs';
import { CASES } from './i1-cases-index.mjs';

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE,
    apiUrl: DEFAULT_API,
    devUrl: DEFAULT_DEV,
    cdp: DEFAULT_CDP,
    db: DEFAULT_DB,
    out: null,
    only: null,
    startApi: false,
    skipPerf: false,
    allowFailures: false,
    fixtures: null,
    baselineApi: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      return argv[i];
    };
    if (arg === '--base-url') args.baseUrl = next();
    else if (arg === '--api-url') args.apiUrl = next();
    else if (arg === '--dev-url') args.devUrl = next();
    else if (arg === '--cdp') args.cdp = next();
    else if (arg === '--db') args.db = next();
    else if (arg === '--out') args.out = next();
    else if (arg === '--only') args.only = next().split(',').map((value) => value.trim()).filter(Boolean);
    else if (arg === '--fixtures') args.fixtures = next();
    else if (arg === '--baseline-api') args.baselineApi = next();
    else if (arg === '--start-api') args.startApi = true;
    else if (arg === '--skip-perf') args.skipPerf = true;
    else if (arg === '--allow-failures') args.allowFailures = true;
    else if (arg === '--help') {
      console.log('i1-run.mjs [--base-url URL] [--api-url URL] [--dev-url URL] [--cdp URL] [--db NAME] [--out DIR] [--only ID,ID] [--start-api] [--fixtures DIR]');
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function gitHead(worktree) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, encoding: 'utf8' }).trim();
}

function listFiles(dir, base = dir, result = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) listFiles(path, base, result);
    else result.push(path);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const worktree = resolve(new URL('../..', import.meta.url).pathname);
  const head = gitHead(worktree);
  const out = ensureDir(args.out || join(worktree, '.i1-run', new Date().toISOString().replace(/[:.]/g, '-')));
  const casesDir = ensureDir(join(out, 'cases'));
  const fixtures = args.fixtures || process.env.I1_FIXTURES || resolve(worktree, '../../.analytics-i1-exec-2f52a6d5-20261115/fixtures');

  const run = {
    head,
    candidate: CANDIDATE,
    baseline: BASELINE,
    baseUrl: args.baseUrl.replace(/\/+$/, ''),
    apiUrl: args.apiUrl.replace(/\/+$/, ''),
    baselineApiUrl: args.baselineApi ? args.baselineApi.replace(/\/+$/, '') : null,
    baselineDir: join(out, 'baseline'),
    devUrl: args.devUrl.replace(/\/+$/, ''),
    cdp: args.cdp,
    dbName: args.db,
    fixtures,
    out,
    worktree,
    env: process.env,
    startedAt: new Date().toISOString(),
    browser: null,
    apiProcess: null,
    db: new Database(args.db),
    console: [],
    cookies: new Map(),
    log(line) {
      const text = typeof line === 'string' ? line : JSON.stringify(line);
      this.console.push(text);
      console.log(text);
    },
    async ensureSession(user = USERS.owner) {
      if (this.cookies.has(user)) return this.cookies.get(user);
      const client = new ApiClient(this.apiUrl);
      await client.login(user);
      this.cookies.set(user, client.jar.entries());
      return this.cookies.get(user);
    },
    async apiFor(user = USERS.owner) {
      const client = new ApiClient(this.apiUrl);
      client.setCookies(await this.ensureSession(user));
      client.email = user;
      return client;
    },
    async session(options = {}) {
      const user = options.user || USERS.owner;
      return BrowserSession.open(this, {
        ...options,
        cookies: options.cookies || (await this.ensureSession(user)),
      });
    },
  };

  if (args.startApi) {
    run.apiProcess = new ApiProcess({
      worktree,
      port: Number(new URL(args.apiUrl).port || 4001),
      database: args.db,
      logPath: join(out, 'api.log'),
    });
    await run.apiProcess.start();
  }

  run.browser = await (await import('@playwright/test')).chromium.connectOverCDP(args.cdp);

  const preflight = {
    at: new Date().toISOString(),
    fixtures,
    command: `I1_DB=${args.db} I1_WORKTREE=${worktree} node ${join(fixtures, 'verify-fixtures.mjs')}`,
    status: 'NOT RUN',
    exitCode: null,
    output: '',
  };
  if (fixtures) {
    const result = spawnSync(
      process.execPath,
      [join(fixtures, 'verify-fixtures.mjs')],
      {
        cwd: fixtures,
        env: { ...process.env, I1_DB: args.db, I1_WORKTREE: worktree },
        encoding: 'utf8',
        timeout: 300000,
      },
    );
    preflight.exitCode = result.status;
    preflight.output = `${result.stdout || ''}${result.stderr || ''}`;
    preflight.status = result.status === 0 ? 'PASS' : 'FAIL';
  }
  writeJson(join(out, 'preflight.json'), preflight);
  run.log(`preflight ${preflight.status} (${preflight.exitCode})`);

  const selected = Object.keys(CASES).filter((id) => !args.only || args.only.includes(id));
  const summary = [];
  for (const id of selected) {
    const caseDir = ensureDir(join(casesDir, id));
    const checks = new Checks();
    const stdout = [];
    const stderr = [];
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const context = {
      id,
      run,
      dir: caseDir,
      checks,
      db: run.db,
      apiUrl: run.apiUrl,
      baseUrl: run.baseUrl,
      devUrl: run.devUrl,
      fixtures,
      log(line) {
        const text = typeof line === 'string' ? line : JSON.stringify(line);
        stdout.push(text);
        console.log(`[${id}] ${text}`);
      },
      error(line) {
        const text = typeof line === 'string' ? line : JSON.stringify(line);
        stderr.push(text);
        console.error(`[${id}] ${text}`);
      },
      writeJson(name, value) {
        writeJson(join(caseDir, name), value);
        return join(caseDir, name);
      },
      async session(options = {}) {
        return run.session({
          ...options,
          baseUrl: options.baseUrl || run.baseUrl,
          caseDir,
        });
      },
      api(user = USERS.owner) {
        return run.apiFor(user);
      },
      sleep,
    };

    let status = 'FAIL';
    let failure = null;
    let caseResult = null;
    try {
      caseResult = (await CASES[id](context)) || {};
      for (const check of caseResult.checks || []) checks.items.push(check);
      status = caseResult.status || (checks.failed.length ? 'FAIL' : 'PASS');
      failure = caseResult.failure || (checks.failed.length ? checks.failed[0] : null);
      if (caseResult.stdout) context.log(caseResult.stdout);
    } catch (error) {
      status = error.status || 'FAIL';
      failure = { message: error.message, stack: error.stack };
      context.error(error.stack || error.message);
    }

    const endedAt = new Date().toISOString();
    const result = {
      caseId: id,
      status,
      head,
      baseline: BASELINE,
      startedAt,
      endedAt,
      durationMs: Date.now() - started,
      command: `node tools/verification/i1-run.mjs --only ${id} --base-url ${run.baseUrl} --api-url ${run.apiUrl} --db ${run.dbName}`,
      environment: {
        baseUrl: run.baseUrl,
        apiUrl: run.apiUrl,
        devUrl: run.devUrl,
        cdp: run.cdp,
        database: run.dbName,
        viewport: '1440x900 unless the case names 360x800',
        locale: 'es-MX',
        apiManaged: Boolean(run.apiProcess),
      },
      checks: checks.items,
      failure,
      observations: caseResult?.observations || null,
    };
    writeJson(join(caseDir, 'result.json'), result);
    writeFileSync(join(caseDir, 'stdout.txt'), `${stdout.join('\n')}\n`);
    writeFileSync(join(caseDir, 'stderr.txt'), `${stderr.join('\n')}\n`);

    const files = listFiles(caseDir)
      .filter((path) => !path.endsWith('sha256.txt'))
      .sort();
    const lines = files.map((path) => `${sha256File(path)}  ${path.slice(caseDir.length + 1)}`);
    writeFileSync(join(caseDir, 'sha256.txt'), `${lines.join('\n')}\n`);
    summary.push({ id, status, dir: caseDir, checks: checks.items.length, failed: checks.failed.length, durationMs: result.durationMs });
    run.log(`${id} ${status} (${checks.failed.length} failed checks)`);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    head,
    baseline: BASELINE,
    database: args.db,
    baseUrl: run.baseUrl,
    apiUrl: run.apiUrl,
    preflight: { status: preflight.status, exitCode: preflight.exitCode },
    cases: summary,
    counts: {
      total: summary.length,
      pass: summary.filter((c) => c.status === 'PASS').length,
      fail: summary.filter((c) => c.status === 'FAIL').length,
      blocked: summary.filter((c) => c.status === 'BLOCKED').length,
      checkOnly: summary.filter((c) => c.status === 'CHECK-ONLY').length,
    },
  };
  writeJson(join(out, 'manifest.json'), manifest);
  const manifestHash = sha256(JSON.stringify(canonical(manifest)));
  writeFileSync(join(out, 'manifest.sha256'), `${manifestHash}  manifest.json\n`);

  const allFiles = listFiles(out)
    .filter((path) => !path.endsWith('SHA256SUMS'))
    .sort();
  writeFileSync(
    join(out, 'SHA256SUMS'),
    `${allFiles.map((path) => `${sha256File(path)}  ${path.slice(out.length + 1)}`).join('\n')}\n`,
  );
  writeFileSync(
    join(out, 'console.log'),
    `${run.console.join('\n')}\n`,
  );

  await run.browser.close().catch(() => {});
  await run.db.close();
  if (run.apiProcess) await run.apiProcess.close();

  run.log(`manifest ${manifestHash}`);
  const bad = manifest.counts.fail + manifest.counts.blocked;
  if (bad && !args.allowFailures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(2);
});
