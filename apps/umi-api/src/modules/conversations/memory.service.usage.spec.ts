import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiUsageRepository } from '../../shared/usage/ai-usage.repository';
import { MemoryService } from './memory.service';

/**
 * A failed usage insert must not fail the customer-facing call. These specs
 * drive the REAL repository with a pool that rejects, so the proof covers the
 * writer and both enrichment callers, not a mock that pretends to fail.
 */
function make(completion: unknown) {
  const query = vi.fn().mockRejectedValue(new Error('permission denied for table ai_usage'));
  const config = { get: vi.fn(() => 'anthropic') };
  const usage = new AiUsageRepository({ query } as never, config as never);
  const llm = { createCompletion: vi.fn().mockResolvedValue(completion) };
  const memory = { getCustomerFacts: vi.fn(), searchCustomerMessages: vi.fn() };
  const messages = { getRecentMessages: vi.fn() };
  const svc = new MemoryService(
    llm,
    {} as never,
    memory as never,
    messages as never,
    usage,
  );
  return { svc, query };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MemoryService · usage row is fail-safe', () => {
  it('extractCustomerFacts still returns the facts when the insert fails', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { svc, query } = make({
      text: '{"preferences":["latte"],"dislikes":[],"typical_order":"latte","allergies":[],"notes":null}',
      inputTokens: 1200,
      outputTokens: 90,
    });

    const facts = await svc.extractCustomerFacts([{ role: 'user', content: 'un latte' }], null, {
      merchantId: '00000000-0000-4000-8000-0000000000b1',
      conversationId: '00000000-0000-4000-8000-0000000000b2',
    });

    expect(facts).toMatchObject({ preferences: ['latte'], typical_order: 'latte' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('generateSummary still returns the summary when the insert fails', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { svc, query } = make({
      text: 'El cliente pidió un latte.',
      inputTokens: 900,
      outputTokens: 40,
    });

    const summary = await svc.generateSummary([{ role: 'user', content: 'hola' }], null, {
      merchantId: '00000000-0000-4000-8000-0000000000b1',
      conversationId: '00000000-0000-4000-8000-0000000000b2',
    });

    expect(summary).toBe('El cliente pidió un latte.');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
