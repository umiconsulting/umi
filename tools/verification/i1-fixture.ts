#!/usr/bin/env node
// I1 fixture entry point.
//
// Usage:
//   I1_DB=umi_i1_exec_2f52a6d5 I1_WORKTREE=<candidate> \
//     node tools/verification/i1-fixture.ts --reset
//
// The command seeds the isolated database, sets the synthetic local password,
// and runs the 17 fixture assertions. It prints one JSON document. The seed
// files live outside this worktree in the execution folder; set I1_FIXTURES.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const worktree = process.env.I1_WORKTREE || resolve(new URL('../..', import.meta.url).pathname);
const fixtures =
  process.env.I1_FIXTURES ||
  resolve(worktree, '../../.analytics-i1-exec-2f52a6d5-20261115/fixtures');
const database = process.env.I1_DB || 'umi_i1_exec_2f52a6d5';

function run(command: string, argv: string[]) {
  const result = spawnSync(command, argv, {
    cwd: fixtures,
    encoding: 'utf8',
    env: { ...process.env, I1_DB: database, I1_WORKTREE: worktree },
    timeout: 900000,
  });
  return {
    command: `${command} ${argv.join(' ')}`,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

if (!existsSync(join(fixtures, 'verify-fixtures.mjs'))) {
  console.error(`fixture folder not found: ${fixtures}`);
  process.exit(2);
}

const steps = [];
if (reset) steps.push(run(process.execPath, [join(fixtures, 'seed-i1.mjs'), '--reset']));
steps.push(run(process.execPath, [join(fixtures, 'prepare-local-auth.mjs')]));
steps.push(run(process.execPath, [join(fixtures, 'verify-fixtures.mjs')]));

const failed = steps.find((step) => step.status !== 0);
const preflight = steps.at(-1);
const checks = (preflight?.stdout || '')
  .split('\n')
  .filter((line: string) => line.startsWith('PASS ') || line.startsWith('FAIL '));
const summary = {
  database,
  worktree,
  fixtures,
  reset,
  status: failed ? 'FAIL' : 'PASS',
  steps: steps.map((step) => ({
    command: step.command,
    status: step.status,
    stdoutTail: (step.stdout || '').trim().split('\n').slice(-25).join('\n'),
    stderrTail: (step.stderr || '').trim().split('\n').slice(-10).join('\n'),
  })),
  assertions: {
    total: checks.length,
    pass: checks.filter((line: string) => line.startsWith('PASS ')).length,
    fail: checks.filter((line: string) => line.startsWith('FAIL ')).length,
  },
  lines: checks,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.status === 'PASS' ? 0 : 1);
