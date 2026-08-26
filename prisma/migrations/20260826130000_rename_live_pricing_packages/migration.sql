UPDATE "Venue"
SET "livePricingBoost" = CASE
  WHEN "livePricingBoost" IN ('X2', 'X3', 'X4', 'X5', 'PREMIUM') THEN 'PREMIUM'
  ELSE 'DEFAULT'
END;

ALTER TABLE "Venue"
ALTER COLUMN "livePricingBoost" SET DEFAULT 'DEFAULT';
