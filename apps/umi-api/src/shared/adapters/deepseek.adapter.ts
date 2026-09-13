import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema';
import type { CompletionParams, CompletionResult, LlmCompletionProvider } from './llm-completion';

// DeepSeek exposes an OpenAI-compatible Chat Completions API, so this is a thin
// fetch wrapper — no SDK dependency. Fail-safe like AnthropicAdapter: any error
// (missing key, non-2xx, network, malformed body) returns null so the caller keeps
// its existing state (facts unchanged, portrait card hidden, etc.).
const DEFAULT_MAX_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 30_000;

interface DeepseekChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

@Injectable()
export class DeepseekAdapter implements LlmCompletionProvider {
  private readonly logger = new Logger(DeepseekAdapter.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async createCompletion(params: CompletionParams): Promise<CompletionResult | null> {
    const apiKey = this.config.get('DEEPSEEK_API_KEY', { infer: true });
    if (!apiKey) {
      this.logger.error('deepseek_completion_error: DEEPSEEK_API_KEY is not configured');
      return null;
    }
    const baseUrl = this.config.get('DEEPSEEK_BASE_URL', { infer: true });
    const model = params.model ?? this.config.get('DEEPSEEK_MODEL', { infer: true });

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: params.temperature ?? 0,
          // deepseek-flash (V4.1) reasons by default (effort "high"), and the
          // `reasoning_content` shares the `max_tokens` budget with the answer — at our
          // small budgets the answer (`content`) comes back empty/truncated. Every caller
          // on this seam wants a short, direct, deterministic completion (intent, facts,
          // summary, portrait, sales narrative), none needs chain-of-thought, so disable
          // thinking (per api-docs.deepseek.com/guides/thinking_mode): direct content, no
          // wasted reasoning tokens, and `temperature` is honoured again.
          thinking: { type: 'disabled' },
          messages: [
            { role: 'system', content: params.system },
            { role: 'user', content: params.userMessage },
          ],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        this.logger.error(`deepseek_completion_error: HTTP ${res.status} ${detail.slice(0, 200)}`);
        return null;
      }

      const data = (await res.json()) as DeepseekChatResponse;
      return {
        text: data.choices?.[0]?.message?.content ?? '',
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      };
    } catch (err) {
      this.logger.error(`deepseek_completion_error: ${String(err)}`);
      return null;
    }
  }
}
