import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { AnthropicAdapter } from './anthropic.adapter';

function adapterWith(values: Record<string, unknown>): AnthropicAdapter {
  const config = { get: (k: string) => values[k] } as unknown as ConfigService<
    Record<string, unknown>,
    true
  >;
  return new AnthropicAdapter(config);
}

/** Inject a fake SDK client so no real network call is made (getClient() reuses it). */
function withClient(adapter: AnthropicAdapter, create: ReturnType<typeof vi.fn>) {
  (adapter as unknown as { client: unknown }).client = {
    messages: { create },
  };
}

const WITH_KEY = { ANTHROPIC_API_KEY: 'k' };

describe('AnthropicAdapter', () => {
  it('returns null when the API key is missing (getClient throws, caught)', async () => {
    const result = await adapterWith({}).createCompletion({
      system: 's',
      userMessage: 'u',
    });
    expect(result).toBeNull();
  });

  it('createCompletion joins text blocks and reports token usage', async () => {
    const adapter = adapterWith(WITH_KEY);
    const create = vi.fn().mockResolvedValue({
      content: [
        { type: 'text', text: 'hola ' },
        { type: 'tool_use', id: 't', name: 'x', input: {} },
        { type: 'text', text: 'mundo' },
      ],
      usage: { input_tokens: 11, output_tokens: 4 },
    });
    withClient(adapter, create);

    const result = await adapter.createCompletion({ system: 's', userMessage: 'u' });
    expect(result).toEqual({ text: 'hola mundo', inputTokens: 11, outputTokens: 4 });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 's',
        messages: [{ role: 'user', content: 'u' }],
        temperature: 0,
      }),
    );
  });

  it('createCompletion returns null when the SDK throws', async () => {
    const adapter = adapterWith(WITH_KEY);
    withClient(adapter, vi.fn().mockRejectedValue(new Error('rate_limit')));
    expect(
      await adapter.createCompletion({ system: 's', userMessage: 'u' }),
    ).toBeNull();
  });

  it('createMessage forwards tools and returns the raw response + usage', async () => {
    const adapter = adapterWith(WITH_KEY);
    const response = {
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 7, output_tokens: 3 },
    };
    const create = vi.fn().mockResolvedValue(response);
    withClient(adapter, create);

    const tools = [{ name: 'search', description: 'd', input_schema: { type: 'object' } }];
    const result = await adapter.createMessage({
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tools: tools as never,
    });

    expect(result).toEqual({ response, inputTokens: 7, outputTokens: 3 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ tools }));
  });
});
