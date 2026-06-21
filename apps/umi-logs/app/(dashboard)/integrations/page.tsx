import { supabase } from '@/lib/supabase'
import { getActiveBusinessId } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MetricCard } from '@/components/MetricCard'

export const revalidate = 60

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 mr-2 shrink-0"
      style={{ background: ok ? 'var(--status-active)' : 'var(--status-error)' }}
    />
  )
}

function IntegrationHeader({ name, ok, sub }: { name: string; ok: boolean; sub: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div>
        <p className="text-[10px] uppercase tracking-[0.15em] flex items-center" style={{ color: 'var(--text-dim)' }}>
          <StatusDot ok={ok} />
          {name}
        </p>
        <p className="text-[10px] ml-3.5 mt-0.5" style={{ color: 'var(--text-dim)', opacity: 0.6 }}>{sub}</p>
      </div>
    </div>
  )
}

export default async function IntegrationsPage() {
  const businessId = await getActiveBusinessId()
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    // Voyage AI
    { count: totalMessages },
    { count: withEmbedding },
    { data: lastEmbedded },

    // Zettle
    { data: products },
    { data: zettleToken },

    // WhatsApp / Edge function
    { data: whatsappLogs24h },
    { data: whatsappLogs7d },

    // Claude
    { data: aiLogs24h },
    { data: aiLogs7d },
  ] = await Promise.all([
    supabase.from('messages').select('*', { count: 'exact', head: true }),
    supabase.from('messages').select('*', { count: 'exact', head: true }).not('embedding', 'is', null),
    supabase
      .from('messages')
      .select('created_at')
      .not('embedding', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1),

    supabase.from('products').select('id, name, available, synced_at').eq('business_id', businessId).order('synced_at', { ascending: false }),
    supabase.from('zettle_oauth_tokens').select('expires_at, updated_at').eq('business_id', businessId).limit(1).maybeSingle(),

    supabase
      .from('edge_function_logs')
      .select('id, status, duration_ms, created_at')
      .eq('function_name', 'whatsapp-handler')
      .gte('created_at', since24h)
      .order('created_at', { ascending: false }),
    supabase
      .from('edge_function_logs')
      .select('id, status')
      .eq('function_name', 'whatsapp-handler')
      .gte('created_at', since7d),

    supabase
      .from('ai_turn_logs')
      .select('cost_usd, latency_ms, prompt_tokens, completion_tokens')
      .eq('business_id', businessId)
      .gte('created_at', since24h),
    supabase
      .from('ai_turn_logs')
      .select('cost_usd')
      .eq('business_id', businessId)
      .gte('created_at', since7d),
  ])

  // ── Voyage AI ─────────────────────────────────────────────────────────
  const missing = (totalMessages ?? 0) - (withEmbedding ?? 0)
  const coveragePct = totalMessages
    ? (((withEmbedding ?? 0) / totalMessages) * 100).toFixed(1)
    : '0'
  const lastEmbeddingAt = lastEmbedded?.[0]?.created_at ?? null
  const voyageOk = missing === 0

  // ── Zettle ────────────────────────────────────────────────────────────
  const allProducts = products ?? []
  const availableCount = allProducts.filter((p) => p.available).length
  const lastSync = allProducts[0]?.synced_at ?? null
  const tokenExpiry = zettleToken?.expires_at ?? null
  const tokenExpired = tokenExpiry ? new Date(tokenExpiry) < new Date() : true
  const zettleOk = allProducts.length > 0 && !tokenExpired

  // ── WhatsApp ──────────────────────────────────────────────────────────
  const wa24h = whatsappLogs24h ?? []
  const wa7d = whatsappLogs7d ?? []
  const waErrors24h = wa24h.filter((l) => l.status === 'error').length
  const waSuccessRate = wa24h.length > 0
    ? (((wa24h.length - waErrors24h) / wa24h.length) * 100).toFixed(1)
    : null
  const avgWaLatency = wa24h.length > 0
    ? Math.round(wa24h.reduce((s, l) => s + (l.duration_ms ?? 0), 0) / wa24h.length)
    : null
  const whatsappOk = wa24h.length === 0 || waErrors24h === 0

  // ── Claude ────────────────────────────────────────────────────────────
  const ai24h = aiLogs24h ?? []
  const ai7d = aiLogs7d ?? []
  const aiCost24h = ai24h.reduce((s, r) => s + (r.cost_usd ?? 0), 0)
  const aiCost7d = ai7d.reduce((s, r) => s + (r.cost_usd ?? 0), 0)
  const avgAiLatency = ai24h.length > 0
    ? Math.round(ai24h.reduce((s, r) => s + (r.latency_ms ?? 0), 0) / ai24h.length)
    : null
  const claudeOk = true // No way to detect outage without additional signals

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>Integrations</h1>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)', opacity: 0.5 }}>— external services health</span>
      </div>

      {/* System status summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <MetricCard title="Voyage AI" value={voyageOk ? 'Healthy' : `${missing} missing`} sub={`voyage-4-lite · ${coveragePct}% coverage`} variant={voyageOk ? 'positive' : 'error'} />
        <MetricCard title="Zettle" value={tokenExpired ? 'Token expired' : 'Connected'} sub={`${allProducts.length} products`} variant={zettleOk ? 'positive' : 'warning'} />
        <MetricCard title="WhatsApp / Twilio" value={`${wa24h.length} msgs (24h)`} sub={waSuccessRate != null ? `${waSuccessRate}% success` : 'No traffic'} variant={whatsappOk ? 'positive' : 'warning'} />
        <MetricCard title="Claude (Anthropic)" value={`${ai24h.length} turns (24h)`} sub={`$${aiCost24h.toFixed(4)} cost`} variant={claudeOk ? 'positive' : 'error'} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Voyage AI */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>
              <IntegrationHeader
                name="Voyage AI — Embeddings"
                ok={voyageOk}
                sub="voyage-4-lite · 200M free tokens · 1024 dimensions"
              />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md bg-muted p-3">
                <p className="text-xs text-muted-foreground">Coverage</p>
                <p className="text-xl font-bold">{coveragePct}%</p>
                <p className="text-xs text-muted-foreground">{withEmbedding ?? 0} / {totalMessages ?? 0} messages</p>
              </div>
              <div className="rounded-md bg-muted p-3">
                <p className="text-xs text-muted-foreground">Missing</p>
                <p className={`text-xl font-bold ${missing > 0 ? 'text-destructive' : ''}`}>{missing}</p>
                <p className="text-xs text-muted-foreground">{missing > 0 ? 'Run embed-backfill' : 'All clear'}</p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground pt-1 space-y-1">
              <div className="flex justify-between">
                <span>Last embedding generated</span>
                <span>{lastEmbeddingAt ? new Date(lastEmbeddingAt).toLocaleString() : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Semantic search threshold</span>
                <span>{'> 10 messages'}</span>
              </div>
              <div className="flex justify-between">
                <span>Generation timing</span>
                <span>Async (waitUntil)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Zettle */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>
              <IntegrationHeader
                name="Zettle — Product Catalog"
                ok={zettleOk}
                sub="OAuth 2.0 · products synced to Supabase"
              />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md bg-muted p-3">
                <p className="text-xs text-muted-foreground">Total products</p>
                <p className="text-xl font-bold">{allProducts.length}</p>
                <p className="text-xs text-muted-foreground">{availableCount} available</p>
              </div>
              <div className="rounded-md bg-muted p-3">
                <p className="text-xs text-muted-foreground">OAuth token</p>
                <p className="text-xs font-mono" style={{ color: tokenExpired ? 'var(--status-error)' : 'var(--status-active)' }}>
                  {tokenExpired ? 'Expired' : 'Valid'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {tokenExpiry ? `Expires ${new Date(tokenExpiry).toLocaleDateString()}` : 'No token'}
                </p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground pt-1 space-y-1">
              <div className="flex justify-between">
                <span>Last sync</span>
                <span>{lastSync ? new Date(lastSync).toLocaleString() : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Token last updated</span>
                <span>{zettleToken?.updated_at ? new Date(zettleToken.updated_at).toLocaleString() : '—'}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* WhatsApp */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>
              <IntegrationHeader
                name="WhatsApp — Twilio"
                ok={whatsappOk}
                sub="whatsapp-handler edge function · TwiML webhook"
              />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md bg-muted p-3">
                <p className="text-xs text-muted-foreground">Messages (24h)</p>
                <p className="text-xl font-bold">{wa24h.length}</p>
                <p className="text-xs text-muted-foreground">{wa7d.length} in 7 days</p>
              </div>
              <div className="rounded-md bg-muted p-3">
                <p className="text-xs text-muted-foreground">Success rate (24h)</p>
                <p className={`text-xl font-bold ${waErrors24h > 0 ? 'text-destructive' : ''}`}>
                  {waSuccessRate != null ? `${waSuccessRate}%` : '—'}
                </p>
                <p className="text-xs text-muted-foreground">{waErrors24h} errors</p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground pt-1 space-y-1">
              <div className="flex justify-between">
                <span>Avg handler latency (24h)</span>
                <span>{avgWaLatency != null ? `${avgWaLatency} ms` : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Last message</span>
                <span>{wa24h[0]?.created_at ? new Date(wa24h[0].created_at).toLocaleString() : '—'}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Claude */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>
              <IntegrationHeader
                name="Claude — Anthropic"
                ok={claudeOk}
                sub="claude-haiku-4-5 · tool use · async fact + summary extraction"
              />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md bg-muted p-3">
                <p className="text-xs text-muted-foreground">AI turns (24h)</p>
                <p className="text-xl font-bold">{ai24h.length}</p>
                <p className="text-xs text-muted-foreground">{ai7d.length} in 7 days</p>
              </div>
              <div className="rounded-md bg-muted p-3">
                <p className="text-xs text-muted-foreground">Cost (24h)</p>
                <p className="text-xl font-bold">${aiCost24h.toFixed(4)}</p>
                <p className="text-xs text-muted-foreground">${aiCost7d.toFixed(4)} in 7 days</p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground pt-1 space-y-1">
              <div className="flex justify-between">
                <span>Avg Claude latency (24h)</span>
                <span>{avgAiLatency != null ? `${avgAiLatency} ms` : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Models in use</span>
                <span>Haiku 4.5 (main + async)</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
