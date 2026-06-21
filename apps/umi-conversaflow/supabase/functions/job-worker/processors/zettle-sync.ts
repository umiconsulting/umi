import { slog } from '../../_shared/logger.ts'

/**
 * Process a zettle.sync job: fetch products from Zettle API,
 * upsert into the products table, and mark missing ones unavailable.
 */
export async function processZettleSync(
  supabase: any,
  payload: { business_id: string; request_id?: string },
): Promise<void> {
  const zettleApiKey = Deno.env.get('ZETTLE_API_KEY')
  if (!zettleApiKey) {
    slog('warn', 'zettle_sync_no_api_key', { request_id: payload.request_id })
    return
  }

  const response = await fetch(
    'https://products.izettle.com/organizations/self/products/v2',
    {
      headers: {
        Authorization: `Bearer ${zettleApiKey}`,
        'Content-Type': 'application/json',
      },
    },
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Zettle API error: ${response.status} - ${errorText}`)
  }

  const zettleData = await response.json()

  let syncedCount = 0
  let errorCount = 0

  for (const product of zettleData) {
    try {
      const productData: any = {
        business_id: payload.business_id,
        zettle_uuid: product.uuid,
        name: product.name,
        description: product.description || null,
        category: product.category?.name || null,
        available: !product.deleted && product.etag !== 'DELETED',
        synced_at: new Date().toISOString(),
      }

      if (product.variants && product.variants.length > 0) {
        productData.variants = product.variants.map((v: any) => ({
          sku: v.sku || null,
          name: v.name || v.description || 'Unnamed',
          price: v.price?.amount ? v.price.amount / 100 : 0,
        }))
        const firstVariant = product.variants[0]
        productData.price = firstVariant?.price?.amount
          ? firstVariant.price.amount / 100
          : product.price?.amount
            ? product.price.amount / 100
            : 0
      } else {
        productData.price = product.price?.amount ? product.price.amount / 100 : 0
        productData.variants = []
      }

      const { error: upsertError } = await supabase
        .from('products')
        .upsert(productData, { onConflict: 'zettle_uuid', ignoreDuplicates: false })

      if (upsertError) {
        errorCount++
        slog('warn', 'zettle_sync_upsert_error', {
          product: product.name,
          error: upsertError.message,
          request_id: payload.request_id,
        })
      } else {
        syncedCount++
      }
    } catch (error: any) {
      errorCount++
      slog('warn', 'zettle_sync_product_error', {
        product: product.name,
        error: error.message,
        request_id: payload.request_id,
      })
    }
  }

  // Mark products no longer in Zettle as unavailable
  const zettleUuids = zettleData.map((p: any) => p.uuid)
  if (zettleUuids.length > 0) {
    const { error: updateError } = await supabase
      .from('products')
      .update({ available: false })
      .eq('business_id', payload.business_id)
      .not('zettle_uuid', 'in', zettleUuids)

    if (updateError) {
      slog('warn', 'zettle_sync_mark_unavailable_error', {
        error: updateError.message,
        request_id: payload.request_id,
      })
    }
  }

  if (errorCount > 0) {
    throw new Error(`Zettle sync completed with ${errorCount} errors out of ${zettleData.length} products`)
  }

  slog('info', 'zettle_sync_complete', {
    synced: syncedCount,
    total: zettleData.length,
    request_id: payload.request_id,
  })

  // Re-embed any products whose name/variants changed during this sync.
  // The invalidation trigger already nulled name_embedding on changed rows;
  // this job picks them up.
  await supabase.from('jobs').insert({
    business_id: payload.business_id,
    job_type: 'product.embed',
    aggregate_type: 'business',
    aggregate_id: payload.business_id,
    payload: { business_id: payload.business_id, request_id: payload.request_id },
    state: 'pending',
    priority: 0,
  })
}
