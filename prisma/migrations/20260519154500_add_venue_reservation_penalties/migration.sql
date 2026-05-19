CREATE TABLE "venue_reservation_penalties" (
  "id" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "reservationId" TEXT,
  "monthKey" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "venue_reservation_penalties_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "venue_reservation_penalties_venueId_idx" ON "venue_reservation_penalties"("venueId");
CREATE INDEX "venue_reservation_penalties_reservationId_idx" ON "venue_reservation_penalties"("reservationId");
CREATE INDEX "venue_reservation_penalties_venueId_monthKey_idx" ON "venue_reservation_penalties"("venueId", "monthKey");

ALTER TABLE "venue_reservation_penalties"
ADD CONSTRAINT "venue_reservation_penalties_venueId_fkey"
FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
