ALTER TABLE "venues"
ADD COLUMN "advanceChinChinTableIds" JSONB NOT NULL DEFAULT '[]';

UPDATE "venues"
SET "advanceChinChinTableIds" = "liveChinChinTableIds"
WHERE jsonb_typeof("liveChinChinTableIds") = 'array'
  AND jsonb_array_length("liveChinChinTableIds") > 0;
