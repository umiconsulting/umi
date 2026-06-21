import { createCompletion } from "../_shared/adapters/anthropic.ts";
import {
  MILK_SYNONYMS,
  normalizeSynonymText,
  SIZE_SYNONYMS,
  TEMP_SYNONYMS,
} from "../_shared/synonyms.ts";
import { sanitizeOutput } from "./security.ts";

export type IntentType =
  | "location"
  | "business_hours"
  | "business_info"
  | "menu_search"
  | "product_info"
  | "add_to_cart"
  | "modify_cart"
  | "confirm_order"
  | "cancel_order"
  | "repeat_last_order"
  | "clarification_response"
  | "unknown";

export interface ExtractedIntent {
  intent_type: IntentType;
  confidence: "high" | "medium" | "low";
  complete: boolean;
  ambiguous: boolean;
  is_revision: boolean;
  references_prior_state: boolean;
  clarification_target:
    | "product"
    | "variant"
    | "pickup_person"
    | "confirmation"
    | "cancel_reason"
    | "unknown"
    | null;
  tool_hint:
    | "search_menu"
    | "add_to_cart"
    | "edit_cart"
    | "confirm_order"
    | "confirm_order_changes"
    | "cancel_order"
    | "reorder_last_order"
    | "get_business_info"
    | "get_business_hours"
    | "get_recent_customer_orders"
    | "talk_only"
    | null;
  entities: {
    query?: string;
    quantity?: number;
    size?: "CH" | "GDE";
    temp?: "CALIENTE" | "ROCAS" | "FRAPPE";
    milk?: "DESLACTOSADA" | "ALMENDRA" | "COCO" | "AVENA" | "SOYA";
    pickup_person?: string;
    personal_message?: string;
    customer_note?: string;
    cancel_reason?: string;
    confirmation?: "yes" | "no";
    remove_query?: string;
    keep_query?: string;
  };
}

const FALLBACK_INTENT: ExtractedIntent = {
  intent_type: "unknown",
  confidence: "low",
  complete: false,
  ambiguous: true,
  is_revision: false,
  references_prior_state: false,
  clarification_target: "unknown",
  tool_hint: null,
  entities: {},
};

function normalizeText(value: string): string {
  return normalizeSynonymText(value);
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const curr = [i + 1];
    for (let j = 0; j < b.length; j++) {
      curr.push(
        a[i] === b[j] ? prev[j] : 1 + Math.min(prev[j], prev[j + 1], curr[j]),
      );
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}

function fuzzyLookup<T extends string>(
  dict: Record<string, T>,
  value: string,
): T | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (dict[normalized]) return dict[normalized];

  const tokens = normalized.split(" ").filter(Boolean);
  for (const token of tokens) {
    if (dict[token]) return dict[token];
  }

  for (const token of tokens) {
    if (token.length < 4) continue;
    for (const [candidate, mapped] of Object.entries(dict)) {
      const maxDistance = token.length >= 7 ? 2 : 1;
      if (levenshteinDistance(token, candidate) <= maxDistance) return mapped;
    }
  }

  return null;
}

function parseIntentPayload(text: string): ExtractedIntent {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return FALLBACK_INTENT;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Partial<ExtractedIntent>;
    return {
      ...FALLBACK_INTENT,
      ...parsed,
      entities: parsed.entities ?? {},
    };
  } catch {
    return FALLBACK_INTENT;
  }
}

export function isAffirmativeConfirmation(text: string): boolean {
  const normalized = normalizeText(text);

  return [
    "si",
    "sip",
    "simon",
    "simon si",
    "jalo",
    "va",
    "va dale",
    "sale",
    "ok",
    "okay",
    "confirmo",
    "confirmado",
    "listo",
    "perfecto",
    "de una",
    "orale",
    "orales",
    "ya",
    "va ese",
  ].includes(normalized);
}

export function isNegativeConfirmation(text: string): boolean {
  const normalized = normalizeText(text);

  return ["no", "nop", "nel", "negativo"].includes(normalized);
}

export function shouldTreatAsConfirmationContext(params: {
  currentState: string;
  pendingClarification: Record<string, unknown> | null;
  draftCartSummary: string | null;
}): boolean {
  return (
    [
      "awaiting_confirmation",
      "confirming",
      "awaiting_order_changes_confirmation",
    ].includes(params.currentState) ||
    params.pendingClarification?.target === "confirmation"
  );
}

export function applyClarificationHeuristics(
  intent: ExtractedIntent,
  params: {
    turnText: string;
    pendingClarification: Record<string, unknown> | null;
  },
): void {
  const slot = String(
    params.pendingClarification?.slot ?? params.pendingClarification?.target ??
      "",
  );
  if (!slot) return;

  if (slot === "size" || slot === "variant") {
    const size = fuzzyLookup(SIZE_SYNONYMS, params.turnText);
    if (size) {
      intent.intent_type = "clarification_response";
      intent.confidence = "high";
      intent.complete = true;
      intent.ambiguous = false;
      intent.clarification_target = "variant";
      intent.tool_hint = "add_to_cart";
      intent.entities.size = size;
      return;
    }
  }

  if (slot === "temp" || slot === "variant") {
    const temp = fuzzyLookup(TEMP_SYNONYMS, params.turnText);
    if (temp) {
      intent.intent_type = "clarification_response";
      intent.confidence = "high";
      intent.complete = true;
      intent.ambiguous = false;
      intent.clarification_target = "variant";
      intent.tool_hint = "add_to_cart";
      intent.entities.temp = temp;
      return;
    }
  }

  if (slot === "milk" || slot === "variant") {
    const milk = fuzzyLookup(MILK_SYNONYMS, params.turnText);
    if (milk) {
      intent.intent_type = "clarification_response";
      intent.confidence = "high";
      intent.complete = true;
      intent.ambiguous = false;
      intent.clarification_target = "variant";
      intent.tool_hint = "add_to_cart";
      intent.entities.milk = milk;
      return;
    }
  }

  if (slot === "pickup_person") {
    if (!intent.entities.pickup_person) {
      const pickupPerson = normalizeText(params.turnText)
        .replace(/^a nombre de\s+/, "")
        .replace(/^para\s+/, "")
        .trim();
      if (!pickupPerson) return;
      intent.intent_type = "clarification_response";
      intent.confidence = "high";
      intent.complete = true;
      intent.ambiguous = false;
      intent.clarification_target = "pickup_person";
      intent.entities.pickup_person = pickupPerson;
    }
  }
}

export async function extractIntent(params: {
  turnText: string;
  currentState: string;
  pendingClarification: Record<string, unknown> | null;
  draftCartSummary: string | null;
  customerName: string | null;
  customerFacts?: unknown;
  conversationSummary?: string | null;
  semanticContext?: Array<{ role: string; content: string }> | null;
}): Promise<
  { intent: ExtractedIntent; inputTokens: number; outputTokens: number }
> {
  const completion = await createCompletion({
    temperature: 0,
    maxTokens: 500,
    system:
      `You extract structured intent from short WhatsApp messages for a cafe ordering assistant.
Return ONLY valid JSON with this exact shape:
{
  "intent_type": "location | business_hours | business_info | menu_search | product_info | add_to_cart | modify_cart | confirm_order | cancel_order | repeat_last_order | clarification_response | unknown",
  "confidence": "high | medium | low",
  "complete": true,
  "ambiguous": false,
  "is_revision": false,
  "references_prior_state": false,
  "clarification_target": "product | variant | pickup_person | confirmation | cancel_reason | unknown | null",
  "tool_hint": "search_menu | add_to_cart | confirm_order | confirm_order_changes | cancel_order | reorder_last_order | get_business_info | get_business_hours | get_recent_customer_orders | talk_only | null",
  "entities": {
    "query": "string optional",
    "quantity": 1,
    "size": "CH | GDE",
    "temp": "CALIENTE | ROCAS | FRAPPE",
    "milk": "DESLACTOSADA | ALMENDRA | COCO | AVENA | SOYA",
    "pickup_person": "string optional",
    "personal_message": "string optional",
    "customer_note": "string optional",
    "cancel_reason": "string optional",
    "confirmation": "yes | no"
  }
}

Rules:
- For bare yes/no answers during an active clarification or confirmation, use intent_type="clarification_response".
- For corrections like "no", "mejor", "cámbialo", mark is_revision=true and references_prior_state=true.
- If the message is incomplete, set complete=false.
- If there is ambiguity, set ambiguous=true.
- tool_hint is a soft prior for the next backend action, not a command. Use talk_only for greetings or conversational turns.
- Use "unknown" only when the message is completely unrelated to ordering or the cafe (e.g. spam, random text). Vague food or drink requests are always menu_search, never unknown.
- Use "product_info" when the customer asks what a product is, what it contains, its ingredients, how it tastes, or what variants it has — WITHOUT any ordering words ("quiero", "dame", "ponme", "me das"). tool_hint must be "search_menu". NEVER set tool_hint to "add_to_cart" for product_info.
- complete and ambiguous: A detailed order ("quiero X caliente con leche de almendra") is still complete=true when the product is clear. Do not set complete=false or ambiguous=true only because the customer mentioned temperature, milk, or size — those are normal details. Reserve complete=false for fragments that omit what to order ("quiero uno", "me das otro").
- entities.query: the best search term to find what the customer wants. Use the customer's words when they name something specific (e.g. "latte regular", "lavanda"). When the customer uses a vague or category-level word, translate it into the most natural search term for a cafe menu — "comida" → "comida", "algo de comer" → "comida", "algo dulce" → "postre", "algo frío" → "frío", "café" → "cafe". Never leave query empty for menu_search or add_to_cart intents. Omit only true filler ("porfa", "oye", greetings) and variant preferences already captured in size/temp/milk.
- Comma-separated preference lists: "latte regular, leche de coco, rocas" → query="latte regular", milk="COCO", temp="ROCAS" (leche/temperatura tokens go to their entity fields, NOT into query).
- More examples: "frappe de vainilla con leche de almendra" → query="frappe de vainilla", milk="ALMENDRA", temp="FRAPPE". "americano grande caliente" → query="americano", size="GDE", temp="CALIENTE". "matcha latte en las rocas" → query="matcha latte", temp="ROCAS". "comida" → intent_type="menu_search", query="comida", confidence="high". "algo de comer" → intent_type="menu_search", query="comida", confidence="high". "algo dulce" → intent_type="menu_search", query="postre dulce", confidence="high".
- When the customer states a milk type using any phrasing ("leche de coco", "con coco", "leche de almendra", "con almendra", etc.) map it directly to the canonical entities.milk token (COCO, ALMENDRA, etc.). Same for temperature ("en las rocas", "a las rocas", "con hielo" → ROCAS; "caliente" → CALIENTE; "frappe" → FRAPPE).`,
    userMessage: [
      `Cliente: ${params.customerName ?? "desconocido"}`,
      `Estado actual: ${params.currentState}`,
      `Clarificación pendiente: ${
        params.pendingClarification
          ? JSON.stringify(params.pendingClarification)
          : "null"
      }`,
      `Resumen carrito: ${params.draftCartSummary ?? "null"}`,
      `Facts cliente: ${
        params.customerFacts ? JSON.stringify(params.customerFacts) : "null"
      }`,
      `Resumen conversación: ${params.conversationSummary ?? "null"}`,
      `Contexto semántico: ${
        params.semanticContext?.length
          ? params.semanticContext.map((msg) => `[${msg.role}] ${msg.content}`)
            .join("\n")
          : "null"
      }`,
      `Turno del usuario: ${params.turnText}`,
    ].join("\n"),
  });

  if (!completion) {
    return { intent: FALLBACK_INTENT, inputTokens: 0, outputTokens: 0 };
  }

  const parsedIntent = parseIntentPayload(sanitizeOutput(completion.text));
  applyClarificationHeuristics(parsedIntent, {
    turnText: params.turnText,
    pendingClarification: params.pendingClarification,
  });
  if (shouldTreatAsConfirmationContext(params)) {
    const confirmationTool =
      params.currentState === "awaiting_order_changes_confirmation"
        ? "confirm_order_changes"
        : "confirm_order";

    if (isAffirmativeConfirmation(params.turnText)) {
      parsedIntent.intent_type = "clarification_response";
      parsedIntent.confidence = "high";
      parsedIntent.complete = true;
      parsedIntent.ambiguous = false;
      parsedIntent.clarification_target = "confirmation";
      parsedIntent.tool_hint = confirmationTool;
      parsedIntent.entities.confirmation = "yes";
    } else if (isNegativeConfirmation(params.turnText)) {
      parsedIntent.clarification_target = "confirmation";
    }
  }

  return {
    intent: parsedIntent,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
  };
}
