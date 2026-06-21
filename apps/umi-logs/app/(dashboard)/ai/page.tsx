import { supabase } from '@/lib/supabase'
import { getActiveBusinessId } from '@/lib/auth'
import { fetchAnthropicUsage, type AnthropicResult } from '@/lib/anthropicApi'
import { MetricCard } from '@/components/MetricCard'
import { StatusBadge } from '@/components/StatusBadge'
import {
  DailyCostChart, TokensByTypeChart,
  CostComparisonChart, TokenStackChart,
} from '@/components/CostChart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

// ── Linear regression helper ─────────────────────────────────────────────────

function linearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number } {
  const n = points.length
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0 }
  const sumX = points.reduce((s, p) => s + p.x, 0)
  const sumY = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0)
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

// Anthropic Admin API takes ~3-4 minutes to respond — cache for 1 hour
export const revalidate = 3600

function AnthropicNotice({ result }: { result: AnthropicResult }) {
  if (result.status === 'no_key') {
    return (
      <div className="border border-border p-3 mb-4 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
        Add <code className="bg-muted px-1 rounded">ANTHROPIC_ADMIN_KEY</code> to{' '}
        <code className="bg-muted px-1 rounded">.env.local</code> to see official Anthropic metrics.
        Get it at <strong>console.anthropic.com → Settings → Admin API keys</strong>.
      </div>
    )
  }
  if (result.status === 'network_error') {
    const isTimeout = result.message.includes('timed out')
    return (
      <div className="border p-3 mb-4 text-xs font-mono" style={{ borderColor: 'var(--status-error)', color: 'var(--text-secondary)' }}>
        <span className="font-medium" style={{ color: 'var(--status-error)' }}>
          {isTimeout ? 'Anthropic Admin API unreachable (timeout).' : 'Connection to Anthropic API failed.'}
        </span>{' '}
        {isTimeout
          ? 'The /v1/organizations/ endpoints may be network-restricted from your current IP or region.'
          : 'Check network access and try again.'}
      </div>
    )
  }
  if (result.status === 'auth_error') {
    return (
      <div className="border p-3 mb-4 text-xs font-mono" style={{ borderColor: 'var(--status-error)', color: 'var(--text-secondary)' }}>
        <span className="font-medium" style={{ color: 'var(--status-error)' }}>Admin key rejected (401/403).</span>{' '}
        Ensure <code className="bg-muted px-1 rounded">ANTHROPIC_ADMIN_KEY</code> is an Admin API key
        (starts with <code className="bg-muted px-1 rounded">sk-ant-admin</code>), not a regular API key.
      </div>
    )
  }
  if (result.status === 'api_error') {
    return (
      <div className="border p-3 mb-4 text-xs font-mono" style={{ borderColor: 'var(--status-error)', color: 'var(--text-secondary)' }}>
        <span className="font-medium" style={{ color: 'var(--status-error)' }}>Anthropic API error ({result.httpStatus}).</span>{' '}
        Check server logs for details.
      </div>
    )
  }
  return null
}

export default async function AiPage() {
  const businessId = await getActiveBusinessId()
  const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: monthLogs }, { data: allLogs }, anthropicResult] = await Promise.all([
    supabase.from('ai_turn_logs').select('cost_usd, conversation_id').eq('business_id', businessId).gte('created_at', thisMonthStart),
    supabase
      .from('ai_turn_logs')
      .select('id, conversation_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, response_type, created_at')
      .eq('business_id', businessId)
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(500),
    fetchAnthropicUsage(30),
  ])

  const anthropic = anthropicResult.status === 'ok' ? anthropicResult.data : null

  const rows = allLogs ?? []
  const monthRows = monthLogs ?? []

  // ── Computed metrics (from ai_turn_logs) ──────────────────────────────────

  const computedMonthSpend = monthRows.reduce((s, r) => s + (r.cost_usd ?? 0), 0)
  const uniqueConvos = new Set(monthRows.map((r) => r.conversation_id)).size
  const avgCostPerConvo = uniqueConvos > 0 ? computedMonthSpend / uniqueConvos : 0
  const latencyRows = rows.filter((r) => r.latency_ms != null)
  const avgLatency = latencyRows.length > 0
    ? Math.round(latencyRows.reduce((s, r) => s + r.latency_ms, 0) / latencyRows.length)
    : 0

  // Daily cost chart (computed)
  const dailyCostMap: Record<string, number> = {}
  for (const r of rows) {
    const day = r.created_at.slice(0, 10)
    dailyCostMap[day] = (dailyCostMap[day] ?? 0) + (r.cost_usd ?? 0)
  }
  const dailyCostData = Object.entries(dailyCostMap)
    .map(([date, cost]) => ({ date: date.slice(5), cost }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // ── Token budget forecasting (linear regression) ──────────────────────────
  const sortedDays = Object.keys(dailyCostMap).sort()
  const regressionPoints = sortedDays.map((date, i) => ({ x: i, y: dailyCostMap[date] }))
  const { slope } = linearRegression(regressionPoints)
  const avgDailyCost = sortedDays.length > 0
    ? Object.values(dailyCostMap).reduce((s, v) => s + v, 0) / sortedDays.length
    : 0
  const projectedMonthly = avgDailyCost * 30
  const trendDir = slope > 0.00001 ? 'up' : slope < -0.00001 ? 'down' : 'flat'
  const projectedNote = trendDir === 'up'
    ? `trending up ${(slope * 100 / Math.max(avgDailyCost, 0.00001)).toFixed(0)}%/day`
    : trendDir === 'down'
    ? `trending down ${(Math.abs(slope) * 100 / Math.max(avgDailyCost, 0.00001)).toFixed(0)}%/day`
    : 'stable'

  // Tokens by response type
  const tokensByType: Record<string, number> = {}
  for (const r of rows) {
    const type = r.response_type ?? 'unknown'
    tokensByType[type] = (tokensByType[type] ?? 0) + (r.total_tokens ?? 0)
  }
  const tokensByTypeData = Object.entries(tokensByType)
    .map(([response_type, tokens]) => ({ response_type, tokens }))
    .sort((a, b) => b.tokens - a.tokens)

  // ── Anthropic comparison data ─────────────────────────────────────────────

  const comparisonData = anthropic
    ? (() => {
        const officialByDate: Record<string, number> = {}
        for (const b of anthropic.dailyCost) officialByDate[b.date.slice(5)] = b.cost_usd

        const allDates = new Set([
          ...dailyCostData.map((d) => d.date),
          ...Object.keys(officialByDate),
        ])

        return [...allDates]
          .sort()
          .map((date) => ({
            date,
            computed: dailyCostMap[`2026-${date}`] ?? dailyCostMap[Object.keys(dailyCostMap).find(k => k.endsWith(date)) ?? ''] ?? 0,
            official: officialByDate[date] ?? 0,
          }))
      })()
    : []

  const tokenStackData = anthropic
    ? anthropic.dailyUsage.map((b) => ({
        date: b.date.slice(5),
        input: b.input_tokens,
        output: b.output_tokens,
        cache_read: b.cache_read_tokens,
        cache_creation: b.cache_creation_tokens,
      }))
    : []

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>AI Cost Tracker</h1>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)', opacity: 0.5 }}>— 30d · ai_turn_logs + anthropic api</span>
      </div>

      {/* ── Computed metrics ── */}
      <div className="grid grid-cols-3 gap-4 mb-3">
        <MetricCard title="Computed spend (month)" value={`$${computedMonthSpend.toFixed(4)}`} sub={`${uniqueConvos} conversations`} icon="✦" />
        <MetricCard title="Avg cost / conversation" value={`$${avgCostPerConvo.toFixed(4)}`} />
        <MetricCard title="Avg latency" value={`${avgLatency} ms`} />
      </div>

      {/* ── Token budget forecast ── */}
      {avgDailyCost > 0 && (
        <div
          className="flex items-center gap-4 px-4 py-3 mb-6 text-xs"
          style={{
            border: '1px solid var(--border)',
            borderLeft: `3px solid ${trendDir === 'up' ? 'var(--status-pending)' : trendDir === 'down' ? 'var(--status-active)' : 'var(--border)'}`,
            background: 'var(--surface-1)',
            borderRadius: 'var(--radius)',
          }}
        >
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Forecast
          </span>
          <span style={{ color: 'var(--foreground)' }}>
            At this rate:{' '}
            <strong style={{ color: trendDir === 'up' ? 'var(--status-pending)' : 'var(--status-active)' }}>
              ${projectedMonthly.toFixed(4)}/month
            </strong>
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>
            avg ${avgDailyCost.toFixed(5)}/day · {projectedNote}
          </span>
          {trendDir === 'up' && (
            <span style={{ color: 'var(--status-pending)' }}>↑ increasing</span>
          )}
          {trendDir === 'down' && (
            <span style={{ color: 'var(--status-active)' }}>↓ decreasing</span>
          )}
        </div>
      )}

      {/* ── Anthropic official metrics ── */}
      {anthropic ? (
        <>
          <p className="text-[10px] uppercase tracking-[0.15em] mb-3 mt-4" style={{ color: 'var(--text-dim)' }}>Anthropic official <span className="normal-case tracking-normal opacity-60">· admin api</span></p>
          <div className="grid grid-cols-4 gap-4 mb-6">
            <MetricCard title="Official cost (30d)" value={`$${anthropic.totalCostUsd.toFixed(4)}`} icon="✦" />
            <MetricCard title="Input tokens" value={anthropic.totalInputTokens.toLocaleString()} />
            <MetricCard title="Output tokens" value={anthropic.totalOutputTokens.toLocaleString()} />
            <MetricCard
              title="Cache tokens"
              value={(anthropic.totalCacheReadTokens + anthropic.totalCacheCreationTokens).toLocaleString()}
              sub={`${anthropic.totalCacheReadTokens.toLocaleString()} read · ${anthropic.totalCacheCreationTokens.toLocaleString()} created`}
            />
          </div>
        </>
      ) : (
        <AnthropicNotice result={anthropicResult} />
      )}

      {/* ── Charts ── */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {anthropic ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Cost comparison: computed vs official</CardTitle>
            </CardHeader>
            <CardContent>
              {comparisonData.length > 0
                ? <CostComparisonChart data={comparisonData} />
                : <p className="text-sm text-muted-foreground py-8 text-center">No data</p>}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Daily cost (computed)</CardTitle>
            </CardHeader>
            <CardContent>
              {dailyCostData.length > 0
                ? <DailyCostChart data={dailyCostData} />
                : <p className="text-sm text-muted-foreground py-8 text-center">No data</p>}
            </CardContent>
          </Card>
        )}

        {anthropic ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Token breakdown by type (daily)</CardTitle>
            </CardHeader>
            <CardContent>
              {tokenStackData.length > 0
                ? <TokenStackChart data={tokenStackData} />
                : <p className="text-sm text-muted-foreground py-8 text-center">No data</p>}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Tokens by response type</CardTitle>
            </CardHeader>
            <CardContent>
              {tokensByTypeData.length > 0
                ? <TokensByTypeChart data={tokensByTypeData} />
                : <p className="text-sm text-muted-foreground py-8 text-center">No data</p>}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Turn-level table ── */}
      <div className="border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conversation</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Tokens</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No data</TableCell>
              </TableRow>
            )}
            {rows.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="font-mono text-xs">{log.conversation_id?.slice(0, 8) ?? '—'}…</TableCell>
                <TableCell className="text-xs">{log.model}</TableCell>
                <TableCell className="text-sm">{log.total_tokens ?? '—'}</TableCell>
                <TableCell className="text-sm">{log.cost_usd != null ? `$${Number(log.cost_usd).toFixed(5)}` : '—'}</TableCell>
                <TableCell className="text-sm">{log.latency_ms != null ? `${log.latency_ms} ms` : '—'}</TableCell>
                <TableCell>{log.response_type ? <StatusBadge status={log.response_type} /> : '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(log.created_at).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
