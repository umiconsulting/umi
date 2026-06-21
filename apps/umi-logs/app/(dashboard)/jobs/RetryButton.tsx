'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function RetryButton({ jobId }: { jobId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleRetry() {
    setLoading(true)
    try {
      const res = await fetch(`/api/jobs/${jobId}/retry`, { method: 'POST' })
      if (res.ok) router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleRetry}
      disabled={loading}
      className="px-2 py-1 text-[10px] uppercase tracking-wider rounded"
      style={{
        color: 'var(--status-pending)',
        border: '1px solid var(--border)',
        background: 'transparent',
        cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.5 : 1,
      }}
    >
      {loading ? '...' : 'Retry'}
    </button>
  )
}
