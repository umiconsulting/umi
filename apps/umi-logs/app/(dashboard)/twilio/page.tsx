import { fetchTwilioAlerts, fetchTwilioMessages } from '@/lib/twilioApi'
import { MetricCard } from '@/components/MetricCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

export const revalidate = 60

const STATUS_COLORS: Record<string, string> = {
  delivered:   'var(--status-active)',
  read:        'var(--status-info)',
  sent:        'var(--status-active)',
  queued:      'var(--status-pending)',
  sending:     'var(--status-pending)',
  accepted:    'var(--status-pending)',
  failed:      'var(--status-error)',
  undelivered: 'var(--status-error)',
  received:    'var(--status-active)',
  receiving:   'var(--status-pending)',
}

const LOG_LEVEL_COLORS: Record<string, string> = {
  error:   'var(--status-error)',
  warning: 'var(--status-pending)',
  notice:  'var(--status-info)',
  debug:   'var(--text-dim)',
}

function formatPhone(raw: string) {
  return raw.replace('whatsapp:', '')
}

export default async function TwilioPage() {
  const [msgs, alerts] = await Promise.all([
    fetchTwilioMessages(7),
    fetchTwilioAlerts(7),
  ])

  const unconfigured = msgs === null && alerts.length === 0

  if (unconfigured) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h1 className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>Twilio</h1>
          <span className="text-[10px]" style={{ color: 'var(--text-dim)', opacity: 0.5 }}>— delivery · alerts · webhooks</span>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium mb-2">Twilio credentials not configured</p>
            <p className="text-xs text-muted-foreground">
              Add <code className="font-mono px-1" style={{ background: 'var(--surface-2)' }}>TWILIO_ACCOUNT_SID</code> and{' '}
              <code className="font-mono px-1" style={{ background: 'var(--surface-2)' }}>TWILIO_AUTH_TOKEN</code> to your{' '}
              <code className="font-mono px-1" style={{ background: 'var(--surface-2)' }}>.env.local</code>
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const total    = msgs?.total ?? 0
  const inbound  = msgs?.inbound ?? 0
  const outbound = msgs?.outbound ?? 0
  const failed   = msgs?.failed ?? []
  const byStatus = msgs?.byStatus ?? {}

  const delivered    = (byStatus['delivered'] ?? 0) + (byStatus['read'] ?? 0)
  const deliveryRate = outbound > 0 ? ((delivered / outbound) * 100).toFixed(1) : null

  const errorAlerts = alerts.filter((a) => a.log_level === 'error').length
  const warnAlerts  = alerts.filter((a) => a.log_level === 'warning').length

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Twilio</h1>
      <p className="text-sm text-muted-foreground mb-6">
        WhatsApp message delivery, monitor alerts, and webhook errors from Twilio&apos;s perspective
      </p>

      {/* Top metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Messages (7d)"
          value={total}
          sub={`${inbound} inbound · ${outbound} outbound`}
          icon="✉"
        />
        <MetricCard
          title="Delivery rate"
          value={deliveryRate != null ? `${deliveryRate}%` : '—'}
          sub={`${delivered} delivered or read (outbound)`}
          icon="✓"
        />
        <MetricCard
          title="Failed / undelivered (7d)"
          value={failed.length}
          sub={failed.length > 0 ? 'Check error codes below' : 'All clear'}
          icon="⊗"
        />
        <MetricCard
          title="Monitor alerts (7d)"
          value={alerts.length}
          sub={`${errorAlerts} errors · ${warnAlerts} warnings`}
          icon="⚠"
        />
      </div>

      <div className="grid grid-cols-3 gap-6 mb-6">
        {/* Status breakdown */}
        <Card className="col-span-1">
          <CardHeader className="pb-2">
            <CardTitle>Message status (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(byStatus).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No messages in last 7 days</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(byStatus)
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between">
                      <span className="text-xs font-mono" style={{ color: STATUS_COLORS[status] ?? 'var(--foreground)' }}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </span>
                      <span className="text-sm font-bold">{count}</span>
                    </div>
                  ))}
              </div>
            )}
            {msgs && (
              <div className="mt-4 pt-3 border-t space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Twilio cost (7d)</span>
                  <span>${msgs.totalCostUsd.toFixed(4)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Monitor Alerts */}
        <div className="col-span-2 border border-border">
          <div className="px-3 py-2 border-b" style={{ background: 'var(--surface-1)' }}>
            <p className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>Monitor alerts — last 7 days</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Level</TableHead>
                <TableHead>Error code</TableHead>
                <TableHead>Alert</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No alerts in last 7 days
                  </TableCell>
                </TableRow>
              )}
              {alerts.slice(0, 20).map((a) => (
                <TableRow key={a.sid}>
                  <TableCell>
                    <span className="text-xs font-mono" style={{ color: LOG_LEVEL_COLORS[a.log_level] ?? 'var(--text-secondary)' }}>
                      {a.log_level}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{a.error_code}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">
                    {a.alert_text ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(a.date_created).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Failed / undelivered messages */}
      {failed.length > 0 && (
        <div className="border border-border">
          <div className="px-3 py-2 border-b" style={{ background: 'var(--surface-1)' }}>
            <p className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>Failed &amp; undelivered messages · 7d</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Error code</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failed.map((m) => (
                <TableRow key={m.sid}>
                  <TableCell>
                    <span className="text-xs font-mono" style={{ color: STATUS_COLORS[m.status] ?? 'var(--text-secondary)' }}>
                      {m.status}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{formatPhone(m.from)}</TableCell>
                  <TableCell className="font-mono text-xs">{formatPhone(m.to)}</TableCell>
                  <TableCell className="font-mono text-xs">{m.error_code ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                    {m.error_message ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {m.date_sent ? new Date(m.date_sent).toLocaleString() : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
