-- This migration intentionally destroys the retired prototype storage.
-- The canonical runtime uses organization/participant identities, source
-- connections, commercial documents, payment instructions, the double-entry
-- ledger, Talent balance lots, FX records, and provider-neutral mappings.

CREATE TYPE "OrganizationRole" AS ENUM (
  'admin',
  'finance',
  'approver',
  'viewer',
  'agency_admin',
  'finance_manager',
  'super_admin',
  'treasury',
  'finance_ops'
);

ALTER TABLE "invitations"
  DROP COLUMN "workspaceRole",
  ADD COLUMN "organizationRole" "OrganizationRole";

ALTER TABLE "audit_logs"
  DROP COLUMN "workspaceId",
  ADD COLUMN "organizationId" TEXT;

ALTER TABLE "organizations"
  DROP COLUMN "legacyWorkspaceId";

ALTER TABLE "users"
  DROP COLUMN "agencyId",
  DROP COLUMN "providerAccountId",
  DROP COLUMN "providerCounterpartyId",
  DROP COLUMN "providerLedgerAccountId",
  DROP COLUMN "providerLegalEntityId";

DROP TABLE "agency_external_accounts" CASCADE;
DROP TABLE "authorizations" CASCADE;
DROP TABLE "bank_details" CASCADE;
DROP TABLE "brand_treasuries" CASCADE;
DROP TABLE "brand_verifications" CASCADE;
DROP TABLE "conduit_customers" CASCADE;
DROP TABLE "conduit_recipients" CASCADE;
DROP TABLE "conduit_virtual_accounts" CASCADE;
DROP TABLE "conduit_wallets" CASCADE;
DROP TABLE "documents" CASCADE;
DROP TABLE "integration_connections" CASCADE;
DROP TABLE "invoices" CASCADE;
DROP TABLE "memberships" CASCADE;
DROP TABLE "payment_payouts" CASCADE;
DROP TABLE "payments" CASCADE;
DROP TABLE "payouts" CASCADE;
DROP TABLE "provider_operations" CASCADE;
DROP TABLE "quickbooks_connections" CASCADE;
DROP TABLE "quickbooks_invoices" CASCADE;
DROP TABLE "transactions" CASCADE;
DROP TABLE "wallet_ledgers" CASCADE;
DROP TABLE "wallets" CASCADE;
DROP TABLE "webhook_events" CASCADE;
DROP TABLE "workspaces" CASCADE;

DROP TYPE "BankDetailStatus";
DROP TYPE "DocumentStatus";
DROP TYPE "IntegrationProvider";
DROP TYPE "IntegrationStatus";
DROP TYPE "InvoiceStatus";
DROP TYPE "LedgerType";
DROP TYPE "MembershipStatus";
DROP TYPE "PayoutStatus";
DROP TYPE "QuickBooksConnectStatus";
DROP TYPE "TransactionStatus";
DROP TYPE "VerificationStatus";
DROP TYPE "VerificationTrack";
DROP TYPE "WalletStatus";
DROP TYPE "WorkspaceRole";
DROP TYPE "WorkspaceType";
