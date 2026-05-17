-- CreateEnum
CREATE TYPE "ReservationType" AS ENUM ('ADVANCE', 'LIVE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReservationStatus" ADD VALUE 'RESERVED';
ALTER TYPE "ReservationStatus" ADD VALUE 'CHECK_IN_PENDING';
ALTER TYPE "ReservationStatus" ADD VALUE 'CHECKED_IN';
ALTER TYPE "ReservationStatus" ADD VALUE 'SEATED';
ALTER TYPE "ReservationStatus" ADD VALUE 'CANCELLED_BY_USER';
ALTER TYPE "ReservationStatus" ADD VALUE 'RELEASED';

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "arrivalDeadlineAt" TIMESTAMP(3),
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "checkInClosesAt" TIMESTAMP(3),
ADD COLUMN     "checkInOpensAt" TIMESTAMP(3),
ADD COLUMN     "checkedInAt" TIMESTAMP(3),
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'EUR',
ADD COLUMN     "distanceMeters" DOUBLE PRECISION,
ADD COLUMN     "feeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "seatedAt" TIMESTAMP(3),
ADD COLUMN     "type" "ReservationType" NOT NULL DEFAULT 'ADVANCE',
ADD COLUMN     "userLatitude" DOUBLE PRECISION,
ADD COLUMN     "userLongitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "venues" ADD COLUMN     "isLive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "liveEndedAt" TIMESTAMP(3),
ADD COLUMN     "liveStartedAt" TIMESTAMP(3),
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "venue_chin_chin_panels" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "promotionalDrinks" JSONB NOT NULL,
    "hasDraftBeer" BOOLEAN NOT NULL DEFAULT false,
    "draftBeers" JSONB NOT NULL,
    "hasEvent" BOOLEAN NOT NULL DEFAULT false,
    "eventDay" TEXT,
    "eventStartsAt" TEXT,
    "eventBand" TEXT,
    "eventDescription" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venue_chin_chin_panels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "venue_chin_chin_panels_venueId_key" ON "venue_chin_chin_panels"("venueId");

-- CreateIndex
CREATE INDEX "venue_chin_chin_panels_venueId_idx" ON "venue_chin_chin_panels"("venueId");

-- CreateIndex
CREATE INDEX "venue_chin_chin_panels_hasEvent_idx" ON "venue_chin_chin_panels"("hasEvent");

-- AddForeignKey
ALTER TABLE "venue_chin_chin_panels" ADD CONSTRAINT "venue_chin_chin_panels_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
