/*
  Warnings:

  - You are about to drop the column `closeHour` on the `Tenant` table. All the data in the column will be lost.
  - You are about to drop the column `openHour` on the `Tenant` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Tenant" DROP COLUMN "closeHour",
DROP COLUMN "openHour",
ADD COLUMN     "businessHours" JSONB;
