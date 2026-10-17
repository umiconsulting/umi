-- El Gran Ribera activation migration.
-- Release order: base migration, compatible backend and clients, then this migration.
-- One DO statement keeps the identity check and activation atomic.
DO $activation$
DECLARE
  target_id constant uuid := 'a13905a2-0319-4cc1-cacf-eee47b75e309';
  target_handle constant text := 'elgranribera';
  candidate record;
  identity_count integer := 0;
  identity_matches boolean := false;
BEGIN
  -- Hold each matching row lock through the check and the routine call.
  FOR candidate IN
    SELECT id, handle FROM merchant.merchant
    WHERE id = target_id OR handle = target_handle
    ORDER BY id FOR UPDATE
  LOOP
    identity_count := identity_count + 1;
    identity_matches := candidate.id = target_id AND candidate.handle = target_handle;
  END LOOP;

  IF identity_count = 0 THEN
    RAISE NOTICE 'EGR identities are absent; activation skipped';
    RETURN;
  END IF;
  IF identity_count <> 1 OR identity_matches IS NOT TRUE THEN
    RAISE EXCEPTION 'EGR identity mismatch: UUID and handle must identify the same merchant';
  END IF;

  IF to_regprocedure('merchant.activate_single_cycle_reward_policy(uuid,integer)') IS NULL
     OR to_regclass('merchant.loyalty_reward_policy') IS NULL THEN
    RAISE EXCEPTION 'Apply the base reward schema migration before EGR activation';
  END IF;

  PERFORM merchant.activate_single_cycle_reward_policy(target_id, 30);

  -- The routine can return early for an existing policy. Verify that policy too.
  IF NOT EXISTS (
    SELECT 1 FROM merchant.loyalty_reward_policy
    WHERE merchant_id = target_id AND mode = 'single_cycle'
      AND expiry_days = 30 AND started_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'EGR activation requires an active single_cycle 30-day policy';
  END IF;
END
$activation$;
