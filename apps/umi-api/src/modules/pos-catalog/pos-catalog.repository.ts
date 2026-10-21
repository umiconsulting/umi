import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type { CatalogCategory, CatalogProductDetail, CatalogProductSummary } from '@umi/contract';
import {
  availabilityStateSql,
  isCatalogAvailabilityStatus,
} from '../../shared/catalog/availability';
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
  ): Promise<{ allowed: boolean; permissions: string[] }> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        // The permissions come back WITH the verdict so the caller can tell a dead session
        // from a role that simply cannot read the catalog — the same distinction, and the
        // same reason, as `PosCartRepository.authorize`. An empty array means no live
        // session; a non-empty one without `catalog.read` is a role gap the operator
        // cannot fix by signing in again.
        const result = await client.query<{ permissions: string[] }>(
          `SELECT os.permissions
       FROM runtime.operator_session os
       JOIN merchant.device d ON d.id = os.device_id
       JOIN merchant.location b ON b.id = os.location_id AND b.merchant_id = os.merchant_id
       WHERE os.durable_session_id = $2::uuid AND os.user_id = $1::uuid
         AND os.device_id = $3::uuid AND os.merchant_id = $4::uuid
         AND os.location_id = $5::uuid AND os.state = 'active' AND os.expires_at > now()
         AND d.status = 'active' AND b.status = 'active'
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(os.entitlements) entitlement
           WHERE entitlement->>'featureKey' = 'pos'
             AND COALESCE((entitlement->>'enabled')::boolean, false)
         )`,
          [userId, sessionId, deviceId, merchantId, locationId],
        );
        const row = result.rows[0];
        if (!row) return { allowed: false, permissions: [] as string[] };
        const permissions = Array.isArray(row.permissions) ? row.permissions : [];
        return {
          allowed: permissions.includes('catalog.read') || permissions.includes('*'),
          permissions,
        };
      },
      locationId,
    );
  }

  async categories(merchantId: string): Promise<CatalogCategory[]> {
    const { rows } = await this.pg.tquery<CatalogCategory>(
      merchantId,
      `SELECT c.id::text, c.name, c.display_order AS "displayOrder", true AS enabled, c.color
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
                'enabled', true, 'color', c.color) END AS category,
              p.price::text AS "priceMinorUnits", business.currency,
              p.tax_rate_basis_points AS "taxRateBasisPoints",
              p.sale_action AS "saleAction",
              CASE
                WHEN ${availabilityStateSql('a')} <> 'enabled' THEN ${availabilityStateSql('a')}
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
                      WHERE g.product_id = p.id AND g.active) AS "hasModifiers",
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
      `SELECT p.id::text,p.name,p.description,p.sku,p.barcode,p.price::int AS "priceMinorUnits",
              p.tax_rate_basis_points AS "taxRateBasisPoints",
              p.requires_preparation AS "requiresPreparation",
              p.category_id::text AS "categoryId",m.inventory_item_id::text AS "inventoryItemId",
              coalesce(v.version,1)::int AS version, business.currency
         FROM merchant.product p
         JOIN merchant.merchant business ON business.id=p.merchant_id
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
    const row = rows[0];
    if (!row) return null;
    // The availability of this product at every live location, resolved by the SAME
    // rule the till reads (`availabilityStateSql`), so the owner sees the state the
    // barista's menu actually takes. An absent row is the table's default: available.
    const availability = await this.pg.tquery(
      merchantId,
      `SELECT l.id::text AS "locationId", l.name,
              ${availabilityStateSql('a')} AS status,
              a.available_from::text AS "availableFrom"
         FROM merchant.location l
         LEFT JOIN merchant.product_location_availability a
           ON a.location_id = l.id AND a.product_id = $2::uuid
        WHERE l.merchant_id = $1::uuid AND l.status = 'active'
        ORDER BY lower(l.name), l.id`,
      [merchantId, productId],
    );
    const variants = await this.pg.tquery(
      merchantId,
      `SELECT id::text,name,attributes,price_delta::int AS "priceDelta",
              active,display_order AS "displayOrder"
         FROM merchant.product_variant
        WHERE merchant_id=$1::uuid AND product_id=$2::uuid
        ORDER BY display_order,name,id`,
      [merchantId, productId],
    );
    const optionGroups = await this.pg.tquery(
      merchantId,
      `SELECT g.id::text,g.name,(g.min_select>0) AS required,
              g.min_select AS "minSelections",g.max_select AS "maxSelections",
              g.active,g.display_order AS "displayOrder",
              COALESCE(jsonb_agg(jsonb_build_object(
                'id',m.id::text,'name',m.name,
                'priceDelta',m.price_delta::int,
                'active',m.active,
                'displayOrder',m.display_order
              ) ORDER BY m.display_order,m.name,m.id)
                FILTER (WHERE m.id IS NOT NULL),'[]') AS modifiers
         FROM merchant.product_option_group g
         JOIN merchant.product p ON p.id=g.product_id AND p.merchant_id=$1::uuid
         LEFT JOIN merchant.product_modifier m ON m.option_group_id=g.id
        WHERE g.product_id=$2::uuid
        GROUP BY g.id
        ORDER BY g.display_order,g.name,g.id`,
      [merchantId, productId],
    );
    return {
      ...row,
      availability: availability.rows,
      variants: variants.rows,
      optionGroups: optionGroups.rows,
    };
  }

  /**
   * Set ONE product's availability at ONE location — the owner's "no hay producto".
   *
   * The column had two readers and no writer: the demo seed and a test fixture were the
   * only things that ever wrote `merchant.product_location_availability`, so the only way
   * a café could 86 a product was `psql` (bug hunt §106, 2026-10-08). This is the writer.
   *
   * `enabled` DELETES the row instead of storing it. The table's own comment says an
   * absent row means available, and a second representation of "nothing is wrong here"
   * is a second thing that can disagree with the first. Every other status is stored, and
   * `available_from` travels only with `future_availability` — the table's CHECK enforces
   * the pairing, and this validates it first so the caller gets a named error.
   */
  async setAvailabilityAdministrative(
    client: PoolClient,
    merchantId: string,
    productId: string,
    expectedVersion: number,
    input: { locationId: unknown; status: unknown; availableFrom: unknown },
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

    const locationId = requiredUuid(input.locationId, 'LOCATION_ID');
    const location = await client.query(
      `SELECT 1 FROM merchant.location WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [merchantId, locationId],
    );
    if (!location.rows[0]) throw new Error('CATALOG_LOCATION_SCOPE');

    if (!isCatalogAvailabilityStatus(input.status)) {
      throw new Error('CATALOG_AVAILABILITY_STATUS_INVALID');
    }
    const status = input.status;
    const availableFrom =
      status === 'future_availability'
        ? requiredTimestamp(input.availableFrom, 'AVAILABLE_FROM')
        : null;

    if (status === 'enabled') {
      await client.query(
        `DELETE FROM merchant.product_location_availability
          WHERE product_id=$1::uuid AND location_id=$2::uuid`,
        [productId, locationId],
      );
    } else {
      await client.query(
        `INSERT INTO merchant.product_location_availability
           (product_id,location_id,status,available_from,updated_at)
         VALUES($1::uuid,$2::uuid,$3,$4::timestamptz,clock_timestamp())
         ON CONFLICT (product_id,location_id) DO UPDATE
           SET status=excluded.status,available_from=excluded.available_from,
               updated_at=clock_timestamp()`,
        [productId, locationId, status, availableFrom],
      );
    }
    const next = await client.query<{ version: string }>(
      `UPDATE merchant.aggregate_version SET version=version+1,updated_at=clock_timestamp()
        WHERE merchant_id=$1::uuid AND aggregate_type='catalog_product' AND aggregate_id=$2::uuid
        RETURNING version::text`,
      [merchantId, productId],
    );
    return {
      productId,
      locationId,
      status,
      availableFrom,
      version: Number(next.rows[0].version),
    };
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
       WHERE v.merchant_id=$1::uuid AND v.product_id=$2::uuid AND v.active
       ORDER BY v.display_order,v.name,v.id`,
      [merchantId, summary.id, summary.price.currency, locationId],
    );
    const groups = await this.pg.tquery(
      merchantId,
      `SELECT g.id::text,g.name,(g.min_select>0) required,g.min_select AS "minSelections",
              g.max_select AS "maxSelections",
              COALESCE(jsonb_agg(jsonb_build_object('id',m.id::text,'name',m.name,
                'priceDelta',jsonb_build_object('minorUnits',m.price_delta,'currency',$3::text),
                'available',true) ORDER BY m.display_order,m.name) FILTER (WHERE m.id IS NOT NULL),'[]') modifiers
       FROM merchant.product_option_group g
       JOIN merchant.product p ON p.id=g.product_id AND p.merchant_id=$1::uuid
       LEFT JOIN merchant.product_modifier m ON m.option_group_id=g.id AND m.active
       WHERE g.product_id=$2::uuid AND g.active
       GROUP BY g.id ORDER BY g.display_order,g.name,g.id`,
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
    await this.writeProductChoices(client, merchantId, productId, input);
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
    await this.writeProductChoices(client, merchantId, productId, input);
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

  /**
   * Write the sellable forms and the add-on choices of one product.
   *
   * The product row is the base price. A variant is another sellable form with its
   * own delta. An option group is chosen on the cart line and adds a delta. Both
   * lists are replaced as a set: a row omitted by the owner becomes inactive, not
   * deleted, because old carts and sales may still point at it.
   */
  private async writeProductChoices(
    client: PoolClient,
    merchantId: string,
    productId: string,
    input: Record<string, unknown>,
  ) {
    if (!('variants' in input) && !('optionGroups' in input)) return;

    if ('variants' in input) {
      const variants = parseCatalogVariants(input.variants);
      for (const variant of variants) {
        const written = await client.query(
          `INSERT INTO merchant.product_variant(
             id,merchant_id,product_id,name,attributes,price_delta,active,display_order
           ) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::jsonb,$6,$7,$8)
           ON CONFLICT (id) DO UPDATE SET
             name=excluded.name,
             attributes=excluded.attributes,
             price_delta=excluded.price_delta,
             active=excluded.active,
             display_order=excluded.display_order,
             updated_at=clock_timestamp()
           WHERE product_variant.merchant_id=$2::uuid
             AND product_variant.product_id=$3::uuid
           RETURNING id`,
          [
            variant.id,
            merchantId,
            productId,
            variant.name,
            JSON.stringify(variant.attributes),
            variant.priceDelta,
            variant.active,
            variant.displayOrder,
          ],
        );
        if (!written.rows[0]) throw new Error('CATALOG_VARIANT_SCOPE');
      }
      await client.query(
        `UPDATE merchant.product_variant
            SET active=false,updated_at=clock_timestamp()
          WHERE merchant_id=$1::uuid AND product_id=$2::uuid
            AND NOT (id=ANY($3::uuid[]))`,
        [merchantId, productId, variants.map((variant) => variant.id)],
      );
    }

    if ('optionGroups' in input) {
      const groups = parseCatalogOptionGroups(input.optionGroups);
      for (const group of groups) {
        const writtenGroup = await client.query(
          `INSERT INTO merchant.product_option_group(
             id,product_id,name,min_select,max_select,active,display_order
           ) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO UPDATE SET
             name=excluded.name,
             min_select=excluded.min_select,
             max_select=excluded.max_select,
             active=excluded.active,
             display_order=excluded.display_order
           WHERE product_option_group.product_id=$2::uuid
           RETURNING id`,
          [
            group.id,
            productId,
            group.name,
            group.minSelections,
            group.maxSelections,
            group.active,
            group.displayOrder,
          ],
        );
        if (!writtenGroup.rows[0]) throw new Error('CATALOG_OPTION_GROUP_SCOPE');

        for (const modifier of group.modifiers) {
          const writtenModifier = await client.query(
            `INSERT INTO merchant.product_modifier(
               id,option_group_id,name,price_delta,active,display_order
             ) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6)
             ON CONFLICT (id) DO UPDATE SET
               name=excluded.name,
               price_delta=excluded.price_delta,
               active=excluded.active,
               display_order=excluded.display_order
             WHERE product_modifier.option_group_id=$2::uuid
             RETURNING id`,
            [
              modifier.id,
              group.id,
              modifier.name,
              modifier.priceDelta,
              modifier.active,
              modifier.displayOrder,
            ],
          );
          if (!writtenModifier.rows[0]) throw new Error('CATALOG_MODIFIER_SCOPE');
        }
        await client.query(
          `UPDATE merchant.product_modifier
              SET active=false
            WHERE option_group_id=$1::uuid
              AND NOT (id=ANY($2::uuid[]))`,
          [group.id, group.modifiers.map((modifier) => modifier.id)],
        );
      }
      await client.query(
        `UPDATE merchant.product_option_group
            SET active=false
          WHERE product_id=$1::uuid
            AND NOT (id=ANY($2::uuid[]))`,
        [productId, groups.map((group) => group.id)],
      );
    }
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

type CatalogVariantWrite = {
  id: string;
  name: string;
  attributes: Record<string, string>;
  priceDelta: number;
  active: boolean;
  displayOrder: number;
};

type CatalogModifierWrite = {
  id: string;
  name: string;
  priceDelta: number;
  active: boolean;
  displayOrder: number;
};

type CatalogOptionGroupWrite = {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number | null;
  active: boolean;
  displayOrder: number;
  modifiers: CatalogModifierWrite[];
};

function parseCatalogVariants(value: unknown): CatalogVariantWrite[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error('CATALOG_VARIANTS_INVALID');
  const names = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('CATALOG_VARIANTS_INVALID');
    }
    const input = raw as Record<string, unknown>;
    const name = requiredText(input.name, 'VARIANT_NAME', 160);
    if (names.has(name)) throw new Error('CATALOG_VARIANT_NAME_DUPLICATE');
    names.add(name);
    return {
      id: input.id ? requiredUuid(input.id, 'VARIANT_ID') : randomUUID(),
      name,
      attributes: catalogAttributes(input.attributes),
      priceDelta: boundedInteger(
        input.priceDelta ?? 0,
        'VARIANT_PRICE_DELTA',
        -100_000_000,
        100_000_000,
      ),
      active: input.active !== false,
      displayOrder: boundedInteger(
        input.displayOrder ?? index,
        'VARIANT_DISPLAY_ORDER',
        0,
        100_000,
      ),
    };
  });
}

function parseCatalogOptionGroups(value: unknown): CatalogOptionGroupWrite[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) throw new Error('CATALOG_OPTION_GROUPS_INVALID');
  const groupNames = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('CATALOG_OPTION_GROUPS_INVALID');
    }
    const input = raw as Record<string, unknown>;
    const name = requiredText(input.name, 'OPTION_GROUP_NAME', 160);
    if (groupNames.has(name)) throw new Error('CATALOG_OPTION_GROUP_NAME_DUPLICATE');
    groupNames.add(name);
    const required = input.required === true;
    const minSelections = boundedInteger(
      input.minSelections ?? (required ? 1 : 0),
      'OPTION_MIN_SELECTIONS',
      0,
      100,
    );
    const maxSelections =
      input.maxSelections === null ||
      input.maxSelections === undefined ||
      input.maxSelections === ''
        ? null
        : boundedInteger(input.maxSelections, 'OPTION_MAX_SELECTIONS', 1, 100);
    if (required && minSelections < 1) throw new Error('CATALOG_OPTION_REQUIRED_MINIMUM');
    if (maxSelections !== null && maxSelections < minSelections) {
      throw new Error('CATALOG_OPTION_MAX_BELOW_MIN');
    }
    const modifiers = parseCatalogModifiers(input.modifiers);
    const active = input.active !== false;
    if (active && modifiers.length === 0) throw new Error('CATALOG_OPTION_GROUP_EMPTY');
    return {
      id: input.id ? requiredUuid(input.id, 'OPTION_GROUP_ID') : randomUUID(),
      name,
      minSelections,
      maxSelections,
      active,
      displayOrder: boundedInteger(
        input.displayOrder ?? index,
        'OPTION_GROUP_DISPLAY_ORDER',
        0,
        100_000,
      ),
      modifiers,
    };
  });
}

function parseCatalogModifiers(value: unknown): CatalogModifierWrite[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error('CATALOG_MODIFIERS_INVALID');
  const names = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('CATALOG_MODIFIERS_INVALID');
    }
    const input = raw as Record<string, unknown>;
    const name = requiredText(input.name, 'MODIFIER_NAME', 160);
    if (names.has(name)) throw new Error('CATALOG_MODIFIER_NAME_DUPLICATE');
    names.add(name);
    return {
      id: input.id ? requiredUuid(input.id, 'MODIFIER_ID') : randomUUID(),
      name,
      priceDelta: boundedInteger(
        input.priceDelta ?? 0,
        'MODIFIER_PRICE_DELTA',
        -100_000_000,
        100_000_000,
      ),
      active: input.active !== false,
      displayOrder: boundedInteger(
        input.displayOrder ?? index,
        'MODIFIER_DISPLAY_ORDER',
        0,
        100_000,
      ),
    };
  });
}

function catalogAttributes(value: unknown): Record<string, string> {
  if (value === null || value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('CATALOG_VARIANT_ATTRIBUTES_INVALID');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 12) throw new Error('CATALOG_VARIANT_ATTRIBUTES_INVALID');
  const attributes: Record<string, string> = {};
  for (const [key, raw] of entries) {
    const name = key.trim();
    if (!name || name.length > 60 || typeof raw !== 'string' || raw.trim().length > 120) {
      throw new Error('CATALOG_VARIANT_ATTRIBUTES_INVALID');
    }
    attributes[name] = raw.trim();
  }
  return attributes;
}

function requiredUuid(value: unknown, field: string): string {
  const parsed = nullableUuid(value);
  if (!parsed) throw new Error(`CATALOG_${field}_INVALID`);
  return parsed;
}

/** An ISO timestamp as the driver's `timestamptz` cast reads it. */
function requiredTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`CATALOG_${field}_INVALID`);
  }
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
