CREATE TYPE "CustomerPaymentMethodStatus" AS ENUM (
  'ACTIVE',
  'DISABLED',
  'EXPIRED'
);

CREATE TABLE "customer_payment_methods" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'WORLDLINE',
  "status" "CustomerPaymentMethodStatus" NOT NULL DEFAULT 'ACTIVE',
  "providerPaymentMethodId" TEXT NOT NULL,
  "brand" TEXT,
  "last4" TEXT,
  "expiryMonth" INTEGER,
  "expiryYear" INTEGER,
  "holderName" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "rawProviderData" JSONB,
  "lastUsedAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "customer_payment_methods_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "reservation_payments"
  ADD COLUMN "paymentMethodId" TEXT;

CREATE UNIQUE INDEX "customer_payment_methods_providerPaymentMethodId_key"
  ON "customer_payment_methods"("providerPaymentMethodId");
CREATE INDEX "customer_payment_methods_customerId_idx"
  ON "customer_payment_methods"("customerId");
CREATE INDEX "customer_payment_methods_provider_idx"
  ON "customer_payment_methods"("provider");
CREATE INDEX "customer_payment_methods_status_idx"
  ON "customer_payment_methods"("status");
CREATE INDEX "reservation_payments_paymentMethodId_idx"
  ON "reservation_payments"("paymentMethodId");

ALTER TABLE "customer_payment_methods"
  ADD CONSTRAINT "customer_payment_methods_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reservation_payments"
  ADD CONSTRAINT "reservation_payments_paymentMethodId_fkey"
  FOREIGN KEY ("paymentMethodId") REFERENCES "customer_payment_methods"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
