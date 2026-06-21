-- Partial cancellation WhatsApp notifications must survive projection rewrites.
-- The transactions update inside kds.partial_cancel_items fires the projection
-- trigger, which rebuilds kds.ticket_items with fresh UUIDs before the outbox
-- helper runs. Match cancelled items by stable display_order instead.

DROP FUNCTION IF EXISTS kds.enqueue_whatsapp_partial_cancel_notification(UUID, BIGINT, UUID[], TEXT);

CREATE FUNCTION kds.enqueue_whatsapp_partial_cancel_notification(
  p_ticket_id UUID,
  p_event_sequence BIGINT,
  p_cancelled_display_orders INTEGER[],
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = kds, conversaflow, public
AS $$
DECLARE
  v_ticket kds.tickets%ROWTYPE;
  v_phone TEXT;
  v_cancelled_lines TEXT;
  v_remaining_lines TEXT;
  v_total_text TEXT;
  v_body TEXT;
  v_idempotency TEXT;
BEGIN
  IF p_event_sequence IS NULL OR p_event_sequence < 1 THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF lower(trim(coalesce(v_ticket.source_channel, 'whatsapp'))) IS DISTINCT FROM 'whatsapp' THEN
    RETURN;
  END IF;

  v_phone := trim(both ' ' FROM coalesce(v_ticket.customer_phone, ''));
  IF v_phone = '' AND v_ticket.customer_id IS NOT NULL THEN
    SELECT trim(both ' ' FROM coalesce(c.phone, ''))
    INTO v_phone
    FROM conversaflow.customers AS c
    WHERE c.id = v_ticket.customer_id;
  END IF;

  IF coalesce(v_phone, '') = '' THEN
    RETURN;
  END IF;

  v_phone := regexp_replace(v_phone, '\D', '', 'g');
  IF v_phone IS NULL OR v_phone = '' THEN
    RETURN;
  END IF;
  v_phone := '+' || v_phone;

  SELECT string_agg(
    format(
      '• %sx %s%s — %s',
      i.quantity,
      i.name,
      CASE
        WHEN i.variant_name IS NOT NULL AND trim(i.variant_name) <> '' THEN ' (' || trim(i.variant_name) || ')'
        ELSE ''
      END,
      trim(p_reason)
    ),
    E'\n'
    ORDER BY i.display_order
  )
  INTO v_cancelled_lines
  FROM kds.ticket_items AS i
  WHERE i.ticket_id = p_ticket_id
    AND i.display_order = ANY(COALESCE(p_cancelled_display_orders, ARRAY[]::INTEGER[]));

  IF v_cancelled_lines IS NULL THEN
    RETURN;
  END IF;

  SELECT string_agg(
    format(
      '• %sx %s%s',
      i.quantity,
      i.name,
      CASE
        WHEN i.variant_name IS NOT NULL AND trim(i.variant_name) <> '' THEN ' (' || trim(i.variant_name) || ')'
        ELSE ''
      END
    ),
    E'\n'
    ORDER BY i.display_order
  )
  INTO v_remaining_lines
  FROM kds.ticket_items AS i
  WHERE i.ticket_id = p_ticket_id
    AND NOT i.is_cancelled;

  v_total_text := CASE
    WHEN v_ticket.total_amount IS NULL THEN '—'
    ELSE '$' || to_char(v_ticket.total_amount, 'FM999999990.00')
  END;

  v_body :=
    'Se modificó tu pedido:' ||
    E'\n\n❌ Cancelado:\n' || v_cancelled_lines ||
    E'\n\nTu pedido actualizado:\n' || COALESCE(v_remaining_lines, '• Sin artículos restantes') ||
    E'\nTotal: ' || v_total_text ||
    E'\n\n¿Deseas aceptar estos cambios o quieres hacer alguna modificación?';

  v_idempotency := format('twilio_partial_cancel:%s:%s', p_ticket_id, p_event_sequence);

  INSERT INTO conversaflow.outbox (
    job_id,
    business_id,
    kind,
    aggregate_id,
    idempotency_key,
    payload,
    state,
    max_attempts,
    next_run_at
  )
  VALUES (
    NULL,
    v_ticket.business_id,
    'twilio.status_notification',
    v_ticket.source_transaction_id,
    v_idempotency,
    jsonb_build_object(
      'to', v_phone,
      'body', v_body
    ),
    'pending',
    5,
    now()
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION kds.enqueue_whatsapp_partial_cancel_notification(UUID, BIGINT, INTEGER[], TEXT) IS
'Enqueue a Twilio WhatsApp notification describing partially cancelled items and the updated remaining order. Matches cancelled lines by stable display_order so projection rewrites do not drop the outbox insert.';

CREATE OR REPLACE FUNCTION kds.partial_cancel_items(
  p_ticket_id UUID,
  p_item_ids UUID[],
  p_reason TEXT,
  p_actor_source TEXT DEFAULT 'kds',
  p_actor_id TEXT DEFAULT NULL,
  p_actor_channel TEXT DEFAULT NULL
)
RETURNS kds.tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = kds, conversaflow, public
AS $$
DECLARE
  v_ticket kds.tickets%ROWTYPE;
  v_txn_details JSONB;
  v_reason TEXT;
  v_display_orders INTEGER[];
  v_active_count INTEGER;
  v_sequence BIGINT;
BEGIN
  v_reason := NULLIF(trim(COALESCE(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Partial cancellation reason is required.';
  END IF;

  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KDS ticket not found: %', p_ticket_id;
  END IF;

  IF v_ticket.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Ticket % cannot be partially cancelled from status %.', p_ticket_id, v_ticket.status;
  END IF;

  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one ticket item must be selected for partial cancellation.';
  END IF;

  SELECT array_agg(i.display_order ORDER BY i.display_order)
  INTO v_display_orders
  FROM kds.ticket_items AS i
  WHERE i.ticket_id = p_ticket_id
    AND i.ticket_item_id = ANY(p_item_ids)
    AND NOT i.is_cancelled;

  IF v_display_orders IS NULL OR array_length(v_display_orders, 1) IS NULL THEN
    RAISE EXCEPTION 'No active ticket items matched the provided item ids for ticket %.', p_ticket_id;
  END IF;

  SELECT count(*)
  INTO v_active_count
  FROM kds.ticket_items AS i
  WHERE i.ticket_id = p_ticket_id
    AND NOT i.is_cancelled;

  IF array_length(v_display_orders, 1) >= v_active_count THEN
    RAISE EXCEPTION 'Partial cancellation requires at least one remaining active item.';
  END IF;

  SELECT COALESCE(t.details, '{}'::jsonb)
  INTO v_txn_details
  FROM conversaflow.transactions AS t
  WHERE t.id = v_ticket.source_transaction_id
  FOR UPDATE;

  v_txn_details :=
    v_txn_details
    || jsonb_build_object(
      'items',
      (
        SELECT jsonb_agg(
          CASE
            WHEN ordinality::integer = ANY(v_display_orders)
              THEN item || jsonb_build_object('cancelled', TRUE)
            ELSE item
          END
          ORDER BY ordinality
        )
        FROM jsonb_array_elements(COALESCE(v_txn_details->'items', '[]'::jsonb))
          WITH ORDINALITY AS item_list(item, ordinality)
      ),
      'partial_cancellation_reason',
      v_reason
    );

  UPDATE conversaflow.transactions AS t
  SET
    details = v_txn_details,
    total_amount = COALESCE((
      SELECT SUM(
        GREATEST(COALESCE((item->>'quantity')::integer, 1), 1)
        * COALESCE(NULLIF(item->>'unit_price', '')::numeric, 0)
      )
      FROM jsonb_array_elements(COALESCE(v_txn_details->'items', '[]'::jsonb)) AS item
      WHERE NOT COALESCE((item->>'cancelled')::boolean, FALSE)
    ), 0)
  WHERE t.id = v_ticket.source_transaction_id;

  UPDATE kds.tickets
  SET
    status = 'partial_cancelled',
    partial_cancellation_reason = v_reason,
    updated_at = now(),
    last_projected_at = now()
  WHERE ticket_id = p_ticket_id;

  INSERT INTO kds.ticket_events (
    ticket_id,
    business_id,
    source_transaction_id,
    kind,
    status,
    occurred_at,
    source,
    payload
  )
  VALUES (
    v_ticket.ticket_id,
    v_ticket.business_id,
    v_ticket.source_transaction_id,
    'order_upserted',
    'partial_cancelled',
    now(),
    p_actor_source,
    jsonb_build_object(
      'cancelled_item_ids', COALESCE(to_jsonb(p_item_ids), '[]'::jsonb),
      'partial_cancellation_reason', v_reason,
      'actor_id', p_actor_id,
      'actor_channel', p_actor_channel
    )
  )
  RETURNING sequence INTO v_sequence;

  UPDATE kds.tickets
  SET last_event_sequence = v_sequence
  WHERE ticket_id = p_ticket_id;

  PERFORM kds.enqueue_whatsapp_partial_cancel_notification(
    p_ticket_id,
    v_sequence,
    v_display_orders,
    v_reason
  );

  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id;

  RETURN v_ticket;
END;
$$;

COMMENT ON FUNCTION kds.partial_cancel_items(UUID, UUID[], TEXT, TEXT, TEXT, TEXT) IS
'Marks selected transaction details.items as cancelled, recalculates total_amount, keeps operational status in_progress, moves the KDS ticket to partial_cancelled, emits an order_upserted event, and enqueues a WhatsApp notification using stable display_order lookup for cancelled lines.';
