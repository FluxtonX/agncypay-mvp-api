-- Phase 1: public signup verification, safe refresh-token storage, and
-- canonical organization roles. Legacy role values remain temporarily so
-- existing memberships can be migrated without unsafe casts.

ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'platform';

ALTER TYPE "OrganizationRole" ADD VALUE IF NOT EXISTS 'platform_admin';
ALTER TYPE "OrganizationRole" ADD VALUE IF NOT EXISTS 'agency_owner';
ALTER TYPE "OrganizationRole" ADD VALUE IF NOT EXISTS 'agency_finance';
ALTER TYPE "OrganizationRole" ADD VALUE IF NOT EXISTS 'agency_viewer';
ALTER TYPE "OrganizationRole" ADD VALUE IF NOT EXISTS 'brand_admin';
ALTER TYPE "OrganizationRole" ADD VALUE IF NOT EXISTS 'brand_finance';
ALTER TYPE "OrganizationRole" ADD VALUE IF NOT EXISTS 'brand_viewer';

ALTER TABLE "users"
  ADD COLUMN "emailVerificationToken" TEXT,
  ADD COLUMN "emailVerificationTokenExpires" TIMESTAMP(3);

-- Existing refresh JWTs were stored in plaintext. Invalidate them during the
-- migration, then store only SHA-256 token hashes going forward.
DELETE FROM "refresh_tokens";
ALTER TABLE "refresh_tokens" RENAME COLUMN "token" TO "tokenHash";

-- Existing Agency admin memberships lose legacy payout approval. Financial
-- authority is intentionally limited to the new agency_owner role in Phase 1.
UPDATE "organization_participants"
SET "metadata" = jsonb_set(
  jsonb_set("metadata", '{organizationRole}', '"agency_admin"'::jsonb),
  '{permissions}',
  '["manage_team", "manage_integrations", "view_reports"]'::jsonb
)
WHERE "metadata"->>'organizationRole' = 'agency_admin';
