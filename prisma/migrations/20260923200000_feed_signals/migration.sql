-- CreateTable
CREATE TABLE "post_impressions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_impressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_hides" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_hides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_impressions_userId_createdAt_idx" ON "post_impressions"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "post_impressions_userId_postId_key" ON "post_impressions"("userId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "post_hides_userId_postId_key" ON "post_hides"("userId", "postId");

-- AddForeignKey
ALTER TABLE "post_impressions" ADD CONSTRAINT "post_impressions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_impressions" ADD CONSTRAINT "post_impressions_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_hides" ADD CONSTRAINT "post_hides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_hides" ADD CONSTRAINT "post_hides_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

