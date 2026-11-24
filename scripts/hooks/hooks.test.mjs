import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateProdGuard } from './prod-guard.mjs';
import { evaluateGotchaGuard } from './gotcha-guard.mjs';
import { evaluateHygieneGuard } from './hygiene-guard.mjs';
import { loadMetricsFile, summarizeMetrics } from './report.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));

function runHook(script, stdin, env = {}) {
  const res = spawnSync(process.execPath, [join(DIR, script)], {
    input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

test('prod-guard blocks force push to main/staging and gates prod mutations', () => {
  assert.equal(evaluateProdGuard('git push --force origin main').decision, 'deny');
  assert.equal(evaluateProdGuard('git push -f origin staging').decision, 'deny');
  assert.equal(evaluateProdGuard('git push origin main').decision, 'force_ask');
  assert.equal(evaluateProdGuard('docker restart umi-api-umi-api-1').decision, 'force_ask');
  assert.equal(
    evaluateProdGuard('pnpm dlx wrangler pages deploy out --project-name umi-landing --branch main')
      .decision,
    'force_ask',
  );
  assert.equal(
    evaluateProdGuard('psql "$(cat ~/.config/umi/supabase-prod-db-url)" -c "DELETE FROM umi.user"')
      .decision,
    'force_ask',
  );

  // Safe staging & read-only commands pass through normally
  assert.equal(
    evaluateProdGuard('pg_dump "$(cat ~/.config/umi/supabase-prod-db-url)" > backup.dump')
      .metricDecision,
    'pass',
  );
  assert.equal(evaluateProdGuard('docker restart umi-api-test-api-1').metricDecision, 'pass');
  assert.equal(
    evaluateProdGuard(
      'pnpm dlx wrangler pages deploy out --project-name umi-landing --branch staging',
    ).metricDecision,
    'pass',
  );
  assert.equal(evaluateProdGuard('git push -u origin feat/foo').metricDecision, 'pass');
});

test('gotcha-guard blocks pkill -f, legacy hyprctl dispatch, and read_file on /tmp', () => {
  assert.equal(
    evaluateGotchaGuard({ toolName: 'run_command', command: 'pkill -f firefox', path: '' })
      .decision,
    'deny',
  );
  assert.equal(
    evaluateGotchaGuard({ toolName: 'run_command', command: 'pkill -x firefox', path: '' })
      .metricDecision,
    'pass',
  );
  assert.equal(
    evaluateGotchaGuard({
      toolName: 'run_command',
      command: 'hyprctl dispatch workspace 2',
      path: '',
    }).decision,
    'deny',
  );
  assert.equal(
    evaluateGotchaGuard({
      toolName: 'run_command',
      command: "hyprctl dispatch 'hl.dsp.focus({workspace = 2})'",
      path: '',
    }).metricDecision,
    'pass',
  );
  assert.equal(
    evaluateGotchaGuard({ toolName: 'read_file', command: '', path: '/tmp/shot.png' }).decision,
    'deny',
  );
  assert.equal(
    evaluateGotchaGuard({ toolName: 'read_file', command: '', path: '/home/juan/shot.png' })
      .metricDecision,
    'pass',
  );
});

test('hygiene-guard flags untracked sensitive files and respects continuationActive breaker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'umi-hygiene-test-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    // Clean repo passes
    assert.deepEqual(
      evaluateHygieneGuard({ cwd: dir, terminationReason: 'NO_TOOL_CALL' }).output,
      {},
    );

    // Sensitive file triggers continue
    writeFileSync(join(dir, 'draft.json'), '{"password":"secret"}');
    const flagged = evaluateHygieneGuard({ cwd: dir, terminationReason: 'NO_TOOL_CALL' });
    assert.equal(flagged.output.decision, 'continue');
    assert.equal(flagged.rule, 'sensitive-residue');

    // Continuation guard prevents infinite loop
    const breaker = evaluateHygieneGuard({
      cwd: dir,
      terminationReason: 'NO_TOOL_CALL',
      continuationActive: true,
    });
    assert.deepEqual(breaker.output, {});
    assert.equal(breaker.rule, 'continuation-guard');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hooks log privacy-safe telemetry without leaking command text or secrets, and report aggregates it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'umi-hooks-metrics-'));
  const metricsPath = join(dir, 'metrics.jsonl');
  try {
    const secretToken = 'SUPER_SECRET_TOKEN_XYZ_999';
    const out1 = runHook(
      'prod-guard.mjs',
      {
        conversationId: 'conv-1234567890',
        toolCall: {
          name: 'run_command',
          args: { CommandLine: `TOKEN=${secretToken} git push origin main` },
        },
      },
      { UMI_HOOKS_METRICS_PATH: metricsPath },
    );
    assert.equal(out1.decision, 'force_ask');

    const out2 = runHook(
      'gotcha-guard.mjs',
      {
        conversationId: 'conv-1234567890',
        toolCall: { name: 'run_command', args: { CommandLine: 'pkill -f chromium' } },
      },
      { UMI_HOOKS_METRICS_PATH: metricsPath },
    );
    assert.equal(out2.decision, 'deny');

    // Fail-closed on malformed JSON
    const out3 = runHook('prod-guard.mjs', '{bad json', {
      UMI_HOOKS_METRICS_PATH: metricsPath,
    });
    assert.equal(out3.decision, 'force_ask');

    const rawMetrics = readFileSync(metricsPath, 'utf8');
    assert.equal(rawMetrics.includes(secretToken), false, 'metrics must never store raw commands');

    const rows = loadMetricsFile(metricsPath);
    assert.equal(rows.length, 3);
    const summary = summarizeMetrics(rows, { days: 7 });
    assert.equal(summary.totalEvents, 3);
    assert.equal(summary.totalInterventions, 3);
    assert.equal(summary.hooks.length, 2);

    // Extra onboard draft check via hygiene-guard CLI
    const onboardDir = join(dir, 'onboard-tmp');
    mkdirSync(join(onboardDir, 'cafe-demo'), { recursive: true });
    writeFileSync(join(onboardDir, 'cafe-demo', 'draft.json'), '{}');
    const h = evaluateHygieneGuard(
      { cwd: dir, terminationReason: 'NO_TOOL_CALL' },
      { extraDirs: [onboardDir] },
    );
    assert.equal(h.output.decision, 'continue');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
