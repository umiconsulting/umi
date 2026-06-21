-- Resolve customer phone from conversaflow.customers when kds.tickets.customer_phone is null.
-- Common when projection lag or legacy rows omitted phone on the ticket row.

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
      'Tu pedido está listo para recoger.'
    WHEN 'completed' THEN
      'Tu pedido fue completado. ¡Gracias!'
    WHEN 'cancelled' THEN
      'Tu pedido fue cancelado.'
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
'Enqueue Twilio WhatsApp status notification. Uses customers.phone when ticket.customer_phone is empty.';
