import type { MessageRunItem, TurnIntegrityDecision } from './turn.types';

/**
 * Pure turn-integrity (multi-bubble debounce) logic. Verbatim port of the
 * decision half of `_shared/turns.ts` (behavior-fidelity carry-over, preflight
 * §7): the 1000/2500/3000ms hold windows + revision/extension regexes.
 */

const MIN_HOLD_MS = 1000;
const EXTENDED_HOLD_MS = 2500;
const MAX_HOLD_MS = 3000;
const SHORT_FRAGMENT_LEN = 18;

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
];

const EXTENSION_PATTERNS = [
  /^(y|e|con|sin|para|de|del|la|el)\b/i,
  /^(grande|gde|chico|ch|caliente|fr[ií]o|frio|frapp[eé]|rocas|avena|coco|almendra|soya|deslactosada)\b/i,
  /^\d+\s*(x|pz|pzas)?$/i,
];

export function isRevisionLike(text: string): boolean {
  return REVISION_PATTERNS.some((pattern) => pattern.test(text));
}

export function isExtensionLike(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length <= SHORT_FRAGMENT_LEN ||
    EXTENSION_PATTERNS.some((pattern) => pattern.test(trimmed))
  );
}

export function buildMergedTurnText(messages: Array<Pick<MessageRunItem, 'content'>>): string {
  return messages
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function decideTurnIntegrity(params: {
  messages: MessageRunItem[];
  currentState: string;
  pendingClarification: Record<string, unknown> | null;
  now?: Date;
}): TurnIntegrityDecision | null {
  if (!params.messages.length) return null;

  const now = params.now ?? new Date();
  const mergedText = buildMergedTurnText(params.messages);
  const sourceMessageIds = params.messages.map((message) => message.id);
  const firstMessageAt = params.messages[0].created_at;
  const lastMessageAt = params.messages[params.messages.length - 1].created_at;
  const firstMs = new Date(firstMessageAt).getTime();
  const lastMs = new Date(lastMessageAt).getTime();
  const nowMs = now.getTime();

  const latestText = params.messages[params.messages.length - 1].content;
  const shouldExtendHold =
    params.messages.length > 1 ||
    isRevisionLike(latestText) ||
    isExtensionLike(latestText) ||
    params.currentState !== 'initial' ||
    !!params.pendingClarification;

  const targetHoldMs = shouldExtendHold ? EXTENDED_HOLD_MS : MIN_HOLD_MS;
  const releaseAtMs = Math.min(firstMs + MAX_HOLD_MS, lastMs + targetHoldMs);

  if (nowMs < releaseAtMs) {
    return {
      decision: shouldExtendHold ? 'merge' : 'hold',
      reason: shouldExtendHold
        ? 'waiting_for_possible_follow_up_or_revision'
        : 'waiting_for_turn_to_settle',
      holdUntil: new Date(releaseAtMs).toISOString(),
      mergedText,
      sourceMessageIds,
      firstMessageAt,
      lastMessageAt,
    };
  }

  return {
    decision: isRevisionLike(mergedText) ? 'replace' : 'release',
    reason: isRevisionLike(mergedText)
      ? 'latest_revision_ready_for_processing'
      : 'stable_turn_ready_for_processing',
    holdUntil: null,
    mergedText,
    sourceMessageIds,
    firstMessageAt,
    lastMessageAt,
  };
}
