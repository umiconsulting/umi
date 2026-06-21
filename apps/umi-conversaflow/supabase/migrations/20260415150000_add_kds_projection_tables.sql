-- KDS projection layer for the shared Umi platform.
-- Purpose:
-- 1. Create schema-owned kitchen read models in `kds`
-- 2. Provide a stable mapping from ConversaFlow operational rows to KDS app contracts
-- 3. Backfill existing orders so the KDS schema is populated immediately

CREATE SCHEMA IF NOT EXISTS kds;

-- ============================================================================
-- 1. Status and event enums
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ticket_status'
      AND n.nspname = 'kds'
  ) THEN
    CREATE TYPE kds.ticket_status AS ENUM (
      'new',
      'accepted',
      'preparing',
      'ready',
      'completed',
      'cancelled'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ticket_event_kind'
      AND n.nspname = 'kds'
  ) THEN
    CREATE TYPE kds.ticket_event_kind AS ENUM (
      'snapshot_reconciled',
      'order_upserted',
      'status_changed',
      'order_removed'
    );
  END IF;
END
$$;

-- ============================================================================
-- 2. Mapping helpers
-- ============================================================================

CREATE OR REPLACE FUNCTION kds.map_transaction_status(op_status TEXT)
RETURNS kds.ticket_status
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE op_status
    WHEN 'pending' THEN 'new'::kds.ticket_status
    WHEN 'in_progress' THEN 'preparing'::kds.ticket_status
    WHEN 'ready' THEN 'ready'::kds.ticket_status
    WHEN 'completed' THEN 'completed'::kds.ticket_status
    WHEN 'cancelled' THEN 'cancelled'::kds.ticket_status
    ELSE 'new'::kds.ticket_status
  END;
$$;

COMMENT ON FUNCTION kds.map_transaction_status(TEXT) IS
'Maps ConversaFlow operational order states to KDS-facing board states. accepted is reserved for future command flow but not emitted by the current operational model.';

-- ============================================================================
-- 3. Projection tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS kds.tickets (
  ticket_id          UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  source_transaction_id UUID           NOT NULL UNIQUE REFERENCES conversaflow.transactions(id) ON DELETE CASCADE,
  business_id        UUID              NOT NULL REFERENCES conversaflow.businesses(id) ON DELETE CASCADE,
  customer_id        UUID              REFERENCES conversaflow.customers(id) ON DELETE SET NULL,
  source_channel     TEXT              NOT NULL DEFAULT 'whatsapp',
  customer_name      TEXT,
  customer_phone     TEXT,
  pickup_person      TEXT,
  status             kds.ticket_status NOT NULL,
  station_id         TEXT,
  station_name       TEXT,
  customer_note      TEXT,
  total_amount       NUMERIC(12,2),
  created_at         TIMESTAMPTZ       NOT NULL,
  updated_at         TIMESTAMPTZ       NOT NULL,
  last_event_sequence BIGINT,
  raw_details_hash   TEXT              NOT NULL,
  last_projected_at  TIMESTAMPTZ       NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kds_tickets_business_status_created_idx
  ON kds.tickets (business_id, status, created_at ASC);

CREATE INDEX IF NOT EXISTS kds_tickets_business_updated_idx
  ON kds.tickets (business_id, updated_at DESC);

COMMENT ON TABLE kds.tickets IS
'Kitchen-facing read model. One row per operational order projected from conversaflow.transactions plus customer identity and normalized board fields.';

COMMENT ON COLUMN kds.tickets.source_transaction_id IS
'Operational source-of-truth order row in conversaflow.transactions.';

COMMENT ON COLUMN kds.tickets.last_event_sequence IS
'Most recent sequence emitted in kds.ticket_events for reconnect reconciliation.';

CREATE TABLE IF NOT EXISTS kds.ticket_items (
  ticket_item_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id          UUID        NOT NULL REFERENCES kds.tickets(ticket_id) ON DELETE CASCADE,
  source_transaction_id UUID     NOT NULL REFERENCES conversaflow.transactions(id) ON DELETE CASCADE,
  display_order      INTEGER     NOT NULL,
  product_id         UUID,
  name               TEXT        NOT NULL,
  quantity           INTEGER     NOT NULL CHECK (quantity > 0),
  variant_name       TEXT,
  notes              TEXT,
  unit_price         NUMERIC(12,2),
  is_cancelled       BOOLEAN     NOT NULL DEFAULT FALSE,

  CONSTRAINT uq_kds_ticket_item_order UNIQUE (ticket_id, display_order)
);

CREATE INDEX IF NOT EXISTS kds_ticket_items_ticket_idx
  ON kds.ticket_items (ticket_id, display_order ASC);

COMMENT ON TABLE kds.ticket_items IS
'Normalized kitchen line items derived from transactions.details.items for display in KDS clients.';

CREATE TABLE IF NOT EXISTS kds.ticket_events (
  sequence           BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  ticket_id          UUID                  NOT NULL REFERENCES kds.tickets(ticket_id) ON DELETE CASCADE,
  business_id        UUID                  NOT NULL REFERENCES conversaflow.businesses(id) ON DELETE CASCADE,
  source_transaction_id UUID               NOT NULL REFERENCES conversaflow.transactions(id) ON DELETE CASCADE,
  kind               kds.ticket_event_kind NOT NULL,
  status             kds.ticket_status,
  occurred_at        TIMESTAMPTZ           NOT NULL DEFAULT now(),
  source             TEXT                  NOT NULL DEFAULT 'projection',
  source_event_key   TEXT                  UNIQUE,
  payload            JSONB                 NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS kds_ticket_events_ticket_sequence_idx
  ON kds.ticket_events (ticket_id, sequence DESC);

CREATE INDEX IF NOT EXISTS kds_ticket_events_business_sequence_idx
  ON kds.ticket_events (business_id, sequence ASC);

COMMENT ON TABLE kds.ticket_events IS
'Ordered kitchen event log for snapshot reconciliation and realtime consumers.';

COMMENT ON COLUMN kds.ticket_events.source_event_key IS
'Idempotency key for projection emissions. Prevents duplicate events during backfill or replay.';

-- ============================================================================
-- 4. Projection helpers
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
'Projects one operational ConversaFlow order into the KDS read model, rewrites normalized line items, and emits a kitchen event.';

CREATE OR REPLACE FUNCTION kds.project_transaction_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = kds, conversaflow, public
AS $$
DECLARE
  v_kind kds.ticket_event_kind;
BEGIN
  IF NEW.transaction_type IS DISTINCT FROM 'order' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_kind := 'order_upserted';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_kind := 'status_changed';
  ELSE
    v_kind := 'order_upserted';
  END IF;

  PERFORM kds.project_transaction(
    NEW.id,
    v_kind,
    'trigger',
    NULL
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION kds.project_transaction_trigger() IS
'Trigger wrapper that maintains the KDS projection after operational order inserts and updates.';

DROP TRIGGER IF EXISTS trg_kds_project_transaction ON conversaflow.transactions;
CREATE TRIGGER trg_kds_project_transaction
AFTER INSERT OR UPDATE OF status, details, total_amount
ON conversaflow.transactions
FOR EACH ROW
EXECUTE FUNCTION kds.project_transaction_trigger();

CREATE OR REPLACE FUNCTION kds.map_kds_status_to_transaction_status(target_status kds.ticket_status)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE target_status
    WHEN 'new' THEN 'pending'
    WHEN 'accepted' THEN 'in_progress'
    WHEN 'preparing' THEN 'in_progress'
    WHEN 'ready' THEN 'ready'
    WHEN 'completed' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled'
  END;
$$;

COMMENT ON FUNCTION kds.map_kds_status_to_transaction_status(kds.ticket_status) IS
'Maps KDS board states back to ConversaFlow operational transaction states. accepted and preparing both collapse to in_progress operationally.';

CREATE OR REPLACE FUNCTION kds.get_board_snapshot(
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
    AND (p_station_id IS NULL OR t.station_id = p_station_id)
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
    t.total_amount,
    t.created_at,
    t.updated_at,
    t.last_event_sequence
  ORDER BY t.created_at ASC;
$$;

COMMENT ON FUNCTION kds.get_board_snapshot(UUID, TEXT) IS
'Snapshot contract for KDS clients. Returns kitchen tickets plus normalized item arrays for one business and optional station.';

CREATE OR REPLACE FUNCTION kds.get_ticket_events(
  p_business_id UUID,
  p_after_sequence BIGINT DEFAULT 0,
  p_limit INTEGER DEFAULT 200
)
RETURNS TABLE (
  sequence BIGINT,
  ticket_id UUID,
  business_id UUID,
  source_transaction_id UUID,
  kind kds.ticket_event_kind,
  status kds.ticket_status,
  occurred_at TIMESTAMPTZ,
  source TEXT,
  payload JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = kds, conversaflow, public
AS $$
  SELECT
    e.sequence,
    e.ticket_id,
    e.business_id,
    e.source_transaction_id,
    e.kind,
    e.status,
    e.occurred_at,
    e.source,
    e.payload
  FROM kds.ticket_events AS e
  WHERE e.business_id = p_business_id
    AND e.sequence > p_after_sequence
  ORDER BY e.sequence ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 1000);
$$;

COMMENT ON FUNCTION kds.get_ticket_events(UUID, BIGINT, INTEGER) IS
'Ordered incremental event contract for KDS reconnect and realtime catch-up.';

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

    PERFORM kds.project_transaction(
      v_ticket.source_transaction_id,
      'status_changed',
      p_actor_source,
      NULL
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
'Command contract for KDS state transitions. accepted and preparing are KDS-specific sub-states over the shared operational in_progress state.';

CREATE OR REPLACE FUNCTION kds.backfill_from_conversaflow()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = kds, conversaflow, public
AS $$
DECLARE
  v_row RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT t.id
    FROM conversaflow.transactions AS t
    WHERE t.transaction_type = 'order'
    ORDER BY t.created_at ASC
  LOOP
    PERFORM kds.project_transaction(
      v_row.id,
      'snapshot_reconciled',
      'backfill',
      format('backfill:%s', v_row.id)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION kds.backfill_from_conversaflow() IS
'Idempotent initial KDS population from the conversaflow operational schema. Emits one snapshot_reconciled event per projected order.';

-- ============================================================================
-- 5. Grants and RLS
-- ============================================================================

GRANT USAGE ON SCHEMA kds TO authenticated, service_role;
GRANT SELECT ON kds.tickets TO authenticated, service_role;
GRANT SELECT ON kds.ticket_items TO authenticated, service_role;
GRANT SELECT ON kds.ticket_events TO authenticated, service_role;
GRANT ALL ON kds.tickets TO service_role;
GRANT ALL ON kds.ticket_items TO service_role;
GRANT ALL ON kds.ticket_events TO service_role;
GRANT EXECUTE ON FUNCTION kds.map_transaction_status(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION kds.map_kds_status_to_transaction_status(kds.ticket_status) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION kds.project_transaction(UUID, kds.ticket_event_kind, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION kds.backfill_from_conversaflow() TO service_role;
GRANT EXECUTE ON FUNCTION kds.get_board_snapshot(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION kds.get_ticket_events(UUID, BIGINT, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION kds.transition_ticket(UUID, kds.ticket_status, TEXT, TEXT, TEXT) TO authenticated, service_role;

ALTER TABLE kds.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE kds.ticket_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE kds.ticket_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kds_tickets_member_select" ON kds.tickets;
CREATE POLICY "kds_tickets_member_select"
ON kds.tickets
FOR SELECT
TO authenticated
USING (public.user_has_business_access(business_id));

DROP POLICY IF EXISTS "kds_ticket_items_member_select" ON kds.ticket_items;
CREATE POLICY "kds_ticket_items_member_select"
ON kds.ticket_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM kds.tickets AS t
    WHERE t.ticket_id = ticket_items.ticket_id
      AND public.user_has_business_access(t.business_id)
  )
);

DROP POLICY IF EXISTS "kds_ticket_events_member_select" ON kds.ticket_events;
CREATE POLICY "kds_ticket_events_member_select"
ON kds.ticket_events
FOR SELECT
TO authenticated
USING (public.user_has_business_access(business_id));

-- ============================================================================
-- 6. Initial population
-- ============================================================================

SELECT kds.backfill_from_conversaflow();
