-- CreateEnum
CREATE TYPE "ChinChinContentType" AS ENUM ('EVENT', 'TV_CONTENT', 'KARAOKE', 'OTHER');

-- AlterTable
ALTER TABLE "venue_chin_chin_panels" ADD COLUMN     "eventContent" JSONB;

-- CreateTable
CREATE TABLE "chin_chin_content_assets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentKey" TEXT NOT NULL,
    "type" "ChinChinContentType" NOT NULL,
    "aliases" JSONB NOT NULL,
    "logoAssetKey" TEXT,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chin_chin_content_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chin_chin_content_assets_contentKey_key" ON "chin_chin_content_assets"("contentKey");

-- CreateIndex
CREATE INDEX "chin_chin_content_assets_type_idx" ON "chin_chin_content_assets"("type");

-- CreateIndex
CREATE INDEX "chin_chin_content_assets_isActive_idx" ON "chin_chin_content_assets"("isActive");
