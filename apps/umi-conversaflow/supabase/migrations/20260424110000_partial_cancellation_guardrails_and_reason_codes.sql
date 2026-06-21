-- Phase 1 + Phase 2 hardening for partial cancellation.
-- Adds backend-owned transition guards, controlled cancellation reason codes,
-- and deterministic/scrubbed customer-facing WhatsApp copy.

-- ============================================================================
-- 1. Controlled reason vocabulary + additive columns
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'cancel_reason_code'
      AND n.nspname = 'kds'
  ) THEN
    CREATE TYPE kds.cancel_reason_code AS ENUM (
      'out_of_stock',
      'kitchen_overload',
      'closing_soon',
      'customer_no_show',
      'duplicate_order',
      'other'
    );
  END IF;
END
$$;

ALTER TABLE kds.tickets
  ADD COLUMN IF NOT EXISTS cancellation_reason_code kds.cancel_reason_code,
  ADD COLUMN IF NOT EXISTS cancellation_reason_note TEXT,
  ADD COLUMN IF NOT EXISTS partial_cancellation_reason_code kds.cancel_reason_code,
  ADD COLUMN IF NOT EXISTS partial_cancellation_reason_note TEXT;

COMMENT ON COLUMN kds.tickets.cancellation_reason_code IS
'Controlled cancellation reason code for ticket-level cancellations.';
COMMENT ON COLUMN kds.tickets.cancellation_reason_note IS
'Optional operator note for full cancellations. Required when code = other.';
COMMENT ON COLUMN kds.tickets.partial_cancellation_reason_code IS
'Controlled cancellation reason code for partial cancellation proposals.';
COMMENT ON COLUMN kds.tickets.partial_cancellation_reason_note IS
'Optional operator note for partial cancellations. Required when code = other.';

-- ============================================================================
-- 2. Helpers
-- ============================================================================

CREATE OR REPLACE FUNCTION kds.parse_cancel_reason_code(p_value TEXT)
RETURNS kds.cancel_reason_code
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_value IS NULL OR trim(p_value) = '' THEN
    RETURN NULL;
  END IF;

  CASE trim(lower(p_value))
    WHEN 'out_of_stock' THEN RETURN 'out_of_stock';
    WHEN 'kitchen_overload' THEN RETURN 'kitchen_overload';
    WHEN 'closing_soon' THEN RETURN 'closing_soon';
    WHEN 'customer_no_show' THEN RETURN 'customer_no_show';
    WHEN 'duplicate_order' THEN RETURN 'duplicate_order';
    WHEN 'other' THEN RETURN 'other';
    ELSE
      RETURN NULL;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION kds.cancel_reason_label(p_code kds.cancel_reason_code)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_code
    WHEN 'out_of_stock' THEN 'Sin existencias'
    WHEN 'kitchen_overload' THEN 'Alta demanda en cocina'
    WHEN 'closing_soon' THEN 'Estamos por cerrar'
    WHEN 'customer_no_show' THEN 'No se presentó la persona que recogería'
    WHEN 'duplicate_order' THEN 'Pedido duplicado'
    WHEN 'other' THEN 'Otro'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION kds.redact_customer_text(p_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_text TEXT;
BEGIN
  v_text := NULLIF(regexp_replace(COALESCE(p_text, ''), '\s+', ' ', 'g'), '');
  IF v_text IS NULL THEN
    RETURN '[motivo retirado]';
  END IF;

  v_text := trim(v_text);

  IF char_length(v_text) < 3 THEN
    RETURN '[motivo retirado]';
  END IF;

  IF v_text ~* '\m(nigga+|nigger|puta|puto|pendej[oa]s?|chingad[ao]s?)\M' THEN
    RETURN '[motivo retirado]';
  END IF;

  RETURN left(v_text, 80);
END;
$$;

CREATE OR REPLACE FUNCTION kds.render_internal_cancel_reason(
  p_code kds.cancel_reason_code,
  p_note TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_label TEXT;
  v_note TEXT;
BEGIN
  v_label := kds.cancel_reason_label(p_code);
  v_note := NULLIF(trim(COALESCE(p_note, '')), '');

  IF v_label IS NULL THEN
    RETURN v_note;
  END IF;

  IF v_note IS NULL THEN
    RETURN v_label;
  END IF;

  RETURN v_label || ': ' || left(v_note, 120);
END;
$$;

CREATE OR REPLACE FUNCTION kds.render_customer_cancel_reason(
  p_code kds.cancel_reason_code,
  p_note TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_code IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_code = 'other' THEN
    RETURN kds.redact_customer_text(p_note);
  END IF;

  RETURN kds.cancel_reason_label(p_code);
END;
$$;

CREATE OR REPLACE FUNCTION kds.assert_transition(
  p_from kds.ticket_status,
  p_to kds.ticket_status
)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_from = p_to THEN
    RETURN;
  END IF;

  CASE p_from
    WHEN 'new' THEN
      IF p_to IN ('accepted', 'cancelled') THEN
        RETURN;
      END IF;
    WHEN 'accepted' THEN
      IF p_to IN ('preparing', 'cancelled', 'partial_cancelled') THEN
        RETURN;
      END IF;
    WHEN 'preparing' THEN
      IF p_to IN ('ready', 'cancelled', 'partial_cancelled') THEN
        RETURN;
      END IF;
    WHEN 'partial_cancelled' THEN
      IF p_to IN ('accepted', 'cancelled') THEN
        RETURN;
      END IF;
    WHEN 'ready' THEN
      IF p_to = 'completed' THEN
        RETURN;
      END IF;
    WHEN 'completed', 'cancelled' THEN
      NULL;
  END CASE;

  RAISE EXCEPTION 'Illegal KDS transition: % -> %', p_from, p_to
    USING ERRCODE = '22023';
END;
$$;

-- ============================================================================
-- 3. Projection updates
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
  v_cancellation_reason_code kds.cancel_reason_code;
  v_cancellation_reason_note TEXT;
  v_partial_reason_code kds.cancel_reason_code;
  v_partial_reason_note TEXT;
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

  v_cancellation_reason_code := kds.parse_cancel_reason_code(v_txn.details->>'cancellation_reason_code');
  v_cancellation_reason_note := NULLIF(trim(COALESCE(v_txn.details->>'cancellation_reason_note', '')), '');
  v_partial_reason_code := kds.parse_cancel_reason_code(v_txn.details->>'partial_cancellation_reason_code');
  v_partial_reason_note := NULLIF(trim(COALESCE(v_txn.details->>'partial_cancellation_reason_note', '')), '');

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
    cancellation_reason_code,
    cancellation_reason_note,
    partial_cancellation_reason,
    partial_cancellation_reason_code,
    partial_cancellation_reason_note,
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
    COALESCE(
      NULLIF(trim(COALESCE(v_txn.details->>'cancellation_reason', '')), ''),
      kds.render_internal_cancel_reason(v_cancellation_reason_code, v_cancellation_reason_note)
    ),
    v_cancellation_reason_code,
    v_cancellation_reason_note,
    COALESCE(
      NULLIF(trim(COALESCE(v_txn.details->>'partial_cancellation_reason', '')), ''),
      kds.render_internal_cancel_reason(v_partial_reason_code, v_partial_reason_note)
    ),
    v_partial_reason_code,
    v_partial_reason_note,
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
    cancellation_reason_code = EXCLUDED.cancellation_reason_code,
    cancellation_reason_note = EXCLUDED.cancellation_reason_note,
    partial_cancellation_reason = EXCLUDED.partial_cancellation_reason,
    partial_cancellation_reason_code = EXCLUDED.partial_cancellation_reason_code,
    partial_cancellation_reason_note = EXCLUDED.partial_cancellation_reason_note,
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

GRANT EXECUTE ON FUNCTION kds.get_board_snapshot(UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION kds.get_board_snapshot(UUID, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 4. Customer notifications
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
  v_from_status kds.ticket_status;
  v_customer_reason TEXT;
  v_total_text TEXT;
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

  SELECT CASE e.payload->>'from_status'
    WHEN 'new' THEN 'new'::kds.ticket_status
    WHEN 'accepted' THEN 'accepted'::kds.ticket_status
    WHEN 'preparing' THEN 'preparing'::kds.ticket_status
    WHEN 'partial_cancelled' THEN 'partial_cancelled'::kds.ticket_status
    WHEN 'ready' THEN 'ready'::kds.ticket_status
    WHEN 'completed' THEN 'completed'::kds.ticket_status
    WHEN 'cancelled' THEN 'cancelled'::kds.ticket_status
    ELSE NULL
  END
  INTO v_from_status
  FROM kds.ticket_events AS e
  WHERE e.sequence = p_event_sequence
    AND e.ticket_id = p_ticket_id;

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

  v_customer_reason := kds.render_customer_cancel_reason(
    COALESCE(v_ticket.cancellation_reason_code, v_ticket.partial_cancellation_reason_code),
    COALESCE(v_ticket.cancellation_reason_note, v_ticket.partial_cancellation_reason_note)
  );

  v_total_text := CASE
    WHEN v_ticket.total_amount IS NULL THEN NULL
    ELSE '$' || to_char(v_ticket.total_amount, 'FM999999990.00')
  END;

  v_body := CASE
    WHEN v_from_status = 'partial_cancelled' AND p_target_status = 'accepted' THEN
      'Confirmamos los cambios en tu pedido.'
      || COALESCE(' Total actualizado: ' || v_total_text || '.', '.')
      || ' Lo estamos preparando.'
    WHEN v_from_status = 'partial_cancelled' AND p_target_status = 'cancelled' THEN
      'Cancelamos por completo tu pedido. Si quieres, podemos empezar uno nuevo.'
      || CASE
        WHEN v_customer_reason IS NOT NULL THEN E'\nMotivo: ' || v_customer_reason
        ELSE ''
      END
    WHEN p_target_status = 'accepted' THEN
      'Tu pedido fue aceptado y está en cola en cocina.'
    WHEN p_target_status = 'preparing' THEN
      'Tu pedido se está preparando.'
    WHEN p_target_status = 'ready' THEN
      'Tu pedido está listo para recoger.'
    WHEN p_target_status = 'completed' THEN
      'Tu pedido fue completado. ¡Gracias!'
    WHEN p_target_status = 'cancelled' THEN
      'Tu pedido fue cancelado.'
      || CASE
        WHEN v_customer_reason IS NOT NULL THEN E'\nMotivo: ' || v_customer_reason
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

CREATE OR REPLACE FUNCTION kds.enqueue_whatsapp_partial_cancel_notification(
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

-- ============================================================================
-- 5. Partial cancellation RPCs
-- ============================================================================

DROP FUNCTION IF EXISTS kds.partial_cancel_items(UUID, UUID[], kds.cancel_reason_code, TEXT, TEXT, TEXT, TEXT);

CREATE FUNCTION kds.partial_cancel_items(
  p_ticket_id UUID,
  p_item_ids UUID[],
  p_reason_code kds.cancel_reason_code,
  p_reason_note TEXT DEFAULT NULL,
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
  v_display_orders INTEGER[];
  v_active_count INTEGER;
  v_sequence BIGINT;
  v_reason_note TEXT;
  v_internal_reason TEXT;
  v_customer_reason TEXT;
BEGIN
  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KDS ticket not found: %', p_ticket_id;
  END IF;

  PERFORM kds.assert_transition(v_ticket.status, 'partial_cancelled');

  IF p_reason_code IS NULL THEN
    RAISE EXCEPTION 'Partial cancellation reason code is required.';
  END IF;

  v_reason_note := NULLIF(trim(COALESCE(p_reason_note, '')), '');
  IF p_reason_code = 'other' AND (v_reason_note IS NULL OR char_length(v_reason_note) < 3) THEN
    RAISE EXCEPTION 'Partial cancellation note must be at least 3 characters when reason_code = other.';
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

  v_internal_reason := kds.render_internal_cancel_reason(p_reason_code, v_reason_note);
  v_customer_reason := kds.render_customer_cancel_reason(p_reason_code, v_reason_note);

  SELECT COALESCE(t.details, '{}'::jsonb)
  INTO v_txn_details
  FROM conversaflow.transactions AS t
  WHERE t.id = v_ticket.source_transaction_id
  FOR UPDATE;

  v_txn_details :=
    (v_txn_details - 'cancellation_reason' - 'cancellation_reason_code' - 'cancellation_reason_note')
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
      'partial_cancellation_reason', v_internal_reason,
      'partial_cancellation_reason_code', p_reason_code::text,
      'partial_cancellation_reason_note', to_jsonb(v_reason_note)
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
    partial_cancellation_reason = v_internal_reason,
    partial_cancellation_reason_code = p_reason_code,
    partial_cancellation_reason_note = v_reason_note,
    cancellation_reason = NULL,
    cancellation_reason_code = NULL,
    cancellation_reason_note = NULL,
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
      'partial_cancellation_reason', v_internal_reason,
      'partial_cancellation_reason_code', p_reason_code,
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
    COALESCE(v_customer_reason, '[motivo retirado]')
  );

  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id;

  RETURN v_ticket;
END;
$$;

CREATE OR REPLACE FUNCTION kds.partial_cancel_items(
  p_ticket_id UUID,
  p_item_ids UUID[],
  p_reason TEXT,
  p_actor_source TEXT DEFAULT 'kds',
  p_actor_id TEXT DEFAULT NULL,
  p_actor_channel TEXT DEFAULT NULL
)
RETURNS kds.tickets
LANGUAGE sql
SECURITY DEFINER
SET search_path = kds, conversaflow, public
AS $$
  SELECT kds.partial_cancel_items(
    p_ticket_id,
    p_item_ids,
    'other'::kds.cancel_reason_code,
    p_reason,
    p_actor_source,
    p_actor_id,
    p_actor_channel
  );
$$;

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

  PERFORM kds.assert_transition(v_ticket.status, 'accepted');

  UPDATE conversaflow.transactions
  SET details = COALESCE(details, '{}'::jsonb)
    - 'partial_cancellation_reason'
    - 'partial_cancellation_reason_code'
    - 'partial_cancellation_reason_note'
  WHERE id = v_ticket.source_transaction_id;

  UPDATE kds.tickets
  SET
    status = 'accepted',
    partial_cancellation_reason = NULL,
    partial_cancellation_reason_code = NULL,
    partial_cancellation_reason_note = NULL,
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

-- ============================================================================
-- 6. Transition RPCs
-- ============================================================================

DROP FUNCTION IF EXISTS kds.transition_ticket(UUID, kds.ticket_status, TEXT, TEXT, TEXT, kds.cancel_reason_code, TEXT);

CREATE FUNCTION kds.transition_ticket(
  p_ticket_id UUID,
  p_target_status kds.ticket_status,
  p_actor_source TEXT DEFAULT 'kds',
  p_actor_id TEXT DEFAULT NULL,
  p_actor_channel TEXT DEFAULT NULL,
  p_cancellation_reason_code kds.cancel_reason_code DEFAULT NULL,
  p_cancellation_reason_note TEXT DEFAULT NULL
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
  v_reason_code kds.cancel_reason_code;
  v_reason_note TEXT;
  v_internal_reason TEXT;
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

  PERFORM kds.assert_transition(v_ticket.status, p_target_status);

  v_reason_code := p_cancellation_reason_code;
  v_reason_note := NULLIF(trim(COALESCE(p_cancellation_reason_note, '')), '');

  IF p_target_status = 'cancelled' AND v_reason_code IS NULL AND v_ticket.status = 'partial_cancelled' THEN
    v_reason_code := v_ticket.partial_cancellation_reason_code;
    v_reason_note := COALESCE(v_reason_note, v_ticket.partial_cancellation_reason_note);
  END IF;

  IF v_reason_code = 'other' AND (v_reason_note IS NULL OR char_length(v_reason_note) < 3) THEN
    RAISE EXCEPTION 'Cancellation note must be at least 3 characters when reason_code = other.';
  END IF;

  v_internal_reason := kds.render_internal_cancel_reason(v_reason_code, v_reason_note);
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
      SET details = COALESCE(details, '{}'::jsonb)
        - 'partial_cancellation_reason'
        - 'partial_cancellation_reason_code'
        - 'partial_cancellation_reason_note'
      WHERE id = v_ticket.source_transaction_id;
    END IF;

    UPDATE kds.tickets
    SET
      status = p_target_status,
      partial_cancellation_reason = CASE
        WHEN v_ticket.status = 'partial_cancelled' AND p_target_status = 'accepted' THEN NULL
        ELSE partial_cancellation_reason
      END,
      partial_cancellation_reason_code = CASE
        WHEN v_ticket.status = 'partial_cancelled' AND p_target_status = 'accepted' THEN NULL
        ELSE partial_cancellation_reason_code
      END,
      partial_cancellation_reason_note = CASE
        WHEN v_ticket.status = 'partial_cancelled' AND p_target_status = 'accepted' THEN NULL
        ELSE partial_cancellation_reason_note
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
        details = (
          (
            COALESCE(details, '{}'::jsonb)
            - 'partial_cancellation_reason'
            - 'partial_cancellation_reason_code'
            - 'partial_cancellation_reason_note'
          )
          ||
          CASE
            WHEN v_reason_code IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object(
              'cancellation_reason', v_internal_reason,
              'cancellation_reason_code', v_reason_code::text,
              'cancellation_reason_note', to_jsonb(v_reason_note)
            )
          END
        )
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

CREATE OR REPLACE FUNCTION kds.transition_ticket(
  p_ticket_id UUID,
  p_target_status kds.ticket_status,
  p_actor_source TEXT DEFAULT 'kds',
  p_actor_id TEXT DEFAULT NULL,
  p_actor_channel TEXT DEFAULT NULL,
  p_cancellation_reason TEXT DEFAULT NULL
)
RETURNS kds.tickets
LANGUAGE sql
SECURITY DEFINER
SET search_path = kds, conversaflow, public
AS $$
  SELECT kds.transition_ticket(
    p_ticket_id,
    p_target_status,
    p_actor_source,
    p_actor_id,
    p_actor_channel,
    CASE
      WHEN NULLIF(trim(COALESCE(p_cancellation_reason, '')), '') IS NULL THEN NULL
      ELSE 'other'::kds.cancel_reason_code
    END,
    p_cancellation_reason
  );
$$;

GRANT EXECUTE ON FUNCTION kds.partial_cancel_items(UUID, UUID[], TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION kds.partial_cancel_items(UUID, UUID[], kds.cancel_reason_code, TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION kds.transition_ticket(UUID, kds.ticket_status, TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION kds.transition_ticket(UUID, kds.ticket_status, TEXT, TEXT, TEXT, kds.cancel_reason_code, TEXT) TO anon;
