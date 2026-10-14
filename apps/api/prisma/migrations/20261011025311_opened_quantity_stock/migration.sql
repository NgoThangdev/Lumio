-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InventoryActionType" ADD VALUE 'OPEN';
ALTER TYPE "InventoryActionType" ADD VALUE 'FINISH_OPENED';

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "openedTrackingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recommendedDaysAfterOpening" INTEGER;

-- AlterTable
ALTER TABLE "StockBatch" ADD COLUMN     "openedAt" TIMESTAMP(3),
ADD COLUMN     "openedUseByDate" DATE;

-- CreateTable
CREATE TABLE "OpenTransfer" (
    "actionId" TEXT NOT NULL,
    "sourceBatchId" TEXT NOT NULL,
    "openedBatchId" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "OpenTransfer_pkey" PRIMARY KEY ("actionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpenTransfer_openedBatchId_key" ON "OpenTransfer"("openedBatchId");

-- CreateIndex
CREATE INDEX "OpenTransfer_sourceBatchId_idx" ON "OpenTransfer"("sourceBatchId");

-- AddForeignKey
ALTER TABLE "OpenTransfer" ADD CONSTRAINT "OpenTransfer_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "InventoryAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenTransfer" ADD CONSTRAINT "OpenTransfer_sourceBatchId_fkey" FOREIGN KEY ("sourceBatchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenTransfer" ADD CONSTRAINT "OpenTransfer_openedBatchId_fkey" FOREIGN KEY ("openedBatchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_opening_days_check"
CHECK ("recommendedDaysAfterOpening" IS NULL OR "recommendedDaysAfterOpening" > 0);
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_opening_mode_check"
CHECK ("trackingMode" = 'QUANTITY' OR ("openedTrackingEnabled" = false AND "recommendedDaysAfterOpening" IS NULL));
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_opened_date_check"
CHECK ("openedAt" IS NOT NULL OR "openedUseByDate" IS NULL);
ALTER TABLE "OpenTransfer" ADD CONSTRAINT "OpenTransfer_unit_quantity_check"
CHECK ("quantity" = 1 AND "sourceBatchId" <> "openedBatchId");
