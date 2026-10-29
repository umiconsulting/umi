\set ON_ERROR_STOP on
\if :{?onca_merchant_id}
\else
  \echo 'onca_merchant_id is required'
  \quit 3
\endif

BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '180s';
SELECT set_config('app.onca_merchant_id', :'onca_merchant_id', true);

-- Fail before touching data when the target is not the expected ONCA merchant.
DO $$
DECLARE
  target_id uuid := current_setting('app.onca_merchant_id')::uuid;
BEGIN
  IF (SELECT count(*)
      FROM merchant.merchant
      WHERE id = target_id
        AND handle = 'onca') <> 1 THEN
    RAISE EXCEPTION 'ONCA merchant preflight failed';
  END IF;
END
$$;

-- Keep a row-count and content fingerprint for every other merchant's
-- merchant-scoped rows. This proves the reset did not touch another business.
CREATE TEMP TABLE onca_other_merchant_before (
  table_schema text NOT NULL,
  table_name text NOT NULL,
  row_count bigint NOT NULL,
  digest text NOT NULL,
  PRIMARY KEY (table_schema, table_name)
) ON COMMIT DROP;

DO $$
DECLARE
  target_id uuid := current_setting('app.onca_merchant_id')::uuid;
  relation record;
  other_count bigint;
  other_digest text;
BEGIN
  FOR relation IN
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE table_schema IN ('merchant', 'runtime', 'umi', 'kds')
      AND column_name = 'merchant_id'
    ORDER BY table_schema, table_name
  LOOP
    EXECUTE format(
      'SELECT count(*), md5(coalesce(string_agg(row_data::text, ''|'' ORDER BY row_data::text), '''')) ' ||
      'FROM (SELECT * FROM %I.%I WHERE merchant_id <> $1) row_data',
      relation.table_schema,
      relation.table_name
    )
    INTO other_count, other_digest
    USING target_id;

    INSERT INTO onca_other_merchant_before
    VALUES (relation.table_schema, relation.table_name, other_count, other_digest);
  END LOOP;
END
$$;

-- Hardware and cash history is protected by immutable triggers. Replication
-- role bypasses those triggers only for this transaction. Foreign-key integrity
-- is checked explicitly below before COMMIT.
SET LOCAL session_replication_role = replica;

UPDATE merchant.physical_register
SET status = 'available',
    current_shift_id = NULL,
    version = version + 1
WHERE merchant_id = :'onca_merchant_id'::uuid;

DELETE FROM merchant.table_state
WHERE merchant_id = :'onca_merchant_id'::uuid;

DELETE FROM merchant.hardware_print_job_event
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.hardware_print_job
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.hardware_command_event
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.hardware_command
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.hardware_diagnostic
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.administrative_command
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.hardware_assignment
WHERE merchant_id = :'onca_merchant_id'::uuid
  AND released_at IS NOT NULL;
DELETE FROM merchant.device_replay_cursor
WHERE merchant_id = :'onca_merchant_id'::uuid;

DELETE FROM merchant.offline_provisional_mapping
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.offline_replay_conflict
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.offline_reconciliation
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.offline_replay_command
WHERE merchant_id = :'onca_merchant_id'::uuid;

DELETE FROM merchant.pos_exception_receipt
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.pos_sale_exception_line
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.pos_tender_compensation
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.pos_cash_compensation
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.pos_sale_exception
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.pos_exception_preview
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.pos_restock_intent
WHERE merchant_id = :'onca_merchant_id'::uuid;

DELETE FROM merchant.no_sale_drawer_event
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.cash_ledger_entry
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.cash_movement
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.cash_count_attempt
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.cash_reconciliation
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.cash_variance_resolution
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.cash_shift_close
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.cash_shift_custody_event
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.cash_shift_handoff
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.cash_shift
WHERE merchant_id = :'onca_merchant_id'::uuid;

DELETE FROM merchant.stock_ledger_entry
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.customer_value_tender_allocation
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.customer_value_authorization
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_sale_policy_snapshot
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_earn_preview
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.gift_card_funding_assignment
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_gift_card_ledger
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_gift_card_balance
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_gift_card
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_reward_redemption_link
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_redemption
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_birthday_grant
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_points_ledger
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_points_balance
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_points_account
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_stored_value_ledger
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_stored_value_balance
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_reward_activation_audit
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_reward_entitlement
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_visit
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.loyalty_card
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.inventory_reservation_line
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.inventory_reservation
WHERE merchant_id = :'onca_merchant_id'::uuid;

DELETE FROM merchant.pos_partial_payment
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.pos_committed_sale
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.receipt_snapshot
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.pos_payment_attempt
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.pos_tender_fact
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.pos_checkout_draft
WHERE merchant_id = :'onca_merchant_id'::uuid;

DELETE FROM merchant.kitchen_event
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.kitchen_command
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.kitchen_order_item
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.kitchen_order
WHERE merchant_id = :'onca_merchant_id'::uuid;

DELETE FROM merchant.pos_cart_line_modifier
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.pos_cart_line
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.pos_cart
WHERE merchant_id = :'onca_merchant_id'::uuid;

DELETE FROM merchant.payment
WHERE order_id IN (
  SELECT id
  FROM merchant.customer_order
  WHERE merchant_id = :'onca_merchant_id'::uuid
);
DELETE FROM merchant.order_discount
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.order_item
WHERE order_id IN (
  SELECT id
  FROM merchant.customer_order
  WHERE merchant_id = :'onca_merchant_id'::uuid
);
DELETE FROM merchant.order_event
WHERE order_id IN (
  SELECT id
  FROM merchant.customer_order
  WHERE merchant_id = :'onca_merchant_id'::uuid
);
DELETE FROM merchant.fiscal_document
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.customer_order
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.table_order
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.table_order_credential
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.table_reservation
WHERE merchant_id = :'onca_merchant_id'::uuid;

DELETE FROM merchant.message
WHERE conversation_id IN (
  SELECT id
  FROM merchant.conversation
  WHERE merchant_id = :'onca_merchant_id'::uuid
);
DELETE FROM merchant.contact
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.customer_consent_current
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.customer_consent_history
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.customer_fact
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.customer_merge_mapping
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.conversation
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.customer
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.integration
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.knowledge_document
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.financial_event
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.audit_event
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.audit_log
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.business_command
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM merchant.aggregate_version
WHERE merchant_id = :'onca_merchant_id'::uuid;

DELETE FROM runtime.device_pairing_session
WHERE enrollment_request_id IN (
  SELECT id
  FROM runtime.device_enrollment_request
  WHERE merchant_id = :'onca_merchant_id'::uuid
);
DELETE FROM runtime.device_enrollment_request
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM runtime.device_enrollment_challenge
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM runtime.outbox_event
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM runtime.inbound_event
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM runtime.dead_letter
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM runtime.idempotency_key
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM runtime.conversation_cart
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM runtime.conversation_turn
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM runtime.platform_elevation
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM runtime.elevation_grant
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM runtime.security_audit_event
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM runtime.audit_event_internal
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM runtime.reminder_sent
WHERE merchant_id = :'onca_merchant_id'::uuid;
UPDATE runtime.security_audit_event
SET session_id = NULL
WHERE merchant_id IS DISTINCT FROM :'onca_merchant_id'::uuid
  AND session_id IN (
    SELECT id
    FROM runtime.session
    WHERE merchant_id = :'onca_merchant_id'::uuid
  );
DELETE FROM runtime.pos_push_token
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM runtime.operator_session
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM runtime.session
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM runtime.dashboard_session
WHERE user_id IN (
  SELECT user_id
  FROM merchant.staff
  WHERE merchant_id = :'onca_merchant_id'::uuid
    AND user_id IS NOT NULL
);
DELETE FROM umi.access_grant
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM umi.ai_usage
WHERE merchant_id = :'onca_merchant_id'::uuid;
DELETE FROM umi.audit_log
WHERE merchant_id = :'onca_merchant_id'::uuid;

SET LOCAL session_replication_role = origin;

UPDATE merchant.pos_account_counter
SET business_date = (pg_catalog.now() AT TIME ZONE 'America/Mazatlan')::date,
    last_number = 0,
    updated_at = pg_catalog.clock_timestamp()
WHERE merchant_id = :'onca_merchant_id'::uuid;

UPDATE merchant.receipt_counter
SET business_date = (pg_catalog.now() AT TIME ZONE 'America/Mazatlan')::date,
    last_number = 0,
    updated_at = pg_catalog.clock_timestamp()
WHERE merchant_id = :'onca_merchant_id'::uuid;

-- No foreign-key trigger fired during the scoped deletes. Check every FK in the
-- four application schemas before committing instead of assuming the order was
-- complete.
DO $$
DECLARE
  target_id uuid := current_setting('app.onca_merchant_id')::uuid;
  relation record;
  match_clause text;
  nonnull_clause text;
  orphan_count bigint;
BEGIN
  FOR relation IN
    SELECT con.oid,
           con.conrelid,
           con.confrelid,
           con.conrelid::regclass AS child_name
    FROM pg_constraint con
    JOIN pg_namespace child_schema ON child_schema.oid = con.connamespace
    WHERE con.contype = 'f'
      AND child_schema.nspname IN ('merchant', 'runtime', 'umi', 'kds')
  LOOP
    SELECT
      string_agg(format('c.%I = p.%I', child_col.attname, parent_col.attname),
                 ' AND ' ORDER BY child_key.ordinality),
      string_agg(format('c.%I IS NOT NULL', child_col.attname),
                 ' AND ' ORDER BY child_key.ordinality)
    INTO match_clause, nonnull_clause
    FROM pg_constraint selected
    CROSS JOIN LATERAL unnest(selected.conkey, selected.confkey)
      WITH ORDINALITY AS child_key(child_attnum, parent_attnum, ordinality)
    JOIN pg_attribute child_col
      ON child_col.attrelid = relation.conrelid
     AND child_col.attnum = child_key.child_attnum
    JOIN pg_attribute parent_col
      ON parent_col.attrelid = relation.confrelid
     AND parent_col.attnum = child_key.parent_attnum
    WHERE selected.oid = relation.oid;

    EXECUTE format(
      'SELECT count(*) FROM %s c ' ||
      'WHERE %s AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s)',
      relation.child_name,
      nonnull_clause,
      relation.confrelid::regclass,
      match_clause
    )
    INTO orphan_count;

    IF orphan_count <> 0 THEN
      RAISE EXCEPTION 'foreign-key orphan left in %: % rows',
        relation.child_name, orphan_count;
    END IF;
  END LOOP;
END
$$;

-- The business configuration that must survive the reset.
DO $$
DECLARE
  target_id uuid := current_setting('app.onca_merchant_id')::uuid;
  merchant_count bigint;
  location_count bigint;
  floor_plan_count bigint;
  staff_count bigint;
  role_count bigint;
  permission_count bigint;
  product_count bigint;
  category_count bigint;
  variant_count bigint;
  device_count bigint;
  history_count bigint;
  register_bad_count bigint;
  counter_bad_count bigint;
BEGIN
  SELECT count(*) INTO merchant_count
  FROM merchant.merchant
  WHERE id = target_id AND handle = 'onca';
  SELECT count(*) INTO location_count
  FROM merchant.location
  WHERE merchant_id = target_id;
  SELECT count(*) INTO floor_plan_count
  FROM merchant.floor_plan
  WHERE merchant_id = target_id;
  SELECT count(*) INTO staff_count
  FROM merchant.staff
  WHERE merchant_id = target_id;
  SELECT count(*) INTO role_count
  FROM merchant.role
  WHERE merchant_id = target_id;
  SELECT count(*) INTO permission_count
  FROM merchant.role_permission
  WHERE merchant_id = target_id;
  SELECT count(*) INTO product_count
  FROM merchant.product
  WHERE merchant_id = target_id;
  SELECT count(*) INTO category_count
  FROM merchant.product_category
  WHERE merchant_id = target_id;
  SELECT count(*) INTO variant_count
  FROM merchant.product_variant
  WHERE merchant_id = target_id;
  SELECT count(*) INTO device_count
  FROM merchant.device
  WHERE merchant_id = target_id
    AND status = 'active';

  IF (merchant_count, location_count, floor_plan_count, staff_count, role_count,
      permission_count, product_count, category_count, variant_count,
      device_count) IS DISTINCT FROM
     (1::bigint, 1::bigint, 1::bigint, 7::bigint, 4::bigint, 205::bigint,
      51::bigint, 3::bigint, 24::bigint, 3::bigint) THEN
    RAISE EXCEPTION
      'protected configuration changed: merchant=%, locations=%, floor_plans=%, staff=%, roles=%, permissions=%, products=%, categories=%, variants=%, devices=%',
      merchant_count, location_count, floor_plan_count, staff_count, role_count,
      permission_count, product_count, category_count, variant_count,
      device_count;
  END IF;

  SELECT
    (SELECT count(*) FROM merchant.pos_cart WHERE merchant_id = target_id) +
    (SELECT count(*) FROM merchant.pos_committed_sale WHERE merchant_id = target_id) +
    (SELECT count(*) FROM merchant.receipt_snapshot WHERE merchant_id = target_id) +
    (SELECT count(*) FROM merchant.pos_tender_fact WHERE merchant_id = target_id) +
    (SELECT count(*) FROM merchant.cash_shift WHERE merchant_id = target_id) +
    (SELECT count(*) FROM merchant.cash_ledger_entry WHERE merchant_id = target_id) +
    (SELECT count(*) FROM merchant.kitchen_order WHERE merchant_id = target_id) +
    (SELECT count(*) FROM merchant.kitchen_order_item WHERE merchant_id = target_id) +
    (SELECT count(*) FROM merchant.kitchen_event WHERE merchant_id = target_id) +
    (SELECT count(*) FROM merchant.customer_order WHERE merchant_id = target_id) +
    (SELECT count(*) FROM merchant.table_state WHERE merchant_id = target_id) +
    (SELECT count(*) FROM merchant.audit_event WHERE merchant_id = target_id) +
    (SELECT count(*) FROM runtime.audit_event_internal WHERE merchant_id = target_id) +
    (SELECT count(*) FROM runtime.operator_session WHERE merchant_id = target_id) +
    (SELECT count(*) FROM runtime.session WHERE merchant_id = target_id)
  INTO history_count;
  IF history_count <> 0 THEN
    RAISE EXCEPTION 'ONCA operational history remains: % rows', history_count;
  END IF;

  SELECT count(*) INTO register_bad_count
  FROM merchant.physical_register
  WHERE merchant_id = target_id
    AND (status <> 'available' OR current_shift_id IS NOT NULL);
  IF register_bad_count <> 0 THEN
    RAISE EXCEPTION 'ONCA register is not available after reset';
  END IF;

  SELECT
    (SELECT count(*) FROM merchant.pos_account_counter
     WHERE merchant_id = target_id AND last_number <> 0) +
    (SELECT count(*) FROM merchant.receipt_counter
     WHERE merchant_id = target_id AND last_number <> 0)
  INTO counter_bad_count;
  IF counter_bad_count <> 0 THEN
    RAISE EXCEPTION 'ONCA folio counters were not reset';
  END IF;
END
$$;

-- Compare every other merchant's scoped rows with the fingerprints captured
-- before the reset.
DO $$
DECLARE
  target_id uuid := current_setting('app.onca_merchant_id')::uuid;
  relation record;
  other_count bigint;
  other_digest text;
  before_count bigint;
  before_digest text;
BEGIN
  FOR relation IN SELECT * FROM onca_other_merchant_before ORDER BY 1, 2
  LOOP
    EXECUTE format(
      'SELECT count(*), md5(coalesce(string_agg(row_data::text, ''|'' ORDER BY row_data::text), '''')) ' ||
      'FROM (SELECT * FROM %I.%I WHERE merchant_id <> $1) row_data',
      relation.table_schema,
      relation.table_name
    )
    INTO other_count, other_digest
    USING target_id;

    IF other_count <> relation.row_count OR other_digest IS DISTINCT FROM relation.digest THEN
      RAISE EXCEPTION 'another merchant changed in %.%',
        relation.table_schema, relation.table_name;
    END IF;
  END LOOP;
END
$$;

COMMIT;

\echo 'ONCA operational reset verified and committed'
