'use client'

import { useState, useMemo } from 'react'
import type { LogsResult, ParsedLogEvent, ParsedLogKind } from '@/lib/logsApi'

// Color mapping per event kind (uses CSS custom properties)
const kindMeta: Record<ParsedLogKind, { color: string; label: string }> = {
  boot:             { color: 'var(--text-dim)',        label: 'boot'     },
  shutdown:         { color: 'var(--text-dim)',        label: 'shutdown' },
  incoming:         { color: 'var(--event-incoming)',  label: 'msg'      },
  claude_initial:   { color: 'var(--event-claude)',    label: 'claude'   },
  claude_next:      { color: 'var(--event-claude)',    label: 'claude'   },
  tool_call:        { color: 'var(--event-tool)',      label: 'tool'     },
  tool_result:      { color: 'var(--event-result)',    label: 'result'   },
  final_response:   { color: 'var(--event-result)',    label: 'final'    },
  memory_retrieval: { color: 'var(--event-memory)',    label: 'memory'   },
  initial_response: { color: 'var(--event-claude)',    label: 'claude'   },
  next_response:    { color: 'var(--event-claude)',    label: 'claude'   },
  other:            { color: 'var(--text-dim)',        label: 'log'      },
}

const ALL_KINDS: ParsedLogKind[] = [
  'incoming', 'claude_initial', 'claude_next', 'tool_call', 'tool_result',
  'final_response', 'memory_retrieval', 'initial_response', 'next_response',
]

interface Props {
  result: LogsResult
}

function CorrelationBadge({ id }: { id: string }) {
  return (
    <button
      className="font-mono text-[10px] px-1.5 py-0.5 shrink-0"
      style={{
        border: '1px solid var(--border)',
        color: 'var(--text-secondary)',
        background: 'var(--surface-2)',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
      }}
      title={`Copy: ${id}`}
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(id).catch(() => {})
      }}
    >
      {id.slice(0, 8)}
    </button>
  )
}

function InlineMetrics({ event }: { event: ParsedLogEvent }) {
  const parts: string[] = []
  if (event.latencyMs != null) parts.push(`${event.latencyMs}ms`)
  if (event.tokenCounts) {
    const { input, output } = event.tokenCounts
    parts.push(`${input}↑${output}↓t`)
  }
  if (event.retrievalScore != null) parts.push(`score=${event.retrievalScore.toFixed(2)}`)
  if (!parts.length) return null
  return (
    <span className="shrink-0 text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>
      {parts.join(' · ')}
    </span>
  )
}

function ExpandedPanel({ event }: { event: ParsedLogEvent }) {
  if (event.parserMode === 'structured') {
    const fields: [string, string][] = [
      ['request_id',        event.requestId ?? ''],
      ['correlation_id',    event.correlationId ?? ''],
      ['latency_ms',        event.latencyMs?.toString() ?? ''],
      ['tokens',            event.tokenCounts
        ? `in=${event.tokenCounts.input} out=${event.tokenCounts.output} cache_read=${event.tokenCounts.cacheRead}`
        : ''],
      ['retrieval_score',   event.retrievalScore?.toFixed(4) ?? ''],
      ['failure_category',  event.failureCategory ?? ''],
      ['customer_id',       event.customerId ?? ''],
      ['conversation_id',   event.conversationId ?? ''],
    ].filter(([, v]) => v !== '') as [string, string][]

    return (
      <div className="px-8 pb-3 pt-1">
        {fields.length > 0 && (
          <table className="mb-2" style={{ borderCollapse: 'collapse', fontSize: '11px' }}>
            <tbody>
              {fields.map(([key, value]) => (
                <tr key={key}>
                  <td
                    className="pr-4 py-0.5 font-mono align-top"
                    style={{ color: 'var(--text-dim)', minWidth: '140px' }}
                  >
                    {key}
                  </td>
                  <td className="font-mono py-0.5" style={{ color: 'var(--foreground)' }}>
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <details>
          <summary
            className="text-[10px] cursor-pointer select-none"
            style={{ color: 'var(--text-dim)' }}
          >
            raw message
          </summary>
          <pre
            className="mt-1 text-[11px] whitespace-pre-wrap break-words max-h-40 overflow-y-auto p-2"
            style={{ color: 'var(--text-secondary)', background: 'var(--surface-2)' }}
          >
            {event.event_message}
          </pre>
        </details>
      </div>
    )
  }

  return (
    <pre
      className="px-8 pb-3 pt-1 text-[11px] whitespace-pre-wrap break-words max-h-64 overflow-y-auto"
      style={{ background: 'var(--surface-2)', color: 'var(--foreground)', opacity: 0.8 }}
    >
      {event.event_message}
    </pre>
  )
}

function EmptyState({ result }: { result: Exclude<LogsResult, { status: 'ok' }> }) {
  if (result.status === 'no_token') {
    return (
      <div className="border p-6 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        <p className="font-medium mb-1">Live logs not configured</p>
        <p>
          Add{' '}
          <code className="px-1" style={{ background: 'var(--surface-2)' }}>
            SUPABASE_MANAGEMENT_TOKEN
          </code>{' '}
          to{' '}
          <code className="px-1" style={{ background: 'var(--surface-2)' }}>
            .env.local
          </code>
        </p>
        <p className="mt-1 text-xs">Get it at supabase.com → Account → Access Tokens</p>
      </div>
    )
  }

  if (result.status === 'fetch_error') {
    return (
      <div
        className="border p-6 text-center text-sm"
        style={{ borderColor: 'var(--status-error)', color: 'var(--text-secondary)' }}
      >
        <p className="font-medium mb-1" style={{ color: 'var(--status-error)' }}>
          Failed to fetch logs ({result.httpStatus})
        </p>
        <p>Check that SUPABASE_MANAGEMENT_TOKEN is valid and SUPABASE_PROJECT_REF is correct.</p>
      </div>
    )
  }

  return (
    <div className="border p-6 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
      <p className="font-medium mb-1">No activity in the last 24h</p>
      <p>Trigger an edge function invocation and refresh to see the execution trace here.</p>
    </div>
  )
}

export function LiveLogs({ result }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState<ParsedLogKind | 'all' | 'errors'>('all')

  if (result.status !== 'ok') {
    return <EmptyState result={result} />
  }

  const { events } = result

  const visible = useMemo(() => {
    if (filter === 'all') return events
    if (filter === 'errors') return events.filter((e) => e.isError)
    return events.filter((e) => e.kind === filter)
  }, [events, filter])

  // Only show filter pills for kinds that actually appear in the data
  const presentKinds = useMemo(
    () => ALL_KINDS.filter((k) => events.some((e) => e.kind === k)),
    [events]
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>
          Execution trace
          <span className="ml-2 normal-case tracking-normal" style={{ color: 'var(--text-dim)', opacity: 0.6 }}>
            last 24h · {events.length} events
          </span>
        </p>
        <div className="flex flex-wrap justify-end" style={{ gap: '1px', border: '1px solid var(--border)' }}>
          {(['all', 'errors', ...presentKinds] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className="text-[10px] font-mono px-2 py-1 transition-colors"
              style={{
                borderRight: '1px solid var(--border)',
                background: filter === k ? 'var(--status-active)' : 'transparent',
                color: filter === k ? 'var(--surface-0)' : 'var(--text-secondary)',
              }}
              onMouseEnter={(e) => {
                if (filter !== k) e.currentTarget.style.color = 'var(--foreground)'
              }}
              onMouseLeave={(e) => {
                if (filter !== k) e.currentTarget.style.color = 'var(--text-secondary)'
              }}
            >
              {k === 'all' ? 'all'
                : k === 'errors' ? '! err'
                : kindMeta[k]?.label ?? k}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-border overflow-hidden font-mono text-xs">
        {visible.length === 0 && (
          <div className="p-4 text-center" style={{ color: 'var(--text-secondary)' }}>
            No events match filter
          </div>
        )}
        {visible.map((e) => {
          const meta = kindMeta[e.kind]
          const ts = new Date(e.timestamp / 1000).toLocaleTimeString()
          const isOpen = expanded === e.id
          const eventColor = e.isError ? 'var(--status-error)' : meta.color

          return (
            <div
              key={e.id}
              className="border-b border-border last:border-0"
              style={e.isError ? { background: 'color-mix(in srgb, var(--status-error), transparent 93%)' } : undefined}
            >
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors"
                style={{ ['--tw-bg-opacity' as string]: '1' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                onClick={() => setExpanded(isOpen ? null : e.id)}
              >
                {/* Dot */}
                <span
                  className="shrink-0 w-1.5 h-1.5"
                  style={{ background: eventColor }}
                />
                {/* Timestamp */}
                <span className="shrink-0 w-[72px]" style={{ color: 'var(--text-dim)' }}>
                  {ts}
                </span>
                {/* Kind label */}
                <span
                  className="shrink-0 w-16"
                  style={{ color: eventColor }}
                >
                  {e.isError ? '⚠ error' : meta.label}
                </span>
                {/* Short message */}
                <span className="flex-1 truncate" style={{ color: 'var(--foreground)' }}>
                  {e.shortMessage}
                </span>
                {/* Inline metrics */}
                <InlineMetrics event={e} />
                {/* Request ID badge */}
                {e.requestId && <CorrelationBadge id={e.requestId} />}
                {/* Heuristic indicator */}
                {e.parserMode === 'heuristic' && (
                  <span
                    className="shrink-0 text-[9px]"
                    style={{ color: 'var(--text-dim)' }}
                    title="Legacy log format — structured parsing unavailable"
                  >
                    ⚠
                  </span>
                )}
                {/* Expand toggle */}
                <span className="shrink-0 text-[10px]" style={{ color: 'var(--text-dim)' }}>
                  {isOpen ? '▲' : '▼'}
                </span>
              </button>
              {isOpen && <ExpandedPanel event={e} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
