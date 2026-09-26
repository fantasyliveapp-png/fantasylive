import 'server-only';

import { Prisma } from '@prisma/client';

import {
  engagementRate,
  getBenchmarkRates,
  percentileOf,
  TEST_AUDIENCE,
} from '@/lib/post-insights';
import { prisma } from '@/lib/prisma';
import { resolveAssetUrl } from '@/lib/storage';
import { tokensToPayoutCents } from '@/lib/tokens';

/**
 * ALCANCE de una creadora: cuanta gente ve lo que publica, como funciona
 * cada publicacion comparada con la plataforma y a que hora estan sus fans.
 */

export type ReachStatus =
  | { kind: 'scheduled' }
  | { kind: 'testing'; views: number; target: number }
  | { kind: 'ranked'; percentile: number | null };

export interface ReachPost {
  id: string;
  createdAt: string;
  body: string | null;
  type: 'image' | 'video' | 'text' | 'poll';
  thumbUrl: string | null;
  visibility: string;
  views: number;
  likes: number;
  comments: number;
  unlocks: number;
  /** Segundos medios que la miran */
  avgWatchSec: number | null;
  /** % de quien la vio que vio el video entero */
  completionPct: number | null;
  earnedCents: number;
  status: ReachStatus;
}

/** Actividad por dia de la semana (0 = domingo) y hora, en UTC. */
export interface ActivityBucket {
  dow: number;
  hour: number;
  count: number;
}

export interface CreatorReach {
  week: { views: number; people: number; prevViews: number; avgWatchSec: number | null };
  posts: ReachPost[];
  activity: ActivityBucket[];
  /** De donde sale la mejor hora: sus fans o toda la plataforma. */
  activitySource: 'fans' | 'platform';
}

export async function getCreatorReach(modelId: string): Promise<CreatorReach> {
  const now = Date.now();
  const weekAgo = new Date(now - 7 * 86_400_000);
  const twoWeeksAgo = new Date(now - 14 * 86_400_000);
  const monthAgo = new Date(now - 30 * 86_400_000);

  const [weekViews, weekPeople, prevViews, weekWatch, posts, benchmark] = await Promise.all([
    prisma.postImpression.count({
      where: { post: { modelId }, createdAt: { gte: weekAgo } },
    }),
    prisma.postImpression.findMany({
      where: { post: { modelId }, createdAt: { gte: weekAgo } },
      distinct: ['userId'],
      select: { userId: true },
    }),
    prisma.postImpression.count({
      where: { post: { modelId }, createdAt: { gte: twoWeeksAgo, lt: weekAgo } },
    }),
    prisma.postImpression.aggregate({
      where: { post: { modelId }, createdAt: { gte: weekAgo } },
      _avg: { dwellMs: true },
    }),
    prisma.post.findMany({
      where: { modelId, isPublished: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        createdAt: true,
        body: true,
        visibility: true,
        viewCount: true,
        likeCount: true,
        commentCount: true,
        unlockCount: true,
        tokensEarned: true,
        watchMs: true,
        completions: true,
        poll: { select: { id: true } },
        assets: {
          orderBy: { sortOrder: 'asc' },
          take: 1,
          select: { mimeType: true, storageKey: true },
        },
      },
    }),
    getBenchmarkRates(),
  ]);

  const reachPosts: ReachPost[] = await Promise.all(
    posts.map(async (p) => {
      const first = p.assets[0];
      const isVideo = first?.mimeType.startsWith('video/') ?? false;
      const type: ReachPost['type'] = first
        ? isVideo
          ? 'video'
          : 'image'
        : p.poll
          ? 'poll'
          : 'text';
      const status: ReachStatus =
        p.createdAt.getTime() > now
          ? { kind: 'scheduled' }
          : p.viewCount < TEST_AUDIENCE
            ? { kind: 'testing', views: p.viewCount, target: TEST_AUDIENCE }
            : { kind: 'ranked', percentile: percentileOf(engagementRate(p), benchmark) };
      return {
        id: p.id,
        createdAt: p.createdAt.toISOString(),
        body: p.body,
        type,
        thumbUrl:
          first && !isVideo ? await resolveAssetUrl(first.storageKey, { isPublic: false }) : null,
        visibility: p.visibility,
        views: p.viewCount,
        likes: p.likeCount,
        comments: p.commentCount,
        unlocks: p.unlockCount,
        avgWatchSec:
          p.viewCount > 0 ? Math.round(Number(p.watchMs) / p.viewCount / 100) / 10 : null,
        completionPct:
          isVideo && p.viewCount > 0 ? Math.round((p.completions / p.viewCount) * 100) : null,
        earnedCents: tokensToPayoutCents(p.tokensEarned),
        status,
      };
    }),
  );

  // Cuando estan activos sus fans: vistas de sus publicaciones y me gusta
  // del ultimo mes. Si aun hay pocos datos, la actividad de la plataforma.
  const own = await prisma.$queryRaw<{ dow: number; hour: number; count: bigint }[]>(Prisma.sql`
    SELECT EXTRACT(DOW FROM i."createdAt")::int AS dow,
           EXTRACT(HOUR FROM i."createdAt")::int AS hour,
           COUNT(*) AS count
    FROM post_impressions i
    JOIN posts p ON p.id = i."postId"
    WHERE p."modelId" = ${modelId} AND i."createdAt" >= ${monthAgo}
    GROUP BY 1, 2`);
  const ownTotal = own.reduce((a, r) => a + Number(r.count), 0);

  let activity = own;
  let activitySource: CreatorReach['activitySource'] = 'fans';
  if (ownTotal < 30) {
    activity = await prisma.$queryRaw<{ dow: number; hour: number; count: bigint }[]>(Prisma.sql`
      SELECT EXTRACT(DOW FROM "createdAt")::int AS dow,
             EXTRACT(HOUR FROM "createdAt")::int AS hour,
             COUNT(*) AS count
      FROM post_impressions
      WHERE "createdAt" >= ${monthAgo}
      GROUP BY 1, 2`);
    activitySource = 'platform';
  }

  return {
    week: {
      views: weekViews,
      people: weekPeople.length,
      prevViews,
      avgWatchSec:
        weekWatch._avg.dwellMs != null
          ? Math.round(Math.min(weekWatch._avg.dwellMs, 60_000) / 100) / 10
          : null,
    },
    posts: reachPosts,
    activity: activity.map((r) => ({ dow: r.dow, hour: r.hour, count: Number(r.count) })),
    activitySource,
  };
}
