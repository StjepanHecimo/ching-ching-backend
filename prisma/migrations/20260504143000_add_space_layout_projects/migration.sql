-- CreateEnum
CREATE TYPE "SpaceLayoutStatus" AS ENUM ('DRAFT', 'AI_SUGGESTED', 'SAVED');

-- CreateTable
CREATE TABLE "space_layout_projects" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT,
    "status" "SpaceLayoutStatus" NOT NULL DEFAULT 'DRAFT',
    "photos" JSONB NOT NULL,
    "space" JSONB NOT NULL,
    "aiSuggestion" JSONB,
    "savedLayout" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "space_layout_projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "space_layout_projects_ownerId_idx" ON "space_layout_projects"("ownerId");

-- CreateIndex
CREATE INDEX "space_layout_projects_venueId_idx" ON "space_layout_projects"("venueId");

-- CreateIndex
CREATE INDEX "space_layout_projects_status_idx" ON "space_layout_projects"("status");

-- AddForeignKey
ALTER TABLE "space_layout_projects" ADD CONSTRAINT "space_layout_projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_layout_projects" ADD CONSTRAINT "space_layout_projects_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
