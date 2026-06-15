ALTER TABLE "venues"
ADD COLUMN "profileDescription" TEXT,
ADD COLUMN "profileImages" JSONB NOT NULL DEFAULT '[]';
