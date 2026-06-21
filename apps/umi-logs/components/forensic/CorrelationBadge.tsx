'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Copy, Check } from 'lucide-react'

interface CorrelationBadgeProps {
  requestId: string
  /** If true, renders a link to /trace/[requestId] */
  linkToTrace?: boolean
  className?: string
}

export function CorrelationBadge({ requestId, linkToTrace = true, className }: CorrelationBadgeProps) {
  const [copied, setCopied] = useState(false)

  function handleCopy(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    navigator.clipboard.writeText(requestId).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  const short = requestId.slice(0, 8)

  const pillContent = (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 group relative ${className ?? ''}`}
      style={{
        border: '1px solid var(--border)',
        background: 'var(--surface-2)',
        borderRadius: 'var(--radius)',
        color: 'var(--text-secondary)',
      }}
      title={requestId}
    >
      <span>{short}…</span>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 transition-opacity ml-0.5"
        style={{ color: copied ? 'var(--status-active)' : 'var(--text-dim)' }}
        aria-label="Copy full request ID"
      >
        {copied ? <Check size={9} /> : <Copy size={9} />}
      </button>
    </span>
  )

  if (linkToTrace) {
    return (
      <Link href={`/trace/${requestId}`} onClick={(e) => e.stopPropagation()}>
        {pillContent}
      </Link>
    )
  }

  return pillContent
}
