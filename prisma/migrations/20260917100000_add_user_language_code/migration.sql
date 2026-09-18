ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "languageCode" TEXT NOT NULL DEFAULT 'hr';

UPDATE "users"
SET "languageCode" = 'hr'
WHERE "languageCode" IS NULL OR "languageCode" NOT IN ('hr', 'en');
