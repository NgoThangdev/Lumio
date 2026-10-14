-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "stockRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ShoppingTrip" ADD COLUMN "suggestionsImportedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TripStockCheck" (
    "tripId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT,
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    "revision" INTEGER NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "history" JSONB NOT NULL DEFAULT '[]',
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "TripStockCheck_pkey" PRIMARY KEY ("tripId","itemId")
);

-- CreateIndex
CREATE INDEX "TripStockCheck_itemId_checkedAt_idx" ON "TripStockCheck"("itemId", "checkedAt");

-- AddForeignKey
ALTER TABLE "TripStockCheck" ADD CONSTRAINT "TripStockCheck_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "ShoppingTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripStockCheck" ADD CONSTRAINT "TripStockCheck_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripStockCheck" ADD CONSTRAINT "TripStockCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
