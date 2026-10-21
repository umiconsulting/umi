import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  PosCustomerSearchQuery,
  CancelCarriedOverAccountsRequest,
  SaleHistoryQuery,
  SaleReceiptResult,
  SaleSnapshot,
} from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import { PosCartRepository } from '../pos-cart/pos-cart.repository';
import { receiptTimeInZone } from '../../shared/receipts/receipt-time';

const ACTIVE_STATES = "('building_cart','ready_for_checkout','recovered')";

@Injectable()
export class PosSaleRepository {
  constructor(
    private readonly pg: PgService,
    private readonly carts: PosCartRepository,
  ) {}

  async authorize(
    userId: string,
    sessionId: string,
    deviceId: string,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    permission = 'sale.lifecycle',
  ): Promise<boolean> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const { rowCount } = await client.query(
          `SELECT 1
       FROM runtime.operator_session os
       JOIN merchant.device d ON d.id=os.device_id
       WHERE os.id=$6::uuid
         AND os.durable_session_id=$2::uuid
         AND os.user_id=$1::uuid
         AND os.device_id=$3::uuid
         AND os.merchant_id=$4::uuid
         AND os.location_id=$5::uuid
         AND os.state='active'
         AND os.expires_at>now()
         AND d.status='active'
         AND ($7=ANY(os.permissions) OR '*'=ANY(os.permissions))
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements(os.entitlements) e
           WHERE e->>'featureKey'='pos'
             AND COALESCE((e->>'enabled')::boolean,false)
         )`,
          [userId, sessionId, deviceId, merchantId, locationId, operatorSessionId, permission],
        );
        return (rowCount ?? 0) > 0;
      },
      locationId,
    );
  }

  async start(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
  ): Promise<SaleSnapshot | null> {
    const id = await this.carts.create(client, merchantId, locationId, operatorSessionId);
    return this.snapshotWithClient(client, merchantId, id);
  }

  async current(
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
  ): Promise<SaleSnapshot | null> {
    return this.pg.runWithMerchant(
      merchantId,
      null,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id::text
           FROM merchant.pos_cart
           WHERE merchant_id=$1::uuid
             AND location_id=$2::uuid
             AND operator_session_id=$3::uuid
             AND lifecycle_state IN ${ACTIVE_STATES}
           ORDER BY updated_at DESC
           LIMIT 1`,
          [merchantId, locationId, operatorSessionId],
        );
        return rows[0] ? this.snapshotWithClient(client, merchantId, rows[0].id) : null;
      },
      locationId,
    );
  }

  async suspend(
    client: PoolClient,
    merchantId: string,
    saleId: string,
    expectedVersion: number,
    label: string | null,
    operatorSessionId: string,
  ): Promise<SaleSnapshot | null> {
    const { rowCount } = await client.query(
      `UPDATE merchant.pos_cart
       SET lifecycle_state='suspended',
           display_label=COALESCE($4,display_label),
           suspended_at=now(),
           version=version+1,
           updated_at=now()
       WHERE merchant_id=$1::uuid
         AND id=$2::uuid
         AND version=$3
         AND operator_session_id=$5::uuid
         AND lifecycle_state IN ${ACTIVE_STATES}
         AND status IN ('draft','prepared')`,
      [merchantId, saleId, expectedVersion, label, operatorSessionId],
    );
    return (rowCount ?? 0) > 0 ? this.snapshotWithClient(client, merchantId, saleId) : null;
  }

  async resume(
    client: PoolClient,
    merchantId: string,
    saleId: string,
    expectedVersion: number,
    operatorSessionId: string,
  ): Promise<SaleSnapshot | null> {
    const { rowCount } = await client.query(
      `UPDATE merchant.pos_cart sale
       SET operator_session_id=$4::uuid,
           operator_user_id=(
             SELECT user_id FROM runtime.operator_session WHERE id=$4::uuid
           ),
           lifecycle_state='recovered',
           suspended_at=null,
           version=version+1,
           updated_at=now()
       WHERE sale.merchant_id=$1::uuid
         AND sale.id=$2::uuid
         AND sale.version=$3
         AND sale.lifecycle_state='suspended'
         AND NOT EXISTS (
           SELECT 1
           FROM merchant.pos_cart active
           JOIN runtime.operator_session current_operator
             ON current_operator.id=$4::uuid
           WHERE active.operator_user_id=current_operator.user_id
             AND active.merchant_id=sale.merchant_id
             AND active.location_id=sale.location_id
             AND active.lifecycle_state IN ${ACTIVE_STATES}
             AND active.id<>sale.id
         )
         AND (
           EXISTS (
             SELECT 1
             FROM runtime.operator_session current_operator
             WHERE current_operator.id=$4::uuid
               AND current_operator.user_id=sale.original_operator_user_id
           )
           OR EXISTS (
             SELECT 1
             FROM runtime.operator_session os
             WHERE os.id=$4::uuid
               AND ('sale.resume.any'=ANY(os.permissions) OR '*'=ANY(os.permissions))
           )
         )`,
      [merchantId, saleId, expectedVersion, operatorSessionId],
    );
    return (rowCount ?? 0) > 0 ? this.snapshotWithClient(client, merchantId, saleId) : null;
  }

  async rename(
    client: PoolClient,
    merchantId: string,
    saleId: string,
    expectedVersion: number,
    label: string,
    operatorSessionId: string,
  ): Promise<SaleSnapshot | null> {
    const { rowCount } = await client.query(
      `UPDATE merchant.pos_cart
       SET display_label=$4,version=version+1,updated_at=now()
       WHERE merchant_id=$1::uuid
         AND id=$2::uuid
         AND version=$3
         AND lifecycle_state='suspended'
         AND (
           EXISTS (
             SELECT 1
             FROM runtime.operator_session current_operator
             WHERE current_operator.id=$5::uuid
               AND current_operator.user_id=pos_cart.original_operator_user_id
           )
           OR EXISTS (
             SELECT 1
             FROM runtime.operator_session os
             WHERE os.id=$5::uuid
               AND ('sale.resume.any'=ANY(os.permissions) OR '*'=ANY(os.permissions))
           )
         )`,
      [merchantId, saleId, expectedVersion, label, operatorSessionId],
    );
    return (rowCount ?? 0) > 0 ? this.snapshotWithClient(client, merchantId, saleId) : null;
  }

  async cancel(
    client: PoolClient,
    merchantId: string,
    saleId: string,
    expectedVersion: number,
    reasonCode: string,
    reason: string | null,
    operatorSessionId: string,
  ): Promise<SaleSnapshot | null> {
    const { rowCount } = await client.query(
      `UPDATE merchant.pos_cart
       SET status='abandoned',
           lifecycle_state='cancelled',
           cancellation_reason_code=$4,
           cancellation_reason=$6,
           cancelled_at=now(),
           version=version+1,
           updated_at=now()
       WHERE merchant_id=$1::uuid
         AND id=$2::uuid
         AND version=$3
         AND operator_session_id=$5::uuid
         AND lifecycle_state IN ${ACTIVE_STATES}
         AND status IN ('draft','prepared')`,
      [merchantId, saleId, expectedVersion, reasonCode, operatorSessionId, reason],
    );
    return (rowCount ?? 0) > 0 ? this.snapshotWithClient(client, merchantId, saleId) : null;
  }

  async cancelCarriedOver(
    client: PoolClient,
    merchantId: string,
    actorUserId: string,
    mayCancelOtherOperator: boolean,
    dto: CancelCarriedOverAccountsRequest,
    options: { allowCurrentBusinessDay?: boolean } = {},
  ): Promise<SaleSnapshot[]> {
    const selected = [...dto.accounts].sort((a, b) => a.cartId.localeCompare(b.cartId));
    const ids = selected.map((account) => account.cartId);
    const preflight = await client.query<{ tableId: string | null }>(
      `SELECT table_id::text AS "tableId" FROM merchant.pos_cart
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND id=ANY($3::uuid[])`,
      [merchantId, dto.locationId, ids],
    );
    // Table assignment takes this advisory lock before it locks a cart.
    const tableIds = [
      ...new Set(preflight.rows.map((row) => row.tableId).filter((id): id is string => !!id)),
    ].sort();
    for (const tableId of tableIds) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `${merchantId}:${dto.locationId}:${tableId}`,
      ]);
    }
    const { rows } = await client.query<{
      id: string;
      version: number;
      status: string;
      state: string;
      businessDate: string;
      today: string;
      ownerId: string;
      tableId: string | null;
      committed: boolean;
    }>(
      `SELECT c.id::text,c.version,c.status,c.lifecycle_state AS state,
              c.business_date::text AS "businessDate",
              (((now() AT TIME ZONE m.timezone)-m.business_day_start::interval))::date::text AS today,
              c.original_operator_user_id::text AS "ownerId",
              c.table_id::text AS "tableId",
              EXISTS (SELECT 1 FROM merchant.pos_committed_sale s
                WHERE s.merchant_id=c.merchant_id AND s.cart_id=c.id) AS committed
       FROM merchant.pos_cart c
       JOIN merchant.merchant m ON m.id=c.merchant_id
       WHERE c.merchant_id=$1::uuid AND c.location_id=$2::uuid AND c.id=ANY($3::uuid[])
       ORDER BY c.id FOR UPDATE OF c`,
      [merchantId, dto.locationId, ids],
    );
    if (rows.length !== ids.length) throw new ConflictException({ code: 'SALE_STATE_CONFLICT' });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const selectedAccount of selected) {
      const row = byId.get(selectedAccount.cartId);
      if (
        !row ||
        row.version !== selectedAccount.expectedVersion ||
        (!options.allowCurrentBusinessDay && row.businessDate >= row.today) ||
        row.committed ||
        !['draft', 'prepared'].includes(row.status) ||
        !['building_cart', 'ready_for_checkout', 'recovered', 'suspended'].includes(row.state)
      ) {
        throw new ConflictException({
          code: 'SALE_STATE_CONFLICT',
          accountId: selectedAccount.cartId,
        });
      }
      if (row.ownerId !== actorUserId && !mayCancelOtherOperator) {
        throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
      }
      await this.carts.assertFinanciallyMutable(client, merchantId, row.id);
    }
    const cancelled: SaleSnapshot[] = [];
    for (const account of selected) {
      const changed = await client.query(
        `UPDATE merchant.pos_cart SET status='abandoned',lifecycle_state='cancelled',
           cancellation_reason_code=$4,cancellation_reason=$5,cancelled_at=now(),
           version=version+1,updated_at=now()
         WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND id=$3::uuid
           AND version=$6 AND status IN ('draft','prepared')
           AND lifecycle_state IN ('building_cart','ready_for_checkout','recovered','suspended')`,
        [
          merchantId,
          dto.locationId,
          account.cartId,
          dto.reasonCode,
          dto.reason,
          account.expectedVersion,
        ],
      );
      if (changed.rowCount !== 1) {
        throw new ConflictException({ code: 'SALE_STATE_CONFLICT', accountId: account.cartId });
      }
      const snapshot = await this.snapshotWithClient(client, merchantId, account.cartId);
      if (!snapshot)
        throw new ConflictException({ code: 'SALE_STATE_CONFLICT', accountId: account.cartId });
      cancelled.push(snapshot);
    }
    if (tableIds.length) {
      await client.query(
        `UPDATE merchant.table_state state
         SET state='dirty',seated_at=NULL,party_size=NULL,group_id=NULL,updated_at=now()
         WHERE state.merchant_id=$1::uuid AND state.location_id=$2::uuid
           AND state.table_id=ANY($3::uuid[])
           AND NOT EXISTS (SELECT 1 FROM merchant.pos_cart active
             WHERE active.merchant_id=state.merchant_id
               AND active.location_id=state.location_id
               AND active.table_id=state.table_id
               AND active.status IN ('draft','prepared'))`,
        [merchantId, dto.locationId, tableIds],
      );
    }
    if (rows.some((row) => !!row.tableId) || cancelled.some((sale) => !!sale.cart.firedOrderId)) {
      await client.query(
        `SELECT pg_notify('umi_kitchen_board',jsonb_build_object(
          'merchant_id',$1::uuid,'location_id',$2::uuid,'kitchen_order_id',NULL)::text)`,
        [merchantId, dto.locationId],
      );
    }
    return cancelled;
  }

  async attachCustomer(
    client: PoolClient,
    merchantId: string,
    saleId: string,
    expectedVersion: number,
    customerId: string | null,
    operatorSessionId: string,
  ): Promise<SaleSnapshot | null> {
    const { rowCount } = await client.query(
      `UPDATE merchant.pos_cart sale
       SET customer_id=$4::uuid,version=version+1,updated_at=now()
       WHERE sale.merchant_id=$1::uuid
         AND sale.id=$2::uuid
         AND sale.version=$3
         AND sale.operator_session_id=$5::uuid
         AND sale.lifecycle_state IN ${ACTIVE_STATES}
         AND (
           $4::uuid IS NULL
           OR EXISTS (
             SELECT 1
             FROM merchant.customer customer
             WHERE customer.id=$4::uuid
               AND customer.merchant_id=$1::uuid
               AND customer.merged_into_id IS NULL
               AND customer.status='active'
           )
         )`,
      [merchantId, saleId, expectedVersion, customerId, operatorSessionId],
    );
    return (rowCount ?? 0) > 0 ? this.snapshotWithClient(client, merchantId, saleId) : null;
  }

  async history(
    merchantId: string,
    query: SaleHistoryQuery,
    cursor: { updatedAt: string; id: string } | null,
  ): Promise<{
    items: SaleSnapshot[];
    nextKey: { updatedAt: string; id: string } | null;
  }> {
    return this.pg.runWithMerchant(
      merchantId,
      null,
      async (client) => {
        const states = query.state ? [query.state] : ['suspended', 'committed', 'cancelled'];
        const { rows } = await client.query<{ id: string; updatedAt: string }>(
          `SELECT c.id::text,c.updated_at::text AS "updatedAt"
           FROM merchant.pos_cart c
           LEFT JOIN merchant.customer customer ON customer.id=c.customer_id
           LEFT JOIN merchant.pos_committed_sale committed ON committed.cart_id=c.id
           LEFT JOIN merchant.receipt_snapshot receipt
             ON receipt.id=committed.receipt_snapshot_id
           WHERE c.merchant_id=$1::uuid
             AND c.location_id=$2::uuid
             AND c.lifecycle_state=ANY($3::text[])
             AND NOT (c.lifecycle_state='cancelled'
               AND c.cancellation_reason IS NOT DISTINCT FROM 'Cuenta vacía: se cierra al apartarla.'
               AND c.table_id IS NULL AND c.display_label IS NULL AND c.fired_order_id IS NULL
               AND committed.id IS NULL
               AND NOT EXISTS (SELECT 1 FROM merchant.pos_cart_line content
                 WHERE content.merchant_id=c.merchant_id AND content.cart_id=c.id))
             AND (
               $4=''
               OR COALESCE(c.display_label,'') ILIKE '%' || $4 || '%'
               OR COALESCE(customer.name,'') ILIKE '%' || $4 || '%'
               OR COALESCE(receipt.receipt_number,'') ILIKE '%' || $4 || '%'
               OR EXISTS (
                 SELECT 1 FROM merchant.pos_cart_line line
                 WHERE line.merchant_id=c.merchant_id AND line.cart_id=c.id
                   AND line.product_name ILIKE '%' || $4 || '%'
               )
             )
             AND (
               $6::timestamptz IS NULL
               OR (
                 $5='oldest'
                 AND (
                   c.updated_at>$6::timestamptz
                   OR (c.updated_at=$6::timestamptz AND c.id>$7::uuid)
                 )
               )
               OR (
                 $5='newest'
                 AND (
                   c.updated_at<$6::timestamptz
                   OR (c.updated_at=$6::timestamptz AND c.id>$7::uuid)
                 )
               )
             )
           ORDER BY
             CASE WHEN $5='oldest' THEN c.updated_at END ASC,
             CASE WHEN $5='newest' THEN c.updated_at END DESC,
             c.id
           LIMIT $8`,
          [
            merchantId,
            query.locationId,
            states,
            query.search,
            query.sort,
            cursor?.updatedAt ?? null,
            cursor?.id ?? null,
            query.limit + 1,
          ],
        );
        const more = rows.length > query.limit;
        const pageRows = rows.slice(0, query.limit);
        const items: SaleSnapshot[] = [];
        for (const row of pageRows) {
          const item = await this.snapshotWithClient(client, merchantId, row.id);
          if (item) items.push(item);
        }
        const last = more ? pageRows.at(-1) : null;
        return {
          items,
          nextKey: last ? { updatedAt: last.updatedAt, id: last.id } : null,
        };
      },
      query.locationId,
    );
  }

  async customers(
    merchantId: string,
    query: PosCustomerSearchQuery,
  ): Promise<{ items: Array<{ id: string; displayName: string; contactHint: string | null }> }> {
    return this.pg.runWithMerchant(
      merchantId,
      null,
      async (client) => {
        const { rows } = await client.query<{
          id: string;
          displayName: string;
          contactHint: string | null;
        }>(
          `SELECT customer.id::text,
                  COALESCE(NULLIF(customer.name,''),'Cliente') AS "displayName",
                  CASE
                    WHEN contact.value IS NULL THEN null
                    ELSE '••••' || right(contact.value,4)
                  END AS "contactHint"
           FROM merchant.customer customer
           LEFT JOIN LATERAL (
             SELECT COALESCE(c.normalized_value,c.raw_phone_number,c.raw_value) AS value
             FROM merchant.contact c
             WHERE c.customer_id=customer.id
             ORDER BY c.is_primary DESC,c.created_at
             LIMIT 1
           ) contact ON true
           WHERE customer.merchant_id=$1::uuid
             AND customer.merged_into_id IS NULL
             AND (
               $2=''
               OR COALESCE(customer.name,'') ILIKE '%' || $2 || '%'
               OR COALESCE(contact.value,'') ILIKE '%' || $2 || '%'
             )
           ORDER BY
             CASE WHEN $3 THEN (
               SELECT max(cart.updated_at)
               FROM merchant.pos_cart cart
               WHERE cart.customer_id=customer.id
                 AND cart.location_id=$4::uuid
             ) END DESC NULLS LAST,
             customer.name NULLS LAST,
             customer.id
           LIMIT $5`,
          [merchantId, query.search, query.recent, query.locationId, query.limit],
        );
        return { items: rows };
      },
      query.locationId,
    );
  }

  async receipt(
    merchantId: string,
    locationId: string,
    saleId: string,
  ): Promise<SaleReceiptResult | null> {
    return this.pg.runWithMerchant(
      merchantId,
      null,
      async (client) => {
        const { rows } = await client.query<{
          receipt: NonNullable<SaleReceiptResult['receipt']>;
          timezone: string;
        }>(
          `SELECT receipt.snapshot AS receipt, business.timezone
           FROM merchant.pos_cart cart
           JOIN merchant.merchant business ON business.id=cart.merchant_id
           JOIN merchant.pos_committed_sale sale ON sale.cart_id=cart.id
           JOIN merchant.receipt_snapshot receipt ON receipt.id=sale.receipt_snapshot_id
           WHERE cart.merchant_id=$1::uuid
             AND cart.location_id=$2::uuid
             AND cart.id=$3::uuid`,
          [merchantId, locationId, saleId],
        );
        return rows[0]
          ? {
              saleId,
              kind: 'official',
              provisionalReference: null,
              receipt: {
                ...rows[0].receipt,
                issuedAt: rows[0].receipt.issuedAt.endsWith('Z')
                  ? receiptTimeInZone(rows[0].receipt.issuedAt, rows[0].timezone ?? 'UTC')
                  : rows[0].receipt.issuedAt,
              },
            }
          : null;
      },
      locationId,
    );
  }

  private async snapshotWithClient(
    client: PoolClient,
    merchantId: string,
    saleId: string,
  ): Promise<SaleSnapshot | null> {
    const { rows } = await client.query<{
      id: string;
      state: SaleSnapshot['state'];
      label: string | null;
      customerId: string | null;
      customerName: string | null;
      contactHint: string | null;
      originalOperatorSessionId: string;
      currentOperatorSessionId: string | null;
      suspendedAt: string | null;
      cancelledAt: string | null;
      cancellationReasonCode: SaleSnapshot['cancellationReasonCode'];
      cancellationReason: string | null;
      committedSaleId: string | null;
      sourceOrderId: string | null;
      receiptId: string | null;
      receiptRef: string | null;
      updatedAt: string;
    }>(
      `SELECT cart.id::text,
              cart.lifecycle_state AS state,
              cart.display_label AS label,
              customer.id::text AS "customerId",
              COALESCE(NULLIF(customer.name,''),'Cliente') AS "customerName",
              CASE
                WHEN contact.value IS NULL THEN null
                ELSE '••••' || right(contact.value,4)
              END AS "contactHint",
              cart.original_operator_session_id::text AS "originalOperatorSessionId",
              cart.operator_session_id::text AS "currentOperatorSessionId",
              cart.suspended_at::text AS "suspendedAt",
              cart.cancelled_at::text AS "cancelledAt",
              cart.cancellation_reason_code AS "cancellationReasonCode",
              cart.cancellation_reason AS "cancellationReason",
              committed.id::text AS "committedSaleId",
              committed.order_id::text AS "sourceOrderId",
              receipt.id::text AS "receiptId",
              receipt.receipt_number AS "receiptRef",
              cart.updated_at::text AS "updatedAt"
       FROM merchant.pos_cart cart
       LEFT JOIN merchant.customer customer ON customer.id=cart.customer_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(c.normalized_value,c.raw_phone_number,c.raw_value) AS value
         FROM merchant.contact c
         WHERE c.customer_id=customer.id
         ORDER BY c.is_primary DESC,c.created_at
         LIMIT 1
       ) contact ON true
       LEFT JOIN merchant.pos_committed_sale committed ON committed.cart_id=cart.id
       LEFT JOIN merchant.receipt_snapshot receipt ON receipt.id=committed.receipt_snapshot_id
       WHERE cart.merchant_id=$1::uuid
         AND cart.id=$2::uuid`,
      [merchantId, saleId],
    );
    if (!rows[0]) return null;
    const cart = await this.carts.snapshotWithClient(client, merchantId, saleId);
    if (!cart) return null;
    const row = rows[0];
    return {
      id: row.id,
      state: row.state,
      cart,
      label: row.label,
      customer: row.customerId
        ? {
            id: row.customerId,
            displayName: row.customerName!,
            contactHint: row.contactHint,
          }
        : null,
      originalOperatorSessionId: row.originalOperatorSessionId,
      currentOperatorSessionId: row.currentOperatorSessionId,
      suspendedAt: row.suspendedAt,
      cancelledAt: row.cancelledAt,
      cancellationReasonCode: row.cancellationReasonCode,
      cancellationReason: row.cancellationReason,
      committedSaleId: row.committedSaleId,
      sourceOrderId: row.sourceOrderId,
      receiptId: row.receiptId,
      receiptRef: row.receiptRef,
      updatedAt: row.updatedAt,
    };
  }
}
