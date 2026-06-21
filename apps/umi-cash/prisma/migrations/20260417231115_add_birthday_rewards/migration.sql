-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "birthdayRewardEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "birthdayRewardName" TEXT NOT NULL DEFAULT 'Regalo de cumpleaños';

-- CreateTable
CREATE TABLE "BirthdayReward" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loyaltyCardId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "BirthdayReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BirthdayReward_tenantId_idx" ON "BirthdayReward"("tenantId");

-- CreateIndex
CREATE INDEX "BirthdayReward_loyaltyCardId_idx" ON "BirthdayReward"("loyaltyCardId");

-- CreateIndex
CREATE INDEX "BirthdayReward_expiresAt_status_idx" ON "BirthdayReward"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayReward_loyaltyCardId_tenantId_year_key" ON "BirthdayReward"("loyaltyCardId", "tenantId", "year");

-- AddForeignKey
ALTER TABLE "BirthdayReward" ADD CONSTRAINT "BirthdayReward_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayReward" ADD CONSTRAINT "BirthdayReward_loyaltyCardId_fkey" FOREIGN KEY ("loyaltyCardId") REFERENCES "LoyaltyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
