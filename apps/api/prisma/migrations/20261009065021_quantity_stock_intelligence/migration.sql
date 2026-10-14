-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "buyThreshold" DECIMAL(18,6),
ADD COLUMN     "lowStockThreshold" DECIMAL(18,6),
ADD COLUMN     "minimumStock" DECIMAL(18,6),
ADD COLUMN     "neverRunOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "predictionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "targetStock" DECIMAL(18,6);
