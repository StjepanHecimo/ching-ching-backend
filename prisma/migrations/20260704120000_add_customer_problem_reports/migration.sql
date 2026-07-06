-- CreateEnum
CREATE TYPE "CustomerProblemReportStatus" AS ENUM ('PENDING', 'REFUNDED_BY_CHIN_CHIN', 'CLOSED_NO_REFUND');

-- CreateTable
CREATE TABLE "customer_problem_reports" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "paymentId" TEXT,
    "venueId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" "CustomerProblemReportStatus" NOT NULL DEFAULT 'PENDING',
    "problemDescription" TEXT NOT NULL,
    "photo" JSONB NOT NULL,
    "resolutionAmountCents" INTEGER,
    "resolutionCurrency" TEXT,
    "adminNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_problem_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_problem_reports_reservationId_idx" ON "customer_problem_reports"("reservationId");
CREATE INDEX "customer_problem_reports_paymentId_idx" ON "customer_problem_reports"("paymentId");
CREATE INDEX "customer_problem_reports_venueId_idx" ON "customer_problem_reports"("venueId");
CREATE INDEX "customer_problem_reports_customerId_idx" ON "customer_problem_reports"("customerId");
CREATE INDEX "customer_problem_reports_status_idx" ON "customer_problem_reports"("status");

-- AddForeignKey
ALTER TABLE "customer_problem_reports" ADD CONSTRAINT "customer_problem_reports_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_problem_reports" ADD CONSTRAINT "customer_problem_reports_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "reservation_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_problem_reports" ADD CONSTRAINT "customer_problem_reports_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_problem_reports" ADD CONSTRAINT "customer_problem_reports_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
