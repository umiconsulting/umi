import { Injectable, Logger } from '@nestjs/common';
import { EnqueueService } from '../../jobs/enqueue.service';
import { JobPriority } from '../../jobs/job-options';
import { QUEUES } from '../../jobs/queues';
import { TraceService } from '../../shared/logging/trace.service';
import { ConversationsRepository } from './conversations.repository';
import { ConversationTurnsRepository } from './conversation-turns.repository';
import { decideTurnIntegrity } from './turn-integrity.logic';
import { getActivePendingClarification } from './pending-clarification';

/** Job payloads for the turns queue. */
export interface TurnIntegrityPayload {
  conversation_id: string;
  person_id: string;
  tenant_id: string;
  request_id?: string;
}
export interface TurnProcessPayload extends TurnIntegrityPayload {
  turn_id: string;
}

/**
 * Turn integrity (multi-bubble debounce). Port of `processors/turn-integrity.ts`.
 * Rebound to canonical `comms.*` + BullMQ. The legacy inline `setTimeout` hold +
 * recursion is replaced by a BullMQ **delayed re-enqueue** of `turn.integrity`
 * (doesn't tie up a worker slot for the hold window). Released turns enqueue
 * `turn.process`.
 */
@Injectable()
export class TurnIntegrityService {
  private readonly logger = new Logger(TurnIntegrityService.name);

  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly turns: ConversationTurnsRepository,
    private readonly enqueue: EnqueueService,
    private readonly trace: TraceService,
  ) {}

  async process(payload: TurnIntegrityPayload): Promise<void> {
    const traceId = payload.request_id ?? payload.conversation_id;
    const conversation = await this.conversations.loadById(payload.conversation_id);
    if (!conversation) {
      await this.trace.logPipelineTrace({
        trace_id: traceId,
        conversation_id: payload.conversation_id,
        business_id: payload.tenant_id,
        stage: 'integrity',
        event: 'failed',
        error: 'conversation_missing',
      });
      return;
    }

    const messages = await this.turns.getTrailingUserRun(payload.conversation_id);
    if (!messages.length) {
      await this.trace.logPipelineTrace({
        trace_id: traceId,
        conversation_id: payload.conversation_id,
        business_id: payload.tenant_id,
        stage: 'integrity',
        event: 'failed',
        error: 'no_trailing_user_messages',
      });
      return;
    }

    const decision = decideTurnIntegrity({
      messages,
      currentState: conversation.currentState ?? 'initial',
      pendingClarification: getActivePendingClarification(conversation.pendingClarification),
    });
    if (!decision) return;

    const existingTurn = await this.turns.findActiveTurn(payload.conversation_id);
    const sameMessages =
      JSON.stringify(existingTurn?.sourceMessageIds ?? []) ===
      JSON.stringify(decision.sourceMessageIds);
    const existingReleasedOrProcessing =
      !!existingTurn &&
      (existingTurn.status === 'processing' ||
        (existingTurn.status === 'pending' && existingTurn.releasedAt != null));

    if (
      existingTurn &&
      sameMessages &&
      existingReleasedOrProcessing &&
      decision.decision !== 'hold' &&
      decision.decision !== 'merge'
    ) {
      await this.trace.logPipelineTrace({
        trace_id: traceId,
        conversation_id: payload.conversation_id,
        business_id: payload.tenant_id,
        stage: 'integrity',
        event: 'skipped',
        detail: { reason: 'turn_already_in_progress', existing_turn_id: existingTurn.id },
      });
      return;
    }

    const released = decision.decision === 'release' || decision.decision === 'replace';
    // Canonical status: both buffering + released map to 'pending'; released_at
    // (set only when released) distinguishes them.
    const turn = await this.turns.upsertTurn({
      existingTurnId: existingTurn?.id ?? null,
      tenantId: payload.tenant_id,
      conversationId: payload.conversation_id,
      personId: payload.person_id,
      status: 'pending',
      sourceMessageIds: decision.sourceMessageIds,
      mergedUserText: decision.mergedText,
      integrityDecision: decision.decision,
      integrityReason: decision.reason,
      baseStateVersion: conversation.stateVersion ?? 0,
      firstMessageAt: decision.firstMessageAt,
      lastMessageAt: decision.lastMessageAt,
      holdUntil: released ? null : decision.holdUntil,
      releasedAt: released ? new Date().toISOString() : null,
    });

    if (!released && decision.holdUntil) {
      // Re-evaluate after the hold window via a delayed re-enqueue (no inline sleep).
      const waitMs = Math.max(0, new Date(decision.holdUntil).getTime() - Date.now());
      await this.enqueue.enqueue(QUEUES.turns, 'turn.integrity', payload, {
        priority: JobPriority.Interactive,
        delayMs: waitMs,
      });
      this.logger.log(
        `integrity buffering conv=${payload.conversation_id} turn=${turn.id} wait=${waitMs}ms`,
      );
      return;
    }

    await this.turns.supersedeOtherTurns(payload.conversation_id, turn.id);

    const processPayload: TurnProcessPayload = { ...payload, turn_id: turn.id };
    await this.enqueue.enqueue(QUEUES.turns, 'turn.process', processPayload, {
      priority: JobPriority.Interactive,
      jobId: `turn_process:${turn.id}`,
    });

    await this.trace.logPipelineTrace({
      trace_id: traceId,
      conversation_id: payload.conversation_id,
      turn_id: turn.id,
      business_id: payload.tenant_id,
      stage: 'integrity',
      event: 'completed',
      detail: { decision: decision.decision, reason: decision.reason },
    });
  }
}
