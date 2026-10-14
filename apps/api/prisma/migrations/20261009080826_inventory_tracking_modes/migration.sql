-- CreateEnum
CREATE TYPE "TrackingMode" AS ENUM ('QUANTITY', 'FIVE_LEVEL', 'PRESENCE_BACKUP');

-- CreateEnum
CREATE TYPE "StockLevel" AS ENUM ('FULL', 'THREE_QUARTERS', 'HALF', 'QUARTER', 'EMPTY');

-- CreateEnum
CREATE TYPE "InventoryStateActionType" AS ENUM ('UPDATE_LEVEL', 'ADD_BACKUP', 'OPEN_REFILL', 'SET_PRESENCE');

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "backupCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "buyAtLevel" "StockLevel" NOT NULL DEFAULT 'QUARTER',
ADD COLUMN     "currentLevel" "StockLevel",
ADD COLUMN     "isPresent" BOOLEAN,
ADD COLUMN     "lowAtLevel" "StockLevel" NOT NULL DEFAULT 'HALF',
ADD COLUMN     "trackingMode" "TrackingMode" NOT NULL DEFAULT 'QUANTITY';

ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_tracking_state_check" CHECK (
    "backupCount" >= 0 AND (
        ("trackingMode" = 'QUANTITY' AND "currentLevel" IS NULL AND "isPresent" IS NULL AND "backupCount" = 0) OR
        ("trackingMode" = 'FIVE_LEVEL' AND "currentLevel" IS NOT NULL AND "isPresent" IS NULL) OR
        ("trackingMode" = 'PRESENCE_BACKUP' AND "currentLevel" IS NULL AND "isPresent" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "InventoryStateAction" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "InventoryStateActionType" NOT NULL,
    "beforeLevel" "StockLevel",
    "afterLevel" "StockLevel",
    "beforePresent" BOOLEAN,
    "afterPresent" BOOLEAN,
    "beforeBackupCount" INTEGER NOT NULL,
    "afterBackupCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryStateAction_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InventoryStateAction" ADD CONSTRAINT "InventoryStateAction_backup_count_check"
CHECK ("beforeBackupCount" >= 0 AND "afterBackupCount" >= 0);

-- CreateIndex
CREATE INDEX "InventoryStateAction_itemId_createdAt_idx" ON "InventoryStateAction"("itemId", "createdAt");

-- AddForeignKey
ALTER TABLE "InventoryStateAction" ADD CONSTRAINT "InventoryStateAction_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStateAction" ADD CONSTRAINT "InventoryStateAction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStateAction" ADD CONSTRAINT "InventoryStateAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
