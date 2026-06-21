-- KDS: enqueue WhatsApp status notifications via conversaflow.outbox (twilio.status_notification).
-- Edge runtime uses DB_SCHEMA=conversaflow; ensure outbox exists for job-worker delivery.

-- ============================================================================
-- 1. conversaflow.outbox (mirror public.outbox; additive if already present)
-- ============================================================================

CREATE TABLE IF NOT EXISTS conversaflow.outbox (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID,
  business_id     UUID        NOT NULL REFERENCES conversaflow.businesses(id),
  kind            TEXT        NOT NULL,
  aggregate_id    UUID,
  idempotency_key TEXT        NOT NULL,
  payload         JSONB       NOT NULL,
  state           TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (state IN ('pending', 'delivering', 'delivered', 'failed', 'dead')),
  attempts        SMALLINT    NOT NULL DEFAULT 0,
  max_attempts    SMALLINT    NOT NULL DEFAULT 5,
  next_run_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at    TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_conversaflow_outbox_idempotency UNIQUE (idempotency_key)
);

COMMENT ON COLUMN conversaflow.outbox.job_id IS
'Optional link to conversaflow.jobs; NULL for RPC-enqueued rows (e.g. KDS status).';

CREATE INDEX IF NOT EXISTS conversaflow_outbox_deliverable_idx
  ON conversaflow.outbox (next_run_at ASC)
  WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS conversaflow_outbox_job_idx
  ON conversaflow.outbox (job_id)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversaflow_outbox_business_created_idx
  ON conversaflow.outbox (business_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON conversaflow.outbox TO service_role;

-- ============================================================================
-- 2. Enqueue helper (SECURITY DEFINER inserts outbox; idempotent per event sequence)
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
  IF v_phone = '' THEN
    RETURN;
  END IF;

  -- E.164-ish: strip to digits, then single leading + (Twilio adapter uses whatsapp:+...)
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
'Enqueue a Twilio WhatsApp status notification for a KDS ticket transition. Idempotent per ticket_events.sequence.';

-- ============================================================================
-- 3. transition_ticket — single projection on operational updates; WhatsApp enqueue
-- ============================================================================

CREATE OR REPLACE FUNCTION kds.transition_ticket(
  p_ticket_id UUID,
  p_target_status kds.ticket_status,
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
      status = p_target_status,
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
    UPDATE conversaflow.transactions
    SET status = v_operational_target
    WHERE id = v_ticket.source_transaction_id
      AND status IS DISTINCT FROM v_operational_target;

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

    -- trg_kds_project_transaction on conversaflow.transactions projects KDS + emits ticket_events once.
    -- Removed redundant PERFORM kds.project_transaction here (avoid duplicate status_changed events).

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

COMMENT ON FUNCTION kds.transition_ticket(UUID, kds.ticket_status, TEXT, TEXT, TEXT) IS
'Command contract for KDS state transitions. Enqueues twilio.status_notification outbox rows for WhatsApp customers.';

GRANT EXECUTE ON FUNCTION kds.enqueue_whatsapp_status_notification(UUID, kds.ticket_status, BIGINT) TO service_role;

-- ============================================================================
-- Verification (manual)
-- ============================================================================
-- After migrate: call kds.transition_ticket(...) for a ticket with customer_phone set;
-- SELECT kind, idempotency_key, payload, state FROM conversaflow.outbox ORDER BY created_at DESC LIMIT 5;
-- Invoke job-worker or wait for cron; confirm Twilio delivery.
