import { supabase } from '@/lib/supabase'
import { MetricCard } from '@/components/MetricCard'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CorrelationBadge } from '@/components/forensic/CorrelationBadge'

export const dynamic = 'force-dynamic'

// ── Fingerprint helpers ──────────────────────────────────────────────────────

interface Fingerprint {
  key: string           // `${event_type}::${failure_category ?? 'none'}`
  event_type: string
  failure_category: string | null
  count24h: number
  count48to24h: number  // previous period for trend
  trend: 'up' | 'down' | 'stable'
  affectedConversations: Set<string>
  recentEvents: {
    id: string
    request_id: string | null
    created_at: string
    details: Record<string, unknown> | null
  }[]
}

const EVENT_LABELS: Record<string, string> = {
  rate_limit_exceeded: 'Rate limit',
  prompt_injection_attempt: 'Prompt injection',
  message_too_long: 'Message too long',
  invalid_order: 'Invalid order',
  error: 'System error',
}

export default async function SecurityPage() {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: events48h }, { data: events7d }] = await Promise.all([
    supabase
      .from('security_logs')
      .select('id, event_type, failure_category, conversation_id, request_id, details, created_at')
      .gte('created_at', since48h)
      .order('created_at', { ascending: false }),
    supabase
      .from('security_logs')
      .select('id, event_type')
      .gte('created_at', since7d),
  ])

  const rows48h = events48h ?? []
  const rows7d = events7d ?? []

  // Split into 24h windows
  const rows24h = rows48h.filter((e) => e.created_at >= since24h)
  const rowsPrev24h = rows48h.filter((e) => e.created_at < since24h)

  // ── Build fingerprint map ────────────────────────────────────────────────
  const fpMap = new Map<string, Fingerprint>()

  for (const e of rows48h) {
    const key = `${e.event_type}::${e.failure_category ?? 'none'}`
    if (!fpMap.has(key)) {
      fpMap.set(key, {
        key,
        event_type: e.event_type,
        failure_category: e.failure_category,
        count24h: 0,
        count48to24h: 0,
        trend: 'stable',
        affectedConversations: new Set(),
        recentEvents: [],
      })
    }
    const fp = fpMap.get(key)!
    if (e.created_at >= since24h) {
      fp.count24h++
      if (e.conversation_id) fp.affectedConversations.add(e.conversation_id)
      if (fp.recentEvents.length < 5) {
        fp.recentEvents.push({
          id: e.id,
          request_id: e.request_id ?? null,
          created_at: e.created_at,
          details: e.details ?? null,
        })
      }
    } else {
      fp.count48to24h++
    }
  }

  // Compute trends
  for (const fp of fpMap.values()) {
    if (fp.count24h > fp.count48to24h * 1.2) fp.trend = 'up'
    else if (fp.count24h < fp.count48to24h * 0.8) fp.trend = 'down'
    else fp.trend = 'stable'
  }

  const fingerprints = [...fpMap.values()]
    .filter((fp) => fp.count24h > 0)
    .sort((a, b) => b.count24h - a.count24h)

  // Overall counts
  const totalEvents24h = rows24h.length
  const injections7d = rows7d.filter((e) => e.event_type === 'prompt_injection_attempt').length
  const rateLimits24h = rows24h.filter((e) => e.event_type === 'rate_limit_exceeded').length

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>Security</h1>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)', opacity: 0.5 }}>— input validation · rate limiting</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <MetricCard
          title="Events (24h)"
          value={totalEvents24h}
          sub={`${rows7d.length} in last 7 days`}
          variant={totalEvents24h > 0 ? 'warning' : 'default'}
        />
        <MetricCard
          title="Fingerprints (24h)"
          value={fingerprints.length}
          sub="Distinct event/category pairs"
        />
        <MetricCard
          title="Injection attempts (7d)"
          value={injections7d}
          variant={injections7d > 0 ? 'error' : 'default'}
        />
        <MetricCard
          title="Rate limit hits (24h)"
          value={rateLimits24h}
          variant={rateLimits24h > 5 ? 'warning' : 'default'}
        />
      </div>

      {/* Fingerprint view */}
      {fingerprints.length === 0 ? (
        <div
          className="p-8 text-center text-sm"
          style={{
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            borderRadius: 'var(--radius)',
          }}
        >
          No security events in the last 24 hours
        </div>
      ) : (
        <div className="space-y-2">
          {fingerprints.map((fp) => (
            <FingerprintRow key={fp.key} fp={fp} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── FingerprintRow (server component) ───────────────────────────────────────

function TrendIndicator({ trend }: { trend: 'up' | 'down' | 'stable' }) {
  if (trend === 'up') return <span style={{ color: 'var(--status-error)' }}>↑</span>
  if (trend === 'down') return <span style={{ color: 'var(--status-active)' }}>↓</span>
  return <span style={{ color: 'var(--text-dim)' }}>→</span>
}

function FingerprintRow({ fp }: { fp: Fingerprint }) {
  const label = EVENT_LABELS[fp.event_type] ?? fp.event_type
  const isInjection = fp.event_type === 'prompt_injection_attempt'

  return (
    <details
      className="group"
      style={{
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${isInjection ? 'var(--status-error)' : 'var(--status-pending)'}`,
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}
    >
      <summary
        className="flex items-center gap-3 px-4 py-3 cursor-pointer list-none"
        style={{ background: 'var(--surface-1)' }}
      >
        {/* Event type */}
        <span
          className="font-mono text-xs font-medium"
          style={{ color: isInjection ? 'var(--status-error)' : 'var(--status-pending)', minWidth: '180px' }}
        >
          {label}
        </span>

        {/* Failure category */}
        {fp.failure_category && (
          <span className="text-[10px] px-1.5 py-0.5" style={{
            background: 'var(--surface-2)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
          }}>
            {fp.failure_category}
          </span>
        )}

        {/* Count + trend */}
        <span className="ml-auto flex items-center gap-2">
          <TrendIndicator trend={fp.trend} />
          <span className="font-mono text-xs" style={{ color: 'var(--foreground)' }}>
            {fp.count24h}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
            occurrences
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
            · {fp.affectedConversations.size} conversation{fp.affectedConversations.size !== 1 ? 's' : ''}
          </span>
          <span
            className="text-[10px] group-open:rotate-180 transition-transform"
            style={{ color: 'var(--text-dim)' }}
          >
            ▾
          </span>
        </span>
      </summary>

      {/* Expanded events */}
      <div style={{ background: 'var(--surface-0)', borderTop: '1px solid var(--border)' }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Time</TableHead>
              <TableHead>Trace</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fp.recentEvents.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="pl-4 font-mono text-[10px] whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                  {new Date(e.created_at).toLocaleString()}
                </TableCell>
                <TableCell>
                  {e.request_id
                    ? <CorrelationBadge requestId={e.request_id} />
                    : <span style={{ color: 'var(--text-dim)' }}>—</span>
                  }
                </TableCell>
                <TableCell className="text-xs max-w-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                  {e.details ? JSON.stringify(e.details).slice(0, 100) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {fp.count24h > 5 && (
          <p className="px-4 py-2 text-[10px]" style={{ color: 'var(--text-dim)' }}>
            Showing 5 of {fp.count24h} events
          </p>
        )}
      </div>
    </details>
  )
}
