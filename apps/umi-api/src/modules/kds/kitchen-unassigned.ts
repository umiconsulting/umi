import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  KitchenUnassignedCommandResult,
  KitchenUnassignedOrderProjection,
  type PosKitchenOrderQuery,
  type PosKitchenUnassignedCommandRequest,
} from '@umi/contract';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AuthUser } from '../auth/auth.types';
import { commercialCancellationSql } from './kitchen-commercial-state';
import {
  deriveKitchenOrderStatus,
  type KitchenItemStatus,
  type KitchenOrderStatus,
} from './kitchen-domain';
import { loadKitchenProjection } from './kitchen-projector';
import { kitchenFulfillmentType } from './kitchen-fulfillment';

export type UnassignedAction = 'resolve_routes' | 'discard';

export async function authorizeUnassigned(
  client: PoolClient,
  user: AuthUser,
  merchantId: string,
  query: PosKitchenOrderQuery,
  action?: UnassignedAction,
) {
  const permission =
    action === 'resolve_routes'
      ? 'kitchen.station.manage'
      : action === 'discard'
        ? 'kitchen.cancel_ack'
        : 'kitchen.read';
  const result = await client.query(
    `SELECT os.id FROM runtime.operator_session os
       JOIN merchant.device d ON d.id=os.device_id AND d.merchant_id=os.merchant_id
      WHERE os.id=$1::uuid AND os.user_id=$2::uuid AND os.durable_session_id=$3::uuid
        AND os.device_id=$4::uuid AND os.merchant_id=$5::uuid AND os.location_id=$6::uuid
        AND os.state='active' AND os.expires_at>now() AND d.status='active'
        AND ('kitchen.read'=ANY(os.permissions) OR '*'=ANY(os.permissions))
        AND ($7=ANY(os.permissions) OR '*'=ANY(os.permissions))
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(os.entitlements) e
          WHERE e->>'featureKey'='pos' AND coalesce((e->>'enabled')::boolean,false))
      FOR SHARE OF os,d`,
    [
      query.operatorSessionId,
      user.id,
      user.sessionId,
      user.deviceId,
      merchantId,
      query.locationId,
      permission,
    ],
  );
  if (!result.rowCount) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
}

interface PendingItem {
  id: string;
  source_order_item_id: string;
  product_name: string;
  status: KitchenItemStatus;
}

async function proposedRoutes(
  client: PoolClient,
  merchantId: string,
  sourceOrderId: string,
  items: PendingItem[],
  lockRoutes = false,
) {
  const projection = await loadKitchenProjection(client, merchantId, sourceOrderId, lockRoutes);
  const proposed = items.map((item) => {
    const assignment =
      item.status === 'exception'
        ? projection?.routeByLine.get(item.source_order_item_id)
        : undefined;
    const route = projection?.routeRows.find((candidate) => candidate.id === assignment?.routeId);
    const line = projection?.rows.find(
      (candidate) => candidate.lineId === item.source_order_item_id,
    );
    return {
      itemId: item.id,
      productName: item.product_name,
      sourceLineId: item.source_order_item_id,
      stationId: route?.stationId ?? null,
      stationName: route?.stationName ?? null,
      routeId: route?.id ?? null,
      targetSeconds: route?.targetSeconds ?? line?.targetSeconds ?? null,
    };
  });
  return {
    proposed,
    fingerprint: createHash('sha256').update(JSON.stringify(proposed)).digest('hex'),
  };
}

export async function readUnassigned(client: PoolClient, merchantId: string, locationId: string) {
  const orders = await client.query<{
    id: string;
    source_order_id: string;
    public_reference: string;
    source: string;
    fulfillment_type: string | null;
    status: KitchenOrderStatus;
    priority: string;
    business_date: string;
    queued_at: Date;
    preparation_started_at: Date | null;
    updated_at: Date;
    version: number;
    fired_through_course: number;
    sequence: string;
    cancelled: boolean;
  }>(
    `SELECT ko.*,ko.business_date::text,ko.version::int,
      coalesce((SELECT max(sequence) FROM merchant.kitchen_event e
        WHERE e.merchant_id=ko.merchant_id AND e.kitchen_order_id=ko.id),0)::text AS sequence,
      ${commercialCancellationSql('ko')} OR ko.status='cancelled' AS cancelled
     FROM merchant.kitchen_order ko
     WHERE ko.merchant_id=$1::uuid AND ko.location_id=$2::uuid
       AND ko.status<>'completed' AND EXISTS (
         SELECT 1 FROM merchant.kitchen_order_item i
         WHERE i.merchant_id=ko.merchant_id AND i.kitchen_order_id=ko.id
           AND i.station_id IS NULL AND i.station_completed_at IS NULL
           AND (i.status<>'cancelled' OR ko.status='cancelled' OR ${commercialCancellationSql('ko')}))
     ORDER BY ko.queued_at,ko.id`,
    [merchantId, locationId],
  );
  const result = [];
  for (const order of orders.rows) {
    const items = await client.query<PendingItem & { item: Record<string, unknown> }>(
      `SELECT i.id::text,i.source_order_item_id::text,i.product_name,i.status,
        jsonb_build_object('id',i.id,'status',i.status,'productName',i.product_name,
          'variantName',i.variant_name,'modifiers',i.modifiers,'quantity',i.quantity,
          'preparationNote',i.preparation_note,'displayOrder',i.display_order,
          'targetSeconds',i.target_seconds,'courseNumber',i.course_number,'fired',i.course_number<=$3,
          'version',i.version,'allergens',CASE WHEN i.product_id IS NULL THEN '[]'::jsonb ELSE
            coalesce((SELECT jsonb_agg(jsonb_build_object('code',a.code,'label',a.label) ORDER BY a.code)
              FROM merchant.product_allergen_labels(i.merchant_id,i.product_id,null) a),'[]'::jsonb) END) AS item
       FROM merchant.kitchen_order_item i WHERE i.merchant_id=$1::uuid AND i.kitchen_order_id=$2::uuid
         AND i.station_id IS NULL AND i.station_completed_at IS NULL
         AND (i.status<>'cancelled' OR $4::boolean) ORDER BY i.display_order,i.id`,
      [merchantId, order.id, order.fired_through_course, order.cancelled],
    );
    const preview = await proposedRoutes(
      client,
      merchantId,
      order.source_order_id,
      order.cancelled ? [] : items.rows,
    );
    result.push(
      KitchenUnassignedOrderProjection.parse({
        id: order.id,
        sourceOrderId: order.source_order_id,
        publicReference: order.public_reference,
        merchantId,
        locationId,
        stationId: null,
        stationName: 'Sin estación',
        source: order.source,
        fulfillmentType: kitchenFulfillmentType(order.fulfillment_type),
        status: order.cancelled ? 'cancelled' : 'exception',
        priority: order.priority,
        businessDate: order.business_date,
        queuedAt: order.queued_at.toISOString(),
        preparationStartedAt: order.preparation_started_at?.toISOString() ?? null,
        updatedAt: order.updated_at.toISOString(),
        version: Number(order.version),
        lastEventSequence: Number(order.sequence),
        firedThroughCourse: order.fired_through_course,
        items: items.rows.map((row) => ({
          ...row.item,
          ...(order.cancelled ? { status: 'cancelled' } : {}),
        })),
        routingFingerprint: preview.fingerprint,
        proposedRoutes: preview.proposed.map(({ itemId, productName, stationId, stationName }) => ({
          itemId,
          productName,
          stationId,
          stationName,
        })),
      }),
    );
  }
  return result;
}

export async function changeUnassigned(
  client: PoolClient,
  user: AuthUser,
  merchantId: string,
  dto: PosKitchenUnassignedCommandRequest,
  action: UnassignedAction,
): Promise<KitchenUnassignedCommandResult> {
  await authorizeUnassigned(client, user, merchantId, dto, action);
  // La cancelación comercial y el comando comparten estos bloqueos.
  await client.query(
    `SELECT co.id FROM merchant.customer_order co JOIN merchant.kitchen_order ko
    ON ko.source_order_id=co.id AND ko.merchant_id=co.merchant_id
    WHERE ko.id=$1::uuid AND ko.merchant_id=$2::uuid AND ko.location_id=$3::uuid FOR SHARE OF co`,
    [dto.kitchenOrderId, merchantId, dto.locationId],
  );
  await client.query(
    `SELECT c.id FROM merchant.pos_cart c JOIN merchant.kitchen_order ko
    ON ko.source_order_id=c.fired_order_id AND ko.merchant_id=c.merchant_id
    WHERE ko.id=$1::uuid AND ko.merchant_id=$2::uuid AND ko.location_id=$3::uuid FOR SHARE OF c`,
    [dto.kitchenOrderId, merchantId, dto.locationId],
  );
  const locked = await client.query<{
    source_order_id: string;
    status: KitchenOrderStatus;
    version: number;
    updated_at: Date;
    cancelled: boolean;
    route_snapshot: Array<{ lineId: string; routeId: string | null; stationId: string | null }>;
  }>(
    `SELECT ko.source_order_id::text,ko.status,ko.version::int,ko.updated_at,ko.route_snapshot,
      ${commercialCancellationSql('ko')} OR ko.status='cancelled' AS cancelled
     FROM merchant.kitchen_order ko WHERE ko.id=$1::uuid AND ko.merchant_id=$2::uuid AND ko.location_id=$3::uuid FOR UPDATE`,
    [dto.kitchenOrderId, merchantId, dto.locationId],
  );
  const current = locked.rows[0];
  if (!current) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
  if (current.version !== dto.expectedVersion)
    throw new ConflictException({
      code: 'OPTIMISTIC_VERSION_CONFLICT',
      currentVersion: current.version,
    });
  if (
    current.status === 'completed' ||
    (action === 'resolve_routes' ? current.cancelled : !current.cancelled)
  )
    throw new ConflictException({ code: 'KITCHEN_INVALID_TRANSITION' });
  const pending = await client.query<PendingItem>(
    `SELECT id::text,source_order_item_id::text,product_name,status
    FROM merchant.kitchen_order_item WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid
      AND station_id IS NULL AND station_completed_at IS NULL
      AND (status<>'cancelled' OR $3::boolean) ORDER BY display_order,id FOR UPDATE`,
    [merchantId, dto.kitchenOrderId, current.cancelled],
  );
  let resolvedItems = 0,
    discardedItems = 0;
  const snapshot = [...current.route_snapshot];
  if (action === 'resolve_routes') {
    const preview = await proposedRoutes(
      client,
      merchantId,
      current.source_order_id,
      pending.rows,
      true,
    );
    if (dto.routingFingerprint !== preview.fingerprint)
      throw new ConflictException({
        code: 'OPTIMISTIC_VERSION_CONFLICT',
        message: 'Kitchen routing changed. Read the preview again.',
      });
    for (const route of preview.proposed) {
      if (!route.stationId) continue;
      const effect = await client.query(
        `UPDATE merchant.kitchen_order_item SET station_id=$3::uuid,status='queued',
        route_reason='configured_route',target_seconds=$4,version=version+1,updated_at=clock_timestamp()
        WHERE merchant_id=$1::uuid AND id=$2::uuid AND station_id IS NULL AND status='exception'`,
        [merchantId, route.itemId, route.stationId, route.targetSeconds],
      );
      resolvedItems += effect.rowCount ?? 0;
      const index = snapshot.findIndex((entry) => entry.lineId === route.sourceLineId);
      const entry = {
        lineId: route.sourceLineId,
        routeId: route.routeId,
        stationId: route.stationId,
      };
      if (index < 0) snapshot.push(entry);
      else snapshot[index] = entry;
    }
  } else {
    const effect = await client.query(
      `UPDATE merchant.kitchen_order_item SET status='cancelled',station_completed_at=clock_timestamp(),
      version=version+1,updated_at=clock_timestamp() WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid
      AND station_id IS NULL AND station_completed_at IS NULL`,
      [merchantId, dto.kitchenOrderId],
    );
    discardedItems = effect.rowCount ?? 0;
  }
  const remaining = await client.query<{ count: string }>(
    `SELECT count(*)::text FROM merchant.kitchen_order_item
    WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid AND station_id IS NULL AND station_completed_at IS NULL
      AND (status<>'cancelled' OR $3::boolean)`,
    [merchantId, dto.kitchenOrderId, current.cancelled],
  );
  let status: KitchenOrderStatus = current.cancelled ? 'cancelled' : current.status;
  let version = current.version;
  let updatedAt = current.updated_at;
  const latest = await client.query<{ sequence: string }>(
    `SELECT coalesce(max(sequence),0)::text AS sequence
    FROM merchant.kitchen_event WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid`,
    [merchantId, dto.kitchenOrderId],
  );
  let sequence = Number(latest.rows[0].sequence);
  if (resolvedItems + discardedItems > 0) {
    const states = await client.query<{ status: KitchenItemStatus }>(
      `SELECT status FROM merchant.kitchen_order_item
      WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid`,
      [merchantId, dto.kitchenOrderId],
    );
    status = current.cancelled
      ? 'cancelled'
      : deriveKitchenOrderStatus(states.rows.map((row) => row.status));
    const updated = await client.query<{ updated_at: Date }>(
      `UPDATE merchant.kitchen_order SET status=$3,version=version+1,
      updated_at=clock_timestamp(),route_snapshot=$4::jsonb WHERE merchant_id=$1::uuid AND id=$2::uuid RETURNING updated_at`,
      [merchantId, dto.kitchenOrderId, status, JSON.stringify(snapshot)],
    );
    version++;
    updatedAt = updated.rows[0].updated_at;
    const event = await client.query<{ sequence: string }>(
      `INSERT INTO merchant.kitchen_event
      (event_id,merchant_id,location_id,kitchen_order_id,kind,aggregate_version,status,safe_payload,correlation_id)
      VALUES (gen_random_uuid(),$1::uuid,$2::uuid,$3::uuid,'order_updated',$4,$5,$6::jsonb,$7) RETURNING sequence::text`,
      [
        merchantId,
        dto.locationId,
        dto.kitchenOrderId,
        version,
        status,
        JSON.stringify({ action, resolvedItems, discardedItems }),
        dto.idempotencyKey,
      ],
    );
    sequence = Number(event.rows[0].sequence);
    await client.query(`SELECT pg_notify('umi_kitchen_board',$1::text)`, [
      JSON.stringify({
        merchant_id: merchantId,
        location_id: dto.locationId,
        kitchen_order_id: dto.kitchenOrderId,
      }),
    ]);
  }
  return KitchenUnassignedCommandResult.parse({
    kitchenOrderId: dto.kitchenOrderId,
    status,
    version,
    sequence,
    updatedAt: updatedAt.toISOString(),
    resolvedItems,
    discardedItems,
    remainingItems: Number(remaining.rows[0].count),
  });
}
