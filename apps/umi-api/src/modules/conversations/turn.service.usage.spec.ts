import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiUsageRepository } from '../../shared/usage/ai-usage.repository';
import { TurnService } from './turn.service';

/**
 * The reply row is written on the turn path, after the reply is committed. A
 * failed insert must not throw out of `process()`. This spec drives the REAL
 * `TurnService` with the REAL usage repository on a pool that rejects, so the
 * proof is the production call chain and not a mock of it.
 */
const MERCHANT_ID = '00000000-0000-4000-8000-0000000000c1';
const CONVERSATION_ID = '00000000-0000-4000-8000-0000000000c2';
const PERSON_ID = '00000000-0000-4000-8000-0000000000c3';
const TURN_ID = '00000000-0000-4000-8000-0000000000c4';

function make() {
  const query = vi.fn().mockRejectedValue(new Error('permission denied for table ai_usage'));
  const config = { get: vi.fn(() => 'anthropic') };
  const usage = new AiUsageRepository({ query } as never, config as never);

  const commitReply = vi.fn().mockResolvedValue({ assistantMessageId: 'a-1', outboxId: 'o-1' });
  const turns = {
    loadTurn: vi.fn().mockResolvedValue({
      id: TURN_ID,
      status: 'released',
      sourceMessageIds: ['m-1'],
      mergedUserText: 'un latte',
      firstMessageAt: null,
      lastMessageAt: '2026-09-18T00:00:00.000Z',
      holdUntil: null,
      releasedAt: '2026-09-18T00:00:00.000Z',
    }),
    hasNewerUserMessages: vi.fn().mockResolvedValue(false),
    upsertTurn: vi.fn().mockResolvedValue(undefined),
  };
  const conversations = {
    loadById: vi.fn().mockResolvedValue({
      id: CONVERSATION_ID,
      merchantId: MERCHANT_ID,
      personId: PERSON_ID,
      status: 'open',
      summary: null,
      draftCart: null,
    }),
  };
  const identity = {
    getPerson: vi.fn().mockResolvedValue({
      displayName: 'Ana',
      phone: '+526671234567',
      replyAddress: '+526671234567',
    }),
  };
  const messages = { countMessages: vi.fn().mockResolvedValue(4) };
  const merchantConfig = { fetchConfigRow: vi.fn().mockResolvedValue(null) };
  const memory = {
    buildWorkingMemory: vi.fn().mockResolvedValue({
      recentMessages: [],
      summary: null,
      facts: null,
      semanticContext: null,
      semanticStats: null,
    }),
  };
  const toolLoop = {
    run: vi.fn().mockResolvedValue({
      finalText: 'Claro, un latte.',
      inputTokens: 6000,
      outputTokens: 900,
      llmCallCount: 2,
      toolCallCount: 1,
      toolResultBytes: 120,
      toolChain: [],
      pendingClarification: null,
      stopReason: 'completed',
    }),
  };
  const orderLocation = { resolve: vi.fn().mockResolvedValue({ kind: 'none' }) };
  const enqueue = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const log = { log: vi.fn() };

  const svc = new TurnService(
    conversations as never,
    turns as never,
    identity as never,
    messages as never,
    merchantConfig as never,
    memory as never,
    toolLoop as never,
    { commitTurnReply: commitReply } as never,
    enqueue as never,
    log as never,
    orderLocation as never,
    usage,
  );

  return { svc, query, commitReply };
}

const payload = {
  conversation_id: CONVERSATION_ID,
  person_id: PERSON_ID,
  merchant_id: MERCHANT_ID,
  turn_id: TURN_ID,
  request_id: 'req-turn-1',
  location_id: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TurnService.process · the reply usage row is fail-safe', () => {
  it('completes the turn and commits the reply when the insert fails', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { svc, query, commitReply } = make();

    await expect(svc.process(payload)).resolves.toBeUndefined();

    // The insert was attempted, once, on the turn path.
    expect(query).toHaveBeenCalledTimes(1);

    // The reply was still committed, and the customer still got it.
    expect(commitReply).toHaveBeenCalledTimes(1);
    expect(commitReply.mock.calls[0][0]).toMatchObject({
      merchantId: MERCHANT_ID,
      conversationId: CONVERSATION_ID,
      replyBody: 'Claro, un latte.',
    });
  });

  it('sends the turn totals and the corrected price to the writer', async () => {
    const { svc, query } = make();
    query.mockResolvedValue({ rows: [], rowCount: 1 });

    await svc.process(payload);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO umi.ai_usage');
    expect(params).toEqual([
      MERCHANT_ID,
      CONVERSATION_ID,
      TURN_ID,
      'req-turn-1',
      'reply',
      'anthropic',
      'claude-haiku-4-5-20251001',
      6000,
      900,
      2,
      expect.any(Number),
      0.0105,
    ]);
  });
});
