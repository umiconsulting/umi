-- AlterTable
ALTER TABLE "LoyaltyCard" ADD COLUMN     "lifecycleMessage" TEXT,
ADD COLUMN     "lifecycleMessageUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LifecycleEvent" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "journey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LifecycleEvent_sentAt_idx" ON "LifecycleEvent"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "LifecycleEvent_cardId_journey_key" ON "LifecycleEvent"("cardId", "journey");

-- AddForeignKey
ALTER TABLE "LifecycleEvent" ADD CONSTRAINT "LifecycleEvent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "LoyaltyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
