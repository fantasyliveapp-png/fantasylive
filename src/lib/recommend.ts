import 'server-only';

import type { Gender, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { buildFeedPosts, feedPostSelect, livePostWhere, type FeedPost } from '@/lib/posts';
import { hasTastes, type Tastes } from '@/lib/tastes';

/**
 * RECOMENDADOR DEL DESCUBRIR
 *
 * Funciona como TikTok en dos ideas:
 *
 * 1. APRENDE DE CADA FAN. Ademas de lo que respondio en "Tus gustos", cuenta
 *    lo que hace: a quien da me gusta, que desbloquea, que comenta, a quien
 *    sigue, que perfiles visita y que marca como "No me interesa". De ahi
 *    saca que creadoras, etiquetas y tipo de persona le gustan.
 *
 * 2. EXPOSICION JUSTA PARA TODAS LAS CREADORAS. Cada publicacion nueva recibe
 *    un empujon hasta que la han visto ~40 personas, tenga la creadora 10
 *    seguidores o 10.000. Ademas, 1 de cada 4 huecos del feed se reserva a
 *    publicaciones que aun estan en esa fase de prueba. Despues, lo que manda
 *    es como funciona (me gusta, comentarios y desbloqueos por cada persona
 *    que la vio), no cuantos seguidores tiene: una publicacion que gusta
 *    sigue circulando mas tiempo aunque sea de alguien pequeno.
 *
 * Lo que ya vio baja, lo marcado como "No me interesa" desaparece, y una
 * misma creadora no puede llenar la pagina.
 */

/** Cuantas publicaciones recientes se puntuan en cada carga. */
const POOL_SIZE = 300;
/** Antiguedad maxima de las candidatas; lo anterior sigue en orden de fecha. */
const POOL_MAX_AGE_DAYS = 21;
/** Personas que deben verla antes de juzgar como funciona. */
const TEST_AUDIENCE = 40;
/** 1 de cada N huecos es para una publicacion en fase de prueba. */
const EXPLORATION_EVERY = 4;
/** Ventana de comportamiento que se tiene en cuenta. */
const LEARN_DAYS = 90;

// Peso de cada senal al aprender los gustos de un fan.
const SIGNAL = {
  like: 2,
  comment: 3,
  unlock: 5,
  follow: 4,
  visit: 1,
  hide: -4,
} as const;

export async function getViewerTastes(viewerId: string | null): Promise<Tastes | null> {
  if (!viewerId) return null;
  return prisma.user.findUnique({
    where: { id: viewerId },
    select: { preferredGenders: true, interests: true, lookingFor: true },
  });
}

/** Cuanto encaja una creadora con los gustos DECLARADOS (Tus gustos). */
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

// ---------------------------------------------------------------------------
// Lo que el fan HACE
// ---------------------------------------------------------------------------

interface LearnedProfile {
  creators: Map<string, number>;
  tags: Map<string, number>;
  genders: Map<Gender, number>;
  tagTotal: number;
  genderTotal: number;
  /** Cuantas senales hay: con muy pocas no se fia de lo aprendido. */
  signals: number;
  hiddenPosts: Set<string>;
}

type ModelBits = { id: string; gender: Gender; tags: string[] };

async function getLearnedProfile(viewerId: string): Promise<LearnedProfile> {
  const since = new Date(Date.now() - LEARN_DAYS * 86_400_000);
  const model = { select: { id: true, gender: true, tags: true } } as const;
  const viaPost = { post: { select: { model } } } as const;

  const [likes, comments, unlocks, follows, visits, hides] = await Promise.all([
    prisma.postLike.findMany({
      where: { userId: viewerId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 400,
      select: viaPost,
    }),
    prisma.postComment.findMany({
      where: { userId: viewerId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: viaPost,
    }),
    prisma.postUnlock.findMany({
      where: { userId: viewerId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: viaPost,
    }),
    prisma.follow.findMany({ where: { userId: viewerId }, take: 500, select: { model } }),
    prisma.profileVisit.findMany({
      where: { viewerId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: { model },
    }),
    prisma.postHide.findMany({
      where: { userId: viewerId },
      orderBy: { createdAt: 'desc' },
      take: 400,
      select: { postId: true, ...viaPost },
    }),
  ]);

  const profile: LearnedProfile = {
    creators: new Map(),
    tags: new Map(),
    genders: new Map(),
    tagTotal: 0,
    genderTotal: 0,
    signals: 0,
    hiddenPosts: new Set(hides.map((h) => h.postId)),
  };

  const add = (m: ModelBits, weight: number) => {
    profile.creators.set(m.id, (profile.creators.get(m.id) ?? 0) + weight);
    if (weight > 0) {
      profile.signals += 1;
      for (const tag of m.tags) {
        profile.tags.set(tag, (profile.tags.get(tag) ?? 0) + weight);
        profile.tagTotal += weight;
      }
      profile.genders.set(m.gender, (profile.genders.get(m.gender) ?? 0) + weight);
      profile.genderTotal += weight;
    }
  };

  likes.forEach((r) => add(r.post.model, SIGNAL.like));
  comments.forEach((r) => add(r.post.model, SIGNAL.comment));
  unlocks.forEach((r) => add(r.post.model, SIGNAL.unlock));
  follows.forEach((r) => add(r.model, SIGNAL.follow));
  visits.forEach((r) => add(r.model, SIGNAL.visit));
  hides.forEach((r) => add(r.post.model, SIGNAL.hide));

  return profile;
}

/** Cuanto encaja con lo que el fan HACE. De -0.6 a ~2. */
function learnedScore(p: LearnedProfile, m: ModelBits): number {
  // Creadora concreta: saturada para que 50 me gusta no valgan 50 veces mas.
  const creator = Math.tanh((p.creators.get(m.id) ?? 0) / 10);
  // Con muy pocas senales solo cuenta lo negativo ("No me interesa").
  if (p.signals < 3) return Math.min(0, 0.6 * creator);
  // Parte de su interes que se lleva cada etiqueta de esta creadora.
  const tagShare =
    p.tagTotal > 0
      ? m.tags.reduce((sum, t) => sum + (p.tags.get(t) ?? 0), 0) / p.tagTotal
      : 0;
  const genderShare = p.genderTotal > 0 ? (p.genders.get(m.gender) ?? 0) / p.genderTotal : 0;
  return 0.6 * creator + 1.2 * Math.min(tagShare * 2, 1) + 0.5 * genderShare;
}

// ---------------------------------------------------------------------------
// Puntuacion
// ---------------------------------------------------------------------------

interface Candidate {
  id: string;
  createdAt: Date;
  modelId: string;
  model: ModelBits & {
    isOnline: boolean;
    isLive: boolean;
    followersCount: number;
    createdAt: Date;
  };
  hasMedia: boolean;
  views: number;
  engagement: number;
}

interface Scored extends Candidate {
  score: number;
  inTest: boolean;
}

function scoreCandidates(params: {
  candidates: Candidate[];
  tastes: Tastes | null;
  learned: LearnedProfile | null;
  following: Set<string>;
  seenBefore: Set<string>;
}): Scored[] {
  const { candidates, tastes, learned, following, seenBefore } = params;
  const now = Date.now();

  // Tasa media de interaccion de todo el bote: lo "normal" contra lo que se
  // compara cada publicacion. Con pocas vistas se confia poco en su tasa.
  const totals = candidates.reduce(
    (acc, c) => ({ eng: acc.eng + c.engagement, views: acc.views + c.views }),
    { eng: 0, views: 0 },
  );
  const baseRate = totals.views > 50 ? Math.max(totals.eng / totals.views, 0.02) : 0.1;

  return candidates.map((c) => {
    const smoothedRate = (c.engagement + baseRate * 20) / (c.views + 20);
    const confidence = c.views / (c.views + 20);
    const performance =
      Math.max(-0.6, Math.min(1.5, (smoothedRate - baseRate) / baseRate)) * confidence;

    // Lo que funciona envejece mas despacio (sigue circulando mas dias).
    const hours = (now - c.createdAt.getTime()) / 3_600_000;
    const effectiveHours = hours / (1 + Math.max(0, performance));
    let score = 1.5 / (1 + effectiveHours / 36);

    score += 0.6 * performance;

    // Fase de prueba: empujon hasta que la vean TEST_AUDIENCE personas.
    const inTest = c.views < TEST_AUDIENCE;
    if (inTest) score += 0.8 * (1 - c.views / TEST_AUDIENCE);

    // Creadoras nuevas o pequenas: un poco de ayuda para arrancar.
    const creatorAgeDays = (now - c.model.createdAt.getTime()) / 86_400_000;
    if (creatorAgeDays < 30) score += 0.2;
    if (c.model.followersCount < 50) score += 0.1;

    const isLive = c.model.isLive;
    if (tastes && hasTastes(tastes)) score += tasteScore(tastes, { ...c.model, isLive });
    if (tastes?.lookingFor.includes('fotos') && c.hasMedia) score += 0.15;
    if (learned) score += learnedScore(learned, c.model);
    if (following.has(c.modelId)) score += 0.3;

    // Ya la vio en otra visita: baja mucho, pero no desaparece.
    if (seenBefore.has(c.id)) score -= 1.2;

    return { ...c, score, inTest };
  });
}

/**
 * Ordena con variedad (cada vez que sale una creadora, lo suyo vale un poco
 * menos) y reserva 1 de cada EXPLORATION_EVERY huecos a publicaciones en
 * fase de prueba, las menos vistas primero.
 */
function arrange(scored: Scored[], seenBefore: Set<string>): string[] {
  const shown = new Map<string, number>();
  const used = new Set<string>();
  const ordered: string[] = [];

  const explorers = scored
    .filter((c) => c.inTest && !seenBefore.has(c.id))
    .sort((a, b) => a.views - b.views || b.createdAt.getTime() - a.createdAt.getTime());
  let explorerIdx = 0;

  const take = (c: Scored) => {
    ordered.push(c.id);
    used.add(c.id);
    shown.set(c.modelId, (shown.get(c.modelId) ?? 0) + 1);
  };

  while (ordered.length < scored.length) {
    // Hueco de exploracion.
    if ((ordered.length + 1) % EXPLORATION_EVERY === 0) {
      while (explorerIdx < explorers.length && used.has(explorers[explorerIdx]!.id)) {
        explorerIdx += 1;
      }
      const explorer = explorers[explorerIdx];
      if (explorer) {
        take(explorer);
        continue;
      }
    }

    let best: Scored | null = null;
    let bestScore = -Infinity;
    for (const c of scored) {
      if (used.has(c.id)) continue;
      const s = c.score - 0.35 * (shown.get(c.modelId) ?? 0);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (!best) break;
    take(best);
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

/**
 * Descubrir, paginado por numero de pagina. `sessionStart` es cuando se
 * cargo la primera pagina: lo visto DESPUES (en esta misma sesion) no se
 * penaliza, para que el orden no cambie entre paginas.
 */
export async function getForYouFeed(params: {
  viewerId: string | null;
  geoFilter: Prisma.ModelProfileWhereInput;
  page: number;
  take: number;
  sessionStart: Date;
}): Promise<FeedPost[]> {
  const { viewerId, take } = params;
  const baseWhere: Prisma.PostWhereInput = {
    ...livePostWhere(),
    model: { kycStatus: 'APPROVED', ...params.geoFilter },
  };
  const poolSince = new Date(Date.now() - POOL_MAX_AGE_DAYS * 86_400_000);

  const [pool, tastes, learned, follows, seen] = await Promise.all([
    prisma.post.findMany({
      where: { ...baseWhere, createdAt: { ...(baseWhere.createdAt as object), gte: poolSince } },
      orderBy: { createdAt: 'desc' },
      take: POOL_SIZE,
      select: {
        id: true,
        createdAt: true,
        modelId: true,
        viewCount: true,
        likeCount: true,
        commentCount: true,
        unlockCount: true,
        _count: { select: { assets: true } },
        model: {
          select: {
            id: true,
            gender: true,
            tags: true,
            isOnline: true,
            followersCount: true,
            createdAt: true,
            streams: { where: { status: 'LIVE' }, select: { id: true }, take: 1 },
          },
        },
      },
    }),
    getViewerTastes(viewerId),
    viewerId ? getLearnedProfile(viewerId) : Promise.resolve(null),
    viewerId
      ? prisma.follow.findMany({ where: { userId: viewerId }, select: { modelId: true } })
      : Promise.resolve([]),
    viewerId
      ? prisma.postImpression.findMany({
          where: {
            userId: viewerId,
            createdAt: { lt: params.sessionStart },
            post: { createdAt: { gte: poolSince } },
          },
          select: { postId: true },
        })
      : Promise.resolve([]),
  ]);

  const candidates: Candidate[] = pool
    .filter((p) => !learned?.hiddenPosts.has(p.id))
    .map((p) => ({
      id: p.id,
      createdAt: p.createdAt,
      modelId: p.modelId,
      model: {
        id: p.model.id,
        gender: p.model.gender,
        tags: p.model.tags,
        isOnline: p.model.isOnline,
        isLive: p.model.streams.length > 0,
        followersCount: p.model.followersCount,
        createdAt: p.model.createdAt,
      },
      hasMedia: p._count.assets > 0,
      views: p.viewCount,
      // Desbloquear pesa mas que comentar, y comentar mas que un me gusta.
      engagement: p.likeCount + 2 * p.commentCount + 3 * p.unlockCount,
    }));

  const seenBefore = new Set(seen.map((s) => s.postId));
  const ordered = arrange(
    scoreCandidates({
      candidates,
      tastes,
      learned,
      following: new Set(follows.map((f) => f.modelId)),
      seenBefore,
    }),
    seenBefore,
  );

  const start = params.page * take;
  const pageIds = ordered.slice(start, start + take);

  // Pasado el bote, lo anterior en orden de fecha.
  let older: Awaited<ReturnType<typeof fetchPosts>> = [];
  if (pageIds.length < take) {
    older = await prisma.post.findMany({
      where: {
        ...baseWhere,
        createdAt: { lt: poolSince },
        ...(learned?.hiddenPosts.size ? { id: { notIn: [...learned.hiddenPosts] } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip: Math.max(0, start - ordered.length),
      take: take - pageIds.length,
      select: feedPostSelect,
    });
  }

  const ranked = await fetchPosts(pageIds);
  return buildFeedPosts([...ranked, ...older], viewerId);
}

async function fetchPosts(ids: string[]) {
  if (ids.length === 0) return [];
  const posts = await prisma.post.findMany({
    where: { id: { in: ids } },
    select: feedPostSelect,
  });
  const byId = new Map(posts.map((p) => [p.id, p]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

// ---------------------------------------------------------------------------
// Creadoras sugeridas (ultimo paso de la bienvenida)
// ---------------------------------------------------------------------------

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
      createdAt: true,
      streams: { where: { status: 'LIVE' }, select: { id: true }, take: 1 },
    },
  });

  const now = Date.now();
  const ranked = candidates
    .map((m) => ({
      m,
      // Sin premiar la popularidad: una creadora nueva que encaja sale igual
      // que una grande. Las nuevas llevan un pequeno empujon.
      score:
        tasteScore(params.tastes, { ...m, isLive: m.streams.length > 0 }) +
        (m.isOnline ? 0.1 : 0) +
        ((now - m.createdAt.getTime()) / 86_400_000 < 30 ? 0.15 : 0) +
        Math.random() * 0.1,
    }))
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, params.take ?? 12).map(({ m }) => ({
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
