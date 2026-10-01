import 'server-only';

import { cookies } from 'next/headers';
import type { Gender, Prisma } from '@prisma/client';

import { ANON_TASTE_COOKIE, decodeAnonTaste, type AnonTaste } from '@/lib/anon-taste';
import { getCurrentUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import {
  getLearnedProfile,
  getViewerTastes,
  learnedFromAnon,
  learnedScore,
  tasteScore,
  type LearnedProfile,
} from '@/lib/recommend';
import type { Tastes } from '@/lib/tastes';

/**
 * ALGORITMO DE DIRECTOS ("Para ti" de los directos)
 *
 * Cada directo recibe una puntuacion distinta para cada fan, con las mismas
 * ideas que el Descubrir (lib/recommend.ts) mas las propias de un directo:
 *
 * 1. AFINIDAD: sus gustos declarados, lo que ha hecho en la app (me gusta,
 *    desbloqueos, visitas...), si sigue a la creadora, si ya le ha regalado
 *    y cuanto tiempo ha mirado sus directos antes.
 * 2. RETENCION: cuanto se queda la gente en ese directo y cuanta lo salta en
 *    segundos (LiveView). Es la senal mas fuerte, como el tiempo de
 *    visionado en TikTok, y no depende de lo famosa que sea la creadora.
 * 3. MOMENTO: regalos de los ultimos minutos. Un directo donde "esta pasando
 *    algo ahora" sube aunque tenga poca gente.
 * 4. EXPOSICION JUSTA: los primeros minutos de cada directo y las creadoras
 *    que empiezan tienen empujon, y 1 de cada 4 huecos es para un directo
 *    que aun no tiene datos de retencion. Si no, el que tiene mas publico
 *    se lo quedaria todo y nadie nuevo creceria.
 * 5. LO YA VISTO: lo que el fan acaba de saltar baja mucho; lo que ya ha
 *    mirado un buen rato baja un poco, para ensenarle algo distinto.
 *
 * El numero de espectadores cuenta, pero poco (logaritmico): sirve para
 * desempatar, no para decidir.
 */

/** Menos que esto en un directo = lo salto. */
export const SKIP_SECONDS = 8;
/** Espectadores con datos antes de fiarse de la retencion. */
const TEST_AUDIENCE = 12;
/** 1 de cada N huecos es para un directo en fase de prueba. */
const EXPLORATION_EVERY = 4;
/** Ventana del "momento". */
const MOMENTUM_MINUTES = 10;
/** Minutos de empujon al empezar un directo. */
const FRESH_MINUTES = 10;
/** Directos terminados por debajo de los cuales una creadora es "nueva". */
const NEW_CREATOR_STREAMS = 3;
/** Cuantos directos en curso se puntuan como mucho. */
const POOL_SIZE = 150;

export const liveStreamSelect = {
  id: true,
  title: true,
  viewerCount: true,
  startedAt: true,
  source: true,
  accessMode: true,
  model: {
    select: {
      id: true,
      userId: true,
      slug: true,
      stageName: true,
      avatarUrl: true,
      coverUrl: true,
      country: true,
      tier: true,
      isAi: true,
      vipRateCentitokens: true,
      gender: true,
      tags: true,
      isOnline: true,
    },
  },
} satisfies Prisma.LiveStreamSelect;

export type RankedLiveStream = Prisma.LiveStreamGetPayload<{
  select: typeof liveStreamSelect;
}>;

interface StreamStats {
  views: number;
  avgSeconds: number;
  skipRate: number;
  recentGiftTokens: number;
  recentGifts: number;
  pastStreams: number;
}

interface ViewerContext {
  tastes: Tastes | null;
  learned: LearnedProfile | null;
  follows: Set<string>;
  /** userId de creadora -> tokens regalados en total. */
  giftedTo: Map<string, number>;
  /** modelId -> segundos mirando sus directos (ultimos 30 dias). */
  watchedCreator: Map<string, number>;
  /** streamId -> segundos que ya ha mirado este directo. */
  watchedStream: Map<string, number>;
}

async function getStreamStats(
  streams: { id: string; model: { id: string } }[],
): Promise<Map<string, StreamStats>> {
  const ids = streams.map((s) => s.id);
  const since = new Date(Date.now() - MOMENTUM_MINUTES * 60_000);

  const [views, skips, gifts, past] = await Promise.all([
    prisma.liveView.groupBy({
      by: ['streamId'],
      where: { streamId: { in: ids } },
      _count: { _all: true },
      _sum: { seconds: true },
    }),
    prisma.liveView.groupBy({
      by: ['streamId'],
      where: { streamId: { in: ids }, seconds: { lt: SKIP_SECONDS } },
      _count: { _all: true },
    }),
    prisma.gift.groupBy({
      by: ['streamId'],
      where: { streamId: { in: ids }, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { tokens: true },
    }),
    prisma.liveStream.groupBy({
      by: ['modelId'],
      where: {
        modelId: { in: streams.map((s) => s.model.id) },
        status: 'ENDED',
      },
      _count: { _all: true },
    }),
  ]);

  const stats = new Map<string, StreamStats>();
  for (const stream of streams) {
    const v = views.find((x) => x.streamId === stream.id);
    const count = v?._count._all ?? 0;
    const skipped = skips.find((x) => x.streamId === stream.id)?._count._all ?? 0;
    const g = gifts.find((x) => x.streamId === stream.id);
    stats.set(stream.id, {
      views: count,
      avgSeconds: count > 0 ? (v?._sum.seconds ?? 0) / count : 0,
      skipRate: count > 0 ? skipped / count : 0,
      recentGiftTokens: g?._sum.tokens ?? 0,
      recentGifts: g?._count._all ?? 0,
      pastStreams: past.find((x) => x.modelId === stream.model.id)?._count._all ?? 0,
    });
  }
  return stats;
}

async function getViewerContext(
  viewerId: string | null,
  anonTaste: AnonTaste | null,
  streams: { id: string; model: { userId: string } }[],
): Promise<ViewerContext> {
  if (!viewerId) {
    return {
      tastes: null,
      learned: anonTaste ? learnedFromAnon(anonTaste) : null,
      follows: new Set(),
      giftedTo: new Map(),
      watchedCreator: new Map(),
      watchedStream: new Map(),
    };
  }

  const since = new Date(Date.now() - 30 * 86_400_000);
  const [tastes, learned, follows, gifts, creatorWatch, streamWatch] = await Promise.all([
    getViewerTastes(viewerId),
    getLearnedProfile(viewerId),
    prisma.follow.findMany({ where: { userId: viewerId }, select: { modelId: true } }),
    prisma.gift.groupBy({
      by: ['receiverId'],
      where: {
        senderId: viewerId,
        receiverId: { in: streams.map((s) => s.model.userId) },
      },
      _sum: { tokens: true },
    }),
    prisma.liveView.groupBy({
      by: ['modelId'],
      where: { userId: viewerId, updatedAt: { gte: since } },
      _sum: { seconds: true },
    }),
    prisma.liveView.findMany({
      where: { userId: viewerId, streamId: { in: streams.map((s) => s.id) } },
      select: { streamId: true, seconds: true },
    }),
  ]);

  return {
    tastes,
    learned,
    follows: new Set(follows.map((f) => f.modelId)),
    giftedTo: new Map(gifts.map((g) => [g.receiverId, g._sum.tokens ?? 0])),
    watchedCreator: new Map(creatorWatch.map((w) => [w.modelId, w._sum.seconds ?? 0])),
    watchedStream: new Map(streamWatch.map((w) => [w.streamId, w.seconds])),
  };
}

function scoreStream(
  stream: RankedLiveStream,
  stats: StreamStats,
  viewer: ViewerContext,
  now: number,
): number {
  const { model } = stream;

  // 1. Afinidad
  let affinity = 0;
  if (viewer.tastes) {
    affinity += tasteScore(viewer.tastes, { ...model, isLive: true });
  }
  if (viewer.learned) {
    affinity += learnedScore(viewer.learned, model);
  }
  if (viewer.follows.has(model.id)) affinity += 1.2;
  const gifted = viewer.giftedTo.get(model.userId) ?? 0;
  if (gifted > 0) affinity += 0.4 + 0.4 * Math.tanh(gifted / 500);
  affinity += 0.8 * Math.tanh((viewer.watchedCreator.get(model.id) ?? 0) / 600);

  // 2. Retencion: sin datos suficientes, neutral (ni premia ni castiga).
  let quality = 0.3;
  if (stats.views >= TEST_AUDIENCE) {
    const retention = Math.min(stats.avgSeconds / 120, 1.5);
    quality = 1.2 * retention - 1.0 * stats.skipRate;
  }

  // 3. Momento
  const momentum =
    0.8 * Math.tanh(stats.recentGiftTokens / 300) +
    0.4 * Math.tanh(stats.recentGifts / 5);

  // 4. Exposicion justa
  const minutesLive = stream.startedAt
    ? (now - stream.startedAt.getTime()) / 60_000
    : 0;
  let fairness = 0;
  if (minutesLive < FRESH_MINUTES) fairness += 0.5 * (1 - minutesLive / FRESH_MINUTES);
  if (stats.pastStreams < NEW_CREATOR_STREAMS) fairness += 0.3;

  // Popularidad: solo para desempatar.
  const popularity = 0.35 * Math.log10(1 + stream.viewerCount);

  // 5. Lo ya visto
  let seen = 0;
  const watched = viewer.watchedStream.get(stream.id);
  if (watched !== undefined) {
    if (watched < SKIP_SECONDS) seen = -1.5;
    else if (watched > 60 && !viewer.follows.has(model.id)) seen = -0.4;
  }

  return affinity + quality + momentum + fairness + popularity + seen;
}

/**
 * Ordena por puntuacion con dos correcciones:
 * - Cada EXPLORATION_EVERY huecos, el mejor directo aun en fase de prueba.
 * - Si el anterior es del mismo tipo de persona, este pierde un poco, para
 *   que el feed no sea diez directos iguales seguidos.
 */
function arrange(
  scored: { stream: RankedLiveStream; score: number; inTest: boolean }[],
): RankedLiveStream[] {
  const remaining = [...scored].sort((a, b) => b.score - a.score);
  const result: RankedLiveStream[] = [];
  let previousGender: Gender | null = null;

  while (remaining.length > 0) {
    const slot = result.length;
    let pickIndex = -1;

    if (slot % EXPLORATION_EVERY === EXPLORATION_EVERY - 1) {
      pickIndex = remaining.findIndex((c) => c.inTest);
    }
    if (pickIndex === -1) {
      let best = -Infinity;
      remaining.forEach((c, i) => {
        const adjusted = c.score - (c.stream.model.gender === previousGender ? 0.3 : 0);
        if (adjusted > best) {
          best = adjusted;
          pickIndex = i;
        }
      });
    }

    const [picked] = remaining.splice(pickIndex, 1);
    result.push(picked!.stream);
    previousGender = picked!.stream.model.gender;
  }

  return result;
}

/**
 * Directos en curso ordenados para este fan. Sirve para la portada, /live y
 * el orden de deslizar dentro de un directo.
 *
 * `geoFilter` excluye a las creadoras que bloquean el pais del visitante: si
 * no se aplicase aqui, el bloqueo geografico se saltaria simplemente entrando
 * por la portada.
 */
export async function rankLiveStreams(params: {
  viewerId: string | null;
  anonTaste?: AnonTaste | null;
  geoFilter?: Prisma.ModelProfileWhereInput;
  take?: number;
}): Promise<RankedLiveStream[]> {
  const streams = await prisma.liveStream.findMany({
    where: {
      status: 'LIVE',
      model: { kycStatus: 'APPROVED', ...(params.geoFilter ?? {}) },
    },
    orderBy: [{ viewerCount: 'desc' }, { startedAt: 'desc' }],
    take: POOL_SIZE,
    select: liveStreamSelect,
  });
  if (streams.length <= 1) return streams;

  const [stats, viewer] = await Promise.all([
    getStreamStats(streams),
    getViewerContext(params.viewerId, params.anonTaste ?? null, streams),
  ]);

  const now = Date.now();
  const scored = streams.map((stream) => {
    const s = stats.get(stream.id)!;
    return {
      stream,
      score: scoreStream(stream, s, viewer, now),
      inTest: s.views < TEST_AUDIENCE,
    };
  });

  return arrange(scored).slice(0, params.take ?? 24);
}

/**
 * rankLiveStreams para quien hace la peticion: con cuenta usa su historial;
 * sin cuenta, la cookie de gustos anonimos del Descubrir.
 */
export async function rankLiveStreamsForRequest(params: {
  geoFilter?: Prisma.ModelProfileWhereInput;
  take?: number;
}): Promise<RankedLiveStream[]> {
  const [viewer, jar] = await Promise.all([getCurrentUser(), cookies()]);
  return rankLiveStreams({
    viewerId: viewer?.id ?? null,
    anonTaste: viewer ? null : decodeAnonTaste(jar.get(ANON_TASTE_COOKIE)?.value),
    geoFilter: params.geoFilter,
    take: params.take,
  });
}
