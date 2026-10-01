-- CreateEnum
CREATE TYPE "SourceConnectionStatus" AS ENUM ('pending', 'active', 'expired', 'disconnected', 'error');

-- CreateEnum
CREATE TYPE "SourceEventStatus" AS ENUM ('received', 'processing', 'processed', 'ignored', 'failed');

-- CreateTable
CREATE TABLE "source_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "participantId" TEXT,
    "connectorKey" TEXT NOT NULL,
    "externalTenantId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "status" "SourceConnectionStatus" NOT NULL DEFAULT 'pending',
    "credentialsEncrypted" TEXT NOT NULL DEFAULT '',
    "credentialKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "webhookSecretHash" TEXT,
    "signingSecretEncrypted" TEXT,
    "syncCursor" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "source_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_events" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "status" "SourceEventStatus" NOT NULL DEFAULT 'received',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_connections_organizationId_connectorKey_status_idx" ON "source_connections"("organizationId", "connectorKey", "status");

-- CreateIndex
CREATE INDEX "source_connections_participantId_connectorKey_status_idx" ON "source_connections"("participantId", "connectorKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "source_connections_connectorKey_externalTenantId_organizati_key" ON "source_connections"("connectorKey", "externalTenantId", "organizationId", "participantId");

-- CreateIndex
CREATE INDEX "source_events_status_receivedAt_idx" ON "source_events"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "source_events_connectionId_eventType_occurredAt_idx" ON "source_events"("connectionId", "eventType", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "source_events_connectionId_externalEventId_key" ON "source_events"("connectionId", "externalEventId");

-- AddForeignKey
ALTER TABLE "source_connections" ADD CONSTRAINT "source_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_connections" ADD CONSTRAINT "source_connections_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "source_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A source connection belongs to one canonical organization or participant.
ALTER TABLE "source_connections"
    ADD CONSTRAINT "source_connections_exactly_one_owner"
    CHECK (num_nonnulls("organizationId", "participantId") = 1);

-- Preserve existing connection identity without copying plaintext OAuth tokens
-- into the canonical encrypted credential field. Adapters migrate credentials
-- through the application encryption service when they are next used.
INSERT INTO "source_connections" (
    "id", "organizationId", "participantId", "connectorKey",
    "externalTenantId", "displayName", "status", "metadata",
    "createdAt", "updatedAt", "deletedAt"
)
SELECT
    'legacy-integration-' || legacy."id",
    CASE WHEN owner."accountType"::text <> 'talent' THEN
        COALESCE(
            (SELECT workspace."id" FROM "workspaces" workspace
             WHERE workspace."ownerId" = owner."id"
             ORDER BY workspace."createdAt" ASC LIMIT 1),
            owner."id"
        )
        ELSE NULL
    END,
    CASE WHEN owner."accountType"::text = 'talent' THEN owner."id" ELSE NULL END,
    legacy."provider"::text,
    COALESCE(
        NULLIF(legacy."realmId", ''),
        NULLIF(legacy."tenantId", ''),
        NULLIF(legacy."itemId", ''),
        legacy."id"
    ),
    COALESCE(NULLIF(legacy."institutionName", ''), initcap(legacy."provider"::text)),
    CASE legacy."status"::text
        WHEN 'connected' THEN 'active'::"SourceConnectionStatus"
        WHEN 'expired' THEN 'expired'::"SourceConnectionStatus"
        ELSE 'disconnected'::"SourceConnectionStatus"
    END,
    jsonb_build_object(
        'legacyIntegrationConnectionId', legacy."id",
        'credentialsMigrationRequired',
            (legacy."accessToken" <> '' OR legacy."refreshToken" <> '')
    ),
    legacy."createdAt",
    legacy."updatedAt",
    legacy."deletedAt"
FROM "integration_connections" legacy
JOIN "users" owner ON owner."id" = legacy."userId"
ON CONFLICT DO NOTHING;

