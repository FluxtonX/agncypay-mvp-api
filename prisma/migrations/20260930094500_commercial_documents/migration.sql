-- CreateEnum
CREATE TYPE "CommercialDocumentType" AS ENUM ('invoice', 'payable', 'credit_note');

-- CreateEnum
CREATE TYPE "CommercialDocumentStatus" AS ENUM ('received', 'valid', 'invalid', 'superseded', 'cancelled');

-- CreateEnum
CREATE TYPE "CommercialValidationStatus" AS ENUM ('pending', 'valid', 'invalid');

-- CreateEnum
CREATE TYPE "AllocationValidationStatus" AS ENUM ('pending', 'valid', 'invalid');

-- CreateEnum
CREATE TYPE "ValidationFindingSeverity" AS ENUM ('error', 'warning', 'info');

-- CreateEnum
CREATE TYPE "CommercialApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "commercial_documents" (
    "id" TEXT NOT NULL,
    "sourceConnectionId" TEXT NOT NULL,
    "agencyOrganizationId" TEXT NOT NULL,
    "externalDocumentId" TEXT NOT NULL,
    "documentType" "CommercialDocumentType" NOT NULL,
    "status" "CommercialDocumentStatus" NOT NULL DEFAULT 'received',
    "currentVersionNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "commercial_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_document_versions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sourceEventId" TEXT,
    "versionNumber" INTEGER NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "effectiveAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "validationStatus" "CommercialValidationStatus" NOT NULL DEFAULT 'pending',
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payable_allocations" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "externalAllocationId" TEXT NOT NULL,
    "beneficiaryParticipantId" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "AllocationValidationStatus" NOT NULL DEFAULT 'pending',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payable_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_validation_findings" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" "ValidationFindingSeverity" NOT NULL,
    "field" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_validation_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_approvals" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "status" "CommercialApprovalStatus" NOT NULL DEFAULT 'pending',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commercial_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commercial_documents_agencyOrganizationId_status_idx" ON "commercial_documents"("agencyOrganizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_documents_sourceConnectionId_documentType_extern_key" ON "commercial_documents"("sourceConnectionId", "documentType", "externalDocumentId");

-- CreateIndex
CREATE INDEX "commercial_document_versions_sourceEventId_idx" ON "commercial_document_versions"("sourceEventId");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_document_versions_documentId_versionNumber_key" ON "commercial_document_versions"("documentId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_document_versions_documentId_sourceVersion_key" ON "commercial_document_versions"("documentId", "sourceVersion");

-- CreateIndex
CREATE INDEX "payable_allocations_beneficiaryParticipantId_status_idx" ON "payable_allocations"("beneficiaryParticipantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payable_allocations_documentVersionId_externalAllocationId_key" ON "payable_allocations"("documentVersionId", "externalAllocationId");

-- CreateIndex
CREATE INDEX "commercial_validation_findings_documentVersionId_severity_idx" ON "commercial_validation_findings"("documentVersionId", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_approvals_documentVersionId_key" ON "commercial_approvals"("documentVersionId");

-- CreateIndex
CREATE INDEX "commercial_approvals_status_createdAt_idx" ON "commercial_approvals"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "commercial_documents" ADD CONSTRAINT "commercial_documents_sourceConnectionId_fkey" FOREIGN KEY ("sourceConnectionId") REFERENCES "source_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_documents" ADD CONSTRAINT "commercial_documents_agencyOrganizationId_fkey" FOREIGN KEY ("agencyOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_document_versions" ADD CONSTRAINT "commercial_document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "commercial_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_document_versions" ADD CONSTRAINT "commercial_document_versions_sourceEventId_fkey" FOREIGN KEY ("sourceEventId") REFERENCES "source_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_allocations" ADD CONSTRAINT "payable_allocations_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "commercial_document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_allocations" ADD CONSTRAINT "payable_allocations_beneficiaryParticipantId_fkey" FOREIGN KEY ("beneficiaryParticipantId") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_validation_findings" ADD CONSTRAINT "commercial_validation_findings_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "commercial_document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_approvals" ADD CONSTRAINT "commercial_approvals_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "commercial_document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_approvals" ADD CONSTRAINT "commercial_approvals_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
