-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "passStyle" TEXT NOT NULL DEFAULT 'default';

-- CreateIndex
CREATE INDEX "Transaction_staffId_type_createdAt_idx" ON "Transaction"("staffId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_cardId_type_createdAt_idx" ON "Transaction"("cardId", "type", "createdAt");
