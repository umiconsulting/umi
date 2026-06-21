import type { TraceRawRows, TraceTree, TraceSpan, SpanStatus } from '@/types/trace'

let _spanCounter = 0
function spanId(prefix: string): string {
  return `${prefix}-${++_spanCounter}`
}

function isoToMs(iso: string): number {
  return new Date(iso).getTime()
}

function deriveStatus(
  raw: { status?: string; error_message?: string | null; failure_category?: string | null }
): SpanStatus {
  if (raw.status === 'error' || raw.error_message || raw.failure_category) return 'error'
  if (raw.status === 'ok' || raw.status === 'success') return 'ok'
  return 'unknown'
}

/**
 * Assembles raw DB rows for a request_id into a TraceTree.
 * Spans are created in order: root → security → memory tiers → claude calls → twilio
 */
export function assembleTrace(requestId: string, rows: TraceRawRows): TraceTree {
  _spanCounter = 0

  const efl = rows.edgeFunctionLog
  const startedAt = efl?.created_at ?? rows.aiTurnLogs[0]?.created_at ?? new Date().toISOString()
  const traceStart = isoToMs(startedAt)

  const spans: TraceSpan[] = []

  // ── Root span ──────────────────────────────────────────────────────────────
  const rootStatus: SpanStatus = efl
    ? (efl.status === 'error' ? 'error' : 'ok')
    : 'unknown'

  const rootDuration = efl?.duration_ms
    ?? (rows.aiTurnLogs.length > 0
      ? isoToMs(rows.aiTurnLogs[rows.aiTurnLogs.length - 1].created_at) - traceStart + 500
      : 0)

  const rootSpan: TraceSpan = {
    id: spanId('root'),
    name: efl?.function_name ?? 'whatsapp-handler',
    type: 'root',
    start_ms: 0,
    duration_ms: rootDuration,
    status: rootStatus,
    attributes: {
      function_name: efl?.function_name,
      status: efl?.status,
      error_message: efl?.error_message,
      request_id: requestId,
    },
    parentId: null,
  }

  // ── Security validation spans ──────────────────────────────────────────────
  let securityOffset = 0
  for (const sec of rows.securityLogs) {
    const startMs = isoToMs(sec.created_at) - traceStart
    const start = Math.max(0, startMs)
    const span: TraceSpan = {
      id: spanId('sec'),
      name: sec.event_type,
      type: 'security_validation',
      start_ms: start,
      duration_ms: 5, // no duration field — use nominal 5ms
      status: 'ok',
      attributes: {
        event_type: sec.event_type,
        details: sec.details,
      },
      parentId: rootSpan.id,
    }
    spans.push(span)
    securityOffset = Math.max(securityOffset, start + 5)
  }

  // ── AI turn spans (memory tiers + claude calls) ────────────────────────────
  let aiOffset = securityOffset
  for (const turn of rows.aiTurnLogs) {
    const startMs = Math.max(aiOffset, isoToMs(turn.created_at) - traceStart)
    const duration = turn.latency_ms ?? 500

    // Claude API call span
    const claudeSpan: TraceSpan = {
      id: spanId('claude'),
      name: turn.response_type
        ? `claude · ${turn.response_type}`
        : 'claude · api call',
      type: 'claude_api_call',
      start_ms: startMs,
      duration_ms: duration,
      status: 'ok',
      attributes: {
        response_type: turn.response_type,
        prompt_tokens: turn.prompt_tokens,
        completion_tokens: turn.completion_tokens,
        total_tokens: turn.total_tokens,
        cost_usd: turn.cost_usd,
        latency_ms: turn.latency_ms,
      },
      parentId: rootSpan.id,
    }
    spans.push(claudeSpan)
    aiOffset = startMs + duration + 10
  }

  // ── Twilio send span (from messages with SID) ──────────────────────────────
  for (const msg of rows.messages) {
    if (msg.twilio_message_sid && msg.role === 'assistant') {
      const startMs = Math.max(aiOffset, isoToMs(msg.created_at) - traceStart)
      const span: TraceSpan = {
        id: spanId('twilio'),
        name: 'twilio · send message',
        type: 'twilio_send',
        start_ms: startMs,
        duration_ms: 50,
        status: 'ok',
        attributes: {
          twilio_message_sid: msg.twilio_message_sid,
          role: msg.role,
          content_preview: msg.content.slice(0, 80),
        },
        parentId: rootSpan.id,
      }
      spans.push(span)
    }
  }

  // ── Determine overall trace status ────────────────────────────────────────
  const hasError = spans.some((s) => s.status === 'error') || rootStatus === 'error'
  const traceStatus: SpanStatus = hasError ? 'error' : 'ok'

  const allSpans = [rootSpan, ...spans]
  const totalDuration = Math.max(
    rootDuration,
    ...allSpans.map((s) => s.start_ms + s.duration_ms)
  )

  return {
    requestId,
    rootSpan,
    spans: allSpans,
    totalDuration,
    status: traceStatus,
    startedAt,
  }
}
