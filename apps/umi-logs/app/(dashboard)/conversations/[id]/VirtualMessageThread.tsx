'use client'

import { Virtuoso } from 'react-virtuoso'

interface Message {
  role?: string
  sender?: string
  content: string
  timestamp?: string
  created_at?: string
  embedding?: unknown
}

interface VirtualMessageThreadProps {
  messages: Message[]
  showEmbeddingBadge?: boolean
  height?: number
}

export function VirtualMessageThread({
  messages,
  showEmbeddingBadge = false,
  height = 600,
}: VirtualMessageThreadProps) {
  if (messages.length === 0) {
    return (
      <p className="text-sm py-4 text-center" style={{ color: 'var(--text-secondary)' }}>
        No messages stored
      </p>
    )
  }

  return (
    <Virtuoso
      style={{ height }}
      data={messages}
      followOutput="smooth"
      itemContent={(_, msg) => {
        const sender = msg.role ?? msg.sender ?? 'unknown'
        const isBot = sender === 'assistant' || sender === 'bot'
        const timestamp = msg.created_at ?? msg.timestamp
        const hasEmbedding = msg.embedding !== null && msg.embedding !== undefined

        return (
          <div className={`flex px-3 py-1.5 ${isBot ? 'justify-start' : 'justify-end'}`}>
            <div
              className="max-w-[80%] rounded-lg px-3 py-2 text-sm"
              style={{
                background: isBot ? 'var(--surface-2)' : 'var(--status-active)',
                color: isBot ? 'var(--foreground)' : 'var(--surface-0)',
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <p className="text-[10px] font-medium opacity-70">{sender}</p>
                {showEmbeddingBadge && (
                  <span
                    className="text-[9px] px-1 rounded"
                    style={{
                      background: hasEmbedding ? 'color-mix(in srgb, var(--status-active), transparent 85%)' : 'color-mix(in srgb, var(--status-error), transparent 85%)',
                      color: hasEmbedding ? 'var(--status-active)' : 'var(--status-error)',
                    }}
                  >
                    {hasEmbedding ? '◎ embedded' : '◎ missing'}
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
              {timestamp && (
                <p className="text-[10px] mt-1 opacity-60">
                  {new Date(timestamp).toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
        )
      }}
    />
  )
}
