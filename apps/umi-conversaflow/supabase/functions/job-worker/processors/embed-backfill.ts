import { generateEmbeddings, updateMessageEmbedding } from '../../_shared/memory.ts'
import { slog } from '../../_shared/logger.ts'

const BATCH_SIZE = 50

/**
 * Process an embed.backfill job: find messages without embeddings and
 * generate them in a single Voyage AI batch call.
 */
export async function processEmbedBackfill(
  supabase: any,
  payload: { batch_size?: number; request_id?: string },
): Promise<void> {
  const voyageKey = Deno.env.get('VOYAGE_API_KEY')
  if (!voyageKey) {
    slog('warn', 'embed_backfill_no_voyage_key', { request_id: payload.request_id })
    return
  }

  const batchSize = payload.batch_size ?? BATCH_SIZE

  const { data: messages, error } = await supabase
    .from('messages')
    .select('id, content')
    .is('embedding', null)
    .limit(batchSize)

  if (error) throw new Error(`Failed to fetch messages: ${error.message}`)
  if (!messages?.length) return

  const embeddings = await generateEmbeddings(
    messages.map((m: any) => m.content),
    voyageKey,
    'document',
    payload.request_id,
  )

  if (!embeddings) throw new Error('Voyage API batch call failed')

  let succeeded = 0
  await Promise.all(
    messages.map(async (msg: any, i: number) => {
      const embedding = embeddings[i]
      if (embedding) {
        await updateMessageEmbedding(msg.id, embedding, supabase)
        succeeded++
      }
    }),
  )

  slog('info', 'embed_backfill_complete', {
    processed: messages.length,
    succeeded,
    has_more: messages.length === batchSize,
    request_id: payload.request_id,
  })
}
