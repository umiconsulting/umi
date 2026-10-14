import type { PoolClient } from 'pg';

/** Keep the account context on its existing commercial and kitchen order. */
export async function syncCartOrderContext(
  client: PoolClient,
  merchantId: string,
  cartId: string,
  orderId: string,
) {
  const result = await client.query<{
    locationId: string;
    fulfillmentType: string;
    context: Record<string, unknown>;
    reference: string;
  }>(
    `SELECT location_id::text AS "locationId",fulfillment_type AS "fulfillmentType",
      jsonb_build_object('accountFolio','Cuenta '||lpad(COALESCE(daily_account_number,account_number)::text,
        greatest(3,length(COALESCE(daily_account_number,account_number)::text)),'0'),
        'accountName',display_label,'tableId',table_id,'tableName',table_name,'tableVisitId',table_visit_id) AS context,
      left('Cuenta '||lpad(COALESCE(daily_account_number,account_number)::text,
        greatest(3,length(COALESCE(daily_account_number,account_number)::text)),'0')||
        CASE WHEN table_name IS NULL THEN '' ELSE ' · '||table_name END||
        CASE WHEN display_label IS NULL THEN '' ELSE ' · '||display_label END,160) AS reference
      FROM merchant.pos_cart WHERE merchant_id=$1::uuid AND id=$2::uuid`,
    [merchantId, cartId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('CART_CONTEXT_NOT_FOUND');
  await client.query(
    `UPDATE merchant.customer_order SET source_context=source_context||$4::jsonb,
    fulfillment_type=CASE WHEN $5='takeout' THEN 'pickup' ELSE $5 END,updated_at=now()
    WHERE id=$3::uuid AND merchant_id=$1::uuid AND location_id=$2::uuid
    AND (source_context IS DISTINCT FROM source_context||$4::jsonb
      OR fulfillment_type IS DISTINCT FROM CASE WHEN $5='takeout' THEN 'pickup' ELSE $5 END)`,
    [merchantId, row.locationId, orderId, JSON.stringify(row.context), row.fulfillmentType],
  );
  const changed = await client.query<{ id: string; version: string; status: string }>(
    `UPDATE merchant.kitchen_order SET source_context=source_context||$4::jsonb,
    fulfillment_type=CASE WHEN $5='takeout' THEN 'pickup' ELSE $5 END,
    public_reference=$6,version=version+1,updated_at=now()
    WHERE source_order_id=$3::uuid AND merchant_id=$1::uuid AND location_id=$2::uuid
    AND (source_context IS DISTINCT FROM source_context||$4::jsonb OR public_reference IS DISTINCT FROM $6
      OR fulfillment_type IS DISTINCT FROM CASE WHEN $5='takeout' THEN 'pickup' ELSE $5 END)
    RETURNING id::text,version::text,status`,
    [
      merchantId,
      row.locationId,
      orderId,
      JSON.stringify(row.context),
      row.fulfillmentType,
      row.reference,
    ],
  );
  if (changed.rows[0]) {
    const ticket = changed.rows[0];
    await client.query(
      `INSERT INTO merchant.kitchen_event(event_id,merchant_id,location_id,kitchen_order_id,
      kind,aggregate_version,status,safe_payload,correlation_id)
      VALUES(gen_random_uuid(),$1::uuid,$2::uuid,$3::uuid,'order_updated',$4::bigint,$5,
        jsonb_build_object('contextUpdated',true),$6)`,
      [
        merchantId,
        row.locationId,
        ticket.id,
        ticket.version,
        ticket.status,
        `account-context:${cartId}:${ticket.version}`,
      ],
    );
    await client.query(`SELECT pg_notify('umi_kitchen_board',$1::text)`, [
      JSON.stringify({
        merchant_id: merchantId,
        location_id: row.locationId,
        kitchen_order_id: ticket.id,
      }),
    ]);
  }
}
