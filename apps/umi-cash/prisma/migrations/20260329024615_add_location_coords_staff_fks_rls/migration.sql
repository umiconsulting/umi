-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECK constraints for domain validation
ALTER TABLE "LoyaltyCard" ADD CONSTRAINT "chk_balance_non_negative" CHECK ("balanceCentavos" >= 0);
ALTER TABLE "LoyaltyCard" ADD CONSTRAINT "chk_total_visits_non_negative" CHECK ("totalVisits" >= 0);
ALTER TABLE "LoyaltyCard" ADD CONSTRAINT "chk_visits_cycle_non_negative" CHECK ("visitsThisCycle" >= 0);
ALTER TABLE "LoyaltyCard" ADD CONSTRAINT "chk_pending_rewards_non_negative" CHECK ("pendingRewards" >= 0);
ALTER TABLE "RewardConfig" ADD CONSTRAINT "chk_visits_required_positive" CHECK ("visitsRequired" > 0);
ALTER TABLE "GiftCard" ADD CONSTRAINT "chk_gift_amount_positive" CHECK ("amountCentavos" > 0);

-- Enable Row-Level Security on all tables
-- Deny all access via anon/public; only service_role (used by Prisma) can access
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Location" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoyaltyCard" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Visit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Transaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RewardConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RewardRedemption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GiftCard" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApplePushToken" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (extra safety)
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Location" FORCE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Session" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LoyaltyCard" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Visit" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Transaction" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RewardConfig" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RewardRedemption" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GiftCard" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ApplePushToken" FORCE ROW LEVEL SECURITY;

-- Allow full access for the postgres/service_role (used by Prisma)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['Tenant','Location','User','Session','LoyaltyCard','Visit','Transaction','RewardConfig','RewardRedemption','GiftCard','ApplePushToken'])
  LOOP
    EXECUTE format('CREATE POLICY "service_role_all" ON %I FOR ALL TO postgres USING (true) WITH CHECK (true)', tbl);
  END LOOP;
END $$;
