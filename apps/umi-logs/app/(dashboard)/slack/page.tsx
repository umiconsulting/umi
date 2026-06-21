import { MetricCard } from '@/components/MetricCard'
import { Breadcrumb } from '@/components/layout/Breadcrumb'
import { StatusBadge } from '@/components/StatusBadge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fetchSlackDashboardData, type SlackTransactionRow, type TopProduct, type CancellationReason, type HourlyBucket } from '@/lib/queries/slack'
import { BanknoteArrowDown, CircleDollarSign, Clock3, Coffee, Package2, Rows3, Slack, TriangleAlert, TrendingUp, XCircle } from 'lucide-react'

export const revalidate = 60

type OrderStatus = 'pending' | 'in_progress' | 'ready' | 'completed' | 'cancelled' | string

interface OrderItem {
  product_name?: string
  quantity?: number
  cancelled?: boolean
}

interface OrderDetails {
  items?: OrderItem[]
  pickup_person?: string
  personal_message?: string
  customer_note?: string
  cancellation_reason?: string
}

const STATUS_COPY: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

function getDetails(order: SlackTransactionRow): OrderDetails {
  return (order.details ?? {}) as OrderDetails
}

function getOrderValue(order: SlackTransactionRow): number {
  const raw = typeof order.total_amount === 'string'
    ? Number.parseFloat(order.total_amount)
    : order.total_amount
  return Number.isFinite(raw) ? Number(raw) : 0
}

function getAgeMinutes(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatPct(numerator: number, denominator: number): string {
  if (denominator === 0) return '0%'
  return `${Math.round((numerator / denominator) * 100)}%`
}

function summarizeStatus(rows: SlackTransactionRow[]) {
  return rows.reduce<Record<string, { count: number; amount: number }>>((acc, row) => {
    const key = row.status ?? 'unknown'
    acc[key] ??= { count: 0, amount: 0 }
    acc[key].count += 1
    acc[key].amount += getOrderValue(row)
    return acc
  }, {})
}

function buildDailyVolume(rows: SlackTransactionRow[]) {
  const buckets: Array<{ date: string; label: string; total: number; routed: number; cancelled: number }> = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    buckets.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en', { weekday: 'short' }).slice(0, 3).toUpperCase(),
      total: 0,
      routed: 0,
      cancelled: 0,
    })
  }

  for (const row of rows) {
    const key = row.created_at.slice(0, 10)
    const bucket = buckets.find((entry) => entry.date === key)
    if (!bucket) continue
    bucket.total += 1
    if (row.slack_message_ts) bucket.routed += 1
    if (row.status === 'cancelled') bucket.cancelled += 1
  }

  return buckets
}

function normalizeStatus(status: OrderStatus): string {
  return STATUS_COPY[status] ?? status.replaceAll('_', ' ')
}

function OrderFlags({ order }: { order: SlackTransactionRow }) {
  const details = getDetails(order)
  const items = details.items ?? []
  const hasPartialCancellation = items.some((item) => item.cancelled)
  const flags = [
    details.pickup_person ? 'pickup' : null,
    details.personal_message ? 'gift note' : null,
    details.customer_note ? 'staff note' : null,
    hasPartialCancellation ? 'partial cancel' : null,
    order.slack_message_ts ? 'posted to Slack' : 'missing Slack post',
  ].filter(Boolean) as string[]

  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <span
          key={flag}
          className="px-1.5 py-px text-[10px] uppercase tracking-wider"
          style={{
            border: '1px solid var(--border)',
            color: flag === 'missing Slack post' ? 'var(--status-error)' : 'var(--text-secondary)',
          }}
        >
          {flag}
        </span>
      ))}
    </div>
  )
}

// ── Product rank bar ──────────────────────────────────────────────────────────

function ProductRankBar({ products }: { products: TopProduct[] }) {
  if (products.length === 0) {
    return (
      <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
        No product data yet today.
      </p>
    )
  }

  const max = products[0].count

  return (
    <div className="space-y-2">
      {products.map((p, i) => {
        const pct = max > 0 ? (p.count / max) * 100 : 0
        // Fade intensity by rank
        const opacity = 1 - i * 0.08
        return (
          <div key={p.name} className="flex items-center gap-3">
            <span
              className="shrink-0 w-5 text-right text-[10px] font-mono tabular-nums"
              style={{ color: 'var(--text-dim)' }}
            >
              {p.count}
            </span>
            <div className="flex-1 relative h-5">
              <div
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${Math.max(pct, 4)}%`,
                  background: `color-mix(in srgb, var(--status-active), transparent ${Math.round((1 - opacity) * 100)}%)`,
                  borderRadius: 'var(--radius-data)',
                  transition: 'width 400ms ease',
                }}
              />
              <span
                className="relative z-10 px-2 text-xs font-mono leading-5 truncate block"
                style={{ color: 'var(--foreground)' }}
              >
                {p.name}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Cancellation reasons list ─────────────────────────────────────────────────

function CancellationReasonsList({ reasons }: { reasons: CancellationReason[] }) {
  if (reasons.length === 0) {
    return (
      <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
        No cancellations today.
      </p>
    )
  }

  const total = reasons.reduce((s, r) => s + r.count, 0)

  return (
    <div className="space-y-2">
      {reasons.map((r) => {
        const pct = total > 0 ? Math.round((r.count / total) * 100) : 0
        return (
          <div key={r.reason} className="flex items-start gap-3">
            <span
              className="shrink-0 w-8 text-right text-[10px] font-mono tabular-nums"
              style={{ color: 'var(--status-error)' }}
            >
              {r.count}x
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono truncate" title={r.reason}>
                {r.reason}
              </p>
              <div className="mt-1 h-1 w-full" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-data)' }}>
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: 'var(--status-error)',
                    borderRadius: 'var(--radius-data)',
                    opacity: 0.7,
                  }}
                />
              </div>
            </div>
            <span
              className="shrink-0 text-[10px] font-mono tabular-nums"
              style={{ color: 'var(--text-dim)' }}
            >
              {pct}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Hourly activity heatmap ───────────────────────────────────────────────────

function HourlyHeatmap({ buckets }: { buckets: HourlyBucket[] }) {
  // Generate all hours from 6am to 10pm
  const allHours: HourlyBucket[] = []
  for (let h = 6; h <= 22; h++) {
    const key = h.toString().padStart(2, '0')
    const existing = buckets.find((b) => b.hour === key)
    allHours.push(existing ?? { hour: key, count: 0, revenue: 0 })
  }

  const maxCount = Math.max(...allHours.map((h) => h.count), 1)

  return (
    <div className="flex items-end gap-1" style={{ height: '80px' }}>
      {allHours.map((h) => {
        const intensity = h.count / maxCount
        const barHeight = Math.max(intensity * 100, h.count > 0 ? 8 : 2)
        return (
          <div
            key={h.hour}
            className="flex-1 flex flex-col items-center justify-end gap-1"
            style={{ height: '100%' }}
          >
            <div
              title={`${h.hour}:00 — ${h.count} orders, ${formatMoney(h.revenue)}`}
              style={{
                width: '100%',
                height: `${barHeight}%`,
                minHeight: '2px',
                background: h.count > 0
                  ? `color-mix(in srgb, var(--status-info), transparent ${Math.round((1 - intensity) * 60)}%)`
                  : 'var(--surface-2)',
                borderRadius: 'var(--radius-data)',
                transition: 'height 300ms ease',
              }}
            />
            <span
              className="text-[8px] font-mono tabular-nums"
              style={{ color: h.count > 0 ? 'var(--text-secondary)' : 'var(--text-dim)' }}
            >
              {h.hour}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function SlackDashboardPage() {
  const {
    ordersToday,
    orders7d,
    openOrders,
    completedRevenue,
    averageTicket,
    pipelineRevenue,
    topProducts,
    cancellationReasons,
    hourlyDistribution,
  } = await fetchSlackDashboardData()

  const routedToday = ordersToday.filter((order) => order.slack_message_ts).length
  const openBacklog = openOrders.length
  const stalePending = openOrders.filter((order) => order.status === 'pending' && getAgeMinutes(order.created_at) >= 15)
  const fullCancelsToday = ordersToday.filter((order) => order.status === 'cancelled').length
  const partialCancelsToday = ordersToday.filter((order) => (getDetails(order).items ?? []).some((item) => item.cancelled)).length
  const pickupOrdersToday = ordersToday.filter((order) => Boolean(getDetails(order).pickup_person)).length
  const completedToday = ordersToday.filter((order) => order.status === 'completed').length
  const readyNow = openOrders.filter((order) => order.status === 'ready').length
  const backlogValue = openOrders.reduce((sum, order) => sum + getOrderValue(order), 0)
  const avgOpenAge = openOrders.length > 0
    ? Math.round(openOrders.reduce((sum, order) => sum + getAgeMinutes(order.created_at), 0) / openOrders.length)
    : 0
  const todayVolume = ordersToday.reduce((sum, order) => sum + getOrderValue(order), 0)

  const todaySummary = summarizeStatus(ordersToday)
  const last7d = buildDailyVolume(orders7d)
  const chartMax = Math.max(...last7d.map((day) => day.total), 1)

  const attentionQueue = [...openOrders]
    .sort((a, b) => getAgeMinutes(b.created_at) - getAgeMinutes(a.created_at))
    .slice(0, 8)

  return (
    <div>
      <Breadcrumb items={[{ label: 'Activity', href: '/' }, { label: 'Slack Ops' }]} />

      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>
          Slack Ops
        </h1>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)', opacity: 0.5 }}>
          operational dashboard — orders, revenue, and routing health
        </span>
      </div>

      {/* ── Row 1: Primary KPIs ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <MetricCard
          title="Orders today"
          value={ordersToday.length}
          sub={`${formatMoney(todayVolume)} volume`}
          icon={<Package2 size={14} />}
          variant="default"
        />
        <MetricCard
          title="Revenue"
          value={formatMoney(completedRevenue)}
          sub={`${completedToday} completed`}
          icon={<CircleDollarSign size={14} />}
          variant="positive"
        />
        <MetricCard
          title="Avg ticket"
          value={formatMoney(averageTicket)}
          sub={completedToday > 0 ? `across ${completedToday} orders` : 'no completed orders'}
          icon={<TrendingUp size={14} />}
          variant="default"
        />
        <MetricCard
          title="Pipeline"
          value={formatMoney(pipelineRevenue)}
          sub={`${openBacklog} active orders`}
          icon={<BanknoteArrowDown size={14} />}
          variant={openBacklog > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* ── Row 2: Operational KPIs ──────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <MetricCard
          title="Slack routed"
          value={formatPct(routedToday, ordersToday.length)}
          sub={`${routedToday}/${ordersToday.length} posted`}
          icon={<Slack size={14} />}
          variant={routedToday === ordersToday.length ? 'positive' : 'warning'}
        />
        <MetricCard
          title="At risk"
          value={stalePending.length}
          sub={stalePending.length > 0 ? 'pending 15m+' : 'all clear'}
          icon={<TriangleAlert size={14} />}
          variant={stalePending.length > 0 ? 'error' : 'positive'}
          pulse={stalePending.length > 0}
        />
        <MetricCard
          title="Cancellations"
          value={fullCancelsToday + partialCancelsToday}
          sub={`${fullCancelsToday} full · ${partialCancelsToday} partial`}
          icon={<XCircle size={14} />}
          variant={fullCancelsToday > 0 ? 'error' : 'default'}
        />
        <MetricCard
          title="Ready now"
          value={readyNow}
          sub={readyNow > 0 ? 'awaiting pickup' : 'none ready'}
          icon={<Coffee size={14} />}
          variant={readyNow > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* ── Row 3: Activity + Revenue insights ───────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-3 mb-6">
        {/* Hourly activity */}
        <Card>
          <CardHeader>
            <CardTitle>Hourly Activity</CardTitle>
            <CardDescription>Order volume distribution across today&apos;s hours.</CardDescription>
          </CardHeader>
          <CardContent>
            <HourlyHeatmap buckets={hourlyDistribution} />
          </CardContent>
        </Card>

        {/* Top products */}
        <Card>
          <CardHeader>
            <CardTitle>Top Products</CardTitle>
            <CardDescription>Most ordered items today by quantity.</CardDescription>
          </CardHeader>
          <CardContent>
            <ProductRankBar products={topProducts} />
          </CardContent>
        </Card>
      </div>

      {/* ── Row 4: Status + Trend + Queue Snapshot ───────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[0.6fr_1fr_0.6fr] gap-3 mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Today by Status</CardTitle>
            <CardDescription>Queue composition for triage.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(todaySummary).length === 0 ? (
              <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                No orders created today.
              </p>
            ) : (
              Object.entries(todaySummary).map(([status, summary]) => (
                <div key={status} className="flex items-center justify-between gap-3 text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={status} />
                    <span style={{ color: 'var(--text-secondary)' }}>{normalizeStatus(status)}</span>
                  </div>
                  <div className="text-right">
                    <p>{summary.count} orders</p>
                    <p style={{ color: 'var(--text-dim)' }}>{formatMoney(summary.amount)}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>7-Day Routing Trend</CardTitle>
            <CardDescription>Volume, routing, and cancellations over the last 7 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-2 items-end h-40">
              {last7d.map((day) => (
                <div key={day.date} className="flex flex-col items-center gap-2 h-full justify-end">
                  <div className="w-full flex flex-col gap-1 justify-end h-28">
                    <div
                      title={`${day.total} total`}
                      style={{
                        height: `${(day.total / chartMax) * 100}%`,
                        minHeight: day.total > 0 ? '6px' : '0',
                        background: 'var(--foreground)',
                        opacity: 0.85,
                      }}
                    />
                    <div
                      title={`${day.routed} routed`}
                      style={{
                        height: `${(day.routed / chartMax) * 100}%`,
                        minHeight: day.routed > 0 ? '4px' : '0',
                        background: 'var(--status-active)',
                      }}
                    />
                    <div
                      title={`${day.cancelled} cancelled`}
                      style={{
                        height: `${(day.cancelled / chartMax) * 100}%`,
                        minHeight: day.cancelled > 0 ? '4px' : '0',
                        background: 'var(--status-error)',
                      }}
                    />
                  </div>
                  <div className="text-center text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>
                    <p>{day.label}</p>
                    <p>{day.total}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 mt-4 text-[10px] uppercase tracking-wider font-mono" style={{ color: 'var(--text-dim)' }}>
              <span className="flex items-center gap-1"><span className="w-2 h-2 inline-block" style={{ background: 'var(--foreground)' }} /> total</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 inline-block" style={{ background: 'var(--status-active)' }} /> routed</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 inline-block" style={{ background: 'var(--status-error)' }} /> cancelled</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Queue Snapshot</CardTitle>
            <CardDescription>Present-state operations view.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--text-secondary)' }}>Ready now</span>
              <span>{readyNow}</span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--text-secondary)' }}>Avg open age</span>
              <span>{avgOpenAge}m</span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--text-secondary)' }}>Pickup orders</span>
              <span>{pickupOrdersToday}</span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--text-secondary)' }}>Partial cancels</span>
              <span>{partialCancelsToday}</span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--text-secondary)' }}>Full cancels</span>
              <span>{fullCancelsToday}</span>
            </div>
            <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Backlog value</span>
              <span style={{ color: 'var(--status-pending)' }}>{formatMoney(backlogValue)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Row 5: Attention Queue + Cancellation Reasons ────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_0.6fr] gap-3">
        <Card>
          <CardHeader>
            <CardTitle>Attention Queue</CardTitle>
            <CardDescription>
              Open orders sorted by age — oldest first. Stale orders flagged.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {attentionQueue.length === 0 ? (
              <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                No open orders in the queue.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Slack</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attentionQueue.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono text-xs">{order.id.slice(0, 8)}</TableCell>
                      <TableCell>
                        <StatusBadge status={order.status} />
                      </TableCell>
                      <TableCell>
                        <span
                          style={{
                            color: order.status === 'pending' && getAgeMinutes(order.created_at) >= 15
                              ? 'var(--status-error)'
                              : undefined,
                          }}
                        >
                          {getAgeMinutes(order.created_at)}m
                        </span>
                      </TableCell>
                      <TableCell>{formatMoney(getOrderValue(order))}</TableCell>
                      <TableCell>
                        <span style={{ color: order.slack_message_ts ? 'var(--status-active)' : 'var(--status-error)' }}>
                          {order.slack_message_ts ? 'posted' : 'missing'}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[320px] whitespace-normal">
                        <OrderFlags order={order} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cancellation Reasons</CardTitle>
            <CardDescription>
              Why orders were cancelled today.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CancellationReasonsList reasons={cancellationReasons} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
