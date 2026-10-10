\set ON_ERROR_STOP on
BEGIN;
SELECT merchant.activate_single_cycle_reward_policy(:'merchant_id'::uuid,30);
SELECT * FROM merchant.loyalty_reward_policy WHERE merchant_id=:'merchant_id'::uuid;
COMMIT;
