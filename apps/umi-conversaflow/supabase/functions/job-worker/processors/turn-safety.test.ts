import {
  blockUnverifiedOrderConfirmation,
  deriveNextConversationState,
} from "./turn-safety.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("blocks order confirmation language when no order tool confirmed", () => {
  assertEquals(
    blockUnverifiedOrderConfirmation({
      text: "Tu pedido está confirmado.",
      orderConfirmed: false,
    }),
    "Ocurrió un error con tu orden. Intenta después.",
  );
});

Deno.test("allows order confirmation language after order tool confirmed", () => {
  assertEquals(
    blockUnverifiedOrderConfirmation({
      text: "Tu pedido está confirmado.",
      orderConfirmed: true,
    }),
    "Tu pedido está confirmado.",
  );
});

Deno.test("derives minimal state from tool outcomes", () => {
  assertEquals(
    deriveNextConversationState({
      pendingClarification: { question: "¿Cuál presentación?" },
      orderConfirmed: false,
      orderCancelled: false,
      orderChangesConfirmed: false,
      cartUpdated: true,
      searchPerformed: false,
      fallbackState: "initial",
    }),
    "awaiting_clarification",
  );

  assertEquals(
    deriveNextConversationState({
      pendingClarification: null,
      orderConfirmed: false,
      orderCancelled: false,
      orderChangesConfirmed: false,
      cartUpdated: true,
      searchPerformed: false,
      fallbackState: "initial",
    }),
    "awaiting_confirmation",
  );
});
