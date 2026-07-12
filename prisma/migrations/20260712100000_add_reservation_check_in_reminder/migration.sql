ALTER TABLE "reservations"
  ADD COLUMN "checkInReminderSentAt" TIMESTAMP(3);

CREATE INDEX "reservations_checkInReminderSentAt_idx" ON "reservations"("checkInReminderSentAt");
