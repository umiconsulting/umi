import { supabase } from '@/lib/supabase'
import { fetchFunctionLogs } from '@/lib/logsApi'
import { MetricCard } from '@/components/MetricCard'
import { FunctionsFilters } from './FunctionsFilters'
import { LiveLogs } from './LiveLogs'
import { InvocationsTableClient } from './InvocationsTableClient'

export const dynamic = 'force-dynamic'

type TimeRange = '1h' | '6h' | '24h' | '7d'

function getTimeRangeStart(range: TimeRange): string {
  const ms: Record<TimeRange, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  }
  return new Date(Date.now() - ms[range]).toISOString()
}

interface PageProps {
  searchParams: Promise<{ fn?: string; status?: string; range?: string }>
}

export default async function FunctionsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const range = (params.range as TimeRange) || '24h'
  const fnFilter = params.fn
  const statusFilter = params.status
  const since = getTimeRangeStart(range)

  // Initial data fetch (server-side) — first page only
  let logsQuery = supabase
    .from('edge_function_logs')
    .select('id, function_name, status, duration_ms, error_message, created_at, request_id')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(51) // 50 + 1 to detect next page

  if (fnFilter) logsQuery = logsQuery.eq('function_name', fnFilter)
  if (statusFilter) logsQuery = logsQuery.eq('status', statusFilter)

  const [rows, distinctFnsData, liveLogs] = await Promise.all([
    logsQuery.then(({ data }) => data ?? []),

    supabase
      .from('edge_function_logs')
      .select('function_name')
      .gte('created_at', getTimeRangeStart('7d'))
      .then(({ data }) => [...new Set((data ?? []).map((r) => r.function_name))].sort()),

    fetchFunctionLogs(24, 300),
  ])

  const firstPage = rows.slice(0, 50)
  const hasNextPage = rows.length > 50
  const lastRow = firstPage[firstPage.length - 1]
  const initialCursor = hasNextPage && lastRow
    ? `${lastRow.created_at}||${lastRow.id}`
    : null

  const total = firstPage.length
  const errors = firstPage.filter((r) => r.status === 'error').length
  const successRate = total > 0 ? (((total - errors) / total) * 100).toFixed(1) + '%' : '—'
  const avgLatency = total > 0
    ? Math.round(firstPage.reduce((s, r) => s + (r.duration_ms ?? 0), 0) / total) + ' ms'
    : '—'

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>
          Function Health
        </h1>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)', opacity: 0.5 }}>
          — invocations · execution trace
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <MetricCard title="Success rate" value={successRate} />
        <MetricCard title="Avg latency" value={avgLatency} />
        <MetricCard
          title="Total errors"
          value={errors}
          variant={errors > 0 ? 'error' : 'default'}
        />
      </div>

      <FunctionsFilters
        distinctFns={distinctFnsData}
        currentFn={fnFilter}
        currentStatus={statusFilter}
        currentRange={range}
      />

      {/* Virtualized invocation table with cursor pagination */}
      <div className="mt-4 mb-8">
        <InvocationsTableClient
          initialData={firstPage}
          initialCursor={initialCursor}
          filters={{ fnFilter, statusFilter, timeRange: range }}
        />
      </div>

      {/* Native Supabase execution trace */}
      <LiveLogs result={liveLogs} />
    </div>
  )
}
