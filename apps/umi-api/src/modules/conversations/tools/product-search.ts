import {
  MILK_SYNONYMS,
  normalizeSynonymText,
  SIZE_SYNONYMS,
  TEMP_SYNONYMS,
} from '../synonyms';
import type { DraftCart, DraftCartItem } from '../conversation.types';

/**
 * Pure product-search / variant-resolution / cart-format helpers. Verbatim port
 * of the pure half of `whatsapp-handler/tools.ts` (behavior-fidelity carry-over,
 * preflight §7). Money is in PESOS throughout (legacy unit) — the products repo
 * maps `price_cents → pesos` and keeps Zettle variant prices as-is; the pesos→
 * centavos conversion happens once, at the order-write boundary (orders repo).
 */

export interface ProductVariant {
  sku?: string | null;
  name: string;
  price: number | string;
}

export interface ProductRecord {
  id: string;
  name: string;
  price: number | string;
  description?: string | null;
  category?: string | null;
  variants?: ProductVariant[] | null;
}

export interface VariantFilters {
  size?: string;
  temp?: string;
  milk?: string;
}

export const MENU_BROWSE_QUERY = /^(menu|menú|categorias|categorías|todo)$/i;

export const BROWSE_INTENT_CATEGORIES: Array<{ pattern: RegExp; categories: string[] }> = [
  {
    pattern: /\b(comida|comer|almuerzo|desayuno|sandwich|baguette|pan|snack|snacks|hambre)\b/i,
    categories: ['Alimentos', 'snacks'],
  },
  {
    pattern: /\b(postre|postres|dulce|dulces|galleta|oblea|gomita)\b/i,
    categories: ['POSTRES', 'snacks'],
  },
  { pattern: /\b(bebida|bebidas|tomar|sed)\b/i, categories: ['Cafe', 'Matcha', 'Sin cafe', 'otras bebidas'] },
  { pattern: /\b(cafe|café)\b/i, categories: ['Cafe'] },
  { pattern: /\b(matcha)\b/i, categories: ['Matcha'] },
  {
    pattern: /\b(sin\s*cafe|sin\s*café|no\s*cafe|descafeinado)\b/i,
    categories: ['Sin cafe', 'otras bebidas'],
  },
];

export const INTERNAL_ONLY_CATEGORIES = new Set([
  'Sin categoría',
  'OTROS',
  'RENTA ESPACIOS',
  'MERCH',
]);

export function resolveBrowseIntent(query: string): {
  isBrowse: boolean;
  categoryFilter?: string[];
} {
  if (MENU_BROWSE_QUERY.test(query.trim())) return { isBrowse: true };
  const normalized = normalizeText(query);
  for (const entry of BROWSE_INTENT_CATEGORIES) {
    if (entry.pattern.test(normalized)) {
      return { isBrowse: true, categoryFilter: entry.categories };
    }
  }
  return { isBrowse: false };
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const curr = [i + 1];
    for (let j = 0; j < b.length; j++) {
      curr.push(a[i] === b[j] ? prev[j] : 1 + Math.min(prev[j], prev[j + 1], curr[j]));
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}

export function normalizeText(value: string): string {
  return normalizeSynonymText(value);
}

function singularizeToken(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('es') && token.length > 5 && !token.endsWith('tes')) {
    return token.slice(0, -2);
  }
  if (token.endsWith('s') && token.length > 4) return token.slice(0, -1);
  return token;
}

function tokenizeSearchQuery(query: string): string[] {
  return normalizeText(query)
    .split(' ')
    .map((token) => singularizeToken(token))
    .filter(Boolean);
}

function buildSearchQueryCandidates(query: string): string[] {
  const normalized = normalizeText(query);
  const tokens = tokenizeSearchQuery(query);
  const candidates = new Set<string>();
  if (normalized) candidates.add(normalized);
  if (tokens.length > 0) {
    candidates.add(tokens.join(' '));
    candidates.add([...tokens].sort().join(' '));
  }
  return [...candidates].filter(Boolean);
}

export function toNumber(value: number | string | null | undefined): number {
  const num = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function titleCaseVariantToken(token: string): string {
  return token
    .toLowerCase()
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function displayVariantName(name: string | null): string | null {
  if (!name) return null;
  return name
    .split(',')
    .map((part) => titleCaseVariantToken(part.trim()))
    .join(', ');
}

const VARIANT_FILLER_WORDS = new Set([
  'de', 'con', 'en', 'las', 'la', 'los', 'el', 'un', 'una', 'a', 'al', 'leche',
]);

export function normalizeVariantPreference(
  kind: 'size' | 'temp' | 'milk',
  value?: string | null,
): string | null {
  if (!value) return null;
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const dict =
    kind === 'size' ? SIZE_SYNONYMS : kind === 'temp' ? TEMP_SYNONYMS : MILK_SYNONYMS;
  if (dict[normalized]) return dict[normalized];
  const tokens = normalized.split(' ').filter(Boolean);
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

export function buildStrippedSearchQuery(
  query: string,
  size?: string | null,
  temp?: string | null,
  milk?: string | null,
): string | null {
  if (!size && !temp && !milk) return null;
  const tokens = normalizeText(query).split(' ').filter(Boolean);
  // Allow 2-token queries ("latte grande", "matcha coco") to strip-and-retry; the
  // later "no removable token" / "stripped empty" checks still reject
  // modifier-only inputs, so this no longer blocks legitimate product+modifier.
  if (tokens.length < 2) return null;

  const toRemove = new Set<string>();
  const addSyn = (dict: Record<string, string>, canonical: string | null) => {
    if (!canonical) return;
    Object.entries(dict).forEach(([k, v]) => {
      if (v === canonical) toRemove.add(k);
    });
  };
  if (size) addSyn(SIZE_SYNONYMS, normalizeVariantPreference('size', size));
  if (temp) addSyn(TEMP_SYNONYMS, normalizeVariantPreference('temp', temp));
  if (milk) addSyn(MILK_SYNONYMS, normalizeVariantPreference('milk', milk));

  if (!tokens.some((t) => toRemove.has(t))) return null;
  const stripped = tokens.filter((t) => !toRemove.has(t) && !VARIANT_FILLER_WORDS.has(t));
  if (stripped.length === 0) return null;
  const result = stripped.join(' ');
  return result === tokens.join(' ') ? null : result;
}

export function inferVariantFiltersFromText(
  text: string,
  provided: VariantFilters = {},
): VariantFilters {
  const normalized = normalizeText(text);
  const inferred: VariantFilters = {
    size: normalizeVariantPreference('size', provided.size) ?? undefined,
    temp: normalizeVariantPreference('temp', provided.temp) ?? undefined,
    milk: normalizeVariantPreference('milk', provided.milk) ?? undefined,
  };
  if (!inferred.size) inferred.size = normalizeVariantPreference('size', normalized) ?? undefined;
  if (!inferred.temp) inferred.temp = normalizeVariantPreference('temp', normalized) ?? undefined;
  if (!inferred.milk) inferred.milk = normalizeVariantPreference('milk', normalized) ?? undefined;
  return inferred;
}

interface RankedProductMatch {
  product: ProductRecord;
  score: number;
}

function scoreProductMatch(product: ProductRecord, query: string): number {
  const normalizedName = normalizeText(product.name);
  const nameTokens = normalizedName.split(' ').filter(Boolean);
  const queryCandidates = buildSearchQueryCandidates(query);
  const queryTokens = tokenizeSearchQuery(query);
  let bestScore = 0;

  for (const candidate of queryCandidates) {
    if (!candidate) continue;
    if (normalizedName === candidate) bestScore = Math.max(bestScore, 180);
    else if (normalizedName.startsWith(candidate)) bestScore = Math.max(bestScore, 160);
    else if (candidate.includes(normalizedName)) bestScore = Math.max(bestScore, 150);
    else if (normalizedName.includes(candidate)) bestScore = Math.max(bestScore, 130);
  }

  if (queryTokens.length > 0) {
    const exactTokenCoverage = queryTokens.every((token) => nameTokens.includes(token));
    const looseTokenCoverage = queryTokens.every((token) => normalizedName.includes(token));
    if (exactTokenCoverage) {
      bestScore = Math.max(bestScore, 118 - Math.max(0, nameTokens.length - queryTokens.length));
    } else if (looseTokenCoverage) {
      bestScore = Math.max(bestScore, 100 - Math.max(0, nameTokens.length - queryTokens.length));
    } else {
      const fuzzyTokenCoverage = queryTokens.every((qt) =>
        nameTokens.some((nt) => levenshteinDistance(qt, nt) <= 1),
      );
      if (fuzzyTokenCoverage) {
        bestScore = Math.max(bestScore, 90 - Math.max(0, nameTokens.length - queryTokens.length));
      }
    }
  }

  const variantScore = Math.max(
    0,
    ...(product.variants ?? []).map((variant) =>
      scoreVariantNameMatch(variant.name, query, product.name),
    ),
  );
  return Math.max(bestScore, variantScore);
}

function canonicalizeVariantSearchText(value: string, productName?: string): string {
  const productTokens = new Set(productName ? tokenizeSearchQuery(productName) : []);
  return normalizeText(value)
    .split(' ')
    .filter(Boolean)
    .filter((token) => !VARIANT_FILLER_WORDS.has(token))
    .map(
      (token) =>
        normalizeVariantPreference('size', token)?.toLowerCase() ??
        normalizeVariantPreference('temp', token)?.toLowerCase() ??
        normalizeVariantPreference('milk', token)?.toLowerCase() ??
        singularizeToken(token),
    )
    .filter((token) => !productTokens.has(token))
    .join(' ');
}

function scoreVariantNameMatch(variantName: string, query: string, productName?: string): number {
  const normalizedVariant = canonicalizeVariantSearchText(variantName);
  const variantTokens = normalizedVariant.split(' ').filter(Boolean);
  const normalizedQuery = canonicalizeVariantSearchText(query, productName);
  const queryCandidates = buildSearchQueryCandidates(normalizedQuery);
  const queryTokens = tokenizeSearchQuery(normalizedQuery);
  let bestScore = 0;

  for (const candidate of queryCandidates) {
    if (!candidate) continue;
    if (normalizedVariant === candidate) bestScore = Math.max(bestScore, 160);
    else if (normalizedVariant.includes(candidate)) bestScore = Math.max(bestScore, 145);
  }

  if (queryTokens.length > 0) {
    const exactTokenCoverage = queryTokens.every((queryToken) =>
      variantTokens.includes(queryToken),
    );
    const tokenCoverage = queryTokens.every((queryToken) =>
      variantTokens.some(
        (variantToken) =>
          variantToken.includes(queryToken) ||
          levenshteinDistance(queryToken, variantToken) <= (queryToken.length >= 7 ? 2 : 1),
      ),
    );
    if (exactTokenCoverage) {
      bestScore = Math.max(bestScore, 140 - Math.max(0, variantTokens.length - queryTokens.length));
    } else if (tokenCoverage) {
      bestScore = Math.max(bestScore, 120 - Math.max(0, variantTokens.length - queryTokens.length));
    }
  }

  const hasWaterStyle = queryTokens.includes('mineral') || queryTokens.includes('natural');
  const hasFlavor = queryTokens.some((token) =>
    ['lavanda', 'rosa', 'frambuesa', 'matcha', 'cherry', 'simple'].includes(token),
  );
  if (hasWaterStyle && !hasFlavor && variantTokens.includes('simple')) bestScore += 20;
  return bestScore;
}

export function chooseVariantByQuery(
  variants: ProductVariant[],
  query: string,
  productName?: string,
): ProductVariant | null {
  const ranked = variants
    .map((variant) => ({ variant, score: scoreVariantNameMatch(variant.name, query, productName) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  if (ranked[0].score < 100) return null;
  if (ranked[1] && ranked[0].score < ranked[1].score + 15) return null;
  return ranked[0].variant;
}

function rankProductsByQuery(products: ProductRecord[], query: string): RankedProductMatch[] {
  return products
    .map((product) => ({ product, score: scoreProductMatch(product, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const lw = normalizeText(left.product.name).split(' ').filter(Boolean).length;
      const rw = normalizeText(right.product.name).split(' ').filter(Boolean).length;
      if (rw !== lw) return rw - lw;
      return left.product.name.localeCompare(right.product.name);
    });
}

export function rankProducts(products: ProductRecord[], query: string): ProductRecord[] {
  return rankProductsByQuery(products, query).map((entry) => entry.product);
}

function splitVariantTokens(variantName: string): string[] {
  return variantName
    .split(',')
    .map((part) => normalizeText(part).toUpperCase())
    .filter(Boolean);
}

function filtersFromVariantName(variantName: string | null): VariantFilters {
  if (!variantName) return {};
  const tokens = splitVariantTokens(variantName);
  const canonicalMilks = Object.values(MILK_SYNONYMS) as string[];
  const size = tokens.find((token) => token === 'CH' || token === 'GDE');
  const temp = tokens.find(
    (token) => token === 'CALIENTE' || token === 'ROCAS' || token === 'FRAPPE',
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
    normalizeVariantPreference('size', filters.size),
    normalizeVariantPreference('temp', filters.temp),
    normalizeVariantPreference('milk', filters.milk),
  ].filter((token): token is string => !!token);
}

function collectSupportedVariantTokens(variants: ProductVariant[]): {
  size: Set<string>;
  temp: Set<string>;
  milk: Set<string>;
} {
  const canonicalMilks = new Set(Object.values(MILK_SYNONYMS) as string[]);
  const supported = { size: new Set<string>(), temp: new Set<string>(), milk: new Set<string>() };
  for (const variant of variants) {
    for (const token of splitVariantTokens(variant.name)) {
      if (token === 'CH' || token === 'GDE') supported.size.add(token);
      if (token === 'CALIENTE' || token === 'ROCAS' || token === 'FRAPPE') supported.temp.add(token);
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
  const normalizedSize = normalizeVariantPreference('size', filters.size);
  const normalizedTemp = normalizeVariantPreference('temp', filters.temp);
  const normalizedMilk = normalizeVariantPreference('milk', filters.milk);
  return {
    ...(normalizedSize && supported.size.has(normalizedSize) ? { size: normalizedSize } : {}),
    ...(normalizedTemp && supported.temp.has(normalizedTemp) ? { temp: normalizedTemp } : {}),
    ...(normalizedMilk && supported.milk.has(normalizedMilk) ? { milk: normalizedMilk } : {}),
  };
}

function buildVariantClarification(filters: VariantFilters, variants: ProductVariant[]): string {
  const sizeProvided = !!normalizeVariantPreference('size', filters.size);
  const tempProvided = !!normalizeVariantPreference('temp', filters.temp);
  const milkProvided = !!normalizeVariantPreference('milk', filters.milk);

  if (!sizeProvided) {
    const sizes = [
      ...new Set(
        variants
          .flatMap((variant) => splitVariantTokens(variant.name))
          .filter((token) => token === 'CH' || token === 'GDE'),
      ),
    ];
    if (sizes.length > 1) return '¿Qué tamano prefieres: Chico o Grande?';
  }
  if (!tempProvided) {
    const temps = [
      ...new Set(
        variants
          .flatMap((variant) => splitVariantTokens(variant.name))
          .filter((token) => token === 'CALIENTE' || token === 'ROCAS' || token === 'FRAPPE'),
      ),
    ];
    if (temps.length > 1) return '¿Cómo lo prefieres: Caliente, Rocas o Frappe?';
  }
  if (!milkProvided) {
    const canonicalMilks = Object.values(MILK_SYNONYMS) as string[];
    const milks = [
      ...new Set(
        variants
          .flatMap((variant) => splitVariantTokens(variant.name))
          .filter((token) => canonicalMilks.includes(token)),
      ),
    ];
    if (milks.length > 1) {
      return '¿Qué leche prefieres: Deslactosada, Almendra, Coco, Avena o Soya?';
    }
  }
  return 'Necesito un poco más de detalle para encontrar la variante correcta.';
}

export type ResolvedVariant =
  | { success: true; variant: ProductVariant | null; unitPrice: number }
  | { success: false; needs_clarification: string };

export function resolveVariant(product: ProductRecord, filters: VariantFilters): ResolvedVariant {
  const variants = product.variants ?? [];
  if (!variants.length) {
    return { success: true, variant: null, unitPrice: toNumber(product.price) };
  }
  const sanitizedFilters = sanitizeVariantFilters(variants, filters);
  const requirements = buildVariantRequirements(sanitizedFilters);
  let candidates = variants;
  if (requirements.length > 0) {
    candidates = variants.filter((variant) =>
      requirements.every((token) => hasToken(variant.name, token)),
    );
  }
  if (candidates.length === 1) {
    return { success: true, variant: candidates[0], unitPrice: toNumber(candidates[0].price) };
  }
  if (candidates.length > 1) {
    const optionKey = (variant: ProductVariant) => {
      const f = filtersFromVariantName(variant.name);
      return [f.size ?? '', f.temp ?? '', f.milk ?? ''].join('|');
    };
    const firstKey = optionKey(candidates[0]);
    const sameKnownOptions = candidates.every((candidate) => optionKey(candidate) === firstKey);
    if (sameKnownOptions) {
      const defaultCandidate = [...candidates].sort(
        (left, right) => toNumber(left.price) - toNumber(right.price),
      )[0];
      return {
        success: true,
        variant: defaultCandidate,
        unitPrice: toNumber(defaultCandidate.price),
      };
    }
  }
  return { success: false, needs_clarification: buildVariantClarification(sanitizedFilters, variants) };
}

export function formatMoney(value: number): string {
  // Snap to centavos and keep fractional pesos (Zettle prices like 28.50) instead
  // of rounding them away; whole-peso amounts stay integer ($28, not $28.00).
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
}

export function formatCartSummary(cart: DraftCart): string {
  const lines = ['📋 *Resumen de tu pedido:*'];
  let total = 0;
  for (const item of cart.items) {
    const lineTotal = item.quantity * item.unit_price;
    total += lineTotal;
    const variantLabel = displayVariantName(item.variant_name);
    lines.push(
      `• ${item.quantity}x ${item.product_name}${variantLabel ? ` (${variantLabel})` : ''} — ${formatMoney(lineTotal)}`,
    );
  }
  lines.push(`💰 *Total: ${formatMoney(total)}*`);
  if (cart.customer_note) lines.push(`📝 *Nota:* ${cart.customer_note}`);
  lines.push('¿Confirmas? ✅');
  return lines.join('\n');
}

export function cartItemLabel(item: DraftCartItem): string {
  const variantLabel = displayVariantName(item.variant_name);
  return `${item.product_name}${variantLabel ? ` (${variantLabel})` : ''}`;
}

function cartItemMatchesQuery(item: DraftCartItem, query: string): boolean {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return false;
  const itemText = normalizeText(`${item.product_name} ${item.variant_name ?? ''}`);
  if (itemText.includes(normalizedQuery)) return true;
  const queryTokens = normalizedQuery.split(' ').filter((token) => token.length > 2);
  const itemTokens = itemText.split(' ').filter((token) => token.length > 2);
  return queryTokens.some((queryToken) =>
    itemTokens.some(
      (itemToken) =>
        itemToken.includes(queryToken) ||
        queryToken.includes(itemToken) ||
        levenshteinDistance(queryToken, itemToken) <= 1,
    ),
  );
}

export { cartItemMatchesQuery, filtersFromVariantName };

export function editDraftCartItems(
  cart: DraftCart,
  input: { remove_query?: string | null; keep_query?: string | null },
): { cart: DraftCart; removed: DraftCartItem[]; keptMissing: string | null; notFound: string | null } {
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
    keptMissing:
      keepQuery && !cart.items.some((item) => cartItemMatchesQuery(item, keepQuery))
        ? keepQuery
        : null,
    notFound: removeQuery && removed.length === 0 ? removeQuery : null,
  };
}

export function getRepresentativeVariants(variants: ProductVariant[], limit = 8): ProductVariant[] {
  const seen = new Set<string>();
  const picked: ProductVariant[] = [];
  for (const variant of variants) {
    const key = splitVariantTokens(variant.name).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(variant);
    if (picked.length >= limit) break;
  }
  return picked;
}

function variantHasOptionTokens(variant: ProductVariant): boolean {
  const tokens = splitVariantTokens(variant.name);
  return tokens.some(
    (token) =>
      token === 'CH' ||
      token === 'GDE' ||
      token === 'CALIENTE' ||
      token === 'ROCAS' ||
      token === 'FRAPPE' ||
      (Object.values(MILK_SYNONYMS) as string[]).includes(token),
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
    const description = product.description ? ` — ${product.description}` : '';
    return `${product.name}${description}\n  Precio: ${formatMoney(toNumber(product.price))}`;
  }

  const sizeToken = normalizeVariantPreference('size', sizeFilter);
  const tempToken = normalizeVariantPreference('temp', tempFilter);
  const milkToken = normalizeVariantPreference('milk', milkFilter);
  const filteredVariants = variants.filter((variant) => {
    if (sizeToken && !hasToken(variant.name, sizeToken)) return false;
    if (tempToken && !hasToken(variant.name, tempToken)) return false;
    if (milkToken && !hasToken(variant.name, milkToken)) return false;
    return true;
  });
  const scoped = filteredVariants.length > 0 ? filteredVariants : variants;

  if (variantsAreNamedItems(scoped)) {
    const lines = [`${product.name}${product.description ? ` — ${product.description}` : ''}`];
    for (const variant of scoped.slice(0, 12)) {
      lines.push(`  • ${variant.name.trim()} — ${formatMoney(toNumber(variant.price))}`);
    }
    if (scoped.length > 12) lines.push(`  • Y ${scoped.length - 12} más`);
    return lines.join('\n');
  }

  const sizePrices = new Map<string, number[]>();
  const temps = new Set<string>();
  const milks = new Set<string>();
  for (const variant of scoped) {
    const tokens = splitVariantTokens(variant.name);
    const size = tokens.find((token) => token === 'CH' || token === 'GDE');
    const temp = tokens.find(
      (token) => token === 'CALIENTE' || token === 'ROCAS' || token === 'FRAPPE',
    );
    const milk = tokens.find((token) => (Object.values(MILK_SYNONYMS) as string[]).includes(token));
    const price = toNumber(variant.price);
    if (size) {
      if (!sizePrices.has(size)) sizePrices.set(size, []);
      sizePrices.get(size)!.push(price);
    }
    if (temp) temps.add(temp);
    if (milk) milks.add(milk);
  }

  const sizeLine = ['CH', 'GDE']
    .filter((size) => sizePrices.has(size))
    .map((size) => {
      const prices = sizePrices.get(size)!;
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      return `${size}: ${min === max ? formatMoney(min) : `${formatMoney(min)}-${formatMoney(max)}`}`;
    })
    .join(' | ');

  const tempMap: Record<string, string> = { CALIENTE: 'Caliente', ROCAS: 'Rocas', FRAPPE: 'Frappe' };
  const milkMap: Record<string, string> = {
    DESLACTOSADA: 'Deslactosada',
    ALMENDRA: 'Almendra',
    COCO: 'Coco',
    AVENA: 'Avena',
    SOYA: 'Soya',
  };

  const lines = [`${product.name}${product.description ? ` — ${product.description}` : ''}`];
  if (sizeLine) lines.push(`  ${sizeLine}`);
  if (temps.size > 0) {
    lines.push(
      `  ${['CALIENTE', 'ROCAS', 'FRAPPE'].filter((token) => temps.has(token)).map((token) => tempMap[token]).join(' · ')}`,
    );
  }
  if (milks.size > 0) {
    lines.push(
      `  Leches: ${Object.keys(milkMap).filter((token) => milks.has(token)).map((token) => milkMap[token]).join(', ')}`,
    );
  }
  return lines.join('\n');
}

export function chooseBestProductMatch(products: ProductRecord[], query: string): ProductRecord[] {
  const ranked = rankProductsByQuery(products, query);
  if (ranked.length === 0) return products;
  if (ranked.length === 1) return [ranked[0].product];

  const topScore = ranked[0].score;
  const secondScore = ranked[1].score;
  const queryTokens = tokenizeSearchQuery(query);

  if (topScore >= 140 || topScore >= secondScore + 15) return [ranked[0].product];

  const band = ranked.filter((entry) => entry.score >= Math.max(90, topScore - 5));
  if (queryTokens.length <= 1 && topScore < 140) {
    return band.slice(0, 3).map((entry) => entry.product);
  }
  if (band.length === 1) return [band[0].product];
  return band.slice(0, 5).map((entry) => entry.product);
}

export function buildDraftCart(items: DraftCartItem[], customerNote?: string | null): DraftCart {
  return { items, updated_at: new Date().toISOString(), customer_note: customerNote ?? null };
}

export function normalizeDraftCartItem(item: unknown): DraftCartItem | null {
  const i = item as Record<string, unknown>;
  if (!i?.product_id || !i?.product_name) return null;
  return {
    product_id: String(i.product_id),
    product_name: String(i.product_name),
    variant_name: i.variant_name ? String(i.variant_name) : null,
    quantity: Math.max(1, Number(i.quantity) || 1),
    unit_price: toNumber(i.unit_price as number),
  };
}

export function summarizeAmbiguousProducts(products: ProductRecord[]): string {
  const labels = products.slice(0, 3).map((product) => {
    const suffix = product.description ? ` (${product.description})` : '';
    return `${product.name}${suffix}`;
  });
  if (labels.length === 1) return `¿Te refieres a ${labels[0]}?`;
  if (labels.length === 2) return `¿Quieres ${labels[0]} o ${labels[1]}?`;
  return `Encontré varias opciones: ${labels.join(', ')}. ¿Cuál prefieres?`;
}

export function priceRangeForProduct(product: ProductRecord): { min: number; max: number } {
  const variants = product.variants ?? [];
  if (!variants.length) {
    const price = toNumber(product.price);
    return { min: price, max: price };
  }
  const prices = variants.map((variant) => toNumber(variant.price));
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

export function formatOrderCustomerReply(
  orderId: string,
  total: number,
  pickupPerson?: string,
): string {
  const pickupLine = pickupPerson ? `🙋 *Recoge:* ${pickupPerson}\n` : '';
  return [
    '¡Listo! Tu orden está confirmada. 🎉',
    '',
    `📋 *Número de orden:* \`${orderId}\``,
    `💰 *Total:* ${formatMoney(total)}`,
    pickupLine.trimEnd(),
    '',
    'Gracias por tu compra. ¡Nos vemos pronto! 😊',
  ]
    .filter(Boolean)
    .join('\n');
}
