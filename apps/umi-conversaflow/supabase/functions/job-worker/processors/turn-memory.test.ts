import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { WorkingMemory } from "../../_shared/memory.ts";
import { shapeTurnMemory } from "./turn-memory.ts";

function memory(overrides: Partial<WorkingMemory> = {}): WorkingMemory {
  return {
    recentMessages: [],
    summary: null,
    facts: null,
    semanticContext: null,
    semanticStats: null,
    ...overrides,
  };
}

Deno.test("shapeTurnMemory trims recent and semantic context", () => {
  const shaped = shapeTurnMemory(
    memory({
      recentMessages: Array.from({ length: 4 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `m${index}`,
      })),
      semanticContext: Array.from({ length: 3 }, (_, index) => ({
        role: "user",
        content: `s${index}`,
        similarity: 0.9 - index / 10,
        ponderingScore: 0.8,
        intentSignature: "test",
        sourceScope: "customer",
      })),
    }),
    { maxRecentMessages: 2, maxRetrievedMemories: 1 },
  );

  assertEquals(
    shaped.workingMemory.recentMessages.map((message) => message.content),
    ["m2", "m3"],
  );
  assertEquals(shaped.workingMemory.semanticContext?.length, 1);
  assertEquals(shaped.metadata.recent_count, 2);
  assertEquals(shaped.metadata.semantic_count, 1);
  assertEquals(shaped.metadata.semantic_source_scope, "customer");
  assertEquals(shaped.metadata.top_similarity, 0.9);
});

Deno.test("shapeTurnMemory reports absent memory without blocking the turn", () => {
  const shaped = shapeTurnMemory(memory());

  assertEquals(shaped.metadata.facts_present, false);
  assertEquals(shaped.metadata.semantic_count, 0);
  assertEquals(shaped.metadata.omitted_reasons, [
    "no_recent_messages",
    "no_summary",
    "no_customer_facts",
    "no_semantic_recall",
  ]);
});

Deno.test("shapeTurnMemory records fact fields as context only", () => {
  const shaped = shapeTurnMemory(
    memory({
      facts: {
        preferences: ["leche de avena"],
        dislikes: [],
        typical_order: "latte grande",
        allergies: ["lactosa"],
        notes: null,
      },
    }),
  );

  assertEquals(shaped.metadata.facts_present, true);
  assertEquals(shaped.metadata.fact_fields, [
    "preferences",
    "typical_order",
    "allergies",
  ]);
  assertEquals(
    shaped.metadata.guardrail,
    "memory_is_context_not_operational_truth",
  );
});
