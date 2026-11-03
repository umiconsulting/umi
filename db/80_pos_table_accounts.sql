\set ON_ERROR_STOP on
-- Pre-cutover base for persistent POS accounts.
-- These forward files remain the single source of each schema definition.
-- The earlier files provide the order and line fields that accounts require.
-- The existing compatibility anchor remains build-v3-79.
-- 004 adds the fired order link and the order.fire permission.
\ir migrations/004_pos_fired_order.sql
-- 005 adds the cart fulfillment type.
\ir migrations/005_pos_cart_fulfillment.sql
-- 006 records which cart lines reached the order.
\ir migrations/006_pos_cart_second_round.sql
-- 007 provides the cancellation reason used by account cancellation.
\ir migrations/007_pos_cancellation_reason_code.sql
-- 010 restores column grants on these protected cart fields.
\ir migrations/010_pos_cart_column_grants.sql
\ir migrations/018_pos_table_accounts.sql
\ir migrations/019_cancel_sent_cart_line.sql
\ir migrations/020_waiter_role_template.sql
\ir migrations/021_pos_account_metadata.sql
-- 022 gives the receipt its own short, human ticket number.
\ir migrations/022_receipt_folio.sql
