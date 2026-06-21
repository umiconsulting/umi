-- Repair KDS projection event semantics.
--
-- Before this migration: project_transaction_trigger() emitted `status_changed`
-- whenever conversaflow.transactions.status changed. This produced events with
-- source='trigger' and no from_status payload — indistinguishable from explicit
-- operator transitions at the client, and inconsistent with how notifications
-- read the event stream.
--
-- After this migration: the trigger always emits `order_upserted`. This makes it
-- a pure projection-maintenance signal. `status_changed` is reserved exclusively
-- for explicit operator transitions executed via transition_ticket() and
-- partial_cancel_items().

CREATE OR REPLACE FUNCTION kds.project_transaction_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = kds, conversaflow, public
AS $$
BEGIN
  IF NEW.transaction_type IS DISTINCT FROM 'order' THEN
    RETURN NEW;
  END IF;

  PERFORM kds.project_transaction(
    NEW.id,
    'order_upserted',
    'trigger',
    NULL
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION kds.project_transaction_trigger() IS
'Projection-maintenance trigger. Always emits order_upserted — never status_changed. status_changed is reserved for explicit operator actions in transition_ticket() and partial_cancel_items().';
