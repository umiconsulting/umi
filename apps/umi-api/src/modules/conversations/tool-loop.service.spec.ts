import { describe, expect, it, vi } from 'vitest';
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
  merchantId: 't1',
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
    svc: new ToolLoopService(anthropic as never, tools),
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

  // The confirmation gate tests EVIDENCE, not vocabulary. A word list refused a real
  // customer's "confirmado", re-asked, and she left before the order was written; any
  // such list is a semantic classifier we cannot finish. So the model judges whether
  // the customer said yes, and the gate only proves the customer said it — which is
  // why these cases are about the QUOTE, not about the words in it.
  const CART = { items: [{ product_id: 'p', product_name: 'Latte', quantity: 1 }] };
  const confirmable = (userTurnText: string) =>
    baseParams({ userTurnText, draftCart: CART, currentState: 'awaiting_confirmation' });

  it.each([
    ['confirmado', 'confirmado'],
    ['Confirmado.', 'confirmado'], // quote normalizes against the raw message
    ['sería todo, confirmo', 'confirmo'], // a quote from inside a longer message
    ['yeah go ahead', 'yeah go ahead'], // English mannerism — no list to miss it
    ['va que va pues', 'va que va'],
    ['👍', '👍'],
  ])('confirms %j when the model quotes %j', async (text, quote) => {
    h = make([
      msg([toolUse('confirm_order', { customer_confirmation: quote })]),
      msg([textBlock('¡Listo!')]),
    ]);
    const r = await h.svc.run(confirmable(text));
    expect(h.tools.execute).toHaveBeenCalledWith(
      'confirm_order',
      { customer_confirmation: quote },
      CTX,
    );
    expect(r.toolChain.find((e) => e.name === 'confirm_order')?.success).toBe(true);
  });

  it.each([
    ['el cliente dijo que si', 'a paraphrase the customer never wrote'],
    ['', 'an empty quote'],
    [undefined, 'a missing argument'],
  ] as Array<[string | undefined, string]>)(
    'blocks a confirmation quoting %j — %s',
    async (quote) => {
      h = make([
        msg([
          toolUse('confirm_order', quote === undefined ? {} : { customer_confirmation: quote }),
        ]),
        msg([textBlock('¿Confirmas?')]),
      ]);
      const r = await h.svc.run(confirmable('todavía lo estoy pensando'));
      expect(h.tools.execute).not.toHaveBeenCalled();
      const blocked = r.toolChain.find((e) => e.name === 'confirm_order');
      expect(blocked?.error_type).toBe('blocked_unsafe_confirmation');
      expect(blocked?.error_msg).toBe('confirmation_not_found_in_customer_message');
    },
  );

  // A quote must match WHOLE tokens. A raw substring check let the short quotes a
  // confirmation is most likely to be ride inside unrelated words, so the gate proved
  // nothing precisely where it mattered most.
  it.each([
    ['si', 'siempre lo mismo'],
    ['va', 'para llevar'],
    ['ya', 'vaya precio'],
    ['a', 'todavía lo estoy pensando'],
  ])('blocks the quote %j riding inside %j', async (quote, text) => {
    h = make([
      msg([toolUse('confirm_order', { customer_confirmation: quote })]),
      msg([textBlock('¿Confirmas?')]),
    ]);
    const r = await h.svc.run(confirmable(text));
    expect(h.tools.execute).not.toHaveBeenCalled();
    expect(r.toolChain.find((e) => e.name === 'confirm_order')?.error_msg).toBe(
      'confirmation_not_found_in_customer_message',
    );
  });

  // The frame binds the reply to the question it answers. Without it the model gets a
  // reconstruction where "confirmado" sits under MENSAJE ACTUAL and the question that
  // licensed it sits under CONTEXTO RECIENTE, related only by adjacency.
  describe('confirmation frame', () => {
    const envelope = (h: ReturnType<typeof make>) =>
      String(h.anthropic.createMessage.mock.calls[0][0].messages[0].content);

    it("frames the reply against the bot's own last message", async () => {
      h = make([msg([textBlock('Va.')])]);
      await h.svc.run(
        baseParams({
          userTurnText: 'ya',
          draftCart: { ...CART, presented_at: '2026-08-15T12:00:00Z' },
          recentMessages: [
            { role: 'user', content: 'un latte' },
            { role: 'assistant', content: 'Total $65. ¿Confirmas?' },
          ],
        }),
      );
      const sent = envelope(h);
      expect(sent).toContain('CÓMO LEER EL MENSAJE ACTUAL');
      expect(sent).toContain('Tu último mensaje fue: "Total $65. ¿Confirmas?"');
      expect(sent).toContain('ya le mostraste al cliente el resumen con su total');
      // Neutral: all three readings offered, and the frame precedes the customer text.
      expect(sent).toContain('No queda claro');
      expect(sent.indexOf('CÓMO LEER')).toBeLessThan(sent.indexOf('MENSAJE ACTUAL'));
    });

    it('says the total has NOT been shown when the cart was never presented', async () => {
      h = make([msg([textBlock('Va.')])]);
      await h.svc.run(baseParams({ userTurnText: 'ya', draftCart: CART }));
      const sent = envelope(h);
      expect(sent).toContain('todavía no le has mostrado el resumen con su total');
      expect(sent).toContain('muéstraselo antes de pedirle que confirme');
    });

    it('is absent when there is no cart, so it never leads a plain conversation', async () => {
      h = make([msg([textBlock('¡Hola!')])]);
      await h.svc.run(baseParams({ userTurnText: 'hola', draftCart: null }));
      expect(envelope(h)).not.toContain('CÓMO LEER EL MENSAJE ACTUAL');
    });
  });

  it('does not rewrite add_to_cart into a confirmation', async () => {
    // The regex that forced this rewrite is gone: with the gate no longer judging
    // wording, the model calls confirm_order itself or not at all.
    h = make([msg([toolUse('add_to_cart', { query: 'latte' })]), msg([textBlock('Va.')])]);
    const r = await h.svc.run(confirmable('confirmo'));
    expect(r.toolChain.some((e) => e.name === 'confirm_order')).toBe(false);
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
