'use client'

const STEPS = [
  { threshold: 0.9, opacity: 'var(--certainty-full)' },
  { threshold: 0.7, opacity: 'var(--certainty-high)' },
  { threshold: 0.4, opacity: 'var(--certainty-medium)' },
  { threshold: 0.2, opacity: 'var(--certainty-low)' },
  { threshold: 0,   opacity: 'var(--certainty-absent)' },
]

interface CertaintyBarProps {
  /** Value between 0 and 1 */
  value: number
  /** CSS color — defaults to currentColor */
  color?: string
}

export function CertaintyBar({ value, color }: CertaintyBarProps) {
  // Determine how many steps to fill based on value
  const filledSteps = value >= 0.9 ? 5
    : value >= 0.7 ? 4
    : value >= 0.4 ? 3
    : value >= 0.2 ? 2
    : value > 0 ? 1
    : 0

  return (
    <div className="certainty-bar" style={{ color: color ?? 'var(--status-active)' }}>
      {STEPS.map((step, i) => (
        <div
          key={i}
          className="certainty-bar-step"
          style={{
            opacity: i < filledSteps ? step.opacity : 'var(--certainty-absent)',
          }}
        />
      ))}
    </div>
  )
}
