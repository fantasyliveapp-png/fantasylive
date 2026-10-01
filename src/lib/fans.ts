import 'server-only';

import { prisma } from '@/lib/prisma';

/**
 * FANS DE UN CREADOR: quien le sigue, con lo que necesita para cuidarles:
 * desde cuando, si esta suscrito, cuanto le ha dado en total y cuando fue su
 * ultima compra, y si ya tienen chat. Solo lo ve el propio creador.
 */

const LIMIT = 2000;

export interface FanRow {
  userId: string;
  name: string;
  username: string | null;
  image: string | null;
  followedAt: string;
  isSubscribed: boolean;
  supportTokens: number;
  lastPurchaseAt: string | null;
  /** Chat ya abierto con este fan. */
  chatHref: string | null;
}

export async function getCreatorFans(modelId: string, modelUserId: string): Promise<FanRow[]> {
  const now = new Date();
  const follows = await prisma.follow.findMany({
    where: { modelId, user: { status: 'ACTIVE' } },
    orderBy: { createdAt: 'desc' },
    take: LIMIT,
    select: {
      createdAt: true,
      user: { select: { id: true, name: true, username: true, image: true } },
    },
  });
  if (follows.length === 0) return [];
  const ids = follows.map((f) => f.user.id);

  const [subs, chats, support] = await Promise.all([
    prisma.subscription.findMany({
      where: { modelId, userId: { in: ids }, status: 'ACTIVE', currentPeriodEnd: { gt: now } },
      select: { userId: true },
    }),
    prisma.conversation.findMany({
      where: { modelId, userId: { in: ids } },
      select: { id: true, userId: true },
    }),
    supportByFan(modelId, modelUserId, ids),
  ]);
  const subscribed = new Set(subs.map((s) => s.userId));
  const chatOf = new Map(chats.map((c) => [c.userId, `/mensajes/${c.id}`]));

  return follows.map((f) => {
    const s = support.get(f.user.id);
    return {
      userId: f.user.id,
      name: f.user.name ?? f.user.username ?? 'Fan',
      username: f.user.username,
      image: f.user.image,
      followedAt: f.createdAt.toISOString(),
      isSubscribed: subscribed.has(f.user.id),
      supportTokens: s?.tokens ?? 0,
      lastPurchaseAt: s?.last?.toISOString() ?? null,
      chatHref: chatOf.get(f.user.id) ?? null,
    };
  });
}

/**
 * Lo que cada fan le ha dado (tokens, lo que pago el fan): publicaciones y
 * packs, envios del chat, abrir el chat, suscripciones, regalos, llamadas y
 * pedidos. Con la fecha de su ultima compra.
 */
async function supportByFan(modelId: string, modelUserId: string, fanIds: string[]) {
  const inFans = { in: fanIds };
  const [posts, chat, convs, subs, gifts, calls, requests] = await Promise.all([
    prisma.postUnlock.findMany({
      where: { userId: inFans, post: { modelId } },
      select: { userId: true, tokensSpent: true, createdAt: true },
    }),
    prisma.messageAttachmentUnlock.findMany({
      where: { userId: inFans, attachment: { message: { conversation: { modelId } } } },
      select: { userId: true, tokensSpent: true, createdAt: true },
    }),
    prisma.conversation.findMany({
      where: { modelId, userId: inFans, unlockPriceTokens: { gt: 0 } },
      select: { userId: true, unlockPriceTokens: true, createdAt: true },
    }),
    prisma.transaction.findMany({
      where: { userId: inFans, type: 'SUBSCRIPTION_PURCHASE', status: 'COMPLETED', subscription: { modelId } },
      select: { userId: true, tokens: true, createdAt: true },
    }),
    prisma.gift.findMany({
      where: { senderId: inFans, receiverId: modelUserId },
      select: { senderId: true, tokens: true, createdAt: true },
    }),
    prisma.callSession.findMany({
      where: { callerId: inFans, calleeId: modelUserId, tokensSpent: { gt: 0 } },
      select: { callerId: true, tokensSpent: true, createdAt: true },
    }),
    prisma.contentRequest.findMany({
      where: { modelId, userId: inFans, status: { in: ['PAID', 'DELIVERED'] } },
      select: { userId: true, quotedTokens: true, paidAt: true },
    }),
  ]);

  const total = new Map<string, { tokens: number; last: Date | null }>();
  const add = (userId: string, tokens: number | null | undefined, at: Date | null) => {
    if (!tokens) return;
    const cur = total.get(userId) ?? { tokens: 0, last: null };
    cur.tokens += Math.abs(tokens);
    if (at && (!cur.last || at > cur.last)) cur.last = at;
    total.set(userId, cur);
  };
  for (const p of posts) add(p.userId, p.tokensSpent, p.createdAt);
  for (const c of chat) add(c.userId, c.tokensSpent, c.createdAt);
  for (const c of convs) add(c.userId, c.unlockPriceTokens, c.createdAt);
  for (const s of subs) add(s.userId, s.tokens, s.createdAt);
  for (const g of gifts) add(g.senderId, g.tokens, g.createdAt);
  for (const c of calls) add(c.callerId, c.tokensSpent, c.createdAt);
  for (const r of requests) add(r.userId, r.quotedTokens, r.paidAt);
  return total;
}
