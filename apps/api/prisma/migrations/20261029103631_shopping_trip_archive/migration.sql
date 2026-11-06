-- AlterTable
ALTER TABLE "ShoppingTrip" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "ShoppingTrip_householdId_archivedAt_idx" ON "ShoppingTrip"("householdId", "archivedAt");

-- AddForeignKey
ALTER TABLE "ShoppingTrip" ADD CONSTRAINT "ShoppingTrip_archivedByUserId_fkey" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
