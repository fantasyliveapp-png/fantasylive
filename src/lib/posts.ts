import 'server-only';

import type { PostVisibility, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { resolveAssetUrl } from '@/lib/storage';

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

export interface FeedPost {
  id: string;
  createdAt: string;
  body: string | null;
  visibility: PostVisibility;
  priceTokens: number;
  likeCount: number;
  commentCount: number;
  unlockCount: number;
  isLiked: boolean;
  /** Puede ver los archivos originales */
  isUnlocked: boolean;
  /** La publicacion es de quien la esta mirando */
  isOwner: boolean;
  model: {
    id: string;
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

  const [unlocks, likes, subscriptions] = viewerId
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
      ])
    : [[], [], []];

  const unlockedPosts = new Set(unlocks.map((u) => u.postId));
  const likedPosts = new Set(likes.map((l) => l.postId));
  const subscribedModels = new Set(subscriptions.map((s) => s.modelId));

  return Promise.all(
    posts.map(async (post) => {
      const isOwner = Boolean(viewerId) && post.model.userId === viewerId;

      const isUnlocked =
        isOwner ||
        post.visibility === 'PUBLIC' ||
        (post.visibility === 'LOCKED' && unlockedPosts.has(post.id)) ||
        (post.visibility === 'SUBSCRIBERS' && subscribedModels.has(post.modelId));

      const assets = await Promise.all(
        post.assets.map(async (asset) => ({
          id: asset.id,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          url: isUnlocked
            ? await resolveAssetUrl(asset.storageKey, { isPublic: false })
            : null,
          previewUrl: asset.previewKey
            ? await resolveAssetUrl(asset.previewKey, { isPublic: true })
            : null,
        })),
      );

      return {
        id: post.id,
        createdAt: post.createdAt.toISOString(),
        body: post.body,
        visibility: post.visibility,
        priceTokens: post.priceTokens,
        likeCount: post.likeCount,
        commentCount: post.commentCount,
        unlockCount: post.unlockCount,
        isLiked: likedPosts.has(post.id),
        isUnlocked,
        isOwner,
        model: {
          id: post.model.id,
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
      } satisfies FeedPost;
    }),
  );
}

/**
 * Publicaciones del feed de descubrimiento.
 *
 * Excluye los perfiles que bloquean el pais del visitante (el filtro llega ya
 * resuelto desde getVisibilityContext) y los que no tienen el KYC aprobado.
 */
export async function getDiscoverFeed(params: {
  viewerId: string | null;
  geoFilter: Prisma.ModelProfileWhereInput;
  take?: number;
  cursor?: string | null;
}): Promise<FeedPost[]> {
  const posts = await prisma.post.findMany({
    where: {
      isPublished: true,
      model: { kycStatus: 'APPROVED', ...params.geoFilter },
    },
    orderBy: { createdAt: 'desc' },
    take: params.take ?? 20,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    select: feedPostSelect,
  });

  return buildFeedPosts(posts, params.viewerId);
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
      isPublished: true,
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

/** Publicaciones de un perfil concreto, para su ficha. */
export async function getModelPosts(params: {
  modelId: string;
  viewerId: string | null;
  take?: number;
}): Promise<FeedPost[]> {
  const posts = await prisma.post.findMany({
    where: { modelId: params.modelId, isPublished: true },
    orderBy: { createdAt: 'desc' },
    take: params.take ?? 12,
    select: feedPostSelect,
  });

  return buildFeedPosts(posts, params.viewerId);
}
