'use client'

interface CertaintyDotProps {
  /** Value between 0 and 1 */
  value: number
  /** CSS color — defaults to status-active */
  color?: string
  /** Size in px */
  size?: number
}

export function CertaintyDot({ value, color, size = 6 }: CertaintyDotProps) {
  // Map to discrete certainty steps
  const opacity = value >= 0.9 ? 'var(--certainty-full)'
    : value >= 0.7 ? 'var(--certainty-high)'
    : value >= 0.4 ? 'var(--certainty-medium)'
    : value >= 0.2 ? 'var(--certainty-low)'
    : 'var(--certainty-absent)'

  return (
    <span
      style={{
        display: 'inline-block',
        width: `${size}px`,
        height: `${size}px`,
        background: color ?? 'var(--status-active)',
        opacity,
      }}
      aria-label={`Certainty: ${Math.round(value * 100)}%`}
    />
  )
}
