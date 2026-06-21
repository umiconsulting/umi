import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { fetchInvocationById } from '@/lib/queries/invocations'
import { fetchFunctionLogs } from '@/lib/logsApi'
import { StatusBadge } from '@/components/StatusBadge'
import { Breadcrumb } from '@/components/layout/Breadcrumb'
import { CorrelationBadge } from '@/components/forensic/CorrelationBadge'
import { LiveLogs } from '@/app/(dashboard)/functions/LiveLogs'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function InvocationDetailPage({ params }: PageProps) {
  const { id } = await params

  const [log, liveLogs] = await Promise.all([
    fetchInvocationById(id),
    fetchFunctionLogs(24, 300),
  ])

  if (!log) return notFound()

  const short = id.slice(0, 8)

  const fields: { label: string; value: string | null; accent?: string }[] = [
    { label: 'function', value: log.function_name },
    { label: 'status', value: log.status, accent: log.status === 'error' ? 'var(--status-error)' : 'var(--status-active)' },
    { label: 'duration', value: log.duration_ms != null ? `${log.duration_ms} ms` : null },
    { label: 'time', value: new Date(log.created_at).toLocaleString() },
    { label: 'error', value: log.error_message, accent: 'var(--status-error)' },
  ]

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Functions', href: '/functions' },
          { label: `${short}…` },
        ]}
      />

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>
          Invocation
        </h1>
        <span className="font-mono text-sm" style={{ color: 'var(--foreground)' }}>
          {id}
        </span>
      </div>

      {/* Detail card */}
      <div
        className="p-4 mb-6"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
        }}
      >
        <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: '12px' }}>
          <tbody>
            {fields.map(({ label, value, accent }) =>
              value != null ? (
                <tr key={label}>
                  <td
                    className="py-1.5 pr-6 font-mono align-top"
                    style={{ color: 'var(--text-dim)', width: '120px' }}
                  >
                    {label}
                  </td>
                  <td
                    className="py-1.5 font-mono"
                    style={{ color: accent ?? 'var(--foreground)' }}
                  >
                    {value}
                  </td>
                </tr>
              ) : null
            )}
            {log.request_id && (
              <tr>
                <td className="py-1.5 pr-6 font-mono" style={{ color: 'var(--text-dim)', width: '120px' }}>
                  trace
                </td>
                <td className="py-1.5">
                  <CorrelationBadge requestId={log.request_id} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Status badge row */}
      <div className="flex items-center gap-2 mb-6">
        <StatusBadge status={log.status} />
        {log.request_id && (
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            → view full trace for this request
          </span>
        )}
      </div>

      {/* Live logs filtered to this request */}
      <Suspense
        fallback={
          <div
            className="py-6 text-center text-xs"
            style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }}
          >
            loading execution logs…
          </div>
        }
      >
        <LiveLogs result={liveLogs} />
      </Suspense>
    </div>
  )
}
