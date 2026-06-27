import { Injectable, Logger } from '@nestjs/common';
import { AnthropicAdapter } from '../../shared/adapters/anthropic.adapter';
import { VoyageAdapter } from '../../shared/adapters/voyage.adapter';
import { MemoryRepository, type SemanticRow } from './memory.repository';
import { MessagesRepository } from './messages.repository';

/**
 * Working memory + Haiku enrichment. Ported from `_shared/memory.ts`
 * (behavior-fidelity carry-overs, preflight §7): MIN_SIMILARITY=0.62, recency
 * halflife 3d, novelty floor 0.35, pondering = sim*0.55 + recency*0.30 +
 * novelty*0.15, exclude-recent-8, semantic only when >4 messages. Rebound to
 * direct pgvector SQL (MemoryRepository) instead of Supabase RPCs.
 */

// RAG-01: minimum cosine similarity to inject as semantic context.
const MIN_SIMILARITY = 0.62;
const RECENCY_HALFLIFE_DAYS = 3;
const MIN_NOVELTY_MULTIPLIER = 0.35;

export interface CustomerFacts {
  preferences: string[];
  dislikes: string[];
  typical_order: string | null;
  allergies: string[];
  notes: string | null;
}

export interface SemanticResult {
  role: string;
  content: string;
  similarity: number;
  ponderingScore: number;
  intentSignature: string;
  conversationId?: string | null;
  sourceScope?: 'customer' | 'conversation';
}

export interface WorkingMemory {
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  summary: string | null;
  facts: CustomerFacts | null;
  semanticContext: SemanticResult[] | null;
  // RAG-03: similarity metrics for observability.
  semanticStats: {
    count: number;
    min: number;
    max: number;
    avg: number;
    pondering_avg: number;
    pondering_max: number;
    source_scope?: 'customer' | 'conversation';
  } | null;
}

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    private readonly anthropic: AnthropicAdapter,
    private readonly voyage: VoyageAdapter,
    private readonly memory: MemoryRepository,
    private readonly messages: MessagesRepository,
  ) {}

  // ── Working memory ─────────────────────────────────────────────────────────

  /** Build the 3-tier working memory context for Claude. */
  async buildWorkingMemory(params: {
    conversationId: string;
    personId: string;
    tenantId: string;
    currentMessage: string;
    totalMsgCount: number;
    summary: string | null;
  }): Promise<WorkingMemory> {
    const doSemanticSearch = params.totalMsgCount > 4;

    // Kick off the query embedding in parallel with the DB fetches.
    const queryEmbeddingPromise = doSemanticSearch
      ? this.voyage.generateEmbedding(params.currentMessage, 'query')
      : Promise.resolve(null);

    const [recent, rawFacts] = await Promise.all([
      this.messages.getRecentMessages(params.conversationId, 8),
      this.memory.getCustomerFacts(params.tenantId, params.personId),
    ]);

    const recentMessages = recent
      .reverse()
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const facts: CustomerFacts | null =
      rawFacts && Object.keys(rawFacts).length > 0
        ? (rawFacts as unknown as CustomerFacts)
        : null;

    let semanticContext: SemanticResult[] | null = null;
    let semanticStats: WorkingMemory['semanticStats'] = null;

    if (doSemanticSearch) {
      const queryEmbedding = await queryEmbeddingPromise;
      if (queryEmbedding) {
        try {
          let sourceScope: 'customer' | 'conversation' = 'customer';
          let similarMsgs: SemanticRow[] = await this.memory.searchCustomerMessages({
            tenantId: params.tenantId,
            personId: params.personId,
            currentConversationId: params.conversationId,
            embedding: queryEmbedding,
            limit: 5,
            excludeRecent: 8,
            roles: ['user'],
          });

          if (similarMsgs.length === 0) {
            // Fall back to conversation-scoped search.
            sourceScope = 'conversation';
            similarMsgs = await this.memory.searchSimilarMessages({
              conversationId: params.conversationId,
              embedding: queryEmbedding,
              limit: 5,
              excludeRecent: 8,
            });
          }

          const filtered = similarMsgs.filter((m) => m.similarity >= MIN_SIMILARITY);

          if (filtered.length > 0) {
            const now = new Date();
            const intentCounts = filtered.reduce<Record<string, number>>(
              (acc, m) => {
                const signature = normalizeIntentSignature(m.content ?? '');
                acc[signature] = (acc[signature] ?? 0) + 1;
                return acc;
              },
              {},
            );

            const ranked: SemanticResult[] = filtered
              .map((m) => {
                const intentSignature = normalizeIntentSignature(m.content ?? '');
                const recencyWeight = computeRecencyWeight(m.created_at, now);
                const noveltyWeight = computeNoveltyWeight(
                  intentCounts[intentSignature] ?? 1,
                );
                return {
                  role: m.role,
                  content: m.content,
                  similarity: m.similarity,
                  ponderingScore: computePonderingScore(
                    m.similarity,
                    recencyWeight,
                    noveltyWeight,
                  ),
                  intentSignature,
                  conversationId: m.conversation_id ?? null,
                  sourceScope,
                };
              })
              .sort((a, b) => b.ponderingScore - a.ponderingScore);

            semanticContext = ranked;

            const scores = filtered.map((m) => m.similarity);
            const ponderingScores = ranked.map((m) => m.ponderingScore);
            semanticStats = {
              count: scores.length,
              min: Math.min(...scores),
              max: Math.max(...scores),
              avg: scores.reduce((s, v) => s + v, 0) / scores.length,
              pondering_avg:
                ponderingScores.reduce((s, v) => s + v, 0) / ponderingScores.length,
              pondering_max: Math.max(...ponderingScores),
              source_scope: sourceScope,
            };
          } else if (similarMsgs.length > 0) {
            this.logger.log(
              `semantic_search_below_threshold raw=${similarMsgs.length} top=${
                similarMsgs[0]?.similarity ?? 0
              } threshold=${MIN_SIMILARITY}`,
            );
          }
        } catch (err) {
          this.logger.error(
            `semantic_search_failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return {
      recentMessages,
      summary: params.summary,
      facts,
      semanticContext,
      semanticStats,
    };
  }

  // ── Claude Haiku async tasks ─────────────────────────────────────────────────

  /** Extract & merge customer facts (enrichment). Null on failure (facts kept). */
  async extractCustomerFacts(
    recentMessages: Array<{ role: string; content: string }>,
    existingFacts: CustomerFacts | null,
  ): Promise<CustomerFacts | null> {
    const convoText = recentMessages.map((m) => `${m.role}: ${m.content}`).join('\n');
    const existingJson = existingFacts ? JSON.stringify(existingFacts) : '{}';

    const completion = await this.anthropic.createCompletion({
      maxTokens: 256,
      system: `Extract and merge customer preferences from this WhatsApp conversation with a café bot.
Return ONLY valid JSON with this exact shape:
{
  "preferences": ["string array of things they like"],
  "dislikes": ["string array of things they dislike"],
  "typical_order": "their most common/typical order or null",
  "allergies": ["string array of known allergies/intolerances"],
  "notes": "any other relevant notes or null"
}
Merge with existing facts. If nothing new, return existing facts unchanged.
Existing facts: ${existingJson}`,
      userMessage: convoText,
    });

    if (!completion) return null;
    const jsonMatch = completion.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
      return JSON.parse(jsonMatch[0]) as CustomerFacts;
    } catch {
      return null;
    }
  }

  /**
   * PERF-03: rolling summary via Haiku. Only a bounded window (≤16 messages) is
   * sent — the existing summary carries earlier turns.
   */
  async generateSummary(
    olderMessages: Array<{ role: string; content: string }>,
    existingSummary: string | null,
  ): Promise<string | null> {
    const windowedMessages = olderMessages.slice(-16);
    const convoText = windowedMessages.map((m) => `${m.role}: ${m.content}`).join('\n');
    const existingContext = existingSummary
      ? `Previous summary: ${existingSummary}\n\nNew messages to incorporate:\n`
      : '';

    const completion = await this.anthropic.createCompletion({
      maxTokens: 300,
      system: `You are summarizing a WhatsApp conversation with a café ordering bot.
Write a concise summary (2-4 sentences) of what was discussed, what the customer ordered or asked about,
and any important context. Be factual and brief.
CRITICAL RULES:
- Output ONLY the summary paragraph. Nothing else.
- Do NOT reproduce any conversation messages verbatim.
- Do NOT use headers, labels, or prefixes like "Summary:", "**Summary:**", "Here is a summary:", etc.
- Start directly with the summary content.`,
      userMessage: `${existingContext}${convoText}`,
    });

    const raw = completion?.text?.trim() ?? null;
    if (!raw) return null;

    const summaryMarker = raw.match(/\*{0,2}Summary:\*{0,2}\s*/i);
    if (summaryMarker) {
      const afterMarker = raw
        .slice(raw.indexOf(summaryMarker[0]) + summaryMarker[0].length)
        .trim();
      return afterMarker || raw;
    }
    return raw;
  }
}

// ── Pure ranking helpers (verbatim port) ───────────────────────────────────────

function normalizeIntentSignature(content: string): string {
  const text = content.toLowerCase().trim();
  if (!text) return 'empty';
  if (
    /(lo de siempre|mismo pedido|otra vez|igual|repetir|ultimo pedido|último pedido)/i.test(
      text,
    )
  ) {
    return 'repeat_order';
  }
  if (/(hola|buenas|buenos dias|buenas tardes|hello|hey)\b/i.test(text)) {
    return 'greeting';
  }
  if (/(cancel|cancela|cancelar)/i.test(text)) return 'cancel_order';
  if (/(donde|dónde|ubic|direccion|dirección|mapa)/i.test(text)) return 'location';
  if (/(menu|menú|categor|que tienes|qué tienes)/i.test(text)) return 'menu_browse';
  if (
    /(americano|chai|matcha|latte|postre|galleta|tisana|limonada|espresso|caramelo)/i.test(
      text,
    )
  ) {
    return 'product_or_order';
  }
  return (
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'other'
  );
}

function computeRecencyWeight(
  createdAt: string | null | undefined,
  now = new Date(),
): number {
  if (!createdAt) return 0.7;
  const ageMs = now.getTime() - new Date(createdAt).getTime();
  if (ageMs <= 0) return 1;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / RECENCY_HALFLIFE_DAYS);
}

function computeNoveltyWeight(repetitions: number): number {
  if (repetitions <= 1) return 1;
  return Math.max(MIN_NOVELTY_MULTIPLIER, 1 / repetitions);
}

function computePonderingScore(
  similarity: number,
  recencyWeight: number,
  noveltyWeight: number,
): number {
  return similarity * 0.55 + recencyWeight * 0.3 + noveltyWeight * 0.15;
}
