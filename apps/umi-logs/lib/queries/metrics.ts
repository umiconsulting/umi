import { supabase } from '@/lib/supabase'
import { getActiveBusinessId } from '@/lib/auth'

export interface SystemMetrics {
  invocationsToday: number
  errorsToday: number
  errorRate: string
  costToday: number
  costMonth: number
  activeConversations: number
  newCustomersToday: number
  totalMessages: number
  withEmbedding: number
  securityCount: number
  injectionCount: number
}

export async function fetchSystemMetrics(): Promise<SystemMetrics> {
  const businessId = await getActiveBusinessId()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayIso = today.toISOString()
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [
    { data: invocationsToday },
    { data: errorsToday },
    { data: costToday },
    { data: costMonth },
    { count: activeConvos },
    { count: newCustomers },
    { count: totalMessages },
    { count: withEmbedding },
    { data: securityEvents24h },
  ] = await Promise.all([
    supabase.from('edge_function_logs').select('id').gte('created_at', todayIso),
    supabase.from('edge_function_logs').select('id').gte('created_at', todayIso).eq('status', 'error'),
    supabase.from('ai_turn_logs').select('cost_usd').eq('business_id', businessId).gte('created_at', todayIso),
    supabase.from('ai_turn_logs').select('cost_usd').eq('business_id', businessId).gte('created_at', thisMonthStart),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('business_id', businessId).eq('status', 'active'),
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('business_id', businessId).gte('created_at', todayIso),
    supabase.from('messages').select('*', { count: 'exact', head: true }),
    supabase.from('messages').select('*', { count: 'exact', head: true }).not('embedding', 'is', null),
    supabase.from('security_logs').select('id, event_type').gte('created_at', since24h),
  ])

  const totalInvocations = invocationsToday?.length ?? 0
  const totalErrors = errorsToday?.length ?? 0

  return {
    invocationsToday: totalInvocations,
    errorsToday: totalErrors,
    errorRate: totalInvocations > 0
      ? ((totalErrors / totalInvocations) * 100).toFixed(1) + '%'
      : '—',
    costToday: (costToday ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0),
    costMonth: (costMonth ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0),
    activeConversations: activeConvos ?? 0,
    newCustomersToday: newCustomers ?? 0,
    totalMessages: totalMessages ?? 0,
    withEmbedding: withEmbedding ?? 0,
    securityCount: securityEvents24h?.length ?? 0,
    injectionCount: securityEvents24h?.filter((e) => e.event_type === 'prompt_injection_attempt').length ?? 0,
  }
}
