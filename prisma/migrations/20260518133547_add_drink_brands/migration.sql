-- CreateEnum
CREATE TYPE "DrinkBrandType" AS ENUM ('GIN', 'WHISKEY', 'DRAFT_BEER', 'BEER', 'COCKTAIL', 'WINE', 'OTHER');

-- CreateTable
CREATE TABLE "drink_brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandKey" TEXT NOT NULL,
    "type" "DrinkBrandType" NOT NULL,
    "aliases" JSONB NOT NULL,
    "logoAssetKey" TEXT,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drink_brands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drink_brands_brandKey_key" ON "drink_brands"("brandKey");

-- CreateIndex
CREATE INDEX "drink_brands_type_idx" ON "drink_brands"("type");

-- CreateIndex
CREATE INDEX "drink_brands_isActive_idx" ON "drink_brands"("isActive");
