import { fetchInboundEvents, fetchWorkflowMetrics } from '@/lib/queries/workflow'
import { MetricCard } from '@/components/MetricCard'
import { StatusBadge } from '@/components/StatusBadge'

export const dynamic = 'force-dynamic'

export default async function WorkflowPage() {
  const [events, metrics] = await Promise.all([
    fetchInboundEvents({ limit: 50 }),
    fetchWorkflowMetrics(),
  ])

  return (
    <div>
      <h1
        className="text-sm font-medium mb-6"
        style={{ color: 'var(--foreground)' }}
      >
        Workflow
      </h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-0 mb-8" style={{ border: '1px solid var(--ruled-line)', borderRadius: '4px' }}>
        <MetricCard
          title="Pending Jobs"
          value={metrics.pendingJobs}
          variant={metrics.pendingJobs > 50 ? 'warning' : 'default'}
          href="/jobs?state=pending"
        />
        <MetricCard
          title="Dead Letters"
          value={metrics.deadJobs}
          variant={metrics.deadJobs > 0 ? 'error' : 'positive'}
          href="/jobs?state=dead"
        />
        <MetricCard
          title="Outbox Pending"
          value={metrics.pendingOutbox}
          variant={metrics.pendingOutbox > 30 ? 'warning' : 'default'}
          href="/outbox?state=pending"
        />
        <MetricCard
          title="Delivered (24h)"
          value={metrics.deliveredOutbox24h}
          variant="positive"
          href="/outbox?state=delivered"
        />
      </div>

      <h2
        className="text-xs uppercase tracking-widest mb-3"
        style={{ color: 'var(--text-dim)' }}
      >
        Inbound Events
      </h2>

      <div style={{ border: '1px solid var(--ruled-line)', borderRadius: '4px' }}>
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ruled-line)' }}>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Time</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Source</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Type</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Status</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Event ID</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} style={{ borderBottom: '1px solid var(--ruled-line)' }}>
                <td className="px-3 py-2" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                  {new Date(event.received_at).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                </td>
                <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{event.source}</td>
                <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{event.event_type}</td>
                <td className="px-3 py-2"><StatusBadge status={event.status} /></td>
                <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-dim)', fontSize: '10px' }}>
                  {event.source_event_id?.slice(0, 16) ?? '—'}
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center" style={{ color: 'var(--text-dim)' }}>
                  No inbound events yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
