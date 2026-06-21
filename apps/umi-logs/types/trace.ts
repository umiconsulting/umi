// ── Trace / span types for request reconstruction ───────────────────────────

export type SpanStatus = 'ok' | 'error' | 'warning' | 'unknown'

export type SpanType =
  | 'security_validation'
  | 'memory_tier1'
  | 'memory_tier2'
  | 'memory_tier3'
  | 'claude_api_call'
  | 'tool_call'
  | 'twilio_send'
  | 'root'

export interface TraceSpan {
  id: string
  name: string
  type: SpanType
  start_ms: number         // offset from trace start
  duration_ms: number
  status: SpanStatus
  attributes: Record<string, unknown>
  parentId: string | null
}

export interface TraceTree {
  requestId: string
  rootSpan: TraceSpan
  spans: TraceSpan[]
  totalDuration: number    // ms
  status: SpanStatus
  startedAt: string        // ISO timestamp
}

// Raw rows returned from the DB before assembly
export interface TraceRawRows {
  edgeFunctionLog: {
    id: string
    function_name: string
    status: string
    duration_ms: number | null
    error_message: string | null
    request_id: string
    created_at: string
  } | null
  aiTurnLogs: Array<{
    id: string
    request_id: string | null
    response_type: string | null
    prompt_tokens: number | null
    completion_tokens: number | null
    total_tokens: number | null
    cost_usd: number | null
    latency_ms: number | null
    created_at: string
  }>
  securityLogs: Array<{
    id: string
    request_id: string | null
    event_type: string
    details: string | null
    created_at: string
  }>
  messages: Array<{
    id: string
    twilio_message_sid: string | null
    role: string
    content: string
    created_at: string
  }>
}
