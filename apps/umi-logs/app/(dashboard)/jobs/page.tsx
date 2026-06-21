import { fetchJobs, fetchWorkflowMetrics } from '@/lib/queries/workflow'
import { MetricCard } from '@/components/MetricCard'
import { StatusBadge } from '@/components/StatusBadge'
import { RetryButton } from './RetryButton'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ state?: string; type?: string }>
}

export default async function JobsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const stateFilter = params.state || undefined
  const typeFilter = params.type || undefined

  const [jobs, metrics] = await Promise.all([
    fetchJobs({ limit: 50, state: stateFilter, jobType: typeFilter }),
    fetchWorkflowMetrics(),
  ])

  const tabs = [
    { label: 'All', state: undefined, count: null },
    { label: 'Pending', state: 'pending', count: metrics.pendingJobs },
    { label: 'Running', state: 'running', count: metrics.runningJobs },
    { label: 'Dead', state: 'dead', count: metrics.deadJobs },
  ]

  return (
    <div>
      <h1
        className="text-sm font-medium mb-6"
        style={{ color: 'var(--foreground)' }}
      >
        Job Queue
      </h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6">
        {tabs.map((tab) => {
          const isActive = stateFilter === tab.state || (!stateFilter && !tab.state)
          return (
            <a
              key={tab.label}
              href={tab.state ? `/jobs?state=${tab.state}` : '/jobs'}
              className="px-3 py-1.5 text-[10px] uppercase tracking-wider rounded"
              style={{
                color: isActive ? 'var(--foreground)' : 'var(--text-dim)',
                background: isActive ? 'var(--surface-1)' : 'transparent',
                border: isActive ? '1px solid var(--border)' : '1px solid transparent',
                textDecoration: 'none',
              }}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className="ml-1" style={{ color: tab.state === 'dead' ? 'var(--status-error)' : 'var(--text-secondary)' }}>
                  {tab.count}
                </span>
              )}
            </a>
          )
        })}
      </div>

      <div style={{ border: '1px solid var(--ruled-line)', borderRadius: '4px' }}>
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ruled-line)' }}>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Created</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Type</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>State</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Attempts</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Error</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} style={{ borderBottom: '1px solid var(--ruled-line)' }}>
                <td className="px-3 py-2" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                  {new Date(job.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                </td>
                <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-primary)', fontSize: '11px' }}>{job.job_type}</td>
                <td className="px-3 py-2"><StatusBadge status={job.state} /></td>
                <td className="px-3 py-2" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                  {job.attempt_count}/{job.max_attempts}
                </td>
                <td className="px-3 py-2 max-w-[200px] truncate" style={{ color: 'var(--status-error)', fontSize: '10px' }}>
                  {job.error ?? '—'}
                </td>
                <td className="px-3 py-2">
                  {job.state === 'dead' && <RetryButton jobId={job.id} />}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center" style={{ color: 'var(--text-dim)' }}>
                  No jobs {stateFilter ? `in "${stateFilter}" state` : 'found'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
