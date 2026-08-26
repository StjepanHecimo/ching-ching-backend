DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Venue'
      AND column_name = 'livePricingBoost'
  ) THEN
    UPDATE "Venue"
    SET "livePricingBoost" = CASE
      WHEN "livePricingBoost" IN ('X2', 'X3', 'X4', 'X5', 'PREMIUM') THEN 'PREMIUM'
      ELSE 'DEFAULT'
    END;

    ALTER TABLE "Venue"
    ALTER COLUMN "livePricingBoost" SET DEFAULT 'DEFAULT';
  ELSE
    ALTER TABLE "Venue"
    ADD COLUMN "livePricingBoost" TEXT NOT NULL DEFAULT 'DEFAULT';
  END IF;
END $$;
