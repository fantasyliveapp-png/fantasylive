
-- CreateTable
CREATE TABLE "token_promos" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "percentOff" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_promos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "token_promos_active_startsAt_endsAt_idx" ON "token_promos"("active", "startsAt", "endsAt");

