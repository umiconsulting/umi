'use client'

interface OrderCardProps {
  customerName: string
  itemCount: number
  total: number
  createdAt: string
  status: string
}

const STATUS_BORDER: Record<string, string> = {
  pending: 'var(--status-pending)',
  in_progress: 'var(--status-info)',
  ready: 'var(--status-active)',
  completed: 'var(--status-active)',
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ago`
}

export function OrderCard({ customerName, itemCount, total, createdAt, status }: OrderCardProps) {
  const borderColor = STATUS_BORDER[status] ?? 'var(--border)'
  const age = Date.now() - new Date(createdAt).getTime()
  const isOverdue = status === 'pending' && age > 15 * 60 * 1000

  return (
    <div
      className=""
      style={{
        background: 'var(--surface-1)',
        borderLeft: `2px solid ${borderColor}`,
        padding: '8px 12px',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-log-sm)',
      }}
    >
      <div className="flex justify-between mb-1">
        <span style={{ color: 'var(--foreground)' }}>{customerName}</span>
        <span style={{ color: 'var(--text-dim)', fontSize: 'var(--text-log-xs)' }}>
          {relativeTime(createdAt)}
        </span>
      </div>
      <div className="flex justify-between">
        <span style={{ color: 'var(--text-secondary)' }}>
          {itemCount} item{itemCount !== 1 ? 's' : ''}
        </span>
        <span style={{ color: 'var(--foreground)' }}>
          ${typeof total === 'number' ? total.toFixed(2) : '0.00'}
        </span>
      </div>
    </div>
  )
}
