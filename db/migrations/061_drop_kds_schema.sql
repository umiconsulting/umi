-- ============================================================================
-- 061_drop_kds_schema.sql — Retire the kds view-only schema
--
-- The kds schema held zero tables and only two views (kds.station_order and
-- kds.station_event). KdsRepository now queries merchant.kitchen_order,
-- merchant.kitchen_order_item, merchant.station, and merchant.kitchen_event
-- directly.
--
-- Canonical schemas that remain active:
--   umi, merchant, runtime, extensions, public
-- ============================================================================

drop schema if exists kds cascade;
