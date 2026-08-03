import { Injectable } from '@nestjs/common';
import type { CatalogCategory, CatalogProductDetail, CatalogProductSummary } from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';

type ProductRow = Omit<CatalogProductSummary, 'price' | 'category' | 'primaryMedia'> & {
  priceMinorUnits: string;
  currency: string;
  category: CatalogCategory | null;
  primaryMedia: CatalogProductSummary['primaryMedia'];
};

@Injectable()
export class PosCatalogRepository {
  constructor(private readonly pg: PgService) {}

  async authorize(
    userId: string,
    sessionId: string,
    deviceId: string,
    merchantId: string,
    locationId: string,
  ): Promise<boolean> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const { rowCount } = await client.query(
          `SELECT 1
       FROM runtime.operator_session os
       JOIN merchant.device d ON d.id = os.device_id
       JOIN merchant.location b ON b.id = os.location_id AND b.merchant_id = os.merchant_id
       WHERE os.durable_session_id = $2::uuid AND os.user_id = $1::uuid
         AND os.device_id = $3::uuid AND os.merchant_id = $4::uuid
         AND os.location_id = $5::uuid AND os.state = 'active' AND os.expires_at > now()
         AND d.status = 'active' AND b.status = 'active'
         AND ('catalog.read' = ANY(os.permissions) OR '*' = ANY(os.permissions))
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(os.entitlements) entitlement
           WHERE entitlement->>'featureKey' = 'pos'
             AND COALESCE((entitlement->>'enabled')::boolean, false)
         )`,
          [userId, sessionId, deviceId, merchantId, locationId],
        );
        return (rowCount ?? 0) > 0;
      },
      locationId,
    );
  }

  async categories(merchantId: string): Promise<CatalogCategory[]> {
    const { rows } = await this.pg.tquery<CatalogCategory>(
      merchantId,
      `SELECT c.id::text, c.name, c.display_order AS "displayOrder", true AS enabled
       FROM merchant.product_category c
       WHERE c.merchant_id = $1::uuid
         AND EXISTS (
           SELECT 1 FROM merchant.product p
           WHERE p.category_id = c.id AND p.merchant_id = c.merchant_id AND p.active
         )
       ORDER BY c.display_order, lower(c.name), c.id`,
      [merchantId],
    );
    return rows;
  }

  async products(input: {
    merchantId: string;
    locationId: string;
    categoryId?: string;
    search?: string;
    barcode?: string;
    productId?: string;
    afterName?: string;
    afterId?: string;
    limit: number;
  }): Promise<CatalogProductSummary[]> {
    const { rows } = await this.pg.tquery<ProductRow>(
      input.merchantId,
      `SELECT p.id::text, p.name, p.description, p.sku,
              (p.barcode IS NOT NULL) AS "hasBarcode",
              CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
                'id', c.id::text, 'name', c.name, 'displayOrder', c.display_order,
                'enabled', true) END AS category,
              p.price::text AS "priceMinorUnits", business.currency,
              p.tax_rate_basis_points AS "taxRateBasisPoints",
              CASE
                WHEN a.status = 'future_availability' AND a.available_from <= now() THEN 'enabled'
                ELSE COALESCE(a.status, 'enabled')
              END AS availability,
              a.available_from::text AS "availableFrom",
              media.item AS "primaryMedia",
              EXISTS (SELECT 1 FROM merchant.product_variant v
                      WHERE v.product_id = p.id AND v.active) AS "hasVariants",
              EXISTS (SELECT 1 FROM merchant.product_option_group g
                      WHERE g.product_id = p.id) AS "hasModifiers",
              p.updated_at::text AS "updatedAt"
       FROM merchant.product p
       JOIN merchant.merchant business ON business.id = p.merchant_id
       LEFT JOIN merchant.product_category c ON c.id = p.category_id
       LEFT JOIN merchant.product_location_availability a
         ON a.product_id = p.id AND a.location_id = $2::uuid
       LEFT JOIN LATERAL (
         SELECT jsonb_build_object('url', pm.url, 'altText', pm.alt_text,
                  'width', pm.width, 'height', pm.height, 'displayOrder', pm.display_order) item
         FROM merchant.product_media pm
         WHERE pm.product_id = p.id AND pm.url LIKE 'https://%'
         ORDER BY pm.display_order, pm.id LIMIT 1
       ) media ON true
       WHERE p.merchant_id = $1::uuid AND p.active
         AND ($3::uuid IS NULL OR p.category_id = $3::uuid)
         AND ($4::text IS NULL OR lower(p.name) LIKE '%' || lower($4) || '%'
              OR lower(COALESCE(p.description,'')) LIKE '%' || lower($4) || '%'
              OR lower(COALESCE(p.sku,'')) LIKE '%' || lower($4) || '%'
              OR lower(COALESCE(p.barcode,'')) LIKE '%' || lower($4) || '%')
         AND ($5::text IS NULL OR p.barcode = $5)
         AND ($6::text IS NULL OR (lower(p.name), p.id) > (lower($6), $7::uuid))
         AND ($8::uuid IS NULL OR p.id = $8::uuid)
       ORDER BY lower(p.name), p.id
       LIMIT $9`,
      [
        input.merchantId,
        input.locationId,
        input.categoryId ?? null,
        input.search ?? null,
        input.barcode ?? null,
        input.afterName ?? null,
        input.afterId ?? null,
        input.productId ?? null,
        input.limit,
      ],
    );
    return rows.map(({ priceMinorUnits, currency, ...row }) => ({
      ...row,
      price: { minorUnits: Number(priceMinorUnits), currency },
    }));
  }

  async detail(
    merchantId: string,
    locationId: string,
    productId: string,
  ): Promise<CatalogProductDetail | null> {
    const summary = (await this.products({ merchantId, locationId, productId, limit: 1 }))[0];
    return summary ? this.withDetails(merchantId, summary) : null;
  }

  private async withDetails(
    merchantId: string,
    summary: CatalogProductSummary,
  ): Promise<CatalogProductDetail> {
    const media = await this.pg.tquery(
      merchantId,
      `SELECT url, alt_text AS "altText", width, height, display_order AS "displayOrder"
       FROM merchant.product_media
       WHERE merchant_id=$1::uuid AND product_id=$2::uuid AND url LIKE 'https://%'
       ORDER BY display_order,id`,
      [merchantId, summary.id],
    );
    const variants = await this.pg.tquery(
      merchantId,
      `SELECT id::text,name,attributes,jsonb_build_object('minorUnits',price_delta,'currency',$3::text) AS "priceDelta",
              CASE WHEN active THEN 'enabled' ELSE 'disabled' END availability
       FROM merchant.product_variant
       WHERE merchant_id=$1::uuid AND product_id=$2::uuid ORDER BY display_order,name,id`,
      [merchantId, summary.id, summary.price.currency],
    );
    const groups = await this.pg.tquery(
      merchantId,
      `SELECT g.id::text,g.name,(g.min_select>0) required,g.min_select AS "minSelections",
              g.max_select AS "maxSelections",
              COALESCE(jsonb_agg(jsonb_build_object('id',m.id::text,'name',m.name,
                'priceDelta',jsonb_build_object('minorUnits',m.price_delta,'currency',$3::text),
                'available',true) ORDER BY m.name) FILTER (WHERE m.id IS NOT NULL),'[]') modifiers
       FROM merchant.product_option_group g
       JOIN merchant.product p ON p.id=g.product_id AND p.merchant_id=$1::uuid
       LEFT JOIN merchant.product_modifier m ON m.option_group_id=g.id
       WHERE g.product_id=$2::uuid GROUP BY g.id ORDER BY g.name,g.id`,
      [merchantId, summary.id, summary.price.currency],
    );
    const barcode = await this.pg.tquery<{ barcode: string | null }>(
      merchantId,
      `SELECT barcode FROM merchant.product WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [merchantId, summary.id],
    );
    return {
      ...summary,
      barcode: barcode.rows[0]?.barcode ?? null,
      media: media.rows as CatalogProductDetail['media'],
      variants: variants.rows as CatalogProductDetail['variants'],
      optionGroups: groups.rows as CatalogProductDetail['optionGroups'],
    };
  }

  async version(merchantId: string): Promise<{ version: string; updatedAt: string }> {
    const { rows } = await this.pg.tquery<{ version: string; updatedAt: string }>(
      merchantId,
      `SELECT COALESCE(extract(epoch FROM max(updated_at))::bigint::text,'0') version,
              COALESCE(max(updated_at), now())::text AS "updatedAt"
       FROM merchant.product WHERE merchant_id=$1::uuid`,
      [merchantId],
    );
    return rows[0];
  }
}
