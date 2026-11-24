import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { emitJson, extractToolInfo, readHookPayload, recordMetric } from './lib.mjs';

const PROD_DB_REF =
  /supabase-prod-db-url|\.umi-prod-postgres-env|aws-1-us-east-2\.pooler\.supabase\.com/i;
const PROD_DB_WRITE =
  /\b(pg_restore|insert\s+into|update\s+|delete\s+from|drop\s+|alter\s+|truncate\s+|create\s+(?:table|index|schema|function|role)|grant\s+|revoke\s+)\b|db\/migrate\.sh|db\/00_run\.sh/i;
const PROD_CONTAINER_MUTATION =
  /\bdocker\s+(?:stop|rm|kill|restart|pause|compose\s+(?:down|up|restart))\b[^\n]*\bumi-api-umi-(?:api|worker)-1\b|\bumi-api-umi-(?:api|worker)-1\b[^\n]*\b(stop|rm|kill|restart)\b/i;
const CF_DEPLOY_MAIN =
  /\bwrangler\b[^\n]*\bpages\s+deploy\b(?=[^\n]*--project-name(?:=|\s+)(?:umi-landing|umi-pos-downloads|umi-dashboard)\b)(?=[^\n]*--branch(?:=|\s+)main\b)/i;
const GIT_FORCE_PUSH_PROTECTED =
  /\bgit\s+push\b(?=[^\n]*(?:--force(?:-with-lease)?|\s-f\b))(?=[^\n]*\b(?:main|staging)\b)/i;
const GIT_PUSH_MAIN = /\bgit\s+push\b[^\n]*\b(?:origin\s+)?(?:[\w./-]+:)?main\b/i;

export function evaluateProdGuard(command) {
  if (!command) {
    return { decision: 'ask', metricDecision: 'pass', rule: 'empty' };
  }
  if (GIT_FORCE_PUSH_PROTECTED.test(command)) {
    return {
      decision: 'deny',
      metricDecision: 'deny',
      rule: 'git-force-push-protected',
      reason: 'prod-guard: bloqueado force-push hacia main/staging.',
    };
  }
  if (GIT_PUSH_MAIN.test(command)) {
    return {
      decision: 'force_ask',
      metricDecision: 'force_ask',
      rule: 'git-push-main',
      reason:
        'prod-guard: comando intenta hacer git push a main (producción). Confirma antes de ejecutar.',
    };
  }
  if (PROD_CONTAINER_MUTATION.test(command)) {
    return {
      decision: 'force_ask',
      metricDecision: 'force_ask',
      rule: 'prod-container-mutation',
      reason:
        'prod-guard: comando intenta modificar/reiniciar contenedores de producción (umi-api-umi-*). Confirma antes de ejecutar.',
    };
  }
  if (CF_DEPLOY_MAIN.test(command)) {
    return {
      decision: 'force_ask',
      metricDecision: 'force_ask',
      rule: 'cf-deploy-main',
      reason:
        'prod-guard: comando intenta desplegar a Cloudflare Pages en rama main (producción). Confirma antes de ejecutar.',
    };
  }
  if (PROD_DB_REF.test(command) && PROD_DB_WRITE.test(command)) {
    return {
      decision: 'force_ask',
      metricDecision: 'force_ask',
      rule: 'prod-db-write',
      reason:
        'prod-guard: comando combina referencia a Supabase producción con posible escritura/DDL. Confirma antes de ejecutar.',
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
      hook: 'prod-guard',
      event: 'PreToolUse',
      decision: 'force_ask',
      rule: 'parse-error-fail-closed',
      startedAt,
      payload,
    });
    emitJson({
      decision: 'force_ask',
      reason: 'prod-guard: payload inválido; confirmación requerida (fail-closed).',
    });
    return;
  }

  const { command } = extractToolInfo(payload);
  const verdict = evaluateProdGuard(command);
  recordMetric({
    hook: 'prod-guard',
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
