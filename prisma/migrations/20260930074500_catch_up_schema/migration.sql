-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('active', 'frozen', 'suspended');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('credit', 'debit');

-- CreateEnum
CREATE TYPE "KybStatus" AS ENUM ('not_started', 'pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "QuickBooksConnectStatus" AS ENUM ('disconnected', 'connecting', 'connected', 'syncing', 'expired', 'reconnect_required', 'sync_failed');

-- AlterEnum
ALTER TYPE "AccountType" ADD VALUE 'talent';

-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'sage';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PayoutStatus" ADD VALUE 'processing';
ALTER TYPE "PayoutStatus" ADD VALUE 'failed';
ALTER TYPE "PayoutStatus" ADD VALUE 'returned';

-- AlterTable
ALTER TABLE "authorizations" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "bank_details" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "plaidAccessToken" TEXT,
ADD COLUMN     "plaidAccountId" TEXT,
ADD COLUMN     "plaidItemId" TEXT;

-- AlterTable
ALTER TABLE "brand_treasuries" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ALTER COLUMN "balance" SET DEFAULT 0.0,
ALTER COLUMN "balance" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "lastDepositAmount" SET DATA TYPE DECIMAL(18,4);

-- AlterTable
ALTER TABLE "brand_verifications" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "business_profiles" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "integration_connections" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "agencyWalletId" TEXT,
ADD COLUMN     "brandWalletId" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,4);

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "representatives" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "counterpartyId" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "paymentOrderId" TEXT,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,4);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "agencyId" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "kybStatus" "KybStatus" NOT NULL DEFAULT 'not_started',
ADD COLUMN     "providerAccountId" TEXT,
ADD COLUMN     "providerCounterpartyId" TEXT,
ADD COLUMN     "providerLedgerAccountId" TEXT,
ADD COLUMN     "providerLegalEntityId" TEXT,
ADD COLUMN     "resetToken" TEXT,
ADD COLUMN     "resetTokenExpires" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountType" "AccountType" NOT NULL,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0.0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "WalletStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_ledgers" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "balanceAfter" DECIMAL(18,4) NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_external_accounts" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL DEFAULT '',
    "bankName" TEXT NOT NULL DEFAULT '',
    "accountNumberMask" TEXT NOT NULL DEFAULT '',
    "routingNumber" TEXT NOT NULL DEFAULT '',
    "providerExternalAccountId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_external_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "destinationExternalAccountId" TEXT NOT NULL,
    "paymentOrderId" TEXT,
    "status" "PayoutStatus" NOT NULL DEFAULT 'pending',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processed',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "workspaceId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT NOT NULL DEFAULT '',
    "rules" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quickbooks_connections" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "realmId" TEXT,
    "accessToken" TEXT NOT NULL DEFAULT '',
    "refreshToken" TEXT NOT NULL DEFAULT '',
    "tokenExpiry" TIMESTAMP(3),
    "status" "QuickBooksConnectStatus" NOT NULL DEFAULT 'disconnected',
    "connectedAt" TIMESTAMP(3),
    "lastSync" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quickbooks_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quickbooks_invoices" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "quickbooksInvoiceId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "issueDate" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quickbooks_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conduit_customers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conduitCustomerId" TEXT NOT NULL,
    "customerType" TEXT NOT NULL DEFAULT 'business',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "kybStatus" TEXT NOT NULL DEFAULT 'not_started',
    "applicationId" TEXT,
    "country" TEXT DEFAULT 'USA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conduit_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conduit_virtual_accounts" (
    "id" TEXT NOT NULL,
    "conduitCustomerId" TEXT NOT NULL,
    "virtualAccountId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "accountNumber" TEXT,
    "routingNumber" TEXT,
    "bankName" TEXT,
    "beneficiaryName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conduit_virtual_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conduit_wallets" (
    "id" TEXT NOT NULL,
    "conduitCustomerId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isNonCustodial" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conduit_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conduit_recipients" (
    "id" TEXT NOT NULL,
    "conduitCustomerId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "recipientType" TEXT NOT NULL DEFAULT 'individual',
    "talentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "payoutRail" TEXT DEFAULT 'ach',
    "accountNumberMask" TEXT,
    "routingNumber" TEXT,
    "walletAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conduit_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "paymentMethod" TEXT NOT NULL DEFAULT 'ach',
    "conduitPaymentId" TEXT,
    "conduitDepositRef" TEXT,
    "fundedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "failureStage" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_payouts" (
    "id" TEXT NOT NULL,
    "payoutNumber" TEXT NOT NULL,
    "paymentId" TEXT,
    "agencyId" TEXT NOT NULL,
    "talentId" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "payoutType" TEXT NOT NULL DEFAULT 'domestic',
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "conduitPayoutId" TEXT,
    "conduitOrderId" TEXT,
    "conduitQuoteId" TEXT,
    "destinationAccountGuid" TEXT,
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "failureStage" TEXT,
    "fxRate" DECIMAL(18,4),
    "fxFee" DECIMAL(18,4),
    "destinationAmount" DECIMAL(18,4),
    "destinationCurrency" TEXT,
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_operations" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'conduit',
    "operationType" TEXT NOT NULL,
    "operationGuid" TEXT NOT NULL,
    "paymentId" TEXT,
    "payoutId" TEXT,
    "status" TEXT NOT NULL,
    "rawResponse" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "ownerId" TEXT,
    "ownerType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "debitAccountId" TEXT NOT NULL,
    "creditAccountId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'posted',
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT,
    "providerReference" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_records" (
    "id" TEXT NOT NULL,
    "reconciliationType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "providerState" TEXT,
    "internalState" TEXT,
    "providerAmount" DECIMAL(18,4),
    "internalAmount" DECIMAL(18,4),
    "discrepancyType" TEXT,
    "resolution" TEXT DEFAULT 'unresolved',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_walletId_key" ON "wallets"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "agency_external_accounts_providerExternalAccountId_key" ON "agency_external_accounts"("providerExternalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_paymentOrderId_key" ON "payouts"("paymentOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_eventId_key" ON "webhook_events"("eventId");

-- CreateIndex
CREATE INDEX "webhook_events_eventId_eventType_idx" ON "webhook_events"("eventId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- CreateIndex
CREATE UNIQUE INDEX "quickbooks_connections_agencyId_key" ON "quickbooks_connections"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "quickbooks_invoices_agencyId_quickbooksInvoiceId_key" ON "quickbooks_invoices"("agencyId", "quickbooksInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "conduit_customers_userId_key" ON "conduit_customers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "conduit_customers_conduitCustomerId_key" ON "conduit_customers"("conduitCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "conduit_virtual_accounts_virtualAccountId_key" ON "conduit_virtual_accounts"("virtualAccountId");

-- CreateIndex
CREATE INDEX "conduit_virtual_accounts_conduitCustomerId_idx" ON "conduit_virtual_accounts"("conduitCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "conduit_wallets_walletId_key" ON "conduit_wallets"("walletId");

-- CreateIndex
CREATE INDEX "conduit_wallets_conduitCustomerId_chain_idx" ON "conduit_wallets"("conduitCustomerId", "chain");

-- CreateIndex
CREATE UNIQUE INDEX "conduit_recipients_recipientId_key" ON "conduit_recipients"("recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_paymentNumber_key" ON "payments"("paymentNumber");

-- CreateIndex
CREATE INDEX "payments_agencyId_status_idx" ON "payments"("agencyId", "status");

-- CreateIndex
CREATE INDEX "payments_brandId_status_idx" ON "payments"("brandId", "status");

-- CreateIndex
CREATE INDEX "payments_conduitPaymentId_idx" ON "payments"("conduitPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_payouts_payoutNumber_key" ON "payment_payouts"("payoutNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payment_payouts_idempotencyKey_key" ON "payment_payouts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_payouts_agencyId_status_idx" ON "payment_payouts"("agencyId", "status");

-- CreateIndex
CREATE INDEX "payment_payouts_talentId_idx" ON "payment_payouts"("talentId");

-- CreateIndex
CREATE INDEX "payment_payouts_conduitPayoutId_idx" ON "payment_payouts"("conduitPayoutId");

-- CreateIndex
CREATE INDEX "payment_payouts_conduitOrderId_idx" ON "payment_payouts"("conduitOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_operations_provider_operationType_operationGuid_key" ON "provider_operations"("provider", "operationType", "operationGuid");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_accountCode_key" ON "ledger_accounts"("accountCode");

-- CreateIndex
CREATE INDEX "journal_entries_debitAccountId_status_idx" ON "journal_entries"("debitAccountId", "status");

-- CreateIndex
CREATE INDEX "journal_entries_creditAccountId_status_idx" ON "journal_entries"("creditAccountId", "status");

-- CreateIndex
CREATE INDEX "journal_entries_postedAt_idx" ON "journal_entries"("postedAt");

-- CreateIndex
CREATE INDEX "journal_entries_referenceType_referenceId_idx" ON "journal_entries"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "reconciliation_records_resolution_createdAt_idx" ON "reconciliation_records"("resolution", "createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledgers" ADD CONSTRAINT "wallet_ledgers_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_agencyWalletId_fkey" FOREIGN KEY ("agencyWalletId") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_brandWalletId_fkey" FOREIGN KEY ("brandWalletId") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_external_accounts" ADD CONSTRAINT "agency_external_accounts_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quickbooks_connections" ADD CONSTRAINT "quickbooks_connections_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quickbooks_invoices" ADD CONSTRAINT "quickbooks_invoices_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conduit_customers" ADD CONSTRAINT "conduit_customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conduit_virtual_accounts" ADD CONSTRAINT "conduit_virtual_accounts_conduitCustomerId_fkey" FOREIGN KEY ("conduitCustomerId") REFERENCES "conduit_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conduit_wallets" ADD CONSTRAINT "conduit_wallets_conduitCustomerId_fkey" FOREIGN KEY ("conduitCustomerId") REFERENCES "conduit_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conduit_recipients" ADD CONSTRAINT "conduit_recipients_conduitCustomerId_fkey" FOREIGN KEY ("conduitCustomerId") REFERENCES "conduit_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conduit_recipients" ADD CONSTRAINT "conduit_recipients_talentId_fkey" FOREIGN KEY ("talentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_payouts" ADD CONSTRAINT "payment_payouts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_payouts" ADD CONSTRAINT "payment_payouts_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_payouts" ADD CONSTRAINT "payment_payouts_talentId_fkey" FOREIGN KEY ("talentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_operations" ADD CONSTRAINT "provider_operations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_operations" ADD CONSTRAINT "provider_operations_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payment_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
