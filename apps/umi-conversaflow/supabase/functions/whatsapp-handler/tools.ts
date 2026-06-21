import { generateEmbedding } from "../_shared/voyage.ts";
import { slog } from "../_shared/logger.ts";
import {
  MILK_SYNONYMS,
  normalizeSynonymText,
  SIZE_SYNONYMS,
  TEMP_SYNONYMS,
} from "../_shared/synonyms.ts";
import { insertJob, insertOutbox } from "../_shared/workflow.ts";
import {
  checkOrderingEnabled,
  getBusinessHours,
  getBusinessInfo,
  getOrdersClosedMessage,
  isWithinOrderHours,
} from "./business-hours.ts";
import { getActivePartialCancelledOrder } from "./context.ts";
import { sanitizeInput, validateCartItems } from "./security.ts";

type ProductVariant = {
  sku?: string | null;
  name: string;
  price: number | string;
};

type ProductRecord = {
  id: string;
  name: string;
  price: number | string;
  description?: string | null;
  category?: string | null;
  variants?: ProductVariant[] | null;
};

type DraftCartItem = {
  product_id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: number;
};

export type DraftCart = {
  items: DraftCartItem[];
  updated_at: string;
  customer_note?: string | null;
};

type VariantFilters = {
  size?: string;
  temp?: string;
  milk?: string;
};

export type ToolError = {
  success: false;
  error: string;
  error_type: "retryable" | "needs_input" | "terminal";
  suggestion?: string;
  auto_recovery?: {
    tool: string;
    input: Record<string, unknown>;
  };
};

type ToolExecutionContext = {
  businessId: string;
  customerId: string;
  conversationId: string;
  requestId?: string;
  customerPhone?: string;
};

const MENU_BROWSE_QUERY = /^(menu|menú|categorias|categorías|todo)$/i;

// Keyword → curated category list for browse intents. Maps Spanish browse
// phrases customers use ("comida", "bebida", "dulce") to the internal business
// categories they actually correspond to. Keeps the response grounded in real
// inventory instead of forcing the customer to guess internal labels.
const BROWSE_INTENT_CATEGORIES: Array<
  { pattern: RegExp; categories: string[] }
> = [
  {
    pattern:
      /\b(comida|comer|almuerzo|desayuno|sandwich|baguette|pan|snack|snacks|hambre)\b/i,
    categories: ["Alimentos", "snacks"],
  },
  {
    pattern: /\b(postre|postres|dulce|dulces|galleta|oblea|gomita)\b/i,
    categories: ["POSTRES", "snacks"],
  },
  {
    pattern: /\b(bebida|bebidas|tomar|sed)\b/i,
    categories: ["Cafe", "Matcha", "Sin cafe", "otras bebidas"],
  },
  { pattern: /\b(cafe|café)\b/i, categories: ["Cafe"] },
  { pattern: /\b(matcha)\b/i, categories: ["Matcha"] },
  {
    pattern: /\b(sin\s*cafe|sin\s*café|no\s*cafe|descafeinado)\b/i,
    categories: ["Sin cafe", "otras bebidas"],
  },
];

// Categories we never surface to customers — internal bookkeeping labels.
const INTERNAL_ONLY_CATEGORIES = new Set([
  "Sin categoría",
  "OTROS",
  "RENTA ESPACIOS",
  "MERCH",
]);

function resolveBrowseIntent(
  query: string,
): { isBrowse: boolean; categoryFilter?: string[] } {
  if (MENU_BROWSE_QUERY.test(query.trim())) return { isBrowse: true };
  const normalized = normalizeText(query);
  for (const entry of BROWSE_INTENT_CATEGORIES) {
    if (entry.pattern.test(normalized)) {
      return { isBrowse: true, categoryFilter: entry.categories };
    }
  }
  return { isBrowse: false };
}

function terminalToolError(error: string, suggestion?: string): ToolError {
  return { success: false, error, error_type: "terminal", suggestion };
}

function needsInputToolError(error: string, suggestion?: string): ToolError {
  return { success: false, error, error_type: "needs_input", suggestion };
}

function retryableToolError(
  error: string,
  auto_recovery?: { tool: string; input: Record<string, unknown> },
  suggestion?: string,
): ToolError {
  return {
    success: false,
    error,
    error_type: "retryable",
    auto_recovery,
    suggestion,
  };
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

function normalizeText(value: string): string {
  return normalizeSynonymText(value);
}

function singularizeToken(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("es") && token.length > 5 && !token.endsWith("tes")) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && token.length > 4) {
    return token.slice(0, -1);
  }
  return token;
}

function tokenizeSearchQuery(query: string): string[] {
  return normalizeText(query)
    .split(" ")
    .map((token) => singularizeToken(token))
    .filter(Boolean);
}

function buildSearchQueryCandidates(query: string): string[] {
  const normalized = normalizeText(query);
  const tokens = tokenizeSearchQuery(query);
  const candidates = new Set<string>();

  if (normalized) candidates.add(normalized);
  if (tokens.length > 0) {
    candidates.add(tokens.join(" "));
    candidates.add([...tokens].sort().join(" "));
  }

  return [...candidates].filter(Boolean);
}

function toNumber(value: number | string | null | undefined): number {
  const num = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function titleCaseVariantToken(token: string): string {
  return token
    .toLowerCase()
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function displayVariantName(name: string | null): string | null {
  if (!name) return null;
  return name
    .split(",")
    .map((part) => titleCaseVariantToken(part.trim()))
    .join(", ");
}

const VARIANT_FILLER_WORDS = new Set([
  "de",
  "con",
  "en",
  "las",
  "la",
  "los",
  "el",
  "un",
  "una",
  "a",
  "al",
  "leche",
]);

/**
 * Strips variant tokens (size/temp/milk synonyms and filler words) from a query when those
 * variants are already captured in separate entity fields. Used as a fallback when the full
 * query fails product search because the extractor left variant tokens inside the query string.
 * Returns null if nothing was stripped (original query should be used).
 */
export function buildStrippedSearchQuery(
  query: string,
  size?: string | null,
  temp?: string | null,
  milk?: string | null,
): string | null {
  if (!size && !temp && !milk) return null;
  const tokens = normalizeText(query).split(" ").filter(Boolean);
  if (tokens.length <= 2) return null;

  const toRemove = new Set<string>();
  if (size) {
    const canonical = normalizeVariantPreference("size", size);
    if (canonical) {
      Object.entries(SIZE_SYNONYMS).forEach(([k, v]) => {
        if (v === canonical) toRemove.add(k);
      });
    }
  }
  if (temp) {
    const canonical = normalizeVariantPreference("temp", temp);
    if (canonical) {
      Object.entries(TEMP_SYNONYMS).forEach(([k, v]) => {
        if (v === canonical) toRemove.add(k);
      });
    }
  }
  if (milk) {
    const canonical = normalizeVariantPreference("milk", milk);
    if (canonical) {
      Object.entries(MILK_SYNONYMS).forEach(([k, v]) => {
        if (v === canonical) toRemove.add(k);
      });
    }
  }

  if (!tokens.some((t) => toRemove.has(t))) return null;

  const stripped = tokens.filter((t) =>
    !toRemove.has(t) && !VARIANT_FILLER_WORDS.has(t)
  );
  if (stripped.length === 0) return null;
  const result = stripped.join(" ");
  return result === tokens.join(" ") ? null : result;
}

export function normalizeVariantPreference(
  kind: "size" | "temp" | "milk",
  value?: string | null,
): string | null {
  if (!value) return null;
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const dict = kind === "size"
    ? SIZE_SYNONYMS
    : kind === "temp"
    ? TEMP_SYNONYMS
    : MILK_SYNONYMS;
  if (dict[normalized]) return dict[normalized];
  // Scan individual tokens to handle multi-word phrases like "leche de coco" or "en las rocas"
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

export function inferVariantFiltersFromText(
  text: string,
  provided: VariantFilters = {},
): VariantFilters {
  const normalized = normalizeText(text);
  const inferred: VariantFilters = {
    size: normalizeVariantPreference("size", provided.size) ?? undefined,
    temp: normalizeVariantPreference("temp", provided.temp) ?? undefined,
    milk: normalizeVariantPreference("milk", provided.milk) ?? undefined,
  };
  if (!inferred.size) {
    inferred.size = normalizeVariantPreference("size", normalized) ?? undefined;
  }
  if (!inferred.temp) {
    inferred.temp = normalizeVariantPreference("temp", normalized) ?? undefined;
  }
  if (!inferred.milk) {
    inferred.milk = normalizeVariantPreference("milk", normalized) ?? undefined;
  }
  return inferred;
}

type RankedProductMatch = {
  product: ProductRecord;
  score: number;
};

function scoreProductMatch(product: ProductRecord, query: string): number {
  const normalizedName = normalizeText(product.name);
  const nameTokens = normalizedName.split(" ").filter(Boolean);
  const queryCandidates = buildSearchQueryCandidates(query);
  const queryTokens = tokenizeSearchQuery(query);
  let bestScore = 0;

  for (const candidate of queryCandidates) {
    if (!candidate) continue;
    if (normalizedName === candidate) bestScore = Math.max(bestScore, 180);
    else if (normalizedName.startsWith(candidate)) {
      bestScore = Math.max(bestScore, 160);
    } else if (candidate.includes(normalizedName)) {
      bestScore = Math.max(bestScore, 150);
    } else if (normalizedName.includes(candidate)) {
      bestScore = Math.max(bestScore, 130);
    }
  }

  if (queryTokens.length > 0) {
    const exactTokenCoverage = queryTokens.every((token) =>
      nameTokens.includes(token)
    );
    const looseTokenCoverage = queryTokens.every((token) =>
      normalizedName.includes(token)
    );

    if (exactTokenCoverage) {
      bestScore = Math.max(
        bestScore,
        118 - Math.max(0, nameTokens.length - queryTokens.length),
      );
    } else if (looseTokenCoverage) {
      bestScore = Math.max(
        bestScore,
        100 - Math.max(0, nameTokens.length - queryTokens.length),
      );
    } else {
      // Fuzzy tier: every query token must match a name token within 1 edit distance.
      // Catches c→k substitutions (e.g. "cafe" → "kafe"), one-off typos, and
      // phonetic variants that ILIKE and exact token checks both miss.
      const fuzzyTokenCoverage = queryTokens.every((qt) =>
        nameTokens.some((nt) => levenshteinDistance(qt, nt) <= 1)
      );
      if (fuzzyTokenCoverage) {
        bestScore = Math.max(
          bestScore,
          90 - Math.max(0, nameTokens.length - queryTokens.length),
        );
      }
    }
  }

  const variantScore = Math.max(
    0,
    ...(product.variants ?? []).map((variant) =>
      scoreVariantNameMatch(variant.name, query, product.name)
    ),
  );
  bestScore = Math.max(bestScore, variantScore);

  return bestScore;
}

function canonicalizeVariantSearchText(
  value: string,
  productName?: string,
): string {
  const productTokens = new Set(
    productName ? tokenizeSearchQuery(productName) : [],
  );
  return normalizeText(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !VARIANT_FILLER_WORDS.has(token))
    .map((token) =>
      normalizeVariantPreference("size", token)?.toLowerCase() ??
        normalizeVariantPreference("temp", token)?.toLowerCase() ??
        normalizeVariantPreference("milk", token)?.toLowerCase() ??
        singularizeToken(token)
    )
    .filter((token) => !productTokens.has(token))
    .join(" ");
}

function scoreVariantNameMatch(
  variantName: string,
  query: string,
  productName?: string,
): number {
  const normalizedVariant = canonicalizeVariantSearchText(variantName);
  const variantTokens = normalizedVariant.split(" ").filter(Boolean);
  const normalizedQuery = canonicalizeVariantSearchText(query, productName);
  const queryCandidates = buildSearchQueryCandidates(normalizedQuery);
  const queryTokens = tokenizeSearchQuery(normalizedQuery);
  let bestScore = 0;

  for (const candidate of queryCandidates) {
    if (!candidate) continue;
    if (normalizedVariant === candidate) bestScore = Math.max(bestScore, 160);
    else if (normalizedVariant.includes(candidate)) {
      bestScore = Math.max(bestScore, 145);
    }
  }

  if (queryTokens.length > 0) {
    const exactTokenCoverage = queryTokens.every((queryToken) =>
      variantTokens.includes(queryToken)
    );
    const tokenCoverage = queryTokens.every((queryToken) =>
      variantTokens.some((variantToken) =>
        variantToken.includes(queryToken) ||
        levenshteinDistance(queryToken, variantToken) <=
          (queryToken.length >= 7 ? 2 : 1)
      )
    );

    if (exactTokenCoverage) {
      bestScore = Math.max(
        bestScore,
        140 - Math.max(0, variantTokens.length - queryTokens.length),
      );
    } else if (tokenCoverage) {
      bestScore = Math.max(
        bestScore,
        120 - Math.max(0, variantTokens.length - queryTokens.length),
      );
    }
  }

  const hasWaterStyle = queryTokens.includes("mineral") ||
    queryTokens.includes("natural");
  const hasFlavor = queryTokens.some((token) =>
    [
      "lavanda",
      "rosa",
      "frambuesa",
      "matcha",
      "cherry",
      "simple",
    ].includes(token)
  );
  if (hasWaterStyle && !hasFlavor && variantTokens.includes("simple")) {
    bestScore += 20;
  }

  return bestScore;
}

export function chooseVariantByQuery(
  variants: ProductVariant[],
  query: string,
  productName?: string,
): ProductVariant | null {
  const ranked = variants
    .map((variant) => ({
      variant,
      score: scoreVariantNameMatch(variant.name, query, productName),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return null;
  if (ranked[0].score < 100) return null;
  if (ranked[1] && ranked[0].score < ranked[1].score + 15) return null;
  return ranked[0].variant;
}

function rankProductsByQuery(
  products: ProductRecord[],
  query: string,
): RankedProductMatch[] {
  return products
    .map((product) => ({ product, score: scoreProductMatch(product, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const lw =
        normalizeText(left.product.name).split(" ").filter(Boolean).length;
      const rw =
        normalizeText(right.product.name).split(" ").filter(Boolean).length;
      if (rw !== lw) return rw - lw;
      return left.product.name.localeCompare(right.product.name);
    });
}

function splitVariantTokens(variantName: string): string[] {
  return variantName
    .split(",")
    .map((part) => normalizeText(part).toUpperCase())
    .filter(Boolean);
}

function filtersFromVariantName(variantName: string | null): VariantFilters {
  if (!variantName) return {};
  const tokens = splitVariantTokens(variantName);
  const canonicalMilks = Object.values(MILK_SYNONYMS) as string[];
  const size = tokens.find((token) => token === "CH" || token === "GDE");
  const temp = tokens.find((token) =>
    token === "CALIENTE" || token === "ROCAS" || token === "FRAPPE"
  );
  const milk = tokens.find((token) => canonicalMilks.includes(token));
  return {
    ...(size ? { size } : {}),
    ...(temp ? { temp } : {}),
    ...(milk ? { milk } : {}),
  };
}

function hasToken(variantName: string, token: string): boolean {
  return splitVariantTokens(variantName).includes(token);
}

function buildVariantRequirements(filters: VariantFilters): string[] {
  return [
    normalizeVariantPreference("size", filters.size),
    normalizeVariantPreference("temp", filters.temp),
    normalizeVariantPreference("milk", filters.milk),
  ].filter((token): token is string => !!token);
}

function collectSupportedVariantTokens(
  variants: ProductVariant[],
): {
  size: Set<string>;
  temp: Set<string>;
  milk: Set<string>;
} {
  const canonicalMilks = new Set(Object.values(MILK_SYNONYMS) as string[]);
  const supported = {
    size: new Set<string>(),
    temp: new Set<string>(),
    milk: new Set<string>(),
  };

  for (const variant of variants) {
    for (const token of splitVariantTokens(variant.name)) {
      if (token === "CH" || token === "GDE") supported.size.add(token);
      if (token === "CALIENTE" || token === "ROCAS" || token === "FRAPPE") {
        supported.temp.add(token);
      }
      if (canonicalMilks.has(token)) supported.milk.add(token);
    }
  }

  return supported;
}

function sanitizeVariantFilters(
  variants: ProductVariant[],
  filters: VariantFilters,
): VariantFilters {
  const supported = collectSupportedVariantTokens(variants);
  const normalizedSize = normalizeVariantPreference("size", filters.size);
  const normalizedTemp = normalizeVariantPreference("temp", filters.temp);
  const normalizedMilk = normalizeVariantPreference("milk", filters.milk);

  return {
    ...(normalizedSize && supported.size.has(normalizedSize)
      ? { size: normalizedSize }
      : {}),
    ...(normalizedTemp && supported.temp.has(normalizedTemp)
      ? { temp: normalizedTemp }
      : {}),
    ...(normalizedMilk && supported.milk.has(normalizedMilk)
      ? { milk: normalizedMilk }
      : {}),
  };
}

function buildVariantClarification(
  filters: VariantFilters,
  variants: ProductVariant[],
): string | null {
  const sizeProvided = !!normalizeVariantPreference("size", filters.size);
  const tempProvided = !!normalizeVariantPreference("temp", filters.temp);
  const milkProvided = !!normalizeVariantPreference("milk", filters.milk);

  if (!sizeProvided) {
    const sizes = [
      ...new Set(
        variants.flatMap((variant) => splitVariantTokens(variant.name)).filter((
          token,
        ) => token === "CH" || token === "GDE"),
      ),
    ];
    if (sizes.length > 1) return "¿Qué tamano prefieres: Chico o Grande?";
  }

  if (!tempProvided) {
    const temps = [
      ...new Set(
        variants.flatMap((variant) => splitVariantTokens(variant.name)).filter((
          token,
        ) => token === "CALIENTE" || token === "ROCAS" || token === "FRAPPE"),
      ),
    ];
    if (temps.length > 1) {
      return "¿Cómo lo prefieres: Caliente, Rocas o Frappe?";
    }
  }

  if (!milkProvided) {
    const canonicalMilks = Object.values(MILK_SYNONYMS) as string[];
    const milks = [
      ...new Set(
        variants.flatMap((variant) => splitVariantTokens(variant.name)).filter((
          token,
        ) => canonicalMilks.includes(token)),
      ),
    ];
    if (milks.length > 1) {
      return "¿Qué leche prefieres: Deslactosada, Almendra, Coco, Avena o Soya?";
    }
  }

  return "Necesito un poco más de detalle para encontrar la variante correcta.";
}

export function resolveVariant(
  product: ProductRecord,
  filters: VariantFilters,
) {
  const variants = product.variants ?? [];
  if (!variants.length) {
    return {
      success: true as const,
      variant: null,
      unitPrice: toNumber(product.price),
    };
  }

  const sanitizedFilters = sanitizeVariantFilters(variants, filters);
  const requirements = buildVariantRequirements(sanitizedFilters);
  let candidates = variants;

  if (requirements.length > 0) {
    candidates = variants.filter((variant) =>
      requirements.every((token) => hasToken(variant.name, token))
    );
  }

  if (candidates.length === 1) {
    return {
      success: true as const,
      variant: candidates[0],
      unitPrice: toNumber(candidates[0].price),
    };
  }

  if (candidates.length > 1) {
    const optionKey = (variant: ProductVariant) => {
      const filters = filtersFromVariantName(variant.name);
      return [filters.size ?? "", filters.temp ?? "", filters.milk ?? ""].join(
        "|",
      );
    };
    const firstKey = optionKey(candidates[0]);
    const sameKnownOptions = candidates.every((candidate) =>
      optionKey(candidate) === firstKey
    );
    if (sameKnownOptions) {
      const defaultCandidate = [...candidates].sort((left, right) =>
        toNumber(left.price) - toNumber(right.price)
      )[0];
      return {
        success: true as const,
        variant: defaultCandidate,
        unitPrice: toNumber(defaultCandidate.price),
      };
    }
  }

  return {
    success: false as const,
    needs_clarification: buildVariantClarification(sanitizedFilters, variants),
  };
}

function formatMoney(value: number): string {
  return `$${Math.round(value)}`;
}

export function formatCartSummary(cart: DraftCart): string {
  const lines = ["📋 *Resumen de tu pedido:*"];
  let total = 0;

  for (const item of cart.items) {
    const lineTotal = item.quantity * item.unit_price;
    total += lineTotal;
    const variantLabel = displayVariantName(item.variant_name);
    lines.push(
      `• ${item.quantity}x ${item.product_name}${
        variantLabel ? ` (${variantLabel})` : ""
      } — ${formatMoney(lineTotal)}`,
    );
  }

  lines.push(`💰 *Total: ${formatMoney(total)}*`);
  if (cart.customer_note) lines.push(`📝 *Nota:* ${cart.customer_note}`);
  lines.push("¿Confirmas? ✅");
  return lines.join("\n");
}

function cartItemLabel(item: DraftCartItem): string {
  const variantLabel = displayVariantName(item.variant_name);
  return `${item.product_name}${variantLabel ? ` (${variantLabel})` : ""}`;
}

function cartItemMatchesQuery(item: DraftCartItem, query: string): boolean {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return false;
  const itemText = normalizeText(
    `${item.product_name} ${item.variant_name ?? ""}`,
  );
  if (itemText.includes(normalizedQuery)) return true;

  const queryTokens = normalizedQuery.split(" ").filter((token) =>
    token.length > 2
  );
  const itemTokens = itemText.split(" ").filter((token) => token.length > 2);
  return queryTokens.some((queryToken) =>
    itemTokens.some((itemToken) =>
      itemToken.includes(queryToken) ||
      queryToken.includes(itemToken) ||
      levenshteinDistance(queryToken, itemToken) <= 1
    )
  );
}

export function editDraftCartItems(
  cart: DraftCart,
  input: { remove_query?: string | null; keep_query?: string | null },
): {
  cart: DraftCart;
  removed: DraftCartItem[];
  keptMissing: string | null;
  notFound: string | null;
} {
  let items = [...cart.items];
  const removed: DraftCartItem[] = [];
  const removeQuery = input.remove_query?.trim() || null;
  const keepQuery = input.keep_query?.trim() || null;

  if (keepQuery) {
    const kept = items.filter((item) => cartItemMatchesQuery(item, keepQuery));
    if (kept.length > 0) {
      removed.push(...items.filter((item) => !kept.includes(item)));
      items = kept;
    }
  }

  if (removeQuery) {
    const before = items;
    items = before.filter((item) => {
      const shouldRemove = cartItemMatchesQuery(item, removeQuery);
      if (shouldRemove) removed.push(item);
      return !shouldRemove;
    });
  }

  return {
    cart: buildDraftCart(items, cart.customer_note ?? null),
    removed,
    keptMissing: keepQuery &&
        !cart.items.some((item) => cartItemMatchesQuery(item, keepQuery))
      ? keepQuery
      : null,
    notFound: removeQuery && removed.length === 0 ? removeQuery : null,
  };
}

function getRepresentativeVariants(
  variants: ProductVariant[],
  limit = 8,
): ProductVariant[] {
  const seen = new Set<string>();
  const picked: ProductVariant[] = [];

  for (const variant of variants) {
    const key = splitVariantTokens(variant.name).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(variant);
    if (picked.length >= limit) break;
  }

  return picked;
}

function variantHasOptionTokens(variant: ProductVariant): boolean {
  const tokens = splitVariantTokens(variant.name);
  return tokens.some((token) =>
    token === "CH" ||
    token === "GDE" ||
    token === "CALIENTE" ||
    token === "ROCAS" ||
    token === "FRAPPE" ||
    (Object.values(MILK_SYNONYMS) as string[]).includes(token)
  );
}

function variantsAreNamedItems(variants: ProductVariant[]): boolean {
  if (!variants.length) return false;
  const optionTokenCount = variants.filter(variantHasOptionTokens).length;
  return optionTokenCount / variants.length < 0.5;
}

export function formatProductDisplay(
  product: ProductRecord,
  sizeFilter?: string,
  tempFilter?: string,
  milkFilter?: string,
): string {
  const variants = product.variants ?? [];
  if (!variants.length) {
    const description = product.description ? ` — ${product.description}` : "";
    return `${product.name}${description}\n  Precio: ${
      formatMoney(toNumber(product.price))
    }`;
  }

  const sizeToken = normalizeVariantPreference("size", sizeFilter);
  const tempToken = normalizeVariantPreference("temp", tempFilter);
  const milkToken = normalizeVariantPreference("milk", milkFilter);
  const filteredVariants = variants.filter((variant) => {
    if (sizeToken && !hasToken(variant.name, sizeToken)) return false;
    if (tempToken && !hasToken(variant.name, tempToken)) return false;
    if (milkToken && !hasToken(variant.name, milkToken)) return false;
    return true;
  });
  const scoped = filteredVariants.length > 0 ? filteredVariants : variants;

  if (variantsAreNamedItems(scoped)) {
    const lines = [
      `${product.name}${
        product.description ? ` — ${product.description}` : ""
      }`,
    ];
    for (const variant of scoped.slice(0, 12)) {
      lines.push(
        `  • ${variant.name.trim()} — ${formatMoney(toNumber(variant.price))}`,
      );
    }
    if (scoped.length > 12) lines.push(`  • Y ${scoped.length - 12} más`);
    return lines.join("\n");
  }

  const sizePrices = new Map<string, number[]>();
  const temps = new Set<string>();
  const milks = new Set<string>();

  for (const variant of scoped) {
    const tokens = splitVariantTokens(variant.name);
    const size = tokens.find((token) => token === "CH" || token === "GDE");
    const temp = tokens.find((token) =>
      token === "CALIENTE" || token === "ROCAS" || token === "FRAPPE"
    );
    const milk = tokens.find((token) =>
      (Object.values(MILK_SYNONYMS) as string[]).includes(token)
    );
    const price = toNumber(variant.price);

    if (size) {
      if (!sizePrices.has(size)) sizePrices.set(size, []);
      sizePrices.get(size)!.push(price);
    }
    if (temp) temps.add(temp);
    if (milk) milks.add(milk);
  }

  const sizeLine = ["CH", "GDE"]
    .filter((size) => sizePrices.has(size))
    .map((size) => {
      const prices = sizePrices.get(size)!;
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      return `${size}: ${
        min === max
          ? formatMoney(min)
          : `${formatMoney(min)}-${formatMoney(max)}`
      }`;
    })
    .join(" | ");

  const tempMap: Record<string, string> = {
    CALIENTE: "Caliente",
    ROCAS: "Rocas",
    FRAPPE: "Frappe",
  };
  const milkMap: Record<string, string> = {
    DESLACTOSADA: "Deslactosada",
    ALMENDRA: "Almendra",
    COCO: "Coco",
    AVENA: "Avena",
    SOYA: "Soya",
  };

  const lines = [
    `${product.name}${product.description ? ` — ${product.description}` : ""}`,
  ];
  if (sizeLine) lines.push(`  ${sizeLine}`);
  if (temps.size > 0) {
    lines.push(
      `  ${
        ["CALIENTE", "ROCAS", "FRAPPE"].filter((token) => temps.has(token)).map(
          (
            token,
          ) => tempMap[token],
        ).join(" · ")
      }`,
    );
  }
  if (milks.size > 0) {
    lines.push(
      `  Leches: ${
        Object.keys(milkMap).filter((token) => milks.has(token)).map((token) =>
          milkMap[token]
        ).join(", ")
      }`,
    );
  }
  return lines.join("\n");
}

export async function searchProductsByQuery(
  supabase: any,
  businessId: string,
  query: string,
  limit = 10,
  requestId?: string,
): Promise<ProductRecord[]> {
  const normalizedQuery = normalizeText(query);
  const { data: textResults, error: textError } = await supabase.rpc(
    "search_products_text",
    {
      p_business_id: businessId,
      p_query: query,
      p_limit: limit,
    },
  );

  if (textError) {
    slog("warn", "product_search_text_error", {
      query,
      error: textError.message,
      request_id: requestId,
    });
  } else {
    slog("info", "product_search_text", {
      query,
      hits: textResults?.length ?? 0,
      top_match: textResults?.[0]?.name ?? null,
      request_id: requestId,
    });
  }

  if (textResults?.length) {
    return rankProductsByQuery(textResults as ProductRecord[], normalizedQuery)
      .slice(0, limit)
      .map((entry) => entry.product);
  }

  const { data: fallbackRows, error: fallbackError } = await supabase
    .from("products")
    .select("id, name, price, description, category, variants")
    .eq("business_id", businessId)
    .eq("available", true)
    .limit(250);

  if (fallbackError) {
    slog("warn", "product_search_table_fallback_error", {
      query,
      error: fallbackError.message,
      request_id: requestId,
    });
  } else {
    const rankedFallback = rankProductsByQuery(
      (fallbackRows ?? []) as ProductRecord[],
      normalizedQuery,
    );
    if (rankedFallback.length > 0) {
      slog("info", "product_search_table_fallback", {
        query,
        hits: rankedFallback.length,
        top_match: rankedFallback[0]?.product.name ?? null,
        request_id: requestId,
      });
      return rankedFallback.slice(0, limit).map((entry) => entry.product);
    }
  }

  // Semantic fallback: embed the query, search by cosine similarity.
  // Fires only when text search returns no results or errors.
  const voyageKey = Deno.env.get("VOYAGE_API_KEY");
  if (!voyageKey) {
    slog("warn", "product_search_no_voyage_key", {
      query,
      request_id: requestId,
    });
    return [];
  }

  const queryEmbedding = await generateEmbedding(
    query,
    voyageKey,
    "query",
    requestId,
  );
  if (!queryEmbedding) {
    slog("warn", "product_search_embedding_unavailable", {
      query,
      request_id: requestId,
    });
    return [];
  }

  const { data: semanticResults, error: rpcError } = await supabase.rpc(
    "search_products_by_embedding",
    {
      p_business_id: businessId,
      p_embedding: JSON.stringify(queryEmbedding),
      p_limit: limit,
      p_threshold: 0.60,
    },
  );

  slog("info", "product_search_semantic", {
    query,
    hits: semanticResults?.length ?? 0,
    top_match: semanticResults?.[0]?.name ?? null,
    top_similarity: semanticResults?.[0]?.similarity ?? null,
    rpc_error: rpcError?.message ?? null,
    request_id: requestId,
  });

  if (rpcError) return [];
  return rankProductsByQuery(
    (semanticResults ?? []) as ProductRecord[],
    normalizedQuery,
  )
    .slice(0, limit)
    .map((entry) => entry.product);
}

async function getCategorySuggestions(
  supabase: any,
  businessId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("products")
    .select("category")
    .eq("business_id", businessId)
    .eq("available", true);

  const categories = new Set<string>();
  for (const row of data ?? []) {
    if (!row?.category) continue;
    if (INTERNAL_ONLY_CATEGORIES.has(row.category)) continue;
    categories.add(row.category);
  }
  return [...categories];
}

/**
 * Returns nearest products for a query when exact/substring/fuzzy search failed.
 * Uses semantic embedding similarity with a permissive threshold so the voice
 * layer can *propose alternatives* instead of dead-ending the customer.
 *
 * Caller must have already exhausted search_products_text; this is the "help the
 * customer find something close" layer, not the primary match.
 */
async function findNearestProductCandidates(
  supabase: any,
  businessId: string,
  query: string,
  limit = 6,
  requestId?: string,
): Promise<ProductRecord[]> {
  const voyageKey = Deno.env.get("VOYAGE_API_KEY");
  if (!voyageKey) {
    slog("warn", "nearest_candidates_no_voyage_key", {
      query,
      request_id: requestId,
    });
    return [];
  }

  const queryEmbedding = await generateEmbedding(
    query,
    voyageKey,
    "query",
    requestId,
  );
  if (!queryEmbedding) return [];

  // Threshold tuned against voyage-4-lite: 0.30 surfaces savory/bread items for
  // queries like "baguette" while keeping out unrelated noise. Anything stricter
  // dead-ends the customer when their phrasing doesn't match an exact product.
  const { data, error } = await supabase.rpc("search_products_by_embedding", {
    p_business_id: businessId,
    p_embedding: JSON.stringify(queryEmbedding),
    p_limit: limit,
    p_threshold: 0.30,
  });

  slog("info", "nearest_candidates_semantic", {
    query,
    hits: data?.length ?? 0,
    top_match: data?.[0]?.name ?? null,
    top_similarity: data?.[0]?.similarity ?? null,
    rpc_error: error?.message ?? null,
    request_id: requestId,
  });

  if (error || !Array.isArray(data)) return [];
  return (data as ProductRecord[]).filter((p) =>
    !INTERNAL_ONLY_CATEGORIES.has(p.category ?? "")
  );
}

/**
 * Resolves search hits to one product or a short ambiguous list for clarification.
 * Single-token queries without an exact name match used to return every weak substring
 * match (e.g. all "latte" products); we cap those at 3 so the bot asks a finite question.
 */
export function chooseBestProductMatch(
  products: ProductRecord[],
  query: string,
): ProductRecord[] {
  const ranked = rankProductsByQuery(products, query);
  if (ranked.length === 0) return products;
  if (ranked.length === 1) return [ranked[0].product];

  const topScore = ranked[0].score;
  const secondScore = ranked[1].score;
  const queryTokens = tokenizeSearchQuery(query);

  if (topScore >= 140 || topScore >= secondScore + 15) {
    return [ranked[0].product];
  }

  const band = ranked.filter((entry) =>
    entry.score >= Math.max(90, topScore - 5)
  );

  if (queryTokens.length <= 1 && topScore < 140) {
    return band.slice(0, 3).map((entry) => entry.product);
  }

  if (band.length === 1) return [band[0].product];

  return band.slice(0, 5).map((entry) => entry.product);
}

export async function readDraftCart(
  supabase: any,
  conversationId: string,
): Promise<{ cart: DraftCart | null; version: number }> {
  const { data } = await supabase
    .from("conversations")
    .select("draft_cart, draft_cart_version")
    .eq("id", conversationId)
    .single();

  const cart = data?.draft_cart ?? null;
  const version = data?.draft_cart_version ?? 0;
  const validation = validateCartItems(cart);
  if (!validation.valid) {
    return {
      cart: { items: [], updated_at: new Date().toISOString() },
      version,
    };
  }
  return { cart, version };
}

export async function writeDraftCart(
  supabase: any,
  conversationId: string,
  cart: DraftCart | null,
  expectedVersion: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("conversations")
    .update({
      draft_cart: cart,
      draft_cart_version: expectedVersion + 1,
    })
    .eq("id", conversationId)
    .eq("draft_cart_version", expectedVersion)
    .select("id");

  if (error) return false;
  return !!data?.length;
}

export function buildDraftCart(
  items: DraftCartItem[],
  customerNote?: string | null,
): DraftCart {
  return {
    items,
    updated_at: new Date().toISOString(),
    customer_note: customerNote ?? null,
  };
}

function normalizeDraftCartItem(item: any): DraftCartItem | null {
  if (!item?.product_id || !item?.product_name) return null;
  return {
    product_id: String(item.product_id),
    product_name: String(item.product_name),
    variant_name: item.variant_name ? String(item.variant_name) : null,
    quantity: Math.max(1, Number(item.quantity) || 1),
    unit_price: toNumber(item.unit_price),
  };
}

function buildDraftItemsFromTransactionDetails(details: any): DraftCartItem[] {
  const items = Array.isArray(details?.items) ? details.items : [];
  return items
    .filter((item: any) => !Boolean(item?.cancelled))
    .map(normalizeDraftCartItem)
    .filter((item: DraftCartItem | null): item is DraftCartItem =>
      item !== null
    );
}

export function mergePartialCancelledItems(
  existingDetails: any,
  activeItems: DraftCartItem[],
): Record<string, unknown>[] {
  const originalItems = Array.isArray(existingDetails?.items)
    ? existingDetails.items
    : [];
  const cancelledItems = originalItems
    .filter((item: any) => Boolean(item?.cancelled))
    .map((item: any) => ({ ...item, cancelled: true }));

  const normalizedActiveItems = activeItems.map((item) => ({
    product_id: item.product_id,
    product_name: item.product_name,
    variant_name: item.variant_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
  }));

  return [...cancelledItems, ...normalizedActiveItems];
}

function summarizeAmbiguousProducts(products: ProductRecord[]): string {
  const labels = products.slice(0, 3).map((product) => {
    const suffix = product.description ? ` (${product.description})` : "";
    return `${product.name}${suffix}`;
  });
  if (labels.length === 1) return `¿Te refieres a ${labels[0]}?`;
  if (labels.length === 2) return `¿Quieres ${labels[0]} o ${labels[1]}?`;
  return `Encontré varias opciones: ${labels.join(", ")}. ¿Cuál prefieres?`;
}

function priceRangeForProduct(
  product: ProductRecord,
): { min: number; max: number } {
  const variants = product.variants ?? [];
  if (!variants.length) {
    const price = toNumber(product.price);
    return { min: price, max: price };
  }

  const prices = variants.map((variant) => toNumber(variant.price));
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

function formatOrderCustomerReply(
  orderId: string,
  total: number,
  pickupPerson?: string,
) {
  const pickupLine = pickupPerson ? `🙋 *Recoge:* ${pickupPerson}\n` : "";

  return [
    "¡Listo! Tu orden está confirmada. 🎉",
    "",
    `📋 *Número de orden:* \`${orderId}\``,
    `💰 *Total:* ${formatMoney(total)}`,
    pickupLine.trimEnd(),
    "",
    "Gracias por tu compra. ¡Nos vemos pronto! 😊",
  ].filter(Boolean).join("\n");
}

async function createTransactionFromItems(
  supabase: any,
  businessId: string,
  customerId: string,
  items: DraftCartItem[],
  detailsExtras: Record<string, unknown>,
  customerPhone?: string,
) {
  if (!items.length) {
    return terminalToolError("No hay productos en la orden.");
  }

  const [orderingCheck, { timezone: tz }] = await Promise.all([
    checkOrderingEnabled(supabase, businessId),
    getBusinessInfo(supabase, businessId),
  ]);

  if (!orderingCheck.enabled) {
    return terminalToolError(
      orderingCheck.disabledMessage ??
        "Los pedidos por WhatsApp están temporalmente pausados.",
    );
  }

  if (
    !await isWithinOrderHours(supabase, businessId, new Date(), customerPhone)
  ) {
    return terminalToolError(
      await getOrdersClosedMessage(supabase, businessId),
    );
  }

  const productIds = [...new Set(items.map((item) => item.product_id))];
  const { data: products } = await supabase
    .from("products")
    .select("id, name, price, variants, available")
    .eq("business_id", businessId)
    .in("id", productIds);

  const productMap = new Map<string, any>(
    (products ?? []).map((product: any) => [product.id, product]),
  );
  const validatedItems: DraftCartItem[] = [];

  for (const item of items) {
    const product = productMap.get(item.product_id);
    if (!product || product.available === false) {
      return retryableToolError(
        `El producto ${item.product_name} ya no está disponible.`,
        { tool: "search_menu", input: { query: item.product_name } },
      );
    }

    let unitPrice = toNumber(product.price);
    if (item.variant_name) {
      const variant = (product.variants ?? []).find((candidate: any) =>
        candidate.name === item.variant_name
      );
      if (!variant) {
        return needsInputToolError(
          `La variante ${
            displayVariantName(item.variant_name)
          } de ${product.name} ya no está disponible.`,
        );
      }
      unitPrice = toNumber(variant.price);
    }

    validatedItems.push({
      product_id: product.id,
      product_name: product.name,
      variant_name: item.variant_name,
      quantity: item.quantity,
      unit_price: unitPrice,
    });
  }

  const total = validatedItems.reduce(
    (sum, item) => sum + item.quantity * item.unit_price,
    0,
  );
  const details = { items: validatedItems, ...detailsExtras };

  const { data, error } = await supabase
    .from("transactions")
    .insert({
      id: crypto.randomUUID(),
      business_id: businessId,
      customer_id: customerId,
      transaction_type: "order",
      details,
      total_amount: total,
      status: "pending",
    })
    .select()
    .single();

  if (error) return retryableToolError(error.message);

  return {
    success: true,
    order_id: data.id,
    total,
    items: validatedItems,
  };
}

async function validateDraftCartItems(
  supabase: any,
  businessId: string,
  items: DraftCartItem[],
): Promise<
  { success: true; items: DraftCartItem[]; total: number } | ToolError
> {
  if (!items.length) {
    return terminalToolError("No hay productos en la orden.");
  }

  const productIds = [...new Set(items.map((item) => item.product_id))];
  const { data: products } = await supabase
    .from("products")
    .select("id, name, price, variants, available")
    .eq("business_id", businessId)
    .in("id", productIds);

  const productMap = new Map<string, any>(
    (products ?? []).map((product: any) => [product.id, product]),
  );
  const validatedItems: DraftCartItem[] = [];

  for (const item of items) {
    const product = productMap.get(item.product_id);
    if (!product || product.available === false) {
      return retryableToolError(
        `El producto ${item.product_name} ya no está disponible.`,
        { tool: "search_menu", input: { query: item.product_name } },
      );
    }

    let unitPrice = toNumber(product.price);
    if (item.variant_name) {
      const variant = (product.variants ?? []).find((candidate: any) =>
        candidate.name === item.variant_name
      );
      if (!variant) {
        return needsInputToolError(
          `La variante ${
            displayVariantName(item.variant_name)
          } de ${product.name} ya no está disponible.`,
        );
      }
      unitPrice = toNumber(variant.price);
    }

    validatedItems.push({
      product_id: product.id,
      product_name: product.name,
      variant_name: item.variant_name,
      quantity: item.quantity,
      unit_price: unitPrice,
    });
  }

  const total = validatedItems.reduce(
    (sum, item) => sum + item.quantity * item.unit_price,
    0,
  );
  return { success: true, items: validatedItems, total };
}

async function getSeedDraftCartFromPartialOrder(
  supabase: any,
  customerId: string,
): Promise<DraftCart | null> {
  const partialOrder = await getActivePartialCancelledOrder(
    supabase,
    customerId,
  );
  if (!partialOrder) return null;

  const { data: txn } = await supabase
    .from("transactions")
    .select("details")
    .eq("id", partialOrder.sourceTransactionID)
    .maybeSingle();

  if (!txn?.details) return null;

  const items = buildDraftItemsFromTransactionDetails(txn.details);
  if (!items.length) return null;

  return buildDraftCart(items, txn.details?.customer_note ?? null);
}

export const TOOL_DEFINITIONS = [
  {
    name: "get_business_info",
    description:
      "Obtiene dirección, métodos de pago y datos operativos del negocio. Úsala para ubicación, pagos o información general del café. No la uses para horarios ni para responder preguntas de menú.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_business_hours",
    description:
      "Obtiene el horario real del negocio y si todavía se reciben pedidos hoy. Úsala solo para horario, apertura/cierre o si aún aceptan pedidos. No la uses para menú, carrito ni dirección.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_menu",
    description:
      "Busca productos o categorías del menú y devuelve resultados estructurados para responder al cliente. Úsala para búsquedas exactas, vagas, browse por categoría o cuando necesites alternativas cercanas. No la uses para modificar o confirmar pedidos.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'Término de búsqueda o "menu".' },
        size: { type: "string" },
        temp: { type: "string" },
        milk: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "add_to_cart",
    description:
      "Busca un producto, resuelve la variante y actualiza el carrito borrador de la conversación. Úsala cuando el cliente quiere agregar algo o ajustar una bebida/comida específica. No la uses para confirmar, cancelar ni para consultas informativas sin intención de pedido.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        quantity: { type: "number" },
        size: { type: "string" },
        temp: { type: "string" },
        milk: { type: "string" },
        replace_cart: {
          type: "boolean",
          description:
            "True only when the client explicitly wants to replace/reset the current draft cart with this product.",
        },
        customer_note: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "edit_cart",
    description:
      "Edita el carrito borrador actual: quita productos, deja sólo un producto ya presente, limpia el carrito o cambia opciones de una línea existente. Úsala para frases como 'quita el latte', 'elimina X', 'deja sólo Y', 'olvida eso', 'no era coco, era avena'. No confirma la orden.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["remove", "keep_only", "clear", "update_options"],
          description:
            "Tipo de edición. Usa update_options para cambiar leche, tamaño o temperatura de un producto ya presente.",
        },
        remove_query: {
          type: "string",
          description: "Producto o línea que se debe quitar del carrito.",
        },
        keep_query: {
          type: "string",
          description:
            "Producto que el cliente quiere conservar como único item, si ya está en carrito.",
        },
        target_query: {
          type: "string",
          description:
            "Producto ya presente cuyas opciones se deben cambiar, por ejemplo Latte Regular.",
        },
        size: { type: "string" },
        temp: { type: "string" },
        milk: { type: "string" },
      },
    },
  },
  {
    name: "confirm_order",
    description:
      "Confirma la orden usando el carrito borrador actual de la conversación. Úsala solo después de una confirmación explícita del cliente sobre el resumen vigente. No la uses para interpretar confirmaciones ambiguas o para crear pedidos sin carrito.",
    input_schema: {
      type: "object",
      properties: {
        pickup_person: { type: "string" },
        personal_message: { type: "string" },
        customer_note: { type: "string" },
      },
    },
  },
  {
    name: "confirm_order_changes",
    description:
      "Confirma los cambios de una cancelación parcial activa para que el pedido actualizado siga en cocina. Úsala solo cuando existe una cancelación parcial pendiente y el cliente acepta esos cambios. No la uses para confirmaciones normales.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "cancel_order",
    description:
      "Cancela el pedido más reciente del cliente si todavía está pendiente. Úsala solo cuando el cliente quiere cancelar y ya tienes el motivo. No la uses para rechazos de una aclaración o cambios menores de carrito.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
      },
      required: ["reason"],
    },
  },
  {
    name: "get_recent_customer_orders",
    description:
      'Obtiene pedidos recientes del cliente para poder repetirlos o consultarlos. Úsala cuando el cliente menciona pedidos anteriores o "lo mismo de siempre". No la uses para crear la orden final por sí sola.',
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
    },
  },
  {
    name: "reorder_last_order",
    description:
      "Crea una nueva orden copiando la última orden válida del cliente. Úsala solo después de confirmar explícitamente que quiere repetir la última orden. No la uses si el cliente solo está preguntando qué pidió antes.",
    input_schema: {
      type: "object",
      properties: {
        customer_note: { type: "string" },
      },
    },
  },
];

export async function executeTool(
  supabase: any,
  name: string,
  input: any,
  ctx: ToolExecutionContext,
): Promise<any> {
  switch (name) {
    case "get_business_info":
      return getBusinessInfoTool(supabase, ctx.businessId);
    case "get_business_hours":
      return getBusinessHoursTool(supabase, ctx.businessId, ctx.customerPhone);
    case "search_menu":
    case "search_products":
      return searchMenu(supabase, ctx.businessId, {
        query: sanitizeInput(input.query),
        size: input.size,
        temp: input.temp,
        milk: input.milk,
      }, ctx.requestId);
    case "add_to_cart":
      return addToCart(
        supabase,
        ctx.businessId,
        ctx.customerId,
        ctx.conversationId,
        {
          query: sanitizeInput(input.query),
          quantity: input.quantity,
          size: input.size,
          temp: input.temp,
          milk: input.milk,
          replace_cart: input.replace_cart,
          customer_note: input.customer_note,
        },
        ctx.requestId,
      );
    case "edit_cart":
      return editCart(
        supabase,
        ctx.businessId,
        ctx.conversationId,
        {
          action: sanitizeInput(input.action ?? ""),
          remove_query: sanitizeInput(input.remove_query ?? ""),
          keep_query: sanitizeInput(input.keep_query ?? ""),
          target_query: sanitizeInput(input.target_query ?? ""),
          size: input.size,
          temp: input.temp,
          milk: input.milk,
        },
      );
    case "confirm_order":
      return confirmOrder(
        supabase,
        ctx.businessId,
        ctx.customerId,
        ctx.conversationId,
        input,
        ctx.customerPhone,
      );
    case "confirm_order_changes":
      return confirmOrderChanges(
        supabase,
        ctx.businessId,
        ctx.customerId,
        ctx.conversationId,
      );
    case "cancel_order":
      return cancelOrder(
        supabase,
        ctx.businessId,
        ctx.customerId,
        input.reason,
      );
    case "get_recent_customer_orders":
      return getRecentCustomerOrders(
        supabase,
        ctx.businessId,
        ctx.customerId,
        input.limit,
      );
    case "reorder_last_order":
      return reorderLastOrder(
        supabase,
        ctx.businessId,
        ctx.customerId,
        input.customer_note,
        ctx.customerPhone,
      );
    default:
      return terminalToolError(`Unknown tool: ${name}`);
  }
}

async function getBusinessInfoTool(supabase: any, businessId: string) {
  const info = await getBusinessInfo(supabase, businessId);
  return {
    ...info,
    message: `Dirección: ${info.address}. Métodos de pago: ${
      info.paymentMethods.length > 0
        ? info.paymentMethods.join(", ")
        : "no especificados"
    }.`,
  };
}

async function getBusinessHoursTool(
  supabase: any,
  businessId: string,
  phone?: string,
) {
  return getBusinessHours(supabase, businessId, new Date(), phone);
}

async function searchMenu(
  supabase: any,
  businessId: string,
  input: { query: string; size?: string; temp?: string; milk?: string },
  requestId?: string,
) {
  const browseIntent = resolveBrowseIntent(input.query);

  if (browseIntent.isBrowse) {
    let productQuery = supabase
      .from("products")
      .select("id, name, price, description, category, variants")
      .eq("business_id", businessId)
      .eq("available", true)
      .limit(80);

    if (browseIntent.categoryFilter?.length) {
      productQuery = productQuery.in("category", browseIntent.categoryFilter);
    }

    const { data } = await productQuery;
    const rows = (data ?? []).filter((p: any) =>
      !INTERNAL_ONLY_CATEGORIES.has(p?.category ?? "")
    );

    const byCategory = new Map<string, ProductRecord[]>();
    for (const product of rows) {
      const category = product.category || "Sin categoría";
      const bucket = byCategory.get(category) ?? [];
      bucket.push(product);
      byCategory.set(category, bucket);
    }

    const categories = [...byCategory.entries()].map(([category, items]) => ({
      category,
      examples: items.slice(0, 4).map((product) => product.name),
      count: items.length,
    }));

    const flatProducts = rows.map((product: ProductRecord) => ({
      product_id: product.id,
      name: product.name,
      category: product.category ?? "Sin categoría",
      display_text: formatProductDisplay(
        product,
        input.size,
        input.temp,
        input.milk,
      ),
      price_range: priceRangeForProduct(product),
      representative_variants: getRepresentativeVariants(product.variants ?? [])
        .map((variant) => ({
          name: variant.name,
          price: toNumber(variant.price),
        })),
    }));

    return {
      found: flatProducts.length,
      match_type: "browse" as const,
      category_filter: browseIntent.categoryFilter ?? null,
      categories,
      products: flatProducts.slice(0, 15),
      message: categories.length
        ? categories.map((c) => `${c.category}: ${c.examples.join(", ")}`).join(
          "; ",
        )
        : "Sin productos disponibles en esa categoría.",
    };
  }

  const products = await searchProductsByQuery(
    supabase,
    businessId,
    input.query,
    5,
    requestId,
  );

  if (!products.length) {
    const candidates = await findNearestProductCandidates(
      supabase,
      businessId,
      input.query,
      6,
      requestId,
    );
    const suggestions = await getCategorySuggestions(supabase, businessId);

    const formattedCandidates = candidates.map((product) => ({
      product_id: product.id,
      name: product.name,
      category: product.category ?? "Sin categoría",
      display_text: formatProductDisplay(
        product,
        input.size,
        input.temp,
        input.milk,
      ),
      price_range: priceRangeForProduct(product),
    }));

    // Structured message for the voice LLM. No rigid customer copy, no raw
    // internal category codes. The voice layer reads this plus the candidates
    // and composes the customer reply in the configured tone.
    const messageParts = [`Sin match exacto para "${input.query}".`];
    if (formattedCandidates.length) {
      messageParts.push(
        `Opciones cercanas: ${
          formattedCandidates.slice(0, 5).map((p) =>
            `${p.name} (${p.category})`
          ).join(", ")
        }.`,
      );
    } else if (suggestions.length) {
      messageParts.push(
        `Categorías con inventario: ${suggestions.join(", ")}.`,
      );
    }

    return {
      found: 0,
      match_type: formattedCandidates.length
        ? "near" as const
        : "none" as const,
      products: [],
      candidates: formattedCandidates,
      suggestions,
      message: messageParts.join(" "),
    };
  }

  const formattedProducts = products.map((product) => ({
    product_id: product.id,
    name: product.name,
    category: product.category ?? "Sin categoría",
    display_text: formatProductDisplay(
      product,
      input.size,
      input.temp,
      input.milk,
    ),
    price_range: priceRangeForProduct(product),
    representative_variants: getRepresentativeVariants(product.variants ?? [])
      .map((variant) => ({
        name: variant.name,
        price: toNumber(variant.price),
      })),
  }));

  return {
    found: formattedProducts.length,
    match_type: "exact" as const,
    products: formattedProducts,
    message: formattedProducts.map((product) => product.display_text).join(
      "\n\n",
    ),
  };
}

async function addToCart(
  supabase: any,
  businessId: string,
  customerId: string,
  conversationId: string,
  input: {
    query: string;
    quantity?: number;
    size?: string;
    temp?: string;
    milk?: string;
    replace_cart?: boolean;
    customer_note?: string;
  },
  requestId?: string,
) {
  const quantity = Math.max(1, Math.min(Number(input.quantity) || 1, 20));
  const variantFilters = inferVariantFiltersFromText(input.query, {
    size: input.size,
    temp: input.temp,
    milk: input.milk,
  });
  const searchResults = await searchProductsByQuery(
    supabase,
    businessId,
    input.query,
    10,
    requestId,
  );
  let products = chooseBestProductMatch(searchResults, input.query);
  let effectiveQuery = input.query;

  // When variant tokens contaminate the query (extractor included them in query AND in
  // size/temp/milk), the ranker scores the correct product at 0 because tokens like
  // "grande", "rocas", "coco" are not part of the product name. Try a stripped query.
  if (
    !products.length &&
    (variantFilters.size || variantFilters.temp || variantFilters.milk)
  ) {
    const strippedQuery = buildStrippedSearchQuery(
      input.query,
      variantFilters.size,
      variantFilters.temp,
      variantFilters.milk,
    );
    if (strippedQuery) {
      const strippedResults = await searchProductsByQuery(
        supabase,
        businessId,
        strippedQuery,
        10,
        requestId,
      );
      const strippedProducts = chooseBestProductMatch(
        strippedResults,
        strippedQuery,
      );
      if (strippedProducts.length) {
        slog("info", "add_to_cart_stripped_query_fallback", {
          original_query: input.query,
          stripped_query: strippedQuery,
          chosen_names: strippedProducts.map((p) => p.name),
          request_id: requestId,
        });
        products = strippedProducts;
        effectiveQuery = strippedQuery;
      }
    }
  }

  slog("info", "add_to_cart_match_resolution", {
    query: effectiveQuery,
    original_query: input.query !== effectiveQuery ? input.query : undefined,
    search_hits: searchResults.length,
    chosen_hits: products.length,
    chosen_names: products.map((product) => product.name),
    request_id: requestId,
  });

  if (!products.length) {
    const suggestions = await getCategorySuggestions(supabase, businessId);
    return {
      ...retryableToolError(
        `No encontré "${effectiveQuery}" en el menú.`,
        { tool: "search_menu", input: { query: effectiveQuery } },
        "Prueba con otro nombre de producto o una categoría.",
      ),
      suggestions,
    };
  }

  if (products.length > 1) {
    slog("info", "add_to_cart_needs_clarification", {
      query: input.query,
      options: products.slice(0, 5).map((product) => product.name),
      reason: "ambiguous_product_match",
      request_id: requestId,
    });
    return {
      ...needsInputToolError(summarizeAmbiguousProducts(products)),
      needs_clarification: summarizeAmbiguousProducts(products),
    };
  }

  const product = products[0];

  // Before size/temp/milk resolution, check if the query matches a variant name directly.
  // This handles products like "La Mesa de Leonor" where variants ARE the item names
  // (e.g. query "GALLETA CHOCOLATECHIP" → match variant "GALLETA CHOCOLATECHIP").
  const variantByName = chooseVariantByQuery(
    product.variants ?? [],
    input.query,
    product.name,
  );
  const resolvedVariant = variantByName
    ? {
      success: true as const,
      variant: variantByName,
      unitPrice: toNumber(variantByName.price),
    }
    : resolveVariant(product, variantFilters);

  if (!resolvedVariant.success) {
    slog("info", "add_to_cart_needs_variant_clarification", {
      query: input.query,
      product_name: product.name,
      clarification: resolvedVariant.needs_clarification ?? null,
      request_id: requestId,
    });
    return {
      ...needsInputToolError(
        resolvedVariant.needs_clarification ??
          "Necesito más detalle para encontrar la variante correcta.",
      ),
      needs_clarification: resolvedVariant.needs_clarification,
    };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const { cart: storedCart, version } = await readDraftCart(
      supabase,
      conversationId,
    );
    const seedCart = storedCart ??
      await getSeedDraftCartFromPartialOrder(supabase, customerId);
    const items = input.replace_cart ? [] : [...(seedCart?.items ?? [])];
    const variantName = resolvedVariant.variant?.name ?? null;
    const existingIndex = items.findIndex((item) =>
      item.product_id === product.id && item.variant_name === variantName
    );

    if (existingIndex >= 0) {
      items[existingIndex] = {
        ...items[existingIndex],
        quantity: items[existingIndex].quantity + quantity,
        unit_price: resolvedVariant.unitPrice,
      };
    } else {
      items.push({
        product_id: product.id,
        product_name: product.name,
        variant_name: variantName,
        quantity,
        unit_price: resolvedVariant.unitPrice,
      });
    }

    const cart = buildDraftCart(
      items,
      input.customer_note ?? seedCart?.customer_note ?? null,
    );
    const wrote = await writeDraftCart(supabase, conversationId, cart, version);
    if (!wrote) continue;

    return {
      success: true,
      summary_text: formatCartSummary(cart),
      customer_reply: formatCartSummary(cart),
      total: items.reduce(
        (sum, item) => sum + item.quantity * item.unit_price,
        0,
      ),
      item_count: items.reduce((sum, item) => sum + item.quantity, 0),
      cart_version: version + 1,
    };
  }

  return retryableToolError(
    "No pude actualizar el carrito en este momento. Intenta de nuevo.",
  );
}

async function editCart(
  supabase: any,
  businessId: string,
  conversationId: string,
  input: {
    action?: string;
    remove_query?: string;
    keep_query?: string;
    target_query?: string;
    size?: string;
    temp?: string;
    milk?: string;
  },
) {
  if (
    !input.action &&
    !input.remove_query &&
    !input.keep_query &&
    !input.target_query
  ) {
    return needsInputToolError(
      "¿Qué producto quieres quitar o dejar en el carrito?",
    );
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const { cart: storedCart, version } = await readDraftCart(
      supabase,
      conversationId,
    );
    const cart = storedCart ?? buildDraftCart([]);
    if (cart.items.length === 0) {
      return terminalToolError("No hay productos en el carrito para editar.");
    }

    if (input.action === "clear") {
      const wrote = await writeDraftCart(
        supabase,
        conversationId,
        null,
        version,
      );
      if (!wrote) continue;
      return {
        success: true,
        cart_empty: true,
        removed_count: cart.items.length,
        item_count: 0,
        customer_reply: "Listo, dejé tu carrito vacío. ¿Qué te gustaría pedir?",
      };
    }

    if (input.action === "update_options") {
      const targetQuery = input.target_query || input.remove_query ||
        input.keep_query || "";
      const matches = targetQuery
        ? cart.items.filter((item) => cartItemMatchesQuery(item, targetQuery))
        : cart.items.length === 1
        ? cart.items
        : [];

      if (matches.length === 0) {
        return needsInputToolError(
          `No encontré "${
            targetQuery || "ese producto"
          }" en el carrito. Tienes: ${
            cart.items.map(cartItemLabel).join(", ")
          }.`,
        );
      }
      if (matches.length > 1) {
        return needsInputToolError(
          `Tengo más de una línea que coincide con "${targetQuery}". ¿Cuál quieres cambiar? ${
            matches.map(cartItemLabel).join(", ")
          }.`,
        );
      }

      const target = matches[0];
      const { data: product } = await supabase
        .from("products")
        .select("id, name, price, variants, available")
        .eq("business_id", businessId)
        .eq("id", target.product_id)
        .maybeSingle();

      if (!product || product.available === false) {
        return retryableToolError(
          `El producto ${target.product_name} ya no está disponible.`,
          { tool: "search_menu", input: { query: target.product_name } },
        );
      }

      const existingFilters = filtersFromVariantName(target.variant_name);
      const nextFilters = {
        size: input.size ?? existingFilters.size,
        temp: input.temp ?? existingFilters.temp,
        milk: input.milk ?? existingFilters.milk,
      };
      const resolvedVariant = resolveVariant(
        product as ProductRecord,
        nextFilters,
      );
      if (!resolvedVariant.success) {
        return {
          ...needsInputToolError(
            resolvedVariant.needs_clarification ??
              "Necesito más detalle para cambiar esa opción.",
          ),
          needs_clarification: resolvedVariant.needs_clarification,
        };
      }

      const nextVariantName = resolvedVariant.variant?.name ?? null;
      const items = cart.items.map((item) =>
        item === target
          ? {
            ...item,
            variant_name: nextVariantName,
            unit_price: resolvedVariant.unitPrice,
          }
          : item
      );
      const nextCart = buildDraftCart(items, cart.customer_note ?? null);
      const wrote = await writeDraftCart(
        supabase,
        conversationId,
        nextCart,
        version,
      );
      if (!wrote) continue;

      return {
        success: true,
        cart_empty: false,
        removed_count: 0,
        summary_text: formatCartSummary(nextCart),
        customer_reply: formatCartSummary(nextCart),
        item_count: nextCart.items.reduce(
          (sum, item) => sum + item.quantity,
          0,
        ),
      };
    }

    const edit = editDraftCartItems(cart, input);
    if (edit.notFound) {
      return needsInputToolError(
        `No encontré "${edit.notFound}" en el carrito. Tienes: ${
          cart.items.map(cartItemLabel).join(", ")
        }.`,
      );
    }

    const nextCart = edit.cart.items.length > 0 ? edit.cart : null;
    const wrote = await writeDraftCart(
      supabase,
      conversationId,
      nextCart,
      version,
    );
    if (!wrote) continue;

    const removedText = edit.removed.length > 0
      ? `Quité ${edit.removed.map(cartItemLabel).join(", ")}. `
      : "";

    if (edit.keptMissing) {
      return {
        success: true,
        cart_empty: edit.cart.items.length === 0,
        removed_count: edit.removed.length,
        item_count: edit.cart.items.reduce(
          (sum, item) => sum + item.quantity,
          0,
        ),
        needs_clarification:
          `${removedText}Para dejar sólo ${edit.keptMissing}, dime cuál presentación o variante quieres.`,
        customer_reply:
          `${removedText}Para dejar sólo ${edit.keptMissing}, dime cuál presentación o variante quieres.`,
      };
    }

    if (edit.cart.items.length === 0) {
      return {
        success: true,
        cart_empty: true,
        removed_count: edit.removed.length,
        item_count: 0,
        customer_reply: `${removedText}Tu carrito quedó vacío.`,
      };
    }

    return {
      success: true,
      cart_empty: false,
      removed_count: edit.removed.length,
      summary_text: `${removedText}${formatCartSummary(edit.cart)}`,
      customer_reply: `${removedText}${formatCartSummary(edit.cart)}`,
      item_count: edit.cart.items.reduce(
        (sum, item) => sum + item.quantity,
        0,
      ),
    };
  }

  return retryableToolError(
    "No pude actualizar el carrito en este momento. Intenta de nuevo.",
  );
}

async function confirmOrder(
  supabase: any,
  businessId: string,
  customerId: string,
  conversationId: string,
  input: {
    pickup_person?: string;
    personal_message?: string;
    customer_note?: string;
  },
  customerPhone?: string,
) {
  const { cart, version } = await readDraftCart(supabase, conversationId);
  if (!cart || cart.items.length === 0) {
    return retryableToolError(
      "No hay productos en el carrito.",
      undefined,
      "Agrega un producto antes de confirmar tu pedido.",
    );
  }

  const detailsExtras: Record<string, unknown> = {};
  if (input.customer_note ?? cart.customer_note) {
    detailsExtras.customer_note = input.customer_note ?? cart.customer_note;
  }
  if (input.pickup_person) detailsExtras.pickup_person = input.pickup_person;
  if (input.personal_message) {
    detailsExtras.personal_message = input.personal_message;
  }

  const result = await createTransactionFromItems(
    supabase,
    businessId,
    customerId,
    cart.items,
    detailsExtras,
    customerPhone,
  );
  if (result.success === false) return result;
  const orderId = String(result.order_id);
  const total = Number(result.total ?? 0);

  // Verify that the KDS projection trigger ran and the order reached KDS.
  // The trigger is synchronous (AFTER INSERT), so if the transaction insert
  // succeeded, the ticket must exist. This check catches silent trigger failures
  // and makes the contract explicit: we only confirm to the customer after KDS
  // has the order.
  const { data: kdsTicket, error: kdsError } = await (supabase as any)
    .schema("kds")
    .from("tickets")
    .select("ticket_id")
    .eq("source_transaction_id", orderId)
    .maybeSingle();

  if (kdsError || !kdsTicket) {
    slog("error", "confirm_order_kds_not_reached", {
      order_id: orderId,
      kds_error: kdsError?.message ?? null,
      reason: kdsError
        ? "kds_query_error"
        : "kds_ticket_not_found_after_insert",
    });
    return {
      success: false,
      error: "Ocurrió un error con tu orden. Intenta después.",
      error_type: "retryable" as const,
    };
  }

  await writeDraftCart(supabase, conversationId, null, version);

  return {
    success: true,
    order_id: orderId,
    total,
    customer_reply: formatOrderCustomerReply(
      orderId,
      total,
      input.pickup_person,
    ),
    message: input.pickup_person
      ? `Orden creada exitosamente para ${input.pickup_person}. Total: ${
        formatMoney(total)
      }`
      : `Orden creada exitosamente. Total: ${formatMoney(total)}`,
  };
}

async function getRecentCustomerOrders(
  supabase: any,
  businessId: string,
  customerId: string,
  limit = 3,
) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 3, 5));
  const { data: orders } = await supabase
    .from("transactions")
    .select("id, status, total_amount, details, created_at")
    .eq("customer_id", customerId)
    .eq("business_id", businessId)
    .eq("transaction_type", "order")
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (!orders?.length) {
    return {
      found: 0,
      orders: [],
      message: "No encontré pedidos previos para este cliente.",
    };
  }

  const normalizedOrders = orders.map((order: any) => ({
    id: order.id,
    status: order.status,
    created_at: order.created_at,
    total: toNumber(order.total_amount),
    items: (order.details?.items ?? []).map((item: any) => ({
      product_name: item.product_name,
      quantity: item.quantity,
      variant_name: item.variant_name,
      unit_price: item.unit_price,
    })),
    customer_note: order.details?.customer_note ?? null,
    pickup_person: order.details?.pickup_person ?? null,
    personal_message: order.details?.personal_message ?? null,
  }));

  return {
    found: normalizedOrders.length,
    orders: normalizedOrders,
    message:
      `Encontré ${normalizedOrders.length} pedido(s) reciente(s) del cliente.`,
  };
}

async function getLastReusableOrder(
  supabase: any,
  businessId: string,
  customerId: string,
) {
  const { data: orders } = await supabase
    .from("transactions")
    .select("id, status, total_amount, details, created_at")
    .eq("customer_id", customerId)
    .eq("business_id", businessId)
    .eq("transaction_type", "order")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(5);

  return orders?.find((order: any) =>
    (order.details?.items ?? []).length > 0
  ) ?? null;
}

async function reorderLastOrder(
  supabase: any,
  businessId: string,
  customerId: string,
  customerNote?: string,
  customerPhone?: string,
) {
  const orderingCheck = await checkOrderingEnabled(supabase, businessId);
  if (!orderingCheck.enabled) {
    return terminalToolError(
      orderingCheck.disabledMessage ??
        "Los pedidos por WhatsApp están temporalmente pausados.",
    );
  }

  if (
    !await isWithinOrderHours(supabase, businessId, new Date(), customerPhone)
  ) {
    return terminalToolError(
      await getOrdersClosedMessage(supabase, businessId),
    );
  }

  const lastOrder = await getLastReusableOrder(
    supabase,
    businessId,
    customerId,
  );
  if (!lastOrder) {
    return terminalToolError(
      "No encontré una orden previa reutilizable para repetir.",
    );
  }

  const items: DraftCartItem[] = (lastOrder.details?.items ?? []).map((
    item: any,
  ) => ({
    product_id: item.product_id,
    product_name: item.product_name,
    variant_name: item.variant_name ?? null,
    quantity: item.quantity,
    unit_price: item.unit_price,
  }));

  if (!items.length) {
    return terminalToolError(
      "No encontré una orden previa reutilizable para repetir.",
    );
  }

  const detailsExtras: Record<string, unknown> = {};
  const note = customerNote ?? lastOrder.details?.customer_note;
  if (note) detailsExtras.customer_note = note;
  if (lastOrder.details?.pickup_person) {
    detailsExtras.pickup_person = lastOrder.details.pickup_person;
    if (lastOrder.details?.personal_message) {
      detailsExtras.personal_message = lastOrder.details.personal_message;
    }
  }

  const result = await createTransactionFromItems(
    supabase,
    businessId,
    customerId,
    items,
    detailsExtras,
    customerPhone,
  );
  if (result.success === false) return result;
  const orderId = String(result.order_id);
  const total = Number(result.total ?? 0);

  const { data: kdsTicket, error: kdsError } = await (supabase as any)
    .schema("kds")
    .from("tickets")
    .select("ticket_id")
    .eq("source_transaction_id", orderId)
    .maybeSingle();

  if (kdsError || !kdsTicket) {
    slog("error", "reorder_kds_not_reached", {
      order_id: orderId,
      kds_error: kdsError?.message ?? null,
      reason: kdsError
        ? "kds_query_error"
        : "kds_ticket_not_found_after_insert",
    });
    return {
      success: false,
      error: "Ocurrió un error con tu orden. Intenta después.",
      error_type: "retryable" as const,
    };
  }

  return {
    success: true,
    order_id: orderId,
    total,
    customer_reply: formatOrderCustomerReply(
      orderId,
      total,
      lastOrder.details?.pickup_person,
    ),
    message: `Orden repetida exitosamente. Total: ${formatMoney(total)}`,
  };
}

async function cancelOrder(
  supabase: any,
  businessId: string,
  customerId: string,
  reason: string,
) {
  const partialOrder = await getActivePartialCancelledOrder(
    supabase,
    customerId,
  );
  if (partialOrder) {
    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      return terminalToolError(
        "Necesito el motivo para cancelar el pedido completo.",
      );
    }

    const { data: partialTxn, error: partialError } = await supabase
      .from("transactions")
      .select("id, details")
      .eq("id", partialOrder.sourceTransactionID)
      .maybeSingle();

    if (partialError || !partialTxn?.id) {
      return retryableToolError(
        "No pude encontrar el pedido parcialmente cancelado para cerrarlo.",
      );
    }

    const updatedDetails = {
      ...(partialTxn.details ?? {}),
      cancellation_reason: trimmedReason,
    };
    delete (updatedDetails as Record<string, unknown>)
      .partial_cancellation_reason;

    const { error: updateError } = await supabase
      .from("transactions")
      .update({
        status: "cancelled",
        details: updatedDetails,
      })
      .eq("id", partialTxn.id);

    if (updateError) {
      return retryableToolError(
        "No pude cancelar el pedido en este momento. Intenta de nuevo.",
      );
    }

    const replyBody =
      `Tu pedido fue cancelado exitosamente.\nMotivo: ${trimmedReason}`;
    return {
      success: true,
      order_id: partialTxn.id,
      customer_reply: replyBody,
      message: replyBody,
    };
  }

  const [{ data: orders }] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, status, total_amount, details, created_at")
      .eq("customer_id", customerId)
      .eq("business_id", businessId)
      .eq("transaction_type", "order")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (!orders?.length) {
    return terminalToolError(
      "No encontré ningún pedido activo para tu cuenta.",
    );
  }

  const pendingOrder = orders.find((order: any) => order.status === "pending");
  if (!pendingOrder) {
    const statusMap: Record<string, string> = {
      in_progress: "ya está siendo preparado y no puede cancelarse",
      ready: "ya está listo para recoger",
      completed: "ya fue entregado",
      cancelled: "ya estaba cancelado",
    };
    const latestStatus = orders[0].status;
    const statusMsg = statusMap[latestStatus] ??
      `está en estado "${latestStatus}"`;
    return terminalToolError(
      `Tu pedido ${statusMsg}. Si necesitas ayuda, comunícate directamente con el café.`,
    );
  }

  const updatedDetails = {
    ...pendingOrder.details,
    cancellation_reason: reason,
  };
  await supabase
    .from("transactions")
    .update({ status: "cancelled", details: updatedDetails })
    .eq("id", pendingOrder.id);

  const trimmedReason = reason?.trim();
  const replyBody = trimmedReason
    ? `Tu pedido fue cancelado exitosamente.\nMotivo: ${trimmedReason}`
    : "Tu pedido fue cancelado exitosamente.";

  return {
    success: true,
    order_id: pendingOrder.id,
    customer_reply: replyBody,
    message: replyBody,
  };
}

async function confirmOrderChanges(
  supabase: any,
  businessId: string,
  customerId: string,
  conversationId: string,
) {
  const partialOrder = await getActivePartialCancelledOrder(
    supabase,
    customerId,
  );
  if (!partialOrder) {
    return terminalToolError(
      "No encontré cambios pendientes por confirmar en tu pedido.",
    );
  }

  const { cart, version } = await readDraftCart(supabase, conversationId);
  if (cart?.items?.length) {
    const validation = await validateDraftCartItems(
      supabase,
      businessId,
      cart.items,
    );
    if (validation.success === false) {
      return validation;
    }

    const { data: partialTxn, error: partialTxnError } = await supabase
      .from("transactions")
      .select("id, details")
      .eq("id", partialOrder.sourceTransactionID)
      .maybeSingle();

    if (partialTxnError || !partialTxn?.id) {
      return retryableToolError(
        "No pude actualizar el pedido parcialmente cancelado en este momento.",
      );
    }

    const updatedDetails = {
      ...(partialTxn.details ?? {}),
      items: mergePartialCancelledItems(partialTxn.details, validation.items),
      customer_note: cart.customer_note ?? partialTxn.details?.customer_note ??
        null,
    };

    const { error: updateError } = await supabase
      .from("transactions")
      .update({
        details: updatedDetails,
        total_amount: validation.total,
      })
      .eq("id", partialTxn.id);

    if (updateError) {
      return retryableToolError(
        "No pude aplicar los cambios al pedido en este momento.",
      );
    }
  }

  const rpcClient = typeof (supabase as any).schema === "function"
    ? (supabase as any).schema("kds")
    : supabase;
  const { error } = await rpcClient.rpc("confirm_partial_cancellation", {
    p_ticket_id: partialOrder.ticketID,
    p_actor_source: "whatsapp_bot",
    p_actor_id: customerId,
    p_actor_channel: "whatsapp",
  });

  if (error) {
    return retryableToolError(
      "No pude confirmar los cambios de tu pedido en este momento.",
    );
  }

  await writeDraftCart(supabase, conversationId, null, version);

  return {
    success: true,
    order_id: partialOrder.sourceTransactionID,
    customer_reply: "¡Perfecto! Tu pedido actualizado está en cocina.",
    message: "Cambios confirmados para el pedido parcialmente cancelado.",
  };
}
