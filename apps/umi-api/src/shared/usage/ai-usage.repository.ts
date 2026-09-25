import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema';
import { PgService } from '../database/pg.service';
import { ANTHROPIC_DEFAULT_MODEL } from '../adapters/anthropic.adapter';
import { estimateCostUsd } from './model-prices';

/**
 * The LLM call kinds `umi.ai_usage` accepts. The database CHECK constraint
 * in `docs/migration/build-v3/77_ai_usage.sql` holds the same list.
 */
export type AiUsageKind = 'reply' | 'intent' | 'facts' | 'summary' | 'portrait' | 'narrative';

export type AiUsageProvider = 'anthropic' | 'deepseek' | 'typesafe';

export interface AiUsageEvent {
  merchantId: string;
  kind: AiUsageKind;
  promptTokens: number;
  completionTokens: number;
  /**
   * Provider and model that served the call. Both default to the configured
   * `LLM_PROVIDER` pair, which is correct for every caller on the
   * `LLM_COMPLETION` seam. The WhatsApp reply loop names Anthropic directly,
   * because the tool loop stays there when `LLM_PROVIDER` moves.
   */
  provider?: AiUsageProvider;
  model?: string;
  /** Model calls behind this row. A turn loop makes several; others make one. */
  llmCallCount?: number;
  latencyMs?: number | null;
  conversationId?: string | null;
  turnId?: string | null;
  requestId?: string | null;
  /** Leave undefined to price from the model table. */
  costUsd?: number;
}

/**
 * Writes one billing fact per LLM call group to `umi.ai_usage`.
 *
 * FAILURE-SAFE BY CONSTRUCTION. A usage row is bookkeeping, so a failed write
 * must never fail or roll back the customer work that produced it. `record`
 * catches every error and logs a warning; it never rejects. Do not wrap the
 * call sites in a try/catch — that would only hide the same error twice.
 *
 * Runs on the BYPASSRLS worker pool, like the WhatsApp path it measures. The
 * `merchant_id` predicate is therefore the writer's own responsibility, and it
 * is the first argument of every call.
 */
@Injectable()
export class AiUsageRepository {
  private readonly logger = new Logger(AiUsageRepository.name);

  constructor(
    private readonly pg: PgService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Insert one usage row. Resolves even when the insert fails. */
  async record(event: AiUsageEvent): Promise<void> {
    try {
      const { provider, model } = this.identity(event);
      const costUsd =
        event.costUsd ?? estimateCostUsd(model, event.promptTokens, event.completionTokens);

      await this.pg.query(
        `INSERT INTO umi.ai_usage
           (merchant_id, conversation_id, turn_id, request_id, kind, provider, model,
            prompt_tokens, completion_tokens, llm_call_count, latency_ms, cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (turn_id, kind) WHERE turn_id IS NOT NULL DO NOTHING`,
        [
          event.merchantId,
          event.conversationId ?? null,
          event.turnId ?? null,
          event.requestId ?? null,
          event.kind,
          provider,
          model,
          event.promptTokens,
          event.completionTokens,
          event.llmCallCount ?? 1,
          event.latencyMs ?? null,
          costUsd,
        ],
      );
    } catch (err) {
      this.logger.warn(
        `ai_usage_write_failed kind=${event.kind} merchant_id=${event.merchantId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Resolve the provider and model the call used. An explicit pair wins. */
  private identity(event: AiUsageEvent): { provider: AiUsageProvider; model: string } {
    const configured: AiUsageProvider =
      this.config.get('LLM_PROVIDER', { infer: true }) === 'deepseek' ? 'deepseek' : 'anthropic';
    const provider = event.provider ?? configured;
    const model =
      event.model ??
      (provider === 'deepseek'
        ? // Mirrors the `DEEPSEEK_MODEL` schema default; the typed getter is optional.
          (this.config.get('DEEPSEEK_MODEL', { infer: true }) ?? 'deepseek-flash')
        : ANTHROPIC_DEFAULT_MODEL);
    return { provider, model };
  }
}
