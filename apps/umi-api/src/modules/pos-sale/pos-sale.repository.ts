import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  PosCustomerSearchQuery,
  SaleHistoryQuery,
  SaleReceiptResult,
  SaleSnapshot,
} from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import { PosCartRepository } from '../pos-cart/pos-cart.repository';

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
    tenantId: string,
    branchId: string,
    operatorSessionId: string,
  ): Promise<boolean> {
    const { rowCount } = await this.pg.worker.query(
      `SELECT 1
       FROM runtime.operator_session os
       JOIN tenant.device d ON d.id=os.device_id
       WHERE os.id=$6::uuid
         AND os.durable_session_id=$2::uuid
         AND os.user_id=$1::uuid
         AND os.device_id=$3::uuid
         AND os.business_id=$4::uuid
         AND os.branch_id=$5::uuid
         AND os.state='active'
         AND os.expires_at>now()
         AND d.lifecycle_state='active'
         AND ('sale.lifecycle'=ANY(os.permissions) OR '*'=ANY(os.permissions))
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements(os.entitlements) e
           WHERE e->>'featureKey'='pos'
             AND COALESCE((e->>'enabled')::boolean,false)
         )`,
      [userId, sessionId, deviceId, tenantId, branchId, operatorSessionId],
    );
    return (rowCount ?? 0) > 0;
  }

  async start(
    client: PoolClient,
    tenantId: string,
    branchId: string,
    operatorSessionId: string,
  ): Promise<SaleSnapshot | null> {
    const id = await this.carts.create(client, tenantId, branchId, operatorSessionId);
    return this.snapshotWithClient(client, tenantId, id);
  }

  async current(
    tenantId: string,
    branchId: string,
    operatorSessionId: string,
  ): Promise<SaleSnapshot | null> {
    return this.pg.runWithTenant(
      tenantId,
      null,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id::text
           FROM tenant.pos_cart
           WHERE business_id=$1::uuid
             AND branch_id=$2::uuid
             AND operator_session_id=$3::uuid
             AND lifecycle_state IN ${ACTIVE_STATES}
           ORDER BY updated_at DESC
           LIMIT 1`,
          [tenantId, branchId, operatorSessionId],
        );
        return rows[0] ? this.snapshotWithClient(client, tenantId, rows[0].id) : null;
      },
      branchId,
    );
  }

  async suspend(
    client: PoolClient,
    tenantId: string,
    saleId: string,
    expectedVersion: number,
    label: string | null,
    operatorSessionId: string,
  ): Promise<SaleSnapshot | null> {
    const { rowCount } = await client.query(
      `UPDATE tenant.pos_cart
       SET lifecycle_state='suspended',
           display_label=$4,
           suspended_at=now(),
           version=version+1,
           updated_at=now()
       WHERE business_id=$1::uuid
         AND id=$2::uuid
         AND version=$3
         AND operator_session_id=$5::uuid
         AND lifecycle_state IN ${ACTIVE_STATES}
         AND status IN ('draft','prepared')`,
      [tenantId, saleId, expectedVersion, label, operatorSessionId],
    );
    return (rowCount ?? 0) > 0 ? this.snapshotWithClient(client, tenantId, saleId) : null;
  }

  async resume(
    client: PoolClient,
    tenantId: string,
    saleId: string,
    expectedVersion: number,
    operatorSessionId: string,
  ): Promise<SaleSnapshot | null> {
    const { rowCount } = await client.query(
      `UPDATE tenant.pos_cart sale
       SET operator_session_id=$4::uuid,
           operator_user_id=(
             SELECT user_id FROM runtime.operator_session WHERE id=$4::uuid
           ),
           lifecycle_state='recovered',
           suspended_at=null,
           version=version+1,
           updated_at=now()
       WHERE sale.business_id=$1::uuid
         AND sale.id=$2::uuid
         AND sale.version=$3
         AND sale.lifecycle_state='suspended'
         AND NOT EXISTS (
           SELECT 1
           FROM tenant.pos_cart active
           JOIN runtime.operator_session current_operator
             ON current_operator.id=$4::uuid
           WHERE active.operator_user_id=current_operator.user_id
             AND active.business_id=sale.business_id
             AND active.branch_id=sale.branch_id
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
      [tenantId, saleId, expectedVersion, operatorSessionId],
    );
    return (rowCount ?? 0) > 0 ? this.snapshotWithClient(client, tenantId, saleId) : null;
  }

  async rename(
    client: PoolClient,
    tenantId: string,
    saleId: string,
    expectedVersion: number,
    label: string,
    operatorSessionId: string,
  ): Promise<SaleSnapshot | null> {
    const { rowCount } = await client.query(
      `UPDATE tenant.pos_cart
       SET display_label=$4,version=version+1,updated_at=now()
       WHERE business_id=$1::uuid
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
      [tenantId, saleId, expectedVersion, label, operatorSessionId],
    );
    return (rowCount ?? 0) > 0 ? this.snapshotWithClient(client, tenantId, saleId) : null;
  }

  async cancel(
    client: PoolClient,
    tenantId: string,
    saleId: string,
    expectedVersion: number,
    reason: string,
    operatorSessionId: string,
  ): Promise<SaleSnapshot | null> {
    const { rowCount } = await client.query(
      `UPDATE tenant.pos_cart
       SET status='abandoned',
           lifecycle_state='cancelled',
           cancellation_reason=$4,
           cancelled_at=now(),
           version=version+1,
           updated_at=now()
       WHERE business_id=$1::uuid
         AND id=$2::uuid
         AND version=$3
         AND operator_session_id=$5::uuid
         AND lifecycle_state IN ${ACTIVE_STATES}
         AND status IN ('draft','prepared')`,
      [tenantId, saleId, expectedVersion, reason, operatorSessionId],
    );
    return (rowCount ?? 0) > 0 ? this.snapshotWithClient(client, tenantId, saleId) : null;
  }

  async attachCustomer(
    client: PoolClient,
    tenantId: string,
    saleId: string,
    expectedVersion: number,
    customerId: string | null,
    operatorSessionId: string,
  ): Promise<SaleSnapshot | null> {
    const { rowCount } = await client.query(
      `UPDATE tenant.pos_cart sale
       SET customer_id=$4::uuid,version=version+1,updated_at=now()
       WHERE sale.business_id=$1::uuid
         AND sale.id=$2::uuid
         AND sale.version=$3
         AND sale.operator_session_id=$5::uuid
         AND sale.lifecycle_state IN ${ACTIVE_STATES}
         AND (
           $4::uuid IS NULL
           OR EXISTS (
             SELECT 1
             FROM tenant.customer customer
             WHERE customer.id=$4::uuid
               AND customer.business_id=$1::uuid
               AND customer.merged_into_id IS NULL
           )
         )`,
      [tenantId, saleId, expectedVersion, customerId, operatorSessionId],
    );
    return (rowCount ?? 0) > 0 ? this.snapshotWithClient(client, tenantId, saleId) : null;
  }

  async history(
    tenantId: string,
    query: SaleHistoryQuery,
    cursor: { updatedAt: string; id: string } | null,
  ): Promise<{
    items: SaleSnapshot[];
    nextKey: { updatedAt: string; id: string } | null;
  }> {
    return this.pg.runWithTenant(
      tenantId,
      null,
      async (client) => {
        const states = query.state ? [query.state] : ['suspended', 'committed', 'cancelled'];
        const { rows } = await client.query<{ id: string; updatedAt: string }>(
          `SELECT c.id::text,c.updated_at::text AS "updatedAt"
           FROM tenant.pos_cart c
           LEFT JOIN tenant.customer customer ON customer.id=c.customer_id
           LEFT JOIN tenant.pos_committed_sale committed ON committed.cart_id=c.id
           LEFT JOIN tenant.receipt_snapshot receipt
             ON receipt.id=committed.receipt_snapshot_id
           WHERE c.business_id=$1::uuid
             AND c.branch_id=$2::uuid
             AND c.lifecycle_state=ANY($3::text[])
             AND (
               $4=''
               OR COALESCE(c.display_label,'') ILIKE '%' || $4 || '%'
               OR COALESCE(customer.name,'') ILIKE '%' || $4 || '%'
               OR COALESCE(receipt.receipt_number,'') ILIKE '%' || $4 || '%'
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
            tenantId,
            query.branchId,
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
          const item = await this.snapshotWithClient(client, tenantId, row.id);
          if (item) items.push(item);
        }
        const last = more ? pageRows.at(-1) : null;
        return {
          items,
          nextKey: last ? { updatedAt: last.updatedAt, id: last.id } : null,
        };
      },
      query.branchId,
    );
  }

  async customers(
    tenantId: string,
    query: PosCustomerSearchQuery,
  ): Promise<{ items: Array<{ id: string; displayName: string; contactHint: string | null }> }> {
    return this.pg.runWithTenant(
      tenantId,
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
           FROM tenant.customer customer
           LEFT JOIN LATERAL (
             SELECT COALESCE(c.normalized_value,c.raw_phone_number,c.raw_value) AS value
             FROM tenant.contact c
             WHERE c.customer_id=customer.id
             ORDER BY c.is_primary DESC,c.created_at
             LIMIT 1
           ) contact ON true
           WHERE customer.business_id=$1::uuid
             AND customer.merged_into_id IS NULL
             AND (
               $2=''
               OR COALESCE(customer.name,'') ILIKE '%' || $2 || '%'
               OR COALESCE(contact.value,'') ILIKE '%' || $2 || '%'
             )
           ORDER BY
             CASE WHEN $3 THEN (
               SELECT max(cart.updated_at)
               FROM tenant.pos_cart cart
               WHERE cart.customer_id=customer.id
                 AND cart.branch_id=$4::uuid
             ) END DESC NULLS LAST,
             customer.name NULLS LAST,
             customer.id
           LIMIT $5`,
          [tenantId, query.search, query.recent, query.branchId, query.limit],
        );
        return { items: rows };
      },
      query.branchId,
    );
  }

  async receipt(
    tenantId: string,
    branchId: string,
    saleId: string,
  ): Promise<SaleReceiptResult | null> {
    return this.pg.runWithTenant(
      tenantId,
      null,
      async (client) => {
        const { rows } = await client.query<{
          receipt: SaleReceiptResult['receipt'];
        }>(
          `SELECT receipt.snapshot AS receipt
           FROM tenant.pos_cart cart
           JOIN tenant.pos_committed_sale sale ON sale.cart_id=cart.id
           JOIN tenant.receipt_snapshot receipt ON receipt.id=sale.receipt_snapshot_id
           WHERE cart.business_id=$1::uuid
             AND cart.branch_id=$2::uuid
             AND cart.id=$3::uuid`,
          [tenantId, branchId, saleId],
        );
        return rows[0]
          ? {
              saleId,
              kind: 'official',
              provisionalReference: null,
              receipt: rows[0].receipt,
            }
          : null;
      },
      branchId,
    );
  }

  private async snapshotWithClient(
    client: PoolClient,
    tenantId: string,
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
      cancellationReason: string | null;
      committedSaleId: string | null;
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
              cart.cancellation_reason AS "cancellationReason",
              committed.id::text AS "committedSaleId",
              receipt.id::text AS "receiptId",
              receipt.receipt_number AS "receiptRef",
              cart.updated_at::text AS "updatedAt"
       FROM tenant.pos_cart cart
       LEFT JOIN tenant.customer customer ON customer.id=cart.customer_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(c.normalized_value,c.raw_phone_number,c.raw_value) AS value
         FROM tenant.contact c
         WHERE c.customer_id=customer.id
         ORDER BY c.is_primary DESC,c.created_at
         LIMIT 1
       ) contact ON true
       LEFT JOIN tenant.pos_committed_sale committed ON committed.cart_id=cart.id
       LEFT JOIN tenant.receipt_snapshot receipt ON receipt.id=committed.receipt_snapshot_id
       WHERE cart.business_id=$1::uuid
         AND cart.id=$2::uuid`,
      [tenantId, saleId],
    );
    if (!rows[0]) return null;
    const cart = await this.carts.snapshotWithClient(client, tenantId, saleId);
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
      cancellationReason: row.cancellationReason,
      committedSaleId: row.committedSaleId,
      receiptId: row.receiptId,
      receiptRef: row.receiptRef,
      updatedAt: row.updatedAt,
    };
  }
}
