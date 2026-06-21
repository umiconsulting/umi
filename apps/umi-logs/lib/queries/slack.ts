import { supabase } from '@/lib/supabase'

export interface SlackTransactionRow {
  id: string
  status: string
  total_amount: number | string | null
  details: Record<string, unknown> | null
  slack_message_ts: string | null
  created_at: string
}

export interface TopProduct {
  name: string
  count: number
}

export interface CancellationReason {
  reason: string
  count: number
}

export interface HourlyBucket {
  hour: string      // "07", "08", ...
  count: number
  revenue: number
}

export interface SlackDashboardData {
  ordersToday: SlackTransactionRow[]
  orders7d: SlackTransactionRow[]
  openOrders: SlackTransactionRow[]
  // Revenue
  completedRevenue: number
  averageTicket: number
  pipelineRevenue: number
  // Aggregations
  topProducts: TopProduct[]
  cancellationReasons: CancellationReason[]
  hourlyDistribution: HourlyBucket[]
}

function parseAmount(val: number | string | null): number {
  if (val == null) return 0
  const n = typeof val === 'string' ? Number.parseFloat(val) : val
  return Number.isFinite(n) ? n : 0
}

export async function fetchSlackDashboardData(): Promise<SlackDashboardData> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayIso = today.toISOString()
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const baseColumns = 'id, status, total_amount, details, slack_message_ts, created_at'

  const [{ data: ordersToday }, { data: orders7d }, { data: openOrders }] = await Promise.all([
    supabase
      .from('transactions')
      .select(baseColumns)
      .gte('created_at', todayIso)
      .order('created_at', { ascending: false }),
    supabase
      .from('transactions')
      .select(baseColumns)
      .gte('created_at', since7d)
      .order('created_at', { ascending: false }),
    supabase
      .from('transactions')
      .select(baseColumns)
      .in('status', ['pending', 'in_progress', 'ready'])
      .order('created_at', { ascending: false }),
  ])

  const todayRows = (ordersToday ?? []) as SlackTransactionRow[]
  const weekRows = (orders7d ?? []) as SlackTransactionRow[]
  const open = (openOrders ?? []) as SlackTransactionRow[]

  // Revenue metrics
  const completed = todayRows.filter((r) => r.status === 'completed')
  const completedRevenue = completed.reduce((s, r) => s + parseAmount(r.total_amount), 0)
  const averageTicket = completed.length > 0 ? completedRevenue / completed.length : 0
  const pipelineRevenue = open.reduce((s, r) => s + parseAmount(r.total_amount), 0)

  // Top products (from today, non-cancelled items)
  const productCounts: Record<string, number> = {}
  for (const r of todayRows) {
    if (r.status === 'cancelled') continue
    const items = (r.details as any)?.items ?? []
    for (const item of items) {
      if (item.cancelled) continue
      const name = item.product_name ?? 'Unknown'
      productCounts[name] = (productCounts[name] ?? 0) + (item.quantity ?? 1)
    }
  }
  const topProducts = Object.entries(productCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // Cancellation reasons
  const reasonCounts: Record<string, number> = {}
  for (const r of todayRows) {
    if (r.status !== 'cancelled') continue
    const reason = (r.details as any)?.cancellation_reason ?? 'Sin motivo'
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1
  }
  const cancellationReasons = Object.entries(reasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)

  // Hourly distribution (today)
  const hourBuckets: Record<string, { count: number; revenue: number }> = {}
  for (const r of todayRows) {
    const h = new Date(r.created_at).getHours().toString().padStart(2, '0')
    hourBuckets[h] ??= { count: 0, revenue: 0 }
    hourBuckets[h].count += 1
    hourBuckets[h].revenue += parseAmount(r.total_amount)
  }
  const hourlyDistribution = Object.entries(hourBuckets)
    .map(([hour, data]) => ({ hour, ...data }))
    .sort((a, b) => a.hour.localeCompare(b.hour))

  return {
    ordersToday: todayRows,
    orders7d: weekRows,
    openOrders: open,
    completedRevenue,
    averageTicket,
    pipelineRevenue,
    topProducts,
    cancellationReasons,
    hourlyDistribution,
  }
}
