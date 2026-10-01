-- CreateEnum
CREATE TYPE "PaymentInstructionType" AS ENUM ('brand_to_agency', 'agency_to_talent_balance', 'talent_withdrawal', 'agency_withdrawal', 'refund');

-- CreateEnum
CREATE TYPE "PaymentInstructionStatus" AS ENUM ('requested', 'validated', 'awaiting_provider', 'submitted', 'processing', 'settled', 'failed', 'cancelled', 'returned', 'review_required');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('requested', 'submitted', 'accepted', 'settled', 'failed', 'unknown');

-- CreateTable
CREATE TABLE "payment_instructions" (
    "id" TEXT NOT NULL,
    "instructionType" "PaymentInstructionType" NOT NULL,
    "status" "PaymentInstructionStatus" NOT NULL DEFAULT 'requested',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "sourceOrganizationId" TEXT,
    "destinationOrganizationId" TEXT,
    "sourceParticipantId" TEXT,
    "destinationParticipantId" TEXT,
    "sourceFinancialAccountId" TEXT,
    "destinationFinancialAccountId" TEXT,
    "commercialDocumentVersionId" TEXT,
    "payableAllocationId" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "providerRequired" BOOLEAN NOT NULL DEFAULT true,
    "purpose" TEXT NOT NULL DEFAULT '',
    "idempotencyScope" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureReason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_instruction_events" (
    "id" TEXT NOT NULL,
    "instructionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "fromStatus" "PaymentInstructionStatus",
    "toStatus" "PaymentInstructionStatus" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_instruction_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" TEXT NOT NULL,
    "instructionId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'requested',
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "externalReference" TEXT,
    "requestPayload" JSONB NOT NULL DEFAULT '{}',
    "responsePayload" JSONB NOT NULL DEFAULT '{}',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_instructions_status_createdAt_idx" ON "payment_instructions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "payment_instructions_sourceOrganizationId_status_idx" ON "payment_instructions"("sourceOrganizationId", "status");

-- CreateIndex
CREATE INDEX "payment_instructions_destinationOrganizationId_status_idx" ON "payment_instructions"("destinationOrganizationId", "status");

-- CreateIndex
CREATE INDEX "payment_instructions_destinationParticipantId_status_idx" ON "payment_instructions"("destinationParticipantId", "status");

-- CreateIndex
CREATE INDEX "payment_instructions_commercialDocumentVersionId_idx" ON "payment_instructions"("commercialDocumentVersionId");

-- CreateIndex
CREATE INDEX "payment_instructions_payableAllocationId_idx" ON "payment_instructions"("payableAllocationId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_instructions_idempotencyScope_idempotencyKey_key" ON "payment_instructions"("idempotencyScope", "idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_instruction_events_instructionId_createdAt_idx" ON "payment_instruction_events"("instructionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_instruction_events_instructionId_sequence_key" ON "payment_instruction_events"("instructionId", "sequence");

-- CreateIndex
CREATE INDEX "payment_attempts_instructionId_status_idx" ON "payment_attempts"("instructionId", "status");

-- CreateIndex
CREATE INDEX "payment_attempts_status_createdAt_idx" ON "payment_attempts"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_instructionId_attemptNumber_key" ON "payment_attempts"("instructionId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_provider_idempotencyKey_key" ON "payment_attempts"("provider", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_provider_externalReference_key" ON "payment_attempts"("provider", "externalReference");

-- AddForeignKey
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_sourceOrganizationId_fkey" FOREIGN KEY ("sourceOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_destinationOrganizationId_fkey" FOREIGN KEY ("destinationOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_sourceParticipantId_fkey" FOREIGN KEY ("sourceParticipantId") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_destinationParticipantId_fkey" FOREIGN KEY ("destinationParticipantId") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_sourceFinancialAccountId_fkey" FOREIGN KEY ("sourceFinancialAccountId") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_destinationFinancialAccountId_fkey" FOREIGN KEY ("destinationFinancialAccountId") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_commercialDocumentVersionId_fkey" FOREIGN KEY ("commercialDocumentVersionId") REFERENCES "commercial_document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_payableAllocationId_fkey" FOREIGN KEY ("payableAllocationId") REFERENCES "payable_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_instruction_events" ADD CONSTRAINT "payment_instruction_events_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "payment_instructions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_instruction_events" ADD CONSTRAINT "payment_instruction_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "payment_instructions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce money and party invariants even for non-application writers.
ALTER TABLE "payment_instructions"
  ADD CONSTRAINT "payment_instructions_positive_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "payment_instructions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "payment_instructions_source_party_check" CHECK ("sourceOrganizationId" IS NOT NULL OR "sourceParticipantId" IS NOT NULL),
  ADD CONSTRAINT "payment_instructions_destination_party_check" CHECK ("destinationOrganizationId" IS NOT NULL OR "destinationParticipantId" IS NOT NULL);

-- A provider instruction may have retries, but never two live attempts.
CREATE UNIQUE INDEX "payment_attempts_one_active_per_instruction_key"
  ON "payment_attempts" ("instructionId")
  WHERE "status" IN ('requested', 'submitted', 'accepted', 'unknown');

