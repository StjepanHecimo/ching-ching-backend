CREATE TYPE "PaymentProvider" AS ENUM ('WORLDLINE', 'MOCK');

CREATE TYPE "ReservationPaymentStatus" AS ENUM (
  'AUTH_PENDING',
  'AUTHORIZED',
  'AUTH_FAILED',
  'CAPTURE_PENDING',
  'CAPTURED',
  'CAPTURE_FAILED',
  'VOID_PENDING',
  'VOIDED',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'REFUND_FAILED',
  'FAILED'
);

CREATE TYPE "PaymentWebhookStatus" AS ENUM (
  'RECEIVED',
  'PROCESSED',
  'IGNORED',
  'FAILED'
);

CREATE TYPE "LedgerEntryType" AS ENUM (
  'CUSTOMER_CAPTURE',
  'CHIN_CHIN_FEE',
  'VENUE_SHARE',
  'CUSTOMER_REFUND',
  'PAYMENT_VOID',
  'VENUE_PAYOUT_ADJUSTMENT',
  'CHARGEBACK'
);

CREATE TYPE "LedgerEntryDirection" AS ENUM ('CREDIT', 'DEBIT');

CREATE TYPE "VenuePayoutStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'PAID',
  'CANCELLED'
);

CREATE TABLE "reservation_payments" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "customerId" TEXT,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'WORLDLINE',
  "status" "ReservationPaymentStatus" NOT NULL DEFAULT 'AUTH_PENDING',
  "amountCents" INTEGER NOT NULL,
  "capturedCents" INTEGER NOT NULL DEFAULT 0,
  "refundedCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "providerPaymentId" TEXT,
  "providerCheckoutId" TEXT,
  "providerMerchantReference" TEXT,
  "checkoutUrl" TEXT,
  "checkoutExpiresAt" TIMESTAMP(3),
  "authorizedAt" TIMESTAMP(3),
  "capturedAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "rawProviderData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "reservation_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_entries" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT,
  "paymentId" TEXT,
  "venueId" TEXT,
  "customerId" TEXT,
  "payoutBatchId" TEXT,
  "type" "LedgerEntryType" NOT NULL,
  "direction" "LedgerEntryDirection" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "description" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_webhook_events" (
  "id" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'WORLDLINE',
  "providerEventId" TEXT,
  "eventType" TEXT,
  "status" "PaymentWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
  "payload" JSONB NOT NULL,
  "processedAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "venue_payout_batches" (
  "id" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "status" "VenuePayoutStatus" NOT NULL DEFAULT 'PENDING',
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "grossCents" INTEGER NOT NULL DEFAULT 0,
  "chinChinFeeCents" INTEGER NOT NULL DEFAULT 0,
  "venueShareCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "notes" TEXT,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "venue_payout_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reservation_payments_providerMerchantReference_key"
  ON "reservation_payments"("providerMerchantReference");
CREATE INDEX "reservation_payments_reservationId_idx" ON "reservation_payments"("reservationId");
CREATE INDEX "reservation_payments_venueId_idx" ON "reservation_payments"("venueId");
CREATE INDEX "reservation_payments_customerId_idx" ON "reservation_payments"("customerId");
CREATE INDEX "reservation_payments_status_idx" ON "reservation_payments"("status");
CREATE INDEX "reservation_payments_providerPaymentId_idx" ON "reservation_payments"("providerPaymentId");

CREATE INDEX "ledger_entries_reservationId_idx" ON "ledger_entries"("reservationId");
CREATE INDEX "ledger_entries_paymentId_idx" ON "ledger_entries"("paymentId");
CREATE INDEX "ledger_entries_venueId_idx" ON "ledger_entries"("venueId");
CREATE INDEX "ledger_entries_customerId_idx" ON "ledger_entries"("customerId");
CREATE INDEX "ledger_entries_payoutBatchId_idx" ON "ledger_entries"("payoutBatchId");
CREATE INDEX "ledger_entries_type_idx" ON "ledger_entries"("type");

CREATE UNIQUE INDEX "payment_webhook_events_provider_providerEventId_key"
  ON "payment_webhook_events"("provider", "providerEventId");
CREATE INDEX "payment_webhook_events_provider_idx" ON "payment_webhook_events"("provider");
CREATE INDEX "payment_webhook_events_status_idx" ON "payment_webhook_events"("status");

CREATE INDEX "venue_payout_batches_venueId_idx" ON "venue_payout_batches"("venueId");
CREATE INDEX "venue_payout_batches_status_idx" ON "venue_payout_batches"("status");
CREATE INDEX "venue_payout_batches_periodStart_periodEnd_idx"
  ON "venue_payout_batches"("periodStart", "periodEnd");

ALTER TABLE "reservation_payments"
  ADD CONSTRAINT "reservation_payments_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "reservations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reservation_payments"
  ADD CONSTRAINT "reservation_payments_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "venues"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reservation_payments"
  ADD CONSTRAINT "reservation_payments_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "reservations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "reservation_payments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "venues"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_payoutBatchId_fkey"
  FOREIGN KEY ("payoutBatchId") REFERENCES "venue_payout_batches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "venue_payout_batches"
  ADD CONSTRAINT "venue_payout_batches_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "venues"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
