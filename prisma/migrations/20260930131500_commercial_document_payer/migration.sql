ALTER TABLE "commercial_documents" ADD COLUMN "payerOrganizationId" TEXT;

CREATE INDEX "commercial_documents_payerOrganizationId_status_idx"
  ON "commercial_documents"("payerOrganizationId", "status");

ALTER TABLE "commercial_documents"
  ADD CONSTRAINT "commercial_documents_payerOrganizationId_fkey"
  FOREIGN KEY ("payerOrganizationId") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
