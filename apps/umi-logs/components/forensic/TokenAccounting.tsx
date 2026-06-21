'use client'

import {
  computeRequestCost,
  formatTokenCounts,
  formatCost,
  type TokenCounts,
} from '@/lib/parsers/tokenAccounting'

interface TokenAccountingProps {
  tokenCounts: TokenCounts
  model?: string
  variant?: 'compact' | 'expanded'
  showCost?: boolean
}

export function TokenAccounting({
  tokenCounts,
  model,
  variant = 'compact',
  showCost = false,
}: TokenAccountingProps) {
  const cost = showCost ? computeRequestCost(tokenCounts, model) : null

  if (variant === 'expanded') {
    return (
      <div className="font-mono text-[11px] space-y-1">
        <div className="flex justify-between">
          <span style={{ color: 'var(--text-dim)' }}>input</span>
          <span style={{ color: 'var(--foreground)' }}>{tokenCounts.input.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: 'var(--text-dim)' }}>output</span>
          <span style={{ color: 'var(--foreground)' }}>{tokenCounts.output.toLocaleString()}</span>
        </div>
        {tokenCounts.cacheRead > 0 && (
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-dim)' }}>cache read</span>
            <span style={{ color: 'var(--event-memory)' }}>{tokenCounts.cacheRead.toLocaleString()}</span>
          </div>
        )}
        {tokenCounts.cacheCreation > 0 && (
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-dim)' }}>cache write</span>
            <span style={{ color: 'var(--status-pending)' }}>{tokenCounts.cacheCreation.toLocaleString()}</span>
          </div>
        )}
        {cost && (
          <div
            className="flex justify-between pt-1"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <span style={{ color: 'var(--text-dim)' }}>total cost</span>
            <span style={{ color: 'var(--status-active)' }}>{formatCost(cost.total_usd)}</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <span
      className="font-mono text-[10px]"
      style={{ color: 'var(--text-secondary)' }}
      title={cost ? `Cost: ${formatCost(cost.total_usd)}` : undefined}
    >
      {formatTokenCounts(tokenCounts)}
      {cost && (
        <span style={{ color: 'var(--text-dim)' }}> · {formatCost(cost.total_usd)}</span>
      )}
    </span>
  )
}
