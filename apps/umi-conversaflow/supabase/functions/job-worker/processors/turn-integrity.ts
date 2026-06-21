import {
  insertJob,
  INTERACTIVE_JOB_PRIORITY,
  triggerJobWorker,
} from "../../_shared/workflow.ts";
import { getActivePendingClarification } from "../../_shared/pending-clarification.ts";
import {
  decideTurnIntegrity,
  findActiveTurn,
  getTrailingUserRun,
  supersedeOtherTurns,
  upsertConversationTurn,
} from "../../_shared/turns.ts";
import { logPipelineTrace, slog } from "../../_shared/logger.ts";

export async function processTurnIntegrity(
  supabase: any,
  payload: {
    conversation_id: string;
    customer_id: string;
    business_id: string;
    request_id?: string;
  },
): Promise<void> {
  const traceId = payload.request_id ?? payload.conversation_id;

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, current_state, state_version, pending_clarification")
    .eq("id", payload.conversation_id)
    .single();

  if (!conversation) {
    slog("warn", "turn_integrity_conversation_missing", {
      conversation_id: payload.conversation_id,
      request_id: payload.request_id,
    });
    await logPipelineTrace({
      trace_id: traceId,
      conversation_id: payload.conversation_id,
      business_id: payload.business_id,
      stage: "integrity",
      event: "failed",
      error: "conversation_missing",
    });
    return;
  }

  const messages = await getTrailingUserRun(supabase, payload.conversation_id);

  if (!messages.length) {
    slog("warn", "turn_integrity_no_trailing_user_messages", {
      conversation_id: payload.conversation_id,
      request_id: payload.request_id,
    });
    await logPipelineTrace({
      trace_id: traceId,
      conversation_id: payload.conversation_id,
      business_id: payload.business_id,
      stage: "integrity",
      event: "failed",
      error: "no_trailing_user_messages",
    });
    return;
  }

  const decision = decideTurnIntegrity({
    messages,
    currentState: conversation.current_state ?? "initial",
    pendingClarification: getActivePendingClarification(
      conversation.pending_clarification ?? null,
    ),
  });

  if (!decision) {
    slog("warn", "turn_integrity_no_decision", {
      conversation_id: payload.conversation_id,
      request_id: payload.request_id,
    });
    await logPipelineTrace({
      trace_id: traceId,
      conversation_id: payload.conversation_id,
      business_id: payload.business_id,
      stage: "integrity",
      event: "failed",
      error: "no_decision_produced",
      detail: {
        message_count: messages.length,
        current_state: conversation.current_state,
      },
    });
    return;
  }

  const existingTurn = await findActiveTurn(supabase, payload.conversation_id);
  const sameMessages =
    JSON.stringify(existingTurn?.source_message_ids ?? []) ===
      JSON.stringify(decision.sourceMessageIds);

  if (
    existingTurn &&
    sameMessages &&
    ["released", "processing", "completed"].includes(existingTurn.status) &&
    decision.decision !== "hold" &&
    decision.decision !== "merge"
  ) {
    slog("info", "turn_integrity_skipped_existing_turn", {
      conversation_id: payload.conversation_id,
      existing_turn_id: existingTurn.id,
      existing_status: existingTurn.status,
      request_id: payload.request_id,
    });
    await logPipelineTrace({
      trace_id: traceId,
      conversation_id: payload.conversation_id,
      business_id: payload.business_id,
      stage: "integrity",
      event: "skipped",
      detail: {
        reason: "turn_already_in_progress",
        existing_turn_id: existingTurn.id,
        existing_status: existingTurn.status,
      },
    });
    return;
  }

  const status =
    decision.decision === "release" || decision.decision === "replace"
      ? "released"
      : "buffering";

  const turn = await upsertConversationTurn(supabase, {
    existingTurnId: existingTurn?.id ?? null,
    conversationId: payload.conversation_id,
    customerId: payload.customer_id,
    businessId: payload.business_id,
    status,
    sourceMessageIds: decision.sourceMessageIds,
    mergedUserText: decision.mergedText,
    integrityDecision: decision.decision,
    integrityReason: decision.reason,
    baseStateVersion: conversation.state_version ?? 0,
    firstMessageAt: decision.firstMessageAt,
    lastMessageAt: decision.lastMessageAt,
    holdUntil: decision.holdUntil,
    releasedAt: status === "released" ? new Date().toISOString() : null,
  });

  if (status === "buffering" && decision.holdUntil) {
    const waitMs = Math.max(
      0,
      new Date(decision.holdUntil).getTime() - Date.now(),
    );

    slog("info", "turn_integrity_buffering", {
      conversation_id: payload.conversation_id,
      turn_id: turn.id,
      hold_until: decision.holdUntil,
      wait_ms: waitMs,
      decision: decision.decision,
      request_id: payload.request_id,
    });

    // Wait inline — hold is at most 3s, no need for a deferred job.
    // A deferred job would require an external scheduler to wake the worker;
    // sleeping here avoids that dependency entirely.
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

    // Re-evaluate with whatever messages have arrived during the wait.
    return processTurnIntegrity(supabase, payload);
  }

  await supersedeOtherTurns(supabase, payload.conversation_id, turn.id);

  await insertJob(supabase, {
    business_id: payload.business_id,
    job_type: "turn.process",
    aggregate_type: "conversation",
    aggregate_id: payload.conversation_id,
    priority: INTERACTIVE_JOB_PRIORITY,
    payload: {
      conversation_id: payload.conversation_id,
      customer_id: payload.customer_id,
      business_id: payload.business_id,
      turn_id: turn.id,
      request_id: payload.request_id,
    },
  });

  // Kick a new worker invocation so turn.process is picked up even if the
  // current batch is already full (e.g. many rapid messages filled all slots).
  triggerJobWorker().catch(() => {});

  slog("info", "turn_integrity_released", {
    conversation_id: payload.conversation_id,
    turn_id: turn.id,
    decision: decision.decision,
    request_id: payload.request_id,
  });

  await logPipelineTrace({
    trace_id: traceId,
    conversation_id: payload.conversation_id,
    turn_id: turn.id,
    business_id: payload.business_id,
    stage: "integrity",
    event: "completed",
    detail: {
      decision: decision.decision,
      reason: decision.reason,
      turn_status: status,
    },
  });
}
