-- apps/umi-cash/prisma/migrations/20260902000000_add_card_reward_override/migration.sql
ALTER TABLE loyalty.reward_configs ADD COLUMN kind text NOT NULL DEFAULT 'standard';
ALTER TABLE loyalty.reward_configs
  ADD CONSTRAINT loyalty_reward_configs_kind_check CHECK (kind IN ('standard', 'override'));

ALTER TABLE loyalty.cards ADD COLUMN reward_config_id uuid;

-- NO ACTION, not SET NULL: composite SET NULL would null tenant_id (NOT NULL) too.
-- reward_configs rows are never deleted (only deactivated), so this never fires.
ALTER TABLE loyalty.cards
  ADD CONSTRAINT loyalty_cards_reward_override_fkey
  FOREIGN KEY (tenant_id, reward_config_id)
  REFERENCES loyalty.reward_configs (tenant_id, id)
  ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX loyalty_cards_reward_override_idx
  ON loyalty.cards (tenant_id, reward_config_id)
  WHERE reward_config_id IS NOT NULL;
