import Anthropic from "@anthropic-ai/sdk";
import { slog } from "../logger.ts";

// ── Anthropic API adapter ───────────────────────────────────────────────────
// Pure I/O: creates Claude clients and makes API calls. No domain logic.

export { Anthropic };

/**
 * FT-03: The Anthropic SDK has built-in retry logic.
 * maxRetries: 2 means 3 total attempts with exponential backoff.
 * The SDK retries on: connection errors, 429 Too Many Requests, 529 Overloaded.
 */
export function getAnthropicClient(): Anthropic {
  return new Anthropic({
    apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
    maxRetries: 2,
  });
}

/**
 * Typed wrapper for single-turn completions (used by summarize, extract_facts).
 * Returns extracted text + token counts, or null on failure.
 */
export async function createCompletion(params: {
  system: string;
  userMessage: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<
  { text: string; inputTokens: number; outputTokens: number } | null
> {
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: params.model ?? "claude-haiku-4-5-20251001",
      max_tokens: params.maxTokens ?? 1024,
      temperature: params.temperature ?? 0,
      system: params.system,
      messages: [{ role: "user", content: params.userMessage }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } catch (err) {
    slog("error", "anthropic_completion_error", { error: String(err) });
    return null;
  }
}

export async function createMessage(params: {
  system: string;
  messages: any[];
  tools?: any[];
  toolChoice?: any;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<
  { response: any; inputTokens: number; outputTokens: number } | null
> {
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: params.model ?? "claude-haiku-4-5-20251001",
      max_tokens: params.maxTokens ?? 1024,
      temperature: params.temperature ?? 0,
      system: params.system,
      messages: params.messages,
      ...(params.tools ? { tools: params.tools } : {}),
      ...(params.toolChoice ? { tool_choice: params.toolChoice } : {}),
    });

    return {
      response,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } catch (err) {
    slog("error", "anthropic_message_error", { error: String(err) });
    return null;
  }
}
