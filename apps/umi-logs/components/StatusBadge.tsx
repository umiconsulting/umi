const statusColors: Record<string, string> = {
  success: 'var(--status-active)',
  resolved: 'var(--status-active)',
  sale: 'var(--status-active)',
  ready: 'var(--status-active)',
  completed: 'var(--status-active)',
  active: 'var(--status-info)',
  pending: 'var(--status-pending)',
  in_progress: 'var(--status-pending)',
  error: 'var(--status-error)',
  cancelled: 'var(--status-error)',
  abandoned: 'var(--status-error)',
  escalated: 'var(--text-secondary)',
  fallback: 'var(--text-secondary)',
  out_of_scope: 'var(--text-secondary)',
}

const labelMap: Record<string, string> = {
  price_query: 'price query',
  product_search: 'product search',
  order_intent: 'order intent',
  order_confirm: 'order confirm',
  payment_info: 'payment info',
  out_of_scope: 'out of scope',
  in_progress: 'in progress',
}

export function StatusBadge({ status }: { status: string }) {
  const color = statusColors[status] ?? 'var(--text-dim)'
  const label = labelMap[status] ?? status

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: color }}
      />
      <span
        className="text-[10px] uppercase tracking-wider"
        style={{ color: 'var(--text-secondary)' }}
      >
        {label}
      </span>
    </span>
  )
}
