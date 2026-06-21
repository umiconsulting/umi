const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--status-pending)',
  in_progress: 'var(--status-info)',
  ready: 'var(--status-active)',
  completed: 'var(--status-active)',
  cancelled: 'var(--status-error)',
}

interface StatusTransitionBadgeProps {
  from: string
  to: string
}

export function StatusTransitionBadge({ from, to }: StatusTransitionBadgeProps) {
  return (
    <span
      className="inline-flex items-center gap-1 font-mono"
      style={{ fontSize: 'var(--text-log-xs)' }}
    >
      <span style={{ color: STATUS_COLORS[from] ?? 'var(--text-secondary)' }}>{from}</span>
      <span style={{ color: 'var(--text-dim)' }}>→</span>
      <span style={{ color: STATUS_COLORS[to] ?? 'var(--text-secondary)' }}>{to}</span>
    </span>
  )
}
