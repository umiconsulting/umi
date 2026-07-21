import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolLoopService } from './tool-loop.service';
import { createToolOutcomeState } from './tool-outcomes';
import type { ToolContext } from './turn.types';

type Block = Record<string, unknown>;
function msg(content: Block[]) {
  return { response: { content }, inputTokens: 1, outputTokens: 1 };
}
const textBlock = (t: string): Block => ({ type: 'text', text: t });
const toolUse = (name: string, input: Block = {}, id = 't1'): Block => ({
  type: 'tool_use',
  id,
  name,
  input,
});

const CTX: ToolContext = {
  tenantId: 't1',
  personId: 'p1',
  conversationId: 'c1',
  customerPhone: '+5210000000000',
};

function make(responses: ReturnType<typeof msg>[]) {
  const queue = [...responses];
  const anthropic = {
    createMessage: vi.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? null)),
  };
  const tools = {
    definitions: () => [],
    execute: vi.fn().mockResolvedValue({ success: true, summary_text: 'ok' }),
  };
  return {
    svc: new ToolLoopService(anthropic as never, tools as never),
    anthropic,
    tools,
  };
}

function baseParams(over: Partial<Parameters<ToolLoopService['run']>[0]> = {}) {
  return {
    systemPrompt: 'SYS',
    userTurnText: 'gracias',
    recentMessages: [],
    draftCart: null,
    pendingClarification: null,
    currentState: 'initial',
    toolOutcomes: createToolOutcomeState(),
    maxToolCalls: 4,
    toolContext: CTX,
    ...over,
  };
}

describe('ToolLoopService', () => {
  let h: ReturnType<typeof make>;

  it('returns the model text when no tools are used', async () => {
    h = make([msg([textBlock('¡Hola! ¿Qué se te antoja?')])]);
    const r = await h.svc.run(baseParams());
    expect(r.finalText).toBe('¡Hola! ¿Qué se te antoja?');
    expect(r.stopReason).toBe('final_text');
    expect(r.toolCallCount).toBe(0);
    expect(h.tools.execute).not.toHaveBeenCalled();
  });

  it('blocks confirm_order when there is no draft cart (safety gate)', async () => {
    h = make([msg([toolUse('confirm_order')]), msg([textBlock('¿Qué quieres pedir?')])]);
    const r = await h.svc.run(baseParams({ userTurnText: 'confirmo', draftCart: null }));
    expect(h.tools.execute).not.toHaveBeenCalled(); // never executed — blocked
    const blocked = r.toolChain.find((e) => e.name === 'confirm_order');
    expect(blocked?.success).toBe(false);
    expect(blocked?.error_type).toBe('blocked_unsafe_confirmation');
  });

  it('dedups a repeated tool call with identical input', async () => {
    h = make([
      msg([toolUse('search_menu', { query: 'cafe' }, 'a')]),
      msg([toolUse('search_menu', { query: 'cafe' }, 'b')]),
      msg([textBlock('Tenemos varios cafés.')]),
    ]);
    const r = await h.svc.run(baseParams({ userTurnText: 'que cafes tienen' }));
    expect(h.tools.execute).toHaveBeenCalledTimes(1); // second call deduped
    expect(r.stopReason).toBe('repeated_tool_call');
  });

  it('enforces the max-tool-calls budget', async () => {
    h = make([
      msg([toolUse('search_menu', { query: 'a' }, 'a')]),
      msg([toolUse('search_menu', { query: 'b' }, 'b')]),
      msg([textBlock('Listo.')]),
    ]);
    const r = await h.svc.run(baseParams({ userTurnText: 'menu', maxToolCalls: 1 }));
    expect(h.tools.execute).toHaveBeenCalledTimes(1);
    expect(r.stopReason).toBe('max_tool_calls');
  });

  it('force-fires add_to_cart on a concrete order intent when the model calls no tool', async () => {
    h = make([msg([textBlock('')]), msg([textBlock('Agregué tu latte.')])]);
    const r = await h.svc.run(baseParams({ userTurnText: 'quiero un latte grande' }));
    expect(h.tools.execute).toHaveBeenCalledWith('add_to_cart', expect.any(Object), CTX);
    expect(r.toolChain.some((e) => e.name === 'add_to_cart')).toBe(true);
  });
});
