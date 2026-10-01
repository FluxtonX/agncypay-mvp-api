-- CreateEnum
CREATE TYPE "OrganizationRelationshipType" AS ENUM ('agency_brand', 'agency_network', 'accounting_sponsor');

-- CreateEnum
CREATE TYPE "OrganizationRelationshipStatus" AS ENUM ('pending', 'active', 'suspended', 'ended');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentInstructionStatus" ADD VALUE 'awaiting_funding';
ALTER TYPE "PaymentInstructionStatus" ADD VALUE 'funding_pending';
ALTER TYPE "PaymentInstructionStatus" ADD VALUE 'funded';

-- CreateTable
CREATE TABLE "organization_relationships" (
    "id" TEXT NOT NULL,
    "sourceOrganizationId" TEXT NOT NULL,
    "targetOrganizationId" TEXT NOT NULL,
    "relationshipType" "OrganizationRelationshipType" NOT NULL,
    "status" "OrganizationRelationshipStatus" NOT NULL DEFAULT 'active',
    "originInvitationId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "organization_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_relationships_originInvitationId_key" ON "organization_relationships"("originInvitationId");

-- CreateIndex
CREATE INDEX "organization_relationships_targetOrganizationId_relationshi_idx" ON "organization_relationships"("targetOrganizationId", "relationshipType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_relationships_sourceOrganizationId_targetOrgan_key" ON "organization_relationships"("sourceOrganizationId", "targetOrganizationId", "relationshipType");

-- AddForeignKey
ALTER TABLE "organization_relationships" ADD CONSTRAINT "organization_relationships_sourceOrganizationId_fkey" FOREIGN KEY ("sourceOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_relationships" ADD CONSTRAINT "organization_relationships_targetOrganizationId_fkey" FOREIGN KEY ("targetOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_relationships" ADD CONSTRAINT "organization_relationships_originInvitationId_fkey" FOREIGN KEY ("originInvitationId") REFERENCES "invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
