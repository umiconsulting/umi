import { embedMessagePair } from '../../_shared/memory.ts'
import { slog } from '../../_shared/logger.ts'

/**
 * Process a message.embed job: generate Voyage AI embeddings for a user+assistant
 * message pair and persist them to the messages table.
 */
export async function processMessageEmbed(
  supabase: any,
  payload: {
    user_message_id: string
    assistant_message_id: string
    user_text: string
    assistant_text: string
    request_id?: string
  },
): Promise<void> {
  const voyageKey = Deno.env.get('VOYAGE_API_KEY')
  if (!voyageKey) {
    slog('warn', 'message_embed_no_voyage_key', { request_id: payload.request_id })
    return
  }

  await embedMessagePair(
    payload.user_message_id,
    payload.assistant_message_id,
    payload.user_text,
    payload.assistant_text,
    voyageKey,
    supabase,
    payload.request_id,
  )
}
