import { supabase } from '@/lib/supabase'
import type { TraceRawRows } from '@/types/trace'

export async function fetchTraceByRequestId(requestId: string): Promise<TraceRawRows> {
  const [
    { data: edgeLogs },
    { data: aiTurnLogs },
    { data: securityLogs },
    { data: messages },
  ] = await Promise.all([
    supabase
      .from('edge_function_logs')
      .select('id, function_name, status, duration_ms, error_message, request_id, created_at')
      .eq('request_id', requestId)
      .limit(1),
    supabase
      .from('ai_turn_logs')
      .select('id, request_id, response_type, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, created_at')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true }),
    supabase
      .from('security_logs')
      .select('id, request_id, event_type, details, created_at')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true }),
    // messages don't have request_id — fetch via conversation_id from edge log context
    // return empty for now; traceAssembler handles absence gracefully
    Promise.resolve({ data: [] }),
  ])

  return {
    edgeFunctionLog: edgeLogs?.[0] ?? null,
    aiTurnLogs: (aiTurnLogs ?? []) as TraceRawRows['aiTurnLogs'],
    securityLogs: (securityLogs ?? []) as TraceRawRows['securityLogs'],
    messages: (messages ?? []) as TraceRawRows['messages'],
  }
}
