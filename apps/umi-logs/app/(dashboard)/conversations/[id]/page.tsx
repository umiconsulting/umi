import { supabase } from '@/lib/supabase'
import { getActiveBusinessId } from '@/lib/auth'
import { MetricCard } from '@/components/MetricCard'
import { StatusBadge } from '@/components/StatusBadge'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Breadcrumb } from '@/components/layout/Breadcrumb'
import { VirtualMessageThread } from './VirtualMessageThread'
import { Suspense } from 'react'
import { ConversationDepthView } from './ConversationDepthView'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

interface Message {
  role?: string
  sender?: string
  content: string
  timestamp?: string
  created_at?: string
  embedding?: unknown
}

interface CustomerFacts {
  preferences?: string[]
  dislikes?: string[]
  typical_order?: string | null
  allergies?: string[]
  notes?: string | null
}

export default async function ConversationDetailPage({ params }: PageProps) {
  const businessId = await getActiveBusinessId()
  const { id } = await params

  const { data: conversation } = await supabase
    .from('conversations')
    .select('*, customers ( id, name, phone )')
    .eq('id', id)
    .eq('business_id', businessId)
    .single()

  if (!conversation) return notFound()

  const customer = Array.isArray(conversation.customers)
    ? conversation.customers[0]
    : conversation.customers
  const customerId = (customer as any)?.id

  const [{ data: aiTurns }, { data: messagesData }, { data: prefsData }] = await Promise.all([
    supabase
      .from('ai_turn_logs')
      .select('*')
      .eq('conversation_id', id)
      .eq('business_id', businessId)
      .order('created_at', { ascending: true }),
    supabase
      .from('messages')
      .select('role, content, created_at, embedding')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true }),
    customerId
      ? supabase.from('customer_preferences').select('facts').eq('customer_id', customerId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  // Use messages table if populated, fall back to JSONB for backward compat
  const history: Message[] =
    messagesData && messagesData.length > 0
      ? messagesData
      : Array.isArray(conversation.conversation_history)
      ? conversation.conversation_history
      : []

  const turns = aiTurns ?? []
  const totalCost = turns.reduce((s, t) => s + (t.cost_usd ?? 0), 0)
  const totalTokens = turns.reduce((s, t) => s + (t.total_tokens ?? 0), 0)

  // Memory tier analysis
  const msgCount = messagesData?.length ?? 0
  const withEmbedding = (messagesData ?? []).filter((m) => m.embedding !== null).length
  const missingEmbedding = msgCount - withEmbedding
  const tier1Active = !!conversation.summary
  const tier2Active = msgCount > 10
  const facts: CustomerFacts | null =
    prefsData?.facts && Object.keys(prefsData.facts).length > 0 ? prefsData.facts as CustomerFacts : null
  const tier3Active = !!facts

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Conversations', href: '/conversations' },
          { label: (customer as any)?.name ?? (customer as any)?.phone ?? id.slice(0, 8) },
        ]}
      />

      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>
          Conversation
        </h1>
        <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
          — {(customer as any)?.name ?? 'Unknown'}
        </span>
      </div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[11px] font-mono" style={{ color: 'var(--text-dim)' }}>{(customer as any)?.phone}</span>
        <span style={{ color: 'var(--text-dim)', opacity: 0.5 }}>·</span>
        <StatusBadge status={conversation.status ?? 'active'} />
        <span style={{ color: 'var(--text-dim)', opacity: 0.5 }}>·</span>
        <span className="text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>started {new Date(conversation.created_at).toLocaleString()}</span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <MetricCard title="AI turns" value={turns.length} />
        <MetricCard title="Total cost" value={`$${totalCost.toFixed(4)}`} />
        <MetricCard title="Total tokens" value={totalTokens.toLocaleString()} />
      </div>

      {/* 3-depth conversation view */}
      <ConversationDepthView
        conversation={conversation}
        history={history}
        turns={turns}
        messagesData={messagesData ?? []}
        facts={facts}
        tier1Active={tier1Active}
        tier2Active={tier2Active}
        tier3Active={tier3Active}
        msgCount={msgCount}
        withEmbedding={withEmbedding}
        missingEmbedding={missingEmbedding}
      />
    </div>
  )
}
