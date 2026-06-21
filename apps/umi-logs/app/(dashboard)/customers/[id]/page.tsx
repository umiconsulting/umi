import { supabase } from '@/lib/supabase'
import { getActiveBusinessId } from '@/lib/auth'
import { StatusBadge } from '@/components/StatusBadge'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MetricCard } from '@/components/MetricCard'
import { Breadcrumb } from '@/components/layout/Breadcrumb'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

interface CustomerFacts {
  preferences?: string[]
  dislikes?: string[]
  typical_order?: string | null
  allergies?: string[]
  notes?: string | null
}

export default async function CustomerDetailPage({ params }: PageProps) {
  const businessId = await getActiveBusinessId()
  const { id } = await params

  const [
    { data: customer },
    { data: conversations },
    { data: outcomes },
    { data: aiTurns },
    { data: prefsData },
  ] = await Promise.all([
    supabase.from('customers').select('*').eq('id', id).eq('business_id', businessId).single(),
    supabase
      .from('conversations')
      .select('id, status, created_at, last_message_at, current_state')
      .eq('customer_id', id)
      .eq('business_id', businessId)
      .order('created_at', { ascending: false }),
    supabase
      .from('conversation_outcomes')
      .select('*')
      .eq('customer_id', id)
      .eq('business_id', businessId)
      .order('created_at', { ascending: false }),
    supabase
      .from('ai_turn_logs')
      .select('products_referenced, response_type')
      .eq('customer_id', id)
      .eq('business_id', businessId),
    supabase
      .from('customer_preferences')
      .select('facts, total_transactions, avg_transaction_value')
      .eq('customer_id', id)
      .maybeSingle(),
  ])

  if (!customer) return notFound()

  const convos = conversations ?? []
  const outs = outcomes ?? []
  const turns = aiTurns ?? []

  const totalSpend = outs.reduce((s, o) => s + (o.total_cost_usd ?? 0), 0)

  // Outcome breakdown
  const outcomeCounts: Record<string, number> = {}
  for (const o of outs) {
    outcomeCounts[o.outcome] = (outcomeCounts[o.outcome] ?? 0) + 1
  }

  // Products discussed most frequently
  const productFreq: Record<string, number> = {}
  for (const t of turns) {
    const refs = Array.isArray(t.products_referenced) ? t.products_referenced : []
    for (const p of refs) {
      const name = typeof p === 'string' ? p : (p?.name ?? JSON.stringify(p))
      productFreq[name] = (productFreq[name] ?? 0) + 1
    }
  }
  const topProducts = Object.entries(productFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  const facts: CustomerFacts | null =
    prefsData?.facts && Object.keys(prefsData.facts).length > 0 ? prefsData.facts : null

  const hasFacts =
    facts &&
    ((facts.preferences?.length ?? 0) > 0 ||
      (facts.dislikes?.length ?? 0) > 0 ||
      facts.typical_order ||
      (facts.allergies?.length ?? 0) > 0 ||
      facts.notes)

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Customers', href: '/customers' },
          { label: customer.name ?? customer.phone ?? id.slice(0, 8) },
        ]}
      />

      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>Customer</h1>
        <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>— {customer.name ?? 'Unknown customer'}</span>
      </div>
      <p className="text-[11px] font-mono mb-4" style={{ color: 'var(--text-dim)' }}>{customer.phone}</p>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <MetricCard title="Total conversations" value={convos.length} />
        <MetricCard title="Total spend" value={`$${totalSpend.toFixed(4)}`} />
        <MetricCard title="Customer since" value={new Date(customer.created_at).toLocaleDateString()} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        {/* Conversation timeline */}
        <div className="col-span-2">
          <p className="text-[10px] uppercase tracking-[0.15em] mb-3" style={{ color: 'var(--text-dim)' }}>Conversation timeline</p>
          <div className="space-y-2">
            {convos.length === 0 && (
              <p className="text-sm text-muted-foreground">No conversations yet</p>
            )}
            {convos.map((c) => {
              const outcome = outs.find((o) => o.conversation_id === c.id)
              return (
                <Link key={c.id} href={`/conversations/${c.id}`}>
                  <div className="border border-border p-3 transition-colors convo-row-hover" style={{ borderLeft: '2px solid var(--border)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={c.status ?? 'active'} />
                        {outcome && <StatusBadge status={outcome.outcome} />}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(c.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                      {outcome && (
                        <>
                          <span>{outcome.turn_count ?? 0} turns</span>
                          <span>${(outcome.total_cost_usd ?? 0).toFixed(4)}</span>
                          {outcome.duration_seconds && <span>{Math.round(outcome.duration_seconds / 60)} min</span>}
                        </>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>

        {/* Right column: learned preferences + outcomes + products */}
        <div className="space-y-6">
          {/* Learned Preferences card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Learned Preferences</CardTitle>
            </CardHeader>
            <CardContent>
              {!hasFacts ? (
                <p className="text-sm text-muted-foreground">No preferences extracted yet</p>
              ) : (
                <div className="space-y-3">
                  {facts!.preferences && facts!.preferences.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>Likes</p>
                      <div className="flex flex-wrap gap-1">
                        {facts!.preferences.map((p) => (
                          <span key={p} className="text-[10px] font-mono px-1 py-px" style={{ border: '1px solid var(--status-active)', color: 'var(--status-active)', background: 'color-mix(in srgb, var(--status-active), transparent 92%)' }}>{p}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {facts!.dislikes && facts!.dislikes.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>Dislikes</p>
                      <div className="flex flex-wrap gap-1">
                        {facts!.dislikes.map((d) => (
                          <span key={d} className="text-[10px] font-mono px-1 py-px" style={{ border: '1px solid var(--status-error)', color: 'var(--status-error)', background: 'color-mix(in srgb, var(--status-error), transparent 92%)' }}>{d}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {facts!.allergies && facts!.allergies.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>Allergies</p>
                      <div className="flex flex-wrap gap-1">
                        {facts!.allergies.map((a) => (
                          <span key={a} className="text-[10px] font-mono px-1 py-px" style={{ border: '1px solid var(--status-pending)', color: 'var(--status-pending)', background: 'color-mix(in srgb, var(--status-pending), transparent 92%)' }}>{a}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {facts!.typical_order && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Typical order</p>
                      <p className="text-sm">{facts!.typical_order}</p>
                    </div>
                  )}
                  {prefsData?.total_transactions != null && (
                    <div className="flex justify-between text-xs text-muted-foreground pt-2 border-t border-border">
                      <span>{prefsData.total_transactions} orders</span>
                      {prefsData.avg_transaction_value != null && (
                        <span>avg ${Number(prefsData.avg_transaction_value).toFixed(2)}</span>
                      )}
                    </div>
                  )}
                  {facts!.notes && (
                    <p className="text-xs text-muted-foreground italic">{facts!.notes}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Outcome breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(outcomeCounts).length === 0 ? (
                <p className="text-sm text-muted-foreground">No outcomes recorded</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(outcomeCounts).map(([outcome, count]) => (
                    <div key={outcome} className="flex items-center justify-between">
                      <StatusBadge status={outcome} />
                      <span className="text-sm font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Top products discussed</CardTitle>
            </CardHeader>
            <CardContent>
              {topProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No product data</p>
              ) : (
                <div className="space-y-1.5">
                  {topProducts.map(([name, count]) => (
                    <div key={name} className="flex justify-between text-sm">
                      <span className="truncate text-muted-foreground">{name}</span>
                      <span className="font-medium ml-2">{count}×</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
