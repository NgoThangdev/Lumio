-- CreateEnum
CREATE TYPE "ShoppingSection" AS ENUM ('FRESH_FOOD', 'MEAT_SEAFOOD', 'DAIRY', 'PANTRY', 'DRINKS', 'HOUSEHOLD', 'PERSONAL_CARE');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "shoppingSection" "ShoppingSection";
