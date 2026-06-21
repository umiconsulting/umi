-- Add cancellation_reason to KDS read model.
-- Changes:
--   1. Additive column on kds.tickets
--   2. project_transaction: project cancellation_reason from transactions.details
--   3. get_board_snapshot: expose cancellation_reason to iOS clients
--   4. enqueue_whatsapp_status_notification: include reason in cancelled body
--   5. transition_ticket: new 6-param overload accepting p_cancellation_reason (old 5-param stays)
--   6. Grant new overload to anon (mirrors existing grant for old overload)
-- Auth: no existing grants or SECURITY DEFINER settings altered.

-- ============================================================================
-- 1. Schema
-- ============================================================================

ALTER TABLE kds.tickets
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

COMMENT ON COLUMN kds.tickets.cancellation_reason IS
'Operator or bot-supplied reason for cancellation. NULL when not cancelled or reason not provided.';

-- ============================================================================
-- 2. project_transaction — project cancellation_reason from transactions.details
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
  IF v_txn.status = 'in_progress' AND v_existing_status IN ('accepted', 'preparing') THEN
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
    v_txn.total_amount,
    v_txn.created_at,
    v_txn.updated_at,
    md5(COALESCE(v_txn.details::text, '{}')),
    now()
  )
  ON CONFLICT (source_transaction_id) DO UPDATE
  SET
    business_id        = EXCLUDED.business_id,
    customer_id        = EXCLUDED.customer_id,
    source_channel     = EXCLUDED.source_channel,
    customer_name      = EXCLUDED.customer_name,
    customer_phone     = EXCLUDED.customer_phone,
    pickup_person      = EXCLUDED.pickup_person,
    status             = EXCLUDED.status,
    station_id         = EXCLUDED.station_id,
    station_name       = EXCLUDED.station_name,
    customer_note      = EXCLUDED.customer_note,
    cancellation_reason = EXCLUDED.cancellation_reason,
    total_amount       = EXCLUDED.total_amount,
    created_at         = EXCLUDED.created_at,
    updated_at         = EXCLUDED.updated_at,
    raw_details_hash   = EXCLUDED.raw_details_hash,
    last_projected_at  = now()
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
'Projects one ConversaFlow order into the KDS read model including cancellation_reason from details.';

-- ============================================================================
-- 3. get_board_snapshot — expose cancellation_reason
--    PostgreSQL cannot change a function's return type in-place; drop first.
--    Grants are restored below after re-creation.
-- ============================================================================

DROP FUNCTION IF EXISTS kds.get_board_snapshot(UUID, TEXT);

CREATE FUNCTION kds.get_board_snapshot(
  p_business_id UUID,
  p_station_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  ticket_id            UUID,
  source_transaction_id UUID,
  business_id          UUID,
  source_channel       TEXT,
  status               kds.ticket_status,
  station_id           TEXT,
  station_name         TEXT,
  customer_name        TEXT,
  customer_phone       TEXT,
  pickup_person        TEXT,
  customer_note        TEXT,
  cancellation_reason  TEXT,
  total_amount         NUMERIC,
  created_at           TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ,
  last_event_sequence  BIGINT,
  items                JSONB
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
    t.total_amount,
    t.created_at,
    t.updated_at,
    t.last_event_sequence
  ORDER BY t.created_at ASC;
$$;

COMMENT ON FUNCTION kds.get_board_snapshot(UUID, TEXT) IS
'Snapshot contract for KDS clients. Returns tickets with cancellation_reason. Tickets with no station assignment are included for all station queries (broadcast semantics).';

GRANT EXECUTE ON FUNCTION kds.get_board_snapshot(UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION kds.get_board_snapshot(UUID, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 4. enqueue_whatsapp_status_notification — include reason in cancelled body
--    Signature unchanged; reads cancellation_reason from the ticket row.
-- ============================================================================

CREATE OR REPLACE FUNCTION kds.enqueue_whatsapp_status_notification(
  p_ticket_id UUID,
  p_target_status kds.ticket_status,
  p_event_sequence BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = kds, conversaflow, public
AS $$
DECLARE
  v_ticket kds.tickets%ROWTYPE;
  v_phone TEXT;
  v_body TEXT;
  v_idempotency TEXT;
BEGIN
  IF p_target_status = 'new' THEN
    RETURN;
  END IF;

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

  v_body := CASE p_target_status
    WHEN 'accepted' THEN
      'Tu pedido fue aceptado y está en cola en cocina.'
    WHEN 'preparing' THEN
      'Tu pedido se está preparando.'
    WHEN 'ready' THEN
      'Tu pedido está listo para recoger. 🎉'
    WHEN 'completed' THEN
      'Tu pedido fue completado. ¡Gracias!'
    WHEN 'cancelled' THEN
      'Tu pedido fue cancelado.' ||
      CASE
        WHEN v_ticket.cancellation_reason IS NOT NULL
          AND trim(v_ticket.cancellation_reason) <> ''
        THEN E'\nMotivo: ' || trim(v_ticket.cancellation_reason)
        ELSE ''
      END
    ELSE NULL
  END;

  IF v_body IS NULL THEN
    RETURN;
  END IF;

  v_idempotency := format('twilio_status:%s:%s', p_ticket_id, p_event_sequence);

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

COMMENT ON FUNCTION kds.enqueue_whatsapp_status_notification(UUID, kds.ticket_status, BIGINT) IS
'Enqueue Twilio WhatsApp status notification. Includes cancellation_reason in cancelled body. Uses customers.phone when ticket.customer_phone is empty.';

-- ============================================================================
-- 5. transition_ticket — new 6-param overload with p_cancellation_reason
--    The existing 5-param overload is NOT dropped and stays callable.
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
    END IF;

    UPDATE kds.tickets
    SET
      status           = p_target_status,
      updated_at       = now(),
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
    -- For cancelled: merge reason into transactions.details before the trigger runs,
    -- so project_transaction() can project it to kds.tickets.cancellation_reason.
    -- The trigger then fires and enqueue reads the already-updated ticket row.
    IF p_target_status = 'cancelled'
      AND p_cancellation_reason IS NOT NULL
      AND trim(p_cancellation_reason) <> ''
    THEN
      UPDATE conversaflow.transactions
      SET
        status  = v_operational_target,
        details = COALESCE(details, '{}'::jsonb)
                  || jsonb_build_object('cancellation_reason', trim(p_cancellation_reason))
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

    -- trg_kds_project_transaction fires after the UPDATE above and projects the ticket
    -- (including cancellation_reason) before enqueue reads the ticket row.
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
'KDS state transition with optional cancellation reason. Reason is persisted to transactions.details, projected to kds.tickets.cancellation_reason, and included in the WhatsApp notification.';

-- ============================================================================
-- 6. Grant new overload — mirrors existing grant for 5-param overload
-- ============================================================================

GRANT EXECUTE ON FUNCTION kds.transition_ticket(UUID, kds.ticket_status, TEXT, TEXT, TEXT, TEXT) TO anon;
