export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between mb-6">
        <div
          className="h-3 w-24"
          style={{ background: 'var(--surface-3)', borderRadius: 'var(--radius)' }}
        />
        <div
          className="h-3 w-16"
          style={{ background: 'var(--surface-3)', borderRadius: 'var(--radius)' }}
        />
      </div>

      {/* Metric cards skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="p-4"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              borderLeft: '3px solid var(--border)',
              borderRadius: 'var(--radius)',
            }}
          >
            <div
              className="h-2 w-20 mb-3"
              style={{ background: 'var(--surface-3)', borderRadius: 'var(--radius)' }}
            />
            <div
              className="h-7 w-16"
              style={{ background: 'var(--surface-3)', borderRadius: 'var(--radius)' }}
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="p-4"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              borderLeft: '3px solid var(--border)',
              borderRadius: 'var(--radius)',
            }}
          >
            <div
              className="h-2 w-20 mb-3"
              style={{ background: 'var(--surface-3)', borderRadius: 'var(--radius)' }}
            />
            <div
              className="h-7 w-16"
              style={{ background: 'var(--surface-3)', borderRadius: 'var(--radius)' }}
            />
          </div>
        ))}
      </div>

      {/* Chart skeleton */}
      <div
        className="p-4"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
        }}
      >
        <div
          className="h-2 w-40 mb-4"
          style={{ background: 'var(--surface-3)', borderRadius: 'var(--radius)' }}
        />
        <div className="flex items-end gap-2" style={{ height: '64px' }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="flex-1"
              style={{
                height: `${20 + Math.random() * 40}%`,
                background: 'var(--surface-3)',
                borderRadius: 'var(--radius)',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
