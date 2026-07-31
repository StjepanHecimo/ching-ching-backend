CREATE TABLE "venue_followers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venue_followers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "venue_followers_userId_venueId_key" ON "venue_followers"("userId", "venueId");
CREATE INDEX "venue_followers_userId_idx" ON "venue_followers"("userId");
CREATE INDEX "venue_followers_venueId_idx" ON "venue_followers"("venueId");

ALTER TABLE "venue_followers" ADD CONSTRAINT "venue_followers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "venue_followers" ADD CONSTRAINT "venue_followers_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
