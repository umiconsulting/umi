import { assertEquals } from "jsr:@std/assert";
import { applyToolOutcome, createToolOutcomeState } from "./tool-outcomes.ts";

Deno.test("applyToolOutcome treats reorder_last_order as order confirmation", () => {
  const state = createToolOutcomeState();

  applyToolOutcome(state, "reorder_last_order", {
    success: true,
    customer_reply: "Tu orden quedo confirmada.",
  });

  assertEquals(state.orderConfirmed, true);
  assertEquals(state.suggestedTemplate, "Tu orden quedo confirmada.");
});

Deno.test("applyToolOutcome prefers cart summary for add_to_cart narration", () => {
  const state = createToolOutcomeState();

  applyToolOutcome(state, "add_to_cart", {
    success: true,
    summary_text: "Resumen del carrito",
  });

  assertEquals(state.cartUpdated, true);
  assertEquals(state.suggestedTemplate, "Resumen del carrito");
});
