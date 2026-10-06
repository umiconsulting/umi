/**
 * Token prices in USD per token, for the models Umi calls.
 *
 * WHY THIS FILE EXISTS. A price that lives in two files drifts. This table is
 * the single source for the stored `umi.ai_usage` billing row. The turn loop in
 * `modules/conversations/turn.service.ts` holds the same two numbers for its
 * `ai_turn` log line, and its comment names this file — change both together.
 *
 * Anthropic Claude Haiku 4.5 (`claude-haiku-4-5-20251001`):
 * source https://www.anthropic.com/pricing (checked 2026-09-18) —
 *   input  $1.00 per Mtok = 0.000001 USD per token
 *   output $5.00 per Mtok = 0.000005 USD per token
 *
 * A model with no entry here gets cost 0, not a guessed number. DeepSeek prices
 * are deliberately absent until a confirmed source is recorded.
 */
export interface TokenPrices {
  /** USD per input token. */
  input: number;
  /** USD per output token. */
  output: number;
}

export const ANTHROPIC_HAIKU_4_5 = 'claude-haiku-4-5-20251001';

const PRICES: Readonly<Record<string, TokenPrices>> = {
  [ANTHROPIC_HAIKU_4_5]: { input: 0.000001, output: 0.000005 },
};

/** The prices for a model, or null when no source is recorded for it. */
export function tokenPrices(model: string): TokenPrices | null {
  return PRICES[model] ?? null;
}

/** USD for one call. 0 for a model with no recorded price. */
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const price = tokenPrices(model);
  if (!price) return 0;
  return promptTokens * price.input + completionTokens * price.output;
}
