import type { PoolClient } from 'pg';
import { resolveKitchenRoutes } from './kitchen-domain';

interface ProjectionLineRow {
  orderId: string;
  merchantId: string;
  locationId: string | null;
  publicReference: string;
  source: 'whatsapp' | 'pos' | 'web' | 'dashboard';
  fulfillmentType: string | null;
  businessDate: string;
  queuedAt: string;
  lineId: string;
  productId: string | null;
  categoryId: string | null;
  requiresPreparation: boolean;
  productName: string;
  variantName: string | null;
  quantity: number;
  preparationNote: string | null;
  displayOrder: number;
  targetSeconds: number | null;
  modifiers: string[];
}

interface RouteRow {
  id: string;
  stationId: string;
  productId: string | null;
  categoryId: string | null;
  priority: number;
  targetSeconds: number | null;
}

export async function projectKitchenOrder(
  client: Pick<PoolClient, 'query'>,
  merchantId: string,
  sourceOrderId: string,
): Promise<{ kitchenOrderId: string; created: boolean } | null> {
  const existing = await client.query<{ id: string }>(
    `SELECT id::text FROM merchant.kitchen_order
      WHERE merchant_id=$1::uuid AND source_order_id=$2::uuid`,
    [merchantId, sourceOrderId],
  );
  if (existing.rows[0]) return { kitchenOrderId: existing.rows[0].id, created: false };

  const source = await client.query<ProjectionLineRow>(
    `SELECT o.id::text AS "orderId",o.merchant_id::text AS "merchantId",
            o.location_id::text AS "locationId",
            COALESCE(o.external_ref,o.id::text) AS "publicReference",
            o.source,o.fulfillment_type AS "fulfillmentType",
            o.business_date::text AS "businessDate",o.placed_at::text AS "queuedAt",
            i.id::text AS "lineId",i.product_id::text AS "productId",
            p.category_id::text AS "categoryId",
            COALESCE(p.requires_preparation,false) AS "requiresPreparation",
            i.name AS "productName",i.variant_name AS "variantName",i.quantity,
            i.notes AS "preparationNote",i.display_order AS "displayOrder",
            p.preparation_target_seconds AS "targetSeconds",
            COALESCE(mods.names,'{}'::text[]) AS modifiers
       FROM merchant.customer_order o
       JOIN merchant.order_item i ON i.order_id=o.id AND i.voided_at IS NULL
       LEFT JOIN merchant.product p ON p.id=i.product_id AND p.merchant_id=o.merchant_id
       LEFT JOIN LATERAL (
         SELECT array_agg(m.name ORDER BY m.name,m.id) names
           FROM merchant.order_item_modifier m WHERE m.order_item_id=i.id
       ) mods ON true
      WHERE o.merchant_id=$1::uuid AND o.id=$2::uuid
      ORDER BY i.display_order,i.id`,
    [merchantId, sourceOrderId],
  );
  const first = source.rows[0];
  if (!first || !first.locationId) return null;

  const routeRows = await client.query<RouteRow>(
    `SELECT r.id::text,r.station_id::text AS "stationId",
            r.product_id::text AS "productId",r.category_id::text AS "categoryId",
            r.route_priority AS priority,r.target_seconds AS "targetSeconds"
       FROM merchant.kitchen_route r
       JOIN merchant.station s ON s.id=r.station_id AND s.merchant_id=r.merchant_id
      WHERE r.merchant_id=$1::uuid AND r.location_id=$2::uuid
        AND r.active AND r.requires_preparation AND s.status='active'
        AND s.location_id=$2::uuid
      ORDER BY r.route_priority,r.id`,
    [merchantId, first.locationId],
  );
  const routing = resolveKitchenRoutes(
    source.rows.map((line) => ({
      id: line.lineId,
      productId: line.productId,
      categoryId: line.categoryId,
      requiresPreparation: line.requiresPreparation,
    })),
    routeRows.rows,
  );
  if (routing.length === 0) return null;

  const routeByLine = new Map(routing.map((route) => [route.lineId, route]));
  const status = routing.some((route) => route.status === 'exception') ? 'exception' : 'queued';
  const routeSnapshot = routing.map((route) => ({
    lineId: route.lineId,
    routeId: route.routeId,
    stationId: route.stationId,
  }));
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO merchant.kitchen_order
       (merchant_id,location_id,source_order_id,public_reference,source,fulfillment_type,
        business_date,status,route_snapshot,queued_at)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::date,$8,$9::jsonb,$10::timestamptz)
     ON CONFLICT (merchant_id,source_order_id) DO NOTHING
     RETURNING id::text`,
    [
      merchantId,
      first.locationId,
      sourceOrderId,
      first.publicReference,
      first.source,
      first.fulfillmentType,
      first.businessDate,
      status,
      JSON.stringify(routeSnapshot),
      first.queuedAt,
    ],
  );
  if (!inserted.rows[0]) {
    const recovered = await client.query<{ id: string }>(
      `SELECT id::text FROM merchant.kitchen_order
        WHERE merchant_id=$1::uuid AND source_order_id=$2::uuid`,
      [merchantId, sourceOrderId],
    );
    return recovered.rows[0] ? { kitchenOrderId: recovered.rows[0].id, created: false } : null;
  }
  const kitchenOrderId = inserted.rows[0].id;

  for (const line of source.rows) {
    const assignment = routeByLine.get(line.lineId);
    if (!assignment) continue;
    const selectedRoute = routeRows.rows.find((route) => route.id === assignment.routeId);
    await client.query(
      `INSERT INTO merchant.kitchen_order_item
         (merchant_id,location_id,kitchen_order_id,source_order_id,source_order_item_id,
          station_id,status,product_id,product_name,variant_name,modifiers,quantity,
          preparation_note,display_order,route_reason,target_seconds)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8::uuid,$9,$10,
               $11::jsonb,$12,$13,$14,$15,$16)
       ON CONFLICT (merchant_id,source_order_item_id) DO NOTHING`,
      [
        merchantId,
        first.locationId,
        kitchenOrderId,
        sourceOrderId,
        line.lineId,
        assignment.stationId,
        assignment.status,
        line.productId,
        line.productName,
        line.variantName,
        JSON.stringify(line.modifiers),
        line.quantity,
        line.preparationNote,
        line.displayOrder,
        assignment.routeId ? 'configured_route' : 'missing_route',
        selectedRoute?.targetSeconds ?? line.targetSeconds,
      ],
    );
  }

  await client.query(
    `UPDATE merchant.kitchen_order SET route_snapshot=$3::jsonb
      WHERE merchant_id=$1::uuid AND id=$2::uuid`,
    [merchantId, kitchenOrderId, JSON.stringify(routeSnapshot)],
  );
  await client.query(
    `INSERT INTO merchant.kitchen_event
       (event_id,merchant_id,location_id,kitchen_order_id,kind,aggregate_version,status,
        safe_payload,correlation_id)
     VALUES (gen_random_uuid(),$1::uuid,$2::uuid,$3::uuid,'order_created',1,$4,
             jsonb_build_object('stationIds',$5::jsonb),$6)`,
    [
      merchantId,
      first.locationId,
      kitchenOrderId,
      status,
      JSON.stringify([...new Set(routing.flatMap((route) => route.stationId ?? []))]),
      `kitchen:create:${sourceOrderId}`,
    ],
  );
  return { kitchenOrderId, created: true };
}
