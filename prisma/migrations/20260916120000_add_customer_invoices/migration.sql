-- CreateEnum
CREATE TYPE "CustomerInvoiceStatus" AS ENUM ('ISSUED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED');

-- CreateTable
CREATE TABLE "customer_invoices" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "paymentId" TEXT,
    "customerId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "status" "CustomerInvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "documentTitle" TEXT NOT NULL DEFAULT 'Račun za uslugu rezervacije',
    "sellerName" TEXT NOT NULL,
    "sellerOib" TEXT NOT NULL,
    "sellerAddress" TEXT,
    "sellerEmail" TEXT,
    "buyerName" TEXT,
    "buyerEmail" TEXT,
    "itemDescription" TEXT NOT NULL,
    "venueName" TEXT,
    "tableLabel" TEXT,
    "serviceDate" TIMESTAMP(3),
    "amountCents" INTEGER NOT NULL,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "paymentProvider" "PaymentProvider" NOT NULL DEFAULT 'WORLDLINE',
    "providerPaymentId" TEXT,
    "pdfUrl" TEXT,
    "emailedAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMP(3),
    "accountingNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_invoices_invoiceNumber_key" ON "customer_invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "customer_invoices_reservationId_idx" ON "customer_invoices"("reservationId");

-- CreateIndex
CREATE INDEX "customer_invoices_paymentId_idx" ON "customer_invoices"("paymentId");

-- CreateIndex
CREATE INDEX "customer_invoices_customerId_idx" ON "customer_invoices"("customerId");

-- CreateIndex
CREATE INDEX "customer_invoices_status_idx" ON "customer_invoices"("status");

-- CreateIndex
CREATE INDEX "customer_invoices_issuedAt_idx" ON "customer_invoices"("issuedAt");

-- AddForeignKey
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "reservation_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill existing captured customer payments so past paid reservations receive an invoice record.
INSERT INTO "customer_invoices" (
    "id",
    "reservationId",
    "paymentId",
    "customerId",
    "invoiceNumber",
    "status",
    "documentTitle",
    "sellerName",
    "sellerOib",
    "sellerAddress",
    "buyerName",
    "buyerEmail",
    "itemDescription",
    "venueName",
    "tableLabel",
    "serviceDate",
    "amountCents",
    "refundedCents",
    "currency",
    "paymentProvider",
    "providerPaymentId",
    "issuedAt",
    "refundedAt",
    "accountingNotes",
    "createdAt",
    "updatedAt"
)
SELECT
    CONCAT('ci_', rp."id"),
    rp."reservationId",
    rp."id",
    rp."customerId",
    CONCAT('CC-', EXTRACT(YEAR FROM COALESCE(rp."capturedAt", rp."updatedAt"))::INT, '-', UPPER(SUBSTRING(rp."id" FROM 1 FOR 8))),
    CASE
      WHEN rp."refundedCents" >= rp."capturedCents" THEN 'REFUNDED'::"CustomerInvoiceStatus"
      WHEN rp."refundedCents" > 0 THEN 'PARTIALLY_REFUNDED'::"CustomerInvoiceStatus"
      ELSE 'ISSUED'::"CustomerInvoiceStatus"
    END,
    'Račun za uslugu rezervacije',
    'Chin-Chin, obrt za prijevoz i usluge, vl. Stjepan Hećimović',
    '28907046850',
    'Zagreb',
    r."customerName",
    r."customerEmail",
    'Naknada za rezervaciju stola',
    v."name",
    r."tableLabel",
    r."timeSlotStart",
    rp."capturedCents",
    rp."refundedCents",
    rp."currency",
    rp."provider",
    rp."providerPaymentId",
    COALESCE(rp."capturedAt", rp."updatedAt"),
    CASE WHEN rp."refundedCents" > 0 THEN rp."updatedAt" ELSE NULL END,
    'Računovodstveni/fiskalni format i PDF predložak potvrđuje knjigovođa prije produkcije.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "reservation_payments" rp
JOIN "reservations" r ON r."id" = rp."reservationId"
JOIN "venues" v ON v."id" = rp."venueId"
WHERE rp."capturedCents" > 0
  AND rp."status" IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED')
  AND NOT EXISTS (
    SELECT 1 FROM "customer_invoices" ci WHERE ci."paymentId" = rp."id"
  );
