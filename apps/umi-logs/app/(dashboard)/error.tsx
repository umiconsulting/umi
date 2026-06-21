'use client'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div
      className="p-6"
      style={{
        border: '1px solid color-mix(in srgb, var(--status-error), transparent 70%)',
        borderLeft: '3px solid var(--status-error)',
        background: 'color-mix(in srgb, var(--status-error), transparent 95%)',
        borderRadius: 'var(--radius)',
      }}
    >
      <p
        className="text-[10px] uppercase tracking-wider mb-2"
        style={{ color: 'var(--text-dim)' }}
      >
        Error
      </p>
      <p
        className="text-sm font-mono mb-4"
        style={{ color: 'var(--status-error)' }}
      >
        {error.message}
      </p>
      {error.digest && (
        <p className="text-[10px] mb-4 font-mono" style={{ color: 'var(--text-dim)' }}>
          digest: {error.digest}
        </p>
      )}
      <button
        onClick={reset}
        className="text-xs px-3 py-1.5 transition-colors"
        style={{ border: '1px solid var(--border)', color: 'var(--foreground)', background: 'transparent' }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--surface-2)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
      >
        Retry
      </button>
    </div>
  )
}
