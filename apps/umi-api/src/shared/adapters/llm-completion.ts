/**
 * Provider-neutral single-shot LLM completion. Both AnthropicAdapter and
 * DeepseekAdapter satisfy this shape, so a caller injects `LLM_COMPLETION` and
 * never names a provider. Which one is bound is decided once, by `LLM_PROVIDER`,
 * in AdaptersModule. (The WhatsApp bot's tool loop is a separate, tool-using path
 * and stays on AnthropicAdapter for now.)
 */
export interface CompletionParams {
  system: string;
  userMessage: string;
  /** Override the provider's default model. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmCompletionProvider {
  /** Single-turn completion. Null on any failure (missing key, network, bad output). */
  createCompletion(params: CompletionParams): Promise<CompletionResult | null>;
}

/** DI token for the configured single-shot completion provider. */
export const LLM_COMPLETION = Symbol('LLM_COMPLETION');
