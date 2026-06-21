'use client'

import { useEffect } from 'react'
import { Copy, Download, Check } from 'lucide-react'
import { useState } from 'react'
import type { TraceTree } from '@/types/trace'

interface TraceExportButtonsProps {
  trace: TraceTree
}

export function TraceExportButtons({ trace }: TraceExportButtonsProps) {
  const [copied, setCopied] = useState(false)

  function handleCopyUrl() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  function handleExportJson() {
    const json = JSON.stringify(trace, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trace-${trace.requestId.slice(0, 8)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Keyboard shortcut: Ctrl+E opens a tiny export menu (just triggers both actions)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault()
        handleExportJson()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace])

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleCopyUrl}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors"
        style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          background: 'var(--surface-1)',
          color: copied ? 'var(--status-active)' : 'var(--text-secondary)',
        }}
        title="Copy trace URL to clipboard"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? 'Copied!' : 'Copy URL'}
      </button>

      <button
        onClick={handleExportJson}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors"
        style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          background: 'var(--surface-1)',
          color: 'var(--text-secondary)',
        }}
        title="Export trace as JSON (⌘E)"
      >
        <Download size={11} />
        Export JSON
      </button>
    </div>
  )
}
