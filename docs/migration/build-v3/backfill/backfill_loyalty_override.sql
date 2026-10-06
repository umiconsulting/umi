-- ============================================================================
-- Per-card reward override: legacy `loyalty.cards.reward_config_id` →
-- `merchant.loyalty_card.reward_override_id`.
--
-- WHY THIS IS ITS OWN FILE, AND WHY IT RUNS LAST.
-- The column it writes is added by `37_pos_customer_value.sql`, which the runner applies
-- in the UmiPOS DDL phase — AFTER the data. So this cannot live in `backfill_loyalty.sql`
-- (that file runs before the column exists) and it cannot live inside `37` (a numbered DDL
-- file must be applicable to a PRISTINE database, where the legacy `loyalty` schema does
-- not exist at all — `99_verify` asserts exactly that).
--
-- It is a data carry, not DDL, so it belongs to the backfill layer and runs between the
-- UmiPOS DDL phase and the cross-schema FKs.
--
-- Measured on the 2026-10-06 production dump: 1 card carries an override ('Capuccino').
-- The reward id is the source id, which `backfill_loyalty.sql` section 2 preserves, so the
-- link is a straight copy and needs no mapping table.
-- ============================================================================

update merchant.loyalty_card c
   set reward_override_id = s.reward_config_id
  from loyalty.cards s
 where s.id = c.id
   and s.reward_config_id is not null
   -- Guard the composite FK: the reward must have landed for the same café. It always
   -- does (the reward carries coalesce(program tenant, its own tenant)), but a silent
   -- FK failure at 04:00 is not a thing this file gets to risk.
   and exists (
     select 1 from merchant.loyalty_reward r
      where r.id = s.reward_config_id and r.merchant_id = c.merchant_id
   );
