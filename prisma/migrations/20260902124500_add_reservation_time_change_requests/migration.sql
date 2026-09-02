CREATE TYPE "ReservationTimeChangeRequestStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED'
);

CREATE TABLE "reservation_time_change_requests" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "customerId" TEXT,
  "status" "ReservationTimeChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedStartAt" TIMESTAMP(3) NOT NULL,
  "requestedEndAt" TIMESTAMP(3) NOT NULL,
  "requestedCheckInOpensAt" TIMESTAMP(3),
  "requestedCheckInClosesAt" TIMESTAMP(3),
  "requestedArrivalDeadlineAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "declinedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "reservation_time_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reservation_time_change_requests_reservationId_idx"
ON "reservation_time_change_requests"("reservationId");

CREATE INDEX "reservation_time_change_requests_venueId_status_idx"
ON "reservation_time_change_requests"("venueId", "status");

CREATE INDEX "reservation_time_change_requests_customerId_status_idx"
ON "reservation_time_change_requests"("customerId", "status");

ALTER TABLE "reservation_time_change_requests"
ADD CONSTRAINT "reservation_time_change_requests_reservationId_fkey"
FOREIGN KEY ("reservationId") REFERENCES "reservations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reservation_time_change_requests"
ADD CONSTRAINT "reservation_time_change_requests_venueId_fkey"
FOREIGN KEY ("venueId") REFERENCES "venues"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reservation_time_change_requests"
ADD CONSTRAINT "reservation_time_change_requests_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
