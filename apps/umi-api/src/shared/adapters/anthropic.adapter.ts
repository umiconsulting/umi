import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema';

// Ported from umi-conversaflow `_shared/adapters/anthropic.ts`. Pure I/O — no
// domain logic. The conversaflow turn loop deliberately runs on Haiku 4.5 (the
// right tier for a high-frequency WhatsApp loop), so that stays the default
// here. `temperature` defaults to 0 (valid on Haiku 4.5); omit it for Opus
// 4.7+/Fable models, which reject sampling params.
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_TOKENS = 1024;

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface MessageResult {
  response: Anthropic.Message;
  inputTokens: number;
  outputTokens: number;
}

@Injectable()
export class AnthropicAdapter {
  private readonly logger = new Logger(AnthropicAdapter.name);
  private client?: Anthropic;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  /** Lazily build the SDK client (maxRetries: 2 → 3 attempts, like conversaflow). */
  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = this.config.get('ANTHROPIC_API_KEY', { infer: true });
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
      this.client = new Anthropic({ apiKey, maxRetries: 2 });
    }
    return this.client;
  }

  /** Single-turn completion (summarize, extract-facts). Null on failure. */
  async createCompletion(params: {
    system: string;
    userMessage: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<CompletionResult | null> {
    try {
      const response = await this.getClient().messages.create({
        model: params.model ?? DEFAULT_MODEL,
        max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: params.temperature ?? 0,
        system: params.system,
        messages: [{ role: 'user', content: params.userMessage }],
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return {
        text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    } catch (err) {
      this.logger.error(`anthropic_completion_error: ${String(err)}`);
      return null;
    }
  }

  /** Multi-turn message with optional tools (the turn-process mini-harness). */
  async createMessage(params: {
    system: string;
    messages: Anthropic.MessageParam[];
    tools?: Anthropic.MessageCreateParams['tools'];
    toolChoice?: Anthropic.MessageCreateParams['tool_choice'];
    model?: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<MessageResult | null> {
    try {
      const response = await this.getClient().messages.create({
        model: params.model ?? DEFAULT_MODEL,
        max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
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
      this.logger.error(`anthropic_message_error: ${String(err)}`);
      return null;
    }
  }
}
