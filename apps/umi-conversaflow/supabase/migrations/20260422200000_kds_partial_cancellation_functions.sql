-- KDS partial item cancellation — functions.
-- Depends on 20260422010000_kds_partial_cancellation.sql which must be committed first
-- so that the 'partial_cancelled' enum value is visible to these function bodies.

-- ============================================================================
-- 1. KDS/operational status mapping
-- ============================================================================

CREATE OR REPLACE FUNCTION kds.map_kds_status_to_transaction_status(target_status kds.ticket_status)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE target_status
    WHEN 'new' THEN 'pending'
    WHEN 'accepted' THEN 'in_progress'
    WHEN 'preparing' THEN 'in_progress'
    WHEN 'partial_cancelled' THEN 'in_progress'
    WHEN 'ready' THEN 'ready'
    WHEN 'completed' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled'
  END;
$$;

COMMENT ON FUNCTION kds.map_kds_status_to_transaction_status(kds.ticket_status) IS
'Maps KDS-facing statuses to conversaflow.transactions.status. partial_cancelled remains in_progress operationally.';

-- ============================================================================
-- 2. project_transaction — project partial_cancellation_reason and preserve
--    KDS-only in_progress sub-states including partial_cancelled
-- ============================================================================

CREATE OR REPLACE FUNCTION kds.project_transaction(
  p_transaction_id UUID,
  p_event_kind kds.ticket_event_kind DEFAULT 'order_upserted',
  p_source TEXT DEFAULT 'projection',
  p_source_event_key TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = kds, conversaflow, public
AS $$
DECLARE
  v_txn RECORD;
  v_ticket_id UUID;
  v_sequence BIGINT;
  v_existing_status kds.ticket_status;
  v_projected_status kds.ticket_status;
BEGIN
  SELECT
    t.id,
    t.business_id,
    t.customer_id,
    t.status,
    t.total_amount,
    t.details,
    t.created_at,
    COALESCE(se.last_acted_at, t.created_at) AS updated_at,
    c.name AS customer_name,
    c.phone AS customer_phone
  INTO v_txn
  FROM conversaflow.transactions AS t
  LEFT JOIN conversaflow.customers AS c
    ON c.id = t.customer_id
  LEFT JOIN (
    SELECT
      transaction_id,
      max(acted_at) AS last_acted_at
    FROM conversaflow.transaction_status_events
    GROUP BY transaction_id
  ) AS se
    ON se.transaction_id = t.id
  WHERE t.id = p_transaction_id
    AND t.transaction_type = 'order';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT t.status
  INTO v_existing_status
  FROM kds.tickets AS t
  WHERE t.source_transaction_id = v_txn.id;

  v_projected_status := kds.map_transaction_status(v_txn.status);
  IF v_txn.status = 'in_progress' AND v_existing_status IN ('accepted', 'preparing', 'partial_cancelled') THEN
    v_projected_status := v_existing_status;
  END IF;

  INSERT INTO kds.tickets (
    source_transaction_id,
    business_id,
    customer_id,
    source_channel,
    customer_name,
    customer_phone,
    pickup_person,
    status,
    station_id,
    station_name,
    customer_note,
    cancellation_reason,
    partial_cancellation_reason,
    total_amount,
    created_at,
    updated_at,
    raw_details_hash,
    last_projected_at
  )
  VALUES (
    v_txn.id,
    v_txn.business_id,
    v_txn.customer_id,
    COALESCE(v_txn.details->>'source_channel', 'whatsapp'),
    v_txn.customer_name,
    v_txn.customer_phone,
    v_txn.details->>'pickup_person',
    v_projected_status,
    v_txn.details->>'station_id',
    v_txn.details->>'station_name',
    v_txn.details->>'customer_note',
    NULLIF(trim(COALESCE(v_txn.details->>'cancellation_reason', '')), ''),
    NULLIF(trim(COALESCE(v_txn.details->>'partial_cancellation_reason', '')), ''),
    v_txn.total_amount,
    v_txn.created_at,
    v_txn.updated_at,
    md5(COALESCE(v_txn.details::text, '{}')),
    now()
  )
  ON CONFLICT (source_transaction_id) DO UPDATE
  SET
    business_id = EXCLUDED.business_id,
    customer_id = EXCLUDED.customer_id,
    source_channel = EXCLUDED.source_channel,
    customer_name = EXCLUDED.customer_name,
    customer_phone = EXCLUDED.customer_phone,
    pickup_person = EXCLUDED.pickup_person,
    status = EXCLUDED.status,
    station_id = EXCLUDED.station_id,
    station_name = EXCLUDED.station_name,
    customer_note = EXCLUDED.customer_note,
    cancellation_reason = EXCLUDED.cancellation_reason,
    partial_cancellation_reason = EXCLUDED.partial_cancellation_reason,
    total_amount = EXCLUDED.total_amount,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at,
    raw_details_hash = EXCLUDED.raw_details_hash,
    last_projected_at = now()
  RETURNING ticket_id INTO v_ticket_id;

  DELETE FROM kds.ticket_items
  WHERE ticket_id = v_ticket_id;

  INSERT INTO kds.ticket_items (
    ticket_id,
    source_transaction_id,
    display_order,
    product_id,
    name,
    quantity,
    variant_name,
    notes,
    unit_price,
    is_cancelled
  )
  SELECT
    v_ticket_id,
    v_txn.id,
    row_number() OVER ()::integer,
    NULLIF(item->>'product_id', '')::uuid,
    COALESCE(item->>'product_name', item->>'product_id', 'Unnamed item'),
    GREATEST(COALESCE((item->>'quantity')::integer, 1), 1),
    NULLIF(item->>'variant_name', ''),
    NULLIF(item->>'notes', ''),
    NULLIF(item->>'unit_price', '')::numeric,
    COALESCE((item->>'cancelled')::boolean, FALSE)
  FROM jsonb_array_elements(COALESCE(v_txn.details->'items', '[]'::jsonb)) AS item;

  IF p_source_event_key IS NOT NULL THEN
    INSERT INTO kds.ticket_events (
      ticket_id,
      business_id,
      source_transaction_id,
      kind,
      status,
      occurred_at,
      source,
      source_event_key,
      payload
    )
    VALUES (
      v_ticket_id,
      v_txn.business_id,
      v_txn.id,
      p_event_kind,
      v_projected_status,
      v_txn.updated_at,
      p_source,
      p_source_event_key,
      jsonb_build_object(
        'source_transaction_id', v_txn.id,
        'operational_status', v_txn.status
      )
    )
    ON CONFLICT (source_event_key) DO NOTHING
    RETURNING sequence INTO v_sequence;
  ELSE
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
      v_ticket_id,
      v_txn.business_id,
      v_txn.id,
      p_event_kind,
      v_projected_status,
      v_txn.updated_at,
      p_source,
      jsonb_build_object(
        'source_transaction_id', v_txn.id,
        'operational_status', v_txn.status
      )
    )
    RETURNING sequence INTO v_sequence;
  END IF;

  UPDATE kds.tickets
  SET last_event_sequence = COALESCE(v_sequence, last_event_sequence)
  WHERE ticket_id = v_ticket_id;

  RETURN v_ticket_id;
END;
$$;

COMMENT ON FUNCTION kds.project_transaction(UUID, kds.ticket_event_kind, TEXT, TEXT) IS
'Projects one ConversaFlow order into the KDS read model including cancellation_reason and partial_cancellation_reason from details.';

-- ============================================================================
-- 3. get_board_snapshot — expose partial_cancellation_reason
-- ============================================================================

DROP FUNCTION IF EXISTS kds.get_board_snapshot(UUID, TEXT);

CREATE FUNCTION kds.get_board_snapshot(
  p_business_id UUID,
  p_station_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  ticket_id UUID,
  source_transaction_id UUID,
  business_id UUID,
  source_channel TEXT,
  status kds.ticket_status,
  station_id TEXT,
  station_name TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  pickup_person TEXT,
  customer_note TEXT,
  cancellation_reason TEXT,
  partial_cancellation_reason TEXT,
  total_amount NUMERIC,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_event_sequence BIGINT,
  items JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = kds, conversaflow, public
AS $$
  SELECT
    t.ticket_id,
    t.source_transaction_id,
    t.business_id,
    t.source_channel,
    t.status,
    t.station_id,
    t.station_name,
    t.customer_name,
    t.customer_phone,
    t.pickup_person,
    t.customer_note,
    t.cancellation_reason,
    t.partial_cancellation_reason,
    t.total_amount,
    t.created_at,
    t.updated_at,
    t.last_event_sequence,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'ticket_item_id', i.ticket_item_id,
          'name', i.name,
          'quantity', i.quantity,
          'variant_name', i.variant_name,
          'notes', i.notes,
          'is_cancelled', i.is_cancelled,
          'unit_price', i.unit_price,
          'display_order', i.display_order
        )
        ORDER BY i.display_order ASC
      ) FILTER (WHERE i.ticket_item_id IS NOT NULL),
      '[]'::jsonb
    ) AS items
  FROM kds.tickets AS t
  LEFT JOIN kds.ticket_items AS i
    ON i.ticket_id = t.ticket_id
  WHERE t.business_id = p_business_id
    AND (p_station_id IS NULL OR t.station_id IS NULL OR t.station_id = p_station_id)
  GROUP BY
    t.ticket_id,
    t.source_transaction_id,
    t.business_id,
    t.source_channel,
    t.status,
    t.station_id,
    t.station_name,
    t.customer_name,
    t.customer_phone,
    t.pickup_person,
    t.customer_note,
    t.cancellation_reason,
    t.partial_cancellation_reason,
    t.total_amount,
    t.created_at,
    t.updated_at,
    t.last_event_sequence
  ORDER BY t.created_at ASC;
$$;

COMMENT ON FUNCTION kds.get_board_snapshot(UUID, TEXT) IS
'Snapshot contract for KDS clients. Returns tickets with cancellation_reason and partial_cancellation_reason. Tickets with no station assignment are included for all station queries (broadcast semantics).';

GRANT EXECUTE ON FUNCTION kds.get_board_snapshot(UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION kds.get_board_snapshot(UUID, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 4. Enqueue helper for partial cancellation WhatsApp
-- ============================================================================

CREATE OR REPLACE FUNCTION kds.enqueue_whatsapp_partial_cancel_notification(
  p_ticket_id UUID,
  p_event_sequence BIGINT,
  p_cancelled_item_ids UUID[],
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
    AND i.ticket_item_id = ANY(COALESCE(p_cancelled_item_ids, ARRAY[]::UUID[]));

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

COMMENT ON FUNCTION kds.enqueue_whatsapp_partial_cancel_notification(UUID, BIGINT, UUID[], TEXT) IS
'Enqueue a Twilio WhatsApp notification describing partially cancelled items and the updated remaining order. Idempotent per ticket_events.sequence.';

-- ============================================================================
-- 5. partial_cancel_items
-- ============================================================================

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
    p_item_ids,
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
'Marks selected transaction details.items as cancelled, recalculates total_amount, keeps operational status in_progress, moves the KDS ticket to partial_cancelled, emits an order_upserted event, and enqueues a WhatsApp notification.';

-- ============================================================================
-- 6. confirm_partial_cancellation
-- ============================================================================

CREATE OR REPLACE FUNCTION kds.confirm_partial_cancellation(
  p_ticket_id UUID,
  p_actor_source TEXT DEFAULT 'whatsapp_bot',
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
  v_sequence BIGINT;
BEGIN
  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KDS ticket not found: %', p_ticket_id;
  END IF;

  IF v_ticket.status <> 'partial_cancelled' THEN
    RAISE EXCEPTION 'Ticket % is not awaiting partial cancellation confirmation.', p_ticket_id;
  END IF;

  UPDATE conversaflow.transactions
  SET details = COALESCE(details, '{}'::jsonb) - 'partial_cancellation_reason'
  WHERE id = v_ticket.source_transaction_id;

  UPDATE kds.tickets
  SET
    status = 'accepted',
    partial_cancellation_reason = NULL,
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
    'status_changed',
    'accepted',
    now(),
    p_actor_source,
    jsonb_build_object(
      'from_status', v_ticket.status,
      'to_status', 'accepted',
      'actor_id', p_actor_id,
      'actor_channel', p_actor_channel
    )
  )
  RETURNING sequence INTO v_sequence;

  UPDATE kds.tickets
  SET last_event_sequence = v_sequence
  WHERE ticket_id = p_ticket_id;

  PERFORM kds.enqueue_whatsapp_status_notification(
    p_ticket_id,
    'accepted',
    v_sequence
  );

  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id;

  RETURN v_ticket;
END;
$$;

COMMENT ON FUNCTION kds.confirm_partial_cancellation(UUID, TEXT, TEXT, TEXT) IS
'Accepts a partially cancelled KDS ticket after the customer confirms the remaining order, clears partial_cancellation_reason, emits a status_changed event, and enqueues the accepted WhatsApp notification.';

-- ============================================================================
-- 7. transition_ticket — clear partial_cancellation_reason when a partial
--    cancellation is accepted or fully cancelled from the KDS
-- ============================================================================

CREATE OR REPLACE FUNCTION kds.transition_ticket(
  p_ticket_id UUID,
  p_target_status kds.ticket_status,
  p_actor_source TEXT DEFAULT 'kds',
  p_actor_id TEXT DEFAULT NULL,
  p_actor_channel TEXT DEFAULT NULL,
  p_cancellation_reason TEXT DEFAULT NULL
)
RETURNS kds.tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = kds, conversaflow, public
AS $$
DECLARE
  v_ticket kds.tickets%ROWTYPE;
  v_operational_target TEXT;
  v_new_sequence BIGINT;
  v_trimmed_reason TEXT;
BEGIN
  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KDS ticket not found: %', p_ticket_id;
  END IF;

  IF v_ticket.status = p_target_status THEN
    RETURN v_ticket;
  END IF;

  v_trimmed_reason := NULLIF(trim(COALESCE(p_cancellation_reason, '')), '');
  v_operational_target := kds.map_kds_status_to_transaction_status(p_target_status);

  IF p_target_status IN ('accepted', 'preparing') THEN
    IF v_operational_target IS DISTINCT FROM 'in_progress' THEN
      RAISE EXCEPTION 'Unexpected operational mapping for target status %', p_target_status;
    END IF;

    IF v_ticket.status = 'new' THEN
      UPDATE conversaflow.transactions
      SET status = 'in_progress'
      WHERE id = v_ticket.source_transaction_id
        AND status IS DISTINCT FROM 'in_progress';

      INSERT INTO conversaflow.transaction_status_events (
        transaction_id,
        old_status,
        new_status,
        acted_by_slack_user,
        acted_in_channel,
        acted_at
      )
      VALUES (
        v_ticket.source_transaction_id,
        'pending',
        'in_progress',
        p_actor_id,
        p_actor_channel,
        now()
      );
    ELSIF v_ticket.status = 'partial_cancelled' AND p_target_status = 'accepted' THEN
      UPDATE conversaflow.transactions
      SET details = COALESCE(details, '{}'::jsonb) - 'partial_cancellation_reason'
      WHERE id = v_ticket.source_transaction_id;
    END IF;

    UPDATE kds.tickets
    SET
      status = p_target_status,
      partial_cancellation_reason = CASE
        WHEN v_ticket.status = 'partial_cancelled' AND p_target_status = 'accepted' THEN NULL
        ELSE partial_cancellation_reason
      END,
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
      'status_changed',
      p_target_status,
      now(),
      p_actor_source,
      jsonb_build_object(
        'from_status', v_ticket.status,
        'to_status', p_target_status,
        'actor_id', p_actor_id,
        'actor_channel', p_actor_channel
      )
    )
    RETURNING sequence INTO v_new_sequence;

    UPDATE kds.tickets
    SET last_event_sequence = v_new_sequence
    WHERE ticket_id = p_ticket_id;

    PERFORM kds.enqueue_whatsapp_status_notification(
      p_ticket_id,
      p_target_status,
      v_new_sequence
    );

  ELSE
    IF p_target_status = 'cancelled' THEN
      UPDATE conversaflow.transactions
      SET
        status = v_operational_target,
        details = CASE
          WHEN v_trimmed_reason IS NOT NULL
            THEN (COALESCE(details, '{}'::jsonb) - 'partial_cancellation_reason')
                 || jsonb_build_object('cancellation_reason', v_trimmed_reason)
          WHEN v_ticket.status = 'partial_cancelled'
            THEN COALESCE(details, '{}'::jsonb) - 'partial_cancellation_reason'
          ELSE details
        END
      WHERE id = v_ticket.source_transaction_id
        AND status IS DISTINCT FROM v_operational_target;
    ELSE
      UPDATE conversaflow.transactions
      SET status = v_operational_target
      WHERE id = v_ticket.source_transaction_id
        AND status IS DISTINCT FROM v_operational_target;
    END IF;

    INSERT INTO conversaflow.transaction_status_events (
      transaction_id,
      old_status,
      new_status,
      acted_by_slack_user,
      acted_in_channel,
      acted_at
    )
    VALUES (
      v_ticket.source_transaction_id,
      kds.map_kds_status_to_transaction_status(v_ticket.status),
      v_operational_target,
      p_actor_id,
      p_actor_channel,
      now()
    );

    SELECT e.sequence
    INTO v_new_sequence
    FROM kds.ticket_events AS e
    WHERE e.ticket_id = p_ticket_id
    ORDER BY e.sequence DESC
    LIMIT 1;

    PERFORM kds.enqueue_whatsapp_status_notification(
      p_ticket_id,
      p_target_status,
      v_new_sequence
    );
  END IF;

  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id;

  RETURN v_ticket;
END;
$$;

COMMENT ON FUNCTION kds.transition_ticket(UUID, kds.ticket_status, TEXT, TEXT, TEXT, TEXT) IS
'KDS state transition with optional cancellation reason. Clears partial_cancellation_reason when a partial cancellation is accepted or fully cancelled.';

GRANT EXECUTE ON FUNCTION kds.transition_ticket(UUID, kds.ticket_status, TEXT, TEXT, TEXT, TEXT) TO anon;

-- ============================================================================
-- 8. Grants
-- ============================================================================

GRANT EXECUTE ON FUNCTION kds.partial_cancel_items(UUID, UUID[], TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION kds.confirm_partial_cancellation(UUID, TEXT, TEXT, TEXT) TO anon;
