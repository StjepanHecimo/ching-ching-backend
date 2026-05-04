-- AlterEnum
ALTER TYPE "SpaceLayoutStatus" ADD VALUE 'PENDING_CHIN_CHIN_REVIEW';
ALTER TYPE "SpaceLayoutStatus" ADD VALUE 'CHIN_CHIN_CHANGES_REQUESTED';
ALTER TYPE "SpaceLayoutStatus" ADD VALUE 'APPROVED';

-- AlterTable
ALTER TABLE "space_layout_projects" ADD COLUMN "reviewSubmission" JSONB;
ALTER TABLE "space_layout_projects" ADD COLUMN "approvedAt" TIMESTAMP(3);
