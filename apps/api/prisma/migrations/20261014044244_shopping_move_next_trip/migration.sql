-- AlterEnum
ALTER TYPE "ShoppingEntryStatus" ADD VALUE 'MOVED';

-- AlterTable
ALTER TABLE "ShoppingEntry" ADD COLUMN     "moveToTripId" TEXT;

-- CreateIndex
CREATE INDEX "ShoppingEntry_moveToTripId_idx" ON "ShoppingEntry"("moveToTripId");

-- AddForeignKey
ALTER TABLE "ShoppingEntry" ADD CONSTRAINT "ShoppingEntry_moveToTripId_fkey" FOREIGN KEY ("moveToTripId") REFERENCES "ShoppingTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
