import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/** A category as the owner manages it in the dashboard: the POS colour plus how
 * many active products carry it, so an empty category is visible and prunable. */
export interface ManagedCategory {
  id: string;
  name: string;
  displayOrder: number;
  color: string;
  productCount: number;
}

/** A curated categorical palette: 16 mutually distinguishable colours. A new
 * category starts on one of these (never a raw-random RGB that could clash with a
 * neighbour or read as mud); the owner recolours it afterwards. The POS chooses
 * black or white ink by luminance, so light and dark entries are both legible.
 * Kept in step with the DB column default in `20_merchant.sql`. */
const CATEGORY_PALETTE = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6',
  '#bfef45', '#469990', '#9a6324', '#800000', '#808000', '#000075', '#fabed4',
  '#ffd8b1', '#aaffc3',
] as const;

@Injectable()
export class DashboardCatalogRepository {
  constructor(private readonly pg: PgService) {}

  async listCategories(merchantId: string): Promise<ManagedCategory[]> {
    // Every category, not only the ones with active products (unlike the POS
    // list): the owner manages empty categories here too.
    const { rows } = await this.pg.tquery<ManagedCategory>(
      merchantId,
      `SELECT c.id::text, c.name, c.display_order AS "displayOrder", c.color,
              (SELECT count(*)::int FROM merchant.product p
                WHERE p.category_id = c.id AND p.merchant_id = c.merchant_id AND p.active)
                AS "productCount"
         FROM merchant.product_category c
        WHERE c.merchant_id = $1::uuid
        ORDER BY c.display_order, lower(c.name), c.id`,
      [merchantId],
    );
    return rows;
  }

  /** Returns the created row, or null when the name already exists for the merchant
   * (the (merchant_id, name) unique index is the category's identity). The starting
   * colour is the palette entry the merchant uses least, so a new category contrasts
   * with the ones already on the grid instead of colliding at random. */
  async createCategory(
    merchantId: string,
    userId: string,
    input: { name: string },
  ): Promise<ManagedCategory | null> {
    return this.pg.runWithMerchant(merchantId, userId, async (client) => {
      const { rows: used } = await client.query<{ color: string; n: number }>(
        `SELECT color, count(*)::int AS n FROM merchant.product_category
          WHERE merchant_id = $1::uuid GROUP BY color`,
        [merchantId],
      );
      const counts = new Map<string, number>(used.map((row) => [row.color, row.n]));
      const fewest = Math.min(...CATEGORY_PALETTE.map((c) => counts.get(c) ?? 0));
      const candidates = CATEGORY_PALETTE.filter((c) => (counts.get(c) ?? 0) === fewest);
      const color = candidates[Math.floor(Math.random() * candidates.length)];
      const { rows } = await client.query<ManagedCategory>(
        `INSERT INTO merchant.product_category (merchant_id, name, color, display_order)
         SELECT $1::uuid, $2, $3,
                coalesce((SELECT max(display_order) + 1 FROM merchant.product_category
                           WHERE merchant_id = $1::uuid), 0)
         ON CONFLICT (merchant_id, name) DO NOTHING
         RETURNING id::text, name, display_order AS "displayOrder", color,
                   0 AS "productCount"`,
        [merchantId, input.name, color],
      );
      return rows[0] ?? null;
    });
  }

  /** Returns the updated row, or null when no category with that id belongs to the
   * merchant. Either field may be omitted; a category always keeps a concrete colour
   * (there is no clear-to-automatic path — see the column default). */
  async updateCategory(
    merchantId: string,
    userId: string,
    categoryId: string,
    input: { name?: string; color?: string },
  ): Promise<ManagedCategory | null> {
    return this.pg.runWithMerchant(merchantId, userId, async (client) => {
      const { rows } = await client.query<ManagedCategory>(
        `UPDATE merchant.product_category c
            SET name  = coalesce($3, c.name),
                color = coalesce($4, c.color)
          WHERE c.id = $2::uuid AND c.merchant_id = $1::uuid
        RETURNING c.id::text, c.name, c.display_order AS "displayOrder", c.color,
                  (SELECT count(*)::int FROM merchant.product p
                    WHERE p.category_id = c.id AND p.merchant_id = c.merchant_id AND p.active)
                    AS "productCount"`,
        [merchantId, categoryId, input.name ?? null, input.color ?? null],
      );
      return rows[0] ?? null;
    });
  }
}
