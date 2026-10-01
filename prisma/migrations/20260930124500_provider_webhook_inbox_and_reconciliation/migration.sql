-- CreateEnum
CREATE TYPE "ProviderWebhookEventStatus" AS ENUM ('received', 'processing', 'processed', 'ignored', 'failed');

-- AlterTable
ALTER TABLE "reconciliation_records" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "expectedCurrency" TEXT,
ADD COLUMN     "externalReference" TEXT,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerCurrency" TEXT,
ADD COLUMN     "severity" TEXT NOT NULL DEFAULT 'error';

-- CreateTable
CREATE TABLE "provider_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ProviderWebhookEventStatus" NOT NULL DEFAULT 'received',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "occurredAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_webhook_events_status_receivedAt_idx" ON "provider_webhook_events"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "provider_webhook_events_provider_eventType_occurredAt_idx" ON "provider_webhook_events"("provider", "eventType", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_webhook_events_provider_externalEventId_key" ON "provider_webhook_events"("provider", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_records_dedupeKey_key" ON "reconciliation_records"("dedupeKey");
