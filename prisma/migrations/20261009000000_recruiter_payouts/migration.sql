-- Los reclutadores tambien piden retiros: la solicitud es de una creadora
-- (modelId) o de un reclutador (recruiterId).
ALTER TABLE "payout_requests" ADD COLUMN "recruiterId" TEXT,
ALTER COLUMN "modelId" DROP NOT NULL;

CREATE INDEX "payout_requests_recruiterId_idx" ON "payout_requests"("recruiterId");

ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "recruiters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
