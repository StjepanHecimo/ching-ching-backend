CREATE TYPE "VenueRefundRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "venue_refund_requests" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "paymentId" TEXT,
  "venueId" TEXT NOT NULL,
  "requestedByOwnerId" TEXT,
  "status" "VenueRefundRequestStatus" NOT NULL DEFAULT 'PENDING',
  "problemDescription" TEXT NOT NULL,
  "adminNotes" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "venue_refund_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "venue_refund_requests_reservationId_idx" ON "venue_refund_requests"("reservationId");
CREATE INDEX "venue_refund_requests_paymentId_idx" ON "venue_refund_requests"("paymentId");
CREATE INDEX "venue_refund_requests_venueId_idx" ON "venue_refund_requests"("venueId");
CREATE INDEX "venue_refund_requests_requestedByOwnerId_idx" ON "venue_refund_requests"("requestedByOwnerId");
CREATE INDEX "venue_refund_requests_status_idx" ON "venue_refund_requests"("status");

ALTER TABLE "venue_refund_requests"
  ADD CONSTRAINT "venue_refund_requests_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "venue_refund_requests"
  ADD CONSTRAINT "venue_refund_requests_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "reservation_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "venue_refund_requests"
  ADD CONSTRAINT "venue_refund_requests_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "venue_refund_requests"
  ADD CONSTRAINT "venue_refund_requests_requestedByOwnerId_fkey"
  FOREIGN KEY ("requestedByOwnerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
