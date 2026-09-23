import 'server-only';

import type { Gender, Prisma } from '@prisma/client';

import type { AnonTaste } from '@/lib/anon-taste';
import type { FeedPost } from '@/lib/posts';
import { getLiveStreams } from '@/lib/live';
import { prisma } from '@/lib/prisma';
import {
  getForYouFeed,
  getLearnedProfile,
  getViewerTastes,
  learnedFromAnon,
  learnedScore,
  tasteScore,
  type LearnedProfile,
} from '@/lib/recommend';
import { hasTastes, TASTE_TAGS, type Tastes } from '@/lib/tastes';

/**
 * BUSCADOR PERSONAL
 *
 * Antes de escribir, el buscador ensena un mosaico de publicaciones elegidas
 * por el recomendador para esa persona (lo que declaro en Tus gustos + lo que
 * aprendio de lo que mira, le gusta, desbloquea y sigue), cada una con su %
 * de afinidad y el motivo. Sus gustos principales sirven de filtros. Al
 * escribir, los resultados se ordenan tambien por afinidad.
 */

export interface TasteDnaSlice {
  tag: string;
  label: string;
  pct: number;
}

interface MosaicBase {
  /** % de afinidad con quien busca (40-99). null si aun no hay gustos. */
  match: number | null;
  /** Por que se la ensena, en pocas palabras. */
  reason: string;
  /** Etiquetas de la creadora (para filtrar el mosaico por gusto). */
  tags: string[];
}

export interface MosaicPostItem extends MosaicBase {
  kind: 'post';
  post: FeedPost;
}

export interface MosaicLiveItem extends MosaicBase {
  kind: 'live';
  stream: {
    id: string;
    title: string | null;
    viewerCount: number;
    model: { slug: string; stageName: string; avatarUrl: string | null; coverUrl: string | null };
  };
}

export type MosaicItem = MosaicPostItem | MosaicLiveItem;

export interface ExploreMosaic {
  personalized: boolean;
  /** Sus gustos principales, para filtrar. */
  dna: TasteDnaSlice[];
  items: MosaicItem[];
}

/** Contexto de afinidad de quien busca, reutilizable para varias consultas. */
export interface AffinityContext {
  tastes: Tastes | null;
  learned: LearnedProfile | null;
  following: Set<string>;
  ownModelId: string | null;
}

export async function getAffinityContext(params: {
  viewerId: string | null;
  ownModelId?: string | null;
  anonTaste?: AnonTaste | null;
}): Promise<AffinityContext> {
  const { viewerId } = params;
  const [tastes, learned, follows] = await Promise.all([
    getViewerTastes(viewerId),
    viewerId
      ? getLearnedProfile(viewerId)
      : Promise.resolve(params.anonTaste ? learnedFromAnon(params.anonTaste) : null),
    viewerId
      ? prisma.follow.findMany({ where: { userId: viewerId }, select: { modelId: true } })
      : Promise.resolve([]),
  ]);
  return {
    tastes,
    learned,
    following: new Set(follows.map((f) => f.modelId)),
    ownModelId: params.ownModelId ?? null,
  };
}

export function isPersonalized(ctx: AffinityContext) {
  return hasTastes(ctx.tastes) || (ctx.learned?.signals ?? 0) >= 3 || ctx.following.size > 0;
}

/** Puntuacion cruda -> % de afinidad, repartido de forma legible (40-99). */
function toPercent(raw: number) {
  const p = 1 / (1 + Math.exp(-(raw - 0.4) * 1.8));
  return Math.round(40 + p * 59);
}

type CreatorBits = {
  id: string;
  gender: Gender;
  tags: string[];
  isOnline: boolean;
  isLive: boolean;
};

/** % de afinidad de una creadora y el motivo principal. */
export function affinityOf(
  ctx: AffinityContext,
  c: CreatorBits,
  dnaTop: string[] = [],
): { match: number; reason: string } {
  let raw = 0;
  if (ctx.tastes && hasTastes(ctx.tastes)) raw += tasteScore(ctx.tastes, c);
  if (ctx.learned) raw += learnedScore(ctx.learned, c);
  const follows = ctx.following.has(c.id);
  if (follows) raw += 0.8;

  let reason = 'Popular ahora';
  const creatorWeight = ctx.learned?.creators.get(c.id) ?? 0;
  const sharedTag = dnaTop.find((t) => c.tags.includes(t));
  if (follows) reason = 'La sigues';
  else if (creatorWeight >= 4) reason = 'La miras a menudo';
  else if (sharedTag) reason = `Te gusta #${sharedTag}`;
  else if (ctx.tastes?.preferredGenders.includes(c.gender)) reason = 'Tu tipo';

  return { match: toPercent(raw), reason };
}

/** ADN de gustos: lo declarado pesa, lo aprendido suma. Top 6 en %. */
function buildDna(ctx: AffinityContext): TasteDnaSlice[] {
  const weights = new Map<string, number>();
  for (const tag of ctx.tastes?.interests ?? []) weights.set(tag, (weights.get(tag) ?? 0) + 3);
  for (const [tag, w] of ctx.learned?.tags ?? []) {
    if (w > 0) weights.set(tag, (weights.get(tag) ?? 0) + w);
  }
  const known = new Map(TASTE_TAGS.map((t) => [t.id, t.label]));
  const top = [...weights.entries()]
    .filter(([tag]) => known.has(tag))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const total = top.reduce((a, [, w]) => a + w, 0);
  if (total <= 0) return [];
  // Redondeo que suma 100.
  const slices = top.map(([tag, w]) => ({ tag, label: known.get(tag)!, pct: (w / total) * 100 }));
  const rounded = slices.map((s) => ({ ...s, pct: Math.floor(s.pct) }));
  let rest = 100 - rounded.reduce((a, s) => a + s.pct, 0);
  for (let i = 0; rest > 0; i = (i + 1) % rounded.length, rest -= 1) rounded[i]!.pct += 1;
  return rounded;
}

/**
 * Mosaico del buscador: las publicaciones que el recomendador elige para
 * esta persona (las mismas reglas que el Descubrir, incluida la visibilidad
 * justa para creadoras nuevas), con su afinidad y el motivo.
 */
export async function getExploreMosaic(params: {
  ctx: AffinityContext;
  viewerId: string | null;
  anonTaste?: AnonTaste | null;
  geoFilter: Prisma.ModelProfileWhereInput;
}): Promise<ExploreMosaic> {
  const { ctx } = params;
  const [ranked, lives] = await Promise.all([
    getForYouFeed({
      viewerId: params.viewerId,
      geoFilter: params.geoFilter,
      take: 60,
      sessionStart: new Date(),
      anonTaste: params.anonTaste ?? null,
    }),
    getLiveStreams({ geoFilter: params.geoFilter, take: 8 }),
  ]);

  // Solo lo visual: publicaciones con fotos o videos (sin texto suelto ni
  // encuestas), y nunca las propias.
  const posts = ranked
    .filter((p) => p.assets.length > 0 && p.model.id !== ctx.ownModelId)
    .slice(0, 36);
  const liveList = lives.filter((l) => l.model.id !== ctx.ownModelId);

  const modelIds = [...new Set([...posts.map((p) => p.model.id), ...liveList.map((l) => l.model.id)])];
  const models = await prisma.modelProfile.findMany({
    where: { id: { in: modelIds } },
    select: { id: true, gender: true, tags: true, createdAt: true, isOnline: true },
  });
  const byId = new Map(models.map((m) => [m.id, m]));

  const dna = buildDna(ctx);
  const dnaTop = dna.map((d) => d.tag);
  const personalized = isPersonalized(ctx);
  const monthAgo = Date.now() - 30 * 86_400_000;

  const affinity = (modelId: string, isLive: boolean) => {
    const m = byId.get(modelId);
    const bits = {
      id: modelId,
      gender: m?.gender ?? ('FEMALE' as const),
      tags: m?.tags ?? [],
      isOnline: m?.isOnline ?? false,
      isLive,
    };
    const { match, reason } = affinityOf(ctx, bits, dnaTop);
    const isNew = m ? m.createdAt.getTime() > monthAgo : false;
    return {
      match: personalized ? match : null,
      reason: personalized ? reason : isNew ? 'Creadora nueva' : 'Popular ahora',
      tags: bits.tags,
    };
  };

  const postItems: MosaicItem[] = posts.map((post) => ({
    kind: 'post',
    post,
    ...affinity(post.model.id, post.model.isLive),
  }));
  const liveItems: MosaicItem[] = liveList
    .map((l) => {
      const a = affinity(l.model.id, true);
      return {
        kind: 'live' as const,
        stream: {
          id: l.id,
          title: l.title,
          viewerCount: l.viewerCount,
          model: {
            slug: l.model.slug,
            stageName: l.model.stageName,
            avatarUrl: l.model.avatarUrl,
            coverUrl: l.model.coverUrl,
          },
        },
        ...a,
        reason: 'En directo ahora',
      };
    })
    // Los directos que mas encajan, primero.
    .sort((x, y) => (y.match ?? 0) - (x.match ?? 0));

  // Directos repartidos por el mosaico (despues de la primera publicacion y
  // luego cada 5), para que se vean sin tapar las publicaciones.
  const items: MosaicItem[] = [];
  let li = 0;
  postItems.forEach((item, i) => {
    items.push(item);
    if (li < liveItems.length && (i === 0 || (i > 0 && i % 5 === 0))) items.push(liveItems[li++]!);
  });
  while (li < liveItems.length) items.push(liveItems[li++]!);

  return { personalized, dna, items };
}
