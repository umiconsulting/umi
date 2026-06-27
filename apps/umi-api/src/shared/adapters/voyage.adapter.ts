import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema';

// Ported from umi-conversaflow `_shared/voyage.ts`. Pure I/O over the Voyage
// embeddings API, with transient-failure retry. Uses Node global fetch.
const EMBEDDING_MODEL = 'voyage-4-lite';
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;

type InputType = 'document' | 'query';

interface VoyageResponse {
  data: Array<{ index: number; embedding: number[] }>;
}

@Injectable()
export class VoyageAdapter {
  private readonly logger = new Logger(VoyageAdapter.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  /** The embedding model these vectors were produced with (persisted alongside). */
  get embeddingModel(): string {
    return EMBEDDING_MODEL;
  }

  /** Embed many texts in one call. Returns vectors in input order, or null. */
  async generateEmbeddings(
    texts: string[],
    inputType: InputType = 'document',
  ): Promise<number[][] | null> {
    const apiKey = this.config.get('VOYAGE_API_KEY', { infer: true });
    if (!apiKey) {
      this.logger.error('VOYAGE_API_KEY is not configured');
      return null;
    }

    const start = Date.now();
    try {
      const data = await this.retryWithBackoff(async () => {
        const res = await fetch('https://api.voyageai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            input: texts,
            model: EMBEDDING_MODEL,
            input_type: inputType,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          // Retry transient failures: 5xx and 429 (rate limit). Other 4xx are
          // permanent (bad request/auth) and fail immediately.
          if (res.status >= 500 || res.status === 429) {
            throw new Error(`Voyage ${res.status}: ${body}`);
          }
          this.logger.error(
            `voyage_api_error status=${res.status} ${body.slice(0, 200)}`,
          );
          return null;
        }
        return (await res.json()) as VoyageResponse;
      });

      if (!data) return null;
      return [...data.data]
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
    } catch (err) {
      this.logger.error(
        `voyage_generate_embeddings_failed: ${(err as Error)?.message} ` +
          `count=${texts.length} ms=${Date.now() - start}`,
      );
      return null;
    }
  }

  /** Embed a single text. Delegates to generateEmbeddings. */
  async generateEmbedding(
    text: string,
    inputType: InputType = 'document',
  ): Promise<number[] | null> {
    const results = await this.generateEmbeddings([text], inputType);
    return results?.[0] ?? null;
  }

  private async retryWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (i < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** i));
        }
      }
    }
    throw lastError;
  }
}
