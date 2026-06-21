'use client'

import { useState, type ReactNode } from 'react'
import type { SpanType } from '@/types/trace'

const EVENT_CLASS_MAP: Partial<Record<SpanType, string>> = {
  root: 'event-neutral',
  security_validation: 'event-error',
  memory_tier1: 'event-memory',
  memory_tier2: 'event-memory',
  memory_tier3: 'event-memory',
  claude_api_call: 'event-claude',
  tool_call: 'event-tool',
  twilio_send: 'event-result',
}

interface TimelineNodeProps {
  label: string
  durationMs?: number
  status?: 'ok' | 'error' | 'warning' | 'unknown'
  eventType?: SpanType
  expandContent?: ReactNode
}

export function TimelineNode({
  label,
  durationMs,
  status,
  eventType,
  expandContent,
}: TimelineNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const eventClass = eventType ? EVENT_CLASS_MAP[eventType] ?? '' : ''

  return (
    <>
      <div
        className={`timeline-node ${eventClass} ${expanded ? 'timeline-node-active' : ''}`}
        onClick={() => expandContent && setExpanded(!expanded)}
        role={expandContent ? 'button' : undefined}
        tabIndex={expandContent ? 0 : undefined}
        onKeyDown={(e) => {
          if (expandContent && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            setExpanded(!expanded)
          }
        }}
      >
        <span style={{ color: 'var(--foreground)', flex: 1 }}>{label}</span>
        {durationMs != null && (
          <span
            className="px-1 py-px"
            style={{
              fontSize: 'var(--text-log-xs)',
              color: 'var(--text-secondary)',
              background: 'var(--surface-2)',
            }}
          >
            {durationMs}ms
          </span>
        )}
        {status === 'error' && (
          <span style={{ color: 'var(--status-error)', fontSize: 'var(--text-log-xs)' }}>
            error
          </span>
        )}
      </div>
      {expanded && expandContent && (
        <div
          className="depth-content-enter"
          style={{
            borderLeft: `var(--timeline-node-border) solid var(--surface-3)`,
            padding: '8px 12px',
            background: 'var(--surface-1)',
          }}
        >
          {expandContent}
        </div>
      )}
    </>
  )
}
