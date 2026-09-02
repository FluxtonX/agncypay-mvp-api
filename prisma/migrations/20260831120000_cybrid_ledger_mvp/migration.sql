-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('active', 'frozen', 'suspended');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('credit', 'debit');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('brand', 'agency');

-- CreateEnum
CREATE TYPE "WorkspaceType" AS ENUM ('brand', 'agency', 'mother_agency');

-- CreateEnum
CREATE TYPE "VerificationTrack" AS ENUM ('kyb', 'enterprise_kyb');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('draft', 'submitted', 'in_review', 'requires_action', 'approved', 'rejected', 'suspended');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('admin', 'finance', 'approver', 'viewer', 'agency_admin', 'finance_manager', 'super_admin', 'treasury', 'finance_ops');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('active', 'invited', 'requested');

-- CreateEnum
CREATE TYPE "RepresentativeStatus" AS ENUM ('not_started', 'uploaded', 'processing', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "BankDetailStatus" AS ENUM ('not_started', 'uploaded', 'processing', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('not_uploaded', 'uploaded', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('pending', 'processing', 'paid', 'overdue');

-- CreateEnum
CREATE TYPE "KybStatus" AS ENUM ('not_started', 'pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('pending', 'processing', 'disbursed', 'failed', 'returned');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('success', 'failed', 'processing');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('quickbooks', 'xero', 'plaid', 'sage');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('connected', 'disconnected', 'expired');

-- CreateEnum
CREATE TYPE "QuickBooksConnectStatus" AS ENUM ('disconnected', 'connecting', 'connected', 'syncing', 'expired', 'reconnect_required', 'sync_failed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "accountType" "AccountType" NOT NULL,
    "agncyId" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "resetToken" TEXT,
    "resetTokenExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "providerLegalEntityId" TEXT,
    "providerCounterpartyId" TEXT,
    "providerAccountId" TEXT,
    "providerLedgerAccountId" TEXT,
    "kybStatus" "KybStatus" NOT NULL DEFAULT 'not_started',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "type" "WorkspaceType" NOT NULL,
    "name" TEXT NOT NULL,
    "agncyId" TEXT NOT NULL,
    "verificationTrack" "VerificationTrack" NOT NULL DEFAULT 'kyb',
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'draft',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "permissions" TEXT[],
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL DEFAULT '',
    "brandName" TEXT NOT NULL DEFAULT '',
    "businessType" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "registrationNumber" TEXT NOT NULL DEFAULT '',
    "taxId" TEXT,
    "website" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT,
    "industry" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "addressLine1" TEXT NOT NULL DEFAULT '',
    "addressLine2" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "businessState" TEXT NOT NULL DEFAULT '',
    "stateOrProvince" TEXT NOT NULL DEFAULT '',
    "zipCode" TEXT NOT NULL DEFAULT '',
    "postalCode" TEXT NOT NULL DEFAULT '',
    "companyDescription" TEXT NOT NULL DEFAULT '',
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "dob" TEXT NOT NULL DEFAULT '',
    "ssnLast4" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "representatives" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL DEFAULT '',
    "jobTitle" TEXT NOT NULL DEFAULT '',
    "dob" TEXT NOT NULL DEFAULT '',
    "nationality" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "idType" TEXT NOT NULL DEFAULT 'Passport',
    "idFrontUploaded" BOOLEAN NOT NULL DEFAULT false,
    "idBackUploaded" BOOLEAN NOT NULL DEFAULT false,
    "selfieUploaded" BOOLEAN NOT NULL DEFAULT false,
    "status" "RepresentativeStatus" NOT NULL DEFAULT 'not_started',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "representatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorizations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isOwner" BOOLEAN,
    "owns25Percent" BOOLEAN,
    "isAuthorizedForPayments" BOOLEAN,
    "authLetterUploaded" BOOLEAN NOT NULL DEFAULT false,
    "powerOfAttorneyUploaded" BOOLEAN NOT NULL DEFAULT false,
    "signatoryName" TEXT NOT NULL DEFAULT '',
    "signatoryEmail" TEXT NOT NULL DEFAULT '',
    "roleInCompany" TEXT NOT NULL DEFAULT '',
    "formationDate" TEXT NOT NULL DEFAULT '',
    "incorporationState" TEXT NOT NULL DEFAULT '',
    "employeeRange" TEXT NOT NULL DEFAULT '',
    "monthlyPaymentVolume" TEXT NOT NULL DEFAULT '',
    "owners" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_verifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brandName" TEXT NOT NULL DEFAULT '',
    "officialWebsite" TEXT NOT NULL DEFAULT '',
    "officialEmail" TEXT NOT NULL DEFAULT '',
    "domainVerified" BOOLEAN NOT NULL DEFAULT false,
    "trademarkNumber" TEXT NOT NULL DEFAULT '',
    "brandCategory" TEXT NOT NULL DEFAULT '',
    "logoUploaded" BOOLEAN NOT NULL DEFAULT false,
    "brandProofUploaded" BOOLEAN NOT NULL DEFAULT false,
    "trademarkCertUploaded" BOOLEAN NOT NULL DEFAULT false,
    "distributorContractUploaded" BOOLEAN NOT NULL DEFAULT false,
    "authLetterUploaded" BOOLEAN NOT NULL DEFAULT false,
    "domainVerificationCode" TEXT NOT NULL DEFAULT '123456',
    "domainCodeSent" BOOLEAN NOT NULL DEFAULT false,
    "domainCodeAttempts" INTEGER NOT NULL DEFAULT 0,
    "emailDomainWarning" BOOLEAN NOT NULL DEFAULT false,
    "status" "VerificationStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "brand_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_details" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL DEFAULT '',
    "bankName" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "accountNumber" TEXT NOT NULL DEFAULT '',
    "routingNumber" TEXT NOT NULL DEFAULT '',
    "bankAddress" TEXT NOT NULL DEFAULT '',
    "statementUploaded" BOOLEAN NOT NULL DEFAULT false,
    "holderNameWarning" BOOLEAN NOT NULL DEFAULT false,
    "plaidAccessToken" TEXT,
    "plaidAccountId" TEXT,
    "plaidItemId" TEXT,
    "status" "BankDetailStatus" NOT NULL DEFAULT 'not_started',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "bank_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'not_uploaded',
    "fileUrl" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "campaign" TEXT NOT NULL DEFAULT '',
    "agencyId" TEXT NOT NULL,
    "agencyEmail" TEXT NOT NULL,
    "agencyWalletId" TEXT,
    "brandId" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "brandEmail" TEXT NOT NULL,
    "brandWalletId" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "due" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'pending',
    "payoutStatus" "PayoutStatus" NOT NULL DEFAULT 'pending',
    "createdDate" TEXT NOT NULL,
    "payerId" TEXT NOT NULL DEFAULT '',
    "payerEmail" TEXT NOT NULL DEFAULT '',
    "payerAddress" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "splits" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentMethod" TEXT NOT NULL DEFAULT '',
    "paymentOrderId" TEXT,
    "counterpartyId" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'processing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_treasuries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0.0,
    "lastDepositAmount" DECIMAL(18,4),
    "lastDepositMethod" TEXT,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "brand_treasuries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "accessToken" TEXT NOT NULL DEFAULT '',
    "refreshToken" TEXT NOT NULL DEFAULT '',
    "realmId" TEXT,
    "tenantId" TEXT,
    "itemId" TEXT,
    "institutionName" TEXT,
    "expiresAt" TIMESTAMP(3),
    "status" "IntegrationStatus" NOT NULL DEFAULT 'disconnected',
    "connectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "cybrid_customers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cybridCustomerGuid" TEXT NOT NULL,
    "customerType" TEXT NOT NULL DEFAULT 'business',
    "kybStatus" TEXT NOT NULL DEFAULT 'not_started',
    "kybVerificationGuid" TEXT,
    "kybOutcome" TEXT,
    "cybridBankGuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cybrid_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cybrid_accounts" (
    "id" TEXT NOT NULL,
    "cybridCustomerId" TEXT NOT NULL,
    "cybridAccountGuid" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cybrid_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cybrid_deposit_bank_accounts" (
    "id" TEXT NOT NULL,
    "cybridAccountId" TEXT NOT NULL,
    "cybridDepositBankGuid" TEXT NOT NULL,
    "uniqueMemoId" TEXT,
    "routingNumberType" TEXT,
    "routingNumber" TEXT,
    "accountNumber" TEXT,
    "bankName" TEXT,
    "label" TEXT,
    "depositType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cybrid_deposit_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cybrid_counterparties" (
    "id" TEXT NOT NULL,
    "cybridCustomerId" TEXT NOT NULL,
    "cybridCounterpartyGuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "counterpartyType" TEXT NOT NULL DEFAULT 'individual',
    "talentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'storing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cybrid_counterparties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cybrid_external_bank_accounts" (
    "id" TEXT NOT NULL,
    "cybridCounterpartyId" TEXT,
    "cybridExternalBankGuid" TEXT NOT NULL,
    "customerGuid" TEXT,
    "asset" TEXT NOT NULL DEFAULT 'USD',
    "accountKind" TEXT,
    "bankName" TEXT,
    "mask" TEXT,
    "plaidInstitutionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'storing',
    "failureCode" TEXT,
    "agencyUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cybrid_external_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "talents" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "isInternational" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "talents_pkey" PRIMARY KEY ("id")
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
    "cybridTransferGuid" TEXT,
    "cybridDepositRef" TEXT,
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
    "cybridQuoteGuid" TEXT,
    "cybridTransferGuid" TEXT,
    "cybridTradeGuid" TEXT,
    "cybridPlanGuid" TEXT,
    "cybridExecutionGuid" TEXT,
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
    "provider" TEXT NOT NULL DEFAULT 'cybrid',
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
    "cybridState" TEXT,
    "internalState" TEXT,
    "cybridAmount" DECIMAL(18,4),
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
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_agncyId_key" ON "users"("agncyId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_walletId_key" ON "wallets"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_agncyId_key" ON "workspaces"("agncyId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_workspaceId_key" ON "memberships"("userId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "business_profiles_userId_key" ON "business_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "representatives_userId_key" ON "representatives"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "authorizations_userId_key" ON "authorizations"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "brand_verifications_userId_key" ON "brand_verifications"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_details_userId_key" ON "bank_details"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "agency_external_accounts_providerExternalAccountId_key" ON "agency_external_accounts"("providerExternalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_paymentOrderId_key" ON "payouts"("paymentOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_eventId_key" ON "webhook_events"("eventId");

-- CreateIndex
CREATE INDEX "webhook_events_eventId_eventType_idx" ON "webhook_events"("eventId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "brand_treasuries_userId_key" ON "brand_treasuries"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_userId_provider_key" ON "integration_connections"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- CreateIndex
CREATE UNIQUE INDEX "quickbooks_connections_agencyId_key" ON "quickbooks_connections"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "quickbooks_invoices_agencyId_quickbooksInvoiceId_key" ON "quickbooks_invoices"("agencyId", "quickbooksInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "cybrid_customers_userId_key" ON "cybrid_customers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cybrid_customers_cybridCustomerGuid_key" ON "cybrid_customers"("cybridCustomerGuid");

-- CreateIndex
CREATE UNIQUE INDEX "cybrid_accounts_cybridAccountGuid_key" ON "cybrid_accounts"("cybridAccountGuid");

-- CreateIndex
CREATE INDEX "cybrid_accounts_cybridCustomerId_accountType_asset_idx" ON "cybrid_accounts"("cybridCustomerId", "accountType", "asset");

-- CreateIndex
CREATE UNIQUE INDEX "cybrid_deposit_bank_accounts_cybridDepositBankGuid_key" ON "cybrid_deposit_bank_accounts"("cybridDepositBankGuid");

-- CreateIndex
CREATE INDEX "cybrid_deposit_bank_accounts_cybridAccountId_idx" ON "cybrid_deposit_bank_accounts"("cybridAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "cybrid_counterparties_cybridCounterpartyGuid_key" ON "cybrid_counterparties"("cybridCounterpartyGuid");

-- CreateIndex
CREATE UNIQUE INDEX "cybrid_external_bank_accounts_cybridExternalBankGuid_key" ON "cybrid_external_bank_accounts"("cybridExternalBankGuid");

-- CreateIndex
CREATE UNIQUE INDEX "payments_paymentNumber_key" ON "payments"("paymentNumber");

-- CreateIndex
CREATE INDEX "payments_agencyId_status_idx" ON "payments"("agencyId", "status");

-- CreateIndex
CREATE INDEX "payments_brandId_status_idx" ON "payments"("brandId", "status");

-- CreateIndex
CREATE INDEX "payments_cybridTransferGuid_idx" ON "payments"("cybridTransferGuid");

-- CreateIndex
CREATE UNIQUE INDEX "payment_payouts_payoutNumber_key" ON "payment_payouts"("payoutNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payment_payouts_idempotencyKey_key" ON "payment_payouts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_payouts_agencyId_status_idx" ON "payment_payouts"("agencyId", "status");

-- CreateIndex
CREATE INDEX "payment_payouts_talentId_idx" ON "payment_payouts"("talentId");

-- CreateIndex
CREATE INDEX "payment_payouts_cybridTransferGuid_idx" ON "payment_payouts"("cybridTransferGuid");

-- CreateIndex
CREATE INDEX "payment_payouts_cybridTradeGuid_idx" ON "payment_payouts"("cybridTradeGuid");

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
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledgers" ADD CONSTRAINT "wallet_ledgers_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "representatives" ADD CONSTRAINT "representatives_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_verifications" ADD CONSTRAINT "brand_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_details" ADD CONSTRAINT "bank_details_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_agencyWalletId_fkey" FOREIGN KEY ("agencyWalletId") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_brandWalletId_fkey" FOREIGN KEY ("brandWalletId") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_external_accounts" ADD CONSTRAINT "agency_external_accounts_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_treasuries" ADD CONSTRAINT "brand_treasuries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quickbooks_connections" ADD CONSTRAINT "quickbooks_connections_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quickbooks_invoices" ADD CONSTRAINT "quickbooks_invoices_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cybrid_customers" ADD CONSTRAINT "cybrid_customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cybrid_accounts" ADD CONSTRAINT "cybrid_accounts_cybridCustomerId_fkey" FOREIGN KEY ("cybridCustomerId") REFERENCES "cybrid_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cybrid_deposit_bank_accounts" ADD CONSTRAINT "cybrid_deposit_bank_accounts_cybridAccountId_fkey" FOREIGN KEY ("cybridAccountId") REFERENCES "cybrid_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cybrid_counterparties" ADD CONSTRAINT "cybrid_counterparties_cybridCustomerId_fkey" FOREIGN KEY ("cybridCustomerId") REFERENCES "cybrid_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cybrid_counterparties" ADD CONSTRAINT "cybrid_counterparties_talentId_fkey" FOREIGN KEY ("talentId") REFERENCES "talents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cybrid_external_bank_accounts" ADD CONSTRAINT "cybrid_external_bank_accounts_cybridCounterpartyId_fkey" FOREIGN KEY ("cybridCounterpartyId") REFERENCES "cybrid_counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "talents" ADD CONSTRAINT "talents_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_payouts" ADD CONSTRAINT "payment_payouts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_payouts" ADD CONSTRAINT "payment_payouts_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_payouts" ADD CONSTRAINT "payment_payouts_talentId_fkey" FOREIGN KEY ("talentId") REFERENCES "talents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_operations" ADD CONSTRAINT "provider_operations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_operations" ADD CONSTRAINT "provider_operations_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payment_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

