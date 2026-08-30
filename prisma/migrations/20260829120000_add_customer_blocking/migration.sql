ALTER TABLE "users"
  ADD COLUMN "customerBlockedAt" TIMESTAMP(3),
  ADD COLUMN "customerBlockedReason" TEXT;

CREATE INDEX "users_customerBlockedAt_idx" ON "users"("customerBlockedAt");
