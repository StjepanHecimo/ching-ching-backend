CREATE TABLE "phone_verification_codes" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "phone_verification_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "phone_verification_codes_codeHash_key" ON "phone_verification_codes"("codeHash");
CREATE INDEX "phone_verification_codes_userId_idx" ON "phone_verification_codes"("userId");
CREATE INDEX "phone_verification_codes_phoneNumber_idx" ON "phone_verification_codes"("phoneNumber");
CREATE INDEX "phone_verification_codes_expiresAt_idx" ON "phone_verification_codes"("expiresAt");
CREATE INDEX "phone_verification_codes_usedAt_idx" ON "phone_verification_codes"("usedAt");

ALTER TABLE "phone_verification_codes" ADD CONSTRAINT "phone_verification_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
