-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "preferredRestockLocationId" TEXT;

-- AlterTable
ALTER TABLE "ShoppingEntry" ADD COLUMN     "locationId" TEXT;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_preferredRestockLocationId_fkey" FOREIGN KEY ("preferredRestockLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingEntry" ADD CONSTRAINT "ShoppingEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
