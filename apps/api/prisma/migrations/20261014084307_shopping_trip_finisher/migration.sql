-- AlterTable
ALTER TABLE "ShoppingTrip" ADD COLUMN     "completedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "ShoppingTrip" ADD CONSTRAINT "ShoppingTrip_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
