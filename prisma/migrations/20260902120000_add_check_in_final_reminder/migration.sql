ALTER TABLE "reservations"
ADD COLUMN "checkInFinalReminderSentAt" TIMESTAMP(3);

CREATE INDEX "reservations_checkInFinalReminderSentAt_idx" ON "reservations"("checkInFinalReminderSentAt");
