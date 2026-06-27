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
 * `ops.products` catalog access for the bot. Rebound from the legacy Supabase
 * RPCs (`search_products_text`/`search_products_by_embedding`, which don't exist
 * canonically) to direct SQL: ILIKE waterfall (ranked in TS) → pgvector cosine
 * fallback (preflight §3/§4). Worker pool (unauthenticated WhatsApp path).
 *
 * Money: `price_cents` → pesos (legacy tool unit); the Zettle-native `variants`
 * jsonb (`{sku,name,price}`, price already pesos) passes through unchanged.
 */

interface ProductRow {
  id: string;
  name: string;
  price_cents: number | null;
  description: string | null;
  category_name: string | null;
  variants: ProductVariant[] | null;
}

const SELECT = `p.id::text, p.name, p.price_cents, p.description,
  pc.name AS category_name, p.variants`;
const FROM = `FROM ops.products p
  LEFT JOIN ops.product_categories pc ON pc.id = p.category_id`;

function mapRow(r: ProductRow): ProductRecord {
  return {
    id: r.id,
    name: r.name,
    price: (r.price_cents ?? 0) / 100, // centavos → pesos
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
  async searchByQuery(
    tenantId: string,
    query: string,
    limit = 10,
  ): Promise<ProductRecord[]> {
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter((t) => t.length >= 2)
      .slice(0, 8);
    const likePatterns = [`%${query.trim()}%`, ...tokens.map((t) => `%${t}%`)];

    const text = await this.pg.query<ProductRow>(
      `SELECT ${SELECT} ${FROM}
        WHERE p.tenant_id = $1::uuid AND p.is_available = true
          AND (p.name ILIKE ANY($2) OR COALESCE(p.description,'') ILIKE ANY($2))
        LIMIT 250`,
      [tenantId, likePatterns],
    );
    if (text.rows.length) {
      return rankProducts(text.rows.map(mapRow), query).slice(0, limit);
    }

    // Semantic fallback.
    const embedding = await this.voyage.generateEmbedding(query, 'query');
    if (!embedding) return [];
    const sem = await this.pg.query<ProductRow>(
      `SELECT ${SELECT} ${FROM}
        WHERE p.tenant_id = $1::uuid AND p.is_available = true
          AND p.name_embedding IS NOT NULL
          AND 1 - (p.name_embedding <=> $2::vector) >= 0.60
        ORDER BY p.name_embedding <=> $2::vector
        LIMIT $3`,
      [tenantId, JSON.stringify(embedding), limit],
    );
    return rankProducts(sem.rows.map(mapRow), query).slice(0, limit);
  }

  /** Permissive cosine "nearest" candidates (threshold 0.30) for near-miss help. */
  async findNearestCandidates(
    tenantId: string,
    query: string,
    limit = 6,
  ): Promise<ProductRecord[]> {
    const embedding = await this.voyage.generateEmbedding(query, 'query');
    if (!embedding) return [];
    const { rows } = await this.pg.query<ProductRow>(
      `SELECT ${SELECT} ${FROM}
        WHERE p.tenant_id = $1::uuid AND p.is_available = true
          AND p.name_embedding IS NOT NULL
          AND 1 - (p.name_embedding <=> $2::vector) >= 0.30
        ORDER BY p.name_embedding <=> $2::vector
        LIMIT $3`,
      [tenantId, JSON.stringify(embedding), limit],
    );
    return rows
      .map(mapRow)
      .filter((p) => !INTERNAL_ONLY_CATEGORIES.has(p.category ?? ''));
  }

  /** Available products for a browse intent, optionally filtered by category names. */
  async browse(
    tenantId: string,
    categoryFilter: string[] | null,
    limit = 80,
  ): Promise<ProductRecord[]> {
    const { rows } = await this.pg.query<ProductRow>(
      `SELECT ${SELECT} ${FROM}
        WHERE p.tenant_id = $1::uuid AND p.is_available = true
          AND ($2::text[] IS NULL OR pc.name = ANY($2))
        LIMIT $3`,
      [tenantId, categoryFilter, limit],
    );
    return rows.map(mapRow).filter((p) => !INTERNAL_ONLY_CATEGORIES.has(p.category ?? ''));
  }

  /** Distinct customer-facing category names (browse suggestions). */
  async categorySuggestions(tenantId: string): Promise<string[]> {
    const { rows } = await this.pg.query<{ name: string | null }>(
      `SELECT DISTINCT pc.name
         FROM ops.products p
         JOIN ops.product_categories pc ON pc.id = p.category_id
        WHERE p.tenant_id = $1::uuid AND p.is_available = true`,
      [tenantId],
    );
    return rows
      .map((r) => r.name)
      .filter((n): n is string => !!n && !INTERNAL_ONLY_CATEGORIES.has(n));
  }

  /** Fetch products by id (order validation / re-price). Includes unavailable. */
  async getByIds(tenantId: string, ids: string[]): Promise<Map<string, ProductRecord & { available: boolean }>> {
    if (!ids.length) return new Map();
    const { rows } = await this.pg.query<ProductRow & { is_available: boolean }>(
      `SELECT ${SELECT}, p.is_available ${FROM}
        WHERE p.tenant_id = $1::uuid AND p.id = ANY($2::uuid[])`,
      [tenantId, ids],
    );
    return new Map(rows.map((r) => [r.id, { ...mapRow(r), available: r.is_available }]));
  }

  /** Products lacking a name embedding (product.embed enrichment). */
  async listNeedingEmbedding(
    tenantId: string,
    limit: number,
  ): Promise<Array<{ id: string; name: string; category: string | null; variants: ProductVariant[] }>> {
    const { rows } = await this.pg.query<ProductRow>(
      `SELECT ${SELECT} ${FROM}
        WHERE p.tenant_id = $1::uuid AND p.is_available = true AND p.name_embedding IS NULL
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

  async updateNameEmbedding(id: string, embedding: number[], model: string): Promise<void> {
    await this.pg.query(
      `UPDATE ops.products SET name_embedding = $2::vector, embedding_model = $3, updated_at = now()
        WHERE id = $1::uuid`,
      [id, JSON.stringify(embedding), model],
    );
  }

  // ── zettle.sync catalog upsert (Phase 3d integrations) ──────────────────────

  /** Get-or-create a category by name (key = slug); returns its id, or null. */
  async getOrCreateCategory(tenantId: string, name: string | null): Promise<string | null> {
    if (!name || !name.trim()) return null;
    const key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'uncategorized';
    const { rows } = await this.pg.query<{ id: string }>(
      `INSERT INTO ops.product_categories (tenant_id, key, name, sort_order, metadata)
       VALUES ($1::uuid, $2, $3, 0, '{}'::jsonb)
       ON CONFLICT (tenant_id, key) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING id::text`,
      [tenantId, key, name.trim()],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Upsert a Zettle product, keyed on `metadata->>'zettle_uuid'` (no column/unique
   * for it canonically). Nulls `name_embedding` only when name/variants actually
   * changed (so product.embed re-embeds just those). `priceCents` is centavos
   * (Zettle minor units); `variants` jsonb carries pesos prices (Zettle-native).
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
    const variantsJson = JSON.stringify(p.variants);
    const existing = await this.pg.query<{ id: string }>(
      `SELECT id::text FROM ops.products
        WHERE tenant_id = $1::uuid AND metadata->>'zettle_uuid' = $2 LIMIT 1`,
      [tenantId, p.zettleUuid],
    );
    if (existing.rows[0]) {
      await this.pg.query(
        `UPDATE ops.products SET
            name = $3, description = $4, category_id = $5::uuid, price_cents = $6,
            variants = $7::jsonb, is_available = $8, synced_at = now(), updated_at = now(),
            name_embedding = CASE
              WHEN name IS DISTINCT FROM $3 OR variants IS DISTINCT FROM $7::jsonb
              THEN NULL ELSE name_embedding END,
            metadata = metadata || jsonb_build_object('zettle_uuid', $2, 'source', 'zettle')
          WHERE id = $9::uuid`,
        [tenantId, p.zettleUuid, p.name, p.description, p.categoryId, p.priceCents, variantsJson, p.isAvailable, existing.rows[0].id],
      );
      return;
    }
    await this.pg.query(
      `INSERT INTO ops.products
         (tenant_id, category_id, name, description, price_cents, is_available, variants, synced_at, metadata)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, now(),
               jsonb_build_object('zettle_uuid', $8, 'source', 'zettle'))`,
      [tenantId, p.categoryId, p.name, p.description, p.priceCents, p.isAvailable, variantsJson, p.zettleUuid],
    );
  }

  /** Mark Zettle-sourced products absent from the latest sync as unavailable. */
  async markUnavailableExcept(tenantId: string, zettleUuids: string[]): Promise<void> {
    await this.pg.query(
      `UPDATE ops.products SET is_available = false, updated_at = now()
        WHERE tenant_id = $1::uuid
          AND metadata->>'zettle_uuid' IS NOT NULL
          AND NOT (metadata->>'zettle_uuid' = ANY($2::text[]))`,
      [tenantId, zettleUuids],
    );
  }

  /** Single product (edit_cart update_options). */
  async getById(
    tenantId: string,
    id: string,
  ): Promise<(ProductRecord & { available: boolean }) | null> {
    const { rows } = await this.pg.query<ProductRow & { is_available: boolean }>(
      `SELECT ${SELECT}, p.is_available ${FROM}
        WHERE p.tenant_id = $1::uuid AND p.id = $2::uuid
        LIMIT 1`,
      [tenantId, id],
    );
    return rows[0] ? { ...mapRow(rows[0]), available: rows[0].is_available } : null;
  }
}
