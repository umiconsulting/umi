'use client'

import { useState, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import { Copy, Check } from 'lucide-react'

// ── Node types ──────────────────────────────────────────────────────────────

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

interface FlatNode {
  id: string
  depth: number
  key: string | null        // property name or array index
  value: JsonValue
  type: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | '_close'
  childCount: number        // 0 for primitives
  isExpanded: boolean
  hasChildren: boolean
  isLastChild: boolean
}

function typeOf(v: JsonValue): FlatNode['type'] {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'object') return 'object'
  return typeof v as 'string' | 'number' | 'boolean'
}

// ── Tree flattening ─────────────────────────────────────────────────────────

function flattenNode(
  value: JsonValue,
  key: string | null,
  depth: number,
  id: string,
  expanded: Set<string>,
  isLastChild: boolean,
  result: FlatNode[]
) {
  const t = typeOf(value)
  const hasChildren = t === 'object' || t === 'array'
  const childCount = hasChildren
    ? Array.isArray(value)
      ? value.length
      : Object.keys(value as object).length
    : 0

  const node: FlatNode = {
    id,
    depth,
    key,
    value,
    type: t,
    childCount,
    isExpanded: expanded.has(id),
    hasChildren,
    isLastChild,
  }
  result.push(node)

  if (hasChildren && expanded.has(id)) {
    if (Array.isArray(value)) {
      value.forEach((child, i) => {
        flattenNode(child, String(i), depth + 1, `${id}[${i}]`, expanded, i === value.length - 1, result)
      })
    } else {
      const keys = Object.keys(value as object)
      keys.forEach((k, i) => {
        flattenNode(
          (value as Record<string, JsonValue>)[k],
          k,
          depth + 1,
          `${id}.${k}`,
          expanded,
          i === keys.length - 1,
          result
        )
      })
    }
    // Closing bracket row for expanded containers
    result.push({
      id: `${id}__close`,
      depth,
      key: null,
      value: t === 'object' ? '}' : ']',
      type: '_close',
      childCount: 0,
      isExpanded: false,
      hasChildren: false,
      isLastChild,
    })
  }
}

function buildFlatNodes(data: unknown, expanded: Set<string>): FlatNode[] {
  const result: FlatNode[] = []
  flattenNode(data as JsonValue, null, 0, 'root', expanded, true, result)
  return result
}

// ── Color helpers ───────────────────────────────────────────────────────────

function valueColor(type: FlatNode['type']): string {
  switch (type) {
    case 'string':  return 'var(--status-active)'
    case 'number':  return 'var(--status-info)'
    case 'boolean': return 'var(--status-pending)'
    case 'null':    return 'var(--text-dim)'
    default:        return 'var(--foreground)'
  }
}

function renderValue(node: FlatNode): string {
  if (node.type === 'object') return node.isExpanded ? '{' : `{ ${node.childCount} }`
  if (node.type === 'array') return node.isExpanded ? '[' : `[ ${node.childCount} ]`
  if (node.type === 'string') return `"${String(node.value)}"`
  if (node.type === 'null') return 'null'
  return String(node.value)
}

// ── Row component ──────────────────────────────────────────────────────────

function NodeRow({
  node,
  onToggle,
}: {
  node: FlatNode
  onToggle: (id: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const indent = node.depth * 16

  if (node.type === '_close') {
    return (
      <div
        style={{ paddingLeft: `${indent + 8}px`, paddingRight: '8px', minHeight: '22px', fontSize: '11px', lineHeight: '22px' }}
      >
        <span style={{ color: 'var(--text-dim)' }}>{String(node.value)}</span>
      </div>
    )
  }

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    const text =
      node.type === 'string'
        ? String(node.value)
        : JSON.stringify(node.value, null, 2)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => {})
  }

  return (
    <div
      className="flex items-start gap-1 group hover:bg-[var(--surface-2)] transition-colors cursor-default select-text"
      style={{ paddingLeft: `${indent + 8}px`, paddingRight: '8px', minHeight: '22px', fontSize: '11px', lineHeight: '22px' }}
      onClick={node.hasChildren ? () => onToggle(node.id) : undefined}
    >
      {/* Expand/collapse toggle */}
      <span
        className="shrink-0 w-3 text-center"
        style={{ color: 'var(--text-dim)', cursor: node.hasChildren ? 'pointer' : 'default' }}
      >
        {node.hasChildren ? (node.isExpanded ? '▾' : '▸') : ' '}
      </span>

      {/* Key */}
      {node.key !== null && (
        <>
          <span className="font-mono shrink-0" style={{ color: 'var(--text-secondary)' }}>
            {node.type === 'array' || (node.depth === 0 && node.key === null) ? node.key : `"${node.key}"`}
          </span>
          <span className="shrink-0 mr-1" style={{ color: 'var(--text-dim)' }}>:</span>
        </>
      )}

      {/* Value */}
      <span
        className="font-mono flex-1 truncate"
        style={{ color: valueColor(node.type) }}
        title={!node.hasChildren ? String(node.value) : undefined}
      >
        {renderValue(node)}
      </span>

      {/* Closing bracket for collapsed containers */}
      {node.hasChildren && !node.isExpanded && (
        <span style={{ color: 'var(--text-dim)' }}>
          {node.type === 'object' ? '}' : ']'}
        </span>
      )}

      {/* Copy button */}
      {!node.hasChildren && (
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          style={{ color: copied ? 'var(--status-active)' : 'var(--text-dim)' }}
          aria-label="Copy value"
        >
          {copied ? <Check size={9} /> : <Copy size={9} />}
        </button>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

interface JsonInspectorProps {
  data: unknown
  maxHeight?: number
  /** Depth levels to auto-expand on mount (default 1) */
  defaultExpandDepth?: number
}

export function JsonInspector({ data, maxHeight = 400, defaultExpandDepth = 1 }: JsonInspectorProps) {
  // Pre-expand nodes up to defaultExpandDepth
  const initialExpanded = useCallback(() => {
    const s = new Set<string>()
    function visit(v: unknown, id: string, depth: number) {
      if (depth > defaultExpandDepth) return
      const t = typeOf(v as JsonValue)
      if (t === 'object' || t === 'array') {
        s.add(id)
        if (Array.isArray(v)) {
          v.forEach((child, i) => visit(child, `${id}[${i}]`, depth + 1))
        } else {
          Object.entries(v as object).forEach(([k, child]) => visit(child, `${id}.${k}`, depth + 1))
        }
      }
    }
    visit(data, 'root', 0)
    return s
  }, [data, defaultExpandDepth])

  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded)

  const nodes = buildFlatNodes(data, expanded)

  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    overscan: 5,
  })

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div
      ref={parentRef}
      className="overflow-auto font-mono"
      style={{
        maxHeight,
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((vItem) => {
          const node = nodes[vItem.index]
          return (
            <div
              key={node.id}
              style={{
                position: 'absolute',
                top: 0,
                transform: `translateY(${vItem.start}px)`,
                width: '100%',
              }}
            >
              <NodeRow node={node} onToggle={toggleExpanded} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
