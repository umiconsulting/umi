import { Injectable } from '@nestjs/common';
import type { DashboardOperationDomain, DashboardOperationsQuery } from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';

interface ItemRow {
  id: string;
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
    NULL::bigint AS "amountMinorUnits",r.currency,r.version,NULL::text AS "correlationId" FROM merchant.physical_register r`,
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
    NULL::bigint AS version,NULL::text AS "correlationId" FROM merchant.pos_committed_sale s
    JOIN merchant.receipt_snapshot r ON r.id=s.receipt_snapshot_id
    LEFT JOIN merchant.cash_shift cs ON cs.id=s.cash_shift_id
    LEFT JOIN merchant.staff st ON st.user_id=cs.responsible_operator_id AND st.merchant_id=s.merchant_id
    LEFT JOIN (SELECT order_id,sum(amount) total FROM merchant.order_discount GROUP BY order_id) disc ON disc.order_id=s.order_id`,
    's.merchant_id=$1::uuid',
    's.committed_at DESC,s.id',
  ),
  receipts: row(
    `SELECT coalesce(j.id,r.id)::text AS id,r.receipt_number AS "publicReference",concat('Recibo ',r.receipt_number) AS title,
    concat('Fecha comercial ',r.business_date::text) AS detail,coalesce(j.status,'not_printed') AS status,r.location_id::text AS "locationId",
    r.issued_at::text AS "occurredAt",r.grand_total AS "amountMinorUnits",r.currency,
    NULL::bigint AS version,j.correlation_id AS "correlationId" FROM merchant.receipt_snapshot r
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
    x.currency,NULL::bigint AS version,x.correlation_id AS "correlationId" FROM merchant.pos_sale_exception x
    LEFT JOIN merchant.staff st ON st.user_id=x.operator_id AND st.merchant_id=x.merchant_id`,
    'x.merchant_id=$1::uuid',
    'x.committed_at DESC,x.id',
  ),
  cash_shifts: row(
    `SELECT s.id::text,s.id::text AS "publicReference",concat('Turno ',r.public_reference) AS title,
    concat('Fecha comercial ',s.business_date::text) AS detail,s.status,s.location_id::text AS "locationId",
    coalesce(s.closed_at,s.opened_at)::text AS "occurredAt",s.opening_float_minor_units AS "amountMinorUnits",s.currency,
    s.version,NULL::text AS "correlationId",jsonb_build_object('operator',st.name,'register',r.public_reference,'openingFloatMinorUnits',s.opening_float_minor_units,'expectedCashMinorUnits',(SELECT coalesce(sum(CASE le.entry_type WHEN 'opening_float' THEN le.amount_minor_units WHEN 'cash_sale' THEN coalesce(le.cash_received_minor_units,0)-coalesce(le.change_given_minor_units,0) WHEN 'cash_refund' THEN -le.amount_minor_units WHEN 'paid_in' THEN le.amount_minor_units WHEN 'paid_out' THEN -le.amount_minor_units WHEN 'safe_drop' THEN -le.amount_minor_units WHEN 'drawer_correction' THEN le.amount_minor_units WHEN 'handoff_transfer' THEN le.amount_minor_units ELSE 0 END),0) FROM merchant.cash_ledger_entry le WHERE le.shift_id=s.id),'countedCashMinorUnits',(CASE WHEN s.status IN ('counting','reconciliation_required','closing','closed') THEN (SELECT cca.counted_minor_units FROM merchant.cash_count_attempt cca WHERE cca.shift_id=s.id ORDER BY cca.attempt_number DESC LIMIT 1) ELSE NULL END),'status',s.status) AS facts FROM merchant.cash_shift s JOIN merchant.physical_register r ON r.id=s.register_id LEFT JOIN merchant.staff st ON st.user_id=s.responsible_operator_id AND st.merchant_id=s.merchant_id`,
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
}
