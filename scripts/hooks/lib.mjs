import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';

export function defaultMetricsPath() {
  return (
    process.env.UMI_HOOKS_METRICS_PATH ||
    join(
      process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'),
      'umi-hooks',
      'metrics.jsonl',
    )
  );
}

export function readHookPayload() {
  const raw = readFileSync(0, 'utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

export function extractToolInfo(payload) {
  const toolName = String(payload?.toolCall?.name ?? payload?.tool_name ?? '').trim();
  const args = payload?.toolCall?.args ?? payload?.tool_input ?? {};
  const command = String(args?.CommandLine ?? args?.command ?? '');
  const path = String(args?.Path ?? args?.file_path ?? args?.path ?? '');
  return { toolName, args, command, path };
}

/**
 * Append one privacy-safe JSONL metric row.
 * Never logs raw commands, arguments, or file contents — only rule/decision metadata.
 */
export function recordMetric({
  hook,
  event,
  decision,
  rule,
  startedAt,
  payload,
  metricsPath = defaultMetricsPath(),
}) {
  try {
    mkdirSync(dirname(metricsPath), { recursive: true, mode: 0o700 });
    const entry = {
      ts: new Date().toISOString(),
      hook,
      event,
      decision,
      rule,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      tool: payload?.toolCall?.name ?? payload?.tool_name ?? null,
      conversationId:
        typeof payload?.conversationId === 'string'
          ? payload.conversationId.slice(0, 12)
          : typeof payload?.session_id === 'string'
            ? payload.session_id.slice(0, 12)
            : null,
    };
    appendFileSync(metricsPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } catch {
    // Metrics must never break or block the hook itself.
  }
}

export function emitJson(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}
