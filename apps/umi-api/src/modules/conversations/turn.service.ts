import { Injectable, Logger } from '@nestjs/common';
import { OrderLocationResolver } from './order-location.resolver';
import { EnqueueService } from '../../jobs/enqueue.service';
import { JobPriority } from '../../jobs/job-options';
import { QUEUES } from '../../jobs/queues';
import { TraceService } from '../../shared/logging/trace.service';
import { MerchantConfigService, resolveVoiceConfig } from './merchant-config.service';
import { ConversationsRepository } from './conversations.repository';
import { ConversationTurnsRepository, type TurnRecord } from './conversation-turns.repository';
import { IdentityRepository } from './identity.repository';
import { MessagesRepository } from './messages.repository';
import { MemoryService } from './memory.service';
import { ToolLoopService } from './tool-loop.service';
import { TurnCommitRepository } from './turn-commit.repository';
import { createToolOutcomeState, type ToolOutcomeState } from './tool-outcomes';
import { shapeTurnMemory } from './turn-memory';
import { buildHarnessSystemPrompt, PROMPT_VERSION, type LocationPromptContext } from './prompts';
import { sanitizeOutput } from './security.service';
import { blockUnverifiedOrderConfirmation, jsonByteLength, truncateBytes } from './turn-safety';
import type { TurnProcessPayload } from './turn-integrity.service';

const PROCESSOR_VERSION = 'mini_harness';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_METADATA_BYTES = 10000;
const COST_PER_INPUT_TOKEN = 0.00000025;
const COST_PER_OUTPUT_TOKEN = 0.00000125;
const MAX_TOOL_CALLS_PER_TURN = 4;
/** Generous lock window for the per-conversation single-flight (matches the turns queue lock). */
const TURN_LOCK_TTL_MS = 300_000;

export { TURN_LOCK_TTL_MS };

function responseType(o: ToolOutcomeState): string {
  if (o.orderConfirmed) return 'order_confirm';
  if (o.orderChangesConfirmed) return 'order_changes_confirm';
  if (o.orderCancelled) return 'order_cancel';
  if (o.cartUpdated) return 'cart_update';
  if (o.searchPerformed) return 'menu';
  return 'conversation';
}

/**
 * The turn orchestrator (mini-harness). Port of `processors/turn-process.ts`,
 * rebound to canonical `comms.*` + the injected services. Commits the reply
 * through the transactional outbox (TurnCommitRepository); on a lost CAS it
 * supersedes the turn and re-enqueues integrity. Enqueues enrichment follow-ups.
 *
 * NOTE: partial-cancellation context (legacy `kds.tickets`) is deferred to Phase
 * 4 (KDS) — `partialCancelledOrder` is null until then, so the
 * `awaiting_order_changes_confirmation` path stays inert.
 */
@Injectable()
export class TurnService {
  private readonly logger = new Logger(TurnService.name);

  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly turns: ConversationTurnsRepository,
    private readonly identity: IdentityRepository,
    private readonly messages: MessagesRepository,
    private readonly merchantConfig: MerchantConfigService,
    private readonly memory: MemoryService,
    private readonly toolLoop: ToolLoopService,
    private readonly commit: TurnCommitRepository,
    private readonly enqueue: EnqueueService,
    private readonly trace: TraceService,
    private readonly orderLocation: OrderLocationResolver,
  ) {}

  /**
   * Multi-location prompt context, derived from the fulfillment-location policy
   * (OrderLocationResolver): when the merchant still needs the customer to choose a
   * location, expose the location names so the LLM can ask; when one is already
   * chosen, note it so the LLM stops asking. Null (no prompt block) whenever the
   * location is already determined by a bound number or a sole location — so
   * single-location merchants are untouched.
   */
  private async resolveLocationContext(
    merchantId: string,
    conversationId: string,
    channelLocationId: string | null,
  ): Promise<LocationPromptContext | null> {
    const resolution = await this.orderLocation.resolve({
      merchantId,
      conversationId,
      channelLocationId,
    });
    if (resolution.kind === 'needs_selection') {
      return { locations: resolution.locations.map((b) => b.name), selectedLocation: null };
    }
    if (resolution.kind === 'resolved' && resolution.source === 'selection') {
      return { locations: [], selectedLocation: resolution.name };
    }
    return null;
  }

  async process(payload: TurnProcessPayload): Promise<void> {
    const start = Date.now();
    const traceId = payload.request_id ?? payload.conversation_id;

    await this.trace.logPipelineTrace({
      trace_id: traceId,
      conversation_id: payload.conversation_id,
      turn_id: payload.turn_id,
      merchant_id: payload.merchant_id,
      stage: 'process',
      event: 'started',
      detail: { processor_version: PROCESSOR_VERSION },
    });

    // resolveLocationContext depends only on `payload`, so it rides along in this
    // batch instead of adding its own round trip to the turn's critical path.
    const [turn, conversation, person, merchantRow, messageCount, locationContext] =
      await Promise.all([
        this.turns.loadTurn(payload.turn_id),
        this.conversations.loadById(payload.conversation_id),
        this.identity.getPerson(payload.merchant_id, payload.person_id),
        this.merchantConfig.fetchConfigRow(payload.merchant_id),
        this.messages.countMessages(payload.conversation_id),
        this.resolveLocationContext(
          payload.merchant_id,
          payload.conversation_id,
          payload.location_id ?? null,
        ),
      ]);

    if (!turn || !conversation || !person?.phone) {
      throw new Error(`turn.process missing turn/conversation/person for turn ${payload.turn_id}`);
    }
    if (['superseded', 'completed', 'failed'].includes(turn.status)) return;

    if (
      await this.turns.hasNewerUserMessages(
        payload.conversation_id,
        turn.lastMessageAt ?? '',
        turn.sourceMessageIds ?? [],
      )
    ) {
      await this.supersedeAndRequeue(
        payload,
        turn,
        'newer_user_messages_arrived_before_processing',
        traceId,
      );
      return;
    }

    await this.turns.upsertTurn({
      existingTurnId: turn.id,
      merchantId: payload.merchant_id,
      conversationId: payload.conversation_id,
      status: 'processing',
      sourceMessageIds: turn.sourceMessageIds,
      mergedUserText: turn.mergedUserText,
      firstMessageAt: turn.firstMessageAt,
      lastMessageAt: turn.lastMessageAt,
      releasedAt: turn.releasedAt ?? new Date().toISOString(),
    });

    const rawWorkingMemory = await this.memory.buildWorkingMemory({
      conversationId: payload.conversation_id,
      personId: payload.person_id,
      merchantId: payload.merchant_id,
      currentMessage: turn.mergedUserText,
      totalMsgCount: messageCount,
      summary: conversation.summary,
    });
    const { workingMemory, metadata: memoryContext } = shapeTurnMemory(rawWorkingMemory);

    // Partial-cancellation context is Phase 4 (KDS); inert here.
    const partialCancelledOrder = null;
    // The dialog-state label is DERIVED from cart-presence (no stored FSM). The open
    // question is not a stored slot — the LLM infers it from the recent-message buffer.
    const hasCart = !!conversation.draftCart?.items?.length;
    const currentState = hasCart ? 'awaiting_confirmation' : 'initial';
    const activePendingClarification = null;
    const voice = resolveVoiceConfig(
      merchantRow?.config ?? null,
      merchantRow?.name ?? null,
      payload.merchant_id,
    );
    const systemPrompt = buildHarnessSystemPrompt({
      customerName: person.displayName,
      currentState,
      workingMemory,
      partialCancelledOrder,
      voice,
      locationContext,
    });

    const toolOutcomes = createToolOutcomeState();
    const loopResult = await this.toolLoop.run({
      systemPrompt,
      userTurnText: turn.mergedUserText,
      recentMessages: workingMemory.recentMessages,
      draftCart: conversation.draftCart,
      pendingClarification: activePendingClarification,
      currentState,
      toolOutcomes,
      maxToolCalls: MAX_TOOL_CALLS_PER_TURN,
      toolContext: {
        merchantId: payload.merchant_id,
        personId: payload.person_id,
        conversationId: payload.conversation_id,
        turnId: payload.turn_id,
        locationId: payload.location_id ?? null,
        requestId: payload.request_id,
        customerPhone: person.phone,
      },
    });

    const finalResponse = blockUnverifiedOrderConfirmation({
      text: sanitizeOutput(loopResult.finalText),
      orderConfirmed: toolOutcomes.orderConfirmed,
    });
    const pendingClarification = loopResult.pendingClarification;
    const lastUserMessageId = turn.sourceMessageIds[turn.sourceMessageIds.length - 1] ?? turn.id;

    // Guard: if a newer user message arrived while we were computing the reply, the
    // conversation has moved on — supersede and let the newer turn win. This replaces
    // the old state-version CAS; exactly-once delivery is carried by the outbox key.
    if (
      await this.turns.hasNewerUserMessages(
        payload.conversation_id,
        turn.lastMessageAt ?? '',
        turn.sourceMessageIds ?? [],
      )
    ) {
      await this.supersedeAndRequeue(payload, turn, 'conversation_changed_before_commit', traceId);
      return;
    }

    // Transactional outbox commit: assistant message + reply outbox row.
    const committed = await this.commit.commitTurnReply({
      merchantId: payload.merchant_id,
      conversationId: payload.conversation_id,
      replyBody: finalResponse,
      eventType: 'twilio.reply',
      idempotencyKey: `twilio_reply_turn:${lastUserMessageId}`,
      payload: {
        // Reply to the WhatsApp address AS RECEIVED (display_value), not the
        // normalized identity anchor — else Mexican +521 numbers fail Twilio 63015.
        to: person.replyAddress ?? person.phone,
        body: finalResponse,
        trace_id: payload.request_id ?? null,
        turn_id: payload.turn_id,
        conversation_id: payload.conversation_id,
      },
    });

    await this.trace.logPipelineTrace({
      trace_id: traceId,
      conversation_id: payload.conversation_id,
      turn_id: payload.turn_id,
      merchant_id: payload.merchant_id,
      stage: 'process',
      event: 'outbox_inserted',
      detail: {
        processor_version: PROCESSOR_VERSION,
        outbox_id: committed.outboxId,
        idempotency_key: `twilio_reply_turn:${lastUserMessageId}`,
        duplicate: committed.outboxId === null,
      },
    });

    await this.turns.upsertTurn({
      existingTurnId: turn.id,
      merchantId: payload.merchant_id,
      conversationId: payload.conversation_id,
      status: 'completed',
      sourceMessageIds: turn.sourceMessageIds,
      mergedUserText: turn.mergedUserText,
      firstMessageAt: turn.firstMessageAt,
      lastMessageAt: turn.lastMessageAt,
      releasedAt: turn.releasedAt,
    });

    const metadata = {
      processor_version: PROCESSOR_VERSION,
      memory_context: memoryContext,
      semantic_stats: workingMemory.semanticStats,
      stop_reason: loopResult.stopReason,
      tool_chain: truncateBytes(loopResult.toolChain, 5000),
      pending_clarification: pendingClarification,
      max_tool_calls: MAX_TOOL_CALLS_PER_TURN,
      dialog_state: currentState,
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

    await this.trace.logAiTurn({
      conversation_id: payload.conversation_id,
      customer_id: payload.person_id,
      merchant_id: payload.merchant_id,
      model: MODEL,
      prompt_version: `${PROMPT_VERSION}.${PROCESSOR_VERSION}`,
      prompt_tokens: loopResult.inputTokens,
      completion_tokens: loopResult.outputTokens,
      cost_usd:
        loopResult.inputTokens * COST_PER_INPUT_TOKEN +
        loopResult.outputTokens * COST_PER_OUTPUT_TOKEN,
      latency_ms: Date.now() - start,
      response_type: responseType(toolOutcomes),
      customer_context: {
        name: person.displayName,
        state: currentState,
        turn_id: payload.turn_id,
      },
      metadata: truncateBytes({ ...metadata, metrics }, MAX_METADATA_BYTES) as Record<
        string,
        unknown
      >,
      request_id: payload.request_id,
    });

    // Enrichment follow-ups (background).
    const totalMsgCountAfter = messageCount + 1;
    await Promise.all([
      this.enqueue.enqueue(
        QUEUES.enrichment,
        'message.embed',
        {
          user_message_id: lastUserMessageId,
          assistant_message_id: committed.assistantMessageId,
          user_text: turn.mergedUserText,
          assistant_text: finalResponse,
          merchant_id: payload.merchant_id,
          request_id: payload.request_id,
        },
        { priority: JobPriority.Background },
      ),
      this.enqueue.enqueue(
        QUEUES.enrichment,
        'conversation.summarize',
        {
          conversation_id: payload.conversation_id,
          merchant_id: payload.merchant_id,
          request_id: payload.request_id,
        },
        { priority: JobPriority.Background },
      ),
      this.enqueue.enqueue(
        QUEUES.enrichment,
        'customer.extract_facts',
        {
          person_id: payload.person_id,
          conversation_id: payload.conversation_id,
          merchant_id: payload.merchant_id,
          message_count: totalMsgCountAfter,
          request_id: payload.request_id,
        },
        { priority: JobPriority.Background },
      ),
    ]);

    await this.trace.logPipelineTrace({
      trace_id: traceId,
      conversation_id: payload.conversation_id,
      turn_id: payload.turn_id,
      merchant_id: payload.merchant_id,
      stage: 'process',
      event: 'completed',
      detail: metrics,
    });
  }

  private async supersedeAndRequeue(
    payload: TurnProcessPayload,
    turn: TurnRecord,
    reason: string,
    traceId: string,
  ): Promise<void> {
    await this.turns.upsertTurn({
      existingTurnId: turn.id,
      merchantId: payload.merchant_id,
      conversationId: payload.conversation_id,
      status: 'superseded',
      sourceMessageIds: turn.sourceMessageIds,
      mergedUserText: turn.mergedUserText,
      firstMessageAt: turn.firstMessageAt,
      lastMessageAt: turn.lastMessageAt,
      supersededAt: new Date().toISOString(),
    });

    await this.trace.logPipelineTrace({
      trace_id: traceId,
      conversation_id: payload.conversation_id,
      turn_id: payload.turn_id,
      merchant_id: payload.merchant_id,
      stage: 'process',
      event: 'superseded',
      detail: { processor_version: PROCESSOR_VERSION, reason },
    });

    await this.enqueue.enqueue(
      QUEUES.turns,
      'turn.integrity',
      {
        conversation_id: payload.conversation_id,
        person_id: payload.person_id,
        merchant_id: payload.merchant_id,
        request_id: payload.request_id,
      },
      { priority: JobPriority.Interactive },
    );
  }
}
