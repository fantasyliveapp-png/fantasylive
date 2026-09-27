-- Tiempo de visionado de cada directo (retencion para el algoritmo)
CREATE TABLE "live_views" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "live_views_streamId_userId_key" ON "live_views"("streamId", "userId");
CREATE INDEX "live_views_userId_updatedAt_idx" ON "live_views"("userId", "updatedAt");
CREATE INDEX "live_views_modelId_idx" ON "live_views"("modelId");

ALTER TABLE "live_views" ADD CONSTRAINT "live_views_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "live_streams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_views" ADD CONSTRAINT "live_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_views" ADD CONSTRAINT "live_views_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
