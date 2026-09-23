-- Red social: perfiles de fan (privados por defecto) y seguir a personas.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isProfilePublic" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "user_follows" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_follows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_follows_followingId_idx" ON "user_follows"("followingId");

-- CreateIndex
CREATE UNIQUE INDEX "user_follows_followerId_followingId_key" ON "user_follows"("followerId", "followingId");

-- AddForeignKey
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Cada cuenta necesita un @usuario para su perfil (/u/usuario). Se genera a
-- partir del email para quien no lo tenga; si choca, se le anade un sufijo.
UPDATE "users" u
SET "username" = sub.candidate
FROM (
  SELECT
    id,
    CASE
      WHEN count(*) OVER (PARTITION BY base) > 1
        OR EXISTS (SELECT 1 FROM "users" x WHERE x."username" = base)
      THEN base || '_' || right(id, 4)
      ELSE base
    END AS candidate
  FROM (
    SELECT
      id,
      coalesce(
        left(nullif(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9_]', '', 'g'), ''), 20),
        'usuario'
      ) AS base
    FROM "users"
    WHERE "username" IS NULL
  ) t
) sub
WHERE u.id = sub.id;
