import { supabase } from '@/lib/supabase'
import { getActiveBusinessId } from '@/lib/auth'
import type { Conversation, Message, AiTurnLog } from '@/types/domain'
import type { CursorPage, CursorParams } from '@/types/api'

const PAGE_SIZE = 50

export async function fetchConversationsPage(
  { cursor, limit = PAGE_SIZE }: CursorParams,
  filters: { statusFilter?: string | null } = {}
): Promise<CursorPage<Conversation>> {
  const businessId = await getActiveBusinessId()
  let q = supabase
    .from('conversations')
    .select('id, customer_id, business_id, status, current_state, summary, created_at, last_message_at, customers(id, name, phone)')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (filters.statusFilter) q = q.eq('status', filters.statusFilter)

  if (cursor) {
    const [cursorAt, cursorId] = cursor.split('||')
    q = q.or(`created_at.lt.${cursorAt},and(created_at.eq.${cursorAt},id.lt.${cursorId})`)
  }

  const { data, error } = await q
  if (error) throw error

  const rows = (data ?? []) as unknown as Conversation[]
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  let nextCursor: string | null = null
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1]
    nextCursor = `${last.created_at}||${last.id}`
  }

  return { data: page, nextCursor }
}

export async function fetchConversationById(id: string): Promise<{
  conversation: Conversation | null
  messages: Message[]
  aiTurns: AiTurnLog[]
}> {
  const businessId = await getActiveBusinessId()
  const [{ data: conversation }, { data: messages }, { data: aiTurns }] = await Promise.all([
    supabase
      .from('conversations')
      .select('*, customers(id, name, phone)')
      .eq('id', id)
      .eq('business_id', businessId)
      .single(),
    supabase
      .from('messages')
      .select('id, conversation_id, role, content, embedding, embedding_model, twilio_message_sid, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('ai_turn_logs')
      .select('*')
      .eq('conversation_id', id)
      .eq('business_id', businessId)
      .order('created_at', { ascending: true }),
  ])

  return {
    conversation: conversation as Conversation | null,
    messages: (messages ?? []) as Message[],
    aiTurns: (aiTurns ?? []) as AiTurnLog[],
  }
}
