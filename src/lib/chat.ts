import 'server-only';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * MENSAJES ENTRE TODOS: reglas comunes.
 *
 * Hay dos tipos de chat:
 *  - `Conversation`: fan <-> creadora. La abre el fan pagando el precio que
 *    ella pone (puede ser 0), o la creadora gratis (llega como solicitud si el
 *    fan no la sigue).
 *  - `PeerChat`: el resto (fan con fan, creadora con creadora). Gratis; llega
 *    como solicitud si quien la recibe no sigue a quien escribe.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** Pareja ordenada: un solo PeerChat por par de cuentas. */
export function peerPair(a: string, b: string): { userAId: string; userBId: string } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

/** Hay un bloqueo (no de "saltar" en llamadas) en cualquiera de los dos sentidos. */
export async function isBlockedBetween(a: string, b: string, db: Db = prisma): Promise<boolean> {
  const block = await db.blockedPair.findFirst({
    where: {
      isSkip: false,
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  });
  return Boolean(block);
}

/** `followerId` sigue a `targetId` (como creadora o como persona). */
export async function isFollowing(followerId: string, targetId: string, db: Db = prisma): Promise<boolean> {
  const target = await db.user.findUnique({
    where: { id: targetId },
    select: { modelProfile: { select: { id: true } } },
  });
  if (target?.modelProfile) {
    return Boolean(
      await db.follow.findUnique({
        where: { userId_modelId: { userId: followerId, modelId: target.modelProfile.id } },
        select: { id: true },
      }),
    );
  }
  return Boolean(
    await db.userFollow.findUnique({
      where: { followerId_followingId: { followerId, followingId: targetId } },
      select: { id: true },
    }),
  );
}

/**
 * Comprueba si `senderId` puede empezar un chat con `recipient` segun su ajuste
 * de privacidad. Devuelve el motivo si no puede, o si llegara como solicitud.
 */
export async function checkCanStartChat(
  senderId: string,
  recipient: { id: string; messagePrivacy: 'EVERYONE' | 'FOLLOWING' | 'NOBODY' },
  db: Db = prisma,
): Promise<{ ok: true; asRequest: boolean } | { ok: false; error: string }> {
  if (await isBlockedBetween(senderId, recipient.id, db)) {
    return { ok: false, error: 'No puedes escribir a esta persona.' };
  }
  if (recipient.messagePrivacy === 'NOBODY') {
    return { ok: false, error: 'Esta persona no recibe mensajes.' };
  }
  const followsSender = await isFollowing(recipient.id, senderId, db);
  if (recipient.messagePrivacy === 'FOLLOWING' && !followsSender) {
    return { ok: false, error: 'Solo recibe mensajes de las personas que sigue.' };
  }
  // Si quien recibe ya sigue a quien escribe, entra directo; si no, solicitud.
  return { ok: true, asRequest: !followsSender };
}

export interface InboxThread {
  key: string;
  href: string;
  name: string;
  image: string | null;
  /** Perfil de la otra persona (para enlazar). */
  profileHref: string | null;
  preview: string;
  lastAt: Date;
  /** El ultimo mensaje es de la otra persona: te toca responder. */
  unread: boolean;
  /** Solicitud recibida que aun no aceptaste. */
  isRequest: boolean;
  /** Solicitud enviada que la otra persona aun no acepto. */
  pendingOut: boolean;
  /** Chat de pago con una creadora (fan -> creadora). */
  paid: boolean;
}

function preview(text: string | null | undefined, mine: boolean, hasFile = false) {
  const t = text?.trim() || (hasFile ? 'Archivo adjunto' : '');
  return mine && t ? `Tu: ${t}` : t;
}

/** Todos los chats de una cuenta, de los dos tipos, en una sola lista. */
export async function getInbox(userId: string, modelProfileId: string | null): Promise<InboxThread[]> {
  const lastMessage = {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  };

  const [peer, asFan, asCreator] = await Promise.all([
    prisma.peerChat.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: { lastMessageAt: 'desc' },
      take: 60,
      select: {
        id: true,
        userAId: true,
        createdById: true,
        acceptedAt: true,
        lastMessageAt: true,
        userA: { select: { name: true, username: true, image: true, modelProfile: { select: { slug: true, stageName: true, avatarUrl: true } } } },
        userB: { select: { name: true, username: true, image: true, modelProfile: { select: { slug: true, stageName: true, avatarUrl: true } } } },
        messages: { ...lastMessage, select: { body: true, senderId: true } },
      },
    }),
    prisma.conversation.findMany({
      where: { userId },
      orderBy: { lastMessageAt: 'desc' },
      take: 60,
      select: {
        id: true,
        startedByModel: true,
        acceptedAt: true,
        unlockPriceTokens: true,
        lastMessageAt: true,
        model: { select: { slug: true, stageName: true, avatarUrl: true } },
        messages: { ...lastMessage, select: { body: true, senderId: true, attachment: { select: { id: true } } } },
      },
    }),
    modelProfileId
      ? prisma.conversation.findMany({
          where: { modelId: modelProfileId },
          orderBy: { lastMessageAt: 'desc' },
          take: 60,
          select: {
            id: true,
            startedByModel: true,
            acceptedAt: true,
            unlockPriceTokens: true,
            lastMessageAt: true,
            user: { select: { name: true, username: true, image: true } },
            messages: { ...lastMessage, select: { body: true, senderId: true, attachment: { select: { id: true } } } },
          },
        })
      : Promise.resolve([]),
  ]);

  const threads: InboxThread[] = [
    ...peer.map((c): InboxThread => {
      const other = c.userAId === userId ? c.userB : c.userA;
      const last = c.messages[0];
      const mine = last?.senderId === userId;
      const pending = c.acceptedAt === null;
      return {
        key: `p-${c.id}`,
        href: `/mensajes/${c.id}`,
        name: other.modelProfile?.stageName ?? other.name ?? other.username ?? 'Usuario',
        image: other.modelProfile?.avatarUrl ?? other.image,
        profileHref: other.modelProfile
          ? `/models/${other.modelProfile.slug}`
          : other.username
            ? `/u/${other.username}`
            : null,
        preview: preview(last?.body, mine),
        lastAt: c.lastMessageAt,
        unread: Boolean(last) && !mine,
        isRequest: pending && c.createdById !== userId,
        pendingOut: pending && c.createdById === userId,
        paid: false,
      };
    }),
    ...asFan.map((c): InboxThread => {
      const last = c.messages[0];
      const mine = last?.senderId === userId;
      const pending = c.acceptedAt === null;
      return {
        key: `f-${c.id}`,
        href: `/dashboard/messages/${c.model.slug}`,
        name: c.model.stageName,
        image: c.model.avatarUrl,
        profileHref: `/models/${c.model.slug}`,
        preview: preview(last?.body, mine, Boolean(last?.attachment)),
        lastAt: c.lastMessageAt,
        unread: Boolean(last) && !mine,
        isRequest: pending && c.startedByModel,
        pendingOut: false,
        paid: c.unlockPriceTokens > 0,
      };
    }),
    ...asCreator.map((c): InboxThread => {
      const last = c.messages[0];
      const mine = last?.senderId === userId;
      return {
        key: `c-${c.id}`,
        href: `/dashboard/model/messages/${c.id}`,
        name: c.user.name ?? c.user.username ?? 'Fan',
        image: c.user.image,
        profileHref: c.user.username ? `/u/${c.user.username}` : null,
        preview: preview(last?.body, mine, Boolean(last?.attachment)),
        lastAt: c.lastMessageAt,
        unread: Boolean(last) && !mine,
        isRequest: false,
        pendingOut: c.acceptedAt === null && c.startedByModel,
        paid: c.unlockPriceTokens > 0,
      };
    }),
  ];

  return threads.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}
