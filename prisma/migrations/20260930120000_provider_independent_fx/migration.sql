-- CreateEnum
CREATE TYPE "BalanceReservationType" AS ENUM ('withdrawal', 'fx_conversion');

-- CreateEnum
CREATE TYPE "FxQuoteStatus" AS ENUM ('active', 'consumed', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "FxConversionStatus" AS ENUM ('requested', 'submitted', 'processing', 'settled', 'failed', 'review_required');

-- AlterEnum
ALTER TYPE "PaymentInstructionType" ADD VALUE 'balance_conversion';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TalentBalanceEventType" ADD VALUE 'converted_out';
ALTER TYPE "TalentBalanceEventType" ADD VALUE 'converted_in';
ALTER TYPE "TalentBalanceEventType" ADD VALUE 'conversion_reserved';

ALTER TYPE "TalentBalanceLotStatus" ADD VALUE 'partially_converted';
ALTER TYPE "TalentBalanceLotStatus" ADD VALUE 'converted';

-- AlterTable
ALTER TABLE "talent_balance_lots" ADD COLUMN     "convertedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "talent_balance_events" ADD COLUMN     "convertedAfter" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "talent_withdrawal_reservations" ADD COLUMN     "reservationType" "BalanceReservationType" NOT NULL DEFAULT 'withdrawal';

-- CreateTable
CREATE TABLE "fx_quotes" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerQuoteId" TEXT NOT NULL,
    "sourceCurrency" TEXT NOT NULL,
    "destinationCurrency" TEXT NOT NULL,
    "sourceAmount" DECIMAL(18,4) NOT NULL,
    "destinationAmount" DECIMAL(18,4) NOT NULL,
    "exchangeRate" DECIMAL(24,12) NOT NULL,
    "feeAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "feeCurrency" TEXT NOT NULL,
    "status" "FxQuoteStatus" NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "idempotencyScope" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "providerResponse" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_conversions" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "paymentInstructionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerConversionId" TEXT,
    "status" "FxConversionStatus" NOT NULL DEFAULT 'requested',
    "idempotencyKey" TEXT NOT NULL,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "providerResponse" JSONB NOT NULL DEFAULT '{}',
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fx_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fx_quotes_participantId_status_expiresAt_idx" ON "fx_quotes"("participantId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "fx_quotes_idempotencyScope_idempotencyKey_key" ON "fx_quotes"("idempotencyScope", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "fx_quotes_provider_providerQuoteId_key" ON "fx_quotes"("provider", "providerQuoteId");

-- CreateIndex
CREATE UNIQUE INDEX "fx_conversions_quoteId_key" ON "fx_conversions"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "fx_conversions_paymentInstructionId_key" ON "fx_conversions"("paymentInstructionId");

-- CreateIndex
CREATE UNIQUE INDEX "fx_conversions_idempotencyKey_key" ON "fx_conversions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "fx_conversions_status_createdAt_idx" ON "fx_conversions"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "fx_conversions_provider_providerConversionId_key" ON "fx_conversions"("provider", "providerConversionId");

-- AddForeignKey
ALTER TABLE "fx_quotes" ADD CONSTRAINT "fx_quotes_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_quotes" ADD CONSTRAINT "fx_quotes_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_conversions" ADD CONSTRAINT "fx_conversions_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "fx_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_conversions" ADD CONSTRAINT "fx_conversions_paymentInstructionId_fkey" FOREIGN KEY ("paymentInstructionId") REFERENCES "payment_instructions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "talent_balance_lots"
  DROP CONSTRAINT "talent_balance_lots_conservation_check",
  ADD CONSTRAINT "talent_balance_lots_conservation_check" CHECK ("originalAmount" = "availableAmount" + "heldAmount" + "withdrawnAmount" + "convertedAmount");

ALTER TABLE "fx_quotes"
  ADD CONSTRAINT "fx_quotes_positive_amounts_check" CHECK ("sourceAmount" > 0 AND "destinationAmount" > 0 AND "exchangeRate" > 0 AND "feeAmount" >= 0),
  ADD CONSTRAINT "fx_quotes_currency_check" CHECK ("sourceCurrency" ~ '^[A-Z]{3}$' AND "destinationCurrency" ~ '^[A-Z]{3}$' AND "feeCurrency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "fx_quotes_distinct_currency_check" CHECK ("sourceCurrency" <> "destinationCurrency");

ALTER TABLE "talent_balance_events"
  ADD CONSTRAINT "talent_balance_events_converted_after_check" CHECK ("convertedAfter" >= 0);
