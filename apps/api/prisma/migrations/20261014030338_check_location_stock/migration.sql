-- CreateTable
CREATE TABLE "LocationStockCheck" (
    "locationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "userId" TEXT,
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    "revision" INTEGER NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "history" JSONB NOT NULL DEFAULT '[]',
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "LocationStockCheck_pkey" PRIMARY KEY ("locationId","itemId")
);

-- CreateIndex
CREATE INDEX "LocationStockCheck_itemId_checkedAt_idx" ON "LocationStockCheck"("itemId", "checkedAt");

-- CreateIndex
CREATE INDEX "LocationStockCheck_householdId_locationId_idx" ON "LocationStockCheck"("householdId", "locationId");

-- AddForeignKey
ALTER TABLE "LocationStockCheck" ADD CONSTRAINT "LocationStockCheck_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationStockCheck" ADD CONSTRAINT "LocationStockCheck_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationStockCheck" ADD CONSTRAINT "LocationStockCheck_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationStockCheck" ADD CONSTRAINT "LocationStockCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
