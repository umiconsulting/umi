'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

// Client-side supabase instance using publishable key
// These are safe to use on the client since they're the anon/publishable key
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

interface NewInvocation {
  id: string
  function_name: string
  status: string
  created_at: string
}

export function RealtimeLiveInvocations() {
  const [newCount, setNewCount] = useState(0)
  const [lastEvent, setLastEvent] = useState<NewInvocation | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  const handleRefresh = useCallback(() => {
    setNewCount(0)
    window.location.reload()
  }, [])

  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey) return

    const schema =
      process.env.NEXT_PUBLIC_DB_SCHEMA ||
      process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA ||
      'conversaflow'

    const client = createClient(supabaseUrl, supabaseAnonKey, {
      db: { schema },
      auth: { persistSession: false },
    })

    const channel = client
      .channel('edge_function_logs_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema, table: 'edge_function_logs' },
        (payload) => {
          const row = payload.new as NewInvocation
          setNewCount((n) => n + 1)
          setLastEvent(row)
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED')
      })

    return () => {
      channel.unsubscribe()
    }
  }, [])

  if (!supabaseUrl || !supabaseAnonKey) {
    return null // Realtime not configured
  }

  return (
    <div className="flex items-center gap-3 mb-3 text-[11px] font-mono">
      {/* Connection indicator */}
      <div className="flex items-center gap-1.5">
        <span
          className="w-1.5 h-1.5"
          style={{
            background: isConnected ? 'var(--status-active)' : 'var(--text-dim)',
            animation: isConnected ? 'pulse-live 2s ease-in-out infinite' : 'none',
          }}
        />
        <span style={{ color: isConnected ? 'var(--status-active)' : 'var(--text-dim)' }}>
          {isConnected ? 'realtime' : 'connecting…'}
        </span>
      </div>

      {/* New invocations banner */}
      {newCount > 0 && (
        <button
          onClick={handleRefresh}
          className="flex items-center gap-1.5 px-2 py-1 transition-colors"
          style={{
            border: '1px solid var(--status-active)',
            borderRadius: 'var(--radius)',
            background: 'color-mix(in srgb, var(--status-active), transparent 92%)',
            color: 'var(--status-active)',
          }}
        >
          ↑ {newCount} new invocation{newCount !== 1 ? 's' : ''}
          {lastEvent && (
            <span style={{ color: 'var(--text-secondary)' }}>
              · {lastEvent.function_name}
            </span>
          )}
          · click to refresh
        </button>
      )}
    </div>
  )
}
