-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('brand', 'agency', 'platform');

-- CreateEnum
CREATE TYPE "ParticipantKind" AS ENUM ('individual', 'business');

-- CreateEnum
CREATE TYPE "FinancialAccountType" AS ENUM ('external_bank', 'virtual_account', 'wallet');

-- CreateEnum
CREATE TYPE "FinancialAccountStatus" AS ENUM ('pending', 'ready', 'restricted', 'disabled');

-- CreateEnum
CREATE TYPE "ProviderMappingStatus" AS ENUM ('pending', 'active', 'restricted', 'closed');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "legacyWorkspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" TEXT NOT NULL,
    "kind" "ParticipantKind" NOT NULL DEFAULT 'individual',
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_users" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participant_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_participants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_identity_maps" (
    "id" TEXT NOT NULL,
    "participantId" TEXT,
    "organizationId" TEXT,
    "sourceSystem" TEXT NOT NULL,
    "sourceTenantId" TEXT NOT NULL DEFAULT '',
    "externalType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_identity_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" TEXT NOT NULL,
    "participantId" TEXT,
    "organizationId" TEXT,
    "type" "FinancialAccountType" NOT NULL,
    "status" "FinancialAccountStatus" NOT NULL DEFAULT 'pending',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "country" TEXT,
    "displayName" TEXT NOT NULL DEFAULT '',
    "institutionName" TEXT,
    "lastFour" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_party_maps" (
    "id" TEXT NOT NULL,
    "participantId" TEXT,
    "organizationId" TEXT,
    "provider" TEXT NOT NULL,
    "partyType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" "ProviderMappingStatus" NOT NULL DEFAULT 'pending',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_party_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_account_maps" (
    "id" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" "ProviderMappingStatus" NOT NULL DEFAULT 'pending',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_account_maps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_legacyWorkspaceId_key" ON "organizations"("legacyWorkspaceId");

-- CreateIndex
CREATE INDEX "organizations_type_status_idx" ON "organizations"("type", "status");

-- CreateIndex
CREATE INDEX "participants_status_idx" ON "participants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "participant_users_userId_key" ON "participant_users"("userId");

-- CreateIndex
CREATE INDEX "participant_users_participantId_idx" ON "participant_users"("participantId");

-- CreateIndex
CREATE INDEX "organization_participants_participantId_status_idx" ON "organization_participants"("participantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_participants_organizationId_participantId_rela_key" ON "organization_participants"("organizationId", "participantId", "relationshipType");

-- CreateIndex
CREATE INDEX "external_identity_maps_participantId_sourceSystem_idx" ON "external_identity_maps"("participantId", "sourceSystem");

-- CreateIndex
CREATE INDEX "external_identity_maps_organizationId_sourceSystem_idx" ON "external_identity_maps"("organizationId", "sourceSystem");

-- CreateIndex
CREATE UNIQUE INDEX "external_identity_maps_sourceSystem_sourceTenantId_external_key" ON "external_identity_maps"("sourceSystem", "sourceTenantId", "externalType", "externalId");

-- CreateIndex
CREATE INDEX "financial_accounts_participantId_status_idx" ON "financial_accounts"("participantId", "status");

-- CreateIndex
CREATE INDEX "financial_accounts_organizationId_status_idx" ON "financial_accounts"("organizationId", "status");

-- CreateIndex
CREATE INDEX "provider_party_maps_participantId_provider_idx" ON "provider_party_maps"("participantId", "provider");

-- CreateIndex
CREATE INDEX "provider_party_maps_organizationId_provider_idx" ON "provider_party_maps"("organizationId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "provider_party_maps_provider_externalId_key" ON "provider_party_maps"("provider", "externalId");

-- CreateIndex
CREATE INDEX "provider_account_maps_financialAccountId_provider_idx" ON "provider_account_maps"("financialAccountId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "provider_account_maps_provider_externalId_key" ON "provider_account_maps"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_legacyWorkspaceId_fkey" FOREIGN KEY ("legacyWorkspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_users" ADD CONSTRAINT "participant_users_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_users" ADD CONSTRAINT "participant_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_participants" ADD CONSTRAINT "organization_participants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_participants" ADD CONSTRAINT "organization_participants_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identity_maps" ADD CONSTRAINT "external_identity_maps_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identity_maps" ADD CONSTRAINT "external_identity_maps_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_party_maps" ADD CONSTRAINT "provider_party_maps_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_party_maps" ADD CONSTRAINT "provider_party_maps_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_account_maps" ADD CONSTRAINT "provider_account_maps_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Exactly one canonical owner is required for polymorphic identity/account maps.
ALTER TABLE "external_identity_maps"
    ADD CONSTRAINT "external_identity_maps_exactly_one_owner"
    CHECK (num_nonnulls("participantId", "organizationId") = 1);

ALTER TABLE "financial_accounts"
    ADD CONSTRAINT "financial_accounts_exactly_one_owner"
    CHECK (num_nonnulls("participantId", "organizationId") = 1);

ALTER TABLE "provider_party_maps"
    ADD CONSTRAINT "provider_party_maps_exactly_one_owner"
    CHECK (num_nonnulls("participantId", "organizationId") = 1);

-- Backfill organizations from existing workspaces. Reusing the workspace ID
-- keeps membership migration deterministic while the legacy model is active.
INSERT INTO "organizations" (
    "id", "type", "name", "status", "legacyWorkspaceId", "createdAt", "updatedAt"
)
SELECT
    w."id",
    CASE WHEN w."type"::text = 'brand' THEN 'brand'::"OrganizationType" ELSE 'agency'::"OrganizationType" END,
    w."name",
    CASE WHEN w."deletedAt" IS NULL THEN 'active' ELSE 'inactive' END,
    w."id",
    w."createdAt",
    w."updatedAt"
FROM "workspaces" w
ON CONFLICT ("id") DO NOTHING;

-- Some legacy users were generated by invoice/import flows without a
-- workspace. Preserve them as organizations until onboarding is completed.
INSERT INTO "organizations" (
    "id", "type", "name", "status", "createdAt", "updatedAt"
)
SELECT
    u."id",
    u."accountType"::text::"OrganizationType",
    u."fullName",
    CASE WHEN u."deletedAt" IS NULL THEN 'active' ELSE 'inactive' END,
    u."createdAt",
    u."updatedAt"
FROM "users" u
WHERE u."accountType"::text IN ('brand', 'agency')
  AND NOT EXISTS (
      SELECT 1 FROM "workspaces" w WHERE w."ownerId" = u."id"
  )
ON CONFLICT ("id") DO NOTHING;

-- Every legacy login receives a canonical participant identity. A participant
-- may later be linked to additional users without changing its AP identity.
INSERT INTO "participants" (
    "id", "kind", "displayName", "status", "createdAt", "updatedAt"
)
SELECT
    u."id",
    'individual'::"ParticipantKind",
    u."fullName",
    CASE WHEN u."deletedAt" IS NULL THEN 'active' ELSE 'inactive' END,
    u."createdAt",
    u."updatedAt"
FROM "users" u
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "participant_users" (
    "id", "participantId", "userId", "isPrimary", "createdAt"
)
SELECT
    'legacy-user-' || u."id",
    u."id",
    u."id",
    true,
    u."createdAt"
FROM "users" u
ON CONFLICT ("userId") DO NOTHING;

-- Preserve workspace roles as organization relationships.
INSERT INTO "organization_participants" (
    "id", "organizationId", "participantId", "relationshipType",
    "status", "startsAt", "createdAt", "updatedAt"
)
SELECT
    'legacy-membership-' || m."id",
    m."workspaceId",
    m."userId",
    m."role"::text,
    m."status"::text,
    m."createdAt",
    m."createdAt",
    m."updatedAt"
FROM "memberships" m
WHERE EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = m."workspaceId")
ON CONFLICT ("organizationId", "participantId", "relationshipType") DO NOTHING;

-- Preserve the legacy Agency-to-Talent relationship without retaining the
-- one-agency limitation in the canonical model.
INSERT INTO "organization_participants" (
    "id", "organizationId", "participantId", "relationshipType",
    "status", "startsAt", "createdAt", "updatedAt"
)
SELECT
    'legacy-agency-talent-' || talent."id",
    COALESCE(
        (SELECT w."id" FROM "workspaces" w
         WHERE w."ownerId" = talent."agencyId"
         ORDER BY w."createdAt" ASC LIMIT 1),
        talent."agencyId"
    ),
    talent."id",
    'talent',
    'active',
    talent."createdAt",
    talent."createdAt",
    talent."updatedAt"
FROM "users" talent
WHERE talent."accountType"::text = 'talent'
  AND talent."agencyId" IS NOT NULL
ON CONFLICT ("organizationId", "participantId", "relationshipType") DO NOTHING;

-- Backfill legacy bank-detail records into provider-independent accounts.
INSERT INTO "financial_accounts" (
    "id", "participantId", "organizationId", "type", "status",
    "currency", "country", "displayName", "institutionName", "lastFour",
    "isPrimary", "metadata", "createdAt", "updatedAt", "deletedAt"
)
SELECT
    'legacy-bank-detail-' || b."id",
    CASE WHEN u."accountType"::text = 'talent' THEN u."id" ELSE NULL END,
    CASE WHEN u."accountType"::text <> 'talent' THEN
        COALESCE(
            (SELECT w."id" FROM "workspaces" w
             WHERE w."ownerId" = u."id"
             ORDER BY w."createdAt" ASC LIMIT 1),
            u."id"
        )
        ELSE NULL
    END,
    'external_bank'::"FinancialAccountType",
    CASE
        WHEN b."status"::text = 'approved' THEN 'ready'::"FinancialAccountStatus"
        WHEN b."status"::text = 'rejected' THEN 'disabled'::"FinancialAccountStatus"
        ELSE 'pending'::"FinancialAccountStatus"
    END,
    b."currency",
    NULLIF(b."country", ''),
    b."accountHolderName",
    NULLIF(b."bankName", ''),
    NULLIF(right(b."accountNumber", 4), ''),
    true,
    jsonb_build_object('legacyBankDetailId', b."id"),
    b."createdAt",
    b."updatedAt",
    b."deletedAt"
FROM "bank_details" b
JOIN "users" u ON u."id" = b."userId"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "provider_account_maps" (
    "id", "financialAccountId", "provider", "accountType", "externalId",
    "status", "metadata", "createdAt", "updatedAt"
)
SELECT
    'legacy-plaid-account-' || b."id",
    'legacy-bank-detail-' || b."id",
    'plaid',
    'external_bank',
    b."plaidAccountId",
    'active'::"ProviderMappingStatus",
    jsonb_strip_nulls(jsonb_build_object('legacyPlaidItemId', b."plaidItemId")),
    b."createdAt",
    b."updatedAt"
FROM "bank_details" b
WHERE b."plaidAccountId" IS NOT NULL
ON CONFLICT ("provider", "externalId") DO NOTHING;

-- Backfill the overloaded legacy external-account table. Unknown providers
-- remain explicitly unclassified instead of being assumed to be Conduit.
INSERT INTO "financial_accounts" (
    "id", "participantId", "organizationId", "type", "status",
    "currency", "displayName", "institutionName", "lastFour",
    "isPrimary", "metadata", "createdAt", "updatedAt"
)
SELECT
    'legacy-external-account-' || a."id",
    CASE WHEN u."accountType"::text = 'talent' THEN u."id" ELSE NULL END,
    CASE WHEN u."accountType"::text <> 'talent' THEN
        COALESCE(
            (SELECT w."id" FROM "workspaces" w
             WHERE w."ownerId" = u."id"
             ORDER BY w."createdAt" ASC LIMIT 1),
            u."id"
        )
        ELSE NULL
    END,
    'external_bank'::"FinancialAccountType",
    'ready'::"FinancialAccountStatus",
    'USD',
    a."accountName",
    NULLIF(a."bankName", ''),
    NULLIF(a."accountNumberMask", ''),
    a."isPrimary",
    jsonb_build_object('legacyAgencyExternalAccountId', a."id"),
    a."createdAt",
    a."updatedAt"
FROM "agency_external_accounts" a
JOIN "users" u ON u."id" = a."agencyId"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "provider_account_maps" (
    "id", "financialAccountId", "provider", "accountType", "externalId",
    "status", "metadata", "createdAt", "updatedAt"
)
SELECT
    'legacy-provider-account-' || a."id",
    'legacy-external-account-' || a."id",
    'legacy-unclassified',
    'external_bank',
    a."providerExternalAccountId",
    'active'::"ProviderMappingStatus",
    jsonb_build_object('requiresProviderClassification', true),
    a."createdAt",
    a."updatedAt"
FROM "agency_external_accounts" a
ON CONFLICT ("provider", "externalId") DO NOTHING;

-- Preserve existing Conduit customer and recipient identities in generic maps.
INSERT INTO "provider_party_maps" (
    "id", "participantId", "organizationId", "provider", "partyType",
    "externalId", "status", "metadata", "createdAt", "updatedAt"
)
SELECT
    'legacy-conduit-customer-' || c."id",
    CASE WHEN u."accountType"::text = 'talent' THEN u."id" ELSE NULL END,
    CASE WHEN u."accountType"::text <> 'talent' THEN
        COALESCE(
            (SELECT w."id" FROM "workspaces" w
             WHERE w."ownerId" = u."id"
             ORDER BY w."createdAt" ASC LIMIT 1),
            u."id"
        )
        ELSE NULL
    END,
    'conduit',
    c."customerType",
    c."conduitCustomerId",
    CASE WHEN c."status" IN ('active', 'approved') THEN 'active'::"ProviderMappingStatus"
         ELSE 'pending'::"ProviderMappingStatus" END,
    jsonb_build_object('legacyConduitCustomerId', c."id"),
    c."createdAt",
    c."updatedAt"
FROM "conduit_customers" c
JOIN "users" u ON u."id" = c."userId"
ON CONFLICT ("provider", "externalId") DO NOTHING;

INSERT INTO "provider_party_maps" (
    "id", "participantId", "organizationId", "provider", "partyType",
    "externalId", "status", "metadata", "createdAt", "updatedAt"
)
SELECT
    'legacy-conduit-recipient-' || r."id",
    r."talentId",
    NULL,
    'conduit',
    'recipient',
    r."recipientId",
    CASE WHEN r."status" = 'active' THEN 'active'::"ProviderMappingStatus"
         ELSE 'restricted'::"ProviderMappingStatus" END,
    jsonb_build_object('legacyConduitRecipientId', r."id"),
    r."createdAt",
    r."updatedAt"
FROM "conduit_recipients" r
WHERE r."talentId" IS NOT NULL
ON CONFLICT ("provider", "externalId") DO NOTHING;

