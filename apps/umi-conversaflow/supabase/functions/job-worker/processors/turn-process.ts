import {
  fetchBusinessConfigRow,
  requireVoiceConfig,
} from "../../_shared/business-config.ts";
import { buildWorkingMemory, insertMessage } from "../../_shared/memory.ts";
import { getActivePendingClarification } from "../../_shared/pending-clarification.ts";
import { logAiTurn, logPipelineTrace, slog } from "../../_shared/logger.ts";
import {
  hasNewerUserMessages,
  upsertConversationTurn,
} from "../../_shared/turns.ts";
import {
  BACKGROUND_JOB_PRIORITY,
  insertJob,
  insertOutbox,
  triggerJobWorker,
} from "../../_shared/workflow.ts";
import { getActivePartialCancelledOrder } from "../../whatsapp-handler/context.ts";
import {
  buildHarnessSystemPrompt,
  PROMPT_VERSION,
} from "../../whatsapp-handler/prompts.ts";
import { sanitizeOutput } from "../../whatsapp-handler/security.ts";
import { createToolOutcomeState } from "./tool-outcomes.ts";
import { shapeTurnMemory } from "./turn-memory.ts";
import { runMiniHarnessToolLoop } from "./turn-tool-loop.ts";
import type { MiniHarnessToolLoopResult } from "./turn-tool-loop.ts";
import { createMessage } from "../../_shared/adapters/anthropic.ts";
import { executeTool } from "../../whatsapp-handler/tools.ts";
import {
  blockUnverifiedOrderConfirmation,
  deriveNextConversationState,
  jsonByteLength,
  truncateBytes,
} from "./turn-safety.ts";

const PROCESSOR_VERSION = "mini_harness";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_METADATA_BYTES = 10000;
const COST_PER_INPUT_TOKEN = 0.00000025;
const COST_PER_OUTPUT_TOKEN = 0.00000125;
const DEFAULT_MAX_TOOL_CALLS_PER_TURN = 4;

type TurnProcessPayload = {
  conversation_id: string;
  customer_id: string;
  business_id: string;
  turn_id: string;
  request_id?: string;
};

type TurnProcessDeps = {
  buildWorkingMemoryFn?: typeof buildWorkingMemory;
  fetchBusinessConfigRowFn?: typeof fetchBusinessConfigRow;
  getActivePartialCancelledOrderFn?: typeof getActivePartialCancelledOrder;
  hasNewerUserMessagesFn?: typeof hasNewerUserMessages;
  insertJobFn?: typeof insertJob;
  insertMessageFn?: typeof insertMessage;
  insertOutboxFn?: typeof insertOutbox;
  logAiTurnFn?: typeof logAiTurn;
  logPipelineTraceFn?: typeof logPipelineTrace;
  runToolLoopFn?: typeof runMiniHarnessToolLoop;
  createMessageFn?: typeof createMessage;
  executeToolFn?: typeof executeTool;
  triggerJobWorkerFn?: typeof triggerJobWorker;
  upsertConversationTurnFn?: typeof upsertConversationTurn;
};

const defaultDeps = {
  buildWorkingMemoryFn: buildWorkingMemory,
  fetchBusinessConfigRowFn: fetchBusinessConfigRow,
  getActivePartialCancelledOrderFn: getActivePartialCancelledOrder,
  hasNewerUserMessagesFn: hasNewerUserMessages,
  insertJobFn: insertJob,
  insertMessageFn: insertMessage,
  insertOutboxFn: insertOutbox,
  logAiTurnFn: logAiTurn,
  logPipelineTraceFn: logPipelineTrace,
  runToolLoopFn: runMiniHarnessToolLoop,
  createMessageFn: createMessage,
  executeToolFn: executeTool,
  triggerJobWorkerFn: triggerJobWorker,
  upsertConversationTurnFn: upsertConversationTurn,
};

function envNumber(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name) ?? "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function responseType(toolOutcomes: ReturnType<typeof createToolOutcomeState>) {
  if (toolOutcomes.orderConfirmed) return "order_confirm";
  if (toolOutcomes.orderChangesConfirmed) return "order_changes_confirm";
  if (toolOutcomes.orderCancelled) return "order_cancel";
  if (toolOutcomes.cartUpdated) return "cart_update";
  if (toolOutcomes.searchPerformed) return "menu";
  return "conversation";
}

async function supersedeAndRequeue(params: {
  supabase: any;
  payload: TurnProcessPayload;
  turn: any;
  reason: string;
  traceId: string;
  reconciledAction?: Record<string, unknown> | null;
  deps: typeof defaultDeps;
}) {
  await params.deps.upsertConversationTurnFn(params.supabase, {
    existingTurnId: params.turn.id,
    conversationId: params.payload.conversation_id,
    customerId: params.payload.customer_id,
    businessId: params.payload.business_id,
    status: "superseded",
    sourceMessageIds: params.turn.source_message_ids ?? [],
    mergedUserText: params.turn.merged_user_text ?? "",
    integrityDecision: "cancel",
    integrityReason: params.reason,
    baseStateVersion: params.turn.base_state_version ?? 0,
    firstMessageAt: params.turn.first_message_at,
    lastMessageAt: params.turn.last_message_at,
    supersededAt: new Date().toISOString(),
    reconciledAction: params.reconciledAction ?? {
      processor_version: PROCESSOR_VERSION,
      reason: params.reason,
    },
  });

  await params.deps.logPipelineTraceFn({
    trace_id: params.traceId,
    conversation_id: params.payload.conversation_id,
    turn_id: params.payload.turn_id,
    business_id: params.payload.business_id,
    stage: "process",
    event: "superseded",
    detail: { processor_version: PROCESSOR_VERSION, reason: params.reason },
  });

  await params.deps.insertJobFn(params.supabase, {
    business_id: params.payload.business_id,
    job_type: "turn.integrity",
    aggregate_type: "conversation",
    aggregate_id: params.payload.conversation_id,
    payload: {
      conversation_id: params.payload.conversation_id,
      customer_id: params.payload.customer_id,
      business_id: params.payload.business_id,
      request_id: params.payload.request_id,
    },
  });
  params.deps.triggerJobWorkerFn().catch(() => {});
}

export async function processTurnProcess(
  supabase: any,
  payload: TurnProcessPayload,
  injectedDeps: TurnProcessDeps = {},
): Promise<void> {
  const deps = { ...defaultDeps, ...injectedDeps };
  const start = Date.now();
  const traceId = payload.request_id ?? payload.conversation_id;
  const maxToolCalls = envNumber(
    "CONVERSAFLOW_MAX_TOOL_CALLS_PER_TURN",
    DEFAULT_MAX_TOOL_CALLS_PER_TURN,
  );

  await deps.logPipelineTraceFn({
    trace_id: traceId,
    conversation_id: payload.conversation_id,
    turn_id: payload.turn_id,
    business_id: payload.business_id,
    stage: "process",
    event: "started",
    detail: { processor_version: PROCESSOR_VERSION },
  });

  const [
    { data: turn },
    { data: conversation },
    { data: customer },
    businessRow,
    { count: messageCount },
  ] = await Promise.all([
    supabase.from("conversation_turns").select("*").eq("id", payload.turn_id)
      .maybeSingle(),
    supabase
      .from("conversations")
      .select(
        "id, current_state, state_version, draft_cart, pending_clarification",
      )
      .eq("id", payload.conversation_id)
      .single(),
    supabase.from("customers").select("phone, name").eq(
      "id",
      payload.customer_id,
    ).single(),
    deps.fetchBusinessConfigRowFn(supabase, payload.business_id),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", payload.conversation_id),
  ]);

  if (!turn || !conversation || !customer?.phone) {
    throw new Error(
      `turn.process missing turn/conversation/customer for turn ${payload.turn_id}`,
    );
  }
  if (["superseded", "cancelled", "completed"].includes(turn.status)) return;

  const newerMessages = await deps.hasNewerUserMessagesFn(
    supabase,
    payload.conversation_id,
    turn.last_message_at,
  );
  if (newerMessages) {
    await supersedeAndRequeue({
      supabase,
      payload,
      turn,
      reason: "newer_user_messages_arrived_before_processing",
      traceId,
      deps,
    });
    return;
  }

  await deps.upsertConversationTurnFn(supabase, {
    existingTurnId: turn.id,
    conversationId: payload.conversation_id,
    customerId: payload.customer_id,
    businessId: payload.business_id,
    status: "processing",
    sourceMessageIds: turn.source_message_ids ?? [],
    mergedUserText: turn.merged_user_text,
    integrityDecision: turn.integrity_decision,
    integrityReason: turn.integrity_reason,
    baseStateVersion: turn.base_state_version ?? 0,
    firstMessageAt: turn.first_message_at,
    lastMessageAt: turn.last_message_at,
    releasedAt: turn.released_at ?? new Date().toISOString(),
  });

  const [rawWorkingMemory, partialCancelledOrder] = await Promise.all([
    deps.buildWorkingMemoryFn(
      payload.conversation_id,
      payload.customer_id,
      turn.merged_user_text,
      supabase,
      Deno.env.get("VOYAGE_API_KEY"),
      messageCount ?? 0,
      payload.request_id,
      payload.business_id,
    ),
    deps.getActivePartialCancelledOrderFn(supabase, payload.customer_id),
  ]);

  const { workingMemory, metadata: memoryContext } = shapeTurnMemory(
    rawWorkingMemory,
  );

  const currentState = partialCancelledOrder
    ? "awaiting_order_changes_confirmation"
    : conversation.current_state ?? "initial";
  const activePendingClarification = getActivePendingClarification(
    conversation.pending_clarification ?? null,
  );
  const voice = requireVoiceConfig(
    businessRow?.config ?? null,
    payload.business_id,
  );
  const systemPrompt = buildHarnessSystemPrompt({
    customerName: customer.name ?? null,
    currentState,
    workingMemory,
    partialCancelledOrder,
    voice,
  });

  const toolOutcomes = createToolOutcomeState();
  const loopResult: MiniHarnessToolLoopResult = await deps.runToolLoopFn({
    systemPrompt,
    userTurnText: turn.merged_user_text,
    recentMessages: workingMemory.recentMessages,
    draftCart: conversation.draft_cart ?? null,
    pendingClarification: activePendingClarification,
    currentState,
    toolOutcomes,
    maxToolCalls,
    toolContext: {
      businessId: payload.business_id,
      customerId: payload.customer_id,
      conversationId: payload.conversation_id,
      requestId: payload.request_id,
      customerPhone: customer.phone,
    },
    supabase,
    createMessageFn: deps.createMessageFn,
    executeToolFn: deps.executeToolFn,
  });

  const finalResponse = blockUnverifiedOrderConfirmation({
    text: sanitizeOutput(loopResult.finalText),
    orderConfirmed: toolOutcomes.orderConfirmed,
  });
  const pendingClarification = loopResult.pendingClarification;
  const nextConversationState = deriveNextConversationState({
    pendingClarification,
    orderConfirmed: toolOutcomes.orderConfirmed,
    orderCancelled: toolOutcomes.orderCancelled,
    orderChangesConfirmed: toolOutcomes.orderChangesConfirmed,
    cartUpdated: toolOutcomes.cartUpdated,
    searchPerformed: toolOutcomes.searchPerformed,
    fallbackState: currentState,
  });

  const { data: updatedRows, error: stateError } = await supabase
    .from("conversations")
    .update({
      current_state: nextConversationState,
      pending_clarification: pendingClarification,
      state_version: (conversation.state_version ?? 0) + 1,
      last_message_at: new Date().toISOString(),
    })
    .eq("id", payload.conversation_id)
    .eq("state_version", conversation.state_version ?? 0)
    .select("id");

  const reconciledAction = {
    processor_version: PROCESSOR_VERSION,
    stop_reason: loopResult.stopReason,
    tool_calls: loopResult.toolCallCount,
    tool_chain: truncateBytes(loopResult.toolChain, 5000),
    pending_clarification: pendingClarification,
  };

  if (stateError || !updatedRows?.length) {
    await supersedeAndRequeue({
      supabase,
      payload,
      turn,
      reason: "conversation_changed_before_commit",
      traceId,
      reconciledAction,
      deps,
    });
    return;
  }

  const sourceMessageIds = turn.source_message_ids ?? [];
  const lastUserMessageId = sourceMessageIds[sourceMessageIds.length - 1] ??
    turn.id;
  const assistantMsgId = await deps.insertMessageFn(
    payload.conversation_id,
    "assistant",
    finalResponse,
    supabase,
  );
  const outboxId = await deps.insertOutboxFn(supabase, {
    business_id: payload.business_id,
    kind: "twilio.reply",
    aggregate_id: payload.conversation_id,
    idempotency_key: `twilio_reply_turn:${lastUserMessageId}`,
    payload: {
      to: customer.phone,
      body: finalResponse,
      trace_id: payload.request_id ?? null,
      turn_id: payload.turn_id,
    },
  });

  await deps.logPipelineTraceFn({
    trace_id: traceId,
    conversation_id: payload.conversation_id,
    turn_id: payload.turn_id,
    business_id: payload.business_id,
    stage: "process",
    event: "outbox_inserted",
    detail: {
      processor_version: PROCESSOR_VERSION,
      outbox_id: outboxId,
      idempotency_key: `twilio_reply_turn:${lastUserMessageId}`,
      duplicate: outboxId === null,
    },
  });

  await deps.upsertConversationTurnFn(supabase, {
    existingTurnId: turn.id,
    conversationId: payload.conversation_id,
    customerId: payload.customer_id,
    businessId: payload.business_id,
    status: "completed",
    sourceMessageIds,
    mergedUserText: turn.merged_user_text,
    integrityDecision: turn.integrity_decision,
    integrityReason: turn.integrity_reason,
    baseStateVersion: turn.base_state_version ?? 0,
    firstMessageAt: turn.first_message_at,
    lastMessageAt: turn.last_message_at,
    releasedAt: turn.released_at,
    processedAt: new Date().toISOString(),
    assistantMessageId: assistantMsgId,
    extractedIntent: {
      processor_version: PROCESSOR_VERSION,
      current_state: nextConversationState,
    },
    reconciledAction,
  });

  const metadata = {
    processor_version: PROCESSOR_VERSION,
    memory_context: memoryContext,
    semantic_stats: workingMemory.semanticStats,
    stop_reason: loopResult.stopReason,
    tool_chain: truncateBytes(loopResult.toolChain, 5000),
    pending_clarification: pendingClarification,
    max_tool_calls: maxToolCalls,
    next_state: nextConversationState,
  };
  const metrics = {
    processor_version: PROCESSOR_VERSION,
    duration_ms: Date.now() - start,
    llm_call_count: loopResult.llmCallCount,
    tool_call_count: loopResult.toolCallCount,
    response_chars: finalResponse.length,
    tool_result_bytes: loopResult.toolResultBytes,
    metadata_bytes: jsonByteLength(metadata),
  };

  await deps.logAiTurnFn({
    conversation_id: payload.conversation_id,
    customer_id: payload.customer_id,
    business_id: payload.business_id,
    model: MODEL,
    prompt_version: `${PROMPT_VERSION}.${PROCESSOR_VERSION}`,
    prompt_tokens: loopResult.inputTokens,
    completion_tokens: loopResult.outputTokens,
    cost_usd: loopResult.inputTokens * COST_PER_INPUT_TOKEN +
      loopResult.outputTokens * COST_PER_OUTPUT_TOKEN,
    latency_ms: Date.now() - start,
    response_type: responseType(toolOutcomes),
    customer_context: {
      name: customer.name ?? null,
      state: conversation.current_state,
      turn_id: payload.turn_id,
    },
    metadata: truncateBytes(
      { ...metadata, metrics },
      MAX_METADATA_BYTES,
    ) as Record<string, unknown>,
    request_id: payload.request_id,
  });

  const totalMsgCountAfter = (messageCount ?? 0) + 1;
  await Promise.all([
    deps.insertJobFn(supabase, {
      business_id: payload.business_id,
      job_type: "message.embed",
      aggregate_type: "message",
      aggregate_id: lastUserMessageId,
      priority: BACKGROUND_JOB_PRIORITY,
      payload: {
        user_message_id: lastUserMessageId,
        assistant_message_id: assistantMsgId,
        user_text: turn.merged_user_text,
        assistant_text: finalResponse,
        request_id: payload.request_id,
      },
    }),
    deps.insertJobFn(supabase, {
      business_id: payload.business_id,
      job_type: "conversation.summarize",
      aggregate_type: "conversation",
      aggregate_id: payload.conversation_id,
      priority: BACKGROUND_JOB_PRIORITY,
      payload: {
        conversation_id: payload.conversation_id,
        business_id: payload.business_id,
        request_id: payload.request_id,
      },
    }),
    deps.insertJobFn(supabase, {
      business_id: payload.business_id,
      job_type: "customer.extract_facts",
      aggregate_type: "customer",
      aggregate_id: payload.customer_id,
      priority: BACKGROUND_JOB_PRIORITY,
      payload: {
        customer_id: payload.customer_id,
        conversation_id: payload.conversation_id,
        message_count: totalMsgCountAfter,
        request_id: payload.request_id,
      },
    }),
  ]);

  slog("info", "turn_processed", {
    ...metrics,
    conversation_id: payload.conversation_id,
    turn_id: payload.turn_id,
    request_id: payload.request_id,
  });

  await deps.logPipelineTraceFn({
    trace_id: traceId,
    conversation_id: payload.conversation_id,
    turn_id: payload.turn_id,
    business_id: payload.business_id,
    stage: "process",
    event: "completed",
    detail: metrics,
  });
}
