import { Injectable } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicAdapter } from '../../shared/adapters/anthropic.adapter';
import { sanitizeOutput } from './security.service';
import { ToolsService } from './tools.contract';
import { applyToolOutcome, type ToolOutcomeState } from './tool-outcomes';
import { jsonByteLength, truncateBytes } from './turn-safety';
import type {
  MiniHarnessToolLoopResult,
  ToolChainEntry,
  ToolContext,
  ToolResult,
} from './turn.types';

/**
 * The mini-harness tool loop — the heart of a turn. Verbatim port of
 * `processors/turn-tool-loop.ts` (behavior-fidelity carry-over, preflight §7):
 * the forced-tool heuristics, the add_to_cart→confirm/edit rewrite layer, the
 * Phase-1 safety blocks, dedup, MAX_TOOL_CALLS_PER_TURN budget,
 * MAX_GUARD_FIRES=4 circuit breaker, and the voiced-fallback recovery — all
 * preserved. Only the I/O seams are rebound: Anthropic via the injected adapter,
 * tools via the injected ToolsService (3c).
 */

export const MAX_TOOL_RESULT_BYTES = 5000;
const SYSTEM_ERROR_FALLBACK = '[Error técnico, intenta de nuevo]';

type LoopMessage = Anthropic.MessageParam;

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block: { type?: string }) => block?.type === 'text')
    .map((block: { text?: unknown }) => String(block.text ?? ''))
    .join('')
    .trim();
}

function toolUsesFromContent(content: unknown): Array<{
  id: string;
  name: string;
  input: Record<string, unknown>;
}> {
  if (!Array.isArray(content)) return [];
  return content
    .filter((block: { type?: string; id?: string }) => block?.type === 'tool_use' && block?.id)
    .map((block: { id?: unknown; name?: unknown; input?: unknown }) => ({
      id: String(block.id),
      name: String(block.name ?? ''),
      input:
        typeof block.input === 'object' && block.input
          ? (block.input as Record<string, unknown>)
          : {},
    }));
}

function stableToolCallKey(name: string, input: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(input, Object.keys(input).sort())}`;
}

function compactToolObservation(name: string, result: ToolResult): Record<string, unknown> {
  const observation: Record<string, unknown> = { tool: name, success: result?.success !== false };
  for (const key of [
    'found',
    'match_type',
    'message',
    'summary_text',
    'display_text',
    'customer_reply',
    'needs_clarification',
    'error',
    'error_type',
    'suggestion',
    'total',
    'item_count',
    'order_id',
    'cart_empty',
  ]) {
    if (result?.[key] !== undefined) observation[key] = result[key];
  }
  const arr = (k: string): unknown[] | null =>
    Array.isArray(result?.[k]) ? (result[k] as unknown[]) : null;
  if (arr('products')) observation.products = (result.products as unknown[]).slice(0, 6);
  if (arr('candidates')) observation.candidates = (result.candidates as unknown[]).slice(0, 6);
  if (arr('categories')) observation.categories = (result.categories as unknown[]).slice(0, 8);
  if (arr('orders')) observation.orders = (result.orders as unknown[]).slice(0, 3);
  if (arr('suggestions')) observation.suggestions = (result.suggestions as unknown[]).slice(0, 8);
  return truncateBytes(observation, MAX_TOOL_RESULT_BYTES) as Record<string, unknown>;
}

function buildPendingClarification(
  toolName: string,
  input: Record<string, unknown>,
  question: string,
): Record<string, unknown> {
  return {
    field: 'tool_clarification',
    question,
    created_at: new Date().toISOString(),
    context: { resume_tool: toolName, resume_input: input },
  };
}

function normalizeTurnText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s?]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasDraftCart(draftCart: unknown): boolean {
  const items = (draftCart as { items?: unknown })?.items;
  return Array.isArray(items) && items.length > 0;
}

function isMerchantInfoIntent(text: string): boolean {
  return /\b(transferencia|transferir|pago|pagar|tarjeta|efectivo|direccion|ubicacion|ubicados|numero|telefono|contacto|whatsapp)\b/.test(
    normalizeTurnText(text),
  );
}

function isRepeatIntent(text: string): boolean {
  return /\b(lo de siempre|lo mismo|mismo pedido|ultimo|ultima|repite|repetir)\b/.test(
    normalizeTurnText(text),
  );
}

function isHumanHandoffIntent(text: string): boolean {
  return /\b(hablar con alguien|hablar con una persona|persona|humano|encargado|alguien)\b/.test(
    normalizeTurnText(text),
  );
}

/**
 * Recognizing a "yes" — used ONLY to route a reply against a pending clarification.
 * It no longer guards the confirmation write: that gate asks the model to quote the
 * customer instead (see `turnTextContains`), because deciding what counts as a yes is
 * a semantic judgement and any list we write here is a classifier we cannot finish.
 * A list is tolerable for routing, where being wrong costs a re-ask; it was not
 * tolerable on the write, where being wrong cost the order and the customer.
 *
 * Kept as a stem match rather than the literal alternation it replaces
 * (`confirmo|confirmalo|confirmala|confirmar`), which did not list `confirmado` — the
 * past participle, and the most natural answer to "¿confirmas tu pedido?".
 */
const CONFIRM_VERB = /\bconfirm(?:o|a|as|ado|ada|amos|alo|ala|arlo|arla|ar)\b/;

/**
 * A bare "yes" — matched against the WHOLE message on purpose. As a substring these
 * are far too weak to authorize a write ("no si va" would confirm).
 * `normalizeTurnText` strips accents, so every alternative here is unaccented.
 */
const BARE_AFFIRMATIVE =
  /^(?:si+|sip|sipi|va|va pues|vale|sale|ok|okay|oka|listo|dale|simon|claro|andale|orale|perfecto|correcto|de una|jalo|adelante|asi es|asi esta bien|esta bien|todo bien|si porfa|si por favor|si gracias)$/;

/**
 * A leading negation cancels an otherwise-strong yes ("no confirmo", "todavía no").
 * Anchored at the START so it does not swallow a real confirmation that merely
 * carries an instruction — "si confirmo, no le pongas azúcar" is still a yes.
 */
const NEGATED_CONFIRMATION = /^(?:no|nel|nop|aun no|todavia no|espera|esperame)\b/;

function isStrongConfirmation(text: string): boolean {
  const normalized = normalizeTurnText(text).replace(/\?+$/g, '').trim();
  if (NEGATED_CONFIRMATION.test(normalized)) return false;
  return CONFIRM_VERB.test(normalized) || BARE_AFFIRMATIVE.test(normalized);
}

function isReadyForSummary(text: string): boolean {
  // "eso sería todo" is covered by `seria todo`; the accented twins are covered by
  // `normalizeTurnText`, which strips diacritics before this runs.
  return /\b(seria todo|es todo|nada mas|asi esta bien|asi lo dejamos)\b/.test(
    normalizeTurnText(text),
  );
}

/**
 * A message that reads as a QUESTION rather than an answer, so it can never stand in
 * for a confirmation.
 *
 * The bare tokens `seria` and `quedo` used to live in this alternation, and `seria`
 * matched the customer's own end-of-order signal: "sería todo" is `isReadyForSummary`
 * AND was flagged a question, so the one phrase that means "I'm done" could never
 * lead anywhere. Only the interrogative PHRASES stay.
 */
function isQuestionLike(text: string): boolean {
  const normalized = normalizeTurnText(text);
  return text.includes('?') || /\b(ya quedo|entonces seria|verdad|cierto)\b/.test(normalized);
}

/**
 * The confirmation gate's evidence test: are the words the model reports as the
 * customer's confirmation actually IN the customer's message?
 *
 * This replaces a word list, and the difference is the whole point. Deciding whether
 * "confirmado", "yeah go ahead" or "👍" means yes is a semantic judgement, and the
 * model is better at it than any regex we can finish — a list that does not know a
 * phrase refuses a real customer, re-asks, and loses the order. What a deterministic
 * check CAN do, which the model cannot do for itself, is prove the customer said
 * something at all. So the model owns the meaning and this owns the existence: it
 * cannot confirm an order out of thin air, in any language or register.
 *
 * Matching is case-, accent- and punctuation-insensitive, so a model that quotes
 * "Confirmado." against a message reading "confirmado" still passes.
 *
 * It deliberately does NOT reuse `normalizeTurnText`, which strips everything that is
 * not a letter or a number: that is right for word matching and wrong here, because it
 * reduces a bare "👍" to the empty string and the gate then refuses a customer who
 * confirmed perfectly clearly. An emoji IS the evidence when it is what they sent.
 */
const EVIDENCE_PUNCTUATION = /[.,;:!¡¿?"'«»“”‘’()\-–—]/g;

function normalizeEvidence(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(EVIDENCE_PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function turnTextContains(evidence: unknown, turnText: string): boolean {
  if (typeof evidence !== 'string') return false;
  const quoted = normalizeEvidence(evidence).split(' ').filter(Boolean);
  if (!quoted.length) return false;
  const spoken = normalizeEvidence(turnText).split(' ').filter(Boolean);
  // Whole-token match, not raw substring. A plain `includes` let a two-letter quote
  // ride inside an unrelated word — "si" matched "siempre lo mismo", "a" matched
  // "todavía lo estoy pensando" — so the gate proved nothing at all for exactly the
  // short quotes a confirmation is most likely to be.
  return spoken.some(
    (_, i) =>
      i + quoted.length <= spoken.length && quoted.every((word, j) => spoken[i + j] === word),
  );
}

/**
 * The reading frame for a reply that lands on an open order.
 *
 * Each turn the model receives a RECONSTRUCTION, not a conversation: the customer's
 * reply arrives under `MENSAJE ACTUAL`, and the question it answers sits several lines
 * above under `CONTEXTO RECIENTE`, related only by adjacency. That is why "confirmado"
 * was fragile — nothing bound the answer to the question, so the meaning of a short
 * reply had to be guessed from the words alone. This binds them explicitly.
 *
 * Two properties are deliberate:
 *
 *  - It is NEUTRAL. It never says "the customer is confirming". It names three
 *    readings and makes the unclear one as easy to take as the yes — a frame that
 *    presupposes its own answer is a rubber stamp, not a judgement.
 *  - It interpolates only OUR OWN last message, never the customer's text. The
 *    customer's words stay in `MENSAJE ACTUAL` where they always were, so this frame
 *    cannot become a way to forge an authorization.
 */
function buildConfirmationFrame(params: {
  draftCart: unknown;
  lastAssistantMessage: string | null;
}): string | null {
  if (!hasDraftCart(params.draftCart)) return null;
  const presentedAt = (params.draftCart as { presented_at?: string | null })?.presented_at;
  const lines = ['CÓMO LEER EL MENSAJE ACTUAL'];
  lines.push(
    presentedAt
      ? 'Hay un pedido en curso y ya le mostraste al cliente el resumen con su total.'
      : 'Hay un pedido en curso, pero todavía no le has mostrado el resumen con su total.',
  );
  if (params.lastAssistantMessage) {
    lines.push(`Tu último mensaje fue: "${params.lastAssistantMessage}"`);
    lines.push('El mensaje actual del cliente responde a eso. Decide qué significa:');
  } else {
    lines.push('Decide qué significa el mensaje actual del cliente:');
  }
  lines.push(
    '- Confirma el pedido → llama `confirm_order` y copia sus palabras EXACTAS en `customer_confirmation`.',
    '- Lo rechaza o pide cambios → atiéndelo; NO confirmes.',
    '- No queda claro → pregunta UNA sola vez, en la voz del negocio. Ante la duda NO confirmes.',
    'Una respuesta corta ("ya", "va", "ok", "sale", "yes", "👍") puede confirmar si responde a tu pregunta. Júzgalo por el contexto, no por la palabra.',
  );
  if (!presentedAt) {
    lines.push('Como todavía no le mostraste el total, muéstraselo antes de pedirle que confirme.');
  }
  return lines.join('\n');
}

function isResetIntent(text: string): boolean {
  return /\b(mejor no|olvida|empezar de nuevo|empecemos de nuevo|otra orden|solo quiero|nada mas quiero|unicamente quiero)\b/.test(
    normalizeTurnText(text),
  );
}

function isOptionCorrectionIntent(text: string): boolean {
  const normalized = normalizeTurnText(text);
  return (
    /\b(no era|era|cambialo|cambiala|cambia|me equivoque|mejor con|no de|en vez de)\b/.test(
      normalized,
    ) &&
    /\b(coco|avena|almendra|deslactosada|soya|soja|caliente|rocas|frappe|frio|fria|chico|grande|gde|ch)\b/.test(
      normalized,
    )
  );
}

function isRevisionIntent(text: string): boolean {
  return /\b(quita|quitar|saca|sacar|elimina|eliminar|borra|borrar|sin|cambia|cambiar|mejor)\b/.test(
    normalizeTurnText(text),
  );
}

function isAddIntent(text: string): boolean {
  return /\b(agrega|agregame|anade|añade|pon|ponme|dame|quiero|tambien|también|y un|y una)\b/.test(
    normalizeTurnText(text),
  );
}

function isGenericResetWithoutProduct(text: string): boolean {
  const normalized = normalizeTurnText(text);
  const hasReset =
    /\b(otra orden|hacer otra orden|empezar de nuevo|empecemos de nuevo|olvida eso|olvida todo)\b/.test(
      normalized,
    );
  if (!hasReset) return false;
  const remainder = normalized
    .replace(
      /\b(otra orden|hacer otra orden|empezar de nuevo|empecemos de nuevo|olvida eso|olvida todo)\b/g,
      ' ',
    )
    .replace(/\b(ok|okay|entonces|mejor|quiero|hacer|haz|una|un|la|el|olvida|todo|eso)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return remainder.length === 0;
}

function isConcreteOrderIntent(text: string): boolean {
  const normalized = normalizeTurnText(text);
  if (!isAddIntent(text)) return false;
  if (
    isMerchantInfoIntent(text) ||
    isHumanHandoffIntent(text) ||
    isRepeatIntent(text) ||
    isRevisionIntent(text) ||
    isGenericResetWithoutProduct(text)
  ) {
    return false;
  }
  return normalized.split(' ').filter((token) => token.length > 2).length >= 2;
}

function extractAddQuery(text: string): string {
  return normalizeTurnText(text)
    .replace(/^(perfecto|va|ok|okay|sale|bueno|tambien|también|y)\s+/, '')
    .replace(/\b(quiero|dame|agregame|agrega|ponme|pon|un|una)\b/g, ' ')
    .replace(/\b(porfa|por favor|mejor|de nuevo|otra vez|nuevamente)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(la|el|los|las)\s+/, '');
}

function extractCartEditInput(text: string): Record<string, unknown> | null {
  const normalized = normalizeTurnText(text);
  const removeMatch = normalized.match(
    /\b(?:quita|quitar|saca|sacar|elimina|eliminar|borra|borrar)\s+(?:el|la|los|las|un|una)?\s*([a-z0-9 ]+?)(?:,| y | pero | solo | nada mas |$)/,
  );
  const keepMatch = normalized.match(
    /\b(?:solo|nada mas|unicamente)\s+(?:quiero|deja|dejame|quedate con)?\s*(?:el|la|los|las|un|una)?\s*([a-z0-9 ]+?)(?:,|$)/,
  );
  const input: Record<string, unknown> = {};
  if (removeMatch?.[1]?.trim()) input.remove_query = removeMatch[1].trim();
  if (keepMatch?.[1]?.trim()) input.keep_query = keepMatch[1].trim();
  return Object.keys(input).length ? input : null;
}

const CART_PRONOUN_PATTERN =
  /^(ese|eso|esta|este|esa|lo|el|la|ese\s+item|ese\s+producto|esa\s+cosa|eso\s+mismo|ese\s+mismo)$/i;

function resolveCartPronoun(query: string, draftCart: unknown): string {
  if (!CART_PRONOUN_PATTERN.test(query.trim())) return query;
  const items = (draftCart as { items?: unknown })?.items;
  if (!Array.isArray(items) || items.length === 0) return query;
  return String((items[items.length - 1] as { product_name?: unknown }).product_name ?? query);
}

function extractVariantCorrection(text: string): Record<string, string> {
  const normalized = normalizeTurnText(text);
  const correction: Record<string, string> = {};
  const milk = normalized.match(/\b(deslactosada|deslactosado|almendra|coco|avena|soya|soja)\b/);
  if (milk) correction.milk = milk[1];
  const temp = normalized.match(/\b(caliente|rocas|frappe|frio|fria|hielo)\b/);
  if (temp) correction.temp = temp[1];
  const size = normalized.match(/\b(ch|chico|grande|gde)\b/);
  if (size) correction.size = size[1];
  return correction;
}

function mergeOptionCorrectionIntoPending(
  text: string,
  pending: Record<string, unknown>,
): Record<string, unknown> {
  if (!isOptionCorrectionIntent(text)) return pending;
  const correction = extractVariantCorrection(text);
  if (!Object.keys(correction).length) return pending;
  const ctx = (pending.context ?? {}) as Record<string, unknown>;
  const resumeInput = (ctx.resume_input ?? {}) as Record<string, unknown>;
  return { ...pending, context: { ...ctx, resume_input: { ...resumeInput, ...correction } } };
}

function pendingClarificationKind(
  pendingClarification: Record<string, unknown> | null,
): 'size' | 'temp' | 'milk' | 'generic' | null {
  const question = String(pendingClarification?.question ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!question) return null;
  if (/tamano|chico|grande/.test(question)) return 'size';
  if (/caliente|rocas|frappe|frio/.test(question)) return 'temp';
  if (/leche|deslactosada|almendra|coco|avena|soya/.test(question)) return 'milk';
  return 'generic';
}

function answersPendingClarification(
  text: string,
  pendingClarification: Record<string, unknown> | null,
): boolean {
  const kind = pendingClarificationKind(pendingClarification);
  if (!kind) return false;
  const normalized = normalizeTurnText(text);
  if (kind === 'size') return /\b(ch|chico|grande|gde)\b/.test(normalized);
  if (kind === 'temp') return /\b(caliente|rocas|frappe|frio|fria|hielo)\b/.test(normalized);
  if (kind === 'milk') {
    return /\b(deslactosada|deslactosado|almendra|coco|avena|soya|soja)\b/.test(normalized);
  }
  return (
    !isAddIntent(text) &&
    !isRevisionIntent(text) &&
    !isMerchantInfoIntent(text) &&
    !isStrongConfirmation(text)
  );
}

function shouldIncludePendingClarification(
  text: string,
  pendingClarification: Record<string, unknown> | null,
): boolean {
  if (!pendingClarification) return false;
  if (answersPendingClarification(text, pendingClarification)) return true;
  if (isOptionCorrectionIntent(text)) return true;
  if (
    isAddIntent(text) ||
    isRevisionIntent(text) ||
    isMerchantInfoIntent(text) ||
    isRepeatIntent(text) ||
    isQuestionLike(text)
  ) {
    return false;
  }
  return pendingClarificationKind(pendingClarification) === 'generic';
}

interface ForcedToolOutcome {
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  result: ToolResult;
  observation: Record<string, unknown>;
  stopReasonHint: string;
}

export interface ToolLoopParams {
  systemPrompt: string;
  userTurnText: string;
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  draftCart: unknown;
  pendingClarification: Record<string, unknown> | null;
  currentState: string;
  toolOutcomes: ToolOutcomeState;
  maxToolCalls: number;
  toolContext: ToolContext;
}

@Injectable()
export class ToolLoopService {
  constructor(
    private readonly anthropic: AnthropicAdapter,
    private readonly tools: ToolsService,
  ) {}

  private async maybeForceTool(
    params: { userTurnText: string; draftCart: unknown; toolContext: ToolContext },
    alreadyForced: boolean,
  ): Promise<ForcedToolOutcome | null> {
    if (alreadyForced) return null;
    const baseId = `forced_${Date.now()}`;

    if (isConcreteOrderIntent(params.userTurnText)) {
      const input: Record<string, unknown> = {
        query: extractAddQuery(params.userTurnText),
        ...(isResetIntent(params.userTurnText) ? { replace_cart: true } : {}),
      };
      const result = await this.tools.execute('add_to_cart', input, params.toolContext);
      return {
        toolName: 'add_to_cart',
        toolUseId: `${baseId}_add`,
        input,
        result,
        observation: compactToolObservation('add_to_cart', result),
        stopReasonHint: 'forced_add_to_cart',
      };
    }

    if (isGenericResetWithoutProduct(params.userTurnText)) {
      if (hasDraftCart(params.draftCart)) {
        const input = { action: 'clear' } as Record<string, unknown>;
        const result = await this.tools.execute('edit_cart', input, params.toolContext);
        return {
          toolName: 'edit_cart',
          toolUseId: `${baseId}_clear`,
          input,
          result,
          observation: compactToolObservation('edit_cart', result),
          stopReasonHint: 'forced_reset_clear_cart',
        };
      }
      return {
        toolName: 'noop_reset',
        toolUseId: `${baseId}_noop_reset`,
        input: {},
        result: {
          success: true,
          cart_empty: true,
          guidance: 'El carrito ya estaba vacío. Pídele al cliente qué le gustaría pedir.',
        },
        observation: { tool: 'noop_reset', success: true, cart_empty: true },
        stopReasonHint: 'forced_reset_acknowledged',
      };
    }

    if (isRevisionIntent(params.userTurnText) && hasDraftCart(params.draftCart)) {
      const editInput = extractCartEditInput(params.userTurnText);
      if (editInput && (editInput.remove_query || editInput.keep_query)) {
        if (typeof editInput.remove_query === 'string') {
          editInput.remove_query = resolveCartPronoun(editInput.remove_query, params.draftCart);
        }
        const result = await this.tools.execute('edit_cart', editInput, params.toolContext);
        return {
          toolName: 'edit_cart',
          toolUseId: `${baseId}_edit`,
          input: editInput,
          result,
          observation: compactToolObservation('edit_cart', result),
          stopReasonHint: 'forced_edit_cart',
        };
      }
    }

    if (isMerchantInfoIntent(params.userTurnText)) {
      const result = await this.tools.execute('get_merchant_info', {}, params.toolContext);
      return {
        toolName: 'get_merchant_info',
        toolUseId: `${baseId}_bizinfo`,
        input: {},
        result,
        observation: compactToolObservation('get_merchant_info', result),
        stopReasonHint: 'forced_merchant_info_tool',
      };
    }

    return null;
  }

  private async emitVoicedFallback(params: {
    systemPrompt: string;
    messages: LoopMessage[];
    reason: string;
    guidance: string;
  }): Promise<{ text: string; inputTokens: number; outputTokens: number } | null> {
    const recoveryMessages: LoopMessage[] = [
      ...params.messages,
      {
        role: 'user',
        content: `[NOTA INTERNA AL ASISTENTE — no es del cliente]\nMotivo: ${params.reason}\nIndicación: ${params.guidance}\nResponde directamente al cliente en una sola línea breve, en la voz del negocio. No vuelvas a llamar herramientas.`,
      },
    ];
    const recovery = await this.anthropic.createMessage({
      system: params.systemPrompt,
      messages: recoveryMessages,
      maxTokens: 250,
      temperature: 0.3,
    });
    if (!recovery) return null;
    const text = textFromContent(recovery.response?.content ?? []).trim();
    if (!text) return null;
    return { text, inputTokens: recovery.inputTokens, outputTokens: recovery.outputTokens };
  }

  async run(params: ToolLoopParams): Promise<MiniHarnessToolLoopResult> {
    const rawPendingClarification = shouldIncludePendingClarification(
      params.userTurnText,
      params.pendingClarification,
    )
      ? params.pendingClarification
      : null;
    const activePendingClarification = rawPendingClarification
      ? mergeOptionCorrectionIntoPending(params.userTurnText, rawPendingClarification)
      : null;
    const recentTranscript = params.recentMessages
      .slice(-8)
      .map((message) =>
        message.role === 'user'
          ? `<cliente>${message.content}</cliente>`
          : `<asistente>${message.content}</asistente>`,
      )
      .join('\n');
    const lastAssistantMessage =
      [...params.recentMessages].reverse().find((message) => message.role === 'assistant')
        ?.content ?? null;
    const confirmationFrame = buildConfirmationFrame({
      draftCart: params.draftCart,
      lastAssistantMessage,
    });
    const messages: LoopMessage[] = [
      {
        role: 'user',
        content: [
          recentTranscript ? `CONTEXTO RECIENTE:\n${recentTranscript}` : null,
          activePendingClarification
            ? `ACLARACION PENDIENTE:\n${JSON.stringify(activePendingClarification)}`
            : null,
          params.draftCart ? `CARRITO BORRADOR:\n${JSON.stringify(params.draftCart)}` : null,
          // Immediately before the customer's words, so the instruction is the last
          // thing read before the thing it applies to.
          confirmationFrame,
          `MENSAJE ACTUAL:\n${params.userTurnText}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ];

    let inputTokens = 0;
    let outputTokens = 0;
    let llmCallCount = 0;
    let toolCallCount = 0;
    let toolResultBytes = 0;
    const toolChain: ToolChainEntry[] = [];
    const seenToolCalls = new Set<string>();
    let recentOrdersFound = false;
    let recentOrdersLookupDone = false;
    let pendingClarificationToReport: Record<string, unknown> | null = null;
    let stopReason = 'final_text';
    let forcedAlready = false;
    let guardFireCount = 0;
    const MAX_GUARD_FIRES = 4;

    const definitions = this.tools.definitions();
    const totalBudget = params.maxToolCalls + 3;

    for (let loopIndex = 0; loopIndex < totalBudget; loopIndex++) {
      const completion = await this.anthropic.createMessage({
        system: params.systemPrompt,
        messages,
        tools: definitions,
        maxTokens: 900,
        temperature: 0,
      });

      if (!completion) {
        const voiced = await this.emitVoicedFallback({
          systemPrompt: params.systemPrompt,
          messages,
          reason: 'El modelo no pudo generar una respuesta en este intento.',
          guidance:
            'Discúlpate brevemente con el cliente y pregúntale si puede repetir su último mensaje.',
        });
        return {
          finalText: sanitizeOutput(voiced?.text ?? SYSTEM_ERROR_FALLBACK),
          inputTokens: inputTokens + (voiced?.inputTokens ?? 0),
          outputTokens: outputTokens + (voiced?.outputTokens ?? 0),
          llmCallCount: llmCallCount + (voiced ? 1 : 0),
          toolCallCount,
          toolResultBytes,
          toolChain,
          pendingClarification: pendingClarificationToReport,
          stopReason: voiced ? 'llm_error_recovered' : 'llm_error_unrecovered',
        };
      }

      inputTokens += completion.inputTokens;
      outputTokens += completion.outputTokens;
      llmCallCount++;

      const content = completion.response?.content ?? [];
      const toolUses = toolUsesFromContent(content);
      const text = textFromContent(content);

      if (!toolUses.length) {
        const forced = await this.maybeForceTool(
          {
            userTurnText: params.userTurnText,
            draftCart: params.draftCart,
            toolContext: params.toolContext,
          },
          forcedAlready || toolCallCount > 0,
        );

        if (forced) {
          forcedAlready = true;
          if (forced.toolName !== 'noop_reset') {
            toolCallCount++;
            toolResultBytes += jsonByteLength(forced.result);
            applyToolOutcome(params.toolOutcomes, forced.toolName, forced.result);
            // Register the forced call in the dedup set with the SAME keying as
            // normal calls, so a repeated model emission of the same mutating
            // forced action (e.g. confirm_order) can't run twice.
            seenToolCalls.add(stableToolCallKey(forced.toolName, forced.input));
          }
          toolChain.push({
            name: forced.toolName,
            input: forced.input,
            success: forced.result?.success !== false,
            error_type: forced.result?.error_type,
            needs_clarification:
              typeof forced.result?.needs_clarification === 'string'
                ? forced.result.needs_clarification
                : null,
            error_msg:
              forced.result?.success === false && typeof forced.result?.error === 'string'
                ? forced.result.error
                : null,
            data_summary: forced.observation,
          });
          if (typeof forced.result?.needs_clarification === 'string') {
            pendingClarificationToReport = buildPendingClarification(
              forced.toolName,
              forced.input,
              forced.result.needs_clarification.trim(),
            );
          }
          stopReason = forced.stopReasonHint;
          messages.push({
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: forced.toolUseId,
                name: forced.toolName,
                input: forced.input,
              },
            ] as Anthropic.ContentBlockParam[],
          });
          messages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: forced.toolUseId,
                content: JSON.stringify(forced.observation),
                is_error: forced.result?.success === false,
              },
            ] as Anthropic.ContentBlockParam[],
          });
          continue;
        }

        if (!text.trim()) {
          const voiced = await this.emitVoicedFallback({
            systemPrompt: params.systemPrompt,
            messages,
            reason: 'El modelo respondió con texto vacío.',
            guidance:
              'Responde brevemente al cliente reconociendo su mensaje y pregúntale cómo seguir.',
          });
          return {
            finalText: sanitizeOutput(voiced?.text ?? SYSTEM_ERROR_FALLBACK),
            inputTokens: inputTokens + (voiced?.inputTokens ?? 0),
            outputTokens: outputTokens + (voiced?.outputTokens ?? 0),
            llmCallCount: llmCallCount + (voiced ? 1 : 0),
            toolCallCount,
            toolResultBytes,
            toolChain,
            pendingClarification: pendingClarificationToReport,
            stopReason: voiced ? 'empty_response_recovered' : 'empty_response_unrecovered',
          };
        }

        return {
          finalText: sanitizeOutput(text),
          inputTokens,
          outputTokens,
          llmCallCount,
          toolCallCount,
          toolResultBytes,
          toolChain,
          pendingClarification: pendingClarificationToReport,
          stopReason,
        };
      }

      messages.push({ role: 'assistant', content: content });
      const toolResultBlocks: Anthropic.ContentBlockParam[] = [];

      for (const rawToolUse of toolUses) {
        let toolUse = rawToolUse;

        // ── Rewrite layer ──
        // NOTE: the `add_to_cart` → `confirm_order` rewrite that used to open this
        // chain is gone. It existed to compensate for the old gate: the word list was
        // so narrow that the model's own `confirm_order` kept being refused, so a
        // regex had to force the call instead. Now that the gate no longer judges
        // wording, a regex that OVERRIDES the model's choice is strictly worse than
        // one that vetoes it — the model can simply call `confirm_order` itself.
        if (
          toolUse.name === 'add_to_cart' &&
          isReadyForSummary(params.userTurnText) &&
          hasDraftCart(params.draftCart)
        ) {
          guardFireCount++;
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              blocked: true,
              attempted_action: 'add_to_cart',
              reason: 'user_signaled_order_is_complete',
              guidance:
                'El cliente indicó que su orden está completa. Pregúntale en una sola línea, en la voz del negocio, si confirma el pedido tal como está.',
            }),
            is_error: true,
          });
          toolChain.push({
            name: 'add_to_cart',
            input: toolUse.input,
            success: false,
            error_type: 'blocked_summary_intent',
            needs_clarification: null,
            error_msg: 'user_signaled_order_is_complete',
            data_summary: null,
          });
          continue;
        } else if (
          toolUse.name === 'add_to_cart' &&
          isGenericResetWithoutProduct(params.userTurnText)
        ) {
          guardFireCount++;
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              blocked: true,
              attempted_action: 'add_to_cart',
              reason: 'user_signaled_reset_without_product',
              guidance:
                'El cliente quiere empezar de nuevo pero aún no dijo qué quiere ordenar. Pregúntale qué le gustaría pedir, en una sola línea, en la voz del negocio.',
            }),
            is_error: true,
          });
          toolChain.push({
            name: 'add_to_cart',
            input: toolUse.input,
            success: false,
            error_type: 'blocked_generic_reset',
            needs_clarification: null,
            error_msg: 'user_signaled_reset_without_product',
            data_summary: null,
          });
          continue;
        } else if (
          toolUse.name === 'add_to_cart' &&
          isOptionCorrectionIntent(params.userTurnText) &&
          hasDraftCart(params.draftCart)
        ) {
          toolUse = {
            ...toolUse,
            name: 'edit_cart',
            input: {
              action: 'update_options',
              target_query: toolUse.input.query,
              size: toolUse.input.size,
              temp: toolUse.input.temp,
              milk: toolUse.input.milk,
            },
          };
        } else if (toolUse.name === 'add_to_cart' && isRevisionIntent(params.userTurnText)) {
          const editInput = extractCartEditInput(params.userTurnText);
          if (editInput?.remove_query) {
            toolUse = { ...toolUse, name: 'edit_cart', input: editInput };
          } else if (isResetIntent(params.userTurnText)) {
            toolUse = { ...toolUse, input: { ...toolUse.input, replace_cart: true } };
          }
        } else if (toolUse.name === 'add_to_cart' && isResetIntent(params.userTurnText)) {
          toolUse = { ...toolUse, input: { ...toolUse.input, replace_cart: true } };
        }

        // ── confirm_order / confirm_order_changes safety gate ──
        // Two STRUCTURAL preconditions, no semantic ones. There must be a cart to
        // confirm, and the model must quote the customer's own confirming words back
        // — words that have to be present in the message the customer actually sent.
        // Whether those words MEAN yes is the model's call: it reads context, register
        // and language, and a customer who answers "yeah" or "va que va" is confirming
        // just as much as one who writes "confirmo".
        if (
          (toolUse.name === 'confirm_order' || toolUse.name === 'confirm_order_changes') &&
          (!hasDraftCart(params.draftCart) ||
            !turnTextContains(toolUse.input?.customer_confirmation, params.userTurnText))
        ) {
          guardFireCount++;
          const reason = !hasDraftCart(params.draftCart)
            ? 'no_draft_cart_to_confirm'
            : 'confirmation_not_found_in_customer_message';
          const guidance = !hasDraftCart(params.draftCart)
            ? 'No hay un carrito listo para confirmar. Pregúntale al cliente qué quiere pedir.'
            : 'Solo puedes confirmar si el cliente ya lo dijo. Pasa en `customer_confirmation` las palabras EXACTAS de su último mensaje que confirman el pedido. Si no las dijo, pídele una confirmación en una sola línea, en la voz del negocio.';
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              blocked: true,
              attempted_action: toolUse.name,
              reason,
              guidance,
            }),
            is_error: true,
          });
          toolChain.push({
            name: toolUse.name,
            input: toolUse.input,
            success: false,
            error_type: 'blocked_unsafe_confirmation',
            needs_clarification: null,
            error_msg: reason,
            data_summary: null,
          });
          continue;
        }

        // ── reorder_last_order verification ──
        if (
          toolUse.name === 'reorder_last_order' &&
          isRepeatIntent(params.userTurnText) &&
          !recentOrdersFound &&
          !recentOrdersLookupDone
        ) {
          recentOrdersLookupDone = true;
          const lookupResult = await this.tools.execute(
            'get_recent_customer_orders',
            { limit: 1 },
            params.toolContext,
          );
          toolCallCount++;
          toolResultBytes += jsonByteLength(lookupResult);
          recentOrdersFound = Number(lookupResult?.found ?? 0) > 0;
          const lookupObservation = compactToolObservation(
            'get_recent_customer_orders',
            lookupResult,
          );
          toolChain.push({
            name: 'get_recent_customer_orders',
            input: { limit: 1 },
            success: lookupResult?.success !== false,
            error_type: lookupResult?.error_type,
            needs_clarification:
              typeof lookupResult?.needs_clarification === 'string'
                ? lookupResult.needs_clarification
                : null,
            error_msg:
              lookupResult?.success === false && typeof lookupResult?.error === 'string'
                ? lookupResult.error
                : null,
            data_summary: lookupObservation,
          });
          if (!recentOrdersFound) {
            guardFireCount++;
            toolResultBlocks.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify({
                blocked: true,
                attempted_action: 'reorder_last_order',
                reason: 'no_recent_orders_found_for_customer',
                recent_orders_check: lookupObservation,
                guidance:
                  'No hay órdenes previas para repetir. Dile brevemente al cliente que no encontraste una orden previa y pregúntale qué le gustaría pedir.',
              }),
              is_error: true,
            });
            toolChain.push({
              name: 'reorder_last_order',
              input: toolUse.input,
              success: false,
              error_type: 'blocked_no_recent_orders',
              needs_clarification: null,
              error_msg: 'no_recent_orders',
              data_summary: null,
            });
            continue;
          }
        } else if (
          toolUse.name === 'reorder_last_order' &&
          isRepeatIntent(params.userTurnText) &&
          !recentOrdersFound &&
          recentOrdersLookupDone
        ) {
          guardFireCount++;
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              blocked: true,
              attempted_action: 'reorder_last_order',
              reason: 'no_recent_orders_found_for_customer',
              guidance:
                'Ya verificamos: no hay órdenes previas para repetir. Pídele al cliente que indique qué quiere pedir.',
            }),
            is_error: true,
          });
          toolChain.push({
            name: 'reorder_last_order',
            input: toolUse.input,
            success: false,
            error_type: 'blocked_no_recent_orders',
            needs_clarification: null,
            error_msg: 'no_recent_orders',
            data_summary: null,
          });
          continue;
        }

        // ── Guard fire circuit breaker ──
        if (guardFireCount >= MAX_GUARD_FIRES) {
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              blocked: true,
              attempted_action: toolUse.name,
              reason: 'too_many_guard_fires_in_one_turn',
              guidance:
                'Hay muchos intentos bloqueados en este turno. Resume brevemente al cliente lo que sabes y pídele que aclare qué quiere hacer.',
            }),
            is_error: true,
          });
          stopReason = 'guard_loop_circuit_breaker';
          continue;
        }

        // ── Max tool calls budget ──
        if (toolCallCount >= params.maxToolCalls) {
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              blocked: true,
              attempted_action: toolUse.name,
              reason: 'max_tool_calls_reached',
              guidance:
                'Ya hubo varias llamadas a herramientas en este turno. Responde al cliente con lo que ya sabes, en una sola línea breve.',
            }),
            is_error: true,
          });
          stopReason = 'max_tool_calls';
          continue;
        }

        // ── Pronoun resolution for edit_cart ──
        if (toolUse.name === 'edit_cart') {
          const resolvedInput = { ...toolUse.input };
          if (typeof resolvedInput.remove_query === 'string') {
            resolvedInput.remove_query = resolveCartPronoun(
              resolvedInput.remove_query,
              params.draftCart,
            );
          }
          if (typeof resolvedInput.target_query === 'string') {
            resolvedInput.target_query = resolveCartPronoun(
              resolvedInput.target_query,
              params.draftCart,
            );
          }
          toolUse = { ...toolUse, input: resolvedInput };
        }

        // ── Dedup repeat tool calls ──
        const key = stableToolCallKey(toolUse.name, toolUse.input);
        if (seenToolCalls.has(key)) {
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              blocked: true,
              attempted_action: toolUse.name,
              reason: 'repeated_tool_call_with_same_input',
              guidance:
                'Esta misma acción ya se intentó. Responde brevemente al cliente con lo que sabes y pídele aclaración si falta información.',
            }),
            is_error: true,
          });
          stopReason = 'repeated_tool_call';
          continue;
        }
        seenToolCalls.add(key);

        // ── Execute tool ──
        const result = await this.tools.execute(toolUse.name, toolUse.input, params.toolContext);
        if (toolUse.name === 'get_recent_customer_orders') {
          recentOrdersFound = Number(result?.found ?? 0) > 0;
        }
        toolCallCount++;
        toolResultBytes += jsonByteLength(result);
        applyToolOutcome(params.toolOutcomes, toolUse.name, result);

        const observation = compactToolObservation(toolUse.name, result);
        toolChain.push({
          name: toolUse.name,
          input: toolUse.input,
          success: result?.success !== false,
          error_type: result?.error_type,
          needs_clarification:
            typeof result?.needs_clarification === 'string' ? result.needs_clarification : null,
          error_msg:
            result?.success === false && typeof result?.error === 'string' ? result.error : null,
          data_summary: observation,
        });

        if (typeof result?.needs_clarification === 'string') {
          const question = result.needs_clarification.trim();
          pendingClarificationToReport = buildPendingClarification(
            toolUse.name,
            toolUse.input,
            question,
          );
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              ...observation,
              needs_clarification: true,
              ask_customer_about: question,
              guidance:
                'Pregúntale al cliente exactamente sobre eso, en una sola línea breve, en la voz del negocio.',
            }),
            is_error: false,
          });
          continue;
        }

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(observation),
          is_error: result?.success === false,
        });
      }

      messages.push({ role: 'user', content: toolResultBlocks });
    }

    // Loop budget exhausted — recovery.
    const voiced = await this.emitVoicedFallback({
      systemPrompt: params.systemPrompt,
      messages,
      reason: 'Se agotó el presupuesto de iteraciones del turno.',
      guidance: 'Resume brevemente al cliente lo que sabes y pregúntale cómo quiere continuar.',
    });
    return {
      finalText: sanitizeOutput(voiced?.text ?? SYSTEM_ERROR_FALLBACK),
      inputTokens: inputTokens + (voiced?.inputTokens ?? 0),
      outputTokens: outputTokens + (voiced?.outputTokens ?? 0),
      llmCallCount: llmCallCount + (voiced ? 1 : 0),
      toolCallCount,
      toolResultBytes,
      toolChain,
      pendingClarification: pendingClarificationToReport,
      stopReason: voiced ? 'loop_exhausted_recovered' : 'loop_exhausted_unrecovered',
    };
  }
}
