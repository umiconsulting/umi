import { generateEmbeddings, EMBEDDING_MODEL } from '../../_shared/memory.ts'
import { slog } from '../../_shared/logger.ts'

/**
 * Build the embedding input text for a product.
 * Format: "{name} {category}: {variant1}, {variant2}, ..."
 *
 * Examples:
 *   "Horchata Kafe Cafe: CH, GDE"
 *   "La Mesa de Leonor POSTRES: GALLETA CHOCOLATECHIP, GALLETA SALT AND CHOCOLATE, BROOKIES"
 */
function buildProductEmbedText(product: {
  name: string
  category: string | null
  variants: Array<{ name: string }> | null
}): string {
  const parts: string[] = [product.name]
  if (product.category) parts.push(product.category)
  const base = parts.join(' ')
  const variantNames = (product.variants ?? []).map((v) => v.name).filter(Boolean)
  return variantNames.length > 0 ? `${base}: ${variantNames.join(', ')}` : base
}

/**
 * Process a product.embed job: find products with null name_embedding,
 * generate Voyage AI embeddings in a single batch call, and persist them.
 *
 * Payload:
 *   business_id:  string   — required; only embeds products for this tenant
 *   batch_size?:  number   — defaults to 100
 *   request_id?:  string   — correlation ID for logs
 */
export async function processProductEmbed(
  supabase: any,
  payload: { batch_size?: number; business_id: string; request_id?: string },
): Promise<void> {
  const voyageKey = Deno.env.get('VOYAGE_API_KEY')
  if (!voyageKey) {
    slog('warn', 'product_embed_no_voyage_key', { request_id: payload.request_id })
    return
  }
  if (!payload.business_id) throw new Error('product.embed requires business_id in payload')

  const batchSize = payload.batch_size ?? 100

  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, category, variants')
    .eq('business_id', payload.business_id)
    .eq('available', true)
    .is('name_embedding', null)
    .limit(batchSize)

  if (error) throw new Error(`Failed to fetch products: ${error.message}`)
  if (!products?.length) {
    slog('info', 'product_embed_nothing_to_do', { request_id: payload.request_id })
    return
  }

  const texts = products.map(buildProductEmbedText)
  const start = Date.now()
  const embeddings = await generateEmbeddings(texts, voyageKey, 'document', payload.request_id)
  if (!embeddings) throw new Error('Voyage API batch call failed — will retry')

  let succeeded = 0
  await Promise.all(
    products.map(async (product: any, i: number) => {
      const embedding = embeddings[i]
      if (!embedding) return
      const { error: e } = await supabase
        .from('products')
        .update({ name_embedding: JSON.stringify(embedding) })
        .eq('id', product.id)
      if (e) {
        slog('warn', 'product_embed_update_error', {
          product_id: product.id,
          error: e.message,
          request_id: payload.request_id,
        })
      } else {
        succeeded++
      }
    }),
  )

  slog('info', 'product_embed_complete', {
    total: products.length,
    succeeded,
    has_more: products.length === batchSize,
    voyage_latency_ms: Date.now() - start,
    embedding_model: EMBEDDING_MODEL,
    request_id: payload.request_id,
  })

  // Re-queue if there are more products to process
  if (products.length === batchSize) {
    await supabase.from('jobs').insert({
      business_id: payload.business_id,
      job_type: 'product.embed',
      aggregate_type: 'business',
      aggregate_id: payload.business_id,
      payload: { ...payload },
      state: 'pending',
      priority: 0,
    })
  }
}
