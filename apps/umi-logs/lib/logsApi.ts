const PROJECT_REF = process.env.SUPABASE_PROJECT_REF!
const MANAGEMENT_TOKEN = process.env.SUPABASE_MANAGEMENT_TOKEN!

export interface FunctionLogEvent {
  id: string
  timestamp: number // microseconds
  event_message: string
  event_type: 'Boot' | 'Log' | 'Shutdown' | string
  level: 'log' | 'info' | 'warn' | 'error' | string
  function_id: string
}

export type ParsedLogKind =
  | 'boot'
  | 'shutdown'
  | 'incoming'
  | 'claude_initial'     // structured: first AI response
  | 'claude_next'        // structured: subsequent AI response after tool
  | 'tool_call'
  | 'tool_result'
  | 'final_response'
  | 'memory_retrieval'   // structured: vector search / tier retrieval
  | 'initial_response'   // legacy heuristic alias
  | 'next_response'      // legacy heuristic alias
  | 'other'

export interface ParsedLogEvent extends FunctionLogEvent {
  kind: ParsedLogKind
  shortMessage: string
  isError: boolean
  // Structured fields — null when parser_mode is 'heuristic' or field absent:
  requestId: string | null
  correlationId: string | null
  tokenCounts: {
    input: number
    output: number
    cacheRead: number
    cacheCreation: number
  } | null
  latencyMs: number | null
  retrievalScore: number | null
  failureCategory: string | null
  customerId: string | null
  conversationId: string | null
  parserMode: 'structured' | 'heuristic'
}

// ── Structured parser ──────────────────────────────────────────────────────

function mapStructuredKind(eventKind: string | undefined): ParsedLogKind {
  switch (eventKind) {
    case 'incoming':         return 'incoming'
    case 'claude_initial':   return 'claude_initial'
    case 'claude_next':      return 'claude_next'
    case 'tool_call':        return 'tool_call'
    case 'tool_result':      return 'tool_result'
    case 'final_response':   return 'final_response'
    case 'memory_retrieval': return 'memory_retrieval'
    default:                 return 'other'
  }
}

function structuredShortMessage(
  parsed: Record<string, unknown>,
  kind: ParsedLogKind,
  tokenCounts: ParsedLogEvent['tokenCounts'],
  latencyMs: number | null,
  retrievalScore: number | null,
  failureCategory: string | null,
): string {
  const lat = latencyMs != null ? `${latencyMs}ms` : null

  switch (kind) {
    case 'incoming': {
      const phone = (parsed.phone as string) ?? (parsed.from as string) ?? ''
      return `Msg from ${phone}`
    }
    case 'claude_initial':
    case 'claude_next': {
      if (tokenCounts) {
        const { input, output } = tokenCounts
        const parts = [`${input}t → ${output}t`]
        if (lat) parts.push(lat)
        return `Claude · ${parts.join(' · ')}`
      }
      return lat ? `Claude · ${lat}` : 'Claude response'
    }
    case 'tool_call': {
      const toolName = (parsed.tool_name as string) ?? (parsed.name as string) ?? ''
      return `Tool: ${toolName}`
    }
    case 'tool_result': {
      const success = parsed.success !== false
      const base = success ? 'Result: ok' : 'Result: failed'
      const parts = [base]
      if (lat) parts.push(lat)
      if (!success && failureCategory) parts.push(failureCategory)
      return parts.join(' · ')
    }
    case 'final_response': {
      const text = ((parsed.text ?? parsed.message ?? '') as string).slice(0, 80)
      return text + (text.length >= 80 ? '…' : '')
    }
    case 'memory_retrieval': {
      const tier = (parsed.tier as number | string) ?? ''
      const score = retrievalScore != null ? `score=${retrievalScore.toFixed(2)}` : null
      const parts: string[] = ['Memory']
      if (tier) parts.push(`tier${tier}`)
      if (score) parts.push(score)
      return parts.join(' · ')
    }
    default: {
      const msg = (parsed.message ?? parsed.msg ?? '') as string
      return (msg || String(parsed.event_kind ?? parsed.phase ?? 'event')).slice(0, 80)
    }
  }
}

function parseStructuredEvent(event: FunctionLogEvent, parsed: Record<string, unknown>): ParsedLogEvent {
  const eventKind = (parsed.event_kind as string | undefined) ?? (parsed.phase as string | undefined)
  const kind = mapStructuredKind(eventKind)

  const rawTokens = parsed.tokens as Record<string, number> | null | undefined
  const tokenCounts = rawTokens
    ? {
        input: rawTokens.input ?? 0,
        output: rawTokens.output ?? 0,
        cacheRead: rawTokens.cache_read ?? 0,
        cacheCreation: rawTokens.cache_creation ?? 0,
      }
    : null

  const latencyMs = typeof parsed.latency_ms === 'number' ? parsed.latency_ms : null
  const retrievalScore = typeof parsed.retrieval_score === 'number' ? parsed.retrieval_score : null
  const failureCategory = typeof parsed.failure_category === 'string' ? parsed.failure_category : null
  const requestId = typeof parsed.request_id === 'string' ? parsed.request_id : null
  const correlationId = typeof parsed.correlation_id === 'string' ? parsed.correlation_id : null
  const customerId = typeof parsed.customer_id === 'string' ? parsed.customer_id : null
  const conversationId = typeof parsed.conversation_id === 'string' ? parsed.conversation_id : null

  const isError =
    event.level === 'error' ||
    parsed.success === false ||
    failureCategory != null

  return {
    ...event,
    kind,
    shortMessage: structuredShortMessage(parsed, kind, tokenCounts, latencyMs, retrievalScore, failureCategory),
    isError,
    requestId,
    correlationId,
    tokenCounts,
    latencyMs,
    retrievalScore,
    failureCategory,
    customerId,
    conversationId,
    parserMode: 'structured',
  }
}

// ── Heuristic (legacy) parser ──────────────────────────────────────────────

function detectKindHeuristic(event: FunctionLogEvent): ParsedLogKind {
  if (event.event_type === 'Boot') return 'boot'
  if (event.event_type === 'Shutdown') return 'shutdown'
  const msg = event.event_message
  if (msg.startsWith('📱')) return 'incoming'
  if (msg.startsWith('📊 Initial response')) return 'initial_response'
  if (msg.startsWith('🔧 Processing')) return 'tool_call'
  if (msg.startsWith('  - ')) return 'tool_call'
  if (msg.startsWith('  ✅ Result')) return 'tool_result'
  if (msg.startsWith('🔄 Next response')) return 'next_response'
  if (msg.startsWith('💬 Final response')) return 'final_response'
  return 'other'
}

function shortMessageHeuristic(event: FunctionLogEvent, kind: ParsedLogKind): string {
  const msg = event.event_message.trim()
  const first = msg.split('\n')[0]
  if (kind === 'boot') return `Booted — ${msg.match(/\d+ms/)?.[0] ?? ''}`
  if (kind === 'shutdown') return 'Shutdown'
  if (kind === 'incoming') return first.replace('📱 Message from', 'Msg from')
  if (kind === 'initial_response') return 'Claude → initial response'
  if (kind === 'tool_call') return first.replace(/^\s+-\s+/, 'Tool: ')
  if (kind === 'tool_result') return first.replace('  ✅ Result:', 'Result:').trim()
  if (kind === 'next_response') return 'Claude → response after tool'
  if (kind === 'final_response') {
    const text = msg.replace('💬 Final response:', '').trim().slice(0, 80)
    return text + (text.length >= 80 ? '…' : '')
  }
  return first.slice(0, 80)
}

function parseHeuristicEvent(event: FunctionLogEvent): ParsedLogEvent {
  const kind = detectKindHeuristic(event)
  const isError =
    event.level === 'error' ||
    (kind === 'tool_result' && event.event_message.includes('success: false')) ||
    (kind === 'tool_result' && event.event_message.includes('error:'))

  return {
    ...event,
    kind,
    shortMessage: shortMessageHeuristic(event, kind),
    isError,
    requestId: null,
    correlationId: null,
    tokenCounts: null,
    latencyMs: null,
    retrievalScore: null,
    failureCategory: null,
    customerId: null,
    conversationId: null,
    parserMode: 'heuristic',
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export function parseEvents(events: FunctionLogEvent[]): ParsedLogEvent[] {
  return events.map((e) => {
    if (e.event_type === 'Boot') return parseHeuristicEvent(e)
    if (e.event_type === 'Shutdown') return parseHeuristicEvent(e)
    try {
      const parsed = JSON.parse(e.event_message)
      if (parsed && typeof parsed === 'object') {
        return parseStructuredEvent(e, parsed as Record<string, unknown>)
      }
    } catch {
      // not JSON — fall through to heuristic
    }
    return parseHeuristicEvent(e)
  })
}

export type LogsResult =
  | { status: 'ok'; events: ParsedLogEvent[] }
  | { status: 'no_token' }
  | { status: 'fetch_error'; httpStatus: number }
  | { status: 'no_activity' }

export async function fetchFunctionLogs(
  hoursBack = 24,
  limit = 300
): Promise<LogsResult> {
  if (!PROJECT_REF || !MANAGEMENT_TOKEN || MANAGEMENT_TOKEN === 'your-management-token-here') {
    return { status: 'no_token' }
  }

  const end = new Date()
  const start = new Date(end.getTime() - hoursBack * 60 * 60 * 1000)

  const sql = `
    SELECT
      f.id,
      f.timestamp,
      f.event_message,
      m.event_type,
      m.level,
      m.function_id
    FROM function_logs f
    CROSS JOIN UNNEST(f.metadata) AS m
    ORDER BY f.timestamp DESC
    LIMIT ${limit}
  `

  const params = new URLSearchParams({
    sql,
    iso_timestamp_start: start.toISOString(),
    iso_timestamp_end: end.toISOString(),
  })

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/analytics/endpoints/logs.all?${params}`,
    {
      headers: { Authorization: `Bearer ${MANAGEMENT_TOKEN}` },
      cache: 'no-store',
    }
  )

  if (!res.ok) return { status: 'fetch_error', httpStatus: res.status }

  const json = await res.json()
  const raw: FunctionLogEvent[] = json.result ?? []

  if (raw.length === 0) return { status: 'no_activity' }

  return { status: 'ok', events: parseEvents(raw) }
}
