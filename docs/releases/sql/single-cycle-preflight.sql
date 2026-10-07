\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
SELECT id, name, timezone FROM merchant.merchant WHERE id=:'merchant_id'::uuid;
SELECT id, name, kind, stamps_required, active FROM merchant.loyalty_reward
WHERE merchant_id=:'merchant_id'::uuid AND type='stamps_free_item' AND active
ORDER BY kind, created_at DESC;
SELECT * FROM merchant.loyalty_reward_policy WHERE merchant_id=:'merchant_id'::uuid;
SELECT c.id AS card_id,c.cycle_anchor,c.pending_tier1,c.rewards_earned,
  COALESCE(v.total,0) AS lifetime_visits,
  GREATEST(0,c.rewards_earned-COALESCE(r.claims,0)) AS recorded_available_rewards
FROM merchant.loyalty_card c
LEFT JOIN LATERAL (SELECT sum(stamps)::int AS total FROM merchant.loyalty_visit
  WHERE merchant_id=c.merchant_id AND card_id=c.id) v ON true
LEFT JOIN LATERAL (SELECT count(*)::int AS claims FROM merchant.loyalty_redemption
  WHERE merchant_id=c.merchant_id AND card_id=c.id AND reverted_at IS NULL AND NOT cycle_reset) r ON true
WHERE c.merchant_id=:'merchant_id'::uuid ORDER BY c.id;
COMMIT;
