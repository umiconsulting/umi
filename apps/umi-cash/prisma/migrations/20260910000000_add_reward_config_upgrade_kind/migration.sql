-- apps/umi-cash/prisma/migrations/20260910000000_add_reward_config_upgrade_kind/migration.sql
--
-- Two-tier ("ladder") rewards: a tenant may run an optional second tier above its
-- standard reward — e.g. 7 visits = capuccino, 9 visits = bebida en las rocas.
-- The upper tier is a reward_configs row of kind 'upgrade' (is_active = true while
-- it runs). No new columns: the existing kind CHECK just needs to admit the value.
--
-- Backward-compatible: the currently deployed code never writes 'upgrade', and the
-- new code only writes it when an admin configures a second tier.
ALTER TABLE loyalty.reward_configs DROP CONSTRAINT loyalty_reward_configs_kind_check;
ALTER TABLE loyalty.reward_configs
  ADD CONSTRAINT loyalty_reward_configs_kind_check CHECK (kind IN ('standard', 'override', 'upgrade'));
