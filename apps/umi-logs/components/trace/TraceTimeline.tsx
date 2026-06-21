'use client'

import { useState, useRef, useEffect } from 'react'
import type { TraceTree, TraceSpan, SpanType } from '@/types/trace'
import { JsonInspector } from '@/components/data/JsonInspector'

// ── Span color map ──────────────────────────────────────────────────────────

const SPAN_COLORS: Record<SpanType, string> = {
  root:                'var(--text-dim)',
  security_validation: 'var(--status-error)',
  memory_tier1:        'var(--event-memory)',
  memory_tier2:        'var(--event-memory)',
  memory_tier3:        'var(--event-memory)',
  claude_api_call:     'var(--event-claude)',
  tool_call:           'var(--status-pending)',
  twilio_send:         'var(--status-active)',
}

const ROW_H = 28
const LABEL_W = 200
const MIN_BAR_W = 4

// ── Span label ──────────────────────────────────────────────────────────────

function spanLabel(span: TraceSpan): string {
  return span.name.length > 30 ? span.name.slice(0, 28) + '…' : span.name
}

// ── SpanDetailPanel ─────────────────────────────────────────────────────────

function SpanDetailPanel({
  span,
  onClose,
}: {
  span: TraceSpan
  onClose: () => void
}) {
  return (
    <div
      className="flex flex-col"
      style={{
        width: '340px',
        flexShrink: 0,
        height: 'calc(100vh - 220px)',
        background: 'var(--surface-1)',
        borderLeft: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="font-mono text-[11px]" style={{ color: 'var(--foreground)' }}>
          {span.name}
        </span>
        <button
          onClick={onClose}
          className="text-[11px] leading-none px-1"
          style={{ color: 'var(--text-dim)' }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="px-3 py-2 text-[11px] font-mono space-y-1" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex justify-between">
          <span style={{ color: 'var(--text-dim)' }}>type</span>
          <span style={{ color: 'var(--event-claude)' }}>{span.type}</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: 'var(--text-dim)' }}>start</span>
          <span style={{ color: 'var(--foreground)' }}>{span.start_ms} ms</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: 'var(--text-dim)' }}>duration</span>
          <span style={{ color: 'var(--foreground)' }}>{span.duration_ms} ms</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: 'var(--text-dim)' }}>status</span>
          <span
            style={{
              color:
                span.status === 'error'
                  ? 'var(--status-error)'
                  : span.status === 'ok'
                  ? 'var(--status-active)'
                  : 'var(--text-secondary)',
            }}
          >
            {span.status}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <p className="text-[10px] uppercase mb-2" style={{ color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
          Attributes
        </p>
        <JsonInspector data={span.attributes} maxHeight={9999} defaultExpandDepth={2} />
      </div>
    </div>
  )
}

// ── Main TraceTimeline ───────────────────────────────────────────────────────

interface TraceTimelineProps {
  trace: TraceTree
}

export function TraceTimeline({ trace }: TraceTimelineProps) {
  const [activeSpanId, setActiveSpanId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasW, setCanvasW] = useState(600)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setCanvasW(Math.max(200, el.clientWidth - (activeSpanId ? 340 : 0) - LABEL_W - 32))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [activeSpanId])

  const spans = trace.spans
  const totalMs = Math.max(trace.totalDuration, 1)

  const activeSpan = activeSpanId ? spans.find((s) => s.id === activeSpanId) ?? null : null

  function xPct(ms: number): number {
    return (ms / totalMs) * canvasW
  }

  // Time axis ticks
  const tickCount = 5
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => Math.round((totalMs / tickCount) * i))

  const svgH = spans.length * ROW_H + 24 // +24 for axis

  return (
    <div
      ref={containerRef}
      className="flex"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        maxHeight: 'calc(100vh - 220px)',
      }}
    >
      {/* Left: timeline */}
      <div className="flex-1 overflow-auto">
        <svg
          width={LABEL_W + canvasW + 16}
          height={svgH}
          style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '11px' }}
        >
          {/* Column background for label area */}
          <rect
            x={0}
            y={0}
            width={LABEL_W}
            height={svgH}
            fill="var(--surface-2)"
          />

          {/* Time axis */}
          {ticks.map((t, i) => {
            const x = LABEL_W + xPct(t)
            return (
              <g key={i}>
                <line
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={svgH - 24}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text
                  x={x}
                  y={svgH - 6}
                  fill="var(--text-dim)"
                  textAnchor="middle"
                  fontSize={9}
                >
                  {t < 1000 ? `${t}ms` : `${(t / 1000).toFixed(1)}s`}
                </text>
              </g>
            )
          })}

          {/* Span rows */}
          {spans.map((span, i) => {
            const y = i * ROW_H
            const barX = LABEL_W + xPct(span.start_ms)
            const barW = Math.max(xPct(span.duration_ms), MIN_BAR_W)
            const color = SPAN_COLORS[span.type] ?? 'var(--text-secondary)'
            const isActive = activeSpanId === span.id
            const isRoot = span.type === 'root'

            return (
              <g
                key={span.id}
                className="cursor-pointer"
                onClick={() => setActiveSpanId(isActive ? null : span.id)}
              >
                {/* Row hover background */}
                <rect
                  x={0}
                  y={y}
                  width={LABEL_W + canvasW + 16}
                  height={ROW_H}
                  fill={isActive ? 'var(--surface-3)' : 'transparent'}
                  style={{ transition: 'fill 100ms' }}
                  onMouseEnter={(e) => {
                    if (!isActive) (e.target as SVGRectElement).setAttribute('fill', 'var(--surface-2)')
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) (e.target as SVGRectElement).setAttribute('fill', 'transparent')
                  }}
                />

                {/* Active indicator */}
                {isActive && (
                  <rect x={0} y={y} width={2} height={ROW_H} fill="var(--status-active)" />
                )}

                {/* Label */}
                <text
                  x={isRoot ? 8 : 16}
                  y={y + ROW_H / 2 + 4}
                  fill={isActive ? 'var(--foreground)' : 'var(--text-secondary)'}
                  fontSize={11}
                >
                  {spanLabel(span)}
                </text>

                {/* Bar */}
                <rect
                  x={barX}
                  y={y + 6}
                  width={barW}
                  height={ROW_H - 12}
                  fill={color}
                  opacity={isRoot ? 0.25 : span.status === 'error' ? 1 : 0.8}
                  rx={2}
                />

                {/* Error indicator */}
                {span.status === 'error' && (
                  <text
                    x={barX + barW + 4}
                    y={y + ROW_H / 2 + 4}
                    fill="var(--status-error)"
                    fontSize={10}
                  >
                    ✕
                  </text>
                )}

                {/* Duration label (only if wide enough) */}
                {barW > 40 && (
                  <text
                    x={barX + 4}
                    y={y + ROW_H / 2 + 4}
                    fill="var(--surface-0)"
                    fontSize={9}
                    fontWeight="600"
                  >
                    {span.duration_ms}ms
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Right: detail panel */}
      {activeSpan && (
        <SpanDetailPanel span={activeSpan} onClose={() => setActiveSpanId(null)} />
      )}
    </div>
  )
}
