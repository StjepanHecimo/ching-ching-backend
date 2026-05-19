ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'PENDING_VENUE_CONFIRMATION';
ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'DECLINED';
ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TABLE "reservations"
ADD COLUMN IF NOT EXISTS "confirmationExpiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "declinedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "reservations_confirmationExpiresAt_idx" ON "reservations"("confirmationExpiresAt");
