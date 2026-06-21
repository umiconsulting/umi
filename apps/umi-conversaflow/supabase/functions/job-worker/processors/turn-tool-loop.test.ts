import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createToolOutcomeState } from "./tool-outcomes.ts";
import { runMiniHarnessToolLoop } from "./turn-tool-loop.ts";

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    systemPrompt: "Eres asistente.",
    userTurnText: "quiero un latte",
    recentMessages: [],
    draftCart: null,
    pendingClarification: null,
    currentState: "initial",
    toolOutcomes: createToolOutcomeState(),
    maxToolCalls: 3,
    toolContext: {
      businessId: "business-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
    },
    supabase: {},
    ...overrides,
  } as any;
}

Deno.test("mini harness returns model text when no tool is needed", async () => {
  const result = await runMiniHarnessToolLoop(baseParams({
    userTurnText: "hola",
    createMessageFn: async () => ({
      response: { content: [{ type: "text", text: "Claro, te ayudo." }] },
      inputTokens: 10,
      outputTokens: 4,
    }),
  }));

  assertEquals(result.finalText, "Claro, te ayudo.");
  assertEquals(result.llmCallCount, 1);
  assertEquals(result.toolCallCount, 0);
  assertEquals(result.stopReason, "final_text");
});

Deno.test("mini harness executes a tool and feeds observation back to the model", async () => {
  let callIndex = 0;
  const result = await runMiniHarnessToolLoop(baseParams({
    createMessageFn: async () => {
      callIndex++;
      if (callIndex === 1) {
        return {
          response: {
            content: [{
              type: "tool_use",
              id: "toolu_1",
              name: "search_menu",
              input: { query: "latte" },
            }],
          },
          inputTokens: 10,
          outputTokens: 5,
        };
      }
      return {
        response: {
          content: [{
            type: "text",
            text: "Tenemos latte caliente y frío.",
          }],
        },
        inputTokens: 8,
        outputTokens: 6,
      };
    },
    executeToolFn: async (_supabase: any, name: string, input: any) => ({
      found: 1,
      match_type: "exact",
      message: `${name}:${input.query}`,
      products: [{ name: "Latte" }],
    }),
  }));

  assertEquals(result.finalText, "Tenemos latte caliente y frío.");
  assertEquals(result.llmCallCount, 2);
  assertEquals(result.toolCallCount, 1);
  assertEquals(result.toolChain[0].name, "search_menu");
});

Deno.test("mini harness routes tool clarification through LLM phrasing and stores resume context", async () => {
  let callIndex = 0;
  const result = await runMiniHarnessToolLoop(baseParams({
    createMessageFn: async () => {
      callIndex++;
      if (callIndex === 1) {
        return {
          response: {
            content: [{
              type: "tool_use",
              id: "toolu_1",
              name: "add_to_cart",
              input: { query: "latte" },
            }],
          },
          inputTokens: 10,
          outputTokens: 5,
        };
      }
      return {
        response: {
          content: [{ type: "text", text: "¿Cómo lo prefieres, chico o grande?" }],
        },
        inputTokens: 8,
        outputTokens: 4,
      };
    },
    executeToolFn: async () => ({
      success: false,
      error_type: "needs_input",
      needs_clarification: "¿Lo quieres chico o grande?",
    }),
  }));

  assertEquals(result.finalText, "¿Cómo lo prefieres, chico o grande?");
  assertEquals(result.llmCallCount, 2);
  assertEquals(
    result.pendingClarification?.context,
    { resume_tool: "add_to_cart", resume_input: { query: "latte" } },
  );
});

Deno.test("mini harness omits stale pending clarification when user adds a new item", async () => {
  let sentContent = "";
  const result = await runMiniHarnessToolLoop(baseParams({
    userTurnText: "Tambien una galleta de chocolatechip.",
    pendingClarification: {
      question: "¿Cómo lo prefieres: Caliente, Rocas o Frappe?",
      context: {
        resume_tool: "add_to_cart",
        resume_input: { query: "latte regular" },
      },
    },
    createMessageFn: async ({ messages }: any) => {
      sentContent = String(messages[0].content);
      return {
        response: { content: [{ type: "text", text: "Claro." }] },
        inputTokens: 10,
        outputTokens: 2,
      };
    },
    executeToolFn: async () => ({
      success: true,
      customer_reply: "Galleta agregada.",
    }),
  }));

  assertEquals(result.stopReason, "forced_add_to_cart");
  assertEquals(sentContent.includes("ACLARACION PENDIENTE"), false);
});

Deno.test("mini harness blocks status question from confirming and asks LLM to phrase a confirmation prompt", async () => {
  let executed = false;
  let callIndex = 0;
  let secondCallSawBlock = false;
  const result = await runMiniHarnessToolLoop(baseParams({
    userTurnText: "Ya quedo?",
    currentState: "awaiting_confirmation",
    draftCart: { items: [{ product_name: "Latte Regular" }] },
    createMessageFn: async ({ messages }: any) => {
      callIndex++;
      if (callIndex === 1) {
        return {
          response: {
            content: [{
              type: "tool_use",
              id: "toolu_1",
              name: "confirm_order",
              input: {},
            }],
          },
          inputTokens: 10,
          outputTokens: 2,
        };
      }
      const lastUser = messages[messages.length - 1];
      const blockContent = JSON.stringify(lastUser?.content ?? "");
      if (blockContent.includes("blocked") && blockContent.includes("confirm_order")) {
        secondCallSawBlock = true;
      }
      return {
        response: {
          content: [{ type: "text", text: "¿Confirmas tu pedido tal como está?" }],
        },
        inputTokens: 8,
        outputTokens: 4,
      };
    },
    executeToolFn: async () => {
      executed = true;
      return { success: true };
    },
  }));

  assertEquals(executed, false);
  assertEquals(secondCallSawBlock, true);
  assertEquals(result.finalText, "¿Confirmas tu pedido tal como está?");
  assertEquals(result.toolCallCount, 0);
  assertEquals(result.toolChain[0].error_type, "blocked_unsafe_confirmation");
});

Deno.test("mini harness allows strong confirmation with draft cart", async () => {
  let callIndex = 0;
  let executed = false;
  const result = await runMiniHarnessToolLoop(baseParams({
    userTurnText: "Si, confirmo.",
    currentState: "awaiting_confirmation",
    draftCart: { items: [{ product_name: "Latte Regular" }] },
    createMessageFn: async () => {
      callIndex++;
      if (callIndex === 1) {
        return {
          response: {
            content: [{
              type: "tool_use",
              id: "toolu_1",
              name: "confirm_order",
              input: {},
            }],
          },
          inputTokens: 10,
          outputTokens: 2,
        };
      }
      return {
        response: { content: [{ type: "text", text: "Orden confirmada." }] },
        inputTokens: 8,
        outputTokens: 3,
      };
    },
    executeToolFn: async () => {
      executed = true;
      return { success: true, order_id: "order-1" };
    },
  }));

  assertEquals(executed, true);
  assertEquals(result.stopReason, "final_text");
  assertEquals(result.toolCallCount, 1);
});

Deno.test("mini harness forces business info for payment text and routes through LLM phrasing", async () => {
  let callIndex = 0;
  const result = await runMiniHarnessToolLoop(baseParams({
    userTurnText: "Puedo pagar por transferencia?",
    createMessageFn: async () => {
      callIndex++;
      if (callIndex === 1) {
        return {
          response: { content: [{ type: "text", text: "Sí, puedes." }] },
          inputTokens: 10,
          outputTokens: 2,
        };
      }
      return {
        response: {
          content: [{
            type: "text",
            text: "Sí, aceptamos transferencia. ¿Quieres que te pase los datos?",
          }],
        },
        inputTokens: 8,
        outputTokens: 6,
      };
    },
    executeToolFn: async (_supabase: any, name: string) => ({
      success: true,
      message: `${name}: transferencia disponible`,
    }),
  }));

  assertEquals(result.toolChain[0].name, "get_business_info");
  assertEquals(result.llmCallCount, 2);
  assertEquals(
    result.finalText,
    "Sí, aceptamos transferencia. ¿Quieres que te pase los datos?",
  );
});

Deno.test("mini harness blocks repeat order without recent-order proof and lets LLM phrase the message", async () => {
  const executedNames: string[] = [];
  let callIndex = 0;
  const result = await runMiniHarnessToolLoop(baseParams({
    userTurnText: "Si repite el ultimo y agrega la galleta.",
    currentState: "awaiting_confirmation",
    draftCart: { items: [{ product_name: "Galleta" }] },
    createMessageFn: async () => {
      callIndex++;
      if (callIndex === 1) {
        return {
          response: {
            content: [{
              type: "tool_use",
              id: "toolu_1",
              name: "reorder_last_order",
              input: {},
            }],
          },
          inputTokens: 10,
          outputTokens: 2,
        };
      }
      return {
        response: {
          content: [{
            type: "text",
            text: "No tengo un pedido previo tuyo. ¿Qué te gustaría pedir?",
          }],
        },
        inputTokens: 8,
        outputTokens: 6,
      };
    },
    executeToolFn: async (_supabase: any, name: string) => {
      executedNames.push(name);
      return { success: true, found: 0, orders: [] };
    },
  }));

  assertEquals(executedNames, ["get_recent_customer_orders"]);
  assertEquals(
    result.finalText,
    "No tengo un pedido previo tuyo. ¿Qué te gustaría pedir?",
  );
  assertEquals(
    result.toolChain.find((entry) => entry.name === "reorder_last_order")
      ?.error_type,
    "blocked_no_recent_orders",
  );
});

Deno.test("mini harness marks reset add_to_cart as replace cart", async () => {
  let executedInput: any = null;
  const result = await runMiniHarnessToolLoop(baseParams({
    userTurnText: "Mejor no repitas, solo quiero un chai con avena.",
    draftCart: { items: [{ product_name: "Galleta" }] },
    createMessageFn: async () => ({
      response: {
        content: [{
          type: "tool_use",
          id: "toolu_1",
          name: "add_to_cart",
          input: { query: "chai", milk: "avena" },
        }],
      },
      inputTokens: 10,
      outputTokens: 2,
    }),
    executeToolFn: async (_supabase: any, _name: string, input: any) => {
      executedInput = input;
      return { success: true, customer_reply: "Carrito actualizado." };
    },
  }));

  assertEquals(result.toolCallCount, 1);
  assertEquals(executedInput.replace_cart, true);
});

Deno.test("mini harness blocks bare new-order reset and lets LLM phrase the reset acknowledgment", async () => {
  let executed = false;
  let callIndex = 0;
  const result = await runMiniHarnessToolLoop(baseParams({
    userTurnText: "Ok entonces mejor quiero hacer otra orden.",
    createMessageFn: async () => {
      callIndex++;
      if (callIndex === 1) {
        return {
          response: {
            content: [{
              type: "tool_use",
              id: "toolu_1",
              name: "add_to_cart",
              input: { query: "cappuccino", size: "grande", milk: "avena" },
            }],
          },
          inputTokens: 10,
          outputTokens: 2,
        };
      }
      return {
        response: {
          content: [{ type: "text", text: "Claro, empecemos. ¿Qué te late?" }],
        },
        inputTokens: 8,
        outputTokens: 4,
      };
    },
    executeToolFn: async () => {
      executed = true;
      return { success: true };
    },
  }));

  assertEquals(executed, false);
  assertEquals(result.finalText, "Claro, empecemos. ¿Qué te late?");
  assertEquals(
    result.toolChain[0].error_type,
    "blocked_generic_reset",
  );
});

Deno.test("mini harness resolves pronoun 'ese' to last cart item before edit_cart", async () => {
  let executedInput: any = null;
  const result = await runMiniHarnessToolLoop(baseParams({
    userTurnText: "Quita ese.",
    draftCart: {
      items: [
        { product_name: "Americano", quantity: 1 },
        { product_name: "Galleta Chocolatechip", quantity: 1 },
      ],
    },
    createMessageFn: async () => ({
      response: {
        content: [{
          type: "tool_use",
          id: "toolu_1",
          name: "edit_cart",
          input: { action: "remove", remove_query: "ese" },
        }],
      },
      inputTokens: 10,
      outputTokens: 2,
    }),
    executeToolFn: async (_supabase: any, _name: string, input: any) => {
      executedInput = input;
      return { success: true, customer_reply: "Quité el producto." };
    },
  }));

  assertEquals(executedInput.remove_query, "Galleta Chocolatechip");
  assertEquals(result.toolCallCount, 1);
});

Deno.test("mini harness forces edit_cart when model returns no tool on revision intent", async () => {
  let executedName = "";
  let executedInput: any = null;
  const result = await runMiniHarnessToolLoop(baseParams({
    userTurnText: "Quita la galleta.",
    draftCart: {
      items: [
        { product_name: "Americano", quantity: 1 },
        { product_name: "Galleta Chocolatechip", quantity: 1 },
      ],
    },
    createMessageFn: async () => ({
      response: { content: [{ type: "text", text: "Claro." }] },
      inputTokens: 10,
      outputTokens: 2,
    }),
    executeToolFn: async (_supabase: any, name: string, input: any) => {
      executedName = name;
      executedInput = input;
      return { success: true, customer_reply: "Quité la galleta." };
    },
  }));

  assertEquals(executedName, "edit_cart");
  assertEquals(executedInput.remove_query, "galleta");
  assertEquals(result.stopReason, "forced_edit_cart");
  assertEquals(result.toolCallCount, 1);
});

Deno.test("mini harness passes option correction into pending clarification context", async () => {
  let executedInput: any = null;
  const result = await runMiniHarnessToolLoop(baseParams({
    userTurnText: "Mejor con leche de coco, no de avena.",
    pendingClarification: {
      question: "¿Cómo lo prefieres: Caliente, Rocas o Frappe?",
      context: {
        resume_tool: "add_to_cart",
        resume_input: { milk: "avena", size: "chico", query: "chai latte" },
      },
    },
    createMessageFn: async ({ messages }: any) => {
      const text = String(messages[0].content);
      const pending = text.includes("ACLARACION PENDIENTE")
        ? JSON.parse(
          text.match(/ACLARACION PENDIENTE:\n([\s\S]+?)(?:\n\n|$)/)?.[1] ?? "{}",
        )
        : null;
      if (pending) executedInput = pending;
      return {
        response: { content: [{ type: "text", text: "Listo." }] },
        inputTokens: 10,
        outputTokens: 2,
      };
    },
    executeToolFn: async () => ({ success: true }),
  }));

  assertEquals(result.finalText, "Listo.");
  assertEquals(
    (executedInput?.context as any)?.resume_input?.milk,
    "coco",
  );
});

Deno.test("mini harness converts mistaken add_to_cart on strong confirmation into confirm_order", async () => {
  let executedName = "";
  const result = await runMiniHarnessToolLoop(baseParams({
    userTurnText: "Si, confirmo.",
    currentState: "awaiting_confirmation",
    draftCart: { items: [{ product_name: "Galleta" }] },
    createMessageFn: async () => ({
      response: {
        content: [{
          type: "tool_use",
          id: "toolu_1",
          name: "add_to_cart",
          input: { query: "americano" },
        }],
      },
      inputTokens: 10,
      outputTokens: 2,
    }),
    executeToolFn: async (_supabase: any, name: string) => {
      executedName = name;
      return { success: true, customer_reply: "Orden confirmada." };
    },
  }));

  assertEquals(result.toolCallCount, 1);
  assertEquals(executedName, "confirm_order");
});
