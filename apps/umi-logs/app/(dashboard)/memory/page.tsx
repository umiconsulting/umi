import { supabase } from '@/lib/supabase'
import { getActiveBusinessId } from '@/lib/auth'
import { MetricCard } from '@/components/MetricCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function MemoryPage() {
  const businessId = await getActiveBusinessId()
  const [
    { count: totalMessages },
    { count: withEmbedding },
    { data: missingMessages },
    { data: allConvos },
    { count: totalCustomers },
    { count: customersWithFacts },
    { data: convosWithSummary },
    { data: msgRows },
    { data: retrievalRows },
  ] = await Promise.all([
    supabase.from('messages').select('*', { count: 'exact', head: true }),
    supabase.from('messages').select('*', { count: 'exact', head: true }).not('embedding', 'is', null),
    supabase
      .from('messages')
      .select('id, role, content, created_at, conversation_id')
      .is('embedding', null)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('conversations')
      .select('id, summary, customers(name)')
      .eq('business_id', businessId)
      .order('last_message_at', { ascending: false })
      .limit(200),
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('business_id', businessId),
    supabase
      .from('customer_preferences')
      .select('*', { count: 'exact', head: true })
      .neq('facts', '{}'),
    supabase
      .from('conversations')
      .select('id')
      .eq('business_id', businessId)
      .not('summary', 'is', null),
    supabase.from('messages').select('conversation_id'),
    // Retrieval quality: fetch tier2 scores from ai_turn_logs (last 30 days)
    supabase
      .from('ai_turn_logs')
      .select('retrieval_score, tier2_used, created_at')
      .eq('business_id', businessId)
      .not('retrieval_score', 'is', null)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true }),
  ])

  const missing = (totalMessages ?? 0) - (withEmbedding ?? 0)
  const coveragePct = totalMessages
    ? ((withEmbedding ?? 0) / totalMessages * 100).toFixed(1)
    : '0'

  // Count messages per conversation to find Tier 2 active (>10 msgs)
  const countByConv: Record<string, number> = {}
  for (const m of msgRows ?? []) {
    countByConv[m.conversation_id] = (countByConv[m.conversation_id] ?? 0) + 1
  }
  const tier2Active = Object.values(countByConv).filter((c) => c > 10).length
  const totalConvos = (allConvos ?? []).length

  // Tier 1: rolling summary
  const tier1Active = convosWithSummary?.length ?? 0

  // Tier 3: customer facts
  const tier3Coverage = totalCustomers
    ? (((customersWithFacts ?? 0) / totalCustomers) * 100).toFixed(0)
    : '0'

  // ── Retrieval quality computation ─────────────────────────────────────────
  const scores = (retrievalRows ?? []).map((r) => r.retrieval_score as number)
  const scoreBuckets = {
    below50: scores.filter((s) => s < 0.5).length,
    b50to70: scores.filter((s) => s >= 0.5 && s < 0.7).length,
    b70to85: scores.filter((s) => s >= 0.7 && s < 0.85).length,
    above85: scores.filter((s) => s >= 0.85).length,
  }
  const p50score = scores.length > 0
    ? [...scores].sort((a, b) => a - b)[Math.floor(scores.length * 0.5)]
    : null
  const alertLowScore = p50score !== null && p50score < 0.65

  // Tier 2 activation rate per day (last 7 days)
  const activationByDay: Record<string, { total: number; tier2: number }> = {}
  for (const r of retrievalRows ?? []) {
    const day = (r.created_at as string).slice(0, 10)
    if (!activationByDay[day]) activationByDay[day] = { total: 0, tier2: 0 }
    activationByDay[day].total++
    if (r.tier2_used) activationByDay[day].tier2++
  }
  const activationTrend = Object.entries(activationByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7)
    .map(([date, { total, tier2 }]) => ({
      date: date.slice(5),
      rate: total > 0 ? Math.round((tier2 / total) * 100) : 0,
    }))

  // Build per-conversation memory depth table
  const convRows = (allConvos ?? []).map((c) => {
    const msgCount = countByConv[c.id] ?? 0
    const customer = Array.isArray(c.customers) ? c.customers[0] : c.customers
    return {
      id: c.id,
      customerName: (customer as any)?.name ?? 'Unknown',
      msgCount,
      hasSummary: !!c.summary,
      tier2: msgCount > 10,
    }
  }).sort((a, b) => b.msgCount - a.msgCount).slice(0, 20)

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>Memory Health</h1>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)', opacity: 0.5 }}>— 3-tier · embeddings · semantic · facts</span>
      </div>

      {/* Tier 2: Embedding coverage */}
      <p className="text-[10px] uppercase tracking-[0.15em] mb-3" style={{ color: 'var(--text-dim)' }}>Tier 2 — Embeddings (Voyage AI)</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard
          title="Embedding coverage"
          value={`${coveragePct}%`}
          sub={`${withEmbedding ?? 0} of ${totalMessages ?? 0} messages`}
          icon="◎"
        />
        <MetricCard
          title="Missing embeddings"
          value={missing}
          sub={missing > 0 ? 'Run embed-backfill to fix' : 'All good'}
        />
        <MetricCard
          title="Semantic search active"
          value={tier2Active}
          sub={`of ${totalConvos} conversations (>10 msgs)`}
        />
        <MetricCard
          title="Model"
          value="voyage-4-lite"
          sub="200M free tokens · 1024 dims"
        />
      </div>

      {/* Tier 1: Rolling summary */}
      <p className="text-[10px] uppercase tracking-[0.15em] mb-3" style={{ color: 'var(--text-dim)' }}>Tier 1 — Working Memory (Rolling Summary)</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard
          title="Conversations with summary"
          value={tier1Active}
          sub={`of ${totalConvos} total · activates after 8 turns`}
        />
        <MetricCard
          title="Recent messages in context"
          value="8"
          sub="Always injected per request"
        />
        <MetricCard
          title="Summary model"
          value="Claude Haiku"
          sub="Max 300 tokens · async"
        />
        <MetricCard
          title="Trigger"
          value="> 8 turns"
          sub="Older turns compressed into summary"
        />
      </div>

      {/* Tier 3: Customer facts */}
      <p className="text-[10px] uppercase tracking-[0.15em] mb-3" style={{ color: 'var(--text-dim)' }}>Tier 3 — Customer Facts (Structured Extraction)</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard
          title="Customers with facts"
          value={`${customersWithFacts ?? 0}`}
          sub={`${tier3Coverage}% of ${totalCustomers ?? 0} customers`}
          icon="◎"
        />
        <MetricCard
          title="Extraction model"
          value="Claude Haiku"
          sub="Max 256 tokens · async after each turn"
        />
        <MetricCard
          title="Fields extracted"
          value="5"
          sub="preferences · dislikes · order · allergies · notes"
        />
        <MetricCard
          title="Trigger"
          value="Every turn"
          sub="Merged into existing facts"
        />
      </div>

      {/* ── Retrieval quality dashboard ── */}
      {scores.length > 0 && (
        <>
          <p className="text-[10px] uppercase tracking-[0.15em] mb-3" style={{ color: 'var(--text-dim)' }}>
            Tier 2 — Retrieval Quality · 30d
          </p>

          {/* Alert */}
          {alertLowScore && (
            <div
              className="px-4 py-3 mb-4 text-xs flex items-center gap-3"
              style={{
                border: '1px solid var(--status-pending)',
                borderLeft: '3px solid var(--status-pending)',
                background: 'color-mix(in srgb, var(--status-pending), transparent 94%)',
                borderRadius: 'var(--radius)',
              }}
            >
              <span style={{ color: 'var(--status-pending)' }}>
                ⚠ p50 retrieval score is {p50score?.toFixed(3)} — below threshold (0.65). Semantic search quality may be degraded.
              </span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 mb-6">
            {/* Score distribution */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Score distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[
                    { label: '< 0.5', count: scoreBuckets.below50, color: 'var(--status-error)' },
                    { label: '0.5 – 0.7', count: scoreBuckets.b50to70, color: 'var(--status-pending)' },
                    { label: '0.7 – 0.85', count: scoreBuckets.b70to85, color: 'var(--status-info)' },
                    { label: '> 0.85', count: scoreBuckets.above85, color: 'var(--status-active)' },
                  ].map(({ label, count, color }) => {
                    const pct = scores.length > 0 ? Math.round((count / scores.length) * 100) : 0
                    return (
                      <div key={label} className="flex items-center gap-2 text-xs">
                        <span className="w-16 font-mono" style={{ color: 'var(--text-dim)' }}>{label}</span>
                        <div
                          className="flex-1 h-1.5"
                          style={{ background: 'var(--surface-3)', borderRadius: '2px' }}
                        >
                          <div
                            style={{
                              width: `${pct}%`,
                              height: '100%',
                              background: color,
                              borderRadius: '2px',
                            }}
                          />
                        </div>
                        <span className="w-8 text-right font-mono" style={{ color: 'var(--foreground)' }}>{count}</span>
                      </div>
                    )
                  })}
                </div>
                {p50score !== null && (
                  <p className="text-[10px] mt-3 pt-2" style={{ color: 'var(--text-dim)', borderTop: '1px solid var(--border)' }}>
                    p50 score: <span className="font-mono" style={{ color: alertLowScore ? 'var(--status-pending)' : 'var(--status-active)' }}>{p50score.toFixed(3)}</span>
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Activation rate trend */}
            <Card className="col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Tier 2 activation rate · last 7 days</CardTitle>
              </CardHeader>
              <CardContent>
                {activationTrend.length === 0 ? (
                  <p className="text-sm py-4 text-center" style={{ color: 'var(--text-secondary)' }}>No data</p>
                ) : (
                  <div className="flex items-end gap-2" style={{ height: '64px' }}>
                    {activationTrend.map(({ date, rate }) => (
                      <div key={date} className="flex-1 flex flex-col items-center gap-1.5">
                        <div className="w-full flex items-end" style={{ height: '52px' }}>
                          <div
                            className="w-full relative"
                            style={{ height: `${Math.max(rate, 2)}%`, minHeight: '3px' }}
                          >
                            <div
                              className="absolute inset-0"
                              style={{ background: 'var(--event-memory)', opacity: 0.75 }}
                            />
                          </div>
                        </div>
                        <span className="text-[9px] uppercase" style={{ color: 'var(--text-dim)' }}>
                          {date}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Per-conversation depth table */}
      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Memory depth per conversation</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Customer</TableHead>
                  <TableHead>Messages</TableHead>
                  <TableHead>Tier 1</TableHead>
                  <TableHead>Tier 2</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {convRows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="pl-4">
                      <Link href={`/conversations/${c.id}`} className="hover:underline font-medium text-sm">
                        {c.customerName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{c.msgCount}</TableCell>
                    <TableCell>
                      <span className="text-xs font-mono" style={{ color: c.hasSummary ? 'var(--status-active)' : 'var(--text-dim)' }}>
                        {c.hasSummary ? 'summary' : '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-mono" style={{ color: c.tier2 ? 'var(--status-active)' : 'var(--text-dim)' }}>
                        {c.tier2 ? 'active' : '—'}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Missing embeddings */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Messages missing embeddings
              {missing > 0 && (
                <span className="ml-2 text-xs font-normal text-destructive">({missing} total)</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(missingMessages ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">All messages have embeddings</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Role</TableHead>
                    <TableHead>Content</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(missingMessages ?? []).map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="pl-4 text-xs font-medium">{m.role}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                        <Link href={`/conversations/${m.conversation_id}`} className="hover:underline">
                          {m.content.slice(0, 60)}{m.content.length > 60 ? '…' : ''}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(m.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
