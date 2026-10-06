#!/usr/bin/env node
/**
 * Build the WhatsApp LLM cost report.
 *
 * This script writes two files:
 *   docs/reports/ai-usage-model.html   a self-contained page
 *   docs/reports/ai-usage-model.json   the same figures as data
 *
 * The page has three parts:
 *   1. Live usage, when the table umi.ai_usage has rows.
 *   2. A measured call model. This part is always present.
 *   3. An empty state, when the table is absent or empty.
 *
 * The script reads the database with psql. It adds no dependency.
 *
 * Connection. The script reads these environment variables:
 *   PGHOST (default 127.0.0.1), PGPORT, PGUSER (default postgres),
 *   PGPASSWORD, PGDATABASE.
 * When PGPORT is unset, the script asks "docker port" for the real host port.
 * The local port moved before, so the script does not trust a fixed port.
 *
 * Test the live path with no database:
 *   node scripts/ai-usage-report.mjs --fixture docs/reports/ai-usage-fixture.json
 * The fixture file holds the rows in the shape of the queries below.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const OUT_HTML = resolve(REPO_ROOT, 'docs/reports/ai-usage-model.html');
const OUT_JSON = resolve(REPO_ROOT, 'docs/reports/ai-usage-model.json');

// The container name in deploy/local/compose.yml.
const PG_CONTAINER = 'umi-buildv3-local-postgres-1';

// ---------------------------------------------------------------------------
// Measured call model.
// These numbers come from the source, not from live traffic.
// Each value has a file in MEASURED_SOURCES below.
// Chars-per-token is the ratio in the source measurement: 4035 / 1060.
// ---------------------------------------------------------------------------
const CHARS_PER_TOKEN = 3.806;

const MEASURED = {
  intent: {
    label: 'Intent extraction',
    seam: 'LLM_COMPLETION',
    file: 'apps/umi-api/src/modules/conversations/intent.service.ts',
    system_prompt_chars: 4035,
    system_prompt_tokens: 1060,
    max_output_tokens: 500,
    on_live_path: false,
    evidence:
      'No caller. grep -rn extractIntent apps/umi-api/src returns only the definition at intent.service.ts:288. The service is registered in conversations.module.ts at lines 65 and 95 and is never invoked, in src or in dist. The live turn runs the tool loop only.',
  },
  reply: {
    label: 'Reply generation',
    seam: 'Anthropic tool loop',
    file: 'apps/umi-api/src/modules/conversations/tool-loop.service.ts',
    system_prompt_chars: 4252,
    system_prompt_tokens: 1120,
    tool_defs_chars: 7400,
    tool_defs_tokens: 1900,
    max_output_tokens: 900,
    max_tool_calls: 4,
    extra_budget: 3,
  },
};

const LOOP_ITERATIONS = [1, 2, 3, 4, 7];

// Message list model. This is an assumption, and the page says so.
// memory.service.ts reads the last 8 messages, so the base is 8 short
// messages plus the current user turn. Each loop step appends one assistant
// tool_use block and one tool result.
const MESSAGE_MODEL = {
  base_tokens: 260,
  growth_per_iteration_tokens: 300,
  basis:
    'memory.service.ts reads the last 8 messages; each iteration appends a tool_use block and a tool result.',
  assumed: true,
};

// Prices per one million tokens, in US dollars.
const PRICES = {
  correct: {
    label: 'Claude Haiku 4.5 (list price)',
    model: 'claude-haiku-4-5-20251001',
    input_per_mtok: 1.0,
    output_per_mtok: 5.0,
    basis: 'Anthropic standard pricing for Claude Haiku 4.5.',
    assumed: false,
  },
  code: {
    label: 'Value in the API source',
    model: 'claude-haiku-4-5-20251001',
    input_per_mtok: 0.25,
    output_per_mtok: 1.25,
    basis:
      'turn.service.ts lines 25-26: COST_PER_INPUT_TOKEN = 0.00000025, COST_PER_OUTPUT_TOKEN = 0.00000125. This value is four times too low.',
    assumed: false,
  },
};

// ---------------------------------------------------------------------------
// Connection.
// ---------------------------------------------------------------------------

function resolvePgConfig() {
  const cfg = {
    host: process.env.PGHOST || '127.0.0.1',
    port: process.env.PGPORT || '',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'umi-transition-local-only',
    database: process.env.PGDATABASE || 'umi_transition_rehearsal_20260901',
    port_source: '',
  };

  if (!cfg.port) {
    const docker = spawnSync('docker', ['port', PG_CONTAINER], { encoding: 'utf8' });
    const text = docker.status === 0 ? String(docker.stdout || '') : '';
    const match = /127\.0\.0\.1:(\d+)/.exec(text) || /:(\d+)\s*$/.exec(text.trim());
    if (match) {
      cfg.port = match[1];
      cfg.port_source = `docker port ${PG_CONTAINER}`;
    }
  }
  if (!cfg.port) {
    cfg.port = '4003';
    cfg.port_source = 'fallback default (docker port did not answer)';
  }
  if (!cfg.port_source) cfg.port_source = 'PGPORT environment variable';
  return cfg;
}

/** Run one SQL statement and read one JSON value from the output. */
function psqlJson(cfg, sql) {
  const result = spawnSync(
    'psql',
    [
      '-h',
      cfg.host,
      '-p',
      cfg.port,
      '-U',
      cfg.user,
      '-d',
      cfg.database,
      '-v',
      'ON_ERROR_STOP=1',
      '-A',
      '-t',
      '-c',
      sql,
    ],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: cfg.password }, timeout: 25000 },
  );
  if (result.error) throw new Error(`psql did not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error((result.stderr || '').trim() || `psql exited with code ${result.status}`);
  }
  const out = String(result.stdout || '').trim();
  if (!out) return null;
  return JSON.parse(out);
}

// ---------------------------------------------------------------------------
// Live data.
// ---------------------------------------------------------------------------

const QUERIES = {
  present: `SELECT json_build_object('present', to_regclass('umi.ai_usage') IS NOT NULL)`,
  totals: `
    SELECT json_build_object(
      'row_count', count(*),
      'turn_count', count(DISTINCT turn_id),
      'conversation_count', count(DISTINCT conversation_id),
      'prompt_tokens', coalesce(sum(prompt_tokens), 0),
      'completion_tokens', coalesce(sum(completion_tokens), 0),
      'llm_call_count', coalesce(sum(llm_call_count), 0),
      'cost_usd', coalesce(sum(cost_usd), 0),
      'avg_latency_ms', coalesce(round(avg(latency_ms)), 0),
      'first_at', min(occurred_at),
      'last_at', max(occurred_at)
    ) FROM umi.ai_usage`,
  by_kind: `
    SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (
      SELECT kind,
             count(*) AS row_count,
             coalesce(sum(prompt_tokens), 0) AS prompt_tokens,
             coalesce(sum(completion_tokens), 0) AS completion_tokens,
             coalesce(sum(cost_usd), 0) AS cost_usd
      FROM umi.ai_usage
      GROUP BY kind
      ORDER BY cost_usd DESC, kind
    ) t`,
  by_model: `
    SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (
      SELECT provider, model,
             count(*) AS row_count,
             coalesce(sum(prompt_tokens), 0) AS prompt_tokens,
             coalesce(sum(completion_tokens), 0) AS completion_tokens,
             coalesce(sum(cost_usd), 0) AS cost_usd
      FROM umi.ai_usage
      GROUP BY provider, model
      ORDER BY cost_usd DESC, model
    ) t`,
  over_time: `
    SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (
      SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day,
             count(*) AS row_count,
             coalesce(sum(cost_usd), 0) AS cost_usd
      FROM umi.ai_usage
      GROUP BY date_trunc('day', occurred_at)
      ORDER BY date_trunc('day', occurred_at)
    ) t`,
};

function readLive(cfg) {
  const presence = psqlJson(cfg, QUERIES.present);
  if (!presence || presence.present !== true) {
    return {
      available: false,
      reason: 'The table umi.ai_usage does not exist yet.',
      row_count: 0,
      totals: null,
      by_kind: [],
      by_model: [],
      over_time: [],
    };
  }
  const totals = psqlJson(cfg, QUERIES.totals);
  if (!totals || Number(totals.row_count) === 0) {
    return {
      available: false,
      reason: 'The table umi.ai_usage exists, but it has no rows yet.',
      row_count: 0,
      totals: totals || null,
      by_kind: [],
      by_model: [],
      over_time: [],
    };
  }
  return {
    available: true,
    reason: '',
    row_count: Number(totals.row_count),
    totals,
    by_kind: psqlJson(cfg, QUERIES.by_kind) || [],
    by_model: psqlJson(cfg, QUERIES.by_model) || [],
    over_time: psqlJson(cfg, QUERIES.over_time) || [],
  };
}

function readFixture(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const totals = raw.totals || null;
  return {
    available: true,
    reason: '',
    row_count: Number((totals && totals.row_count) || raw.row_count || 0),
    totals,
    by_kind: raw.by_kind || [],
    by_model: raw.by_model || [],
    over_time: raw.over_time || [],
  };
}

// ---------------------------------------------------------------------------
// Arithmetic for the measured model.
// ---------------------------------------------------------------------------

function replyInputTokens(iterations) {
  const fixed = MEASURED.reply.system_prompt_tokens + MEASURED.reply.tool_defs_tokens;
  let total = 0;
  for (let k = 1; k <= iterations; k++) {
    const messages =
      MESSAGE_MODEL.base_tokens + MESSAGE_MODEL.growth_per_iteration_tokens * (k - 1);
    total += fixed + messages;
  }
  return total;
}

/** Price a token pair at the list price and at the price in the source. */
function priceCall(inputTokens, outputTokens) {
  const correct =
    (inputTokens / 1e6) * PRICES.correct.input_per_mtok +
    (outputTokens / 1e6) * PRICES.correct.output_per_mtok;
  const code =
    (inputTokens / 1e6) * PRICES.code.input_per_mtok +
    (outputTokens / 1e6) * PRICES.code.output_per_mtok;
  return {
    cost_correct_usd: Number(correct.toFixed(6)),
    cost_code_usd: Number(code.toFixed(6)),
    ratio: Number((correct / code).toFixed(3)),
  };
}

// The live turn runs the reply loop only. The intent call has no caller, so
// its tokens stay out of this ladder. costLadderRow counts the reply loop.
function costLadderRow(iterations) {
  const inputTokens = replyInputTokens(iterations);
  // Output ceiling from the source: each reply step is capped at 900 tokens.
  const outputTokens = MEASURED.reply.max_output_tokens * iterations;
  return {
    iterations,
    input_tokens: inputTokens,
    reply_input_tokens: inputTokens,
    output_tokens_ceiling: outputTokens,
    live_path: true,
    ...priceCall(inputTokens, outputTokens),
  };
}

// The intent call is not on the live path. This block answers one question:
// what would one turn cost if somebody wired the intent call in.
function intentIfWired() {
  const inputTokens = MEASURED.intent.system_prompt_tokens + 25; // plus one short user message
  const outputTokens = MEASURED.intent.max_output_tokens;
  return {
    label: 'Intent extraction, if wired',
    on_live_path: false,
    input_tokens: inputTokens,
    output_tokens_ceiling: outputTokens,
    evidence: MEASURED.intent.evidence,
    ...priceCall(inputTokens, outputTokens),
  };
}

const COST_LADDER = LOOP_ITERATIONS.map(costLadderRow);
const INTENT_IF_WIRED = intentIfWired();

// ---------------------------------------------------------------------------
// Formatting helpers.
// ---------------------------------------------------------------------------

const nf = new Intl.NumberFormat('en-US');
const int = (n) => nf.format(Math.round(Number(n) || 0));

function usd(value) {
  const n = Number(value) || 0;
  if (n === 0) return '$0.00';
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  if (Math.abs(n) >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

function usdPrecise(value) {
  const n = Number(value) || 0;
  return `$${n.toFixed(6)}`;
}

function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Report object. This object is also the JSON file.
// ---------------------------------------------------------------------------

function buildReport(live, cfg) {
  return {
    generated_at: new Date().toISOString(),
    generator: 'scripts/ai-usage-report.mjs',
    database: {
      host: cfg.host,
      port: Number(cfg.port),
      database: cfg.database,
      port_source: cfg.port_source,
    },
    live: {
      available: live.available,
      reason: live.reason,
      row_count: live.row_count,
      totals: live.totals,
      by_kind: live.by_kind,
      by_model: live.by_model,
      over_time: live.over_time,
    },
    measured_model: {
      note: 'Measured from source on 2026-09-18. Not from live traffic.',
      chars_per_token: CHARS_PER_TOKEN,
      intent: MEASURED.intent,
      reply: MEASURED.reply,
      message_model: MESSAGE_MODEL,
      loop_iterations: LOOP_ITERATIONS,
      prices: PRICES,
    },
    // The live path counts the reply loop only. The intent call has no caller.
    live_path: {
      description: 'One live WhatsApp turn runs the tool loop only. It makes no intent call.',
      intent_on_live_path: false,
      intent_evidence: MEASURED.intent.evidence,
    },
    cost_ladder: COST_LADDER,
    intent_if_wired: INTENT_IF_WIRED,
  };
}

// ---------------------------------------------------------------------------
// HTML rendering.
// ---------------------------------------------------------------------------

function statCard(label, value, sub) {
  return `<div class="stat">
      <div class="stat-label">${esc(label)}</div>
      <div class="stat-value">${esc(value)}</div>
      ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ''}
    </div>`;
}

function liveSection(live) {
  if (!live.available) {
    return `<section id="live" class="section">
      <div class="section-head">
        <span class="section-no">1</span>
        <div>
          <h2>Live usage</h2>
          <p class="section-kicker">Usage rows recorded by the API</p>
        </div>
      </div>
      <div class="empty" role="status">
        <p class="empty-title">No live rows exist yet.</p>
        <p>${esc(live.reason)}</p>
        <p class="empty-note">This page shows no live number. The figures below are the measured call model. They come from the source code, not from traffic. The table <code>umi.ai_usage</code> will fill this section after the recorder writes rows.</p>
      </div>
    </section>`;
  }

  const t = live.totals || {};
  const turnCount = Number(t.turn_count) || 0;
  const cost = Number(t.cost_usd) || 0;
  const costPerTurn = turnCount > 0 ? cost / turnCount : 0;
  const promptTokens = Number(t.prompt_tokens) || 0;
  const completionTokens = Number(t.completion_tokens) || 0;

  const kindRows = (live.by_kind || [])
    .map(
      (r) => `<tr>
        <td class="mono">${esc(r.kind)}</td>
        <td class="num">${int(r.row_count)}</td>
        <td class="num">${int(r.prompt_tokens)}</td>
        <td class="num">${int(r.completion_tokens)}</td>
        <td class="num">${usdPrecise(r.cost_usd)}</td>
      </tr>`,
    )
    .join('');

  const modelRows = (live.by_model || [])
    .map(
      (r) => `<tr>
        <td class="mono">${esc(r.provider)}</td>
        <td class="mono">${esc(r.model)}</td>
        <td class="num">${int(r.row_count)}</td>
        <td class="num">${int(r.prompt_tokens)}</td>
        <td class="num">${int(r.completion_tokens)}</td>
        <td class="num">${usdPrecise(r.cost_usd)}</td>
      </tr>`,
    )
    .join('');

  const maxDay = Math.max(1e-9, ...(live.over_time || []).map((d) => Number(d.cost_usd) || 0));
  const dayRows = (live.over_time || [])
    .map((d) => {
      const w = ((Number(d.cost_usd) || 0) / maxDay) * 100;
      return `<tr>
        <td class="mono">${esc(d.day)}</td>
        <td class="num">${int(d.row_count)}</td>
        <td class="num">${usdPrecise(d.cost_usd)}</td>
        <td class="bar-cell"><span class="bar bar-live" style="width:${w.toFixed(1)}%"></span></td>
      </tr>`;
    })
    .join('');

  return `<section id="live" class="section">
    <div class="section-head">
      <span class="section-no">1</span>
      <div>
        <h2>Live usage</h2>
        <p class="section-kicker">Usage rows recorded by the API</p>
      </div>
    </div>

    <div class="stats">
      ${statCard('Total cost', usd(cost), `${int(live.row_count)} rows`)}
      ${statCard('Prompt tokens', int(promptTokens), 'input side')}
      ${statCard('Completion tokens', int(completionTokens), 'output side')}
      ${statCard('Turns', int(turnCount), `${int(t.conversation_count)} conversations`)}
      ${statCard('Cost per turn', usd(costPerTurn), turnCount > 0 ? 'total cost divided by turns' : 'no turns')}
      ${statCard('Model calls', int(t.llm_call_count), `avg ${int(t.avg_latency_ms)} ms`)}
    </div>

    <table class="grid">
      <caption>By kind. Source: live rows in umi.ai_usage. ${int(live.row_count)} rows total. Window ${esc(t.first_at || 'n/a')} to ${esc(t.last_at || 'n/a')}.</caption>
      <thead>
        <tr><th>Kind</th><th class="num">Rows</th><th class="num">Prompt tok</th><th class="num">Completion tok</th><th class="num">Cost</th></tr>
      </thead>
      <tbody>${kindRows || '<tr><td colspan="5" class="muted">No rows.</td></tr>'}</tbody>
    </table>

    <table class="grid">
      <caption>By model. Source: live rows in umi.ai_usage. ${int(live.row_count)} rows total.</caption>
      <thead>
        <tr><th>Provider</th><th>Model</th><th class="num">Rows</th><th class="num">Prompt tok</th><th class="num">Completion tok</th><th class="num">Cost</th></tr>
      </thead>
      <tbody>${modelRows || '<tr><td colspan="6" class="muted">No rows.</td></tr>'}</tbody>
    </table>

    <table class="grid">
      <caption>Cost over time, by day. Source: live rows in umi.ai_usage. ${int(live.row_count)} rows total.</caption>
      <thead>
        <tr><th>Day</th><th class="num">Rows</th><th class="num">Cost</th><th>Share</th></tr>
      </thead>
      <tbody>${dayRows || '<tr><td colspan="4" class="muted">No rows.</td></tr>'}</tbody>
    </table>
  </section>`;
}

function measuredSection() {
  return `<section id="model" class="section">
    <div class="section-head">
      <span class="section-no">2</span>
      <div>
        <h2>Measured call model</h2>
        <p class="section-kicker">Measured from source, not from live traffic</p>
      </div>
    </div>

    <table class="grid">
      <caption>Call sizes. Source: the prompt builders and the loop in apps/umi-api. Measured 2026-09-18. Token counts use ${CHARS_PER_TOKEN} characters per token. The live-path column states which call runs on a real WhatsApp turn.</caption>
      <thead>
        <tr><th>Call</th><th>Live path</th><th>Seam</th><th class="num">System prompt</th><th class="num">Tool schemas</th><th class="num">Max output</th><th class="num">Iterations</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>Intent extraction</td>
          <td><span class="tag tag-signal">not on the live path</span><br><span class="muted">no caller in src or dist</span></td>
          <td class="mono">${esc(MEASURED.intent.seam)}</td>
          <td class="num">${int(MEASURED.intent.system_prompt_chars)} chars<br><span class="muted">about ${int(MEASURED.intent.system_prompt_tokens)} tok</span></td>
          <td class="num muted">none</td>
          <td class="num">${int(MEASURED.intent.max_output_tokens)}</td>
          <td class="num">1</td>
        </tr>
        <tr>
          <td>Reply generation</td>
          <td><span class="tag tag-correct">live</span></td>
          <td class="mono">${esc(MEASURED.reply.seam)}</td>
          <td class="num">${int(MEASURED.reply.system_prompt_chars)} chars<br><span class="muted">about ${int(MEASURED.reply.system_prompt_tokens)} tok</span></td>
          <td class="num">${int(MEASURED.reply.tool_defs_chars)} chars<br><span class="muted">about ${int(MEASURED.reply.tool_defs_tokens)} tok</span></td>
          <td class="num">${int(MEASURED.reply.max_output_tokens)}</td>
          <td class="num">1 to ${MEASURED.reply.max_tool_calls + MEASURED.reply.extra_budget}</td>
        </tr>
      </tbody>
    </table>

    <div class="note">
      <p><strong>The loop resends the prefix.</strong> Each reply iteration sends the system prompt, the tool schemas, and the whole message list again. The loop budget is <code>MAX_TOOL_CALLS_PER_TURN = ${MEASURED.reply.max_tool_calls}</code> plus ${MEASURED.reply.extra_budget} recovery steps, so one turn runs 1 to ${MEASURED.reply.max_tool_calls + MEASURED.reply.extra_budget} iterations. The prefix cost grows with each iteration.</p>
    </div>

    <table class="grid">
      <caption>Prices, in US dollars per one million tokens. Sources: Anthropic list price for Claude Haiku 4.5; the source constants in turn.service.ts lines 25-26.</caption>
      <thead>
        <tr><th>Value</th><th class="num">Input / Mtok</th><th class="num">Output / Mtok</th><th>Ratio to list price</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${esc(PRICES.correct.label)}</td>
          <td class="num">$${PRICES.correct.input_per_mtok.toFixed(2)}</td>
          <td class="num">$${PRICES.correct.output_per_mtok.toFixed(2)}</td>
          <td><span class="tag tag-correct">reference</span></td>
        </tr>
        <tr>
          <td>${esc(PRICES.code.label)}</td>
          <td class="num">$${PRICES.code.input_per_mtok.toFixed(2)}</td>
          <td class="num">$${PRICES.code.output_per_mtok.toFixed(2)}</td>
          <td><span class="tag tag-signal">4x too low</span></td>
        </tr>
      </tbody>
    </table>
  </section>`;
}

function ladderSection() {
  const max = Math.max(1e-9, ...COST_LADDER.map((r) => r.cost_correct_usd));

  const rows = COST_LADDER.map((r) => {
    const wCorrect = (r.cost_correct_usd / max) * 100;
    const wCode = (r.cost_code_usd / max) * 100;
    return `<tr>
        <td class="mono">${r.iterations}</td>
        <td class="num">${int(r.input_tokens)}</td>
        <td class="num">${int(r.output_tokens_ceiling)}</td>
        <td class="num">${usdPrecise(r.cost_correct_usd)}</td>
        <td class="num">${usdPrecise(r.cost_code_usd)}</td>
        <td class="num ratio">${r.ratio.toFixed(2)}x</td>
        <td class="bar-cell">
          <span class="bar bar-correct" style="width:${wCorrect.toFixed(1)}%"></span>
          <span class="bar bar-code" style="width:${wCode.toFixed(1)}%"></span>
        </td>
      </tr>`;
  }).join('');

  // The intent row shares the scale of the ladder above, so a reader can compare
  // the two tables directly.
  const intent = INTENT_IF_WIRED;
  const wIntentCorrect = (intent.cost_correct_usd / max) * 100;
  const wIntentCode = (intent.cost_code_usd / max) * 100;

  return `<section id="ladder" class="section">
    <div class="section-head">
      <span class="section-no">3</span>
      <div>
        <h2>Cost per turn by loop count</h2>
        <p class="section-kicker">Computed from the measured model</p>
      </div>
    </div>

    <div class="legend">
      <span class="legend-item"><span class="swatch swatch-correct"></span>List price</span>
      <span class="legend-item"><span class="swatch swatch-code"></span>Value in source</span>
    </div>

    <table class="grid">
      <caption>Live turn cost, by loop count. Source: the measured model above. This table counts the reply loop only. The intent call is not on the live path, so its tokens are absent here. Input tokens come from the prompt sizes and the message model. Output tokens are the source ceilings, so each value is an upper bound. Assumption: the message list starts at ${int(MESSAGE_MODEL.base_tokens)} tokens and grows ${int(MESSAGE_MODEL.growth_per_iteration_tokens)} tokens per iteration.</caption>
      <thead>
        <tr>
          <th class="num">Loops</th>
          <th class="num">Input tok</th>
          <th class="num">Output tok ceil</th>
          <th class="num">Cost, list</th>
          <th class="num">Cost, source</th>
          <th class="num">Ratio</th>
          <th>Scale</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="note note-signal">
      <p><strong>The source understates the bill by 4x.</strong> The ratio is the same at every loop count, because both prices scale by the same factor. The cost grows with the loop count, because one extra iteration resends the whole prefix.</p>
    </div>

    <h3 class="subhead">Intent extraction, not on the live path</h3>
    <table class="grid">
      <caption>What one turn would cost if the intent call were wired in. Source: the intent prompt size in intent.service.ts, and the same price pair. This figure is separate from the live ladder above. Do not add it to a live total. The scale is shared with the live table, so the two tables compare directly.</caption>
      <thead>
        <tr>
          <th>Call</th>
          <th class="num">Input tok</th>
          <th class="num">Output tok ceil</th>
          <th class="num">Cost, list</th>
          <th class="num">Cost, source</th>
          <th class="num">Ratio</th>
          <th>Scale</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Intent extraction, if wired</td>
          <td class="num">${int(intent.input_tokens)}</td>
          <td class="num">${int(intent.output_tokens_ceiling)}</td>
          <td class="num">${usdPrecise(intent.cost_correct_usd)}</td>
          <td class="num">${usdPrecise(intent.cost_code_usd)}</td>
          <td class="num ratio">${intent.ratio.toFixed(2)}x</td>
          <td class="bar-cell">
            <span class="bar bar-correct" style="width:${wIntentCorrect.toFixed(1)}%"></span>
            <span class="bar bar-code" style="width:${wIntentCode.toFixed(1)}%"></span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>`;
}

function methodSection(report) {
  const db = report.database;
  return `<section id="method" class="section">
    <div class="section-head">
      <span class="section-no">4</span>
      <div>
        <h2>Method</h2>
        <p class="section-kicker">What each number is</p>
      </div>
    </div>
    <dl class="method">
      <dt>Measured from source</dt>
      <dd>Prompt characters, token estimates, maximum output tokens, and the loop budget. Read from the files below on 2026-09-18.</dd>
      <dt>Live path</dt>
      <dd>One live WhatsApp turn runs the tool loop only. It makes no intent call. ${esc(MEASURED.intent.evidence)} The intent figures in section 3 stand apart from the live ladder.</dd>
      <dt>Assumed</dt>
      <dd>${esc(MESSAGE_MODEL.basis)} This value is not measured traffic. It sets the message part of each iteration.</dd>
      <dt>Live</dt>
      <dd>Rows in <code>umi.ai_usage</code>. ${report.live.available ? `Present: ${int(report.live.row_count)} rows.` : 'Absent or empty. This page shows no live number.'}</dd>
      <dt>Database</dt>
      <dd><code>${esc(db.host)}:${db.port}/${esc(db.database)}</code>, port from ${esc(db.port_source)}.</dd>
      <dt>Sources</dt>
      <dd class="mono">${esc(MEASURED.intent.file)}<br>${esc(MEASURED.reply.file)}<br>apps/umi-api/src/modules/conversations/turn.service.ts<br>apps/umi-api/src/modules/conversations/memory.service.ts</dd>
      <dt>Regenerate</dt>
      <dd class="mono">node scripts/ai-usage-report.mjs</dd>
    </dl>
  </section>`;
}

function renderHtml(report) {
  const live = report.live;
  const statusClass = live.available ? 'status-live' : 'status-empty';
  const statusText = live.available ? `Live rows: ${int(live.row_count)}` : 'Live rows: none';
  const generated = report.generated_at.replace('T', ' ').replace(/\..*$/, ' UTC');

  const sections = [
    liveSection(live),
    measuredSection(),
    ladderSection(),
    methodSection(report),
  ].join('\n');
  // Lift each caption above its table, so a narrow screen still shows the
  // source line. The caption stays on the table for a screen reader. Each
  // table also gets its own horizontal scroll container, so the page itself
  // never scrolls sideways.
  const body = sections
    .replace(
      /<table class="grid">\s*<caption>([\s\S]*?)<\/caption>/g,
      (_, caption) =>
        `<p class="table-note">${caption}</p><div class="table-wrap"><table class="grid"><caption class="sr-only">${caption}</caption>`,
    )
    .replace(/<\/table>/g, '</table></div>');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Where the WhatsApp LLM money goes</title>
<style>
  :root {
    --paper: #eef1ef;
    --panel: #ffffff;
    --ink: #141d1a;
    --ink-2: #4d5a55;
    --ink-3: #7c8783;
    --rule: #d5dbd7;
    --rule-strong: #b4bdb8;
    --correct: #14584a;
    --live: #1d4e89;
    --signal: #9e2b4e;
    --signal-bg: #fbeef1;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 14px;
    line-height: 1.5;
  }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 24px 72px; }

  header.masthead { border-bottom: 2px solid var(--ink); padding-bottom: 16px; margin-bottom: 8px; }
  .masthead h1 { font-size: 26px; line-height: 1.15; margin: 0 0 6px; letter-spacing: -0.01em; }
  .masthead .sub { color: var(--ink-2); margin: 0; max-width: 66ch; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 14px; font-family: var(--mono); font-size: 12px; color: var(--ink-2); }
  .status { display: inline-flex; align-items: center; gap: 7px; font-family: var(--mono); font-size: 12px; font-weight: 600; padding: 3px 9px; border: 1px solid var(--rule-strong); border-radius: 2px; background: var(--panel); }
  .status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--ink-3); }
  .status-live::before { background: var(--live); }
  .status-empty::before { background: var(--signal); }

  .section { margin-top: 44px; }
  .section-head { display: flex; gap: 14px; align-items: baseline; border-bottom: 1px solid var(--rule-strong); padding-bottom: 8px; margin-bottom: 18px; }
  .section-no { font-family: var(--mono); font-size: 12px; font-weight: 700; color: var(--panel); background: var(--ink); width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .section-head h2 { font-size: 17px; margin: 0; letter-spacing: -0.005em; }
  .section-kicker { margin: 1px 0 0; color: var(--ink-2); font-size: 12.5px; }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px; background: var(--rule); border: 1px solid var(--rule); margin-bottom: 24px; }
  .stat { background: var(--panel); padding: 12px 14px; }
  .stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-3); }
  .stat-value { font-family: var(--mono); font-size: 21px; font-weight: 600; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .stat-sub { font-size: 11.5px; color: var(--ink-2); margin-top: 2px; }

  .table-wrap { overflow-x: auto; margin: 0 0 26px; border: 1px solid var(--rule); background: var(--panel); }
  table.grid { width: 100%; border-collapse: collapse; margin: 0; background: var(--panel); }
  table.grid caption { caption-side: top; text-align: left; }
  .table-note { margin: 0 0 8px; color: var(--ink-2); font-size: 12px; max-width: 92ch; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  table.grid th, table.grid td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  table.grid thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-2); border-bottom: 1px solid var(--rule-strong); background: #f7f9f8; white-space: nowrap; }
  table.grid tbody tr:last-child td { border-bottom: none; }
  table.grid .num, table.grid th.num { text-align: right; font-family: var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.grid .mono { font-family: var(--mono); font-size: 12.5px; }
  table.grid .ratio { font-weight: 700; color: var(--signal); }
  .muted { color: var(--ink-3); }

  .bar-cell { position: relative; min-width: 130px; }
  .bar { display: block; height: 7px; margin: 3px 0; }
  .bar-correct { background: var(--correct); }
  .bar-code { background: #eabfcc; border: 1px solid var(--signal); height: 7px; }
  .bar-live { background: var(--live); height: 10px; }

  .legend { display: flex; gap: 18px; margin: 0 0 12px; font-size: 12px; color: var(--ink-2); }
  .legend-item { display: inline-flex; align-items: center; gap: 7px; }
  .swatch { width: 16px; height: 8px; display: inline-block; }
  .swatch-correct { background: var(--correct); }
  .swatch-code { border: 1px solid var(--signal); background: #eabfcc; }
  .subhead { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-2); margin: 30px 0 8px; }

  .note { background: var(--panel); border: 1px solid var(--rule); border-left: 3px solid var(--ink); padding: 12px 16px; margin: 0 0 26px; }
  .note p { margin: 0; max-width: 84ch; }
  .note-signal { border-left-color: var(--signal); background: var(--signal-bg); }
  .note code, .empty code, dd code { font-family: var(--mono); font-size: 12.5px; background: #eef1ef; padding: 1px 4px; }

  .empty { background: var(--panel); border: 1px dashed var(--rule-strong); padding: 20px 22px; }
  .empty-title { font-family: var(--mono); font-size: 15px; font-weight: 700; margin: 0 0 8px; color: var(--signal); }
  .empty p { margin: 0 0 8px; max-width: 80ch; }
  .empty-note { color: var(--ink-2); font-size: 12.5px; }

  .tag { font-family: var(--mono); font-size: 11px; padding: 2px 7px; border: 1px solid var(--rule-strong); white-space: nowrap; }
  .tag-correct { color: var(--correct); border-color: var(--correct); }
  .tag-signal { color: var(--signal); border-color: var(--signal); background: var(--signal-bg); }

  dl.method { display: grid; grid-template-columns: 180px 1fr; gap: 0; border: 1px solid var(--rule); background: var(--panel); }
  dl.method dt { padding: 10px 14px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-2); background: #f7f9f8; border-bottom: 1px solid var(--rule); }
  dl.method dd { padding: 10px 14px; margin: 0; border-bottom: 1px solid var(--rule); }
  dl.method dt:last-of-type, dl.method dd:last-of-type { border-bottom: none; }

  footer.foot { margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--rule-strong); color: var(--ink-3); font-size: 12px; display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  button.copy { font-family: var(--mono); font-size: 12px; padding: 5px 12px; border: 1px solid var(--rule-strong); background: var(--panel); color: var(--ink); cursor: pointer; }
  button.copy:hover { border-color: var(--ink); }
  button.copy:focus-visible { outline: 2px solid var(--live); outline-offset: 2px; }

  @media (max-width: 640px) {
    .wrap { padding: 20px 14px 56px; }
    .masthead h1 { font-size: 21px; }
    dl.method { grid-template-columns: 1fr; }
    dl.method dt { border-bottom: none; padding-bottom: 2px; }
    .bar-cell { min-width: 80px; }
  }
  @media print {
    body { background: #fff; }
    .wrap { max-width: none; }
    button.copy { display: none; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<div class="wrap">
  <header class="masthead">
    <h1>Where the WhatsApp LLM money goes</h1>
    <p class="sub">A cost report for the Umi conversation pipeline. The live WhatsApp turn runs the tool loop only. The tool loop resends a large fixed prefix on every iteration. The intent extraction service is present in the code, but it has no caller.</p>
    <div class="meta">
      <span class="status ${statusClass}">${esc(statusText)}</span>
      <span>generated ${esc(generated)}</span>
      <span>model ${esc(PRICES.correct.model)}</span>
    </div>
  </header>

  ${body}

  <footer class="foot">
    <span>Source of figures: apps/umi-api conversation modules and umi.ai_usage. Generated by scripts/ai-usage-report.mjs.</span>
    <button class="copy" id="copy-figures" type="button">Copy figures</button>
  </footer>
</div>
<script id="figures-json" type="application/json">${JSON.stringify(report).replace(/</g, '\\u003c')}</script>
<script>
  (function () {
    var button = document.getElementById('copy-figures');
    if (!button) return;
    button.addEventListener('click', function () {
      var node = document.getElementById('figures-json');
      var text = node ? node.textContent : '';
      var done = function () {
        button.textContent = 'Copied';
        window.setTimeout(function () { button.textContent = 'Copy figures'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { button.textContent = 'Copy failed'; });
      } else {
        button.textContent = 'Copy unavailable';
      }
    });
  })();
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const fixtureIndex = args.indexOf('--fixture');
  const fixturePath = fixtureIndex >= 0 ? args[fixtureIndex + 1] : '';

  if (fixtureIndex >= 0 && !fixturePath) {
    console.error('--fixture needs a file path');
    process.exit(2);
  }

  const cfg = resolvePgConfig();
  let live;
  let mode;

  if (fixturePath) {
    if (!existsSync(fixturePath)) {
      console.error(`fixture not found: ${fixturePath}`);
      process.exit(2);
    }
    live = readFixture(fixturePath);
    mode = `fixture (${fixturePath})`;
  } else {
    try {
      live = readLive(cfg);
      mode = 'database';
    } catch (error) {
      live = {
        available: false,
        reason: `The script could not read the database: ${error.message}`,
        row_count: 0,
        totals: null,
        by_kind: [],
        by_model: [],
        over_time: [],
      };
      mode = 'database (read failed)';
    }
  }

  const report = buildReport(live, cfg);
  const html = renderHtml(report);

  mkdirSync(dirname(OUT_HTML), { recursive: true });
  writeFileSync(OUT_HTML, html, 'utf8');
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log('ai-usage-report');
  console.log(`  mode:      ${mode}`);
  console.log(
    `  database:  ${cfg.host}:${cfg.port}/${cfg.database} (port from ${cfg.port_source})`,
  );
  if (live.available) {
    console.log(`  live rows: ${live.row_count}`);
  } else {
    console.log(`  live rows: none - ${live.reason}`);
  }
  console.log('  live ladder (reply loop only; no intent call):');
  for (const row of COST_LADDER) {
    console.log(
      `    ${String(row.iterations).padStart(2)} loops  list ${usdPrecise(row.cost_correct_usd).padStart(10)}  source ${usdPrecise(row.cost_code_usd).padStart(10)}  ratio ${row.ratio.toFixed(2)}x`,
    );
  }
  console.log('  intent, if wired (separate; not in the ladder):');
  console.log(
    `    1 call   list ${usdPrecise(INTENT_IF_WIRED.cost_correct_usd).padStart(10)}  source ${usdPrecise(INTENT_IF_WIRED.cost_code_usd).padStart(10)}  ratio ${INTENT_IF_WIRED.ratio.toFixed(2)}x`,
  );
  console.log(`  wrote:     ${OUT_HTML}`);
  console.log(`  wrote:     ${OUT_JSON}`);
}

main();
