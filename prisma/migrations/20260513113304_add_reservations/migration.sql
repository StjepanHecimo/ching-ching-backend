-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "customerId" TEXT,
    "tableId" TEXT NOT NULL,
    "tableLabel" TEXT,
    "roomLabel" TEXT,
    "status" "ReservationStatus" NOT NULL DEFAULT 'REQUESTED',
    "partySize" INTEGER NOT NULL,
    "timeSlotStart" TIMESTAMP(3) NOT NULL,
    "timeSlotEnd" TIMESTAMP(3) NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'user-app',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reservations_venueId_idx" ON "reservations"("venueId");

-- CreateIndex
CREATE INDEX "reservations_customerId_idx" ON "reservations"("customerId");

-- CreateIndex
CREATE INDEX "reservations_tableId_idx" ON "reservations"("tableId");

-- CreateIndex
CREATE INDEX "reservations_status_idx" ON "reservations"("status");

-- CreateIndex
CREATE INDEX "reservations_timeSlotStart_idx" ON "reservations"("timeSlotStart");

-- CreateIndex
CREATE INDEX "reservations_timeSlotEnd_idx" ON "reservations"("timeSlotEnd");

-- CreateIndex
CREATE INDEX "reservations_venueId_tableId_timeSlotStart_timeSlotEnd_idx" ON "reservations"("venueId", "tableId", "timeSlotStart", "timeSlotEnd");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
