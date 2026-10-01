import 'server-only';

import type { Gender } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * SIGUIENDO del perfil de un fan: los creadores que sigue (solo se sigue a
 * creadores). Con directo y suscripcion y, en su propio perfil, la
 * campanita y cuanto ha apoyado a cada uno. Orden y busqueda, en el navegador.
 */

const LIMIT = 500;

export interface FollowedCreator {
  modelId: string;
  slug: string;
  name: string;
  gender: Gender;
  avatarUrl: string | null;
  isOnline: boolean;
  isLive: boolean;
  isSubscribed: boolean;
  followedAt: string;
  /** Solo en tu propio perfil. */
  notifyLive: boolean;
  notifyPosts: boolean;
  /** Tokens que le ha dado (compras, regalos, llamadas...). Solo en tu perfil. */
  supportTokens: number;
}

export async function getFollowedCreators(userId: string, isSelf: boolean): Promise<FollowedCreator[]> {
  const now = new Date();
  const [follows, subs, support] = await Promise.all([
    prisma.follow.findMany({
      where: { userId, model: { kycStatus: 'APPROVED' } },
      orderBy: { createdAt: 'desc' },
      take: LIMIT,
      select: {
        createdAt: true,
        notifyLive: true,
        notifyPosts: true,
        model: {
          select: {
            id: true,
            slug: true,
            stageName: true,
            gender: true,
            avatarUrl: true,
            isOnline: true,
            streams: { where: { status: 'LIVE' }, select: { id: true }, take: 1 },
          },
        },
      },
    }),
    prisma.subscription.findMany({
      where: { userId, status: 'ACTIVE', currentPeriodEnd: { gt: now } },
      select: { modelId: true },
    }),
    isSelf ? supportByCreator(userId) : Promise.resolve(new Map<string, number>()),
  ]);
  const subscribed = new Set(subs.map((s) => s.modelId));

  return follows.map((f) => ({
    modelId: f.model.id,
    slug: f.model.slug,
    name: f.model.stageName,
    gender: f.model.gender,
    avatarUrl: f.model.avatarUrl,
    isOnline: f.model.isOnline,
    isLive: f.model.streams.length > 0,
    isSubscribed: subscribed.has(f.model.id),
    followedAt: f.createdAt.toISOString(),
    notifyLive: isSelf ? f.notifyLive : false,
    notifyPosts: isSelf ? f.notifyPosts : false,
    supportTokens: support.get(f.model.id) ?? 0,
  }));
}

/**
 * Cuanto ha apoyado a cada creador (tokens): publicaciones y packs, envios
 * del chat, abrir chats, suscripciones, regalos, llamadas y pedidos.
 */
async function supportByCreator(userId: string): Promise<Map<string, number>> {
  const [posts, chat, convs, subs, gifts, calls, requests] = await Promise.all([
    prisma.postUnlock.findMany({
      where: { userId },
      select: { tokensSpent: true, post: { select: { modelId: true } } },
    }),
    prisma.messageAttachmentUnlock.findMany({
      where: { userId },
      select: {
        tokensSpent: true,
        attachment: { select: { message: { select: { conversation: { select: { modelId: true } } } } } },
      },
    }),
    prisma.conversation.findMany({
      where: { userId, unlockPriceTokens: { gt: 0 } },
      select: { modelId: true, unlockPriceTokens: true },
    }),
    prisma.transaction.findMany({
      where: { userId, type: 'SUBSCRIPTION_PURCHASE', status: 'COMPLETED' },
      select: { tokens: true, subscription: { select: { modelId: true } } },
    }),
    prisma.gift.groupBy({ by: ['receiverId'], where: { senderId: userId }, _sum: { tokens: true } }),
    prisma.callSession.groupBy({
      by: ['calleeId'],
      where: { callerId: userId, calleeId: { not: null } },
      _sum: { tokensSpent: true },
    }),
    prisma.contentRequest.findMany({
      where: { userId, status: { in: ['PAID', 'DELIVERED'] } },
      select: { modelId: true, quotedTokens: true },
    }),
  ]);

  const total = new Map<string, number>();
  const add = (modelId: string | null | undefined, tokens: number | null | undefined) => {
    if (!modelId || !tokens) return;
    total.set(modelId, (total.get(modelId) ?? 0) + Math.abs(tokens));
  };
  for (const p of posts) add(p.post.modelId, p.tokensSpent);
  for (const c of chat) add(c.attachment.message.conversation.modelId, c.tokensSpent);
  for (const c of convs) add(c.modelId, c.unlockPriceTokens);
  for (const s of subs) add(s.subscription?.modelId, s.tokens);
  for (const r of requests) add(r.modelId, r.quotedTokens);

  // Regalos y llamadas van a la cuenta (userId) del creador.
  const byUser = [
    ...gifts.map((g) => ({ userId: g.receiverId, tokens: g._sum.tokens ?? 0 })),
    ...calls.map((c) => ({ userId: c.calleeId!, tokens: c._sum.tokensSpent ?? 0 })),
  ].filter((x) => x.tokens > 0);
  if (byUser.length) {
    const profiles = await prisma.modelProfile.findMany({
      where: { userId: { in: [...new Set(byUser.map((x) => x.userId))] } },
      select: { id: true, userId: true },
    });
    const modelOf = new Map(profiles.map((p) => [p.userId, p.id]));
    for (const x of byUser) add(modelOf.get(x.userId), x.tokens);
  }
  return total;
}
