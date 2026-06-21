import { fetchOutboxItems, fetchWorkflowMetrics } from '@/lib/queries/workflow'
import { StatusBadge } from '@/components/StatusBadge'
import { MetricCard } from '@/components/MetricCard'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ state?: string; kind?: string }>
}

export default async function OutboxPage({ searchParams }: PageProps) {
  const params = await searchParams
  const stateFilter = params.state || undefined
  const kindFilter = params.kind || undefined

  const [items, metrics] = await Promise.all([
    fetchOutboxItems({ limit: 50, state: stateFilter, kind: kindFilter }),
    fetchWorkflowMetrics(),
  ])

  const tabs = [
    { label: 'All', state: undefined },
    { label: 'Pending', state: 'pending' },
    { label: 'Delivered', state: 'delivered' },
    { label: 'Dead', state: 'dead' },
  ]

  return (
    <div>
      <h1
        className="text-sm font-medium mb-6"
        style={{ color: 'var(--foreground)' }}
      >
        Outbox
      </h1>

      <div className="grid grid-cols-3 gap-0 mb-6" style={{ border: '1px solid var(--ruled-line)', borderRadius: '4px' }}>
        <MetricCard title="Pending" value={metrics.pendingOutbox} variant={metrics.pendingOutbox > 30 ? 'warning' : 'default'} />
        <MetricCard title="Delivered (24h)" value={metrics.deliveredOutbox24h} variant="positive" />
        <MetricCard title="Dead" value={metrics.failedOutbox} variant={metrics.failedOutbox > 0 ? 'error' : 'default'} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6">
        {tabs.map((tab) => {
          const isActive = stateFilter === tab.state || (!stateFilter && !tab.state)
          return (
            <a
              key={tab.label}
              href={tab.state ? `/outbox?state=${tab.state}` : '/outbox'}
              className="px-3 py-1.5 text-[10px] uppercase tracking-wider rounded"
              style={{
                color: isActive ? 'var(--foreground)' : 'var(--text-dim)',
                background: isActive ? 'var(--surface-1)' : 'transparent',
                border: isActive ? '1px solid var(--border)' : '1px solid transparent',
                textDecoration: 'none',
              }}
            >
              {tab.label}
            </a>
          )
        })}
      </div>

      <div style={{ border: '1px solid var(--ruled-line)', borderRadius: '4px' }}>
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ruled-line)' }}>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Created</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Kind</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>State</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Attempts</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Delivered</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Error</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={{ borderBottom: '1px solid var(--ruled-line)' }}>
                <td className="px-3 py-2" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                  {new Date(item.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                </td>
                <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-primary)', fontSize: '11px' }}>{item.kind}</td>
                <td className="px-3 py-2"><StatusBadge status={item.state} /></td>
                <td className="px-3 py-2" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                  {item.attempts}/{item.max_attempts}
                </td>
                <td className="px-3 py-2" style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
                  {item.delivered_at
                    ? new Date(item.delivered_at).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                    : '—'}
                </td>
                <td className="px-3 py-2 max-w-[200px] truncate" style={{ color: 'var(--status-error)', fontSize: '10px' }}>
                  {item.error ?? '—'}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center" style={{ color: 'var(--text-dim)' }}>
                  No outbox items {stateFilter ? `in "${stateFilter}" state` : 'found'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
