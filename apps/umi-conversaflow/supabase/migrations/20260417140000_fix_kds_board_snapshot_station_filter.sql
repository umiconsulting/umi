-- Fix kds.get_board_snapshot to include orders with no assigned station.
-- WhatsApp orders are created without a station_id, so kds.tickets.station_id
-- is NULL for all of them. The original filter excluded NULL-station tickets
-- when the iOS app passed a station scope (p_station_id = 'expo'), causing
-- the board to always return empty.
--
-- Treat NULL station_id as "broadcast to all stations": unassigned orders are
-- visible on every KDS board regardless of which station is querying.

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
    t.total_amount,
    t.created_at,
    t.updated_at,
    t.last_event_sequence
  ORDER BY t.created_at ASC;
$$;

COMMENT ON FUNCTION kds.get_board_snapshot(UUID, TEXT) IS
'Snapshot contract for KDS clients. Returns kitchen tickets plus normalized item arrays for one business and optional station. Tickets with no station assignment are included for all station queries (broadcast semantics).';
