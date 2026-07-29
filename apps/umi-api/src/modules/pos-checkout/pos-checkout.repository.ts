import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  CheckoutResult,
  InventoryReservation,
  PaymentMethod,
  PaymentOutcome,
  ReceiptSnapshot,
  TotalsConfirmation,
} from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';

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
  tenantId: string;
  branchId: string;
  operatorSessionId: string;
  version: number;
  businessDate: string;
  tenantName: string;
  branchName: string;
  operatorName: string;
  lines: CheckoutLine[];
}

export interface CheckoutAuthorization {
  operatorName: string;
}

@Injectable()
export class PosCheckoutRepository {
  constructor(private readonly pg: PgService) {}

  async authorize(
    userId: string,
    sessionId: string,
    deviceId: string,
    tenantId: string,
    branchId: string,
    operatorSessionId: string,
  ): Promise<CheckoutAuthorization | null> {
    const { rows } = await this.pg.worker.query<CheckoutAuthorization>(
      `SELECT u.full_name AS "operatorName"
       FROM runtime.operator_session os
       JOIN tenant.device d ON d.id=os.device_id
       JOIN umi.user u ON u.id=os.user_id
       WHERE os.id=$6::uuid AND os.durable_session_id=$2::uuid AND os.user_id=$1::uuid
         AND os.device_id=$3::uuid AND os.business_id=$4::uuid AND os.branch_id=$5::uuid
         AND os.state='active' AND os.expires_at>now() AND d.lifecycle_state='active'
         AND ('checkout.commit'=ANY(os.permissions) OR '*'=ANY(os.permissions))
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(os.entitlements) e
           WHERE e->>'featureKey'='pos' AND COALESCE((e->>'enabled')::boolean,false))`,
      [userId, sessionId, deviceId, tenantId, branchId, operatorSessionId],
    );
    return rows[0] ?? null;
  }

  async lockCart(
    client: PoolClient,
    tenantId: string,
    branchId: string,
    operatorSessionId: string,
    cartId: string,
    expectedVersion: number,
    operatorName: string,
  ): Promise<CheckoutCart | null> {
    const cart = await client.query<Omit<CheckoutCart, 'lines'>>(
      `SELECT c.id::text,c.business_id::text AS "tenantId",c.branch_id::text AS "branchId",
              c.operator_session_id::text AS "operatorSessionId",c.version,
              c.business_date::text AS "businessDate",b.name AS "tenantName",
              br.name AS "branchName",$6::text AS "operatorName"
       FROM tenant.pos_cart c
       JOIN tenant.business b ON b.id=c.business_id
       JOIN tenant.branch br ON br.id=c.branch_id
       WHERE c.id=$1::uuid AND c.business_id=$2::uuid AND c.branch_id=$3::uuid
         AND c.operator_session_id=$4::uuid AND c.version=$5
         AND c.status IN ('draft','prepared')
       FOR UPDATE OF c`,
      [cartId, tenantId, branchId, operatorSessionId, expectedVersion, operatorName],
    );
    if (!cart.rows[0]) return null;
    const lines = await client.query<CheckoutLine>(
      `SELECT l.id::text,l.product_id::text AS "productId",
              l.variant_id::text AS "variantId",l.quantity,l.note,
              COALESCE(jsonb_agg(jsonb_build_object('modifierId',m.modifier_id::text,
                'quantity',m.quantity) ORDER BY m.modifier_id)
                FILTER(WHERE m.id IS NOT NULL),'[]') AS modifiers
       FROM tenant.pos_cart_line l
       LEFT JOIN tenant.pos_cart_line_modifier m ON m.line_id=l.id
       WHERE l.business_id=$1::uuid AND l.cart_id=$2::uuid
       GROUP BY l.id ORDER BY l.created_at,l.id`,
      [tenantId, cartId],
    );
    return lines.rows.length ? { ...cart.rows[0], lines: lines.rows } : null;
  }

  async reserve(
    client: PoolClient,
    cart: CheckoutCart,
    lineSnapshot: unknown,
  ): Promise<InventoryReservation> {
    const { rows } = await client.query<{
      id: string;
      status: InventoryReservation['status'];
      expiresAt: string;
    }>(
      `INSERT INTO tenant.inventory_reservation
         (business_id,branch_id,cart_id,status,cart_version,line_snapshot,expires_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'reserved',$4,$5,now()+interval '10 minutes')
       ON CONFLICT(cart_id) DO UPDATE SET
         status=CASE WHEN tenant.inventory_reservation.status IN ('released','expired')
                     THEN 'reserved' ELSE tenant.inventory_reservation.status END,
         line_snapshot=excluded.line_snapshot,expires_at=excluded.expires_at,updated_at=now()
       RETURNING id::text,status,expires_at::text AS "expiresAt"`,
      [cart.tenantId, cart.branchId, cart.id, cart.version, JSON.stringify(lineSnapshot)],
    );
    return {
      ...rows[0],
      lineCount: cart.lines.length,
    };
  }

  async payment(
    client: PoolClient,
    cart: CheckoutCart,
    method: PaymentMethod,
    confirmation: TotalsConfirmation,
    correlationId: string,
  ): Promise<PaymentOutcome> {
    const amount = confirmation.totals.grandTotal;
    const status = method === 'cash' ? 'succeeded' : 'unknown';
    const { rows } = await client.query<{
      id: string;
      method: PaymentMethod;
      amountMinorUnits: string;
      currency: string;
      status: 'succeeded' | 'unknown';
      queryOnly: boolean;
      correlationId: string;
      expiresAt: string | null;
      createdAt: string;
    }>(
      `INSERT INTO tenant.pos_payment_attempt
         (business_id,branch_id,cart_id,method,amount_minor_units,currency,status,
          query_only,correlation_id,expires_at,resolved_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$7='unknown',$8,
               CASE WHEN $7='unknown' THEN now()+interval '10 minutes' END,
               CASE WHEN $7='succeeded' THEN now() END)
       ON CONFLICT(business_id,cart_id) DO UPDATE SET cart_id=excluded.cart_id
       RETURNING id::text,method,amount_minor_units::text AS "amountMinorUnits",currency,status,
                 query_only AS "queryOnly",correlation_id AS "correlationId",
                 expires_at::text AS "expiresAt",created_at::text AS "createdAt"`,
      [
        cart.tenantId,
        cart.branchId,
        cart.id,
        method,
        amount.minorUnits,
        amount.currency,
        status,
        correlationId,
      ],
    );
    const attempt = rows[0];
    return {
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
      ambiguity:
        attempt.status === 'unknown'
          ? {
              paymentRef: attempt.id,
              status: 'unknown',
              queryOnly: true,
              canRetryAsNew: false,
              queryAfter: attempt.expiresAt,
              correlationId: attempt.correlationId,
            }
          : null,
    };
  }

  async commit(
    client: PoolClient,
    cart: CheckoutCart,
    confirmation: TotalsConfirmation,
    payment: PaymentOutcome,
    reservation: InventoryReservation,
    receipt: ReceiptSnapshot,
  ): Promise<NonNullable<CheckoutResult['sale']>> {
    const order = await client.query<{ id: string }>(
      `INSERT INTO tenant.customer_order
         (business_id,branch_id,source,fulfillment_type,status,external_ref)
       VALUES ($1::uuid,$2::uuid,'pos','dine_in','placed',$3)
       ON CONFLICT(business_id,external_ref) WHERE external_ref IS NOT NULL
       DO UPDATE SET external_ref=excluded.external_ref RETURNING id::text`,
      [cart.tenantId, cart.branchId, `pos-cart:${cart.id}`],
    );
    const orderId = order.rows[0].id;
    for (const [index, line] of receipt.lines.entries()) {
      await client.query(
        `INSERT INTO tenant.order_item
           (order_id,product_id,name,variant_name,quantity,unit_price,display_order,notes)
         VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8)`,
        [
          orderId,
          cart.lines[index].productId,
          line.description,
          line.variantName ?? null,
          line.quantity,
          line.unitPrice.minorUnits,
          index,
          line.note ?? null,
        ],
      );
    }
    await client.query(
      `INSERT INTO tenant.payment (id,order_id,amount,method,external_ref,status,paid_at)
       VALUES ($1::uuid,$2::uuid,$3,$4,$1::text,'captured',now())
       ON CONFLICT(id) DO NOTHING`,
      [
        payment.attempt.id,
        orderId,
        confirmation.totals.grandTotal.minorUnits,
        payment.attempt.method === 'cash' ? 'cash' : 'card',
      ],
    );
    const receiptRow = await client.query<{ id: string }>(
      `INSERT INTO tenant.receipt_snapshot
         (business_id,branch_id,order_id,payment_attempt_id,receipt_number,
          business_date,currency,grand_total,snapshot)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::date,$7,$8,$9)
       RETURNING id::text`,
      [
        cart.tenantId,
        cart.branchId,
        orderId,
        payment.attempt.id,
        receipt.receiptRef,
        receipt.businessDate,
        receipt.currency,
        receipt.grandTotal.minorUnits,
        receipt,
      ],
    );
    const sale = await client.query<{ id: string; committedAt: string }>(
      `INSERT INTO tenant.pos_committed_sale
         (business_id,branch_id,cart_id,order_id,payment_attempt_id,
          receipt_snapshot_id,totals_fingerprint)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7)
       RETURNING id::text,committed_at::text AS "committedAt"`,
      [
        cart.tenantId,
        cart.branchId,
        cart.id,
        orderId,
        payment.attempt.id,
        receiptRow.rows[0].id,
        confirmation.fingerprint,
      ],
    );
    await client.query(
      `UPDATE tenant.inventory_reservation SET status='commit_prepared',updated_at=now()
       WHERE id=$1::uuid AND status='reserved'`,
      [reservation.id],
    );
    await client.query(
      `UPDATE tenant.pos_cart SET status='committed',updated_at=now()
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

  async paymentStatus(
    tenantId: string,
    branchId: string,
    paymentId: string,
  ): Promise<PaymentOutcome | null> {
    return this.pg.runWithTenant(
      tenantId,
      null,
      async (client) => {
        await client.query(
          `UPDATE tenant.pos_payment_attempt
           SET status='timeout',query_only=true,resolved_at=now()
           WHERE id=$1::uuid AND business_id=$2::uuid AND branch_id=$3::uuid
             AND status IN ('pending','unknown') AND expires_at<=now()`,
          [paymentId, tenantId, branchId],
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
           FROM tenant.pos_payment_attempt
           WHERE id=$1::uuid AND business_id=$2::uuid AND branch_id=$3::uuid`,
          [paymentId, tenantId, branchId],
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
      branchId,
    );
  }
}
