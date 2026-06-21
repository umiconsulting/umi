import { logEmbedding, slog } from "./logger.ts";
import {
  EMBEDDING_MODEL,
  generateEmbedding,
  generateEmbeddings,
} from "./voyage.ts";

// Re-export Voyage adapter functions so existing consumers importing from
// './memory.ts' continue to work unchanged.
export {
  EMBEDDING_MODEL,
  generateEmbedding,
  generateEmbeddings,
} from "./voyage.ts";

// RAG-01: Minimum cosine similarity to inject as semantic context.
// Results below this threshold add noise rather than signal.
const MIN_SIMILARITY = 0.62;

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
  sourceScope?: "customer" | "conversation";
}

export interface WorkingMemory {
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
  summary: string | null;
  facts: CustomerFacts | null;
  semanticContext: SemanticResult[] | null;
  // RAG-03: similarity metrics for observability
  semanticStats: {
    count: number;
    min: number;
    max: number;
    avg: number;
    pondering_avg: number;
    pondering_max: number;
    source_scope?: "customer" | "conversation";
  } | null;
}

const RECENCY_HALFLIFE_DAYS = 3;
const MIN_NOVELTY_MULTIPLIER = 0.35;

function normalizeIntentSignature(content: string): string {
  const text = content.toLowerCase().trim();

  if (!text) return "empty";
  if (
    /(lo de siempre|mismo pedido|otra vez|igual|repetir|ultimo pedido|último pedido)/i
      .test(text)
  ) {
    return "repeat_order";
  }
  if (/(hola|buenas|buenos dias|buenas tardes|hello|hey)\b/i.test(text)) {
    return "greeting";
  }
  if (/(cancel|cancela|cancelar)/i.test(text)) return "cancel_order";
  if (/(donde|dónde|ubic|direccion|dirección|mapa)/i.test(text)) {
    return "location";
  }
  if (/(menu|menú|categor|que tienes|qué tienes)/i.test(text)) {
    return "menu_browse";
  }
  if (
    /(americano|chai|matcha|latte|postre|galleta|tisana|limonada|espresso|caramelo)/i
      .test(text)
  ) {
    return "product_or_order";
  }
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "other";
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

// ── Message persistence ──────────────────────────────────────────────────────

/**
 * Insert a message row with embedding = NULL (filled async later).
 * FT-01: Accepts optional twilio_message_sid for idempotency.
 * Returns the new message UUID, or null if the row already existed (duplicate SID).
 */
export async function insertMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  supabase: any,
  twilioMessageSid?: string,
): Promise<string | null> {
  try {
    const row: Record<string, unknown> = {
      conversation_id: conversationId,
      role,
      content,
    };
    if (twilioMessageSid) row.twilio_message_sid = twilioMessageSid;

    const { data, error } = await supabase
      .from("messages")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      // FT-01: Unique constraint violation on twilio_message_sid means already processed
      if (error.code === "23505" && twilioMessageSid) {
        slog("info", "message_already_processed", {
          twilio_sid: twilioMessageSid,
        });
        return "DUPLICATE";
      }
      slog("error", "insert_message_error", { error: error.message });
      return null;
    }
    return data?.id ?? null;
  } catch (err: any) {
    slog("error", "insert_message_failed", { error: err?.message });
    return null;
  }
}

/**
 * RAG-02: Update the embedding and model name for a message after async generation.
 * OBS-04: Logs embedding latency and success/failure for observability.
 */
export async function updateMessageEmbedding(
  messageId: string,
  embedding: number[],
  supabase: any,
  embeddingLatencyMs?: number,
  requestId?: string,
): Promise<void> {
  const start = Date.now();
  try {
    const { error } = await supabase
      .from("messages")
      .update({
        embedding: JSON.stringify(embedding),
        embedding_model: EMBEDDING_MODEL,
      })
      .eq("id", messageId);

    // OBS-04: Log embedding operation result
    if (embeddingLatencyMs !== undefined) {
      await logEmbedding({
        message_id: messageId,
        model: EMBEDDING_MODEL,
        success: !error,
        latency_ms: embeddingLatencyMs,
        error_message: error?.message,
        request_id: requestId,
      });
    }

    if (error) {
      slog("error", "update_embedding_error", {
        message_id: messageId,
        error: error.message,
      });
    }
  } catch (err: any) {
    slog("error", "update_embedding_failed", {
      message_id: messageId,
      error: err?.message,
    });
    if (embeddingLatencyMs !== undefined) {
      await logEmbedding({
        message_id: messageId,
        model: EMBEDDING_MODEL,
        success: false,
        latency_ms: Date.now() - start,
        error_message: err?.message,
        request_id: requestId,
      });
    }
  }
}

/**
 * Tier 2: Embed a user+assistant message pair in a single Voyage AI batch call
 * and persist both embeddings. Safe to call fire-and-forget — never throws.
 * Either message ID may be null (skipped gracefully).
 */
export async function embedMessagePair(
  userMsgId: string | null,
  assistantMsgId: string | null,
  userText: string,
  assistantText: string,
  voyageKey: string | undefined,
  supabase: any,
  requestId?: string,
): Promise<void> {
  if (!voyageKey) return;
  const embStart = Date.now();
  const embeddings = await generateEmbeddings(
    [userText, assistantText],
    voyageKey,
    "document",
    requestId,
  );
  const embLatency = Date.now() - embStart;
  const [userEmb, assistantEmb] = embeddings ?? [null, null];
  await Promise.all([
    userMsgId && userEmb
      ? updateMessageEmbedding(
        userMsgId,
        userEmb,
        supabase,
        embLatency,
        requestId,
      )
      : Promise.resolve(),
    assistantMsgId && assistantEmb
      ? updateMessageEmbedding(
        assistantMsgId,
        assistantEmb,
        supabase,
        embLatency,
        requestId,
      )
      : Promise.resolve(),
  ]);
}

// ── Working memory ───────────────────────────────────────────────────────────

/**
 * Build the 3-tier working memory context for Claude.
 */
export async function buildWorkingMemory(
  conversationId: string,
  customerId: string,
  currentMessage: string,
  supabase: any,
  voyageKey: string | undefined,
  totalMsgCount: number,
  requestId?: string,
  businessId?: string,
): Promise<WorkingMemory> {
  const doSemanticSearch = totalMsgCount > 4 && !!voyageKey;

  // Kick off the query embedding in parallel with DB fetches
  const queryEmbeddingPromise = doSemanticSearch
    ? generateEmbedding(currentMessage, voyageKey!, "query", requestId)
    : Promise.resolve(null);

  const [recentResult, prefsResult, convResult] = await Promise.all([
    supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("customer_preferences")
      .select("facts")
      .eq("customer_id", customerId)
      .maybeSingle(),
    supabase
      .from("conversations")
      .select("summary")
      .eq("id", conversationId)
      .single(),
  ]);

  const recentMessages: Array<{ role: "user" | "assistant"; content: string }> =
    (
      recentResult.data ?? []
    )
      .reverse()
      .map((m: any) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

  const rawFacts = prefsResult.data?.facts;
  const facts: CustomerFacts | null =
    rawFacts && Object.keys(rawFacts).length > 0
      ? (rawFacts as CustomerFacts)
      : null;

  const summary: string | null = convResult.data?.summary ?? null;

  // Semantic search with similarity threshold filtering
  let semanticContext: SemanticResult[] | null = null;
  let semanticStats: WorkingMemory["semanticStats"] = null;

  if (doSemanticSearch) {
    const queryEmbedding = await queryEmbeddingPromise;
    if (queryEmbedding) {
      try {
        let sourceScope: "customer" | "conversation" = "conversation";
        let similarMsgs: any[] | null = null;
        let error: any = null;

        if (businessId) {
          const customerSearch = await supabase.rpc(
            "search_customer_messages",
            {
              p_customer_id: customerId,
              p_business_id: businessId,
              p_current_conversation_id: conversationId,
              p_embedding: JSON.stringify(queryEmbedding),
              p_limit: 5,
              p_exclude_recent: 8,
              p_roles: ["user"],
            },
          );
          similarMsgs = customerSearch.data;
          error = customerSearch.error;
          if (!error) sourceScope = "customer";
        }

        if (error || !businessId) {
          if (error) {
            slog("warn", "customer_semantic_search_failed_falling_back", {
              error: error.message,
              request_id: requestId,
            });
          }

          const conversationSearch = await supabase.rpc(
            "search_similar_messages",
            {
              p_conversation_id: conversationId,
              p_embedding: JSON.stringify(queryEmbedding),
              p_limit: 5,
              p_exclude_recent: 8,
            },
          );
          similarMsgs = conversationSearch.data;
          error = conversationSearch.error;
          sourceScope = "conversation";
        }

        if (!error && similarMsgs?.length) {
          // RAG-01: Filter by minimum similarity threshold to avoid noise injection
          const filtered = similarMsgs.filter((m: any) =>
            m.similarity >= MIN_SIMILARITY
          );

          if (filtered.length > 0) {
            const now = new Date();
            const intentCounts = filtered.reduce(
              (acc: Record<string, number>, m: any) => {
                const signature = normalizeIntentSignature(m.content ?? "");
                acc[signature] = (acc[signature] ?? 0) + 1;
                return acc;
              },
              {},
            );

            const ranked = filtered
              .map((m: any) => {
                const intentSignature = normalizeIntentSignature(
                  m.content ?? "",
                );
                const recencyWeight = computeRecencyWeight(m.created_at, now);
                const noveltyWeight = computeNoveltyWeight(
                  intentCounts[intentSignature] ?? 1,
                );
                const ponderingScore = computePonderingScore(
                  m.similarity,
                  recencyWeight,
                  noveltyWeight,
                );

                return {
                  role: m.role,
                  content: m.content,
                  similarity: m.similarity,
                  ponderingScore,
                  intentSignature,
                  conversationId: m.conversation_id ?? null,
                  sourceScope,
                };
              })
              .sort((a: SemanticResult, b: SemanticResult) =>
                b.ponderingScore - a.ponderingScore
              );

            semanticContext = ranked;

            // RAG-03: Compute similarity stats for observability
            const scores = filtered.map((m: any) => m.similarity as number);
            const ponderingScores = ranked.map((m: SemanticResult) =>
              m.ponderingScore
            );
            semanticStats = {
              count: scores.length,
              min: Math.min(...scores),
              max: Math.max(...scores),
              avg: scores.reduce((s: number, v: number) => s + v, 0) /
                scores.length,
              pondering_avg: ponderingScores.reduce((s: number, v: number) =>
                s + v, 0) / ponderingScores.length,
              pondering_max: Math.max(...ponderingScores),
              source_scope: sourceScope,
            };
          } else {
            slog("info", "semantic_search_below_threshold", {
              raw_results: similarMsgs.length,
              top_score: similarMsgs[0]?.similarity ?? 0,
              threshold: MIN_SIMILARITY,
              request_id: requestId,
            });
          }
        }
      } catch (err: any) {
        slog("error", "semantic_search_failed", {
          error: err?.message,
          request_id: requestId,
        });
      }
    }
  }

  return { recentMessages, summary, facts, semanticContext, semanticStats };
}

// ── Claude Haiku async tasks ─────────────────────────────────────────────────

/**
 * Extract and merge customer facts using Claude Haiku.
 * Returns null on failure — existing facts remain untouched.
 */
export async function extractCustomerFacts(
  recentMessages: Array<{ role: string; content: string }>,
  existingFacts: CustomerFacts | null,
  anthropic: any,
): Promise<CustomerFacts | null> {
  try {
    const convoText = recentMessages.map((m) => `${m.role}: ${m.content}`).join(
      "\n",
    );
    const existingJson = existingFacts ? JSON.stringify(existingFacts) : "{}";

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system:
        `Extract and merge customer preferences from this WhatsApp conversation with a café bot.
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
      messages: [{ role: "user", content: convoText }],
    });

    const text = response.content.find((b: any) => b.type === "text")?.text ??
      "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as CustomerFacts;
  } catch (err: any) {
    slog("error", "extract_customer_facts_failed", { error: err?.message });
    return null;
  }
}

/**
 * PERF-03: Generate a rolling summary using Claude Haiku.
 * Only sends a bounded window of messages (at most 16) to avoid unbounded
 * token growth as conversations get longer. The existing summary carries
 * the history of earlier turns.
 */
export async function generateSummary(
  olderMessages: Array<{ role: string; content: string }>,
  existingSummary: string | null,
  anthropic: any,
): Promise<string | null> {
  try {
    // Cap the messages passed to Haiku — the existing summary already covers
    // earlier turns, so we only need the "new" messages since last summary.
    const windowedMessages = olderMessages.slice(-16);
    const convoText = windowedMessages.map((m) => `${m.role}: ${m.content}`)
      .join("\n");
    const existingContext = existingSummary
      ? `Previous summary: ${existingSummary}\n\nNew messages to incorporate:\n`
      : "";

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system:
        `You are summarizing a WhatsApp conversation with a café ordering bot.
Write a concise summary (2-4 sentences) of what was discussed, what the customer ordered or asked about,
and any important context. Be factual and brief.
CRITICAL RULES:
- Output ONLY the summary paragraph. Nothing else.
- Do NOT reproduce any conversation messages verbatim.
- Do NOT use headers, labels, or prefixes like "Summary:", "**Summary:**", "Here is a summary:", etc.
- Start directly with the summary content.`,
      messages: [
        {
          role: "user",
          content: `${existingContext}${convoText}`,
        },
      ],
    });

    const raw = response.content.find((b: any) =>
      b.type === "text"
    )?.text?.trim() ?? null;
    if (!raw) return null;

    // Post-process: strip any "Summary:" marker the model included despite instructions
    const summaryMarker = raw.match(/\*{0,2}Summary:\*{0,2}\s*/i);
    if (summaryMarker) {
      const afterMarker = raw.slice(
        raw.indexOf(summaryMarker[0]) + summaryMarker[0].length,
      ).trim();
      return afterMarker || raw;
    }

    return raw;
  } catch (err: any) {
    slog("error", "generate_summary_failed", { error: err?.message });
    return null;
  }
}
