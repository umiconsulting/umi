-- La sucursal decide si Comer aquí requiere una mesa.
ALTER TABLE merchant.pos_checkout_policy
  ADD COLUMN IF NOT EXISTS allow_dine_in_without_table boolean NOT NULL DEFAULT false;
GRANT UPDATE (manual_terminal_enabled, mixed_tender_enabled, maximum_tender_lines,
  allow_dine_in_without_table, version, updated_at)
  ON merchant.pos_checkout_policy TO api;
COMMENT ON COLUMN merchant.pos_checkout_policy.allow_dine_in_without_table IS
  'Permite cobrar Comer aquí sin mesa; no crea una mesa ficticia.';
