\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
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
COMMIT;
