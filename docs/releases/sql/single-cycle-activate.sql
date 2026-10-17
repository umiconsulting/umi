\set ON_ERROR_STOP on
-- Activation uses the reviewed tenant migration after the compatible applications deploy.
-- See ../2026-10-07-single-cycle-rewards.md for the release order.
DO $$ BEGIN
  RAISE EXCEPTION 'Apply supabase/migrations/20261011000000_activate_elgranribera_single_cycle_rewards.sql through the reviewed migration release';
END $$;
