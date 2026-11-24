import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { emitJson, extractToolInfo, readHookPayload, recordMetric } from './lib.mjs';

const PKILL_F = /\bpkill\b[^\n;|&]*(?:\s-[a-zA-Z]*f|\s--full\b)/;
const HYPRCTL_LEGACY = /\bhyprctl\s+dispatch\s+(?:workspace|focuswindow)\b/;

export function evaluateGotchaGuard({ toolName, command, path }) {
  if (toolName === 'read_file' && path.startsWith('/tmp/')) {
    return {
      decision: 'deny',
      metricDecision: 'deny',
      rule: 'read-file-tmp',
      reason:
        'gotcha-guard: /tmp es efímero por llamada y read_file resuelve bajo el workspace. Guarda artefactos bajo /home/juan/... en vez de /tmp/.',
    };
  }
  if (command && PKILL_F.test(command)) {
    return {
      decision: 'deny',
      metricDecision: 'deny',
      rule: 'pkill-f-self-kill',
      reason:
        'gotcha-guard: `pkill -f` mata la shell llamadora porque coincide con su propia línea de comando. Usa `pkill -x <proceso>`.',
    };
  }
  if (command && HYPRCTL_LEGACY.test(command)) {
    return {
      decision: 'deny',
      metricDecision: 'deny',
      rule: 'hyprctl-legacy-dispatcher',
      reason:
        "gotcha-guard: Hyprland en esta máquina usa dispatchers Lua (ej. `hyprctl dispatch 'hl.dsp.focus({workspace = 2})'`), no la sintaxis vieja.",
    };
  }
  return { decision: 'ask', metricDecision: 'pass', rule: 'clean' };
}

function main() {
  const startedAt = performance.now();
  let payload = {};
  try {
    payload = readHookPayload();
  } catch {
    recordMetric({
      hook: 'gotcha-guard',
      event: 'PreToolUse',
      decision: 'ask',
      rule: 'parse-error',
      startedAt,
      payload,
    });
    emitJson({ decision: 'ask' });
    return;
  }

  const info = extractToolInfo(payload);
  const verdict = evaluateGotchaGuard(info);
  recordMetric({
    hook: 'gotcha-guard',
    event: 'PreToolUse',
    decision: verdict.metricDecision,
    rule: verdict.rule,
    startedAt,
    payload,
  });

  const response = { decision: verdict.decision };
  if (verdict.reason) response.reason = verdict.reason;
  emitJson(response);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
