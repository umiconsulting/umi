import { generateSummary } from '../../_shared/memory.ts'
import { getAnthropicClient } from '../../_shared/adapters/anthropic.ts'
import { slog } from '../../_shared/logger.ts'

/**
 * Process a conversation.summarize job: generate a rolling summary via Claude Haiku
 * for conversations with more than 8 messages.
 */
export async function processConversationSummarize(
  supabase: any,
  payload: {
    conversation_id: string
    request_id?: string
  },
): Promise<void> {
  // Fetch current conversation to get existing summary and message count
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, summary')
    .eq('id', payload.conversation_id)
    .single()

  if (!conversation) {
    slog('warn', 'summarize_conversation_not_found', { conversation_id: payload.conversation_id })
    return
  }

  // Count total messages
  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', payload.conversation_id)

  const totalMsgCount = count ?? 0
  if (totalMsgCount <= 8) return

  // Fetch the messages beyond the recent-8 window, capped at 16
  const summaryBatch = Math.min(totalMsgCount - 8, 16)
  const { data: olderMsgs } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', payload.conversation_id)
    .order('created_at', { ascending: false })
    .range(8, 8 + summaryBatch - 1)

  if (!olderMsgs?.length) return

  // range() returns DESC — reverse for chronological order
  const chronological = [...olderMsgs].reverse()
  const anthropic = getAnthropicClient()
  const newSummary = await generateSummary(chronological, conversation.summary ?? null, anthropic)

  if (newSummary) {
    await supabase
      .from('conversations')
      .update({ summary: newSummary })
      .eq('id', payload.conversation_id)

    slog('info', 'conversation_summary_updated', {
      conversation_id: payload.conversation_id,
      request_id: payload.request_id,
    })
  }
}
