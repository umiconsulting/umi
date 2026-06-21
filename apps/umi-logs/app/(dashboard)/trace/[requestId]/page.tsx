import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { fetchTraceByRequestId } from '@/lib/queries/trace'
import { assembleTrace } from '@/lib/parsers/traceAssembler'
import { TraceTimeline } from '@/components/trace/TraceTimeline'
import { TraceExportButtons } from '@/components/trace/TraceExportButtons'
import { Breadcrumb } from '@/components/layout/Breadcrumb'
import type { TraceTree } from '@/types/trace'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ requestId: string }>
}

function MetricStrip({ trace }: { trace: TraceTree }) {
  const errorCount = trace.spans.filter((s) => s.status === 'error').length
  const totalTokens = trace.spans
    .filter((s) => s.type === 'claude_api_call')
    .reduce((sum, s) => sum + ((s.attributes.total_tokens as number | null) ?? 0), 0)
  const totalCost = trace.spans
    .filter((s) => s.type === 'claude_api_call')
    .reduce((sum, s) => sum + ((s.attributes.cost_usd as number | null) ?? 0), 0)

  const stats: { label: string; value: string; color?: string }[] = [
    { label: 'Total duration', value: `${trace.totalDuration} ms` },
    { label: 'Spans', value: String(trace.spans.length) },
    {
      label: 'Errors',
      value: String(errorCount),
      color: errorCount > 0 ? 'var(--status-error)' : undefined,
    },
    { label: 'Tokens', value: totalTokens > 0 ? totalTokens.toLocaleString() : '—' },
    { label: 'Cost', value: totalCost > 0 ? `$${totalCost.toFixed(5)}` : '—' },
  ]

  return (
    <div
      className="grid grid-cols-5 gap-px mb-4"
      style={{
        background: 'var(--border)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}
    >
      {stats.map((s) => (
        <div
          key={s.label}
          className="px-3 py-2"
          style={{ background: 'var(--surface-1)' }}
        >
          <p className="text-[10px] uppercase mb-0.5" style={{ color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
            {s.label}
          </p>
          <p
            className="font-mono text-sm font-medium"
            style={{ color: s.color ?? 'var(--foreground)' }}
          >
            {s.value}
          </p>
        </div>
      ))}
    </div>
  )
}

async function TraceContent({ requestId }: { requestId: string }) {
  const rows = await fetchTraceByRequestId(requestId)

  if (!rows.edgeFunctionLog && rows.aiTurnLogs.length === 0 && rows.securityLogs.length === 0) {
    return notFound()
  }

  const trace = assembleTrace(requestId, rows)

  return (
    <>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1">
          <MetricStrip trace={trace} />
        </div>
        <TraceExportButtons trace={trace} />
      </div>
      <TraceTimeline trace={trace} />
    </>
  )
}

export default async function TracePage({ params }: PageProps) {
  const { requestId } = await params
  const short = requestId.slice(0, 8)

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Functions', href: '/functions' },
          { label: `Trace ${short}…` },
        ]}
      />

      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>
          Trace
        </h1>
        <span className="font-mono text-sm" style={{ color: 'var(--foreground)' }}>
          {requestId}
        </span>
      </div>

      <Suspense
        fallback={
          <div
            className="h-48 flex items-center justify-center text-xs"
            style={{ color: 'var(--text-dim)', background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
          >
            assembling trace…
          </div>
        }
      >
        <TraceContent requestId={requestId} />
      </Suspense>
    </div>
  )
}
