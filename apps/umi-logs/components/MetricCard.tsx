import Link from 'next/link'
import React from 'react'

interface MetricCardProps {
  title: string
  value: string | number
  sub?: string
  icon?: string | React.ReactNode
  variant?: 'default' | 'positive' | 'warning' | 'error'
  href?: string
  pulse?: boolean
}

const variantMap = {
  default:  { dot: 'var(--text-dim)',       value: 'var(--foreground)' },
  positive: { dot: 'var(--status-active)',   value: 'var(--status-active)' },
  warning:  { dot: 'var(--status-pending)',  value: 'var(--status-pending)' },
  error:    { dot: 'var(--status-error)',    value: 'var(--status-error)' },
}

export function MetricCard({
  title,
  value,
  sub,
  icon,
  variant = 'default',
  href,
}: MetricCardProps) {
  const colors = variantMap[variant]

  const inner = (
    <div className="metric-card-container">
      <div
        className="metric-card-inner relative p-4"
        style={{
          borderBottom: '1px solid var(--ruled-line)',
          transition: 'background 180ms ease',
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          {/* Status dot */}
          <span
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: colors.dot }}
          />
          <p
            className="text-[10px] uppercase tracking-widest"
            style={{
              color: 'var(--text-dim)',
              fontSize: 'var(--text-label)',
              letterSpacing: '0.12em',
            }}
          >
            {title}
          </p>
        </div>

        {icon != null && (
          <div
            className="metric-icon-area absolute top-3 right-3 leading-none"
            style={{ color: 'var(--text-dim)', fontSize: '14px' }}
            aria-hidden="true"
          >
            {icon}
          </div>
        )}

        <p
          className="metric-value leading-none"
          style={{
            color: colors.value,
            fontSize: 'var(--text-metric)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </p>

        {sub && (
          <p
            className="metric-subtitle mt-2"
            style={{
              color: 'var(--text-secondary)',
              fontSize: 'var(--text-log-sm)',
            }}
          >
            {sub}
          </p>
        )}
      </div>
    </div>
  )

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>
        {inner}
      </Link>
    )
  }

  return inner
}
