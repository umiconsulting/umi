import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { buildHarnessSystemPrompt } from "./prompts.ts";

Deno.test("buildHarnessSystemPrompt stays tenant-generic and includes tool guidance", () => {
  const prompt = buildHarnessSystemPrompt({
    customerName: "Juan",
    currentState: "browsing",
    voice: {
      assistant_name: "Umi",
      locale: "es-MX",
      tone: "amable",
      style_notes: ["Breve"],
    },
    workingMemory: {
      recentMessages: [],
      summary: null,
      facts: null,
      semanticContext: null,
      semanticStats: null,
    },
    partialCancelledOrder: null,
  });

  assertStringIncludes(prompt, "Eres Umi, asistente de WhatsApp del negocio.");
  assertStringIncludes(prompt, "`add_to_cart`");
  assertStringIncludes(prompt, "`search_menu`");
  assertEquals(prompt.includes("Café Kalala Chapule"), false);
});
