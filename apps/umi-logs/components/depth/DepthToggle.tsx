'use client'

import { useDepth, type DepthLevel } from './DepthProvider'

const LEVELS: { key: DepthLevel; label: string }[] = [
  { key: 'surface', label: 'Surface' },
  { key: 'system', label: 'System' },
  { key: 'trace', label: 'Trace' },
]

export function DepthToggle() {
  const { depth, setDepth } = useDepth()

  return (
    <div className="depth-toggle">
      {LEVELS.map(({ key, label }) => (
        <button
          key={key}
          className={`depth-tab ${depth === key ? 'depth-tab-active' : ''}`}
          onClick={() => setDepth(key)}
          aria-pressed={depth === key}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
