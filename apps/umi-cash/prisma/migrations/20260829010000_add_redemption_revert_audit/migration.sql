-- Revert audit for reward redemptions: a reverted canje stays in the ledger
-- (the bitácora must show it) — these columns are the audit trail, not a soft
-- delete. Additive and nullable, safe against running code.
ALTER TABLE "loyalty"."reward_redemptions"
  ADD COLUMN IF NOT EXISTS "reverted_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "reverted_by_staff_member_id" UUID;
