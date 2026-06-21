import { slog } from './logger.ts'

export interface MessageRunItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface TurnIntegrityDecision {
  decision: 'hold' | 'merge' | 'clarify' | 'replace' | 'cancel' | 'release'
  reason: string
  holdUntil: string | null
  mergedText: string
  sourceMessageIds: string[]
  firstMessageAt: string
  lastMessageAt: string
}

const MIN_HOLD_MS = 1000
const EXTENDED_HOLD_MS = 2500
const MAX_HOLD_MS = 3000
const SHORT_FRAGMENT_LEN = 18

const REVISION_PATTERNS = [
  /^\s*no\b/i,
  /^\s*mejor\b/i,
  /c[aá]mbia/i,
  /c[aá]mbialo/i,
  /quita/i,
  /sin\s+/i,
  /quise decir/i,
  /corrijo/i,
  /me equivoqu[eé]/i,
  /no era/i,
]

const EXTENSION_PATTERNS = [
  /^(y|e|con|sin|para|de|del|la|el)\b/i,
  /^(grande|gde|chico|ch|caliente|fr[ií]o|frio|frapp[eé]|rocas|avena|coco|almendra|soya|deslactosada)\b/i,
  /^\d+\s*(x|pz|pzas)?$/i,
]

export function isRevisionLike(text: string): boolean {
  return REVISION_PATTERNS.some((pattern) => pattern.test(text))
}

export function isExtensionLike(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length <= SHORT_FRAGMENT_LEN || EXTENSION_PATTERNS.some((pattern) => pattern.test(trimmed))
}

export function buildMergedTurnText(messages: Array<Pick<MessageRunItem, 'content'>>): string {
  return messages.map((message) => message.content.trim()).filter(Boolean).join('\n').trim()
}

export async function getTrailingUserRun(
  supabase: any,
  conversationId: string,
  limit = 20,
): Promise<MessageRunItem[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    slog('error', 'turn_integrity_fetch_messages_error', {
      conversation_id: conversationId,
      error: error.message,
    })
    return []
  }

  const recent = (data ?? []) as MessageRunItem[]
  const run: MessageRunItem[] = []

  for (const message of recent) {
    if (message.role === 'assistant') break
    run.push(message)
  }

  return run.reverse()
}

export async function findActiveTurn(supabase: any, conversationId: string) {
  const { data } = await supabase
    .from('conversation_turns')
    .select('*')
    .eq('conversation_id', conversationId)
    .in('status', ['buffering', 'released', 'processing', 'clarification_needed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data
}

export function decideTurnIntegrity(params: {
  messages: MessageRunItem[]
  currentState: string
  pendingClarification: Record<string, unknown> | null
  now?: Date
}): TurnIntegrityDecision | null {
  if (!params.messages.length) return null

  const now = params.now ?? new Date()
  const mergedText = buildMergedTurnText(params.messages)
  const sourceMessageIds = params.messages.map((message) => message.id)
  const firstMessageAt = params.messages[0].created_at
  const lastMessageAt = params.messages[params.messages.length - 1].created_at
  const firstMs = new Date(firstMessageAt).getTime()
  const lastMs = new Date(lastMessageAt).getTime()
  const nowMs = now.getTime()

  const latestText = params.messages[params.messages.length - 1].content
  const shouldExtendHold =
    params.messages.length > 1 ||
    isRevisionLike(latestText) ||
    isExtensionLike(latestText) ||
    params.currentState !== 'initial' ||
    !!params.pendingClarification

  const targetHoldMs = shouldExtendHold ? EXTENDED_HOLD_MS : MIN_HOLD_MS
  const releaseAtMs = Math.min(firstMs + MAX_HOLD_MS, lastMs + targetHoldMs)

  if (nowMs < releaseAtMs) {
    return {
      decision: shouldExtendHold ? 'merge' : 'hold',
      reason: shouldExtendHold ? 'waiting_for_possible_follow_up_or_revision' : 'waiting_for_turn_to_settle',
      holdUntil: new Date(releaseAtMs).toISOString(),
      mergedText,
      sourceMessageIds,
      firstMessageAt,
      lastMessageAt,
    }
  }

  return {
    decision: isRevisionLike(mergedText) ? 'replace' : 'release',
    reason: isRevisionLike(mergedText) ? 'latest_revision_ready_for_processing' : 'stable_turn_ready_for_processing',
    holdUntil: null,
    mergedText,
    sourceMessageIds,
    firstMessageAt,
    lastMessageAt,
  }
}

export async function upsertConversationTurn(
  supabase: any,
  params: {
    existingTurnId?: string | null
    conversationId: string
    customerId: string
    businessId: string
    status: string
    sourceMessageIds: string[]
    mergedUserText: string
    integrityDecision: string
    integrityReason: string
    baseStateVersion: number
    firstMessageAt: string
    lastMessageAt: string
    holdUntil?: string | null
    releasedAt?: string | null
    extractedIntent?: Record<string, unknown> | null
    reconciledAction?: Record<string, unknown> | null
    assistantMessageId?: string | null
    processedAt?: string | null
    supersededAt?: string | null
  },
) {
  const row = {
    conversation_id: params.conversationId,
    customer_id: params.customerId,
    business_id: params.businessId,
    status: params.status,
    source_message_ids: params.sourceMessageIds,
    merged_user_text: params.mergedUserText,
    integrity_decision: params.integrityDecision,
    integrity_reason: params.integrityReason,
    base_state_version: params.baseStateVersion,
    first_message_at: params.firstMessageAt,
    last_message_at: params.lastMessageAt,
    hold_until: params.holdUntil ?? null,
    released_at: params.releasedAt ?? null,
    extracted_intent: params.extractedIntent ?? null,
    reconciled_action: params.reconciledAction ?? null,
    assistant_message_id: params.assistantMessageId ?? null,
    processed_at: params.processedAt ?? null,
    superseded_at: params.supersededAt ?? null,
  }

  if (params.existingTurnId) {
    const { data, error } = await supabase
      .from('conversation_turns')
      .update(row)
      .eq('id', params.existingTurnId)
      .select()
      .single()

    if (error) throw new Error(`update conversation_turn failed: ${error.message}`)
    return data
  }

  const { data, error } = await supabase
    .from('conversation_turns')
    .insert(row)
    .select()
    .single()

  if (error) throw new Error(`insert conversation_turn failed: ${error.message}`)
  return data
}

export async function supersedeOtherTurns(
  supabase: any,
  conversationId: string,
  keepTurnId: string,
): Promise<void> {
  await supabase
    .from('conversation_turns')
    .update({
      status: 'superseded',
      integrity_decision: 'cancel',
      integrity_reason: 'superseded_by_newer_turn',
      superseded_at: new Date().toISOString(),
    })
    .eq('conversation_id', conversationId)
    .neq('id', keepTurnId)
    .in('status', ['buffering', 'released', 'processing', 'clarification_needed'])
}

export async function hasNewerUserMessages(
  supabase: any,
  conversationId: string,
  afterTimestamp: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('role', 'user')
    .gt('created_at', afterTimestamp)
    .limit(1)

  return !!data?.length
}
