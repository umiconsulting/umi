import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { VoyageAdapter } from '../../shared/adapters/voyage.adapter';
import {
  INTERNAL_ONLY_CATEGORIES,
  rankProducts,
  type ProductRecord,
  type ProductVariant,
} from './tools/product-search';

/**
 * `tenant.product` catalog access for the bot. Rebound from the legacy Supabase
 * RPCs (`search_products_text`/`search_products_by_embedding`, which don't exist
 * canonically) to direct SQL: ILIKE waterfall (ranked in TS) → pgvector cosine
 * fallback (preflight §3/§4). Worker pool (unauthenticated WhatsApp path).
 *
 * ── build-v3 (2026-07-21) ──────────────────────────────────────────────────
 * This file was written against build-v2 and referenced FIVE columns build-v3
 * does not have. Every statement here failed, and none of it was visible: the
 * queries are assembled from the `SELECT`/`FROM` constants below, so sql-preflight
 * filed them under "interpolated — not covered" and never PREPAREd one.
 *
 *   price_cents            -> price          (bigint centavos, same unit)
 *   is_available           -> active
 *   metadata->>zettle_uuid -> external_ref   (typed, and now uniquely indexed)
 *   name_embedding/model   -> runtime.product_embedding (product_id PK)
 *   synced_at              -> runtime.integration_sync  (NOT this repo's job)
 *
 * VARIANTS are the real change. build-v2 kept a Zettle-native `variants` jsonb
 * (`{name, price}`, price ABSOLUTE pesos). build-v3 models them relationally as
 * product_option_group -> product_modifier, where a modifier carries a
 * `price_delta` in centavos, so `product.price + delta` is the variant price
 * (exactly how backfill_commerce.sql exploded them: 1256 modifiers over 66
 * products, one 'Opciones' group each).
 *
 * The jsonb shape is REBUILT at the query boundary rather than pushed into the
 * callers, because it is the tool layer's contract: `product-search.ts` ranks on
 * variant names and `checkout.tools.ts` matches `variant_name` to re-price a
 * reorder. Changing the relational model underneath must not change what the LLM
 * tools see. Money stays where it belongs — centavos in the database, pesos at
 * the tool boundary, converted once, here.
 */

interface ProductRow {
  id: string;
  name: string;
  price: string | number | null; // bigint → string over the wire
  description: string | null;
  category_name: string | null;
  variants: ProductVariant[] | null;
}

/**
 * Rebuild the Zettle-native variant array from the relational model. Absolute
 * pesos per variant = (product base centavos + modifier delta centavos) / 100 —
 * the inverse of the backfill's `round(price*100) - base`. Ordered by name so a
 * menu renders deterministically (the source jsonb had no order to preserve).
 */
const VARIANTS = `(
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object('name', m.name,
                                        'price', (p.price + m.price_delta) / 100.0)
                     ORDER BY m.name),
           '[]'::jsonb)
    FROM tenant.product_option_group g
    JOIN tenant.product_modifier m ON m.option_group_id = g.id
   WHERE g.product_id = p.id
 ) AS variants`;

const SELECT = `p.id::text, p.name, p.price, p.description,
  pc.name AS category_name, ${VARIANTS}`;
const FROM = `FROM tenant.product p
  LEFT JOIN tenant.product_category pc ON pc.id = p.category_id`;

function mapRow(r: ProductRow): ProductRecord {
  return {
    id: r.id,
    name: r.name,
    price: Number(r.price ?? 0) / 100, // centavos → pesos
    description: r.description,
    category: r.category_name,
    variants: Array.isArray(r.variants) ? r.variants : [],
  };
}

@Injectable()
export class ProductsRepository {
  constructor(
    private readonly pg: PgService,
    private readonly voyage: VoyageAdapter,
  ) {}

  /**
   * Two-tier search: ILIKE candidates ranked in TS; on no hits, pgvector cosine
   * (threshold 0.60). Ranking is the behavior-critical TS layer (preserved).
   */
  async searchByQuery(tenantId: string, query: string, limit = 10): Promise<ProductRecord[]> {
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter((t) => t.length >= 2)
      .slice(0, 8);
    const likePatterns = [`%${query.trim()}%`, ...tokens.map((t) => `%${t}%`)];

    const text = await this.pg.tquery<ProductRow>(
      tenantId,
      `SELECT ${SELECT} ${FROM}
        WHERE p.business_id = $1::uuid AND p.active = true
          AND (
            p.name ILIKE ANY($2)
            OR COALESCE(p.description,'') ILIKE ANY($2)
            -- Also match VARIANT names. A brand-as-product catalog (e.g. product
            -- "La Mesa de Leonor" with variants "Brookies", "Linzer Cookies", …)
            -- otherwise hides each item from a targeted search ("brookies") even
            -- though browse shows it — the TS ranker already scores variant names,
            -- it just never received variant-only matches. Now a plain join over
            -- the relational modifiers, so the jsonb_typeof guard that kept
            -- jsonb_array_elements from erroring on a non-array is no longer needed.
            OR EXISTS (
              SELECT 1
                FROM tenant.product_option_group g
                JOIN tenant.product_modifier m ON m.option_group_id = g.id
               WHERE g.product_id = p.id AND m.name ILIKE ANY($2)
            )
          )
        LIMIT 250`,
      [tenantId, likePatterns],
    );
    // Exclude internal-only categories in BOTH branches, matching browse() /
    // findNearestCandidates() / categorySuggestions() — otherwise a text or
    // semantic hit could surface internal catalog items to the customer.
    const textMatches = text.rows
      .map(mapRow)
      .filter((p) => !INTERNAL_ONLY_CATEGORIES.has(p.category ?? ''));
    if (textMatches.length) {
      return rankProducts(textMatches, query).slice(0, limit);
    }

    // Semantic fallback.
    const embedding = await this.voyage.generateEmbedding(query, 'query');
    if (!embedding) return [];
    const sem = await this.pg.tquery<ProductRow>(
      tenantId,
      `SELECT ${SELECT} ${FROM}
        JOIN runtime.product_embedding pe ON pe.product_id = p.id
        WHERE p.business_id = $1::uuid AND p.active = true
          AND 1 - (pe.embedding <=> $2::vector) >= 0.60
        ORDER BY pe.embedding <=> $2::vector
        LIMIT $3`,
      [tenantId, JSON.stringify(embedding), limit],
    );
    return rankProducts(
      sem.rows.map(mapRow).filter((p) => !INTERNAL_ONLY_CATEGORIES.has(p.category ?? '')),
      query,
    ).slice(0, limit);
  }

  /** Permissive cosine "nearest" candidates (threshold 0.30) for near-miss help. */
  async findNearestCandidates(
    tenantId: string,
    query: string,
    limit = 6,
  ): Promise<ProductRecord[]> {
    const embedding = await this.voyage.generateEmbedding(query, 'query');
    if (!embedding) return [];
    const { rows } = await this.pg.tquery<ProductRow>(
      tenantId,
      `SELECT ${SELECT} ${FROM}
        JOIN runtime.product_embedding pe ON pe.product_id = p.id
        WHERE p.business_id = $1::uuid AND p.active = true
          AND 1 - (pe.embedding <=> $2::vector) >= 0.30
        ORDER BY pe.embedding <=> $2::vector
        LIMIT $3`,
      [tenantId, JSON.stringify(embedding), limit],
    );
    return rows.map(mapRow).filter((p) => !INTERNAL_ONLY_CATEGORIES.has(p.category ?? ''));
  }

  /** Available products for a browse intent, optionally filtered by category names. */
  async browse(
    tenantId: string,
    categoryFilter: string[] | null,
    limit = 80,
  ): Promise<ProductRecord[]> {
    const { rows } = await this.pg.tquery<ProductRow>(
      tenantId,
      `SELECT ${SELECT} ${FROM}
        WHERE p.business_id = $1::uuid AND p.active = true
          AND ($2::text[] IS NULL OR pc.name = ANY($2))
        LIMIT $3`,
      [tenantId, categoryFilter, limit],
    );
    return rows.map(mapRow).filter((p) => !INTERNAL_ONLY_CATEGORIES.has(p.category ?? ''));
  }

  /** Distinct customer-facing category names (browse suggestions). */
  async categorySuggestions(tenantId: string): Promise<string[]> {
    const { rows } = await this.pg.tquery<{ name: string | null }>(
      tenantId,
      `SELECT DISTINCT pc.name
         FROM tenant.product p
         JOIN tenant.product_category pc ON pc.id = p.category_id
        WHERE p.business_id = $1::uuid AND p.active = true`,
      [tenantId],
    );
    return rows
      .map((r) => r.name)
      .filter((n): n is string => !!n && !INTERNAL_ONLY_CATEGORIES.has(n));
  }

  /** Fetch products by id (order validation / re-price). Includes unavailable. */
  async getByIds(
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, ProductRecord & { available: boolean }>> {
    if (!ids.length) return new Map();
    const { rows } = await this.pg.tquery<ProductRow & { active: boolean }>(
      tenantId,
      `SELECT ${SELECT}, p.active ${FROM}
        WHERE p.business_id = $1::uuid AND p.id = ANY($2::uuid[])`,
      [tenantId, ids],
    );
    return new Map(rows.map((r) => [r.id, { ...mapRow(r), available: r.active }]));
  }

  /** Products lacking a name embedding (product.embed enrichment). */
  async listNeedingEmbedding(
    tenantId: string,
    limit: number,
  ): Promise<
    Array<{ id: string; name: string; category: string | null; variants: ProductVariant[] }>
  > {
    const { rows } = await this.pg.tquery<ProductRow>(
      tenantId,
      `SELECT ${SELECT} ${FROM}
        WHERE p.business_id = $1::uuid AND p.active = true
          AND NOT EXISTS (
            SELECT 1 FROM runtime.product_embedding pe WHERE pe.product_id = p.id
          )
        LIMIT $2`,
      [tenantId, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category_name,
      variants: Array.isArray(r.variants) ? r.variants : [],
    }));
  }

  /**
   * The embedding is machinery, not catalog truth, so build-v3 keeps it in
   * `runtime.product_embedding` (product_id PK) rather than as a column on the
   * product. Upsert, because re-embedding a renamed product must replace the
   * vector rather than fail or accumulate.
   *
   * Stays on the worker pool: `api` holds SELECT on runtime.product_embedding (for
   * the request-path semantic read) but no write, because producing embeddings is
   * the enrichment job's business, not a request's. The `id` is not tenant-checked
   * here — it comes from listNeedingEmbedding, which is tenant-scoped.
   */
  async updateNameEmbedding(id: string, embedding: number[], model: string): Promise<void> {
    await this.pg.query(
      `INSERT INTO runtime.product_embedding (product_id, embedding, model)
       VALUES ($1::uuid, $2::vector, $3)
       ON CONFLICT (product_id) DO UPDATE
         SET embedding = EXCLUDED.embedding, model = EXCLUDED.model`,
      [id, JSON.stringify(embedding), model],
    );
  }

  // ── zettle.sync catalog upsert (Phase 3d integrations) ──────────────────────

  /**
   * Get-or-create a category by name; returns its id, or null.
   *
   * build-v2 keyed this on a derived slug column (`key`) and upserted on it.
   * build-v3 has no `key` — the NAME is the category's identity, so the slug and
   * its normalization are gone rather than reimplemented. `DO UPDATE SET name`
   * (rather than DO NOTHING) is kept so the statement always RETURNs a row; with
   * DO NOTHING an existing category yields zero rows and the caller would read
   * that as "no category" and detach every product from it.
   */
  async getOrCreateCategory(tenantId: string, name: string | null): Promise<string | null> {
    if (!name || !name.trim()) return null;
    const { rows } = await this.pg.tquery<{ id: string }>(
      tenantId,
      `INSERT INTO tenant.product_category (business_id, name, display_order)
       VALUES ($1::uuid, $2, 0)
       ON CONFLICT (business_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id::text`,
      [tenantId, name.trim()],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Upsert a Zettle product, keyed on `external_ref` (build-v2 hid the id in
   * `metadata->>'zettle_uuid'` with no constraint, so this had to SELECT-then-write
   * and two concurrent syncs could both miss and both INSERT — it is now one atomic
   * ON CONFLICT on the partial unique index).
   *
   * `priceCents` is centavos (Zettle minor units) and lands in `price` unchanged.
   * Variants are no longer a jsonb column: they are REPLACED wholesale in the
   * relational model below, in the same transaction as the product row, because a
   * product whose price moved must not be visible next to modifier deltas computed
   * from the old price.
   *
   * `synced_at` is gone on purpose — a sync cursor is integration machinery and
   * belongs to `runtime.integration_sync`, not to catalog truth. Likewise the
   * `metadata.source='zettle'` provenance blob: `external_ref` being non-null IS
   * the statement that this product came from the integration.
   */
  async upsertFromZettle(
    tenantId: string,
    p: {
      zettleUuid: string;
      name: string;
      description: string | null;
      categoryId: string | null;
      priceCents: number;
      variants: ProductVariant[];
      isAvailable: boolean;
    },
  ): Promise<void> {
    await this.pg.workerTx(async (client) => {
      // Read the PREVIOUS searchable text before the upsert overwrites it. This
      // cannot be folded into the upsert's RETURNING: `excluded` is not in scope
      // there, and by then the table alias already holds the NEW value, so the
      // comparison could never be true. It is only used to decide whether to
      // re-embed, so a miss caused by a concurrent insert is harmless — the worst
      // case is one unnecessary re-embed, while ON CONFLICT still keeps the write
      // atomic.
      const before = await client.query<{ name: string; price: string }>(
        `SELECT name, price::text FROM tenant.product
          WHERE business_id = $1::uuid AND external_ref = $2`,
        [tenantId, p.zettleUuid],
      );
      const prev = before.rows[0];
      const textMoved = !prev || prev.name !== p.name || Number(prev.price) !== p.priceCents;

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO tenant.product
           (business_id, category_id, name, description, price, active, external_ref)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
         ON CONFLICT (business_id, external_ref) WHERE external_ref IS NOT NULL
           DO UPDATE SET
             category_id = EXCLUDED.category_id,
             name        = EXCLUDED.name,
             description = EXCLUDED.description,
             price       = EXCLUDED.price,
             active      = EXCLUDED.active,
             updated_at  = now()
         RETURNING id::text`,
        [tenantId, p.categoryId, p.name, p.description, p.priceCents, p.isAvailable, p.zettleUuid],
      );
      const productId = rows[0].id;

      // Replace the variant set. Delete-then-insert rather than a diff: the group
      // is a single 'Opciones' bag owned entirely by the sync, the counts are tiny
      // (1256 modifiers across the whole catalog), and a diff would have to reason
      // about deltas that shift whenever the base price moves. The cascade from
      // option_group removes the modifiers.
      await client.query(`DELETE FROM tenant.product_option_group WHERE product_id = $1::uuid`, [
        productId,
      ]);
      if (p.variants.length) {
        const g = await client.query<{ id: string }>(
          `INSERT INTO tenant.product_option_group (product_id, name, min_select, max_select)
           VALUES ($1::uuid, 'Opciones', 0, NULL)
           RETURNING id::text`,
          [productId],
        );
        for (const v of p.variants) {
          // Zettle gives an ABSOLUTE price in pesos; the model stores a delta from
          // the product base in centavos, so base + delta reproduces it exactly.
          await client.query(
            `INSERT INTO tenant.product_modifier (option_group_id, name, price_delta)
             VALUES ($1::uuid, $2, $3)`,
            [g.rows[0].id, v.name, Math.round(Number(v.price) * 100) - p.priceCents],
          );
        }
      }

      // Re-embed only when the searchable text actually moved. The embedding is a
      // separate row now, so "invalidate" is a DELETE, and listNeedingEmbedding's
      // NOT EXISTS picks it up on the next enrichment pass.
      if (textMoved) {
        await client.query(`DELETE FROM runtime.product_embedding WHERE product_id = $1::uuid`, [
          productId,
        ]);
      }
    });
  }

  /**
   * Mark Zettle-sourced products absent from the latest sync as unavailable.
   * `external_ref IS NOT NULL` is what scopes this to integration-owned rows, so a
   * hand-created product is never deactivated by a sync that has never heard of it.
   *
   * Deliberately on `tquery`, not the worker pool: this is the most dangerous shape
   * in the file — an UPDATE across many rows whose ONLY tenant guard is one
   * predicate. On the BYPASSRLS pool, deleting that `business_id = $1` would
   * deactivate EVERY tenant's catalog in a single statement, and nothing would fail.
   * Under RLS the same mistake touches zero rows outside this business.
   */
  async markUnavailableExcept(tenantId: string, zettleUuids: string[]): Promise<void> {
    await this.pg.tquery(
      tenantId,
      `UPDATE tenant.product SET active = false, updated_at = now()
        WHERE business_id = $1::uuid
          AND external_ref IS NOT NULL
          AND NOT (external_ref = ANY($2::text[]))`,
      [tenantId, zettleUuids],
    );
  }

  /** Single product (edit_cart update_options). */
  async getById(
    tenantId: string,
    id: string,
  ): Promise<(ProductRecord & { available: boolean }) | null> {
    const { rows } = await this.pg.tquery<ProductRow & { active: boolean }>(
      tenantId,
      `SELECT ${SELECT}, p.active ${FROM}
        WHERE p.business_id = $1::uuid AND p.id = $2::uuid
        LIMIT 1`,
      [tenantId, id],
    );
    return rows[0] ? { ...mapRow(rows[0]), available: rows[0].active } : null;
  }
}
