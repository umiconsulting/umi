// ── Voyage AI embedding adapter ─────────────────────────────────────────────
// I/O: Voyage API calls only. No supabase, no domain logic.

import { slog } from './logger.ts'

// RAG-02: Current embedding model — update here on model changes.
export const EMBEDDING_MODEL = 'voyage-4-lite'

// FT-03: Max retry attempts for Voyage API calls (transient failures).
const VOYAGE_MAX_RETRIES = 2
const VOYAGE_RETRY_BASE_MS = 500

/**
 * FT-03: Retry wrapper for async operations that may fail transiently.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries: number,
  baseMs: number,
): Promise<T> {
  let lastError: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (i < retries) {
        await new Promise((r) => setTimeout(r, baseMs * Math.pow(2, i)))
      }
    }
  }
  throw lastError
}

/**
 * Generate embeddings for multiple texts in a single Voyage AI API call.
 * FT-03: Retries up to VOYAGE_MAX_RETRIES times on 5xx or network errors.
 * Returns an array in input order, or null if all attempts fail.
 */
export async function generateEmbeddings(
  texts: string[],
  voyageApiKey: string,
  inputType: 'document' | 'query' = 'document',
  requestId?: string,
): Promise<number[][] | null> {
  const voyageStart = Date.now()
  try {
    const data = await retryWithBackoff(
      async () => {
        const res = await fetch('https://api.voyageai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${voyageApiKey}`,
          },
          body: JSON.stringify({
            input: texts,
            model: EMBEDDING_MODEL,
            input_type: inputType,
          }),
        })

        if (!res.ok) {
          const body = await res.text()
          // Only retry on server errors; 4xx are permanent failures
          if (res.status >= 500) throw new Error(`Voyage ${res.status}: ${body}`)
          slog('error', 'voyage_api_error', { status: res.status, body: body.slice(0, 200), request_id: requestId })
          return null
        }

        return await res.json()
      },
      VOYAGE_MAX_RETRIES,
      VOYAGE_RETRY_BASE_MS,
    )

    if (!data) return null

    const sorted = (data.data as Array<{ index: number; embedding: number[] }>)
      .sort((a, b) => a.index - b.index)
    return sorted.map((d) => d.embedding)
  } catch (err: any) {
    slog('error', 'voyage_generate_embeddings_failed', {
      error: err?.message,
      text_count: texts.length,
      latency_ms: Date.now() - voyageStart,
      request_id: requestId,
    })
    return null
  }
}

/**
 * Generate a single embedding. Delegates to generateEmbeddings.
 */
export async function generateEmbedding(
  text: string,
  voyageApiKey: string,
  inputType: 'document' | 'query' = 'document',
  requestId?: string,
): Promise<number[] | null> {
  const results = await generateEmbeddings([text], voyageApiKey, inputType, requestId)
  return results?.[0] ?? null
}
