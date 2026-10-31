BEGIN;

ALTER TABLE merchant.inventory_item
  ADD COLUMN IF NOT EXISTS initial_unit_cost_minor bigint;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid='merchant.inventory_item'::regclass
        AND conname='inventory_item_initial_unit_cost_ck') THEN
    ALTER TABLE merchant.inventory_item
      ADD CONSTRAINT inventory_item_initial_unit_cost_ck
      CHECK (initial_unit_cost_minor IS NULL OR
        initial_unit_cost_minor BETWEEN 0 AND 9007199254740991);
  END IF;
END;
$$;

COMMIT;
