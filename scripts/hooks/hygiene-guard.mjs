import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { emitJson, readHookPayload, recordMetric } from './lib.mjs';

const SENSITIVE_FILE_RE =
  /(?:^|\/)(?:draft\.json|\.env\.local|\.env\.prod[^/]*|[^/]+\.(?:jks|keystore|p8|pem|dump))$/i;

export function findSensitiveGitResidue(cwd) {
  if (!cwd || !existsSync(cwd)) return [];
  try {
    const out = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd,
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const hits = [];
    for (const rawLine of out.split('\n')) {
      const line = rawLine.trimEnd();
      if (!line) continue;
      const status = line.slice(0, 2);
      // Ignore deleted entries (D)
      if (status.includes('D')) continue;
      const relPath = line.slice(3).replace(/^"|"$/g, '');
      if (SENSITIVE_FILE_RE.test(relPath)) {
        hits.push(relPath);
      }
    }
    return hits;
  } catch {
    return [];
  }
}

export function findLeftoverOnboardDrafts(dirs) {
  const hits = [];
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = join(dir, entry.name, 'draft.json');
        if (existsSync(candidate)) {
          hits.push(`${basename(dir)}/${entry.name}/draft.json`);
        }
      }
    } catch {
      // ignore unreadable directories
    }
  }
  return hits;
}

export function evaluateHygieneGuard(payload, options = {}) {
  // Circuit breaker: never loop on continuation turns.
  if (payload?.continuationActive === true || payload?.stop_hook_active === true) {
    return {
      output: {},
      metricDecision: 'pass',
      rule: 'continuation-guard',
    };
  }
  // Only block normal turn completion; don't fight user cancellation or errors.
  const reason = payload?.terminationReason;
  if (reason && reason !== 'NO_TOOL_CALL') {
    return {
      output: {},
      metricDecision: 'pass',
      rule: `skip-${String(reason).toLowerCase()}`,
    };
  }

  const cwd = options.cwd ?? payload?.cwd ?? process.cwd();
  const extraDirs = options.extraDirs ?? [];
  const findings = [...findSensitiveGitResidue(cwd), ...findLeftoverOnboardDrafts(extraDirs)];

  if (findings.length > 0) {
    const preview = findings.slice(0, 5).join(', ');
    return {
      output: {
        decision: 'continue',
        reason: `hygiene-guard: quedaron archivos sensibles sin limpiar (${preview}). Borra/limpia los temporales (ej. cleanup) antes de cerrar el turno.`,
      },
      metricDecision: 'continue',
      rule: 'sensitive-residue',
    };
  }

  return {
    output: {},
    metricDecision: 'pass',
    rule: 'clean',
  };
}

function main() {
  const startedAt = performance.now();
  let payload = {};
  try {
    payload = readHookPayload();
  } catch {
    recordMetric({
      hook: 'hygiene-guard',
      event: 'Stop',
      decision: 'pass',
      rule: 'parse-error',
      startedAt,
      payload,
    });
    emitJson({});
    return;
  }

  const verdict = evaluateHygieneGuard(payload);
  recordMetric({
    hook: 'hygiene-guard',
    event: 'Stop',
    decision: verdict.metricDecision,
    rule: verdict.rule,
    startedAt,
    payload,
  });
  emitJson(verdict.output);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
