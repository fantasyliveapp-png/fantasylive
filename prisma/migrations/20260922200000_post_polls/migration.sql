-- Encuestas en las publicaciones del feed.
-- CreateTable
CREATE TABLE "post_polls" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "endsAt" TIMESTAMP(3),
    "totalVotes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_poll_options" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "voteCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "post_poll_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_poll_votes" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "post_polls_postId_key" ON "post_polls"("postId");

-- CreateIndex
CREATE INDEX "post_poll_options_pollId_sortOrder_idx" ON "post_poll_options"("pollId", "sortOrder");

-- CreateIndex
CREATE INDEX "post_poll_votes_optionId_idx" ON "post_poll_votes"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "post_poll_votes_pollId_userId_key" ON "post_poll_votes"("pollId", "userId");

-- AddForeignKey
ALTER TABLE "post_polls" ADD CONSTRAINT "post_polls_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_poll_options" ADD CONSTRAINT "post_poll_options_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "post_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_poll_votes" ADD CONSTRAINT "post_poll_votes_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "post_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_poll_votes" ADD CONSTRAINT "post_poll_votes_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "post_poll_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_poll_votes" ADD CONSTRAINT "post_poll_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

