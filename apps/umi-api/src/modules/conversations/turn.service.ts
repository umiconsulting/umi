import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { TenantsRepository } from '../tenants/tenants.repository';
import { EnqueueService } from '../../jobs/enqueue.service';
import { JobPriority } from '../../jobs/job-options';
import { QUEUES } from '../../jobs/queues';
import { TraceService } from '../../shared/logging/trace.service';
import { BusinessConfigService, resolveVoiceConfig } from './business-config.service';
import { ConversationsRepository } from './conversations.repository';
import { ConversationTurnsRepository, type TurnRecord } from './conversation-turns.repository';
import { IdentityRepository } from './identity.repository';
import { MessagesRepository } from './messages.repository';
import { MemoryService } from './memory.service';
import { ToolLoopService } from './tool-loop.service';
import { TurnCommitRepository } from './turn-commit.repository';
import { createToolOutcomeState, type ToolOutcomeState } from './tool-outcomes';
import { getActivePendingClarification } from './pending-clarification';
import { shapeTurnMemory } from './turn-memory';
import {
  buildHarnessSystemPrompt,
  PROMPT_VERSION,
  type BranchPromptContext,
} from './prompts';
import { sanitizeOutput } from './security.service';
import {
  blockUnverifiedOrderConfirmation,
  deriveNextConversationState,
  jsonByteLength,
  truncateBytes,
} from './turn-safety';
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
    private readonly businessConfig: BusinessConfigService,
    private readonly memory: MemoryService,
    private readonly toolLoop: ToolLoopService,
    private readonly commit: TurnCommitRepository,
    private readonly enqueue: EnqueueService,
    private readonly trace: TraceService,
    private readonly tenants: TenantsRepository,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Multi-branch prompt context: the tenant's active-branch names + the branch
   * already chosen for this conversation (if any). Null (no prompt block) unless
   * BRANCH_RESOLUTION_ENABLED is on AND the tenant has >1 active location — so
   * single-branch tenants and flag-off deploys keep the exact prior prompt.
   */
  private async resolveBranchContext(
    tenantId: string,
    conversationId: string,
  ): Promise<BranchPromptContext | null> {
    if (!this.config.get('BRANCH_RESOLUTION_ENABLED', { infer: true })) return null;
    const locations = await this.tenants.listActiveLocationsWorker(tenantId);
    if (locations.length < 2) return null;
    const selectedId = await this.conversations.getSelectedLocationWorker(conversationId);
    const selectedBranch = selectedId
      ? locations.find((l) => l.id === selectedId)?.name ?? null
      : null;
    return { branches: locations.map((l) => l.name), selectedBranch };
  }

  async process(payload: TurnProcessPayload): Promise<void> {
    const start = Date.now();
    const traceId = payload.request_id ?? payload.conversation_id;

    await this.trace.logPipelineTrace({
      trace_id: traceId,
      conversation_id: payload.conversation_id,
      turn_id: payload.turn_id,
      business_id: payload.tenant_id,
      stage: 'process',
      event: 'started',
      detail: { processor_version: PROCESSOR_VERSION },
    });

    const [turn, conversation, person, businessRow, messageCount] = await Promise.all([
      this.turns.loadTurn(payload.turn_id),
      this.conversations.loadById(payload.conversation_id),
      this.identity.getPerson(payload.tenant_id, payload.person_id),
      this.businessConfig.fetchConfigRow(payload.tenant_id),
      this.messages.countMessages(payload.conversation_id),
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
      await this.supersedeAndRequeue(payload, turn, 'newer_user_messages_arrived_before_processing', traceId);
      return;
    }

    await this.turns.upsertTurn({
      existingTurnId: turn.id,
      tenantId: payload.tenant_id,
      conversationId: payload.conversation_id,
      personId: payload.person_id,
      status: 'processing',
      sourceMessageIds: turn.sourceMessageIds,
      mergedUserText: turn.mergedUserText,
      integrityDecision: turn.integrityDecision ?? '',
      integrityReason: turn.integrityReason ?? '',
      baseStateVersion: turn.baseStateVersion,
      firstMessageAt: turn.firstMessageAt,
      lastMessageAt: turn.lastMessageAt,
      releasedAt: turn.releasedAt ?? new Date().toISOString(),
    });

    const rawWorkingMemory = await this.memory.buildWorkingMemory({
      conversationId: payload.conversation_id,
      personId: payload.person_id,
      tenantId: payload.tenant_id,
      currentMessage: turn.mergedUserText,
      totalMsgCount: messageCount,
      summary: conversation.summary,
    });
    const { workingMemory, metadata: memoryContext } = shapeTurnMemory(rawWorkingMemory);

    // Partial-cancellation context is Phase 4 (KDS); inert here.
    const partialCancelledOrder = null;
    const currentState = conversation.currentState ?? 'initial';
    const activePendingClarification = getActivePendingClarification(conversation.pendingClarification);
    const voice = resolveVoiceConfig(
      businessRow?.config ?? null,
      businessRow?.name ?? null,
      payload.tenant_id,
    );
    const branchContext = await this.resolveBranchContext(
      payload.tenant_id,
      payload.conversation_id,
    );
    const systemPrompt = buildHarnessSystemPrompt({
      customerName: person.displayName,
      currentState,
      workingMemory,
      partialCancelledOrder,
      voice,
      branchContext,
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
        tenantId: payload.tenant_id,
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
    const nextConversationState = deriveNextConversationState({
      pendingClarification,
      orderConfirmed: toolOutcomes.orderConfirmed,
      orderCancelled: toolOutcomes.orderCancelled,
      orderChangesConfirmed: toolOutcomes.orderChangesConfirmed,
      cartUpdated: toolOutcomes.cartUpdated,
      searchPerformed: toolOutcomes.searchPerformed,
      fallbackState: currentState,
    });

    const lastUserMessageId =
      turn.sourceMessageIds[turn.sourceMessageIds.length - 1] ?? turn.id;
    const reconciledAction = {
      processor_version: PROCESSOR_VERSION,
      stop_reason: loopResult.stopReason,
      tool_calls: loopResult.toolCallCount,
      tool_chain: truncateBytes(loopResult.toolChain, 5000),
      pending_clarification: pendingClarification,
    };

    // Transactional outbox commit: CAS state + assistant message + reply outbox row.
    const committed = await this.commit.commitTurnReply({
      tenantId: payload.tenant_id,
      conversationId: payload.conversation_id,
      expectedStateVersion: conversation.stateVersion,
      nextState: nextConversationState,
      pendingClarification,
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

    if (!committed.committed) {
      await this.supersedeAndRequeue(payload, turn, 'conversation_changed_before_commit', traceId, reconciledAction);
      return;
    }

    await this.trace.logPipelineTrace({
      trace_id: traceId,
      conversation_id: payload.conversation_id,
      turn_id: payload.turn_id,
      business_id: payload.tenant_id,
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
      tenantId: payload.tenant_id,
      conversationId: payload.conversation_id,
      personId: payload.person_id,
      status: 'completed',
      sourceMessageIds: turn.sourceMessageIds,
      mergedUserText: turn.mergedUserText,
      integrityDecision: turn.integrityDecision ?? '',
      integrityReason: turn.integrityReason ?? '',
      baseStateVersion: turn.baseStateVersion,
      firstMessageAt: turn.firstMessageAt,
      lastMessageAt: turn.lastMessageAt,
      releasedAt: turn.releasedAt,
      processedAt: new Date().toISOString(),
      assistantMessageId: committed.assistantMessageId,
      extractedIntent: { processor_version: PROCESSOR_VERSION, current_state: nextConversationState },
      reconciledAction,
    });

    const metadata = {
      processor_version: PROCESSOR_VERSION,
      memory_context: memoryContext,
      semantic_stats: workingMemory.semanticStats,
      stop_reason: loopResult.stopReason,
      tool_chain: truncateBytes(loopResult.toolChain, 5000),
      pending_clarification: pendingClarification,
      max_tool_calls: MAX_TOOL_CALLS_PER_TURN,
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

    await this.trace.logAiTurn({
      conversation_id: payload.conversation_id,
      customer_id: payload.person_id,
      business_id: payload.tenant_id,
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
        state: conversation.currentState,
        turn_id: payload.turn_id,
      },
      metadata: truncateBytes({ ...metadata, metrics }, MAX_METADATA_BYTES) as Record<string, unknown>,
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
          tenant_id: payload.tenant_id,
          request_id: payload.request_id,
        },
        { priority: JobPriority.Background },
      ),
      this.enqueue.enqueue(
        QUEUES.enrichment,
        'conversation.summarize',
        {
          conversation_id: payload.conversation_id,
          tenant_id: payload.tenant_id,
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
          tenant_id: payload.tenant_id,
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
      business_id: payload.tenant_id,
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
    reconciledAction?: Record<string, unknown>,
  ): Promise<void> {
    await this.turns.upsertTurn({
      existingTurnId: turn.id,
      tenantId: payload.tenant_id,
      conversationId: payload.conversation_id,
      personId: payload.person_id,
      status: 'superseded',
      sourceMessageIds: turn.sourceMessageIds,
      mergedUserText: turn.mergedUserText,
      integrityDecision: 'cancel',
      integrityReason: reason,
      baseStateVersion: turn.baseStateVersion,
      firstMessageAt: turn.firstMessageAt,
      lastMessageAt: turn.lastMessageAt,
      supersededAt: new Date().toISOString(),
      reconciledAction: reconciledAction ?? { processor_version: PROCESSOR_VERSION, reason },
    });

    await this.trace.logPipelineTrace({
      trace_id: traceId,
      conversation_id: payload.conversation_id,
      turn_id: payload.turn_id,
      business_id: payload.tenant_id,
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
        tenant_id: payload.tenant_id,
        request_id: payload.request_id,
      },
      { priority: JobPriority.Interactive },
    );
  }
}
