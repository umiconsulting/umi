import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { processTurnProcess } from "./turn-process.ts";
import type { WorkingMemory } from "../../_shared/memory.ts";

type EqFilter = { column: string; value: unknown };

function createFakeSupabase(options: { stateConflict?: boolean } = {}) {
  const db = {
    turn: {
      id: "turn-1",
      status: "released",
      source_message_ids: ["msg-user-1"],
      merged_user_text: "quiero un latte grande",
      integrity_decision: "release",
      integrity_reason: "stable_turn_ready_for_processing",
      base_state_version: 0,
      first_message_at: "2026-05-11T10:00:00.000Z",
      last_message_at: "2026-05-11T10:00:01.000Z",
      released_at: "2026-05-11T10:00:02.000Z",
    },
    conversation: {
      id: "conversation-1",
      current_state: "initial",
      state_version: 0,
      draft_cart: null,
      pending_clarification: null,
    },
    customer: {
      id: "customer-1",
      phone: "+526641234567",
      name: "Ana",
    },
    messageCount: 2,
  };

  class Query {
    private filters: EqFilter[] = [];
    private updatePayload: Record<string, unknown> | null = null;
    private countHead = false;

    constructor(private table: string) {}

    select(_columns?: string, options?: { count?: string; head?: boolean }) {
      this.countHead = options?.head === true;
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push({ column, value });
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.updatePayload = payload;
      return this;
    }

    maybeSingle() {
      return Promise.resolve(this.readSingle());
    }

    single() {
      return Promise.resolve(this.readSingle());
    }

    then(
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(this.finish()).then(resolve, reject);
    }

    private filterValue(column: string) {
      return this.filters.find((filter) => filter.column === column)?.value;
    }

    private readSingle() {
      if (this.table === "conversation_turns") {
        return { data: db.turn, error: null };
      }
      if (this.table === "conversations") {
        return { data: db.conversation, error: null };
      }
      if (this.table === "customers") {
        return { data: db.customer, error: null };
      }
      return { data: null, error: null };
    }

    private finish() {
      if (this.table === "messages" && this.countHead) {
        return { data: null, error: null, count: db.messageCount };
      }

      if (this.table === "conversations" && this.updatePayload) {
        const id = this.filterValue("id");
        const stateVersion = this.filterValue("state_version");
        if (options.stateConflict) {
          return { data: [], error: null };
        }
        if (
          id === db.conversation.id &&
          stateVersion === db.conversation.state_version
        ) {
          db.conversation = { ...db.conversation, ...this.updatePayload };
          return { data: [{ id: db.conversation.id }], error: null };
        }
        return { data: [], error: null };
      }

      return this.readSingle();
    }
  }

  return {
    db,
    supabase: {
      from(table: string) {
        return new Query(table);
      },
    },
  };
}

const payload = {
  conversation_id: "conversation-1",
  customer_id: "customer-1",
  business_id: "business-1",
  turn_id: "turn-1",
  request_id: "request-1",
};

function createDeps(params: {
  turnUpdates: any[];
  jobs?: any[];
  outboxes?: any[];
  traces?: any[];
  aiTurns?: any[];
  assistantMessages?: string[];
  runToolLoopFn: (loopParams: any) => Promise<any>;
}) {
  const jobs = params.jobs ?? [];
  const outboxes = params.outboxes ?? [];
  const traces = params.traces ?? [];
  const aiTurns = params.aiTurns ?? [];
  const assistantMessages = params.assistantMessages ?? [];

  return {
    buildWorkingMemoryFn: async () => workingMemory(),
    fetchBusinessConfigRowFn: async () => ({
      id: "business-1",
      config: {
        voice: {
          assistant_name: "Umi",
          locale: "es-MX",
          tone: "cálido",
        },
      },
    }),
    getActivePartialCancelledOrderFn: async () => null,
    hasNewerUserMessagesFn: async () => false,
    insertJobFn: async (_client: any, jobParams: any) => {
      jobs.push(jobParams);
      return `job-${jobs.length}`;
    },
    insertMessageFn: async (
      _conversationId: string,
      _role: string,
      content: string,
    ) => {
      assistantMessages.push(content);
      return "msg-assistant-1";
    },
    insertOutboxFn: async (_client: any, outboxParams: any) => {
      outboxes.push(outboxParams);
      return "outbox-1";
    },
    logAiTurnFn: async (entry: any) => {
      aiTurns.push(entry);
    },
    logPipelineTraceFn: async (entry: any) => {
      traces.push(entry);
    },
    runToolLoopFn: params.runToolLoopFn,
    triggerJobWorkerFn: async () => {},
    upsertConversationTurnFn: async (_client: any, turnParams: any) => {
      params.turnUpdates.push(turnParams);
      return { id: turnParams.existingTurnId ?? "turn-1", ...turnParams };
    },
  };
}

function workingMemory(): WorkingMemory {
  return {
    recentMessages: [
      { role: "user", content: "hola" },
      { role: "assistant", content: "hola, te ayudo" },
      { role: "user", content: "quiero un latte grande" },
    ],
    summary: "Cliente suele pedir bebidas calientes.",
    facts: {
      preferences: ["leche de avena"],
      dislikes: [],
      typical_order: "latte grande",
      allergies: [],
      notes: null,
    },
    semanticContext: [{
      role: "user",
      content: "Me gusta con leche de avena.",
      similarity: 0.88,
      ponderingScore: 0.82,
      intentSignature: "preference",
      sourceScope: "customer",
    }],
    semanticStats: {
      count: 1,
      min: 0.88,
      max: 0.88,
      avg: 0.88,
      pondering_avg: 0.82,
      pondering_max: 0.82,
      source_scope: "customer",
    },
  };
}

Deno.test("processTurnProcess writes one reply, outbox, background jobs, and memory metadata", async () => {
  const { db, supabase } = createFakeSupabase();
  const turnUpdates: any[] = [];
  const jobs: any[] = [];
  const outboxes: any[] = [];
  const traces: any[] = [];
  const aiTurns: any[] = [];
  let capturedLoopParams: any = null;

  await processTurnProcess(
    supabase,
    {
      ...payload,
    },
    {
      buildWorkingMemoryFn: async () => workingMemory(),
      fetchBusinessConfigRowFn: async () => ({
        id: "business-1",
        config: {
          voice: {
            assistant_name: "Umi",
            locale: "es-MX",
            tone: "cálido",
          },
        },
      }),
      getActivePartialCancelledOrderFn: async () => null,
      hasNewerUserMessagesFn: async () => false,
      insertJobFn: async (_client, params) => {
        jobs.push(params);
        return `job-${jobs.length}`;
      },
      insertMessageFn: async (_conversationId, _role, content) => {
        assertEquals(content, "Listo, agregué el latte grande.");
        return "msg-assistant-1";
      },
      insertOutboxFn: async (_client, params) => {
        outboxes.push(params);
        return "outbox-1";
      },
      logAiTurnFn: async (entry) => {
        aiTurns.push(entry);
      },
      logPipelineTraceFn: async (entry) => {
        traces.push(entry);
      },
      runToolLoopFn: async (params) => {
        capturedLoopParams = params;
        params.toolOutcomes.cartUpdated = true;
        return {
          finalText: "Listo, agregué el latte grande.",
          inputTokens: 20,
          outputTokens: 8,
          llmCallCount: 1,
          toolCallCount: 1,
          toolResultBytes: 120,
          toolChain: [{
            name: "add_to_cart",
            input: { query: "latte", size: "grande" },
            success: true,
            data_summary: { summary_text: "cart updated" },
          }],
          pendingClarification: null,
          stopReason: "final_text",
        };
      },
      triggerJobWorkerFn: async () => {},
      upsertConversationTurnFn: async (_client, params) => {
        turnUpdates.push(params);
        return { id: params.existingTurnId ?? "turn-1", ...params };
      },
    },
  );

  assertEquals(
    turnUpdates.map((update) => update.status),
    ["processing", "completed"],
  );
  assertEquals(db.conversation.current_state, "awaiting_confirmation");
  assertEquals(db.conversation.pending_clarification, null);
  assertEquals(outboxes.length, 1);
  assertEquals(outboxes[0].idempotency_key, "twilio_reply_turn:msg-user-1");
  assertEquals(
    jobs.map((job) => job.job_type),
    ["message.embed", "conversation.summarize", "customer.extract_facts"],
  );
  assertEquals(capturedLoopParams.recentMessages.length, 3);
  assertEquals(aiTurns.length, 1);
  assertEquals(
    aiTurns[0].metadata.memory_context.guardrail,
    "memory_is_context_not_operational_truth",
  );
  assertEquals(aiTurns[0].metadata.memory_context.facts_present, true);
  assertEquals(aiTurns[0].metadata.memory_context.semantic_count, 1);
  assertExists(traces.find((trace) => trace.event === "completed"));
});

Deno.test("processTurnProcess persists tool clarification as pending state", async () => {
  const { db, supabase } = createFakeSupabase();
  const turnUpdates: any[] = [];
  const outboxes: any[] = [];
  const assistantMessages: string[] = [];

  await processTurnProcess(
    supabase,
    payload,
    createDeps({
      turnUpdates,
      outboxes,
      assistantMessages,
      runToolLoopFn: async () => ({
        finalText: "¿Lo quieres chico o grande?",
        inputTokens: 12,
        outputTokens: 6,
        llmCallCount: 1,
        toolCallCount: 1,
        toolResultBytes: 80,
        toolChain: [{
          name: "add_to_cart",
          input: { query: "latte" },
          success: false,
          needs_clarification: "¿Lo quieres chico o grande?",
          data_summary: { needs_clarification: "¿Lo quieres chico o grande?" },
        }],
        pendingClarification: {
          field: "tool_clarification",
          question: "¿Lo quieres chico o grande?",
          context: {
            resume_tool: "add_to_cart",
            resume_input: { query: "latte" },
          },
        },
        stopReason: "tool_needs_clarification",
      }),
    }),
  );

  assertEquals(db.conversation.current_state, "awaiting_clarification");
  assertEquals(
    (db.conversation.pending_clarification as any).context,
    { resume_tool: "add_to_cart", resume_input: { query: "latte" } },
  );
  assertEquals(assistantMessages, ["¿Lo quieres chico o grande?"]);
  assertEquals(outboxes[0].payload.body, "¿Lo quieres chico o grande?");
  assertEquals(
    turnUpdates.map((update) => update.status),
    ["processing", "completed"],
  );
});

Deno.test("processTurnProcess blocks hallucinated order confirmation before outbox", async () => {
  const { supabase } = createFakeSupabase();
  const turnUpdates: any[] = [];
  const outboxes: any[] = [];
  const assistantMessages: string[] = [];

  await processTurnProcess(
    supabase,
    payload,
    createDeps({
      turnUpdates,
      outboxes,
      assistantMessages,
      runToolLoopFn: async () => ({
        finalText: "Tu pedido está confirmado.",
        inputTokens: 12,
        outputTokens: 6,
        llmCallCount: 1,
        toolCallCount: 0,
        toolResultBytes: 0,
        toolChain: [],
        pendingClarification: null,
        stopReason: "final_text",
      }),
    }),
  );

  assertEquals(assistantMessages, [
    "Ocurrió un error con tu orden. Intenta después.",
  ]);
  assertEquals(
    outboxes[0].payload.body,
    "Ocurrió un error con tu orden. Intenta después.",
  );
  assertEquals(
    turnUpdates.map((update) => update.status),
    ["processing", "completed"],
  );
});

Deno.test("processTurnProcess supersedes and requeues when conversation state changed", async () => {
  const { supabase } = createFakeSupabase({ stateConflict: true });
  const turnUpdates: any[] = [];
  const jobs: any[] = [];
  const outboxes: any[] = [];
  const assistantMessages: string[] = [];

  await processTurnProcess(
    supabase,
    payload,
    createDeps({
      turnUpdates,
      jobs,
      outboxes,
      assistantMessages,
      runToolLoopFn: async () => ({
        finalText: "Listo, agregué el latte grande.",
        inputTokens: 20,
        outputTokens: 8,
        llmCallCount: 1,
        toolCallCount: 1,
        toolResultBytes: 120,
        toolChain: [],
        pendingClarification: null,
        stopReason: "final_text",
      }),
    }),
  );

  assertEquals(
    turnUpdates.map((update) => update.status),
    ["processing", "superseded"],
  );
  assertEquals(jobs.map((job) => job.job_type), ["turn.integrity"]);
  assertEquals(outboxes.length, 0);
  assertEquals(assistantMessages.length, 0);
});
