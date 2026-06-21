interface TimelineGapProps {
  /** Elapsed time this gap represents (ms) */
  elapsedMs: number
  /** Max expected gap (ms) — used to scale height proportionally */
  maxGapMs?: number
}

export function TimelineGap({ elapsedMs, maxGapMs = 10000 }: TimelineGapProps) {
  // Scale between --timeline-gap-min (4px) and --timeline-gap-max (24px)
  const ratio = Math.min(elapsedMs / maxGapMs, 1)
  const heightPx = 4 + ratio * 20

  return (
    <div className="timeline-gap flex items-center" style={{ height: `${heightPx}px` }}>
      {elapsedMs > 500 && (
        <span
          className="ml-3"
          style={{
            fontSize: 'var(--text-log-xs)',
            color: 'var(--text-dim)',
          }}
        >
          {elapsedMs >= 1000 ? `${(elapsedMs / 1000).toFixed(1)}s` : `${elapsedMs}ms`}
        </span>
      )}
    </div>
  )
}
