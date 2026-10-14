-- AlterTable
ALTER TABLE "ActionBatchAllocation" ADD COLUMN     "quantityAfter" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "InventoryAction" ADD COLUMN     "postStockRevision" INTEGER;

-- AlterTable
ALTER TABLE "InventoryStateAction" ADD COLUMN     "postStockRevision" INTEGER;

-- CreateTable
CREATE TABLE "InventoryUndo" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inventoryActionId" TEXT,
    "stateActionId" TEXT,
    "postStockRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryUndo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryUndo_one_original_check" CHECK (num_nonnulls("inventoryActionId", "stateActionId") = 1)
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryUndo_inventoryActionId_key" ON "InventoryUndo"("inventoryActionId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryUndo_stateActionId_key" ON "InventoryUndo"("stateActionId");

-- CreateIndex
CREATE INDEX "InventoryUndo_itemId_createdAt_idx" ON "InventoryUndo"("itemId", "createdAt");

-- AddForeignKey
ALTER TABLE "InventoryUndo" ADD CONSTRAINT "InventoryUndo_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUndo" ADD CONSTRAINT "InventoryUndo_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUndo" ADD CONSTRAINT "InventoryUndo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUndo" ADD CONSTRAINT "InventoryUndo_inventoryActionId_fkey" FOREIGN KEY ("inventoryActionId") REFERENCES "InventoryAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUndo" ADD CONSTRAINT "InventoryUndo_stateActionId_fkey" FOREIGN KEY ("stateActionId") REFERENCES "InventoryStateAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
