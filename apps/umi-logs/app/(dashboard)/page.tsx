import { supabase } from '@/lib/supabase'
import { getActiveBusinessId } from '@/lib/auth'
import { MetricCard } from '@/components/MetricCard'
import Link from 'next/link'
import { Zap, Cpu, MessageSquare, Users, Database, ShieldAlert, ListTodo, Send } from 'lucide-react'
import { fetchOpenOrders } from '@/lib/queries/orders'
import { fetchWorkflowMetrics } from '@/lib/queries/workflow'
import { OrderPipeline } from '@/components/operations'

export const revalidate = 60

export default async function OverviewPage() {
  const businessId = await getActiveBusinessId()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayIso = today.toISOString()
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const last7DaysStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

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
    { data: invocations7d },
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
    supabase
      .from('edge_function_logs')
      .select('created_at, status')
      .gte('created_at', last7DaysStart)
      .order('created_at', { ascending: true }),
  ])

  const totalInvocations = invocationsToday?.length ?? 0
  const totalErrors = errorsToday?.length ?? 0
  const errorRate = totalInvocations > 0
    ? ((totalErrors / totalInvocations) * 100).toFixed(1) + '%'
    : '—'

  const totalCostToday = (costToday ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0)
  const totalCostMonth = (costMonth ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0)

  const missingEmbeddings = (totalMessages ?? 0) - (withEmbedding ?? 0)
  const coveragePct = totalMessages
    ? (((withEmbedding ?? 0) / totalMessages) * 100).toFixed(1)
    : '100'

  const securityCount = securityEvents24h?.length ?? 0
  const injectionCount = securityEvents24h?.filter((e) => e.event_type === 'prompt_injection_attempt').length ?? 0

  // ── 7-day activity chart data ──────────────────────────────────────────
  const days: { date: string; label: string; total: number; errors: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    d.setHours(0, 0, 0, 0)
    days.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en', { weekday: 'short' }).slice(0, 3).toUpperCase(),
      total: 0,
      errors: 0,
    })
  }
  for (const row of invocations7d ?? []) {
    const date = row.created_at.slice(0, 10)
    const bucket = days.find((d) => d.date === date)
    if (bucket) {
      bucket.total++
      if (row.status === 'error') bucket.errors++
    }
  }
  const maxTotal = Math.max(...days.map((d) => d.total), 1)

  let pipelineOrders: Awaited<ReturnType<typeof fetchOpenOrders>> = []
  let workflowMetrics: Awaited<ReturnType<typeof fetchWorkflowMetrics>> | null = null
  try {
    pipelineOrders = await fetchOpenOrders()
  } catch {
    // transactions table may not exist yet — degrade gracefully
  }
  try {
    workflowMetrics = await fetchWorkflowMetrics()
  } catch {
    // workflow tables may not exist yet — degrade gracefully
  }

  const now = new Date()
  const timeStr = now.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

  return (
    <div>
      {/* Narrative header */}
      <h1
        className="mb-6"
        style={{
          fontFamily: 'var(--font-serif), serif',
          fontSize: 'var(--text-narrative)',
          fontWeight: 400,
          color: 'var(--text-primary)',
          lineHeight: 1.3,
        }}
      >
        System Pulse
      </h1>

      {/* Page subheader */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              background: 'var(--status-active)',
              animation: 'pulse-live 2s ease-in-out infinite',
            }}
          />
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--status-active)' }}>
            Live
          </span>
        </div>
        <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-dim)' }}>
          {timeStr}
        </span>
      </div>

      {/* Alert banners */}
      {missingEmbeddings > 0 && (
        <Link href="/memory" style={{ textDecoration: 'none', display: 'block' }} className="mb-3">
          <div
            className="px-4 py-3 text-xs flex items-center justify-between transition-colors"
            style={{
              borderLeft: '3px solid var(--status-pending)',
              background: 'color-mix(in srgb, var(--status-pending), transparent 94%)',
            }}
          >
            <span style={{ color: 'var(--status-pending)' }}>
              {missingEmbeddings} message{missingEmbeddings !== 1 ? 's' : ''} missing embeddings — Tier 2 semantic search may be degraded
            </span>
            <span className="text-[10px] opacity-60" style={{ color: 'var(--status-pending)' }}>
              View Memory →
            </span>
          </div>
        </Link>
      )}
      {injectionCount > 0 && (
        <Link href="/security" style={{ textDecoration: 'none', display: 'block' }} className="mb-3">
          <div
            className="px-4 py-3 text-xs flex items-center justify-between"
            style={{
              borderLeft: '3px solid var(--status-error)',
              background: 'color-mix(in srgb, var(--status-error), transparent 95%)',
            }}
          >
            <span style={{ color: 'var(--status-error)' }}>
              {injectionCount} prompt injection attempt{injectionCount !== 1 ? 's' : ''} detected in the last 24 hours
            </span>
            <span className="text-[10px] opacity-60" style={{ color: 'var(--status-error)' }}>
              View Security →
            </span>
          </div>
        </Link>
      )}

      {/* Metric grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
        <MetricCard
          title="Invocations today"
          value={totalInvocations}
          sub={`${totalErrors} errors · ${errorRate} error rate`}
          icon={<Zap size={14} />}
          variant={totalErrors > 0 ? 'warning' : 'default'}
          href="/functions"
        />
        <MetricCard
          title="AI cost today"
          value={`$${totalCostToday.toFixed(4)}`}
          sub={`$${totalCostMonth.toFixed(4)} this month`}
          icon={<Cpu size={14} />}
          variant="default"
          href="/ai"
        />
        <MetricCard
          title="Active conversations"
          value={activeConvos ?? 0}
          icon={<MessageSquare size={14} />}
          variant="default"
          href="/conversations"
        />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        <MetricCard
          title="New customers today"
          value={newCustomers ?? 0}
          icon={<Users size={14} />}
          variant="default"
          href="/customers"
        />
        <MetricCard
          title="Embedding coverage"
          value={`${coveragePct}%`}
          sub={missingEmbeddings > 0 ? `${missingEmbeddings} missing` : `${totalMessages ?? 0} messages embedded`}
          icon={<Database size={14} />}
          variant={missingEmbeddings > 0 ? 'warning' : 'positive'}
          href="/memory"
        />
        <MetricCard
          title="Security events (24h)"
          value={securityCount}
          sub={injectionCount > 0 ? `${injectionCount} injection attempts` : 'No injection attempts'}
          icon={<ShieldAlert size={14} />}
          variant={injectionCount > 0 ? 'error' : securityCount > 0 ? 'warning' : 'default'}
          href="/security"
        />
      </div>

      {/* Workflow health */}
      {workflowMetrics && (
        <>
          {workflowMetrics.deadJobs > 0 && (
            <Link href="/jobs?state=dead" style={{ textDecoration: 'none', display: 'block' }} className="mb-3">
              <div
                className="px-4 py-3 text-xs flex items-center justify-between"
                style={{
                  borderLeft: '3px solid var(--status-error)',
                  background: 'color-mix(in srgb, var(--status-error), transparent 95%)',
                }}
              >
                <span style={{ color: 'var(--status-error)' }}>
                  {workflowMetrics.deadJobs} dead job{workflowMetrics.deadJobs !== 1 ? 's' : ''} — requires attention
                </span>
                <span className="text-[10px] opacity-60" style={{ color: 'var(--status-error)' }}>
                  View Jobs →
                </span>
              </div>
            </Link>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            <MetricCard
              title="Pending Jobs"
              value={workflowMetrics.pendingJobs}
              icon={<ListTodo size={14} />}
              variant={workflowMetrics.pendingJobs > 50 ? 'warning' : 'default'}
              href="/jobs?state=pending"
            />
            <MetricCard
              title="Outbox Pending"
              value={workflowMetrics.pendingOutbox}
              icon={<Send size={14} />}
              variant={workflowMetrics.pendingOutbox > 30 ? 'warning' : 'default'}
              href="/outbox?state=pending"
            />
            <MetricCard
              title="Delivered (24h)"
              value={workflowMetrics.deliveredOutbox24h}
              variant="positive"
              href="/outbox?state=delivered"
            />
          </div>
        </>
      )}

      {/* 7-day activity chart */}
      <div
        className="p-4"
        style={{ borderBottom: '1px solid var(--ruled-line)' }}
      >
        <p
          className="text-[10px] uppercase mb-4"
          style={{ color: 'var(--text-dim)', letterSpacing: '0.1em' }}
        >
          Invocation Activity · Last 7 Days
        </p>

        <div className="flex items-end gap-2" style={{ height: '64px' }}>
          {days.map((day) => {
            const barHeightPx = day.total > 0
              ? Math.max(Math.round((day.total / maxTotal) * 52), 3)
              : 0
            return (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-1.5">
                <div className="w-full flex items-end" style={{ height: '52px' }}>
                  {day.total > 0 ? (
                    <div
                      className="w-full relative"
                      style={{ height: `${barHeightPx}px` }}
                    >
                      <div
                        className="absolute inset-0"
                        style={{ background: 'var(--status-active)', opacity: 0.65 }}
                      />
                      {day.errors > 0 && (
                        <div
                          className="absolute bottom-0 left-0 right-0"
                          style={{
                            height: `${(day.errors / day.total) * 100}%`,
                            background: 'var(--status-error)',
                            opacity: 0.85,
                          }}
                        />
                      )}
                    </div>
                  ) : (
                    <div
                      className="w-full"
                      style={{ height: '1px', background: 'var(--ruled-line)' }}
                    />
                  )}
                </div>
                <span
                  className="text-[9px] uppercase"
                  style={{ color: 'var(--text-dim)' }}
                >
                  {day.label}
                </span>
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3">
          <div className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: 'var(--status-active)', opacity: 0.65 }}
            />
            <span className="text-[9px] uppercase" style={{ color: 'var(--text-dim)' }}>
              Success
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: 'var(--status-error)', opacity: 0.85 }}
            />
            <span className="text-[9px] uppercase" style={{ color: 'var(--text-dim)' }}>
              Errors
            </span>
          </div>
        </div>
      </div>

      {/* Order pipeline */}
      {pipelineOrders.length > 0 && (
        <div
          className="p-4 mt-3"
          style={{ borderBottom: '1px solid var(--ruled-line)' }}
        >
          <p
            className="text-[10px] uppercase mb-4"
            style={{ color: 'var(--text-dim)', letterSpacing: '0.1em' }}
          >
            Order Pipeline · Today
          </p>
          <OrderPipeline orders={pipelineOrders} />
        </div>
      )}
    </div>
  )
}
