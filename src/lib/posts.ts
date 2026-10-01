import 'server-only';

import { discountTokens } from '@/lib/creator-offer-rules';
import { getContentOffersFor, type AppliedOffer } from '@/lib/creator-offers';
import type { PostVisibility, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { resolveAssetUrl } from '@/lib/storage';
import { watermarkLabel } from '@/lib/watermark';

/**
 * FEED SOCIAL
 *
 * Una publicacion LOCKED se ve borrosa hasta pagarla. El difuminado NO se
 * hace con CSS sobre el original: eso dejaria la imagen completa en el HTML y
 * bastaria abrir el inspector (o la pestana de red) para verla. Lo que viaja
 * al navegador es `previewKey`, una miniatura de ~32 px generada al subir; la
 * clave del original solo se firma para quien tiene derecho a verla.
 */

export interface FeedAsset {
  id: string;
  mimeType: string;
  /** URL firmada del original. null si no se ha desbloqueado. */
  url: string | null;
  /** Miniatura difuminada, siempre disponible si existe. */
  previewUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface FeedPoll {
  id: string;
  question: string;
  /** ISO. null = sin fecha de cierre. */
  endsAt: string | null;
  isClosed: boolean;
  totalVotes: number;
  options: { id: string; text: string; votes: number }[];
  /** Opcion que ha votado quien mira, si ha votado. */
  myOptionId: string | null;
}

export interface FeedPost {
  id: string;
  createdAt: string;
  /** ISO. Publicacion programada que aun no ha salido (solo la ve su duena). */
  scheduledFor: string | null;
  body: string | null;
  visibility: PostVisibility;
  /** Lo que paga quien mira (ya con la oferta del creador, si hay). */
  priceTokens: number;
  /** Precio sin oferta, solo si hay oferta: para tacharlo. */
  originalPriceTokens: number | null;
  /** Nombre de la oferta ("Rebajas", "Cupón"). */
  offerLabel: string | null;
  likeCount: number;
  commentCount: number;
  unlockCount: number;
  /** Personas distintas que la han visto. Solo para su duena. */
  views: number | null;
  isLiked: boolean;
  /** Puede ver los archivos originales */
  isUnlocked: boolean;
  /** La publicacion es de quien la esta mirando */
  isOwner: boolean;
  /**
   * Contenido de pago desbloqueado por un fan: texto de su marca de agua
   * (las fotos ya vienen marcadas del servidor; en los videos se superpone).
   */
  watermark: string | null;
  model: {
    id: string;
    /** Cuenta de la creadora (para denunciar o bloquear desde la publicacion). */
    userId?: string;
    slug: string;
    stageName: string;
    avatarUrl: string | null;
    isOnline: boolean;
    isAi: boolean;
    isLive: boolean;
    subscriptionEnabled: boolean;
    subscriptionPriceTokens: number;
  };
  assets: FeedAsset[];
  poll: FeedPoll | null;
}

/**
 * Publicaciones visibles ahora mismo. Una publicacion PROGRAMADA es una
 * publicada con `createdAt` en el futuro: asi el orden del feed es el de su
 * salida y no hace falta ningun proceso que la "active" a su hora.
 */
export function livePostWhere(): Prisma.PostWhereInput {
  return { isPublished: true, createdAt: { lte: new Date() } };
}

/** `select` compartido por todas las consultas de feed. */
export const feedPostSelect = {
  id: true,
  body: true,
  visibility: true,
  priceTokens: true,
  likeCount: true,
  commentCount: true,
  unlockCount: true,
  viewCount: true,
  createdAt: true,
  modelId: true,
  model: {
    select: {
      id: true,
      slug: true,
      stageName: true,
      avatarUrl: true,
      isOnline: true,
      isAi: true,
      userId: true,
      subscriptionEnabled: true,
      subscriptionPriceTokens: true,
      streams: {
        where: { status: 'LIVE' as const },
        select: { id: true },
        take: 1,
      },
    },
  },
  poll: {
    select: {
      id: true,
      question: true,
      endsAt: true,
      totalVotes: true,
      options: {
        orderBy: { sortOrder: 'asc' as const },
        select: { id: true, text: true, voteCount: true },
      },
    },
  },
  assets: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      storageKey: true,
      previewKey: true,
      mimeType: true,
      width: true,
      height: true,
    },
  },
} satisfies Prisma.PostSelect;

type RawPost = Prisma.PostGetPayload<{ select: typeof feedPostSelect }>;

/**
 * Convierte publicaciones crudas en filas listas para la interfaz, resolviendo
 * por cada una si quien mira puede ver el original.
 *
 * Hace UNA consulta para los desbloqueos, UNA para los "me gusta" y UNA para
 * las suscripciones activas, en vez de una por publicacion.
 */
export async function buildFeedPosts(
  posts: RawPost[],
  viewerId: string | null,
): Promise<FeedPost[]> {
  if (posts.length === 0) return [];

  const postIds = posts.map((p) => p.id);
  const modelIds = [...new Set(posts.map((p) => p.modelId))];

  const pollIds = posts.flatMap((p) => (p.poll ? [p.poll.id] : []));

  const [unlocks, likes, subscriptions, pollVotes] = viewerId
    ? await Promise.all([
        prisma.postUnlock.findMany({
          where: { userId: viewerId, postId: { in: postIds } },
          select: { postId: true },
        }),
        prisma.postLike.findMany({
          where: { userId: viewerId, postId: { in: postIds } },
          select: { postId: true },
        }),
        prisma.subscription.findMany({
          where: {
            userId: viewerId,
            modelId: { in: modelIds },
            status: 'ACTIVE',
            currentPeriodEnd: { gt: new Date() },
          },
          select: { modelId: true },
        }),
        pollIds.length > 0
          ? prisma.postPollVote.findMany({
              where: { userId: viewerId, pollId: { in: pollIds } },
              select: { pollId: true, optionId: true },
            })
          : Promise.resolve([]),
      ])
    : [[], [], [], []];

  const unlockedPosts = new Set(unlocks.map((u) => u.postId));
  const likedPosts = new Set(likes.map((l) => l.postId));
  const subscribedModels = new Set(subscriptions.map((s) => s.modelId));
  const myVotes = new Map(pollVotes.map((v) => [v.pollId, v.optionId]));
  const now = new Date();
  // Rebajas flash / cupones de cada creador para quien mira.
  const contentOffers = await getContentOffersFor(modelIds, viewerId ?? null);

  const viewerAccount = viewerId
    ? await prisma.user.findUnique({ where: { id: viewerId }, select: { username: true } })
    : null;
  const viewerLabel = viewerId ? watermarkLabel(viewerAccount?.username ?? null, viewerId) : null;

  return Promise.all(
    posts.map(async (post) => {
      const isOwner = Boolean(viewerId) && post.model.userId === viewerId;

      const isUnlocked =
        isOwner ||
        post.visibility === 'PUBLIC' ||
        (post.visibility === 'LOCKED' && unlockedPosts.has(post.id)) ||
        (post.visibility === 'SUBSCRIBERS' && subscribedModels.has(post.modelId));

      // De pago y visto por un fan: las fotos pasan por la ruta que les pone
      // su marca de agua; el original sin marca solo lo ve la creadora.
      const isProtected = isUnlocked && !isOwner && post.visibility !== 'PUBLIC';

      const assets = await Promise.all(
        post.assets.map(async (asset) => ({
          id: asset.id,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          url: !isUnlocked
            ? null
            : isProtected && asset.mimeType.startsWith('image/')
              ? `/api/posts/${post.id}/media/${asset.id}`
              : await resolveAssetUrl(asset.storageKey, { isPublic: false }),
          previewUrl: asset.previewKey
            ? await resolveAssetUrl(asset.previewKey, { isPublic: true })
            : null,
        })),
      );

      return {
        id: post.id,
        createdAt: post.createdAt.toISOString(),
        scheduledFor: post.createdAt > now ? post.createdAt.toISOString() : null,
        body: post.body,
        visibility: post.visibility,
        ...priceFor(post, isOwner, contentOffers.get(post.modelId)),
        likeCount: post.likeCount,
        commentCount: post.commentCount,
        unlockCount: post.unlockCount,
        views: isOwner ? post.viewCount : null,
        isLiked: likedPosts.has(post.id),
        isUnlocked,
        isOwner,
        watermark: isProtected ? viewerLabel : null,
        model: {
          id: post.model.id,
          userId: post.model.userId,
          slug: post.model.slug,
          stageName: post.model.stageName,
          avatarUrl: post.model.avatarUrl,
          isOnline: post.model.isOnline,
          isAi: post.model.isAi,
          isLive: post.model.streams.length > 0,
          subscriptionEnabled: post.model.subscriptionEnabled,
          subscriptionPriceTokens: post.model.subscriptionPriceTokens,
        },
        assets,
        poll: post.poll
          ? {
              id: post.poll.id,
              question: post.poll.question,
              endsAt: post.poll.endsAt?.toISOString() ?? null,
              isClosed: Boolean(post.poll.endsAt && post.poll.endsAt <= now),
              totalVotes: post.poll.totalVotes,
              options: post.poll.options.map((o) => ({
                id: o.id,
                text: o.text,
                votes: o.voteCount,
              })),
              myOptionId: myVotes.get(post.poll.id) ?? null,
            }
          : null,
      } satisfies FeedPost;
    }),
  );
}

/** Publicaciones solo de las creadoras a las que sigue el visitante. */
export async function getFollowingFeed(params: {
  viewerId: string;
  geoFilter: Prisma.ModelProfileWhereInput;
  take?: number;
  cursor?: string | null;
}): Promise<FeedPost[]> {
  const follows = await prisma.follow.findMany({
    where: { userId: params.viewerId },
    select: { modelId: true },
  });
  if (follows.length === 0) return [];

  const posts = await prisma.post.findMany({
    where: {
      ...livePostWhere(),
      modelId: { in: follows.map((f) => f.modelId) },
      model: { ...params.geoFilter },
    },
    orderBy: { createdAt: 'desc' },
    take: params.take ?? 20,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    select: feedPostSelect,
  });

  return buildFeedPosts(posts, params.viewerId);
}

/**
 * Lo que paga con sus suscripciones: publicaciones SOLO PARA SUSCRIPTORES de
 * las creadoras a las que esta suscrito ahora (o de una sola, con modelId).
 */
export async function getSubscriptionsFeed(params: {
  viewerId: string;
  geoFilter: Prisma.ModelProfileWhereInput;
  modelId?: string | null;
  take?: number;
  cursor?: string | null;
}): Promise<FeedPost[]> {
  const subs = await prisma.subscription.findMany({
    where: {
      userId: params.viewerId,
      status: 'ACTIVE',
      currentPeriodEnd: { gt: new Date() },
      ...(params.modelId ? { modelId: params.modelId } : {}),
    },
    select: { modelId: true },
  });
  if (subs.length === 0) return [];

  const posts = await prisma.post.findMany({
    where: {
      ...livePostWhere(),
      visibility: 'SUBSCRIBERS',
      removedAt: null,
      modelId: { in: subs.map((s) => s.modelId) },
      model: { ...params.geoFilter },
    },
    orderBy: { createdAt: 'desc' },
    take: params.take ?? 20,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    select: feedPostSelect,
  });

  return buildFeedPosts(posts, params.viewerId);
}

/** Publicaciones de un perfil concreto, para su ficha. */
export async function getModelPosts(params: {
  modelId: string;
  viewerId: string | null;
  take?: number;
  /** La duena ve tambien sus publicaciones programadas. */
  includeScheduled?: boolean;
}): Promise<FeedPost[]> {
  const posts = await prisma.post.findMany({
    where: {
      modelId: params.modelId,
      ...(params.includeScheduled ? { isPublished: true } : livePostWhere()),
    },
    orderBy: { createdAt: 'desc' },
    take: params.take ?? 12,
    select: feedPostSelect,
  });

  return buildFeedPosts(posts, params.viewerId);
}

/** Precio de una publicacion para quien la mira (con la oferta del creador). */
function priceFor(
  post: { visibility: PostVisibility; priceTokens: number },
  isOwner: boolean,
  offer: AppliedOffer | undefined,
) {
  if (!offer || isOwner || post.visibility !== 'LOCKED' || post.priceTokens <= 0) {
    return { priceTokens: post.priceTokens, originalPriceTokens: null, offerLabel: null };
  }
  return {
    priceTokens: discountTokens(post.priceTokens, offer.percentOff),
    originalPriceTokens: post.priceTokens,
    offerLabel: `${offer.label} −${offer.percentOff}%`,
  };
}
