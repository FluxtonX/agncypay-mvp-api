-- CreateEnum
CREATE TYPE "LedgerAccountPurpose" AS ENUM ('general', 'provider_cash', 'settlement_clearing', 'talent_ap_balance', 'withdrawal_clearing', 'fee_revenue', 'fx_position');

-- CreateEnum
CREATE TYPE "LedgerAccountStatus" AS ENUM ('active', 'frozen', 'closed');

-- CreateEnum
CREATE TYPE "LedgerTransactionStatus" AS ENUM ('pending', 'posted', 'reversed');

-- CreateEnum
CREATE TYPE "LedgerPostingSide" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "TalentBalanceLotStatus" AS ENUM ('pending', 'available', 'held', 'partially_withdrawn', 'withdrawn', 'reversed');

-- CreateEnum
CREATE TYPE "TalentBalanceEventType" AS ENUM ('credited', 'held', 'released', 'withdrawal_reserved', 'withdrawal_settled', 'withdrawal_failed', 'reversed');

-- AlterTable
ALTER TABLE "ledger_accounts" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "participantId" TEXT,
ADD COLUMN     "purpose" "LedgerAccountPurpose" NOT NULL DEFAULT 'general',
ADD COLUMN     "status" "LedgerAccountStatus" NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "status" "LedgerTransactionStatus" NOT NULL DEFAULT 'posted',
    "currency" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT,
    "paymentInstructionId" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "postedAt" TIMESTAMP(3),
    "reversalOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_postings" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "side" "LedgerPostingSide" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "talent_balance_lots" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "paymentInstructionId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "originalAmount" DECIMAL(18,4) NOT NULL,
    "availableAmount" DECIMAL(18,4) NOT NULL,
    "heldAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "withdrawnAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "TalentBalanceLotStatus" NOT NULL DEFAULT 'pending',
    "availableAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "talent_balance_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "talent_balance_events" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "eventType" "TalentBalanceEventType" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "availableAfter" DECIMAL(18,4) NOT NULL,
    "heldAfter" DECIMAL(18,4) NOT NULL,
    "withdrawnAfter" DECIMAL(18,4) NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "talent_balance_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_idempotencyKey_key" ON "ledger_transactions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_reversalOfId_key" ON "ledger_transactions"("reversalOfId");

-- CreateIndex
CREATE INDEX "ledger_transactions_paymentInstructionId_status_idx" ON "ledger_transactions"("paymentInstructionId", "status");

-- CreateIndex
CREATE INDEX "ledger_transactions_referenceType_referenceId_idx" ON "ledger_transactions"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "ledger_transactions_status_createdAt_idx" ON "ledger_transactions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_postings_accountId_side_idx" ON "ledger_postings"("accountId", "side");

-- CreateIndex
CREATE INDEX "ledger_postings_transactionId_idx" ON "ledger_postings"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "talent_balance_lots_paymentInstructionId_key" ON "talent_balance_lots"("paymentInstructionId");

-- CreateIndex
CREATE INDEX "talent_balance_lots_participantId_currency_status_idx" ON "talent_balance_lots"("participantId", "currency", "status");

-- CreateIndex
CREATE UNIQUE INDEX "talent_balance_events_idempotencyKey_key" ON "talent_balance_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX "talent_balance_events_lotId_createdAt_idx" ON "talent_balance_events"("lotId", "createdAt");

-- CreateIndex
CREATE INDEX "talent_balance_events_referenceType_referenceId_idx" ON "talent_balance_events"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "ledger_accounts_organizationId_purpose_currency_idx" ON "ledger_accounts"("organizationId", "purpose", "currency");

-- CreateIndex
CREATE INDEX "ledger_accounts_participantId_purpose_currency_idx" ON "ledger_accounts"("participantId", "purpose", "currency");

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_paymentInstructionId_fkey" FOREIGN KEY ("paymentInstructionId") REFERENCES "payment_instructions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "talent_balance_lots" ADD CONSTRAINT "talent_balance_lots_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "talent_balance_lots" ADD CONSTRAINT "talent_balance_lots_paymentInstructionId_fkey" FOREIGN KEY ("paymentInstructionId") REFERENCES "payment_instructions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "talent_balance_events" ADD CONSTRAINT "talent_balance_events_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "talent_balance_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Canonical money invariants.
ALTER TABLE "ledger_transactions"
  ADD CONSTRAINT "ledger_transactions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "ledger_postings"
  ADD CONSTRAINT "ledger_postings_positive_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "ledger_postings_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "talent_balance_lots"
  ADD CONSTRAINT "talent_balance_lots_nonnegative_check" CHECK ("originalAmount" > 0 AND "availableAmount" >= 0 AND "heldAmount" >= 0 AND "withdrawnAmount" >= 0),
  ADD CONSTRAINT "talent_balance_lots_conservation_check" CHECK ("originalAmount" = "availableAmount" + "heldAmount" + "withdrawnAmount"),
  ADD CONSTRAINT "talent_balance_lots_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "talent_balance_events"
  ADD CONSTRAINT "talent_balance_events_positive_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "talent_balance_events_nonnegative_after_check" CHECK ("availableAfter" >= 0 AND "heldAfter" >= 0 AND "withdrawnAfter" >= 0);

CREATE UNIQUE INDEX "ledger_accounts_participant_purpose_currency_key"
  ON "ledger_accounts" ("participantId", "purpose", "currency")
  WHERE "participantId" IS NOT NULL;
CREATE UNIQUE INDEX "ledger_accounts_organization_purpose_currency_key"
  ON "ledger_accounts" ("organizationId", "purpose", "currency")
  WHERE "organizationId" IS NOT NULL AND "participantId" IS NULL;

