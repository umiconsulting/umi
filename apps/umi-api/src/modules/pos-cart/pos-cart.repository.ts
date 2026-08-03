import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { Cart, CartLineInput } from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';

export interface PricedSelection {
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  variantAttributes: Record<string, string>;
  basePrice: number;
  variantDelta: number;
  taxRateBasisPoints: number;
  currency: string;
  modifiers: Array<{
    modifierId: string;
    groupId: string;
    name: string;
    quantity: number;
    priceDelta: number;
  }>;
}

@Injectable()
export class PosCartRepository {
  constructor(private readonly pg: PgService) {}

  async authorize(
    userId: string,
    sessionId: string,
    deviceId: string,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
  ): Promise<boolean> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const { rowCount } = await client.query(
          `SELECT 1 FROM runtime.operator_session os
       JOIN merchant.device d ON d.id=os.device_id
       WHERE os.id=$6::uuid AND os.durable_session_id=$2::uuid AND os.user_id=$1::uuid
         AND os.device_id=$3::uuid AND os.merchant_id=$4::uuid AND os.location_id=$5::uuid
         AND os.state='active' AND os.expires_at>now() AND d.status='active'
         AND ('cart.write'=ANY(os.permissions) OR '*'=ANY(os.permissions))
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(os.entitlements) e
           WHERE e->>'featureKey'='pos' AND COALESCE((e->>'enabled')::boolean,false))`,
          [userId, sessionId, deviceId, merchantId, locationId, operatorSessionId],
        );
        return (rowCount ?? 0) > 0;
      },
      locationId,
    );
  }

  async create(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO merchant.pos_cart
         (merchant_id,location_id,operator_session_id,original_operator_session_id,
          original_operator_user_id,operator_user_id,business_date)
       SELECT $1::uuid,$2::uuid,$3::uuid,$3::uuid,os.user_id,os.user_id,
         (now() at time zone COALESCE(b.timezone,business.timezone))::date
       FROM merchant.location b JOIN merchant.merchant business ON business.id=b.merchant_id
       JOIN runtime.operator_session os ON os.id=$3::uuid
       WHERE b.id=$2::uuid AND b.merchant_id=$1::uuid AND b.status='active'
         AND os.merchant_id=$1::uuid AND os.location_id=$2::uuid
       ON CONFLICT (merchant_id,location_id,operator_user_id) WHERE lifecycle_state IN
         ('building_cart','ready_for_checkout','recovered')
       DO UPDATE SET operator_session_id=excluded.operator_session_id,
                     lifecycle_state='recovered',
                     updated_at=now()
       RETURNING id::text`,
      [merchantId, locationId, operatorSessionId],
    );
    if (!rows[0]) throw new Error('branch_not_allowed');
    return rows[0].id;
  }

  async activeCartId(
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
  ): Promise<string | null> {
    const rows = await this.pg.runWithMerchant(
      merchantId,
      null,
      async (client) =>
        (
          await client.query<{ id: string }>(
            `SELECT id::text FROM merchant.pos_cart
             WHERE merchant_id=$1::uuid AND location_id=$2::uuid
               AND operator_session_id=$3::uuid
               AND lifecycle_state IN
                 ('building_cart','ready_for_checkout','recovered')`,
            [merchantId, locationId, operatorSessionId],
          )
        ).rows,
      locationId,
    );
    return rows[0]?.id ?? null;
  }

  async price(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    input: CartLineInput,
  ): Promise<PricedSelection | null> {
    const product = await client.query<{
      productId: string;
      productName: string;
      basePrice: string;
      taxRateBasisPoints: number;
      currency: string;
      variantId: string | null;
      variantName: string | null;
      variantAttributes: Record<string, string> | null;
      variantDelta: string | null;
    }>(
      `SELECT p.id::text AS "productId",p.name AS "productName",p.price::text AS "basePrice",
              p.tax_rate_basis_points AS "taxRateBasisPoints",business.currency,
              v.id::text AS "variantId",v.name AS "variantName",
              v.attributes AS "variantAttributes",v.price_delta::text AS "variantDelta"
       FROM merchant.product p JOIN merchant.merchant business ON business.id=p.merchant_id
       LEFT JOIN merchant.product_variant v ON v.id=$4::uuid AND v.product_id=p.id AND v.active
       LEFT JOIN merchant.product_location_availability a
         ON a.product_id=p.id AND a.location_id=$2::uuid
       WHERE p.merchant_id=$1::uuid AND p.id=$3::uuid AND p.active
         AND COALESCE(a.status,'enabled')='enabled'
         AND ($4::uuid IS NULL OR v.id IS NOT NULL)`,
      [merchantId, locationId, input.productId, input.variantId],
    );
    if (!product.rows[0]) return null;
    const modifierIds = input.modifierSelections.map((item) => item.modifierId);
    const modifiers = modifierIds.length
      ? await client.query<{
          modifierId: string;
          groupId: string;
          name: string;
          priceDelta: string;
          minSelect: number;
          maxSelect: number | null;
        }>(
          `SELECT m.id::text AS "modifierId",g.id::text AS "groupId",m.name,
                  m.price_delta::text AS "priceDelta",g.min_select AS "minSelect",
                  g.max_select AS "maxSelect"
           FROM merchant.product_modifier m
           JOIN merchant.product_option_group g ON g.id=m.option_group_id
           JOIN merchant.product p ON p.id=g.product_id
           WHERE p.merchant_id=$1::uuid AND p.id=$2::uuid AND m.id=ANY($3::uuid[])`,
          [merchantId, input.productId, modifierIds],
        )
      : { rows: [] };
    if (modifiers.rows.length !== modifierIds.length) return null;
    const counts = new Map<string, number>();
    for (const selection of input.modifierSelections) {
      const row = modifiers.rows.find((item) => item.modifierId === selection.modifierId)!;
      counts.set(row.groupId, (counts.get(row.groupId) ?? 0) + selection.quantity);
    }
    const required = await client.query<{
      id: string;
      minSelect: number;
      maxSelect: number | null;
    }>(
      `SELECT g.id::text,g.min_select AS "minSelect",g.max_select AS "maxSelect"
       FROM merchant.product_option_group g JOIN merchant.product p ON p.id=g.product_id
       WHERE p.merchant_id=$1::uuid AND p.id=$2::uuid`,
      [merchantId, input.productId],
    );
    if (
      required.rows.some((group) => {
        const count = counts.get(group.id) ?? 0;
        return count < group.minSelect || (group.maxSelect != null && count > group.maxSelect);
      })
    ) {
      return null;
    }
    const base = product.rows[0];
    return {
      ...base,
      basePrice: Number(base.basePrice),
      variantDelta: Number(base.variantDelta ?? 0),
      variantAttributes: base.variantAttributes ?? {},
      modifiers: input.modifierSelections.map((selection) => {
        const row = modifiers.rows.find((item) => item.modifierId === selection.modifierId)!;
        return { ...row, priceDelta: Number(row.priceDelta), quantity: selection.quantity };
      }),
    };
  }

  async addOrMerge(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    expectedVersion: number,
    identityKey: string,
    input: CartLineInput,
    priced: PricedSelection,
  ): Promise<boolean> {
    if (!(await this.bump(client, merchantId, cartId, expectedVersion, input.operatorSessionId))) {
      return false;
    }
    const modifierTotal = priced.modifiers.reduce(
      (sum, item) => sum + item.priceDelta * item.quantity,
      0,
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO merchant.pos_cart_line
         (merchant_id,cart_id,product_id,variant_id,identity_key,product_name,variant_name,
          variant_attributes,quantity,note,base_price,variant_delta,modifier_total,
          tax_rate_basis_points)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (cart_id,identity_key) DO UPDATE
         SET quantity=merchant.pos_cart_line.quantity+excluded.quantity,updated_at=now()
       RETURNING id::text`,
      [
        merchantId,
        cartId,
        priced.productId,
        priced.variantId,
        identityKey,
        priced.productName,
        priced.variantName,
        priced.variantAttributes,
        input.quantity,
        input.note,
        priced.basePrice,
        priced.variantDelta,
        modifierTotal,
        priced.taxRateBasisPoints,
      ],
    );
    const lineId = rows[0].id;
    await client.query(`DELETE FROM merchant.pos_cart_line_modifier WHERE line_id=$1::uuid`, [
      lineId,
    ]);
    for (const modifier of priced.modifiers) {
      await client.query(
        `INSERT INTO merchant.pos_cart_line_modifier
          (merchant_id,line_id,group_id,modifier_id,name,quantity,price_delta)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7)`,
        [
          merchantId,
          lineId,
          modifier.groupId,
          modifier.modifierId,
          modifier.name,
          modifier.quantity,
          modifier.priceDelta,
        ],
      );
    }
    return true;
  }

  async remove(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    lineId: string,
    expectedVersion: number,
    operatorSessionId: string,
  ): Promise<boolean> {
    if (!(await this.bump(client, merchantId, cartId, expectedVersion, operatorSessionId))) {
      return false;
    }
    const result = await client.query(
      `DELETE FROM merchant.pos_cart_line WHERE merchant_id=$1::uuid AND cart_id=$2::uuid AND id=$3::uuid`,
      [merchantId, cartId, lineId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async replace(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    lineId: string,
    expectedVersion: number,
    identityKey: string,
    input: CartLineInput,
    priced: PricedSelection,
  ): Promise<boolean> {
    if (
      !(await this.remove(
        client,
        merchantId,
        cartId,
        lineId,
        expectedVersion,
        input.operatorSessionId,
      ))
    ) {
      return false;
    }
    return this.addOrMerge(
      client,
      merchantId,
      cartId,
      expectedVersion + 1,
      identityKey,
      input,
      priced,
    );
  }

  async prepare(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    expectedVersion: number,
    operatorSessionId: string,
  ): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE merchant.pos_cart SET status='prepared',lifecycle_state='ready_for_checkout',
         version=version+1,updated_at=now()
       WHERE merchant_id=$1::uuid AND id=$2::uuid AND version=$3
         AND operator_session_id=$4::uuid
         AND lifecycle_state IN ('building_cart','recovered')
         AND status='draft'
         AND EXISTS(SELECT 1 FROM merchant.pos_cart_line WHERE cart_id=$2::uuid)`,
      [merchantId, cartId, expectedVersion, operatorSessionId],
    );
    return (rowCount ?? 0) > 0;
  }

  async clear(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    expectedVersion: number,
    operatorSessionId: string,
  ): Promise<boolean> {
    if (!(await this.bump(client, merchantId, cartId, expectedVersion, operatorSessionId))) {
      return false;
    }
    await client.query(
      `DELETE FROM merchant.pos_cart_line
       WHERE merchant_id=$1::uuid AND cart_id=$2::uuid`,
      [merchantId, cartId],
    );
    return true;
  }

  private async bump(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    expectedVersion: number,
    operatorSessionId: string,
  ) {
    const { rowCount } = await client.query(
      `UPDATE merchant.pos_cart SET status='draft',lifecycle_state='building_cart',
         version=version+1,updated_at=now()
       WHERE merchant_id=$1::uuid AND id=$2::uuid AND version=$3
         AND operator_session_id=$4::uuid
         AND lifecycle_state IN ('building_cart','ready_for_checkout','recovered')
         AND status IN ('draft','prepared')`,
      [merchantId, cartId, expectedVersion, operatorSessionId],
    );
    return (rowCount ?? 0) > 0;
  }

  async snapshot(merchantId: string, locationId: string, cartId: string): Promise<Cart | null> {
    return this.pg.runWithMerchant(
      merchantId,
      null,
      (client) => this.snapshotWithClient(client, merchantId, cartId),
      locationId,
    );
  }

  async snapshotWithClient(
    client: PoolClient,
    merchantId: string,
    cartId: string,
  ): Promise<Cart | null> {
    const cart = await client.query<{
      id: string;
      merchantId: string;
      locationId: string;
      operatorSessionId: string;
      status: 'draft' | 'prepared' | 'committed' | 'abandoned';
      version: number;
      businessDate: string;
      updatedAt: string;
      currency: string;
    }>(
      `SELECT c.id::text,c.merchant_id::text AS "merchantId",c.location_id::text AS "locationId",
              c.operator_session_id::text AS "operatorSessionId",c.status,c.version,
              c.business_date::text AS "businessDate",c.updated_at::text AS "updatedAt",b.currency
       FROM merchant.pos_cart c JOIN merchant.merchant b ON b.id=c.merchant_id
       WHERE c.merchant_id=$1::uuid AND c.id=$2::uuid`,
      [merchantId, cartId],
    );
    if (!cart.rows[0]) return null;
    const lines = await client.query<{
      id: string;
      productId: string;
      productName: string;
      quantity: number;
      variantId: string | null;
      variantName: string | null;
      variantAttributes: Record<string, string>;
      note: string | null;
      basePrice: string;
      variantDelta: string;
      modifierTotal: string;
      taxRateBasisPoints: number;
      modifiers: Array<Record<string, unknown>>;
    }>(
      `SELECT l.id::text,l.product_id::text AS "productId",l.product_name AS "productName",
              l.quantity,l.variant_id::text AS "variantId",l.variant_name AS "variantName",
              l.variant_attributes AS "variantAttributes",l.note,l.base_price::text AS "basePrice",
              l.variant_delta::text AS "variantDelta",l.modifier_total::text AS "modifierTotal",
              l.tax_rate_basis_points AS "taxRateBasisPoints",
              COALESCE(jsonb_agg(jsonb_build_object('modifierId',m.modifier_id::text,
                'groupId',m.group_id::text,'name',m.name,'quantity',m.quantity,
                'priceDelta',jsonb_build_object('minorUnits',m.price_delta,'currency',$3::text))
                ORDER BY m.name) FILTER(WHERE m.id IS NOT NULL),'[]') modifiers
       FROM merchant.pos_cart_line l LEFT JOIN merchant.pos_cart_line_modifier m ON m.line_id=l.id
       WHERE l.merchant_id=$1::uuid AND l.cart_id=$2::uuid
       GROUP BY l.id ORDER BY l.created_at,l.id`,
      [merchantId, cartId, cart.rows[0].currency],
    );
    const currency = cart.rows[0].currency;
    let subtotal = 0;
    let tax = 0;
    const items = lines.rows.map((line) => {
      const unit = Number(line.basePrice) + Number(line.variantDelta) + Number(line.modifierTotal);
      const lineTotal = unit * line.quantity;
      const lineTax = Math.round(
        (lineTotal * line.taxRateBasisPoints) / (10000 + line.taxRateBasisPoints),
      );
      subtotal += lineTotal;
      tax += lineTax;
      return {
        id: line.id,
        productId: line.productId,
        productName: line.productName,
        quantity: line.quantity,
        variant: line.variantId
          ? {
              variantId: line.variantId,
              name: line.variantName!,
              attributes: line.variantAttributes,
            }
          : null,
        modifiers: line.modifiers,
        note: line.note,
        price: {
          unitPrice: { minorUnits: unit, currency },
          lineSubtotal: { minorUnits: lineTotal, currency },
          tax: { minorUnits: lineTax, currency },
          lineTotal: { minorUnits: lineTotal, currency },
          taxRateBasisPoints: line.taxRateBasisPoints,
        },
      };
    });
    return {
      ...cart.rows[0],
      items: items as Cart['items'],
      totals: {
        subtotal: { minorUnits: subtotal, currency },
        tax: { minorUnits: tax, currency },
        discounts: { total: { minorUnits: 0, currency }, entries: [] },
        grandTotal: { minorUnits: subtotal, currency },
        businessDate: cart.rows[0].businessDate,
      },
      checkoutEnabled: false,
      checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
    };
  }
}
