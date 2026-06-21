-- Fix: transition_ticket ELSE branch (ready/completed/cancelled) was reading the
-- last sequence from kds.ticket_events (which is the trigger-inserted order_upserted)
-- rather than emitting its own status_changed event.
--
-- Root cause: before 20260512230000 the trigger emitted status_changed, so the ELSE
-- branch could safely SELECT the latest sequence and find one. After that migration
-- the trigger only emits order_upserted, so the ELSE branch was passing an
-- order_upserted sequence to enqueue_whatsapp_status_notification — the notification
-- still fired (v_body is keyed off p_target_status, not from_status) but the event
-- stream had no status_changed entry for those transitions.
--
-- Fix: add an explicit INSERT INTO kds.ticket_events (kind='status_changed') in the
-- ELSE branch, mirroring exactly what the IF branch already does for accepted/preparing.

CREATE OR REPLACE FUNCTION kds.transition_ticket(
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

    -- Emit an explicit status_changed event so the iOS client can use it for
    -- optimistic updates and enqueue_whatsapp_status_notification has a proper
    -- from_status in the payload. The trigger will also emit order_upserted (from
    -- the conversaflow.transactions UPDATE above) — that order_upserted precedes
    -- this status_changed in sequence, which is fine.
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
  END IF;

  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id;

  RETURN v_ticket;
END;
$$;

GRANT EXECUTE ON FUNCTION kds.transition_ticket(UUID, kds.ticket_status, TEXT, TEXT, TEXT, kds.cancel_reason_code, TEXT) TO service_role;
