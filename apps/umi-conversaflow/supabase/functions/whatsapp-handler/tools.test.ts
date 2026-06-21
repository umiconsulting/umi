import "./tools_test_bootstrap.ts";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  buildStrippedSearchQuery,
  chooseBestProductMatch,
  chooseVariantByQuery,
  editDraftCartItems,
  formatProductDisplay,
  inferVariantFiltersFromText,
  mergePartialCancelledItems,
  normalizeVariantPreference,
  resolveVariant,
} from "./tools.ts";

Deno.test("normalizeVariantPreference normalizes size aliases", () => {
  if (normalizeVariantPreference("size", "grande") !== "GDE") {
    throw new Error("expected grande -> GDE");
  }
  if (normalizeVariantPreference("size", "gde") !== "GDE") {
    throw new Error("expected gde -> GDE");
  }
  if (normalizeVariantPreference("size", "chico") !== "CH") {
    throw new Error("expected chico -> CH");
  }
  if (normalizeVariantPreference("size", "ch") !== "CH") {
    throw new Error("expected ch -> CH");
  }
  if (normalizeVariantPreference("size", "chicp") !== "CH") {
    throw new Error("expected chicp -> CH");
  }
});

Deno.test("normalizeVariantPreference normalizes temperature aliases", () => {
  if (normalizeVariantPreference("temp", "frappe") !== "FRAPPE") {
    throw new Error("expected frappe -> FRAPPE");
  }
  if (normalizeVariantPreference("temp", "frappé") !== "FRAPPE") {
    throw new Error("expected frappé -> FRAPPE");
  }
  if (normalizeVariantPreference("temp", "caliente") !== "CALIENTE") {
    throw new Error("expected caliente -> CALIENTE");
  }
  if (normalizeVariantPreference("temp", "frio") !== "ROCAS") {
    throw new Error("expected frio -> ROCAS");
  }
  if (normalizeVariantPreference("temp", "rocas") !== "ROCAS") {
    throw new Error("expected rocas -> ROCAS");
  }
});

Deno.test("normalizeVariantPreference normalizes milk aliases", () => {
  if (normalizeVariantPreference("milk", "avena") !== "AVENA") {
    throw new Error("expected avena -> AVENA");
  }
  if (normalizeVariantPreference("milk", "almendra") !== "ALMENDRA") {
    throw new Error("expected almendra -> ALMENDRA");
  }
  if (normalizeVariantPreference("milk", "coco") !== "COCO") {
    throw new Error("expected coco -> COCO");
  }
  if (normalizeVariantPreference("milk", "deslactosada") !== "DESLACTOSADA") {
    throw new Error("expected deslactosada -> DESLACTOSADA");
  }
  if (normalizeVariantPreference("milk", "soya") !== "SOYA") {
    throw new Error("expected soya -> SOYA");
  }
});

/** Names do not start with "latte" alone so substring matches tie (no startsWith boost). */
const PRODUCTS_LATTE_AMBIGUOUS = [
  {
    id: "1",
    name: "Chocolate Latte",
    price: 67,
    category: "Cafe",
    variants: [],
  },
  {
    id: "2",
    name: "Matcha Latte",
    price: 92,
    category: "Matcha",
    variants: [],
  },
  {
    id: "3",
    name: "Vainilla Latte",
    price: 75,
    category: "Cafe",
    variants: [],
  },
];

const PRODUCTS_WITH_EXACT_LATTE = [
  { id: "1", name: "Latte Regular", price: 67, category: "Cafe", variants: [] },
  {
    id: "2",
    name: "Matcha Latte",
    price: 92,
    category: "Matcha",
    variants: [],
  },
];

Deno.test("chooseBestProductMatch keeps latte ambiguous when multiple products match", () => {
  const matches = chooseBestProductMatch(PRODUCTS_LATTE_AMBIGUOUS, "latte");
  assertEquals(matches.map((product) => product.name), [
    "Chocolate Latte",
    "Matcha Latte",
    "Vainilla Latte",
  ]);
});

Deno.test("chooseBestProductMatch normalizes plural latte queries", () => {
  const matches = chooseBestProductMatch(PRODUCTS_LATTE_AMBIGUOUS, "lattes");
  assertEquals(matches.map((product) => product.name), [
    "Chocolate Latte",
    "Matcha Latte",
    "Vainilla Latte",
  ]);
});

Deno.test("chooseBestProductMatch picks the exact latte when query is specific", () => {
  const matches = chooseBestProductMatch(
    PRODUCTS_WITH_EXACT_LATTE,
    "latte regular",
  );
  assertEquals(matches.map((product) => product.name), ["Latte Regular"]);
});

Deno.test("chooseBestProductMatch resolves token order changes like latte matcha", () => {
  const matches = chooseBestProductMatch(
    PRODUCTS_WITH_EXACT_LATTE,
    "latte matcha",
  );
  assertEquals(matches.map((product) => product.name), ["Matcha Latte"]);
});

Deno.test("chooseBestProductMatch uses named variants as product matches", () => {
  const matches = chooseBestProductMatch(
    [
      {
        id: "leonor",
        name: "La Mesa de Leonor",
        price: 70,
        category: "POSTRES",
        variants: [
          { name: "GALLETA CHOCOLATECHIP", price: 70 },
          { name: "GALLETA SALT AND CHOCOLATE", price: 70 },
        ],
      },
      { id: "avena", name: "GALLETAS AVENA", price: 30, variants: [] },
    ],
    "galleta chocolatechip",
  );

  assertEquals(matches.map((product) => product.name), ["La Mesa de Leonor"]);
});

Deno.test("chooseVariantByQuery prefers chocolatechip over generic chocolate variants", () => {
  const variant = chooseVariantByQuery(
    [
      { name: "GALLETA CHOCOLATECHIP", price: 70 },
      { name: "GALLETA SALT AND CHOCOLATE", price: 70 },
      { name: "PISTACHE CHOCOLATE", price: 28 },
    ],
    "galleta chocolatechip",
  );

  assertEquals(variant?.name, "GALLETA CHOCOLATECHIP");
});

Deno.test("chooseVariantByQuery ignores product tokens and resolves mineral simple default", () => {
  const variant = chooseVariantByQuery(
    [
      { name: "GDE, Mineral, Lavanda", price: 88 },
      { name: "GDE, Mineral, Simple", price: 88 },
      { name: "GDE, Natural, Simple", price: 88 },
    ],
    "limonada mineral grande",
    "Limonada",
  );

  assertEquals(variant?.name, "GDE, Mineral, Simple");
});

// ── Multi-word phrase normalization (B2/E3) ─────────────────────────────────

Deno.test('normalizeVariantPreference handles "leche de coco" phrase for milk', () => {
  assertEquals(normalizeVariantPreference("milk", "leche de coco"), "COCO");
});

Deno.test('normalizeVariantPreference handles "leche de almendra" phrase for milk', () => {
  assertEquals(
    normalizeVariantPreference("milk", "leche de almendra"),
    "ALMENDRA",
  );
});

Deno.test('normalizeVariantPreference handles "con leche deslactosada" phrase for milk', () => {
  assertEquals(
    normalizeVariantPreference("milk", "con leche deslactosada"),
    "DESLACTOSADA",
  );
});

Deno.test('normalizeVariantPreference handles "en las rocas" phrase for temp', () => {
  assertEquals(normalizeVariantPreference("temp", "en las rocas"), "ROCAS");
});

Deno.test('normalizeVariantPreference handles "con hielo" phrase for temp', () => {
  assertEquals(normalizeVariantPreference("temp", "con hielo"), "ROCAS");
});

Deno.test("normalizeVariantPreference returns null for unrelated phrase", () => {
  assertEquals(normalizeVariantPreference("milk", "latte regular"), null);
});

Deno.test("inferVariantFiltersFromText extracts signoff latte phrase", () => {
  assertEquals(
    inferVariantFiltersFromText(
      "latte regular chico en las rocas con leche de coco",
    ),
    { size: "CH", temp: "ROCAS", milk: "COCO" },
  );
});

Deno.test("inferVariantFiltersFromText extracts americano chico frio", () => {
  assertEquals(inferVariantFiltersFromText("americano chico frio"), {
    size: "CH",
    temp: "ROCAS",
    milk: undefined,
  });
});

Deno.test("inferVariantFiltersFromText normalizes provided iced and infers milk", () => {
  assertEquals(
    inferVariantFiltersFromText("latte regular con leche de coco", {
      size: "chica",
      temp: "iced",
    }),
    { size: "CH", temp: "ROCAS", milk: "COCO" },
  );
});

// ── resolveVariant (B2/E3) ──────────────────────────────────────────────────

const LATTE_VARIANTS = [
  { name: "CH,CALIENTE,DESLACTOSADA", price: 65 },
  { name: "CH,ROCAS,DESLACTOSADA", price: 65 },
  { name: "GDE,CALIENTE,DESLACTOSADA", price: 80 },
  { name: "GDE,ROCAS,DESLACTOSADA", price: 80 },
  { name: "GDE,ROCAS,COCO", price: 90 },
];

const LATTE_PRODUCT = {
  id: "latte-1",
  name: "Latte Regular",
  price: 65,
  variants: LATTE_VARIANTS,
};

Deno.test("resolveVariant picks single match when milk+temp+size filter", () => {
  const result = resolveVariant(LATTE_PRODUCT, {
    size: "GDE",
    temp: "ROCAS",
    milk: "COCO",
  });
  assertEquals(result.success, true);
  if (!result.success) throw new Error("expected success");
  assertEquals(result.variant?.name, "GDE,ROCAS,COCO");
});

Deno.test("resolveVariant asks for size when milk+temp match two sizes", () => {
  const result = resolveVariant(LATTE_PRODUCT, {
    temp: "ROCAS",
    milk: "DESLACTOSADA",
  });
  assertEquals(result.success, false);
  if (result.success) throw new Error("expected clarification");
  assertEquals(typeof result.needs_clarification, "string");
  // Should ask about size (CH vs GDE ambiguity), not temp or milk
  const q = result.needs_clarification?.toLowerCase() ?? "";
  const mentionsSize = q.includes("tama") || q.includes("chico") ||
    q.includes("grande");
  assertEquals(mentionsSize, true);
});

Deno.test("resolveVariant asks for temp when no filter and product has multiple temps", () => {
  const result = resolveVariant(LATTE_PRODUCT, {});
  assertEquals(result.success, false);
  if (result.success) throw new Error("expected clarification");
  assertEquals(typeof result.needs_clarification, "string");
});

Deno.test("resolveVariant succeeds for product with no variants", () => {
  const product = { id: "x", name: "Agua", price: 20, variants: [] };
  const result = resolveVariant(product, {});
  assertEquals(result.success, true);
  if (!result.success) throw new Error("expected success");
  assertEquals(result.variant, null);
  assertEquals(result.unitPrice, 20);
});

// ── resolveVariant with real BD mixed-case variant names (e.g. "GDE, ROCAS, coco") ──

const LATTE_REAL_VARIANTS = [
  { sku: "", name: "CH, ROCAS, deslactosada", price: 67 },
  { sku: "", name: "CH, ROCAS, coco", price: 79 },
  { sku: "", name: "GDE, ROCAS, deslactosada", price: 77 },
  { sku: "", name: "GDE, ROCAS, coco", price: 89 },
  { sku: "", name: "GDE, FRAPPE, coco", price: 89 },
];

const LATTE_REAL_PRODUCT = {
  id: "latte-real",
  name: "Latte Regular",
  price: 67,
  variants: LATTE_REAL_VARIANTS,
};

Deno.test("resolveVariant resolves GDE ROCAS coco from real BD format (mixed case)", () => {
  const result = resolveVariant(LATTE_REAL_PRODUCT, {
    size: "GDE",
    temp: "ROCAS",
    milk: "COCO",
  });
  assertEquals(result.success, true);
  if (!result.success) throw new Error("expected success");
  assertEquals(result.variant?.name, "GDE, ROCAS, coco");
  assertEquals(result.unitPrice, 89);
});

Deno.test("resolveVariant resolves CH ROCAS coco from inferred signoff phrase", () => {
  const filters = inferVariantFiltersFromText(
    "latte regular chico en las rocas con leche de coco",
  );
  const result = resolveVariant(LATTE_REAL_PRODUCT, filters);
  assertEquals(result.success, true);
  if (!result.success) throw new Error("expected success");
  assertEquals(result.variant?.name, "CH, ROCAS, coco");
  assertEquals(result.unitPrice, 79);
});

const HORCHATA_SIZE_ONLY_PRODUCT = {
  id: "horchata-kafe",
  name: "Horchata Kafe",
  price: 89,
  variants: [
    { sku: "", name: "CH", price: 89 },
    { sku: "", name: "GDE", price: 99 },
  ],
};

Deno.test("resolveVariant ignores unsupported temp and milk for size-only products", () => {
  const result = resolveVariant(HORCHATA_SIZE_ONLY_PRODUCT, {
    size: "CH",
    temp: "ROCAS",
    milk: "COCO",
  });
  assertEquals(result.success, true);
  if (!result.success) throw new Error("expected success");
  assertEquals(result.variant?.name, "CH");
  assertEquals(result.unitPrice, 89);
});

Deno.test("resolveVariant still asks for size on size-only products when stale attrs are unsupported", () => {
  const result = resolveVariant(HORCHATA_SIZE_ONLY_PRODUCT, {
    temp: "ROCAS",
    milk: "COCO",
  });
  assertEquals(result.success, false);
  if (result.success) throw new Error("expected clarification");
  assertEquals(
    result.needs_clarification,
    "¿Qué tamano prefieres: Chico o Grande?",
  );
});

// ── buildStrippedSearchQuery (E2 fallback) ───────────────────────────────────

Deno.test("buildStrippedSearchQuery strips GDE+ROCAS+COCO tokens from full sentence", () => {
  const stripped = buildStrippedSearchQuery(
    "latte regular grande en las rocas con leche de coco",
    "GDE",
    "ROCAS",
    "COCO",
  );
  assertEquals(stripped, "latte regular");
});

Deno.test("buildStrippedSearchQuery returns null for short queries (no stripping needed)", () => {
  const stripped = buildStrippedSearchQuery(
    "latte regular",
    "GDE",
    "ROCAS",
    "COCO",
  );
  assertEquals(stripped, null);
});

Deno.test("buildStrippedSearchQuery returns null when no variant tokens found in query", () => {
  const stripped = buildStrippedSearchQuery(
    "americano",
    null,
    "CALIENTE",
    null,
  );
  assertEquals(stripped, null);
});

Deno.test("editDraftCartItems removes a typo-matched item and asks for missing keep item", () => {
  const result = editDraftCartItems(
    {
      items: [
        {
          product_id: "latte-real",
          product_name: "Latte Regular",
          variant_name: "CH, ROCAS, coco",
          quantity: 1,
          unit_price: 79,
        },
      ],
      updated_at: "2026-05-07T00:00:00.000Z",
    },
    { remove_query: "late", keep_query: "galleta" },
  );

  assertEquals(result.removed.map((item) => item.product_name), [
    "Latte Regular",
  ]);
  assertEquals(result.cart.items.length, 0);
  assertEquals(result.keptMissing, "galleta");
  assertEquals(result.notFound, null);
});

Deno.test("formatProductDisplay lists named item variants", () => {
  const display = formatProductDisplay({
    id: "leonor",
    name: "La Mesa de Leonor",
    price: 70,
    category: "POSTRES",
    variants: [
      { name: "GALLETA CHOCOLATECHIP", price: 70 },
      { name: "GALLETA SALT AND CHOCOLATE", price: 70 },
      { name: "BROOKIES", price: 22 },
    ],
  });

  assertStringIncludes(display, "GALLETA CHOCOLATECHIP");
  assertStringIncludes(display, "$70");
  assertStringIncludes(display, "BROOKIES");
  assertStringIncludes(display, "$22");
});

Deno.test("buildStrippedSearchQuery returns null when no variant filters provided", () => {
  const stripped = buildStrippedSearchQuery("latte regular grande rocas coco");
  assertEquals(stripped, null);
});

Deno.test("buildStrippedSearchQuery strips only known temp token, preserves product name", () => {
  const stripped = buildStrippedSearchQuery(
    "americano grande caliente",
    "GDE",
    "CALIENTE",
    null,
  );
  assertEquals(stripped, "americano");
});

Deno.test("mergePartialCancelledItems preserves cancelled lines and appends amended active cart", () => {
  const merged = mergePartialCancelledItems(
    {
      items: [
        {
          product_id: "latte-gde",
          product_name: "Latte Regular",
          variant_name: "GDE, ROCAS, coco",
          quantity: 1,
          unit_price: 89,
          cancelled: true,
        },
        {
          product_id: "pbj",
          product_name: "PB&J",
          variant_name: null,
          quantity: 1,
          unit_price: 65,
        },
        {
          product_id: "latte-ch",
          product_name: "Latte Regular",
          variant_name: "CH, ROCAS, coco",
          quantity: 1,
          unit_price: 79,
          cancelled: true,
        },
      ],
    },
    [
      {
        product_id: "pbj",
        product_name: "PB&J",
        variant_name: null,
        quantity: 1,
        unit_price: 65,
      },
      {
        product_id: "horchata",
        product_name: "Horchata Kafe",
        variant_name: "CH",
        quantity: 1,
        unit_price: 89,
      },
    ],
  );

  assertEquals(merged, [
    {
      product_id: "latte-gde",
      product_name: "Latte Regular",
      variant_name: "GDE, ROCAS, coco",
      quantity: 1,
      unit_price: 89,
      cancelled: true,
    },
    {
      product_id: "latte-ch",
      product_name: "Latte Regular",
      variant_name: "CH, ROCAS, coco",
      quantity: 1,
      unit_price: 79,
      cancelled: true,
    },
    {
      product_id: "pbj",
      product_name: "PB&J",
      variant_name: null,
      quantity: 1,
      unit_price: 65,
    },
    {
      product_id: "horchata",
      product_name: "Horchata Kafe",
      variant_name: "CH",
      quantity: 1,
      unit_price: 89,
    },
  ]);
});
