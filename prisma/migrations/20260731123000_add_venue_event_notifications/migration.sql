CREATE TABLE "venue_event_notifications" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventDay" TEXT NOT NULL,
    "eventStartsAt" TEXT NOT NULL,
    "eventEndsAt" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venue_event_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "venue_event_notifications_venueId_eventId_key" ON "venue_event_notifications"("venueId", "eventId");
CREATE INDEX "venue_event_notifications_scheduledFor_sentAt_skippedAt_idx" ON "venue_event_notifications"("scheduledFor", "sentAt", "skippedAt");
CREATE INDEX "venue_event_notifications_venueId_idx" ON "venue_event_notifications"("venueId");

ALTER TABLE "venue_event_notifications" ADD CONSTRAINT "venue_event_notifications_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
