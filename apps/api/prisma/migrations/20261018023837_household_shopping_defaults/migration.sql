-- AlterTable
ALTER TABLE "Household" ADD COLUMN     "defaultShoppingCycleDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "defaultStore" VARCHAR(120);
