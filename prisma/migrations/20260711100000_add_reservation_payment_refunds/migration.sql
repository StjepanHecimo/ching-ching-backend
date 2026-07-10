CREATE TABLE "reservation_payment_refunds" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "customerId" TEXT,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'WORLDLINE',
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "reason" TEXT NOT NULL,
  "providerPaymentId" TEXT,
  "providerRefundTransactionId" TEXT,
  "providerStatus" TEXT,
  "rawProviderData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "reservation_payment_refunds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reservation_payment_refunds_reservationId_idx" ON "reservation_payment_refunds"("reservationId");
CREATE INDEX "reservation_payment_refunds_paymentId_idx" ON "reservation_payment_refunds"("paymentId");
CREATE INDEX "reservation_payment_refunds_venueId_idx" ON "reservation_payment_refunds"("venueId");
CREATE INDEX "reservation_payment_refunds_providerPaymentId_idx" ON "reservation_payment_refunds"("providerPaymentId");
CREATE INDEX "reservation_payment_refunds_providerRefundTransactionId_idx" ON "reservation_payment_refunds"("providerRefundTransactionId");

ALTER TABLE "reservation_payment_refunds"
  ADD CONSTRAINT "reservation_payment_refunds_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reservation_payment_refunds"
  ADD CONSTRAINT "reservation_payment_refunds_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "reservation_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reservation_payment_refunds"
  ADD CONSTRAINT "reservation_payment_refunds_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reservation_payment_refunds"
  ADD CONSTRAINT "reservation_payment_refunds_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
