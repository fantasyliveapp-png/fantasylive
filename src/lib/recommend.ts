import 'server-only';

import type { Gender, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { buildFeedPosts, feedPostSelect, livePostWhere, type FeedPost } from '@/lib/posts';
import { hasTastes, type Tastes } from '@/lib/tastes';

/**
 * RECOMENDADOR del Descubrir ("para ti").
 *
 * Toma las publicaciones mas recientes (un "bote" de candidatas), les da una
 * puntuacion segun los gustos de quien mira y las ordena. No es un filtro:
 * lo que no encaja baja, pero sigue ahi, para no encerrar a nadie en una
 * burbuja. Pasado el bote, el feed sigue en orden cronologico.
 *
 * Puntuacion = lo reciente que es + lo que encaja con sus gustos, y se
 * penaliza repetir creadora para que la pagina no sea de una sola persona.
 */

const POOL_SIZE = 200;

export async function getViewerTastes(viewerId: string | null): Promise<Tastes | null> {
  if (!viewerId) return null;
  return prisma.user.findUnique({
    where: { id: viewerId },
    select: { preferredGenders: true, interests: true, lookingFor: true },
  });
}

interface Candidate {
  id: string;
  createdAt: Date;
  modelId: string;
  hasMedia: boolean;
  gender: Gender;
  tags: string[];
  isOnline: boolean;
  isLive: boolean;
}

/** Cuanto encaja una creadora con los gustos (sin contar lo reciente). */
export function tasteScore(
  tastes: Tastes,
  model: { gender: Gender; tags: string[]; isOnline: boolean; isLive: boolean },
): number {
  let score = 0;
  if (tastes.preferredGenders.length > 0) {
    score += tastes.preferredGenders.includes(model.gender) ? 0.6 : -0.9;
  }
  const overlap = model.tags.filter((t) => tastes.interests.includes(t)).length;
  score += Math.min(overlap, 3) * 0.35;
  if (tastes.lookingFor.includes('directos') && model.isLive) score += 0.5;
  if (
    model.isOnline &&
    (tastes.lookingFor.includes('chatear') || tastes.lookingFor.includes('videollamadas'))
  ) {
    score += 0.2;
  }
  return score;
}

function rank(candidates: Candidate[], tastes: Tastes, following: Set<string>): string[] {
  const now = Date.now();
  const scored = candidates.map((c) => {
    const hours = (now - c.createdAt.getTime()) / 3_600_000;
    let score = 1.5 / (1 + hours / 36) + tasteScore(tastes, c);
    if (tastes.lookingFor.includes('fotos') && c.hasMedia) score += 0.15;
    if (following.has(c.modelId)) score += 0.3;
    return { ...c, score };
  });

  // Seleccion voraz: cada vez que sale una creadora, sus siguientes
  // publicaciones valen un poco menos.
  const shown = new Map<string, number>();
  const ordered: string[] = [];
  const left = [...scored];
  while (left.length > 0) {
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < left.length; i += 1) {
      const s = left[i]!.score - 0.35 * (shown.get(left[i]!.modelId) ?? 0);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    const [pick] = left.splice(best, 1);
    ordered.push(pick!.id);
    shown.set(pick!.modelId, (shown.get(pick!.modelId) ?? 0) + 1);
  }
  return ordered;
}

/**
 * Descubrir personalizado, paginado por numero de pagina (0, 1, 2...).
 * Sin gustos guardados es el orden cronologico de siempre.
 */
export async function getForYouFeed(params: {
  viewerId: string | null;
  geoFilter: Prisma.ModelProfileWhereInput;
  page: number;
  take: number;
}): Promise<FeedPost[]> {
  const where: Prisma.PostWhereInput = {
    ...livePostWhere(),
    model: { kycStatus: 'APPROVED', ...params.geoFilter },
  };
  const start = params.page * params.take;
  const tastes = await getViewerTastes(params.viewerId);

  // Pasado el bote (o sin gustos), cronologico: las posiciones >= POOL_SIZE
  // son exactamente las mismas en ambos ordenes.
  if (!hasTastes(tastes) || start >= POOL_SIZE) {
    const posts = await prisma.post.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: start,
      take: params.take,
      select: feedPostSelect,
    });
    return buildFeedPosts(posts, params.viewerId);
  }

  const [pool, follows] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: POOL_SIZE,
      select: {
        id: true,
        createdAt: true,
        modelId: true,
        _count: { select: { assets: true } },
        model: {
          select: {
            gender: true,
            tags: true,
            isOnline: true,
            streams: { where: { status: 'LIVE' }, select: { id: true }, take: 1 },
          },
        },
      },
    }),
    params.viewerId
      ? prisma.follow.findMany({ where: { userId: params.viewerId }, select: { modelId: true } })
      : Promise.resolve([]),
  ]);

  const ordered = rank(
    pool.map((p) => ({
      id: p.id,
      createdAt: p.createdAt,
      modelId: p.modelId,
      hasMedia: p._count.assets > 0,
      gender: p.model.gender,
      tags: p.model.tags,
      isOnline: p.model.isOnline,
      isLive: p.model.streams.length > 0,
    })),
    tastes,
    new Set(follows.map((f) => f.modelId)),
  );

  const pageIds = ordered.slice(start, start + params.take);
  if (pageIds.length === 0) return [];

  const posts = await prisma.post.findMany({
    where: { id: { in: pageIds } },
    select: feedPostSelect,
  });
  const byId = new Map(posts.map((p) => [p.id, p]));
  return buildFeedPosts(
    pageIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    params.viewerId,
  );
}

/** Creadoras para seguir segun los gustos (paso final de la bienvenida). */
export async function getSuggestedCreators(params: {
  viewerId: string;
  tastes: Tastes;
  geoFilter: Prisma.ModelProfileWhereInput;
  take?: number;
}) {
  const followed = await prisma.follow.findMany({
    where: { userId: params.viewerId },
    select: { modelId: true },
  });

  const candidates = await prisma.modelProfile.findMany({
    where: {
      kycStatus: 'APPROVED',
      userId: { not: params.viewerId },
      id: { notIn: followed.map((f) => f.modelId) },
      ...params.geoFilter,
    },
    orderBy: [{ followersCount: 'desc' }, { ratingAvg: 'desc' }],
    take: 150,
    select: {
      id: true,
      slug: true,
      stageName: true,
      headline: true,
      avatarUrl: true,
      coverUrl: true,
      gender: true,
      tags: true,
      isOnline: true,
      followersCount: true,
      streams: { where: { status: 'LIVE' }, select: { id: true }, take: 1 },
    },
  });

  return candidates
    .map((m, i) => ({
      m,
      // Popularidad como desempate suave (ya vienen ordenadas por ella).
      score:
        tasteScore(params.tastes, { ...m, isLive: m.streams.length > 0 }) +
        (m.isOnline ? 0.1 : 0) -
        i * 0.002,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, params.take ?? 12)
    .map(({ m }) => ({
      id: m.id,
      slug: m.slug,
      stageName: m.stageName,
      headline: m.headline,
      avatarUrl: m.avatarUrl,
      coverUrl: m.coverUrl,
      tags: m.tags.filter((t) => params.tastes.interests.includes(t)).slice(0, 3),
      isOnline: m.isOnline,
      isLive: m.streams.length > 0,
      followersCount: m.followersCount,
    }));
}

export type SuggestedCreator = Awaited<ReturnType<typeof getSuggestedCreators>>[number];
