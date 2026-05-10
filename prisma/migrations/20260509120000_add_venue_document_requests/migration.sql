CREATE TYPE "VenueDocumentStatus" AS ENUM ('PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED');

CREATE TABLE "venue_document_requests" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "status" "VenueDocumentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "documents" JSONB NOT NULL,
    "ownerNotes" TEXT,
    "reviewNotes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venue_document_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "venue_document_requests_ownerId_idx" ON "venue_document_requests"("ownerId");
CREATE INDEX "venue_document_requests_venueId_idx" ON "venue_document_requests"("venueId");
CREATE INDEX "venue_document_requests_status_idx" ON "venue_document_requests"("status");

ALTER TABLE "venue_document_requests" ADD CONSTRAINT "venue_document_requests_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "venue_document_requests" ADD CONSTRAINT "venue_document_requests_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
