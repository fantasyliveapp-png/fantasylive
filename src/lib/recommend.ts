import 'server-only';

import type { Gender, Prisma } from '@prisma/client';

import type { AnonTaste } from '@/lib/anon-taste';
import { prisma } from '@/lib/prisma';
import { buildFeedPosts, feedPostSelect, livePostWhere, type FeedPost } from '@/lib/posts';
import { hasTastes, type Tastes } from '@/lib/tastes';

/**
 * RECOMENDADOR DEL DESCUBRIR
 *
 * Funciona como TikTok en dos ideas:
 *
 * 1. APRENDE DE CADA FAN. Ademas de lo que respondio en "Tus gustos", cuenta
 *    lo que hace: cuanto tiempo mira cada publicacion (y si ve el video
 *    entero o la pasa de largo), a quien da me gusta, que desbloquea, que
 *    comenta, a quien sigue, que perfiles visita y que marca como "No me
 *    interesa". Sin cuenta tambien aprende, con una cookie (anon-taste.ts).
 *
 * 2. EXPOSICION JUSTA PARA TODAS LAS CREADORAS. Cada publicacion nueva recibe
 *    un empujon hasta que la han visto ~40 personas, tenga la creadora 10
 *    seguidores o 10.000. Ademas, 1 de cada 4 huecos del feed se reserva a
 *    publicaciones que aun estan en esa fase de prueba. Despues, lo que manda
 *    es como funciona (me gusta, comentarios y desbloqueos por cada persona
 *    que la vio, cuanto tiempo la miran, cuanta gente ve el video entero y
 *    cuanta la pasa de largo), no cuantos seguidores tiene: una que gusta
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
  /** La miro 8 s o mas */
  longView: 1,
  /** Vio el video entero */
  completed: 2,
  /** La paso de largo (< 1,5 s) */
  skip: -0.5,
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

export interface LearnedProfile {
  creators: Map<string, number>;
  tags: Map<string, number>;
  genders: Map<Gender, number>;
  tagTotal: number;
  genderTotal: number;
  /** Cuantas senales hay: con muy pocas no se fia de lo aprendido. */
  signals: number;
  hiddenPosts: Set<string>;
}

export type ModelBits = { id: string; gender: Gender; tags: string[] };

export async function getLearnedProfile(viewerId: string): Promise<LearnedProfile> {
  const since = new Date(Date.now() - LEARN_DAYS * 86_400_000);
  const model = { select: { id: true, gender: true, tags: true } } as const;
  const viaPost = { post: { select: { model } } } as const;

  const [likes, comments, unlocks, follows, visits, hides, views] = await Promise.all([
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
    prisma.postImpression.findMany({
      where: { userId: viewerId, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      orderBy: { createdAt: 'desc' },
      take: 600,
      select: { dwellMs: true, completed: true, ...viaPost },
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
  views.forEach((r) => {
    if (r.completed) add(r.post.model, SIGNAL.completed);
    if (r.dwellMs >= 8000) add(r.post.model, SIGNAL.longView);
    else if (r.dwellMs < 1500 && !r.completed) add(r.post.model, SIGNAL.skip);
  });

  return profile;
}

/** Lo aprendido de alguien sin cuenta (cookie) con la misma forma. */
export function learnedFromAnon(taste: AnonTaste): LearnedProfile {
  const sum = (o: Record<string, number>) =>
    Object.values(o).reduce((a, v) => a + Math.max(0, v), 0);
  const positive = (o: Record<string, number>) =>
    new Map(Object.entries(o).filter(([, v]) => v > 0));
  return {
    creators: new Map(Object.entries(taste.c)),
    tags: positive(taste.t),
    genders: positive(taste.g as Record<string, number>) as Map<Gender, number>,
    tagTotal: sum(taste.t),
    genderTotal: sum(taste.g as Record<string, number>),
    signals: taste.n,
    hiddenPosts: new Set(),
  };
}

/** Cuanto encaja con lo que el fan HACE. De -0.6 a ~2. */
export function learnedScore(p: LearnedProfile, m: ModelBits): number {
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
  hasVideo: boolean;
  views: number;
  engagement: number;
  /** Tiempo total que la han mirado (ms) */
  watchMs: number;
  completions: number;
  skips: number;
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

  // Lo "normal" en el bote, contra lo que se compara cada publicacion. Con
  // pocas vistas se confia poco en sus numeros (se mezclan con la media).
  const totals = candidates.reduce(
    (acc, c) => ({
      eng: acc.eng + c.engagement,
      views: acc.views + c.views,
      watch: acc.watch + c.watchMs,
      skips: acc.skips + c.skips,
      videoViews: acc.videoViews + (c.hasVideo ? c.views : 0),
      completions: acc.completions + (c.hasVideo ? c.completions : 0),
    }),
    { eng: 0, views: 0, watch: 0, skips: 0, videoViews: 0, completions: 0 },
  );
  const enough = totals.views > 50;
  const baseRate = enough ? Math.max(totals.eng / totals.views, 0.02) : 0.1;
  const baseWatch = enough ? Math.max(totals.watch / totals.views, 1000) : 5000;
  const baseSkip = enough ? Math.max(totals.skips / totals.views, 0.05) : 0.3;
  const baseComplete =
    totals.videoViews > 50 ? Math.max(totals.completions / totals.videoViews, 0.05) : 0.3;
  const K = 20;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  return candidates.map((c) => {
    const confidence = c.views / (c.views + K);
    const rate = (c.engagement + baseRate * K) / (c.views + K);
    const watch = (c.watchMs + baseWatch * K) / (c.views + K);
    const skip = (c.skips + baseSkip * K) / (c.views + K);
    const perfEng = clamp((rate - baseRate) / baseRate, -0.6, 1.5);
    const perfWatch = clamp((watch - baseWatch) / baseWatch, -0.6, 1);
    const perfSkip = clamp((baseSkip - skip) / baseSkip, -0.6, 0.6);
    let performance = 0.5 * perfEng + 0.35 * perfWatch + 0.15 * perfSkip;
    if (c.hasVideo) {
      const complete = (c.completions + baseComplete * K) / (c.views + K);
      performance += 0.3 * clamp((complete - baseComplete) / baseComplete, -0.6, 1);
    }
    performance *= confidence;

    // Lo que funciona envejece mas despacio (sigue circulando mas dias).
    const hours = (now - c.createdAt.getTime()) / 3_600_000;
    const effectiveHours = hours / (1 + Math.max(0, performance));
    let score = 1.5 / (1 + effectiveHours / 36);

    score += 0.8 * performance;

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
 * Descubrir para el scroll infinito: devuelve las `take` mejores que aun no
 * se le han ensenado en esta sesion (`exclude`). `sessionStart` es cuando
 * empezo a mirar: lo visto DESPUES no se penaliza como "ya visto".
 * Sin cuenta, `anonTaste` son sus gustos aprendidos (cookie).
 */
export async function getForYouFeed(params: {
  viewerId: string | null;
  geoFilter: Prisma.ModelProfileWhereInput;
  take: number;
  sessionStart: Date;
  exclude?: string[];
  anonTaste?: AnonTaste | null;
}): Promise<FeedPost[]> {
  const { viewerId, take } = params;
  const exclude = new Set(params.exclude ?? []);
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
        watchMs: true,
        completions: true,
        skips: true,
        assets: { select: { mimeType: true }, take: 20 },
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
    viewerId
      ? getLearnedProfile(viewerId)
      : Promise.resolve(params.anonTaste ? learnedFromAnon(params.anonTaste) : null),
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
      hasMedia: p.assets.length > 0,
      hasVideo: p.assets.some((a) => a.mimeType.startsWith('video/')),
      views: p.viewCount,
      watchMs: Number(p.watchMs),
      completions: p.completions,
      skips: p.skips,
      // Desbloquear pesa mas que comentar, y comentar mas que un me gusta.
      engagement: p.likeCount + 2 * p.commentCount + 3 * p.unlockCount,
    }));

  const seenBefore = new Set([
    ...seen.map((s) => s.postId),
    // Sin cuenta: lo que ya vio segun su cookie (menos lo de esta sesion).
    ...(viewerId ? [] : (params.anonTaste?.s ?? []).filter((id) => !exclude.has(id))),
  ]);
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

  const pageIds = ordered.filter((id) => !exclude.has(id)).slice(0, take);

  // Pasado el bote, lo anterior en orden de fecha.
  let older: Awaited<ReturnType<typeof fetchPosts>> = [];
  if (pageIds.length < take) {
    const skipIds = [...exclude, ...(learned?.hiddenPosts ?? [])];
    older = await prisma.post.findMany({
      where: {
        ...baseWhere,
        createdAt: { lt: poolSince },
        ...(skipIds.length ? { id: { notIn: skipIds } } : {}),
      },
      orderBy: { createdAt: 'desc' },
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
