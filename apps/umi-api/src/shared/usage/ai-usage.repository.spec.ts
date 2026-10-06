import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiUsageRepository } from './ai-usage.repository';

const MERCHANT = '00000000-0000-4000-8000-0000000000a1';
const CONVERSATION = '00000000-0000-4000-8000-0000000000a2';
const TURN = '00000000-0000-4000-8000-0000000000a3';

function make(cfg: Record<string, unknown> = {}) {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
  const config = { get: vi.fn((key: string) => cfg[key]) };
  const repo = new AiUsageRepository({ query } as never, config as never);
  return { repo, query };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AiUsageRepository.record', () => {
  it('inserts one billing row and prices it from the model table', async () => {
    const { repo, query } = make({ LLM_PROVIDER: 'anthropic' });

    await repo.record({
      merchantId: MERCHANT,
      conversationId: CONVERSATION,
      turnId: TURN,
      requestId: 'req-1',
      kind: 'reply',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      promptTokens: 1000,
      completionTokens: 100,
      llmCallCount: 3,
      latencyMs: 400,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO umi.ai_usage');
    // A replayed turn must not bill twice.
    expect(sql).toContain('ON CONFLICT (turn_id, kind) WHERE turn_id IS NOT NULL DO NOTHING');
    expect(params).toEqual([
      MERCHANT,
      CONVERSATION,
      TURN,
      'req-1',
      'reply',
      'anthropic',
      'claude-haiku-4-5-20251001',
      1000,
      100,
      3,
      400,
      0.0015,
    ]);
  });

  it('fills the nullable ids with null and defaults llm_call_count to 1', async () => {
    const { repo, query } = make({ LLM_PROVIDER: 'anthropic' });

    await repo.record({
      merchantId: MERCHANT,
      kind: 'summary',
      promptTokens: 10,
      completionTokens: 2,
    });

    const [, params] = query.mock.calls[0];
    expect(params.slice(0, 4)).toEqual([MERCHANT, null, null, null]);
    expect(params[5]).toBe('anthropic');
    expect(params[6]).toBe('claude-haiku-4-5-20251001');
    expect(params[9]).toBe(1);
  });

  it('names the configured provider when no explicit pair is given', async () => {
    const { repo, query } = make({
      LLM_PROVIDER: 'deepseek',
      DEEPSEEK_MODEL: 'deepseek-flash',
    });

    await repo.record({
      merchantId: MERCHANT,
      kind: 'portrait',
      promptTokens: 10,
      completionTokens: 2,
    });

    const [, params] = query.mock.calls[0];
    expect(params[5]).toBe('deepseek');
    expect(params[6]).toBe('deepseek-flash');
    // No recorded price for DeepSeek: cost 0, never a guessed number.
    expect(params[11]).toBe(0);
  });

  it('keeps an explicit provider/model pair, so the reply row stays Anthropic', async () => {
    const { repo, query } = make({ LLM_PROVIDER: 'deepseek', DEEPSEEK_MODEL: 'deepseek-flash' });

    await repo.record({
      merchantId: MERCHANT,
      kind: 'reply',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      promptTokens: 10,
      completionTokens: 2,
    });

    const [, params] = query.mock.calls[0];
    expect(params[5]).toBe('anthropic');
    expect(params[6]).toBe('claude-haiku-4-5-20251001');
  });

  it('never throws when the insert fails, and warns instead', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { repo, query } = make({ LLM_PROVIDER: 'anthropic' });
    query.mockRejectedValue(new Error('permission denied for table ai_usage'));

    await expect(
      repo.record({
        merchantId: MERCHANT,
        kind: 'reply',
        promptTokens: 1,
        completionTokens: 1,
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('ai_usage_write_failed');
    expect(String(warn.mock.calls[0][0])).toContain('permission denied');
  });
});
