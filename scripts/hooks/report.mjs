#!/usr/bin/env node
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { defaultMetricsPath } from './lib.mjs';

export function parseArgs(argv) {
  const opts = {
    days: 30,
    hook: null,
    asJson: false,
    reset: false,
    file: defaultMetricsPath(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--days') opts.days = Number(argv[++i] || 30);
    else if (arg === '--hook') opts.hook = argv[++i] || null;
    else if (arg === '--file') opts.file = argv[++i] || opts.file;
    else if (arg === '--json') opts.asJson = true;
    else if (arg === '--reset') opts.reset = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
  }
  return opts;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

export function summarizeMetrics(rows, { days = 30, hook = null, now = Date.now() } = {}) {
  const cutoff = days > 0 ? now - days * 86_400_000 : 0;
  const filtered = rows.filter((r) => {
    if (!r || typeof r !== 'object') return false;
    if (hook && r.hook !== hook) return false;
    const t = Date.parse(r.ts || '');
    if (cutoff && (!Number.isFinite(t) || t < cutoff)) return false;
    return true;
  });

  const byHook = new Map();
  for (const r of filtered) {
    const name = String(r.hook || 'unknown');
    if (!byHook.has(name)) {
      byHook.set(name, {
        hook: name,
        event: r.event || 'unknown',
        total: 0,
        interventions: 0,
        decisions: {},
        rules: {},
        durations: [],
      });
    }
    const bucket = byHook.get(name);
    bucket.total += 1;
    const dec = String(r.decision || 'unknown');
    bucket.decisions[dec] = (bucket.decisions[dec] || 0) + 1;
    if (dec !== 'pass') bucket.interventions += 1;
    const rule = String(r.rule || 'unknown');
    bucket.rules[rule] = (bucket.rules[rule] || 0) + 1;
    if (typeof r.durationMs === 'number' && Number.isFinite(r.durationMs)) {
      bucket.durations.push(r.durationMs);
    }
  }

  const hooks = [...byHook.values()]
    .sort((a, b) => b.total - a.total || a.hook.localeCompare(b.hook))
    .map((b) => {
      const sorted = [...b.durations].sort((x, y) => x - y);
      const sum = sorted.reduce((acc, v) => acc + v, 0);
      return {
        hook: b.hook,
        event: b.event,
        total: b.total,
        interventions: b.interventions,
        interventionRatePct: b.total > 0 ? Math.round((b.interventions / b.total) * 1000) / 10 : 0,
        decisions: b.decisions,
        rules: b.rules,
        latencyMs: {
          avg: sorted.length > 0 ? Math.round((sum / sorted.length) * 100) / 100 : 0,
          p95: percentile(sorted, 95),
          max: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
        },
      };
    });

  return {
    windowDays: days,
    totalEvents: filtered.length,
    totalInterventions: hooks.reduce((acc, h) => acc + h.interventions, 0),
    hooks,
  };
}

export function loadMetricsFile(filePath) {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf8');
  const rows = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // skip malformed line
    }
  }
  return rows;
}

function formatTable(summary, filePath) {
  const lines = [
    `Umi Hooks Telemetry (últimos ${summary.windowDays} días)`,
    `Archivo: ${filePath}`,
    `Total ejecuciones: ${summary.totalEvents} | Intervenciones (deny/force_ask/continue): ${summary.totalInterventions}`,
    '',
  ];
  if (summary.hooks.length === 0) {
    lines.push('Sin eventos registrados todavía.');
    return lines.join('\n');
  }
  for (const h of summary.hooks) {
    const decStr = Object.entries(h.decisions)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    const ruleStr = Object.entries(h.rules)
      .filter(([k]) => k !== 'clean')
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');
    lines.push(
      `- ${h.hook} (${h.event}): ${h.total} corridas | ${h.interventions} intervenciones (${h.interventionRatePct}%) | latencia avg=${h.latencyMs.avg}ms p95=${h.latencyMs.p95}ms max=${h.latencyMs.max}ms`,
    );
    lines.push(`    decisiones: ${decStr}`);
    if (ruleStr) lines.push(`    reglas disparadas: ${ruleStr}`);
  }
  return lines.join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Uso: pnpm hooks:stats [--days N] [--hook NAME] [--json] [--reset] [--file PATH]');
    return;
  }
  if (opts.reset) {
    rmSync(opts.file, { force: true });
    console.log(`Métricas reiniciadas: ${opts.file}`);
    return;
  }
  const rows = loadMetricsFile(opts.file);
  const summary = summarizeMetrics(rows, { days: opts.days, hook: opts.hook });
  if (opts.asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(formatTable(summary, opts.file));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
