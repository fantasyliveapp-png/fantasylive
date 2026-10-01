import 'server-only';

import { contentTitle } from '@/lib/creator-content';
import { prisma } from '@/lib/prisma';
import { resolveAssetUrl } from '@/lib/storage';

/**
 * MIS COMPRAS: todo lo que un fan ha desbloqueado, venga de donde venga,
 * como un feed (lo mas reciente primero). Solo lo ve el propio fan.
 *
 * - Publicacion: de pago en el feed o el perfil.
 * - Directo: pack de los Especiales de un directo.
 * - Chat: envio de pago en una conversacion.
 * - Pedido: pedido a medida entregado por chat.
 */

export type PurchaseSource = 'post' | 'live' | 'chat' | 'request';

export interface PurchaseMedia {
  id: string;
  mimeType: string;
  url: string | null;
}

export interface PurchaseItem {
  id: string;
  source: PurchaseSource;
  at: string;
  tokens: number;
  title: string | null;
  creator: { name: string; slug: string; avatarUrl: string | null };
  media: PurchaseMedia[];
  /** A donde lleva "Ver en su sitio". */
  href: string;
}

const PER_SOURCE = 60;

const CREATOR_SELECT = { stageName: true, slug: true, avatarUrl: true } as const;

function creatorOf(m: { stageName: string; slug: string; avatarUrl: string | null }) {
  return { name: m.stageName, slug: m.slug, avatarUrl: m.avatarUrl };
}

export async function getPurchases(userId: string): Promise<PurchaseItem[]> {
  const [postUnlocks, chatUnlocks, requests] = await Promise.all([
    prisma.postUnlock.findMany({
      where: { userId, post: { removedAt: null } },
      orderBy: { createdAt: 'desc' },
      take: PER_SOURCE,
      select: {
        id: true,
        tokensSpent: true,
        createdAt: true,
        post: {
          select: {
            id: true,
            body: true,
            liveExclusiveAt: true,
            model: { select: CREATOR_SELECT },
            assets: {
              orderBy: { sortOrder: 'asc' },
              select: { id: true, storageKey: true, mimeType: true },
            },
          },
        },
      },
    }),
    prisma.messageAttachmentUnlock.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: PER_SOURCE,
      select: {
        id: true,
        tokensSpent: true,
        createdAt: true,
        attachment: {
          select: {
            id: true,
            storageKey: true,
            mimeType: true,
            files: { orderBy: { sortOrder: 'asc' }, select: { id: true, storageKey: true, mimeType: true } },
            message: {
              select: { body: true, conversationId: true, conversation: { select: { model: { select: CREATOR_SELECT } } } },
            },
          },
        },
      },
    }),
    prisma.contentRequest.findMany({
      where: { userId, status: 'DELIVERED', deliveredMessageId: { not: null } },
      orderBy: { deliveredAt: 'desc' },
      take: PER_SOURCE,
      select: {
        id: true,
        description: true,
        quotedTokens: true,
        deliveredAt: true,
        model: { select: CREATOR_SELECT },
        deliveredMessage: {
          select: {
            conversationId: true,
            attachment: {
              select: {
                id: true,
                storageKey: true,
                mimeType: true,
                files: { orderBy: { sortOrder: 'asc' }, select: { id: true, storageKey: true, mimeType: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const signed = (key: string) => resolveAssetUrl(key, { isPublic: false });

  const items = await Promise.all([
    ...postUnlocks.map(async (u): Promise<PurchaseItem> => {
      const live = Boolean(u.post.liveExclusiveAt);
      return {
        id: `post-${u.id}`,
        source: live ? 'live' : 'post',
        at: u.createdAt.toISOString(),
        tokens: u.tokensSpent,
        title: contentTitle(u.post.body, '') || null,
        creator: creatorOf(u.post.model),
        // Fotos de pago: por la ruta que les pone la marca de agua del fan.
        media: await Promise.all(
          u.post.assets.map(async (a) => ({
            id: a.id,
            mimeType: a.mimeType,
            url: a.mimeType.startsWith('image/') ? `/api/posts/${u.post.id}/media/${a.id}` : await signed(a.storageKey),
          })),
        ),
        href: live ? `/models/${u.post.model.slug}` : `/models/${u.post.model.slug}?post=${u.post.id}`,
      };
    }),
    ...chatUnlocks.map(async (u): Promise<PurchaseItem> => {
      const a = u.attachment;
      const files = a.files.length ? a.files : [{ id: a.id, storageKey: a.storageKey, mimeType: a.mimeType }];
      return {
        id: `chat-${u.id}`,
        source: 'chat',
        at: u.createdAt.toISOString(),
        tokens: u.tokensSpent,
        title: a.message.body,
        creator: creatorOf(a.message.conversation.model),
        media: await Promise.all(files.map(async (f) => ({ id: f.id, mimeType: f.mimeType, url: await signed(f.storageKey) }))),
        href: `/mensajes/${a.message.conversationId}`,
      };
    }),
    ...requests.map(async (r): Promise<PurchaseItem> => {
      const a = r.deliveredMessage?.attachment;
      const files = a ? (a.files.length ? a.files : [{ id: a.id, storageKey: a.storageKey, mimeType: a.mimeType }]) : [];
      return {
        id: `req-${r.id}`,
        source: 'request',
        at: (r.deliveredAt ?? new Date()).toISOString(),
        tokens: r.quotedTokens ?? 0,
        title: r.description,
        creator: creatorOf(r.model),
        media: await Promise.all(files.map(async (f) => ({ id: f.id, mimeType: f.mimeType, url: await signed(f.storageKey) }))),
        href: r.deliveredMessage ? `/mensajes/${r.deliveredMessage.conversationId}` : '/mensajes?filtro=pedidos',
      };
    }),
  ]);

  return items.sort((x, y) => y.at.localeCompare(x.at));
}
