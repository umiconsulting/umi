'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface Props {
  distinctFns: string[]
  currentFn?: string
  currentStatus?: string
  currentRange: string
}

export function FunctionsFilters({ distinctFns, currentFn, currentStatus, currentRange }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.push('/functions?' + params.toString())
  }

  return (
    <div className="flex flex-wrap gap-2 items-center mb-4">
      {/* Function name filter */}
      <select
        className="terminal-select"
        value={currentFn ?? ''}
        onChange={(e) => update('fn', e.target.value)}
      >
        <option value="">fn: all</option>
        {distinctFns.map((fn) => (
          <option key={fn} value={fn}>{fn}</option>
        ))}
      </select>

      {/* Status filter */}
      <select
        className="terminal-select"
        value={currentStatus ?? ''}
        onChange={(e) => update('status', e.target.value)}
      >
        <option value="">status: all</option>
        <option value="success">success</option>
        <option value="error">error</option>
      </select>

      {/* Time range — flat segmented control */}
      <div className="flex" style={{ border: '1px solid var(--border)' }}>
        {(['1h', '6h', '24h', '7d'] as const).map((r) => (
          <button
            key={r}
            className="text-[11px] font-mono px-2.5 py-1 transition-colors"
            style={{
              borderRight: r !== '7d' ? '1px solid var(--border)' : undefined,
              background: currentRange === r ? 'var(--status-active)' : 'transparent',
              color: currentRange === r ? 'var(--surface-0)' : 'var(--text-secondary)',
            }}
            onMouseEnter={(e) => {
              if (currentRange !== r) e.currentTarget.style.color = 'var(--foreground)'
            }}
            onMouseLeave={(e) => {
              if (currentRange !== r) e.currentTarget.style.color = 'var(--text-secondary)'
            }}
            onClick={() => update('range', r)}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  )
}
