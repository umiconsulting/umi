import { Injectable } from '@nestjs/common';
import type {
  CashShiftDetail,
  DashboardOperationDomain,
  DashboardOperationsQuery,
  ReportsSalesQuery,
  ReportsSalesSummary,
} from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';

interface ItemRow {
  id: string;
  // Only the receipts domain projects this: the committed sale behind the receipt, so the
  // owner can open the sale detail (GET .../sales/:saleId/receipt) from a receipt row.
  saleId?: string | null;
  publicReference: string;
  title: string;
  detail: string | null;
  status: string;
  locationId: string | null;
  occurredAt: string | null;
  amountMinorUnits: string | number | null;
  currency: string | null;
  version: string | number | null;
  correlationId: string | null;
  facts: Record<string, unknown> | null;
}

const row = (source: string, where: string, order: string) => ({ source, where, order });

const QUERIES: Record<DashboardOperationDomain, ReturnType<typeof row>> = {
  organization: row(
    `SELECT m.id::text,m.id::text AS "publicReference",m.name AS title,
    concat_ws(' · ',m.locale,m.timezone,m.currency) AS detail,m.status,NULL::text AS "locationId",
    m.updated_at::text AS "occurredAt",NULL::bigint AS "amountMinorUnits",m.currency,
    NULL::bigint AS version,NULL::text AS "correlationId" FROM merchant.merchant m`,
    'm.id=$1::uuid',
    'm.updated_at DESC,m.id',
  ),
  locations: row(
    `SELECT l.id::text,l.id::text AS "publicReference",l.name AS title,
    coalesce(l.address,'') AS detail,l.status,l.id::text AS "locationId",l.updated_at::text AS "occurredAt",
    NULL::bigint AS "amountMinorUnits",m.currency,NULL::bigint AS version,NULL::text AS "correlationId"
    FROM merchant.location l JOIN merchant.merchant m ON m.id=l.merchant_id`,
    'l.merchant_id=$1::uuid',
    'l.created_at,l.id',
  ),
  memberships: row(
    `SELECT s.id::text,s.id::text AS "publicReference",s.name AS title,
    coalesce(s.position,'') AS detail,s.status,s.location_id::text AS "locationId",
    s.updated_at::text AS "occurredAt",NULL::bigint AS "amountMinorUnits",NULL::text AS currency,
    NULL::bigint AS version,NULL::text AS "correlationId" FROM merchant.staff s`,
    's.merchant_id=$1::uuid',
    's.updated_at DESC,s.id',
  ),
  devices: row(
    `SELECT d.id::text,d.public_id::text AS "publicReference",d.name AS title,
    concat_ws(' · ',d.kind,d.platform) AS detail,d.status,d.location_id::text AS "locationId",
    coalesce(d.last_seen_at,d.updated_at)::text AS "occurredAt",NULL::bigint AS "amountMinorUnits",
    NULL::text AS currency,d.credential_version AS version,NULL::text AS "correlationId" FROM merchant.device d`,
    'd.merchant_id=$1::uuid',
    'd.updated_at DESC,d.id',
  ),
  registers: row(
    `SELECT r.id::text,r.public_reference AS "publicReference",r.display_name AS title,
    concat_ws(' · ',r.currency,(SELECT 'Movimientos '||count(*) FROM merchant.cash_movement m WHERE m.register_id=r.id),(SELECT CASE WHEN count(*)>0 THEN 'Sin venta '||count(*) END FROM merchant.no_sale_drawer_event n WHERE n.register_id=r.id)) AS detail,r.status,r.location_id::text AS "locationId",coalesce(r.archived_at,r.created_at)::text AS "occurredAt",
    NULL::bigint AS "amountMinorUnits",r.currency,r.version,NULL::text AS "correlationId",
    jsonb_build_object('movements',(SELECT count(*) FROM merchant.cash_movement m WHERE m.register_id=r.id),'noSaleOpens',(SELECT count(*) FROM merchant.no_sale_drawer_event n WHERE n.register_id=r.id),'status',r.status) AS facts FROM merchant.physical_register r`,
    'r.merchant_id=$1::uuid',
    'r.created_at DESC,r.id',
  ),
  hardware: row(
    `SELECT h.id::text,h.public_reference AS "publicReference",concat_ws(' ',h.manufacturer,h.model) AS title,
    concat_ws(' · ',h.device_type,h.transport) AS detail,CASE WHEN h.enabled THEN h.connection_state ELSE 'disabled' END AS status,
    h.location_id::text AS "locationId",coalesce(h.last_heartbeat_at,h.updated_at)::text AS "occurredAt",
    NULL::bigint AS "amountMinorUnits",NULL::text AS currency,h.optimistic_version AS version,NULL::text AS "correlationId" FROM merchant.hardware_device h`,
    'h.merchant_id=$1::uuid AND h.archived_at IS NULL',
    'h.updated_at DESC,h.id',
  ),
  catalog: row(
    `SELECT p.id::text,coalesce(p.sku,p.barcode,p.id::text) AS "publicReference",p.name AS title,
    coalesce(c.name,'Sin categoría') AS detail,CASE WHEN p.active THEN 'active' ELSE 'archived' END AS status,
    NULL::text AS "locationId",p.updated_at::text AS "occurredAt",p.price AS "amountMinorUnits",m.currency,
    coalesce(v.version,1)::bigint AS version,NULL::text AS "correlationId" FROM merchant.product p
    JOIN merchant.merchant m ON m.id=p.merchant_id LEFT JOIN merchant.product_category c ON c.id=p.category_id
    LEFT JOIN merchant.aggregate_version v ON v.merchant_id=p.merchant_id
      AND v.aggregate_type='catalog_product' AND v.aggregate_id=p.id`,
    'p.merchant_id=$1::uuid',
    'p.updated_at DESC,p.id',
  ),
  inventory: row(
    `SELECT concat(b.inventory_location_id,':',i.id)::text AS id,i.public_reference AS "publicReference",
    i.display_name AS title,concat_ws(' · ',b.available::text,i.base_unit,i.item_type) AS detail,
    CASE WHEN i.active THEN 'active' ELSE 'archived' END AS status,b.location_id::text AS "locationId",
    b.calculated_at::text AS "occurredAt",NULL::bigint AS "amountMinorUnits",NULL::text AS currency,
    b.version,NULL::text AS "correlationId" FROM merchant.stock_balance b
    JOIN merchant.inventory_item i ON i.merchant_id=b.merchant_id AND i.id=b.inventory_item_id`,
    'b.merchant_id=$1::uuid',
    'b.calculated_at DESC,b.inventory_location_id,i.id',
  ),
  sales: row(
    `SELECT s.id::text,r.receipt_number AS "publicReference",concat('Venta ',r.receipt_number) AS title,
    concat_ws(' · ',concat('Fecha comercial ',r.business_date::text),st.name,CASE WHEN coalesce(disc.total,0)>0 THEN 'Desc '||trim(to_char(disc.total/100.0,'FM999990.00')) END) AS detail,'committed' AS status,s.location_id::text AS "locationId",
    s.committed_at::text AS "occurredAt",r.grand_total AS "amountMinorUnits",r.currency,
    NULL::bigint AS version,NULL::text AS "correlationId",
    jsonb_build_object('operator',st.name,'discountMinorUnits',coalesce(disc.total,0)) AS facts FROM merchant.pos_committed_sale s
    JOIN merchant.receipt_snapshot r ON r.id=s.receipt_snapshot_id
    LEFT JOIN merchant.cash_shift cs ON cs.id=s.cash_shift_id
    LEFT JOIN merchant.staff st ON st.user_id=cs.responsible_operator_id AND st.merchant_id=s.merchant_id
    LEFT JOIN (SELECT order_id,sum(amount) total FROM merchant.order_discount GROUP BY order_id) disc ON disc.order_id=s.order_id`,
    's.merchant_id=$1::uuid',
    's.committed_at DESC,s.id',
  ),
  receipts: row(
    `SELECT coalesce(j.id,r.id)::text AS id,pcs.id::text AS "saleId",r.receipt_number AS "publicReference",concat('Recibo ',r.receipt_number) AS title,
    concat('Fecha comercial ',r.business_date::text) AS detail,coalesce(j.status,'not_printed') AS status,r.location_id::text AS "locationId",
    r.issued_at::text AS "occurredAt",r.grand_total AS "amountMinorUnits",r.currency,
    NULL::bigint AS version,j.correlation_id AS "correlationId" FROM merchant.receipt_snapshot r
    LEFT JOIN LATERAL (SELECT s.id FROM merchant.pos_committed_sale s WHERE s.receipt_snapshot_id=r.id AND s.merchant_id=r.merchant_id LIMIT 1) pcs ON true
    LEFT JOIN LATERAL (
      SELECT p.id,p.correlation_id,coalesce(e.status,'queued') AS status
      FROM merchant.hardware_print_job p
      LEFT JOIN LATERAL (
        SELECT pe.status FROM merchant.hardware_print_job_event pe
        WHERE pe.merchant_id=p.merchant_id AND pe.print_job_id=p.id
        ORDER BY pe.sequence DESC LIMIT 1
      ) e ON true
      WHERE p.merchant_id=r.merchant_id AND p.location_id=r.location_id
        AND p.job_type='official_receipt' AND p.source_aggregate_type='receipt'
        AND p.source_aggregate_id=r.id::text
      ORDER BY p.created_at DESC LIMIT 1
    ) j ON true`,
    'r.merchant_id=$1::uuid',
    'r.issued_at DESC,r.id',
  ),
  refunds_voids: row(
    `SELECT x.id::text,x.id::text AS "publicReference",x.exception_type AS title,concat_ws(' · ',x.reason_code,st.name,CASE WHEN x.approval_id IS NOT NULL THEN 'aprobado' END) AS detail,
    x.status,x.location_id::text AS "locationId",x.committed_at::text AS "occurredAt",x.total_minor_units AS "amountMinorUnits",
    x.currency,NULL::bigint AS version,x.correlation_id AS "correlationId",
    jsonb_build_object('exceptionType',x.exception_type,'reasonCode',x.reason_code,'operator',st.name,'approved',x.approval_id IS NOT NULL,'originalReceipt',orr.receipt_number) AS facts FROM merchant.pos_sale_exception x
    LEFT JOIN merchant.staff st ON st.user_id=x.operator_id AND st.merchant_id=x.merchant_id
    LEFT JOIN merchant.receipt_snapshot orr ON orr.id=x.original_receipt_id`,
    'x.merchant_id=$1::uuid',
    'x.committed_at DESC,x.id',
  ),
  cash_shifts: row(
    `SELECT s.id::text,s.id::text AS "publicReference",concat('Turno ',r.public_reference) AS title,
    concat('Fecha comercial ',s.business_date::text) AS detail,s.status,s.location_id::text AS "locationId",
    coalesce(s.closed_at,s.opened_at)::text AS "occurredAt",s.opening_float_minor_units AS "amountMinorUnits",s.currency,
    s.version,NULL::text AS "correlationId",jsonb_build_object('operator',st.name,'register',r.public_reference,'openingFloatMinorUnits',s.opening_float_minor_units,'expectedCashMinorUnits',(SELECT coalesce(sum(CASE le.entry_type WHEN 'opening_float' THEN le.amount_minor_units WHEN 'cash_sale' THEN coalesce(le.cash_received_minor_units,0)-coalesce(le.change_given_minor_units,0) WHEN 'cash_refund' THEN -le.amount_minor_units WHEN 'paid_in' THEN le.amount_minor_units WHEN 'paid_out' THEN -le.amount_minor_units WHEN 'safe_drop' THEN -le.amount_minor_units WHEN 'drawer_correction' THEN le.amount_minor_units WHEN 'handoff_transfer' THEN le.amount_minor_units ELSE 0 END),0) FROM merchant.cash_ledger_entry le WHERE le.shift_id=s.id),'countedCashMinorUnits',(CASE WHEN s.status IN ('counting','reconciliation_required','closing','closed') THEN (SELECT cca.counted_minor_units FROM merchant.cash_count_attempt cca WHERE cca.shift_id=s.id ORDER BY cca.attempt_number DESC LIMIT 1) ELSE NULL END),'status',s.status,'openedAt',s.opened_at::text,'closedAt',s.closed_at::text) AS facts FROM merchant.cash_shift s JOIN merchant.physical_register r ON r.id=s.register_id LEFT JOIN merchant.staff st ON st.user_id=s.responsible_operator_id AND st.merchant_id=s.merchant_id`,
    's.merchant_id=$1::uuid',
    's.opened_at DESC,s.id',
  ),
  customers: row(
    `SELECT c.id::text,c.public_reference AS "publicReference",c.public_reference AS title,
    NULL::text AS detail,c.status,NULL::text AS "locationId",c.created_at::text AS "occurredAt",
    NULL::bigint AS "amountMinorUnits",NULL::text AS currency,c.version,NULL::text AS "correlationId" FROM merchant.customer c`,
    'c.merchant_id=$1::uuid',
    'c.created_at DESC,c.id',
  ),
  loyalty: row(
    `SELECT a.id::text,a.public_reference AS "publicReference",a.public_reference AS title,
    a.program_reference AS detail,a.status,NULL::text AS "locationId",a.enrolled_at::text AS "occurredAt",
    NULL::bigint AS "amountMinorUnits",NULL::text AS currency,a.version,NULL::text AS "correlationId" FROM merchant.loyalty_points_account a`,
    'a.merchant_id=$1::uuid',
    'a.enrolled_at DESC,a.id',
  ),
  rewards: row(
    `SELECT r.id::text,r.id::text AS "publicReference",r.name AS title,r.type AS detail,
    CASE WHEN r.active THEN 'active' ELSE 'inactive' END AS status,NULL::text AS "locationId",r.updated_at::text AS "occurredAt",
    r.value AS "amountMinorUnits",m.currency,NULL::bigint AS version,NULL::text AS "correlationId"
    FROM merchant.loyalty_reward r JOIN merchant.merchant m ON m.id=r.merchant_id`,
    'r.merchant_id=$1::uuid',
    'r.updated_at DESC,r.id',
  ),
  wallet: row(
    `SELECT c.id::text,c.public_reference AS "publicReference",concat('Wallet ',c.public_reference) AS title,
    'Wallet del cliente' AS detail,c.status,NULL::text AS "locationId",c.created_at::text AS "occurredAt",
    b.available AS "amountMinorUnits",b.currency,c.version,NULL::text AS "correlationId"
    FROM merchant.loyalty_card c JOIN merchant.loyalty_stored_value_balance b ON b.card_id=c.id`,
    'c.merchant_id=$1::uuid',
    'c.created_at DESC,c.id',
  ),
  gift_cards: row(
    `SELECT g.id::text,g.public_reference AS "publicReference",g.masked_code AS title,
    g.issuance_source AS detail,g.status,g.location_id::text AS "locationId",g.issued_at::text AS "occurredAt",
    b.available AS "amountMinorUnits",b.currency,g.version,NULL::text AS "correlationId"
    FROM merchant.loyalty_gift_card g LEFT JOIN merchant.loyalty_gift_card_balance b ON b.gift_card_id=g.id`,
    'g.merchant_id=$1::uuid',
    'g.issued_at DESC,g.id',
  ),
  kitchen: row(
    `SELECT k.id::text,k.public_reference AS "publicReference",concat('Orden ',k.public_reference) AS title,
    k.priority AS detail,k.status,k.location_id::text AS "locationId",k.updated_at::text AS "occurredAt",
    NULL::bigint AS "amountMinorUnits",NULL::text AS currency,k.version,NULL::text AS "correlationId" FROM merchant.kitchen_order k`,
    'k.merchant_id=$1::uuid',
    'k.updated_at DESC,k.id',
  ),
  recovery: row(
    `SELECT c.command_id::text AS id,c.command_id::text AS "publicReference",c.command_type AS title,
    c.failure_code AS detail,c.status,c.location_id::text AS "locationId",coalesce(c.completed_at,c.started_at)::text AS "occurredAt",
    NULL::bigint AS "amountMinorUnits",NULL::text AS currency,c.expected_version AS version,c.correlation_id AS "correlationId"
    FROM merchant.business_command c`,
    `c.merchant_id=$1::uuid AND (c.status<>'succeeded' OR c.retryable)`,
    'c.started_at DESC,c.command_id',
  ),
  audit: row(
    `SELECT a.id::text,coalesce(a.entity_id::text,a.id::text) AS "publicReference",a.event_type AS title,
    a.reason_code AS detail,a.outcome AS status,a.location_id::text AS "locationId",a.occurred_at::text AS "occurredAt",
    NULL::bigint AS "amountMinorUnits",NULL::text AS currency,NULL::bigint AS version,a.correlation_id AS "correlationId" FROM merchant.audit_event a`,
    'a.merchant_id=$1::uuid',
    'a.occurred_at DESC,a.id',
  ),
  diagnostics: row(
    `SELECT d.id::text,d.hardware_id::text AS "publicReference",d.diagnostic_type AS title,
    d.failure_code AS detail,d.health AS status,d.location_id::text AS "locationId",d.occurred_at::text AS "occurredAt",
    NULL::bigint AS "amountMinorUnits",NULL::text AS currency,NULL::bigint AS version,d.correlation_id AS "correlationId"
    FROM merchant.hardware_diagnostic d`,
    'd.merchant_id=$1::uuid',
    'd.occurred_at DESC,d.id',
  ),
};

@Injectable()
export class DashboardOperationsRepository {
  constructor(private readonly pg: PgService) {}

  list(
    userId: string,
    merchantId: string,
    query: DashboardOperationsQuery,
    locationId: string | null,
  ) {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const definition = QUERIES[query.domain];
        const params: unknown[] = [merchantId];
        const isMerchantFact = [
          'organization',
          'catalog',
          'customers',
          'loyalty',
          'rewards',
          'wallet',
          'gift_cards',
        ].includes(query.domain);
        const scoped = Boolean(locationId && !isMerchantFact);
        if (scoped) params.push(locationId);
        params.push(query.limit + 1, query.cursor);
        const base = `${definition.source} WHERE ${definition.where}`;
        const source = scoped
          ? `SELECT * FROM (${base}) operation WHERE operation."locationId"=$2::text`
          : base;
        const order = scoped ? `"occurredAt" DESC NULLS LAST,id` : definition.order;
        const result = await client.query<ItemRow>(
          `${source} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        );
        return result.rows.map((item) => {
          const amount = item.amountMinorUnits === null ? null : Number(item.amountMinorUnits);
          const version = item.version === null ? null : Number(item.version);
          return {
            ...item,
            id: item.id.slice(0, 160),
            publicReference: item.publicReference.slice(0, 160),
            title: item.title.slice(0, 240),
            detail: item.detail?.slice(0, 500) ?? null,
            status: item.status.slice(0, 100),
            correlationId: item.correlationId?.slice(0, 160) ?? null,
            amountMinorUnits: amount !== null && Number.isSafeInteger(amount) ? amount : null,
            version:
              version !== null && Number.isSafeInteger(version) && version >= 0 ? version : null,
            facts: item.facts ?? null,
          };
        });
      },
      locationId ?? undefined,
    );
  }

  // One sale's immutable receipt snapshot — the rendered sale (lines, modifiers,
  // tender, totals). The owner reads it as the sale detail. RLS-scoped like list().
  saleReceipt(userId: string, merchantId: string, saleId: string, locationId: string | null) {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const result = await client.query<{
          snapshot: Record<string, unknown> | null;
          receiptNumber: string;
          locationId: string | null;
        }>(
          `SELECT r.snapshot, r.receipt_number AS "receiptNumber", s.location_id::text AS "locationId"
           FROM merchant.pos_committed_sale s
           JOIN merchant.receipt_snapshot r ON r.id=s.receipt_snapshot_id
           WHERE s.id=$1::uuid AND s.merchant_id=$2::uuid`,
          [saleId, merchantId],
        );
        const sale = result.rows[0];
        if (!sale) return null;
        // The void/refund exceptions booked against this sale. They live append-only in
        // pos_sale_exception and never touch the receipt snapshot, so this is the only place
        // the owner sees them on the sale — the fix for "refunds invisible to the dashboard".
        const exceptions = await client.query<{
          id: string;
          exceptionType: string;
          reasonCode: string;
          totalMinorUnits: string | number;
          currency: string;
          status: string;
          approved: boolean;
          operator: string | null;
          note: string | null;
          occurredAt: string;
        }>(
          `SELECT x.id::text, x.exception_type AS "exceptionType", x.reason_code AS "reasonCode",
                  x.total_minor_units AS "totalMinorUnits", x.currency, x.status,
                  x.approval_id IS NOT NULL AS approved, st.name AS operator, x.note,
                  x.committed_at::text AS "occurredAt"
           FROM merchant.pos_sale_exception x
           LEFT JOIN merchant.staff st ON st.user_id=x.operator_id AND st.merchant_id=x.merchant_id
           WHERE x.sale_id=$1::uuid AND x.merchant_id=$2::uuid
           ORDER BY x.committed_at`,
          [saleId, merchantId],
        );
        return {
          ...sale,
          exceptions: exceptions.rows.map((e) => {
            const amount = Number(e.totalMinorUnits);
            return {
              id: e.id,
              exceptionType: e.exceptionType,
              reasonCode: e.reasonCode,
              totalMinorUnits: Number.isSafeInteger(amount) ? amount : null,
              currency: e.currency,
              status: e.status,
              approved: e.approved,
              operator: e.operator,
              note: e.note,
              occurredAt: e.occurredAt,
            };
          }),
        };
      },
      locationId ?? undefined,
    );
  }

  // The sales aggregate the Reportes → Ventas view reads: net sales, product mix,
  // payment mix, and a time series over committed sales in a business-date window.
  // Everything reconciles to `netSalesMinorUnits` because each figure sums the same
  // committed-sale set through a different lens. RLS-scoped like list().
  salesSummary(
    userId: string,
    merchantId: string,
    query: ReportsSalesQuery,
    locationId: string | null,
  ): Promise<ReportsSalesSummary> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client): Promise<ReportsSalesSummary> => {
        const meta = await client.query<{ timezone: string; currency: string; today: string }>(
          `SELECT m.timezone, m.currency, (now() AT TIME ZONE m.timezone)::date::text AS today
           FROM merchant.merchant m WHERE m.id=$1::uuid`,
          [merchantId],
        );
        const tz = meta.rows[0]?.timezone ?? 'UTC';
        const currency = meta.rows[0]?.currency ?? null;
        const today = meta.rows[0]?.today ?? new Date().toISOString().slice(0, 10);

        // Business-date window [start, end] and the equally-sized window before it.
        const shift = (iso: string, days: number): string => {
          const date = new Date(`${iso}T00:00:00Z`);
          date.setUTCDate(date.getUTCDate() + days);
          return date.toISOString().slice(0, 10);
        };
        const window =
          query.range === 'today'
            ? { start: today, end: today, priorStart: shift(today, -1), priorEnd: shift(today, -1), bucket: 'hour' as const }
            : query.range === 'yesterday'
              ? { start: shift(today, -1), end: shift(today, -1), priorStart: shift(today, -2), priorEnd: shift(today, -2), bucket: 'hour' as const }
              : query.range === 'last_7_days'
                ? { start: shift(today, -6), end: today, priorStart: shift(today, -13), priorEnd: shift(today, -7), bucket: 'day' as const }
                : { start: shift(today, -29), end: today, priorStart: shift(today, -59), priorEnd: shift(today, -30), bucket: 'day' as const };

        const wp = [merchantId, window.start, window.end, locationId];
        const priorWp = [merchantId, window.priorStart, window.priorEnd, locationId];
        const range = `s.merchant_id=$1::uuid AND r.business_date BETWEEN $2::date AND $3::date
             AND ($4::uuid IS NULL OR s.location_id=$4::uuid)`;
        const joinSale = `FROM merchant.pos_committed_sale s
           JOIN merchant.receipt_snapshot r ON r.id=s.receipt_snapshot_id`;

        const totals = await client.query<{
          net: string;
          orders: string;
          discount: string;
          tips: string;
        }>(
          `SELECT coalesce(sum(r.grand_total),0)::bigint AS net, count(*)::bigint AS orders,
                  coalesce(sum(disc.total),0)::bigint AS discount,
                  coalesce(sum((r.snapshot->'tip'->>'minorUnits')::bigint),0)::bigint AS tips
           ${joinSale}
           LEFT JOIN (SELECT order_id,sum(amount) total FROM merchant.order_discount GROUP BY order_id) disc
             ON disc.order_id=s.order_id
           WHERE ${range}`,
          wp,
        );
        const itemsRow = await client.query<{ units: string }>(
          `SELECT coalesce(sum(cl.quantity),0)::bigint AS units
           ${joinSale}
           JOIN merchant.pos_cart_line cl ON cl.cart_id=s.cart_id
           WHERE ${range}`,
          wp,
        );
        const prior = await client.query<{ net: string }>(
          `SELECT coalesce(sum(r.grand_total),0)::bigint AS net ${joinSale} WHERE ${range}`,
          priorWp,
        );
        const payments = await client.query<{ method: string; amount: string }>(
          `SELECT tf.tender_type AS method, coalesce(sum(tf.amount_minor_units),0)::bigint AS amount
           ${joinSale}
           JOIN merchant.pos_tender_fact tf ON tf.cart_id=s.cart_id AND tf.status='committed'
           WHERE ${range}
           GROUP BY tf.tender_type`,
          wp,
        );
        const walletPayments = await client.query<{ method: string; amount: string }>(
          `SELECT cva.tender_type AS method, coalesce(sum(cva.committed_minor_units),0)::bigint AS amount
           ${joinSale}
           JOIN merchant.customer_value_tender_allocation cva ON cva.sale_id=s.id
           WHERE ${range}
           GROUP BY cva.tender_type`,
          wp,
        );
        const products = await client.query<{
          productId: string | null;
          productName: string;
          category: string | null;
          units: string;
          net: string;
        }>(
          `SELECT cl.product_id::text AS "productId", min(cl.product_name) AS "productName",
                  min(pc.name) AS category, sum(cl.quantity)::bigint AS units,
                  sum(cl.quantity*(cl.base_price+cl.variant_delta+cl.modifier_total))::bigint AS net
           ${joinSale}
           JOIN merchant.pos_cart_line cl ON cl.cart_id=s.cart_id
           LEFT JOIN merchant.product p ON p.id=cl.product_id
           LEFT JOIN merchant.product_category pc ON pc.id=p.category_id
           WHERE ${range}
           GROUP BY cl.product_id
           ORDER BY net DESC LIMIT 200`,
          wp,
        );
        const byOperator = await client.query<{ key: string; units: string; net: string }>(
          `SELECT coalesce(st.name,'—') AS key, sum(cl.quantity)::bigint AS units,
                  sum(cl.quantity*(cl.base_price+cl.variant_delta+cl.modifier_total))::bigint AS net
           ${joinSale}
           JOIN merchant.pos_cart_line cl ON cl.cart_id=s.cart_id
           LEFT JOIN merchant.cash_shift csh ON csh.id=s.cash_shift_id
           LEFT JOIN merchant.staff st ON st.user_id=csh.responsible_operator_id AND st.merchant_id=s.merchant_id
           WHERE ${range}
           GROUP BY 1 ORDER BY net DESC`,
          wp,
        );
        const byHour = await client.query<{ key: string; units: string; net: string }>(
          `SELECT to_char((s.committed_at AT TIME ZONE $5), 'HH24') AS key, sum(cl.quantity)::bigint AS units,
                  sum(cl.quantity*(cl.base_price+cl.variant_delta+cl.modifier_total))::bigint AS net
           ${joinSale}
           JOIN merchant.pos_cart_line cl ON cl.cart_id=s.cart_id
           WHERE ${range}
           GROUP BY 1 ORDER BY 1`,
          [...wp, tz],
        );
        const series =
          window.bucket === 'hour'
            ? await client.query<{ label: string; amount: string }>(
                `SELECT to_char((s.committed_at AT TIME ZONE $5), 'HH24') AS label,
                        coalesce(sum(r.grand_total),0)::bigint AS amount
                 ${joinSale}
                 WHERE ${range}
                 GROUP BY 1 ORDER BY 1`,
                [...wp, tz],
              )
            : await client.query<{ label: string; amount: string }>(
                `SELECT r.business_date::text AS label, coalesce(sum(r.grand_total),0)::bigint AS amount
                 ${joinSale}
                 WHERE ${range}
                 GROUP BY 1 ORDER BY 1`,
                wp,
              );

        const net = Number(totals.rows[0]?.net ?? 0);
        const orders = Number(totals.rows[0]?.orders ?? 0);
        return {
          merchantId,
          locationId,
          range: query.range,
          currency,
          bucket: window.bucket,
          totals: {
            netSalesMinorUnits: net,
            orders,
            averageTicketMinorUnits: orders ? Math.round(net / orders) : 0,
            itemsSold: Number(itemsRow.rows[0]?.units ?? 0),
            discountMinorUnits: Number(totals.rows[0]?.discount ?? 0),
            tipsMinorUnits: Number(totals.rows[0]?.tips ?? 0),
            priorNetSalesMinorUnits: Number(prior.rows[0]?.net ?? 0),
          },
          paymentMix: [...payments.rows, ...walletPayments.rows].map((p) => ({
            method: p.method as 'cash' | 'manual_terminal' | 'wallet' | 'gift_card',
            amountMinorUnits: Number(p.amount),
          })),
          productMix: products.rows.map((p) => ({
            productId: p.productId,
            productName: p.productName,
            category: p.category,
            units: Number(p.units),
            netMinorUnits: Number(p.net),
          })),
          byOperator: byOperator.rows.map((r) => ({
            key: r.key,
            units: Number(r.units),
            netMinorUnits: Number(r.net),
          })),
          byHour: byHour.rows.map((r) => ({
            key: r.key,
            units: Number(r.units),
            netMinorUnits: Number(r.net),
          })),
          series: series.rows.map((s) => ({
            label: s.label,
            amountMinorUnits: Number(s.amount),
          })),
          capturedAt: new Date().toISOString(),
        };
      },
      locationId ?? undefined,
    );
  }

  // The reconciliation drill-down for one cash shift: roles, the cash-math components,
  // opening + counted denominations, the full ledger, count attempts, and a synthesized
  // trazabilidad. Read-only, RLS-scoped. Null when the shift is not visible in scope.
  cashShiftDetail(
    userId: string,
    merchantId: string,
    shiftId: string,
    locationId: string | null,
  ): Promise<CashShiftDetail | null> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client): Promise<CashShiftDetail | null> => {
        const head = await client.query<{
          status: string;
          businessDate: string;
          openedAt: string | null;
          closedAt: string | null;
          currency: string;
          opening: string;
          openingDenominations: unknown;
          register: string | null;
          openedBy: string | null;
          tolerance: string | null;
          locationId: string;
        }>(
          `SELECT s.status, s.business_date::text AS "businessDate",
                  s.opened_at::text AS "openedAt", s.closed_at::text AS "closedAt", s.currency,
                  s.opening_float_minor_units::text AS opening,
                  s.opening_denominations AS "openingDenominations",
                  r.public_reference AS register, op.name AS "openedBy",
                  pol.variance_tolerance::text AS tolerance, s.location_id::text AS "locationId"
           FROM merchant.cash_shift s
           JOIN merchant.physical_register r ON r.id=s.register_id
           LEFT JOIN merchant.staff op ON op.user_id=s.opening_operator_id AND op.merchant_id=s.merchant_id
           LEFT JOIN merchant.cash_shift_policy pol
             ON pol.merchant_id=s.merchant_id AND pol.location_id=s.location_id
           WHERE s.id=$1::uuid AND s.merchant_id=$2::uuid`,
          [shiftId, merchantId],
        );
        const h = head.rows[0];
        if (!h) return null;
        if (locationId && h.locationId && h.locationId !== locationId) return null;

        const sums = await client.query<{
          cashSales: string;
          paidIn: string;
          paidOut: string;
          safeDrop: string;
          refunds: string;
          drawer: string;
          handoff: string;
        }>(
          `SELECT
             coalesce(sum(case when entry_type='cash_sale' then coalesce(cash_received_minor_units,0)-coalesce(change_given_minor_units,0) else 0 end),0)::text AS "cashSales",
             coalesce(sum(case when entry_type='paid_in' then amount_minor_units else 0 end),0)::text AS "paidIn",
             coalesce(sum(case when entry_type='paid_out' then amount_minor_units else 0 end),0)::text AS "paidOut",
             coalesce(sum(case when entry_type='safe_drop' then amount_minor_units else 0 end),0)::text AS "safeDrop",
             coalesce(sum(case when entry_type='cash_refund' then amount_minor_units else 0 end),0)::text AS refunds,
             coalesce(sum(case when entry_type='drawer_correction' then amount_minor_units else 0 end),0)::text AS drawer,
             coalesce(sum(case when entry_type='handoff_transfer' then amount_minor_units else 0 end),0)::text AS handoff
           FROM merchant.cash_ledger_entry WHERE shift_id=$1::uuid`,
          [shiftId],
        );
        const ledgerRows = await client.query<{
          type: string;
          amt: string;
          recv: string | null;
          chg: string | null;
          occurredAt: string;
          saleId: string | null;
          receiptNumber: string | null;
          reasonCode: string | null;
          note: string | null;
        }>(
          `SELECT le.entry_type AS type, le.amount_minor_units::text AS amt,
                  le.cash_received_minor_units::text AS recv, le.change_given_minor_units::text AS chg,
                  le.occurred_at::text AS "occurredAt", le.sale_id::text AS "saleId",
                  rc.receipt_number AS "receiptNumber", mv.reason_code AS "reasonCode", mv.note
           FROM merchant.cash_ledger_entry le
           LEFT JOIN merchant.cash_movement mv ON mv.id=le.movement_id
           LEFT JOIN merchant.pos_committed_sale cs ON cs.id=le.sale_id
           LEFT JOIN merchant.receipt_snapshot rc ON rc.id=cs.receipt_snapshot_id
           WHERE le.shift_id=$1::uuid ORDER BY le.sequence`,
          [shiftId],
        );
        const countRows = await client.query<{
          attempt: number;
          counted: string;
          state: string;
          denominations: unknown;
          submittedAt: string;
          operator: string | null;
        }>(
          `SELECT cca.attempt_number AS attempt, cca.counted_minor_units::text AS counted,
                  cca.state, cca.denominations, cca.submitted_at::text AS "submittedAt",
                  st.name AS operator
           FROM merchant.cash_count_attempt cca
           LEFT JOIN merchant.staff st ON st.user_id=cca.operator_id AND st.merchant_id=cca.merchant_id
           WHERE cca.shift_id=$1::uuid ORDER BY cca.attempt_number`,
          [shiftId],
        );
        const resolution = await client.query<{
          reason: string;
          resolvedAt: string;
          approved: boolean;
        }>(
          `SELECT reason, resolved_at::text AS "resolvedAt", approval_id IS NOT NULL AS approved
           FROM merchant.cash_variance_resolution WHERE shift_id=$1::uuid
           ORDER BY resolved_at DESC LIMIT 1`,
          [shiftId],
        );
        const custody = await client.query<{
          eventType: string;
          actor: string | null;
          before: string;
          after: string;
          at: string;
        }>(
          `SELECT ce.event_type AS "eventType", st.name AS actor,
                  ce.shift_status_before AS before, ce.shift_status_after AS after,
                  ce.occurred_at::text AS at
           FROM merchant.cash_shift_custody_event ce
           LEFT JOIN merchant.staff st ON st.user_id=ce.acting_operator_id AND st.merchant_id=ce.merchant_id
           WHERE ce.shift_id=$1::uuid ORDER BY ce.occurred_at`,
          [shiftId],
        );

        const mapDenoms = (raw: unknown): CashShiftDetail['openingDenominations'] => {
          if (!Array.isArray(raw)) return [];
          return (raw as Array<Record<string, unknown>>).map((entry) => {
            const den = (entry.denomination ?? {}) as Record<string, unknown>;
            const face = Number(den.minorUnits ?? 0);
            const line = (entry.lineTotal ?? {}) as Record<string, unknown>;
            const qty = entry.quantity == null ? null : Number(entry.quantity);
            const value = Number(line.minorUnits ?? (face && qty ? face * qty : 0));
            return {
              label: face ? `$${(face / 100).toLocaleString('es-MX')}` : 'Monedas',
              count: qty,
              valueMinorUnits: Number.isFinite(value) && value >= 0 ? value : 0,
            };
          });
        };
        const signed = (type: string, amt: number, recv: number, chg: number): number => {
          if (type === 'cash_sale') return recv - chg;
          if (type === 'paid_out' || type === 'safe_drop' || type === 'cash_refund') return -amt;
          return amt;
        };

        const opening = Number(h.opening);
        const cashSales = Number(sums.rows[0]?.cashSales ?? 0);
        const paidIn = Number(sums.rows[0]?.paidIn ?? 0);
        const paidOut = Number(sums.rows[0]?.paidOut ?? 0);
        const safeDrop = Number(sums.rows[0]?.safeDrop ?? 0);
        const refunds = Number(sums.rows[0]?.refunds ?? 0);
        const drawer = Number(sums.rows[0]?.drawer ?? 0);
        const handoff = Number(sums.rows[0]?.handoff ?? 0);
        const expected = opening + cashSales + paidIn - paidOut - safeDrop - refunds + drawer + handoff;

        const lastCount = countRows.rows[countRows.rows.length - 1] ?? null;
        const showCounted = ['counting', 'reconciliation_required', 'closing', 'closed'].includes(
          h.status,
        );
        const counted = showCounted && lastCount ? Number(lastCount.counted) : null;
        const resolutionRow = resolution.rows[0] ?? null;

        const traza: CashShiftDetail['traza'] = [];
        traza.push({
          kind: 'open',
          text: `${h.openedBy || 'Operador'} abrió el turno`,
          at: h.openedAt,
        });
        for (const c of countRows.rows) {
          traza.push({
            kind: 'count',
            text: `${c.operator || 'Operador'} envió el arqueo (intento ${c.attempt})`,
            at: c.submittedAt,
          });
        }
        for (const ce of custody.rows) {
          traza.push({
            kind: 'custody',
            text: `Custodia: ${ce.eventType} · ${ce.before} → ${ce.after}${ce.actor ? ` · ${ce.actor}` : ''}`,
            at: ce.at,
          });
        }
        if (resolutionRow) {
          traza.push({
            kind: 'resolution',
            text: `Diferencia resuelta (${resolutionRow.reason})`,
            at: resolutionRow.resolvedAt,
          });
        }
        traza.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));

        return {
          shiftId,
          register: h.register,
          status: h.status,
          businessDate: h.businessDate,
          openedAt: h.openedAt,
          closedAt: h.closedAt,
          currency: h.currency,
          roles: {
            opened: { name: h.openedBy, at: h.openedAt },
            counted: lastCount ? { name: lastCount.operator, at: lastCount.submittedAt } : null,
            approved: resolutionRow
              ? {
                  name: resolutionRow.approved ? 'Aprobado por gerente' : 'Automático',
                  at: resolutionRow.resolvedAt,
                }
              : null,
          },
          math: {
            openingMinorUnits: opening,
            cashSalesMinorUnits: cashSales,
            paidInMinorUnits: paidIn,
            paidOutMinorUnits: paidOut,
            safeDropMinorUnits: safeDrop,
            refundsMinorUnits: refunds,
            expectedMinorUnits: expected,
            countedMinorUnits: counted,
            varianceMinorUnits: counted == null ? null : counted - expected,
            toleranceMinorUnits: Number(h.tolerance ?? 0),
          },
          openingDenominations: mapDenoms(h.openingDenominations),
          countDenominations: lastCount ? mapDenoms(lastCount.denominations) : null,
          ledger: ledgerRows.rows.map((row) => ({
            type: row.type,
            amountMinorUnits: signed(
              row.type,
              Number(row.amt),
              Number(row.recv ?? 0),
              Number(row.chg ?? 0),
            ),
            occurredAt: row.occurredAt,
            saleId: row.saleId,
            receiptNumber: row.receiptNumber,
            reasonCode: row.reasonCode,
            note: row.note,
          })),
          counts: countRows.rows.map((row) => ({
            attempt: row.attempt,
            countedMinorUnits: Number(row.counted),
            state: row.state,
          })),
          traza,
          capturedAt: new Date().toISOString(),
        };
      },
      locationId ?? undefined,
    );
  }
}
