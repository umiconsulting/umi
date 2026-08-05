import { ConflictException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  CheckoutCommand,
  CheckoutPolicy,
  CheckoutRecoverySnapshot,
  CheckoutResult,
  InventoryReservation,
  PaymentMethod,
  PaymentOutcome,
  PaymentSummary,
  ReceiptSnapshot,
  TotalsConfirmation,
} from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import { writeOrder } from '../../shared/orders/order-writer';

export interface CheckoutLine {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  note: string | null;
  modifiers: Array<{ modifierId: string; quantity: number }>;
}

export interface CheckoutCart {
  id: string;
  merchantId: string;
  locationId: string;
  operatorSessionId: string;
  version: number;
  businessDate: string;
  merchantName: string;
  locationName: string;
  operatorName: string;
  customerId: string | null;
  lines: CheckoutLine[];
}

export interface CheckoutAuthorization {
  operatorId: string;
  deviceId: string;
  credentialVersion: number;
  operatorName: string;
  permissions: string[];
}

@Injectable()
export class PosCheckoutRepository {
  constructor(private readonly pg: PgService) {}

  async authorize(
    userId: string,
    sessionId: string,
    deviceId: string,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
  ): Promise<CheckoutAuthorization | null> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const { rows } = await client.query<CheckoutAuthorization>(
          `SELECT os.user_id::text AS "operatorId",os.device_id::text AS "deviceId",
                  d.credential_version AS "credentialVersion",
                  u.full_name AS "operatorName",os.permissions
       FROM runtime.operator_session os
       JOIN merchant.device d ON d.id=os.device_id
       JOIN umi.user u ON u.id=os.user_id
       WHERE os.id=$6::uuid AND os.durable_session_id=$2::uuid AND os.user_id=$1::uuid
         AND os.device_id=$3::uuid AND os.merchant_id=$4::uuid AND os.location_id=$5::uuid
         AND os.state='active' AND os.expires_at>now() AND d.status='active'
         AND ('checkout.commit'=ANY(os.permissions) OR '*'=ANY(os.permissions))
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(os.entitlements) e
           WHERE e->>'featureKey'='pos' AND COALESCE((e->>'enabled')::boolean,false))`,
          [userId, sessionId, deviceId, merchantId, locationId, operatorSessionId],
        );
        return rows[0] ?? null;
      },
      locationId,
    );
  }

  async policy(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    currency: string,
  ): Promise<CheckoutPolicy> {
    const { rows } = await client.query<{
      version: string;
      manualTerminalEnabled: boolean;
      mixedTenderEnabled: boolean;
      maximumTenderLines: number;
      manualTerminalApprovalThreshold: string;
      tipsEnabled: boolean;
      tipPresetBasisPoints: number[];
      customTipPercentageEnabled: boolean;
      customTipFixedEnabled: boolean;
      maximumTipMinorUnits: string;
      tipRequiredPermission: string | null;
      discountsEnabled: boolean;
      maximumDiscountBasisPoints: number;
      maximumDiscountMinorUnits: string;
      cashierDiscountThreshold: string;
      customDiscountRequiresApproval: boolean;
      policyCurrency: string;
    }>(
      `SELECT version,manual_terminal_enabled AS "manualTerminalEnabled",
              mixed_tender_enabled AS "mixedTenderEnabled",
              maximum_tender_lines AS "maximumTenderLines",
              manual_terminal_approval_threshold::text AS "manualTerminalApprovalThreshold",
              tips_enabled AS "tipsEnabled",
              tip_preset_basis_points AS "tipPresetBasisPoints",
              custom_tip_percentage_enabled AS "customTipPercentageEnabled",
              custom_tip_fixed_enabled AS "customTipFixedEnabled",
              maximum_tip_minor_units::text AS "maximumTipMinorUnits",
              tip_required_permission AS "tipRequiredPermission",
              discounts_enabled AS "discountsEnabled",
              maximum_discount_basis_points AS "maximumDiscountBasisPoints",
              maximum_discount_minor_units::text AS "maximumDiscountMinorUnits",
              cashier_discount_threshold::text AS "cashierDiscountThreshold",
              custom_discount_requires_approval AS "customDiscountRequiresApproval",
              currency AS "policyCurrency"
       FROM merchant.pos_checkout_policy
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND currency=$3`,
      [merchantId, locationId, currency],
    );
    const row = rows[0];
    const money = (minorUnits: number) => ({ minorUnits, currency });
    if (!row) {
      return {
        version: 'default-deny',
        manualTerminalEnabled: false,
        mixedTenderEnabled: false,
        maximumTenderLines: 1,
        manualTerminalApprovalThreshold: money(0),
        manualTerminalApprovalPermission: 'checkout.terminal.approve',
        tip: {
          enabled: false,
          presetBasisPoints: [],
          customPercentageEnabled: false,
          customFixedEnabled: false,
          maximumTip: money(0),
          requiredPermission: null,
          version: 'default-deny',
        },
        discount: {
          enabled: false,
          maximumBasisPoints: 0,
          maximumAmount: money(0),
          cashierThreshold: money(0),
          customRequiresApproval: true,
          requiredPermission: 'checkout.discount.apply',
          approvalPermission: 'checkout.discount.approve',
          version: 'default-deny',
        },
      };
    }
    return {
      version: row.version,
      manualTerminalEnabled: row.manualTerminalEnabled,
      mixedTenderEnabled: row.mixedTenderEnabled,
      maximumTenderLines: row.maximumTenderLines,
      manualTerminalApprovalThreshold: money(Number(row.manualTerminalApprovalThreshold)),
      manualTerminalApprovalPermission: 'checkout.terminal.approve',
      tip: {
        enabled: row.tipsEnabled,
        presetBasisPoints: row.tipPresetBasisPoints,
        customPercentageEnabled: row.customTipPercentageEnabled,
        customFixedEnabled: row.customTipFixedEnabled,
        maximumTip: money(Number(row.maximumTipMinorUnits)),
        requiredPermission: row.tipRequiredPermission,
        version: row.version,
      },
      discount: {
        enabled: row.discountsEnabled,
        maximumBasisPoints: row.maximumDiscountBasisPoints,
        maximumAmount: money(Number(row.maximumDiscountMinorUnits)),
        cashierThreshold: money(Number(row.cashierDiscountThreshold)),
        customRequiresApproval: row.customDiscountRequiresApproval,
        requiredPermission: 'checkout.discount.apply',
        approvalPermission: 'checkout.discount.approve',
        version: row.version,
      },
    };
  }

  async saveDraft(
    client: PoolClient,
    userDeviceId: string,
    cart: CheckoutCart,
    command: CheckoutCommand,
    state: CheckoutRecoverySnapshot['state'],
    summary: PaymentSummary | null,
    recoveryState: CheckoutRecoverySnapshot['recoveryState'],
    fingerprint: string | null,
  ): Promise<{ id: string; version: number }> {
    const { rows } = await client.query<{ id: string; version: number }>(
      `INSERT INTO merchant.pos_checkout_draft
         (merchant_id,location_id,cart_id,operator_session_id,device_id,state,
          command_fingerprint,tender_drafts,tip_draft,discount_drafts,
          receipt_delivery,payment_summary,recovery_state,cash_shift_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$13,$14::uuid)
       ON CONFLICT(merchant_id,cart_id) DO UPDATE SET
         state=excluded.state,version=merchant.pos_checkout_draft.version+1,
         command_fingerprint=excluded.command_fingerprint,
         tender_drafts=excluded.tender_drafts,tip_draft=excluded.tip_draft,
         discount_drafts=excluded.discount_drafts,receipt_delivery=excluded.receipt_delivery,
         payment_summary=excluded.payment_summary,recovery_state=excluded.recovery_state,
         cash_shift_id=excluded.cash_shift_id,
         updated_at=now()
       WHERE merchant.pos_checkout_draft.state NOT IN ('completed','receipt_available','payment_unknown')
         AND merchant.pos_checkout_draft.operator_session_id=$4::uuid
         AND merchant.pos_checkout_draft.device_id=$5::uuid
         AND NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(merchant.pos_checkout_draft.tender_drafts) prior
           WHERE prior->>'type'='manual_terminal'
             AND prior->>'status'='confirmed_success'
             AND NOT EXISTS (
               SELECT 1
               FROM jsonb_array_elements(excluded.tender_drafts) next
               WHERE next->>'id'=prior->>'id'
                 AND next->>'type'=prior->>'type'
                 AND next->>'status'=prior->>'status'
                 AND next->'amount'=prior->'amount'
             )
         )
       RETURNING id::text,version`,
      [
        cart.merchantId,
        cart.locationId,
        cart.id,
        cart.operatorSessionId,
        userDeviceId,
        state,
        fingerprint,
        JSON.stringify(command.tenderDrafts),
        command.tipDraft ? JSON.stringify(command.tipDraft) : null,
        JSON.stringify(command.discountDrafts),
        JSON.stringify(command.receiptDelivery),
        summary ? JSON.stringify(summary) : null,
        recoveryState,
        command.cashShiftId,
      ],
    );
    if (!rows[0]) throw new Error('Checkout draft is immutable or belongs to another context.');
    return rows[0];
  }

  async consumeApprovals(
    client: PoolClient,
    approvalIds: string[],
    input: {
      sessionId: string;
      merchantId: string;
      locationId: string;
      permissions: string[];
      fingerprint: string;
      commandId: string;
    },
  ): Promise<{
    approved: boolean;
    missingPermission: string | null;
    approvalIdsByPermission: Record<string, string>;
  }> {
    const permissions = [...new Set(input.permissions)];
    if (
      approvalIds.length !== permissions.length ||
      new Set(approvalIds).size !== approvalIds.length
    ) {
      return {
        approved: false,
        missingPermission:
          permissions[Math.min(approvalIds.length, permissions.length - 1)] ?? null,
        approvalIdsByPermission: {},
      };
    }
    const matched = await client.query<{ id: string; permission: string }>(
      `SELECT id::text,permission_key AS permission
       FROM runtime.elevation_grant
       WHERE id=ANY($1::uuid[]) AND session_id=$2::uuid AND merchant_id=$3::uuid
         AND location_id=$4::uuid AND permission_key=ANY($5::text[])
         AND command_fingerprint=$6 AND expires_at>now()
         AND consumed_at IS NULL AND method='manager_approval'
       FOR UPDATE`,
      [
        approvalIds,
        input.sessionId,
        input.merchantId,
        input.locationId,
        permissions,
        input.fingerprint,
      ],
    );
    const matchedPermissions = new Set(matched.rows.map((row) => row.permission));
    const missingPermission =
      permissions.find((permission) => !matchedPermissions.has(permission)) ?? null;
    if (missingPermission || matched.rowCount !== permissions.length) {
      return {
        approved: false,
        missingPermission: missingPermission ?? permissions[0] ?? null,
        approvalIdsByPermission: {},
      };
    }
    const { rowCount } = await client.query(
      `UPDATE runtime.elevation_grant
       SET consumed_at=now(),consumed_by_command_id=$2::uuid
       WHERE id=ANY($1::uuid[]) AND consumed_at IS NULL`,
      [approvalIds, input.commandId],
    );
    return {
      approved: rowCount === permissions.length,
      missingPermission: rowCount === permissions.length ? null : (permissions[0] ?? null),
      approvalIdsByPermission:
        rowCount === permissions.length
          ? Object.fromEntries(matched.rows.map((row) => [row.permission, row.id]))
          : {},
    };
  }

  async negativeStockApprovalRequired(client: PoolClient, cart: CheckoutCart): Promise<boolean> {
    const result = await client.query<{ required: boolean }>(
      `WITH chosen_mapping AS (
         SELECT l.id AS sale_line_id,l.quantity,selected.*
           FROM merchant.pos_cart_line l
           JOIN LATERAL (
             SELECT candidate.* FROM merchant.inventory_catalog_mapping candidate
              WHERE candidate.merchant_id=l.merchant_id AND candidate.product_id=l.product_id
                AND candidate.active
                AND (candidate.variant_id=l.variant_id OR candidate.variant_id IS NULL)
              ORDER BY (candidate.variant_id=l.variant_id) DESC NULLS LAST LIMIT 1
           ) selected ON true
          WHERE l.cart_id=$1::uuid AND l.merchant_id=$2::uuid
       ), direct AS (
         SELECT m.inventory_item_id,m.quantity::numeric*m.conversion_numerator/
                m.conversion_denominator AS required
           FROM chosen_mapping m WHERE m.mapping_type='direct'
       ), recipe AS (
         SELECT rc.inventory_item_id,
                m.quantity::numeric*rc.quantity*coalesce(lm.quantity,1)*rc.conversion_numerator*
                power(10::numeric,r.yield_scale+i.quantity_scale)/
                (r.yield_quantity*rc.conversion_denominator*
                  power(10::numeric,rc.quantity_scale)) AS required
           FROM chosen_mapping m
           JOIN merchant.inventory_recipe r ON r.id=m.recipe_id AND r.active
           JOIN merchant.inventory_recipe_component rc ON rc.recipe_id=r.id
           JOIN merchant.inventory_item i ON i.id=rc.inventory_item_id AND i.active
           LEFT JOIN merchant.pos_cart_line_modifier lm
             ON lm.line_id=m.sale_line_id AND lm.modifier_id=rc.modifier_id
          WHERE m.mapping_type IN ('recipe','bundle')
            AND (rc.modifier_id IS NULL OR lm.id IS NOT NULL)
       ), required AS (
         SELECT inventory_item_id,sum(required) AS quantity
           FROM (SELECT * FROM direct UNION ALL SELECT * FROM recipe) source
          GROUP BY inventory_item_id
       )
       SELECT coalesce(bool_or(i.negative_stock_policy='manager_override'
                AND coalesce(b.available,0)<ceil(required.quantity)),false) AS required
         FROM required
         JOIN merchant.inventory_item i ON i.id=required.inventory_item_id
         JOIN merchant.inventory_policy p ON p.merchant_id=$2::uuid AND p.location_id=$3::uuid
         LEFT JOIN merchant.stock_balance b ON b.inventory_location_id=p.inventory_location_id
          AND b.inventory_item_id=required.inventory_item_id`,
      [cart.id, cart.merchantId, cart.locationId],
    );
    return result.rows[0]?.required ?? false;
  }

  async lockCart(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    cartId: string,
    expectedVersion: number,
    operatorName: string,
  ): Promise<CheckoutCart | null> {
    const cart = await client.query<Omit<CheckoutCart, 'lines'>>(
      `SELECT c.id::text,c.merchant_id::text AS "merchantId",c.location_id::text AS "locationId",
              c.operator_session_id::text AS "operatorSessionId",c.version,
              c.business_date::text AS "businessDate",b.name AS "merchantName",
              br.name AS "locationName",$6::text AS "operatorName",
              c.customer_id::text AS "customerId"
       FROM merchant.pos_cart c
       JOIN merchant.merchant b ON b.id=c.merchant_id
       JOIN merchant.location br ON br.id=c.location_id
       WHERE c.id=$1::uuid AND c.merchant_id=$2::uuid AND c.location_id=$3::uuid
         AND c.operator_session_id=$4::uuid AND c.version=$5
         AND c.status IN ('draft','prepared')
         AND c.lifecycle_state IN ('building_cart','ready_for_checkout','recovered')
       FOR UPDATE OF c`,
      [cartId, merchantId, locationId, operatorSessionId, expectedVersion, operatorName],
    );
    if (!cart.rows[0]) return null;
    const lines = await client.query<CheckoutLine>(
      `SELECT l.id::text,l.product_id::text AS "productId",
              l.variant_id::text AS "variantId",l.quantity,l.note,
              COALESCE(jsonb_agg(jsonb_build_object('modifierId',m.modifier_id::text,
                'quantity',m.quantity) ORDER BY m.modifier_id)
                FILTER(WHERE m.id IS NOT NULL),'[]') AS modifiers
       FROM merchant.pos_cart_line l
       LEFT JOIN merchant.pos_cart_line_modifier m ON m.line_id=l.id
       WHERE l.merchant_id=$1::uuid AND l.cart_id=$2::uuid
       GROUP BY l.id ORDER BY l.created_at,l.id`,
      [merchantId, cartId],
    );
    return lines.rows.length ? { ...cart.rows[0], lines: lines.rows } : null;
  }

  async reserve(
    client: PoolClient,
    cart: CheckoutCart,
    lineSnapshot: unknown,
    authorization: CheckoutAuthorization,
    commandId: string,
    idempotencyKey: string,
    fingerprint: string,
    correlationId: string,
    negativeStockApprovalId: string | null,
  ): Promise<InventoryReservation> {
    await client.query(`SELECT merchant.expire_inventory_reservations($1::uuid,$2::uuid)`, [
      cart.merchantId,
      cart.locationId,
    ]);
    const { rows } = await client.query<{
      id: string;
      status: InventoryReservation['status'];
      expiresAt: string;
    }>(
      `INSERT INTO merchant.inventory_reservation
         (merchant_id,location_id,cart_id,status,cart_version,line_snapshot,expires_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'reserved',$4,$5,now()+interval '10 minutes')
       ON CONFLICT(cart_id) DO UPDATE SET
         status=CASE WHEN merchant.inventory_reservation.status IN ('released','expired')
                     THEN 'reserved' ELSE merchant.inventory_reservation.status END,
         line_snapshot=excluded.line_snapshot,expires_at=excluded.expires_at,updated_at=now()
       RETURNING id::text,status,expires_at::text AS "expiresAt"`,
      [cart.merchantId, cart.locationId, cart.id, cart.version, JSON.stringify(lineSnapshot)],
    );
    const reservation = rows[0];
    if (!reservation) throw new Error('RESERVATION_CONFLICT');
    const policy = await client.query<{ inventoryLocationId: string }>(
      `SELECT inventory_location_id::text AS "inventoryLocationId"
         FROM merchant.inventory_policy
        WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND tracking_enabled
          AND expires_at>clock_timestamp()`,
      [cart.merchantId, cart.locationId],
    );
    if (policy.rows[0]) {
      const inventoryLocationId = policy.rows[0].inventoryLocationId;
      const mappingCoverage = await client.query<{ mapped: number }>(
        `SELECT count(*)::integer AS mapped FROM merchant.pos_cart_line l
          WHERE l.cart_id=$1::uuid AND l.merchant_id=$2::uuid AND EXISTS (
            SELECT 1 FROM merchant.inventory_catalog_mapping m
             WHERE m.merchant_id=l.merchant_id AND m.product_id=l.product_id AND m.active
               AND (m.variant_id=l.variant_id OR m.variant_id IS NULL)
          )`,
        [cart.id, cart.merchantId],
      );
      if (mappingCoverage.rows[0]?.mapped !== cart.lines.length) {
        throw new ConflictException({ code: 'INVENTORY_MAPPING_REQUIRED' });
      }
      await client.query(
        `UPDATE merchant.inventory_reservation SET status='active',inventory_location_id=$2::uuid,
          command_id=$3::uuid,command_fingerprint=$4,ledger_sequence_basis=(
            SELECT coalesce(max(ledger_sequence),0) FROM merchant.stock_balance
             WHERE inventory_location_id=$2::uuid),updated_at=clock_timestamp()
          WHERE id=$1::uuid AND status IN ('reserved','active')`,
        [reservation.id, inventoryLocationId, commandId, fingerprint],
      );
      const resolved = await client.query<{
        inventoryItemId: string;
        saleLineId: string;
        requiredQuantity: string | null;
        scale: number;
        unit: string;
        mappingId: string;
        mappingVersion: number;
        recipeId: string | null;
        recipeVersion: number | null;
      }>(
        `WITH chosen_mapping AS (
           SELECT l.id AS sale_line_id,selected.*
             FROM merchant.pos_cart_line l
             JOIN LATERAL (
               SELECT candidate.* FROM merchant.inventory_catalog_mapping candidate
                WHERE candidate.merchant_id=l.merchant_id AND candidate.product_id=l.product_id
                  AND candidate.active
                  AND (candidate.variant_id=l.variant_id OR candidate.variant_id IS NULL)
                ORDER BY (candidate.variant_id=l.variant_id) DESC NULLS LAST LIMIT 1
             ) selected ON true
            WHERE l.cart_id=$1::uuid AND l.merchant_id=$2::uuid
         ), direct AS (
           SELECT m.inventory_item_id::text AS "inventoryItemId",l.id::text AS "saleLineId",
                  ((l.quantity::bigint*m.conversion_numerator)/m.conversion_denominator)::text
                    AS "requiredQuantity",
                  i.quantity_scale AS scale,i.base_unit AS unit,m.id::text AS "mappingId",
                  m.version AS "mappingVersion",null::text AS "recipeId",null::integer AS "recipeVersion"
             FROM merchant.pos_cart_line l
             JOIN chosen_mapping m ON m.sale_line_id=l.id AND m.mapping_type='direct'
             JOIN merchant.inventory_item i ON i.id=m.inventory_item_id AND i.active
            WHERE l.cart_id=$1::uuid AND l.merchant_id=$2::uuid
              AND (l.quantity::bigint*m.conversion_numerator)%m.conversion_denominator=0
         ), recipe_component AS (
           SELECT rc.inventory_item_id,l.id AS sale_line_id,m.id AS mapping_id,
                  m.version AS mapping_version,r.id AS recipe_id,r.version AS recipe_version,
                  i.quantity_scale,i.base_unit,
                  (l.quantity::numeric*rc.quantity*coalesce(selected_modifier.quantity,1)*
                    rc.conversion_numerator*
                    power(10::numeric,r.yield_scale+i.quantity_scale)) AS quantity_numerator,
                  (r.yield_quantity::numeric*rc.conversion_denominator*
                    power(10::numeric,rc.quantity_scale)) AS quantity_denominator
             FROM merchant.pos_cart_line l
             JOIN chosen_mapping m ON m.sale_line_id=l.id
              AND m.mapping_type IN ('recipe','bundle')
             JOIN merchant.inventory_recipe r ON r.id=m.recipe_id AND r.active
             JOIN merchant.inventory_recipe_component rc ON rc.recipe_id=r.id
             JOIN merchant.inventory_item i ON i.id=rc.inventory_item_id AND i.active
             LEFT JOIN LATERAL (
               SELECT lm.quantity FROM merchant.pos_cart_line_modifier lm
                WHERE lm.line_id=l.id AND lm.modifier_id=rc.modifier_id
             ) selected_modifier ON rc.modifier_id IS NOT NULL
            WHERE l.cart_id=$1::uuid AND l.merchant_id=$2::uuid
              AND (rc.modifier_id IS NULL OR selected_modifier.quantity IS NOT NULL)
         ), recipe AS (
           SELECT inventory_item_id::text AS "inventoryItemId",sale_line_id::text AS "saleLineId",
                  CASE WHEN bool_and(mod(quantity_numerator,quantity_denominator)=0)
                    THEN sum(quantity_numerator/quantity_denominator)::text ELSE null END
                    AS "requiredQuantity",
                  quantity_scale AS scale,base_unit AS unit,mapping_id::text AS "mappingId",
                  mapping_version AS "mappingVersion",recipe_id::text AS "recipeId",
                  recipe_version AS "recipeVersion"
             FROM recipe_component
            GROUP BY inventory_item_id,sale_line_id,quantity_scale,base_unit,mapping_id,
                     mapping_version,recipe_id,recipe_version
         ) SELECT * FROM direct UNION ALL SELECT * FROM recipe
           ORDER BY "inventoryItemId","saleLineId"`,
        [cart.id, cart.merchantId],
      );
      if (resolved.rows.some((line) => line.requiredQuantity === null)) {
        throw new ConflictException({ code: 'INVENTORY_UNIT_CONVERSION_INVALID' });
      }
      const expectedStockLines = await client.query<{ saleLineId: string }>(
        `SELECT l.id::text AS "saleLineId"
           FROM merchant.pos_cart_line l
           JOIN LATERAL (
             SELECT candidate.mapping_type FROM merchant.inventory_catalog_mapping candidate
              WHERE candidate.merchant_id=l.merchant_id AND candidate.product_id=l.product_id
                AND candidate.active
                AND (candidate.variant_id=l.variant_id OR candidate.variant_id IS NULL)
              ORDER BY (candidate.variant_id=l.variant_id) DESC NULLS LAST LIMIT 1
           ) selected ON selected.mapping_type<>'non_stock'
          WHERE l.cart_id=$1::uuid AND l.merchant_id=$2::uuid
          ORDER BY l.id`,
        [cart.id, cart.merchantId],
      );
      const resolvedSaleLines = new Set(resolved.rows.map((line) => line.saleLineId));
      if (expectedStockLines.rows.some((line) => !resolvedSaleLines.has(line.saleLineId))) {
        throw new ConflictException({ code: 'INVENTORY_CONSUMPTION_REQUIRED' });
      }
      for (const line of resolved.rows) {
        const balance = await client.query<{ sequence: string }>(
          `SELECT coalesce(ledger_sequence,0)::text AS sequence FROM merchant.stock_balance
            WHERE inventory_location_id=$1::uuid AND inventory_item_id=$2::uuid FOR UPDATE`,
          [inventoryLocationId, line.inventoryItemId],
        );
        await client.query(
          `INSERT INTO merchant.inventory_reservation_line(
            merchant_id,location_id,reservation_id,inventory_location_id,inventory_item_id,
            sale_line_id,required_quantity,quantity_scale,unit,mapping_id,mapping_version,
            recipe_id,recipe_version,availability_sequence)
           VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,$10::uuid,
                  $11,$12::uuid,$13,$14)
           ON CONFLICT(reservation_id,inventory_item_id,sale_line_id,mapping_id)
           DO UPDATE SET required_quantity=excluded.required_quantity
           WHERE merchant.inventory_reservation_line.required_quantity=excluded.required_quantity
             AND merchant.inventory_reservation_line.mapping_version=excluded.mapping_version
             AND merchant.inventory_reservation_line.recipe_version IS NOT DISTINCT FROM excluded.recipe_version`,
          [
            cart.merchantId,
            cart.locationId,
            reservation.id,
            inventoryLocationId,
            line.inventoryItemId,
            line.saleLineId,
            line.requiredQuantity!,
            line.scale,
            line.unit,
            line.mappingId,
            line.mappingVersion,
            line.recipeId,
            line.recipeVersion,
            Number(balance.rows[0]?.sequence ?? 0),
          ],
        );
        await client.query(
          `SELECT merchant.append_stock_ledger(
            $1::uuid,$2::uuid,$3::uuid,$4::uuid,'reservation_created',$5,$6::uuid,$7::uuid,$8,
            'inventory_reservation',$9::uuid,$10::uuid,$11::uuid,$12,$13::date,$14,
            null,$15::uuid,null,null,$16::jsonb)`,
          [
            cart.merchantId,
            cart.locationId,
            inventoryLocationId,
            line.inventoryItemId,
            line.requiredQuantity!,
            commandId,
            idempotencyKey,
            fingerprint,
            reservation.id,
            authorization.operatorId,
            authorization.deviceId,
            authorization.credentialVersion,
            cart.businessDate,
            correlationId,
            line.saleLineId,
            JSON.stringify({
              mappingId: line.mappingId,
              mappingVersion: line.mappingVersion,
              recipeId: line.recipeId,
              recipeVersion: line.recipeVersion,
              negativeStockApprovalId,
            }),
          ],
        );
      }
      reservation.status = 'active';
    }
    return {
      ...reservation,
      lineCount: cart.lines.length,
    };
  }

  async payments(
    client: PoolClient,
    cart: CheckoutCart,
    checkoutId: string,
    summary: PaymentSummary,
    correlationId: string,
  ): Promise<PaymentOutcome[]> {
    const outcomes: PaymentOutcome[] = [];
    for (const [position, tender] of summary.tenders.entries()) {
      const tenderFact = await client.query<{ id: string }>(
        `INSERT INTO merchant.pos_tender_fact
           (id,merchant_id,location_id,checkout_id,cart_id,position,tender_type,status,
            amount_minor_units,received_minor_units,change_minor_units,currency,correlation_id)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT(id) DO UPDATE SET id=excluded.id
         WHERE merchant.pos_tender_fact.merchant_id=excluded.merchant_id
           AND merchant.pos_tender_fact.location_id=excluded.location_id
           AND merchant.pos_tender_fact.checkout_id=excluded.checkout_id
           AND merchant.pos_tender_fact.cart_id=excluded.cart_id
           AND merchant.pos_tender_fact.position=excluded.position
           AND merchant.pos_tender_fact.tender_type=excluded.tender_type
           AND merchant.pos_tender_fact.status=excluded.status
           AND merchant.pos_tender_fact.amount_minor_units=excluded.amount_minor_units
           AND merchant.pos_tender_fact.received_minor_units
             IS NOT DISTINCT FROM excluded.received_minor_units
           AND merchant.pos_tender_fact.change_minor_units=excluded.change_minor_units
           AND merchant.pos_tender_fact.currency=excluded.currency
         RETURNING id::text`,
        [
          tender.tenderId,
          cart.merchantId,
          cart.locationId,
          checkoutId,
          cart.id,
          position,
          tender.type,
          tender.status,
          tender.applied.minorUnits,
          tender.received?.minorUnits ?? null,
          tender.change.minorUnits,
          tender.applied.currency,
          correlationId,
        ],
      );
      if (tenderFact.rowCount !== 1) {
        throw new Error('Tender identity conflicts with another checkout.');
      }
      const method: PaymentMethod = tender.type === 'cash' ? 'cash' : 'external_terminal';
      const { rows } = await client.query<{
        id: string;
        method: PaymentMethod;
        amountMinorUnits: string;
        currency: string;
        status: 'succeeded';
        queryOnly: boolean;
        correlationId: string;
        expiresAt: string | null;
        createdAt: string;
      }>(
        `INSERT INTO merchant.pos_payment_attempt
           (merchant_id,location_id,cart_id,tender_id,method,amount_minor_units,currency,
            status,query_only,correlation_id,resolved_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,'succeeded',false,$8,now())
         ON CONFLICT(merchant_id,cart_id,tender_id) DO UPDATE SET
           tender_id=excluded.tender_id
         WHERE merchant.pos_payment_attempt.location_id=excluded.location_id
           AND merchant.pos_payment_attempt.method=excluded.method
           AND merchant.pos_payment_attempt.amount_minor_units=excluded.amount_minor_units
           AND merchant.pos_payment_attempt.currency=excluded.currency
           AND merchant.pos_payment_attempt.status='succeeded'
           AND merchant.pos_payment_attempt.query_only=false
         RETURNING id::text,method,amount_minor_units::text AS "amountMinorUnits",
                   currency,status,query_only AS "queryOnly",
                   correlation_id AS "correlationId",expires_at::text AS "expiresAt",
                   created_at::text AS "createdAt"`,
        [
          cart.merchantId,
          cart.locationId,
          cart.id,
          tender.tenderId,
          method,
          tender.applied.minorUnits,
          tender.applied.currency,
          correlationId,
        ],
      );
      const attempt = rows[0];
      if (!attempt) {
        throw new Error('Payment identity conflicts with another tender result.');
      }
      outcomes.push({
        attempt: {
          id: attempt.id,
          method: attempt.method,
          amount: {
            minorUnits: Number(attempt.amountMinorUnits),
            currency: attempt.currency,
          },
          status: attempt.status,
          expiresAt: attempt.expiresAt,
          correlationId: attempt.correlationId,
          queryOnly: attempt.queryOnly,
          createdAt: attempt.createdAt,
        },
        ambiguity: null,
      });
    }
    return outcomes;
  }

  async unknownTerminal(
    client: PoolClient,
    cart: CheckoutCart,
    checkoutId: string,
    tender: PaymentSummary['tenders'][number],
    correlationId: string,
  ): Promise<PaymentOutcome> {
    const tenderFact = await client.query<{ id: string }>(
      `INSERT INTO merchant.pos_tender_fact
         (id,merchant_id,location_id,checkout_id,cart_id,position,tender_type,status,
          amount_minor_units,received_minor_units,change_minor_units,currency,correlation_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,0,'manual_terminal',
               'outcome_unknown',$6,null,0,$7,$8)
       ON CONFLICT(id) DO UPDATE SET id=excluded.id
       WHERE merchant.pos_tender_fact.merchant_id=excluded.merchant_id
         AND merchant.pos_tender_fact.location_id=excluded.location_id
         AND merchant.pos_tender_fact.checkout_id=excluded.checkout_id
         AND merchant.pos_tender_fact.cart_id=excluded.cart_id
         AND merchant.pos_tender_fact.position=excluded.position
         AND merchant.pos_tender_fact.tender_type=excluded.tender_type
         AND merchant.pos_tender_fact.status=excluded.status
         AND merchant.pos_tender_fact.amount_minor_units=excluded.amount_minor_units
         AND merchant.pos_tender_fact.received_minor_units
           IS NOT DISTINCT FROM excluded.received_minor_units
         AND merchant.pos_tender_fact.change_minor_units=excluded.change_minor_units
         AND merchant.pos_tender_fact.currency=excluded.currency
       RETURNING id::text`,
      [
        tender.tenderId,
        cart.merchantId,
        cart.locationId,
        checkoutId,
        cart.id,
        tender.applied.minorUnits,
        tender.applied.currency,
        correlationId,
      ],
    );
    if (tenderFact.rowCount !== 1) {
      throw new Error('Tender identity conflicts with another checkout.');
    }
    const { rows } = await client.query<{
      id: string;
      amountMinorUnits: string;
      currency: string;
      correlationId: string;
      expiresAt: string;
      createdAt: string;
    }>(
      `INSERT INTO merchant.pos_payment_attempt
         (merchant_id,location_id,cart_id,tender_id,method,amount_minor_units,currency,
          status,query_only,correlation_id,expires_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'external_terminal',$5,$6,
               'unknown',true,$7,now()+interval '10 minutes')
       ON CONFLICT(merchant_id,cart_id,tender_id) DO UPDATE SET tender_id=excluded.tender_id
       WHERE merchant.pos_payment_attempt.location_id=excluded.location_id
         AND merchant.pos_payment_attempt.method=excluded.method
         AND merchant.pos_payment_attempt.amount_minor_units=excluded.amount_minor_units
         AND merchant.pos_payment_attempt.currency=excluded.currency
         AND merchant.pos_payment_attempt.status IN ('unknown','timeout')
         AND merchant.pos_payment_attempt.query_only=true
       RETURNING id::text,amount_minor_units::text AS "amountMinorUnits",currency,
                 correlation_id AS "correlationId",expires_at::text AS "expiresAt",
                 created_at::text AS "createdAt"`,
      [
        cart.merchantId,
        cart.locationId,
        cart.id,
        tender.tenderId,
        tender.applied.minorUnits,
        tender.applied.currency,
        correlationId,
      ],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('Payment identity conflicts with another tender result.');
    }
    return {
      attempt: {
        id: row.id,
        method: 'external_terminal',
        amount: { minorUnits: Number(row.amountMinorUnits), currency: row.currency },
        status: 'unknown',
        expiresAt: row.expiresAt,
        correlationId: row.correlationId,
        queryOnly: true,
        createdAt: row.createdAt,
      },
      ambiguity: {
        paymentRef: row.id,
        status: 'unknown',
        queryOnly: true,
        canRetryAsNew: false,
        queryAfter: row.expiresAt,
        correlationId: row.correlationId,
      },
    };
  }

  async commit(
    client: PoolClient,
    cart: CheckoutCart,
    confirmation: TotalsConfirmation,
    payments: PaymentOutcome[],
    paymentSummary: PaymentSummary,
    checkoutId: string,
    reservation: InventoryReservation,
    receipt: ReceiptSnapshot,
    cashShiftId: string | null,
    commandId: string,
    authorization: CheckoutAuthorization,
    correlationId: string,
  ): Promise<NonNullable<CheckoutResult['sale']>> {
    const cashTenders = paymentSummary.tenders.filter((tender) => tender.type === 'cash');
    if (cashTenders.length > 0 && cashShiftId === null) {
      throw new Error('CASH_SHIFT_REQUIRED');
    }
    if (cashTenders.length > 1) {
      throw new Error('MULTIPLE_CASH_TENDERS_NOT_ALLOWED');
    }
    if (cashShiftId) {
      const eligible = await client.query(
        `SELECT 1
         FROM merchant.cash_shift s
         JOIN merchant.pos_checkout_draft d ON d.id=$6::uuid AND d.cash_shift_id=s.id
         WHERE s.id=$1::uuid AND s.merchant_id=$2::uuid AND s.location_id=$3::uuid
           AND s.operator_session_id=$4::uuid AND s.status='open' AND s.currency=$5
         FOR UPDATE OF s`,
        [
          cashShiftId,
          cart.merchantId,
          cart.locationId,
          cart.operatorSessionId,
          confirmation.totals.grandTotal.currency,
          checkoutId,
        ],
      );
      if (!eligible.rows[0]) throw new Error('CASH_SHIFT_NOT_ELIGIBLE');
    }
    const writtenOrder = await writeOrder(client, {
      merchantId: cart.merchantId,
      locationId: cart.locationId,
      customerId: cart.customerId,
      source: 'pos',
      fulfillmentType: 'dine_in',
      externalRef: `pos-cart:${cart.id}`,
      lines: receipt.lines.map((line, index) => ({
        productId: cart.lines[index]?.productId ?? null,
        name: line.description,
        variantName: line.variantName ?? null,
        quantity: line.quantity,
        unitPriceCents: line.unitPrice.minorUnits,
        notes: line.note ?? null,
        modifiers: (line.modifiers ?? []).map((name) => ({ name, priceDeltaCents: 0 })),
      })),
    });
    const orderId = writtenOrder.orderId;
    await client.query(
      `INSERT INTO merchant.payment (id,order_id,amount,method,external_ref,status,paid_at)
       VALUES ($1::uuid,$2::uuid,$3,$4,$1::text,'captured',now())
       ON CONFLICT(id) DO NOTHING`,
      [
        payments[0].attempt.id,
        orderId,
        payments[0].attempt.amount.minorUnits,
        payments[0].attempt.method === 'cash' ? 'cash' : 'card',
      ],
    );
    for (const payment of payments.slice(1)) {
      await client.query(
        `INSERT INTO merchant.payment (id,order_id,amount,method,external_ref,status,paid_at)
         VALUES ($1::uuid,$2::uuid,$3,$4,$1::text,'captured',now())
         ON CONFLICT(id) DO NOTHING`,
        [
          payment.attempt.id,
          orderId,
          payment.attempt.amount.minorUnits,
          payment.attempt.method === 'cash' ? 'cash' : 'card',
        ],
      );
    }
    const receiptRow = await client.query<{ id: string }>(
      `INSERT INTO merchant.receipt_snapshot
         (merchant_id,location_id,order_id,payment_attempt_id,receipt_number,
          business_date,currency,grand_total,snapshot,receipt_destination,delivery_intent)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::date,$7,$8,$9,$10,$11)
       RETURNING id::text`,
      [
        cart.merchantId,
        cart.locationId,
        orderId,
        payments[0].attempt.id,
        receipt.receiptRef,
        receipt.businessDate,
        receipt.currency,
        receipt.grandTotal.minorUnits,
        receipt,
        receipt.receiptDestination ?? 'display',
        receipt.receiptDestination === 'digital'
          ? JSON.stringify({ destination: 'digital', deliveryStatus: 'not_sent' })
          : null,
      ],
    );
    const sale = await client.query<{ id: string; committedAt: string }>(
      `INSERT INTO merchant.pos_committed_sale
         (merchant_id,location_id,cart_id,order_id,payment_attempt_id,
          receipt_snapshot_id,totals_fingerprint,cash_shift_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8::uuid)
       RETURNING id::text,committed_at::text AS "committedAt"`,
      [
        cart.merchantId,
        cart.locationId,
        cart.id,
        orderId,
        payments[0].attempt.id,
        receiptRow.rows[0].id,
        confirmation.fingerprint,
        cashShiftId,
      ],
    );
    if (cashShiftId && cashTenders[0]) {
      const cash = cashTenders[0];
      const shift = await client.query<{ sequence: string; registerId: string }>(
        `SELECT (ledger_sequence+1)::text AS sequence,
                register_id::text AS "registerId"
         FROM merchant.cash_shift
         WHERE id=$1::uuid AND status='open'
         FOR UPDATE`,
        [cashShiftId],
      );
      if (!shift.rows[0]) throw new Error('CASH_SHIFT_NOT_ELIGIBLE');
      await client.query(
        `INSERT INTO merchant.cash_ledger_entry
           (merchant_id,location_id,register_id,shift_id,sequence,entry_type,
            amount_minor_units,cash_received_minor_units,change_given_minor_units,
            currency,command_id,sale_id,tender_fact_id,business_date,public_data)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'cash_sale',$6,$7,$8,$9,
                 $10::uuid,$11::uuid,$12::uuid,$13::date,
                 jsonb_build_object('checkoutId',$14::text))`,
        [
          cart.merchantId,
          cart.locationId,
          shift.rows[0].registerId,
          cashShiftId,
          shift.rows[0].sequence,
          cash.applied.minorUnits,
          cash.received?.minorUnits ?? cash.applied.minorUnits,
          cash.change.minorUnits,
          cash.applied.currency,
          commandId,
          sale.rows[0].id,
          cash.tenderId,
          cart.businessDate,
          checkoutId,
        ],
      );
      await client.query(
        `UPDATE merchant.cash_shift
         SET ledger_sequence=$2,version=version+1
         WHERE id=$1::uuid`,
        [cashShiftId, shift.rows[0].sequence],
      );
    }
    await client.query(
      `SELECT merchant.commit_sale_inventory($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7::date,$8)`,
      [
        reservation.id,
        sale.rows[0].id,
        commandId,
        authorization.operatorId,
        authorization.deviceId,
        authorization.credentialVersion,
        cart.businessDate,
        correlationId,
      ],
    );
    await client.query(
      `UPDATE merchant.pos_tender_fact
       SET status='committed',committed_at=now()
       WHERE checkout_id=$1::uuid AND status IN ('draft','confirmed_success')`,
      [checkoutId],
    );
    await client.query(
      `UPDATE merchant.pos_checkout_draft
       SET payment_summary=$2,updated_at=now()
       WHERE id=$1::uuid AND state NOT IN ('completed','receipt_available')`,
      [checkoutId, JSON.stringify({ ...paymentSummary, state: 'completed' })],
    );
    await client.query(
      `UPDATE merchant.pos_cart
       SET status='committed',lifecycle_state='committed',updated_at=now()
       WHERE id=$1::uuid AND version=$2`,
      [cart.id, cart.version],
    );
    return {
      id: sale.rows[0].id,
      orderId,
      receiptId: receiptRow.rows[0].id,
      receiptRef: receipt.receiptRef,
      status: 'committed',
      committedAt: sale.rows[0].committedAt,
      totals: confirmation.totals,
    };
  }

  async saveCommittedResult(
    client: PoolClient,
    checkoutId: string,
    result: CheckoutResult,
  ): Promise<void> {
    const { rowCount } = await client.query(
      `UPDATE merchant.pos_checkout_draft
       SET state='completed',checkout_result=$2,updated_at=now()
       WHERE id=$1::uuid AND state NOT IN ('completed','receipt_available')
         AND checkout_result IS NULL`,
      [checkoutId, JSON.stringify(result)],
    );
    if (rowCount !== 1) {
      throw new Error('Committed checkout result was not persisted exactly once.');
    }
  }

  async recovery(
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    cartId: string,
    currentUserId: string,
    allowOtherOperator: boolean,
  ): Promise<CheckoutRecoverySnapshot | null> {
    return this.pg.runWithMerchant(
      merchantId,
      currentUserId,
      async (client) => {
        const scope = await client.query(
          `SELECT 1
       FROM merchant.pos_checkout_draft checkout
       JOIN runtime.operator_session current_operator
         ON current_operator.id=$3::uuid
        AND current_operator.merchant_id=checkout.merchant_id
        AND current_operator.location_id=checkout.location_id
        AND current_operator.user_id=$5::uuid
        AND current_operator.state='active'
        AND current_operator.expires_at>now()
       JOIN runtime.operator_session original_operator
         ON original_operator.id=checkout.operator_session_id
       WHERE checkout.merchant_id=$1::uuid AND checkout.location_id=$2::uuid
         AND checkout.cart_id=$4::uuid
         AND (checkout.operator_session_id=$3::uuid
           OR original_operator.user_id=current_operator.user_id
           OR $6::boolean)`,
          [merchantId, locationId, operatorSessionId, cartId, currentUserId, allowOtherOperator],
        );
        if (!scope.rows[0]) return null;
        const { rows } = await client.query<{
          checkoutId: string;
          cartId: string;
          checkoutVersion: number;
          state: CheckoutRecoverySnapshot['state'];
          tenderDrafts: CheckoutRecoverySnapshot['tenderDrafts'];
          tipDraft: CheckoutRecoverySnapshot['tipDraft'];
          discountDrafts: CheckoutRecoverySnapshot['discountDrafts'];
          receiptDelivery: CheckoutRecoverySnapshot['receiptDelivery'];
          paymentSummary: CheckoutRecoverySnapshot['paymentSummary'];
          recoveryState: CheckoutRecoverySnapshot['recoveryState'];
          checkoutFingerprint: string | null;
          result: CheckoutRecoverySnapshot['result'];
          updatedAt: string;
        }>(
          `SELECT checkout.id::text AS "checkoutId",checkout.cart_id::text AS "cartId",
                checkout.version AS "checkoutVersion",checkout.state,
                checkout.tender_drafts AS "tenderDrafts",
                checkout.tip_draft AS "tipDraft",
                checkout.discount_drafts AS "discountDrafts",
                checkout.receipt_delivery AS "receiptDelivery",
                CASE WHEN checkout.payment_summary IS NULL THEN NULL
                  ELSE jsonb_set(checkout.payment_summary,'{checkoutId}',
                    to_jsonb(checkout.id::text),true)
                END AS "paymentSummary",
                checkout.recovery_state AS "recoveryState",
                checkout.command_fingerprint AS "checkoutFingerprint",
                checkout.checkout_result AS result,
                checkout.updated_at::text AS "updatedAt"
         FROM merchant.pos_checkout_draft checkout
         WHERE checkout.merchant_id=$1::uuid AND checkout.location_id=$2::uuid
           AND checkout.cart_id=$3::uuid`,
          [merchantId, locationId, cartId],
        );
        const snapshot = rows[0];
        if (!snapshot) return null;
        const payment = await client.query<{
          id: string;
          method: PaymentMethod;
          amountMinorUnits: string;
          currency: string;
          status: PaymentOutcome['attempt']['status'];
          queryOnly: boolean;
          correlationId: string;
          expiresAt: string | null;
          createdAt: string;
        }>(
          `SELECT id::text,method,amount_minor_units::text AS "amountMinorUnits",currency,
                status,query_only AS "queryOnly",correlation_id AS "correlationId",
                expires_at::text AS "expiresAt",created_at::text AS "createdAt"
         FROM merchant.pos_payment_attempt
         WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND cart_id=$3::uuid
           AND status IN ('unknown','timeout')
         ORDER BY created_at DESC
         LIMIT 1`,
          [merchantId, locationId, cartId],
        );
        const row = payment.rows[0];
        const paymentOutcome: PaymentOutcome | null = row
          ? {
              attempt: {
                id: row.id,
                method: row.method,
                amount: {
                  minorUnits: Number(row.amountMinorUnits),
                  currency: row.currency,
                },
                status: row.status,
                expiresAt: row.expiresAt,
                queryOnly: row.queryOnly,
                correlationId: row.correlationId,
                createdAt: row.createdAt,
              },
              ambiguity: {
                paymentRef: row.id,
                status: 'unknown',
                queryOnly: true,
                canRetryAsNew: false,
                queryAfter: row.expiresAt,
                correlationId: row.correlationId,
              },
            }
          : null;
        return { ...snapshot, paymentOutcome };
      },
      locationId,
    );
  }

  async cancelDraft(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    cartId: string,
  ): Promise<{ id: string | null; blocked: boolean }> {
    const { rows } = await client.query<{
      id: string;
      state: string;
      tenderDrafts: CheckoutRecoverySnapshot['tenderDrafts'];
    }>(
      `SELECT id::text,state,tender_drafts AS "tenderDrafts"
       FROM merchant.pos_checkout_draft
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid
         AND operator_session_id=$3::uuid AND cart_id=$4::uuid
       FOR UPDATE`,
      [merchantId, locationId, operatorSessionId, cartId],
    );
    const draft = rows[0];
    if (!draft) return { id: null, blocked: false };
    const terminalFactRequiresRecovery = draft.tenderDrafts.some(
      (tender) =>
        tender.type === 'manual_terminal' &&
        (tender.status === 'confirmed_success' || tender.status === 'outcome_unknown'),
    );
    if (
      draft.state === 'payment_unknown' ||
      draft.state === 'completed' ||
      terminalFactRequiresRecovery
    ) {
      return { id: draft.id, blocked: true };
    }
    await client.query(
      `DELETE FROM merchant.pos_tender_fact
       WHERE checkout_id=$1::uuid AND status NOT IN ('committed','outcome_unknown')`,
      [draft.id],
    );
    await client.query(
      `UPDATE merchant.pos_checkout_draft
       SET state='ready',tender_drafts='[]',tip_draft=null,discount_drafts='[]',
           payment_summary=null,recovery_state='none',command_fingerprint=null,
           version=version+1,updated_at=now()
       WHERE id=$1::uuid`,
      [draft.id],
    );
    await client.query(
      `SELECT merchant.release_inventory_reservation(id,'reservation_released')
         FROM merchant.inventory_reservation
        WHERE cart_id=$1::uuid AND status IN ('active','reserved')`,
      [cartId],
    );
    return { id: draft.id, blocked: false };
  }

  async paymentStatus(
    merchantId: string,
    locationId: string,
    paymentId: string,
  ): Promise<PaymentOutcome | null> {
    return this.pg.runWithMerchant(
      merchantId,
      null,
      async (client) => {
        await client.query(
          `UPDATE merchant.pos_payment_attempt
           SET status='timeout',query_only=true,resolved_at=now()
           WHERE id=$1::uuid AND merchant_id=$2::uuid AND location_id=$3::uuid
             AND status IN ('pending','unknown') AND expires_at<=now()`,
          [paymentId, merchantId, locationId],
        );
        const { rows } = await client.query<{
          id: string;
          method: PaymentMethod;
          amountMinorUnits: string;
          currency: string;
          status: PaymentOutcome['attempt']['status'];
          queryOnly: boolean;
          correlationId: string;
          expiresAt: string | null;
          createdAt: string;
        }>(
          `SELECT id::text,method,amount_minor_units::text AS "amountMinorUnits",currency,
                  status,query_only AS "queryOnly",correlation_id AS "correlationId",
                  expires_at::text AS "expiresAt",created_at::text AS "createdAt"
           FROM merchant.pos_payment_attempt
           WHERE id=$1::uuid AND merchant_id=$2::uuid AND location_id=$3::uuid`,
          [paymentId, merchantId, locationId],
        );
        if (!rows[0]) return null;
        const row = rows[0];
        const attempt = {
          id: row.id,
          method: row.method,
          amount: { minorUnits: Number(row.amountMinorUnits), currency: row.currency },
          status: row.status,
          expiresAt: row.expiresAt,
          queryOnly: row.queryOnly,
          correlationId: row.correlationId,
          createdAt: row.createdAt,
        };
        return {
          attempt,
          ambiguity:
            row.status === 'unknown' || row.status === 'timeout'
              ? {
                  paymentRef: row.id,
                  status: 'unknown',
                  queryOnly: true,
                  canRetryAsNew: false,
                  queryAfter: row.expiresAt,
                  correlationId: row.correlationId,
                }
              : null,
        };
      },
      locationId,
    );
  }
}
