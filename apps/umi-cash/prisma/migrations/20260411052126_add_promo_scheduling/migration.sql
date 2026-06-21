-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "promoDays" TEXT,
ADD COLUMN     "promoEndsAt" TIMESTAMP(3),
ADD COLUMN     "promoStartsAt" TIMESTAMP(3);
