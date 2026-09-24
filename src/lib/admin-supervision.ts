import 'server-only';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { resolveAssetUrl } from '@/lib/storage';

/**
 * Consultas del admin para SUPERVISAR: todo el contenido, todos los chats y
 * todos los directos, sin muros de pago ni marcas de agua (el admin ve el
 * original para poder juzgarlo).
 */

/** URL del ORIGINAL de un archivo privado (firmada y temporal). */
export async function adminMediaUrl(key: string): Promise<string | null> {
  try {
    return await resolveAssetUrl(key);
  } catch {
    return null;
  }
}

/** IDs de cuentas que coinciden con una busqueda (@usuario, nombre, email). */
export async function findUserIds(q: string | undefined): Promise<string[] | null> {
  const term = q?.trim().replace(/^@/, '');
  if (!term) return null;
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { username: { contains: term, mode: 'insensitive' } },
        { name: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { modelProfile: { stageName: { contains: term, mode: 'insensitive' } } },
      ],
    },
    select: { id: true },
    take: 200,
  });
  return users.map((u) => u.id);
}

/** Cuantas denuncias tiene cada cosa denunciada con un prefijo ("post:", "chat:"...). */
export async function reportCounts(
  prefix: 'post:' | 'chat:' | 'conversation:',
  onlyOpen = false,
): Promise<Map<string, number>> {
  const rows = await prisma.report.groupBy({
    by: ['context'],
    where: {
      context: { startsWith: prefix },
      ...(onlyOpen ? { status: { in: ['OPEN', 'UNDER_REVIEW', 'ESCALATED'] } } : {}),
    },
    _count: true,
  });
  return new Map(rows.map((r) => [r.context!.slice(prefix.length), r._count]));
}

// ---------------------------------------------------------------------------
// CONTENIDO
// ---------------------------------------------------------------------------

export type ContentFilter = '' | 'pago' | 'reportadas' | 'retiradas';

const CONTENT_PAGE = 36;

export async function getAdminContent(params: {
  filter: ContentFilter;
  q?: string;
  page: number;
}) {
  const userIds = await findUserIds(params.q);
  const reported = await reportCounts('post:');

  const where: Prisma.PostWhereInput = {
    ...(userIds ? { model: { userId: { in: userIds } } } : {}),
    ...(params.filter === 'pago' ? { visibility: { in: ['LOCKED', 'SUBSCRIBERS'] } } : {}),
    ...(params.filter === 'retiradas' ? { removedAt: { not: null } } : {}),
    ...(params.filter === 'reportadas' ? { id: { in: [...reported.keys()] } } : {}),
    // Los borradores sin publicar nunca se vieron: no hay nada que supervisar.
    ...(params.filter !== 'retiradas' ? { OR: [{ isPublished: true }, { removedAt: { not: null } }] } : {}),
  };

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * CONTENT_PAGE,
      take: CONTENT_PAGE,
      select: {
        id: true,
        body: true,
        visibility: true,
        priceTokens: true,
        createdAt: true,
        removedAt: true,
        viewCount: true,
        likeCount: true,
        commentCount: true,
        assets: {
          orderBy: { sortOrder: 'asc' },
          take: 1,
          select: { storageKey: true, previewKey: true, mimeType: true },
        },
        _count: { select: { assets: true } },
        model: { select: { stageName: true, userId: true } },
      },
    }),
    prisma.post.count({ where }),
  ]);

  const items = await Promise.all(
    posts.map(async (p) => {
      const a = p.assets[0];
      return {
        id: p.id,
        body: p.body,
        visibility: p.visibility,
        priceTokens: p.priceTokens,
        createdAt: p.createdAt,
        removed: Boolean(p.removedAt),
        scheduled: p.createdAt > new Date(),
        views: p.viewCount,
        likes: p.likeCount,
        comments: p.commentCount,
        assetCount: p._count.assets,
        media: a
          ? { url: await adminMediaUrl(a.storageKey), isVideo: a.mimeType.startsWith('video/') }
          : null,
        creator: { name: p.model.stageName, userId: p.model.userId },
        reports: reported.get(p.id) ?? 0,
      };
    }),
  );

  return { items, total, pages: Math.max(1, Math.ceil(total / CONTENT_PAGE)) };
}

// ---------------------------------------------------------------------------
// MENSAJES
// ---------------------------------------------------------------------------

export type ChatKind = 'fan' | 'peer';

export interface AdminChatRow {
  kind: ChatKind;
  id: string;
  a: { id: string; name: string; image: string | null };
  b: { id: string; name: string; image: string | null };
  lastMessageAt: Date;
  lastBody: string | null;
  messages: number;
  reports: number;
}

const personSelect = {
  id: true,
  name: true,
  username: true,
  image: true,
  modelProfile: { select: { stageName: true, avatarUrl: true } },
} as const;

type PersonRow = {
  id: string;
  name: string | null;
  username: string | null;
  image: string | null;
  modelProfile: { stageName: string; avatarUrl: string | null } | null;
};

export function personOf(u: PersonRow) {
  return {
    id: u.id,
    name: u.modelProfile?.stageName ?? u.name ?? u.username ?? 'Sin nombre',
    username: u.username,
    image: u.modelProfile?.avatarUrl ?? u.image,
  };
}

export async function getAdminChats(params: {
  q?: string;
  userId?: string;
  onlyReported?: boolean;
  take?: number;
}) {
  const userIds = params.userId ? [params.userId] : await findUserIds(params.q);
  const [convReports, peerReports] = await Promise.all([
    reportCounts('conversation:'),
    reportCounts('chat:'),
  ]);

  const [convs, peers] = await Promise.all([
    prisma.conversation.findMany({
      where: {
        ...(userIds
          ? { OR: [{ userId: { in: userIds } }, { model: { userId: { in: userIds } } }] }
          : {}),
        ...(params.onlyReported ? { id: { in: [...convReports.keys()] } } : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 60,
      select: {
        id: true,
        lastMessageAt: true,
        user: { select: personSelect },
        model: { select: { user: { select: personSelect } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.peerChat.findMany({
      where: {
        ...(userIds
          ? { OR: [{ userAId: { in: userIds } }, { userBId: { in: userIds } }] }
          : {}),
        ...(params.onlyReported ? { id: { in: [...peerReports.keys()] } } : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 60,
      select: {
        id: true,
        lastMessageAt: true,
        userA: { select: personSelect },
        userB: { select: personSelect },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true } },
        _count: { select: { messages: true } },
      },
    }),
  ]);

  const rows: AdminChatRow[] = [
    ...convs.map((c) => ({
      kind: 'fan' as const,
      id: c.id,
      a: personOf(c.user),
      b: personOf(c.model.user),
      lastMessageAt: c.lastMessageAt,
      lastBody: c.messages[0]?.body ?? null,
      messages: c._count.messages,
      reports: convReports.get(c.id) ?? 0,
    })),
    ...peers.map((c) => ({
      kind: 'peer' as const,
      id: c.id,
      a: personOf(c.userA),
      b: personOf(c.userB),
      lastMessageAt: c.lastMessageAt,
      lastBody: c.messages[0]?.body ?? null,
      messages: c._count.messages,
      reports: peerReports.get(c.id) ?? 0,
    })),
  ];
  rows.sort((x, y) => y.lastMessageAt.getTime() - x.lastMessageAt.getTime());
  return rows.slice(0, params.take ?? 80);
}

export interface AdminMessage {
  id: string;
  senderId: string;
  body: string | null;
  createdAt: Date;
  isAi: boolean;
  /** Chatter del equipo que lo escribio en nombre de la creadora. */
  writtenBy?: { id: string; username: string | null } | null;
  attachment: { url: string | null; isVideo: boolean; isImage: boolean; priceTokens: number } | null;
}

export async function getAdminChat(kind: ChatKind, id: string) {
  if (kind === 'fan') {
    const c = await prisma.conversation.findUnique({
      where: { id },
      select: {
        id: true,
        createdAt: true,
        unlockPriceTokens: true,
        user: { select: personSelect },
        model: { select: { user: { select: personSelect } } },
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 500,
          select: {
            id: true,
            senderId: true,
            body: true,
            createdAt: true,
            isAiGenerated: true,
            writtenBy: { select: { id: true, username: true } },
            attachment: { select: { storageKey: true, mimeType: true, priceTokens: true } },
          },
        },
      },
    });
    if (!c) return null;
    return {
      kind,
      id: c.id,
      createdAt: c.createdAt,
      note: `Chat de fan con creadora · abierto por ${c.unlockPriceTokens} tokens`,
      people: [personOf(c.user), personOf(c.model.user)],
      messages: await Promise.all(
        c.messages.map(
          async (m): Promise<AdminMessage> => ({
            id: m.id,
            senderId: m.senderId,
            body: m.body,
            createdAt: m.createdAt,
            isAi: m.isAiGenerated,
            writtenBy: m.writtenBy,
            attachment: m.attachment
              ? {
                  url: await adminMediaUrl(m.attachment.storageKey),
                  isVideo: m.attachment.mimeType.startsWith('video/'),
                  isImage: m.attachment.mimeType.startsWith('image/'),
                  priceTokens: m.attachment.priceTokens,
                }
              : null,
          }),
        ),
      ),
    };
  }

  const c = await prisma.peerChat.findUnique({
    where: { id },
    select: {
      id: true,
      createdAt: true,
      userA: { select: personSelect },
      userB: { select: personSelect },
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 500,
        select: { id: true, senderId: true, body: true, createdAt: true },
      },
    },
  });
  if (!c) return null;
  return {
    kind,
    id: c.id,
    createdAt: c.createdAt,
    note: 'Chat entre personas (gratis)',
    people: [personOf(c.userA), personOf(c.userB)],
    messages: c.messages.map(
      (m): AdminMessage => ({ ...m, isAi: false, attachment: null }),
    ),
  };
}
