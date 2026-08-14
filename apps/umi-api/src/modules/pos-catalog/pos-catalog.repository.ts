import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
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
              p.sale_action AS "saleAction",
              CASE
                WHEN a.status NOT IN ('enabled','future_availability') THEN a.status
                WHEN a.status = 'future_availability' AND a.available_from > now()
                  THEN 'future_availability'
                WHEN im.mapping_type='direct'
                  AND coalesce(ib.available,0)*im.conversion_denominator<im.conversion_numerator
                  THEN 'temporarily_unavailable'
                WHEN im.mapping_type IN ('recipe','bundle') AND EXISTS (
                  SELECT 1 FROM merchant.inventory_recipe_component irc
                  LEFT JOIN merchant.stock_balance rb
                    ON rb.inventory_location_id=ip.inventory_location_id
                   AND rb.inventory_item_id=irc.inventory_item_id
                  WHERE irc.recipe_id=im.recipe_id AND irc.required
                    AND irc.modifier_id IS NULL
                    AND coalesce(rb.available,0)*irc.conversion_denominator
                      <irc.quantity*irc.conversion_numerator
                ) THEN 'temporarily_unavailable'
                ELSE 'enabled'
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
       LEFT JOIN merchant.inventory_catalog_mapping im
         ON im.merchant_id=p.merchant_id AND im.product_id=p.id
        AND im.variant_id IS NULL AND im.active
       LEFT JOIN merchant.inventory_policy ip
         ON ip.merchant_id=p.merchant_id AND ip.location_id=$2::uuid
        AND ip.tracking_enabled AND ip.expires_at>clock_timestamp()
       LEFT JOIN merchant.stock_balance ib
         ON ib.inventory_location_id=ip.inventory_location_id
        AND ib.inventory_item_id=im.inventory_item_id
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
    return summary ? this.withDetails(merchantId, locationId, summary) : null;
  }

  async administrativeDetail(merchantId: string, productId: string) {
    const { rows } = await this.pg.tquery(
      merchantId,
      `SELECT p.id::text,p.name,p.sku,p.barcode,p.price::int AS "priceMinorUnits",
              p.tax_rate_basis_points AS "taxRateBasisPoints",
              p.requires_preparation AS "requiresPreparation",
              p.category_id::text AS "categoryId",m.inventory_item_id::text AS "inventoryItemId",
              coalesce(v.version,1)::int AS version
         FROM merchant.product p
         LEFT JOIN merchant.aggregate_version v ON v.merchant_id=p.merchant_id
          AND v.aggregate_type='catalog_product' AND v.aggregate_id=p.id
         LEFT JOIN LATERAL (
           SELECT mapping.inventory_item_id FROM merchant.inventory_catalog_mapping mapping
           WHERE mapping.merchant_id=p.merchant_id AND mapping.product_id=p.id AND mapping.active
           ORDER BY mapping.created_at DESC LIMIT 1
         ) m ON true
        WHERE p.merchant_id=$1::uuid AND p.id=$2::uuid`,
      [merchantId, productId],
    );
    return rows[0] ?? null;
  }

  private async withDetails(
    merchantId: string,
    locationId: string,
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
      `SELECT v.id::text,v.name,v.attributes,
              jsonb_build_object('minorUnits',v.price_delta,'currency',$3::text) AS "priceDelta",
              CASE WHEN NOT v.active THEN 'disabled'
                   WHEN im.mapping_type='direct'
                     AND coalesce(b.available,0)*im.conversion_denominator<im.conversion_numerator
                     THEN 'temporarily_unavailable'
                   WHEN im.mapping_type IN ('recipe','bundle') AND EXISTS (
                     SELECT 1 FROM merchant.inventory_recipe_component irc
                     JOIN merchant.inventory_recipe ir ON ir.id=irc.recipe_id AND ir.active
                     JOIN merchant.inventory_item ii ON ii.id=irc.inventory_item_id AND ii.active
                     LEFT JOIN merchant.stock_balance rb
                       ON rb.inventory_location_id=ip.inventory_location_id
                      AND rb.inventory_item_id=irc.inventory_item_id
                     WHERE irc.recipe_id=im.recipe_id AND irc.required
                       AND irc.modifier_id IS NULL
                       AND coalesce(rb.available,0)*ir.yield_quantity*irc.conversion_denominator*
                         power(10::numeric,irc.quantity_scale)
                         <irc.quantity*irc.conversion_numerator*
                           power(10::numeric,ir.yield_scale+ii.quantity_scale)
                   ) THEN 'temporarily_unavailable'
                   ELSE 'enabled' END availability
       FROM merchant.product_variant v
       LEFT JOIN LATERAL (
         SELECT candidate.* FROM merchant.inventory_catalog_mapping candidate
          WHERE candidate.merchant_id=v.merchant_id AND candidate.product_id=v.product_id
            AND candidate.active
            AND (candidate.variant_id=v.id OR candidate.variant_id IS NULL)
          ORDER BY (candidate.variant_id=v.id) DESC NULLS LAST LIMIT 1
       ) im ON true
       LEFT JOIN merchant.inventory_policy ip
         ON ip.merchant_id=v.merchant_id AND ip.location_id=$4::uuid
        AND ip.tracking_enabled AND ip.expires_at>clock_timestamp()
       LEFT JOIN merchant.stock_balance b
         ON b.inventory_location_id=ip.inventory_location_id
        AND b.inventory_item_id=im.inventory_item_id
       WHERE v.merchant_id=$1::uuid AND v.product_id=$2::uuid
       ORDER BY v.display_order,v.name,v.id`,
      [merchantId, summary.id, summary.price.currency, locationId],
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

  async createAdministrative(
    client: PoolClient,
    merchantId: string,
    productId: string,
    input: Record<string, unknown>,
  ) {
    const categoryId = nullableUuid(input.categoryId);
    await this.assertCategory(client, merchantId, categoryId);
    const result = await client.query(
      `INSERT INTO merchant.product(
         id,merchant_id,category_id,name,description,price,active,sku,barcode,
         tax_rate_basis_points,requires_preparation,preparation_target_seconds
       ) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,true,$7,$8,$9,$10,$11)
       RETURNING id::text,name,price,active,updated_at::text AS "updatedAt"`,
      [
        productId,
        merchantId,
        categoryId,
        requiredText(input.name, 'name', 240),
        optionalText(input.description, 1000),
        nonnegativeInteger(input.priceMinorUnits, 'priceMinorUnits'),
        optionalText(input.sku, 120),
        optionalText(input.barcode, 160),
        boundedInteger(input.taxRateBasisPoints ?? 0, 'taxRateBasisPoints', 0, 10_000),
        input.requiresPreparation === true,
        nullableBoundedInteger(input.preparationTargetSeconds, 30, 86_400),
      ],
    );
    await client.query(
      `INSERT INTO merchant.aggregate_version(merchant_id,aggregate_type,aggregate_id,version)
       VALUES($1::uuid,'catalog_product',$2::uuid,1)`,
      [merchantId, productId],
    );
    if ('inventoryItemId' in input) {
      await this.updateInventoryMapping(client, merchantId, productId, input.inventoryItemId);
    }
    return { ...result.rows[0], version: 1 };
  }

  async updateAdministrative(
    client: PoolClient,
    merchantId: string,
    productId: string,
    expectedVersion: number,
    input: Record<string, unknown>,
  ) {
    await client.query(
      `INSERT INTO merchant.aggregate_version(merchant_id,aggregate_type,aggregate_id,version)
       SELECT $1::uuid,'catalog_product',$2::uuid,1
        WHERE EXISTS (SELECT 1 FROM merchant.product WHERE merchant_id=$1::uuid AND id=$2::uuid)
       ON CONFLICT DO NOTHING`,
      [merchantId, productId],
    );
    const version = await client.query<{ version: string }>(
      `SELECT version::text FROM merchant.aggregate_version
        WHERE merchant_id=$1::uuid AND aggregate_type='catalog_product' AND aggregate_id=$2::uuid
        FOR UPDATE`,
      [merchantId, productId],
    );
    if (!version.rows[0]) throw new Error('CATALOG_PRODUCT_NOT_FOUND');
    if (Number(version.rows[0].version) !== expectedVersion) {
      throw new Error('CATALOG_VERSION_STALE');
    }
    const current = await client.query<{
      name: string;
      description: string | null;
      price: string;
      categoryId: string | null;
      sku: string | null;
      barcode: string | null;
      taxRateBasisPoints: number;
      requiresPreparation: boolean;
      preparationTargetSeconds: number | null;
    }>(
      `SELECT name,description,price::text,category_id::text AS "categoryId",sku,barcode,
              tax_rate_basis_points AS "taxRateBasisPoints",
              requires_preparation AS "requiresPreparation",
              preparation_target_seconds AS "preparationTargetSeconds"
         FROM merchant.product WHERE merchant_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
      [merchantId, productId],
    );
    const row = current.rows[0];
    if (!row) throw new Error('CATALOG_PRODUCT_NOT_FOUND');
    const categoryId = 'categoryId' in input ? nullableUuid(input.categoryId) : row.categoryId;
    await this.assertCategory(client, merchantId, categoryId);
    const result = await client.query(
      `UPDATE merchant.product SET category_id=$3::uuid,name=$4,description=$5,price=$6,
          sku=$7,barcode=$8,tax_rate_basis_points=$9,requires_preparation=$10,
          preparation_target_seconds=$11,updated_at=clock_timestamp()
        WHERE merchant_id=$1::uuid AND id=$2::uuid
        RETURNING id::text,name,price,active,updated_at::text AS "updatedAt"`,
      [
        merchantId,
        productId,
        categoryId,
        'name' in input ? requiredText(input.name, 'name', 240) : row.name,
        'description' in input ? optionalText(input.description, 1000) : row.description,
        'priceMinorUnits' in input
          ? nonnegativeInteger(input.priceMinorUnits, 'priceMinorUnits')
          : Number(row.price),
        'sku' in input ? optionalText(input.sku, 120) : row.sku,
        'barcode' in input ? optionalText(input.barcode, 160) : row.barcode,
        'taxRateBasisPoints' in input
          ? boundedInteger(input.taxRateBasisPoints, 'taxRateBasisPoints', 0, 10_000)
          : row.taxRateBasisPoints,
        'requiresPreparation' in input
          ? input.requiresPreparation === true
          : row.requiresPreparation,
        'preparationTargetSeconds' in input
          ? nullableBoundedInteger(input.preparationTargetSeconds, 30, 86_400)
          : row.preparationTargetSeconds,
      ],
    );
    if ('inventoryItemId' in input) {
      await this.updateInventoryMapping(client, merchantId, productId, input.inventoryItemId);
    }
    const next = await client.query<{ version: string }>(
      `UPDATE merchant.aggregate_version SET version=version+1,updated_at=clock_timestamp()
        WHERE merchant_id=$1::uuid AND aggregate_type='catalog_product' AND aggregate_id=$2::uuid
        RETURNING version::text`,
      [merchantId, productId],
    );
    return { ...result.rows[0], version: Number(next.rows[0].version) };
  }

  async archiveAdministrative(
    client: PoolClient,
    merchantId: string,
    productId: string,
    expectedVersion: number,
  ) {
    const updated = await this.updateAdministrative(
      client,
      merchantId,
      productId,
      expectedVersion,
      {},
    );
    const result = await client.query(
      `UPDATE merchant.product SET active=false,updated_at=clock_timestamp()
        WHERE merchant_id=$1::uuid AND id=$2::uuid RETURNING id::text,active`,
      [merchantId, productId],
    );
    return { ...updated, ...result.rows[0] };
  }

  private async assertCategory(client: PoolClient, merchantId: string, categoryId: string | null) {
    if (!categoryId) return;
    const result = await client.query(
      `SELECT 1 FROM merchant.product_category WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [merchantId, categoryId],
    );
    if (!result.rows[0]) throw new Error('CATALOG_CATEGORY_SCOPE');
  }

  private async updateInventoryMapping(
    client: PoolClient,
    merchantId: string,
    productId: string,
    rawInventoryItemId: unknown,
  ) {
    const inventoryItemId = nullableUuid(rawInventoryItemId);
    if (inventoryItemId) {
      const item = await client.query(
        `SELECT 1 FROM merchant.inventory_item
          WHERE merchant_id=$1::uuid AND id=$2::uuid AND active`,
        [merchantId, inventoryItemId],
      );
      if (!item.rows[0]) throw new Error('CATALOG_INVENTORY_ITEM_SCOPE');
    }
    const version = await client.query<{ version: string }>(
      `SELECT coalesce(max(version),0)::text AS version
         FROM merchant.inventory_catalog_mapping
        WHERE merchant_id=$1::uuid AND product_id=$2::uuid AND variant_id IS NULL`,
      [merchantId, productId],
    );
    await client.query(
      `UPDATE merchant.inventory_catalog_mapping
          SET active=false,retired_at=clock_timestamp()
        WHERE merchant_id=$1::uuid AND product_id=$2::uuid
          AND variant_id IS NULL AND active`,
      [merchantId, productId],
    );
    await client.query(
      `INSERT INTO merchant.inventory_catalog_mapping(
         merchant_id,product_id,variant_id,mapping_type,inventory_item_id,
         conversion_numerator,conversion_denominator,version)
       VALUES($1::uuid,$2::uuid,NULL,$3,$4::uuid,1,1,$5)`,
      [
        merchantId,
        productId,
        inventoryItemId ? 'direct' : 'non_stock',
        inventoryItemId,
        Number(version.rows[0].version) + 1,
      ],
    );
  }
}

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new Error(`CATALOG_${field.toUpperCase()}_INVALID`);
  }
  return value.trim();
}

function optionalText(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > maximum)
    throw new Error('CATALOG_TEXT_INVALID');
  return value.trim();
}

function nullableUuid(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value))
    throw new Error('CATALOG_UUID_INVALID');
  return value;
}

function nonnegativeInteger(value: unknown, field: string): number {
  return boundedInteger(value, field, 0, Number.MAX_SAFE_INTEGER);
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`CATALOG_${field.toUpperCase()}_INVALID`);
  }
  return parsed;
}

function nullableBoundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  return boundedInteger(value, 'VALUE', minimum, maximum);
}
