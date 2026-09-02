ALTER TABLE "venues"
ADD COLUMN "liveReservationWindowStartMinutes" INTEGER NOT NULL DEFAULT 1080,
ADD COLUMN "liveReservationWindowEndMinutes" INTEGER NOT NULL DEFAULT 1560;
