\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TimeZone='UTC';
SELECT set_config('umi.reward_verify_merchant',:'merchant_id',true);
DO $verification$
DECLARE target_id uuid := current_setting('umi.reward_verify_merchant')::uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM merchant.loyalty_reward_policy
    WHERE merchant_id=target_id AND mode='single_cycle'
      AND expiry_days=30 AND started_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Reward verification requires an active single_cycle 30-day policy';
  END IF;
  IF EXISTS (
    SELECT 1 FROM merchant.loyalty_reward_entitlement e
    JOIN merchant.loyalty_reward_policy p ON p.merchant_id=e.merchant_id
    WHERE e.merchant_id=target_id AND e.activated_at=p.started_at
      AND e.expires_at IS DISTINCT FROM p.started_at+make_interval(days=>p.expiry_days)
  ) THEN
    RAISE EXCEPTION 'Reward verification found incorrect activation grace deadlines';
  END IF;
END;
$verification$;
SELECT * FROM merchant.loyalty_reward_policy WHERE merchant_id=:'merchant_id'::uuid;
SELECT c.id AS card_id,s.visits_this_cycle,s.pending_rewards,s.legacy_pending_rewards,
  s.cycle_reward_available,s.visit_blocked_reason,s.next_reward_expires_at
FROM merchant.loyalty_card c
CROSS JOIN LATERAL merchant.loyalty_reward_card_state(c.merchant_id,c.id) s
WHERE c.merchant_id=:'merchant_id'::uuid ORDER BY c.id;
SELECT source,recovery,tier,count(*) AS units,min(expires_at) AS first_deadline,max(expires_at) AS last_deadline
FROM merchant.loyalty_reward_entitlement
WHERE merchant_id=:'merchant_id'::uuid AND redeemed_at IS NULL AND expired_at IS NULL
GROUP BY source,recovery,tier ORDER BY source,recovery,tier;
SELECT count(*) AS activated_cards,sum(imported_units) AS imported_obligations
FROM merchant.loyalty_reward_activation_audit WHERE merchant_id=:'merchant_id'::uuid;
-- created_at uses transaction start. Compare these candidates with saved preflight IDs.
SELECT count(*) AS earlier_creation_timestamps,
  count(a.card_id) AS audited_candidates,
  count(*) FILTER (WHERE a.card_id IS NULL) AS unaudited_candidates
FROM merchant.loyalty_card c
JOIN merchant.loyalty_reward_policy p ON p.merchant_id=c.merchant_id
LEFT JOIN merchant.loyalty_reward_activation_audit a
  ON a.merchant_id=c.merchant_id AND a.card_id=c.id
WHERE c.merchant_id=:'merchant_id'::uuid AND c.created_at<=p.started_at;
SELECT c.id AS unaudited_candidate_card_id,c.created_at
FROM merchant.loyalty_card c
JOIN merchant.loyalty_reward_policy p ON p.merchant_id=c.merchant_id
LEFT JOIN merchant.loyalty_reward_activation_audit a
  ON a.merchant_id=c.merchant_id AND a.card_id=c.id
WHERE c.merchant_id=:'merchant_id'::uuid AND c.created_at<=p.started_at AND a.card_id IS NULL;
SELECT count(*) AS incorrect_activation_grace_deadlines
FROM merchant.loyalty_reward_entitlement e
JOIN merchant.loyalty_reward_policy p ON p.merchant_id=e.merchant_id
WHERE e.merchant_id=:'merchant_id'::uuid AND e.activated_at=p.started_at
  AND e.expires_at IS DISTINCT FROM p.started_at+make_interval(days=>p.expiry_days);
COMMIT;
