-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "InventoryItemChange" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryItemChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryItemChange_itemId_createdAt_idx" ON "InventoryItemChange"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryItemChange_householdId_createdAt_idx" ON "InventoryItemChange"("householdId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryItem_householdId_archivedAt_idx" ON "InventoryItem"("householdId", "archivedAt");

-- AddForeignKey
ALTER TABLE "InventoryItemChange" ADD CONSTRAINT "InventoryItemChange_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItemChange" ADD CONSTRAINT "InventoryItemChange_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItemChange" ADD CONSTRAINT "InventoryItemChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
