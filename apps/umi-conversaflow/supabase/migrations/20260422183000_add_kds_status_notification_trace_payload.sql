-- Add trace metadata to KDS WhatsApp status notifications so dispatch delivery
-- is visible in pipeline_traces and structured logs.

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
  v_trace_id TEXT;
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
  v_trace_id := format('kds_status:%s:%s', p_ticket_id, p_event_sequence);

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
      'body', v_body,
      'trace_id', v_trace_id,
      'ticket_id', p_ticket_id,
      'event_sequence', p_event_sequence,
      'target_status', p_target_status,
      'source_transaction_id', v_ticket.source_transaction_id
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
  v_trace_id TEXT;
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
  v_trace_id := format('kds_status:%s:%s', p_ticket_id, p_event_sequence);

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
      'body', v_body,
      'trace_id', v_trace_id,
      'ticket_id', p_ticket_id,
      'event_sequence', p_event_sequence,
      'target_status', 'partial_cancelled',
      'source_transaction_id', v_ticket.source_transaction_id
    ),
    'pending',
    5,
    now()
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$$;
