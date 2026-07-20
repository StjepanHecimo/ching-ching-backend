CREATE TABLE "registration_phone_verification_codes" (
  "id" TEXT NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "tokenHash" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_phone_verification_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "registration_phone_verification_codes_codeHash_key" ON "registration_phone_verification_codes"("codeHash");
CREATE UNIQUE INDEX "registration_phone_verification_codes_tokenHash_key" ON "registration_phone_verification_codes"("tokenHash");
CREATE INDEX "registration_phone_verification_codes_phoneNumber_idx" ON "registration_phone_verification_codes"("phoneNumber");
CREATE INDEX "registration_phone_verification_codes_expiresAt_idx" ON "registration_phone_verification_codes"("expiresAt");
CREATE INDEX "registration_phone_verification_codes_verifiedAt_idx" ON "registration_phone_verification_codes"("verifiedAt");
CREATE INDEX "registration_phone_verification_codes_usedAt_idx" ON "registration_phone_verification_codes"("usedAt");
