-- CreateEnum
CREATE TYPE "ShoppingTripStatus" AS ENUM ('DRAFT', 'SHOPPING', 'RESTOCKED');

-- CreateEnum
CREATE TYPE "ShoppingEntryStatus" AS ENUM ('PENDING', 'PURCHASED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ShoppingEntrySource" AS ENUM ('SUGGESTED', 'MANUAL');

-- CreateEnum
CREATE TYPE "ShoppingEntryPriority" AS ENUM ('MUST_BUY', 'SHOULD_BUY', 'OPTIONAL');

-- CreateTable
CREATE TABLE "ShoppingTrip" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "plannedDate" DATE NOT NULL,
    "status" "ShoppingTripStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ShoppingTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingEntry" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "status" "ShoppingEntryStatus" NOT NULL DEFAULT 'PENDING',
    "source" "ShoppingEntrySource" NOT NULL,
    "priority" "ShoppingEntryPriority" NOT NULL,
    "suggestedQuantity" DECIMAL(18,6),
    "suggestedReason" TEXT,
    "actualQuantity" DECIMAL(18,6),
    "expiryDate" DATE,

    CONSTRAINT "ShoppingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShoppingTrip_householdId_createdAt_idx" ON "ShoppingTrip"("householdId", "createdAt");

-- CreateIndex
CREATE INDEX "ShoppingEntry_itemId_idx" ON "ShoppingEntry"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ShoppingEntry_tripId_itemId_key" ON "ShoppingEntry"("tripId", "itemId");

-- AddForeignKey
ALTER TABLE "ShoppingTrip" ADD CONSTRAINT "ShoppingTrip_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingTrip" ADD CONSTRAINT "ShoppingTrip_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingEntry" ADD CONSTRAINT "ShoppingEntry_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "ShoppingTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingEntry" ADD CONSTRAINT "ShoppingEntry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
