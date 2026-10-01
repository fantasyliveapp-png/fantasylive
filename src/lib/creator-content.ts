import 'server-only';

import type { PostVisibility } from '@prisma/client';

import { parseTipMenu } from '@/lib/live-state';
import { prisma } from '@/lib/prisma';
import { resolveAssetUrl } from '@/lib/storage';

/**
 * CONTENIDO DE LA CREADORA, en dos sitios:
 *
 * - Publico: sus publicaciones del feed y del perfil (gratis, de pago o
 *   para suscriptores).
 * - Privado: la Boveda para el chat (archivos sueltos por niveles) y los
 *   packs de directo (publicaciones exclusivas que solo se venden en el
 *   menu "Especiales"). Lo de un sitio no se vende en el otro.
 */

export interface ContentCard {
  id: string;
  title: string;
  visibility: PostVisibility;
  priceTokens: number;
  isPublished: boolean;
  scheduledFor: string | null;
  createdAt: string;
  photos: number;
  videos: number;
  /** Miniatura real (la creadora ve su propio contenido sin difuminar). */
  thumbUrl: string | null;
  thumbIsVideo: boolean;
  sales: number;
  tokensEarned: number;
  likes: number;
  views: number;
}

export interface LivePackCard extends ContentCard {
  inMenu: boolean;
}

const CARD_SELECT = {
  id: true,
  body: true,
  visibility: true,
  priceTokens: true,
  isPublished: true,
  createdAt: true,
  unlockCount: true,
  tokensEarned: true,
  likeCount: true,
  viewCount: true,
  assets: {
    orderBy: { sortOrder: 'asc' as const },
    select: { storageKey: true, previewKey: true, mimeType: true },
  },
};

type CardRow = {
  id: string;
  body: string | null;
  visibility: PostVisibility;
  priceTokens: number;
  isPublished: boolean;
  createdAt: Date;
  unlockCount: number;
  tokensEarned: number;
  likeCount: number;
  viewCount: number;
  assets: { storageKey: string; previewKey: string | null; mimeType: string }[];
};

export function contentTitle(body: string | null, fallback = 'Sin texto') {
  const first = (body ?? '').trim().split('\n')[0] ?? '';
  if (!first) return fallback;
  return first.length > 48 ? `${first.slice(0, 47)}…` : first;
}

async function toCard(p: CardRow): Promise<ContentCard> {
  const first = p.assets[0];
  const isVideo = Boolean(first?.mimeType.startsWith('video/'));
  // En video, mejor la miniatura (si la hay) que cargar el archivo entero.
  const thumbKey = first ? (isVideo ? first.previewKey : first.storageKey) : null;
  const now = Date.now();
  return {
    id: p.id,
    title: contentTitle(p.body, p.assets.length ? 'Sin texto' : 'Solo texto'),
    visibility: p.visibility,
    priceTokens: p.priceTokens,
    isPublished: p.isPublished,
    scheduledFor: p.createdAt.getTime() > now ? p.createdAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    photos: p.assets.filter((a) => a.mimeType.startsWith('image/')).length,
    videos: p.assets.filter((a) => a.mimeType.startsWith('video/')).length,
    thumbUrl: thumbKey ? await resolveAssetUrl(thumbKey, { isPublic: false }) : null,
    thumbIsVideo: isVideo && !first?.previewKey,
    sales: p.unlockCount,
    tokensEarned: p.tokensEarned,
    likes: p.likeCount,
    views: p.viewCount,
  };
}

/** Packs de directo, marcando cuales estan ahora en su menu "Especiales". */
export async function getLivePacks(modelId: string): Promise<LivePackCard[]> {
  const [rows, profile] = await Promise.all([
    prisma.post.findMany({
      where: { modelId, liveExclusiveAt: { not: null }, removedAt: null },
      orderBy: { liveExclusiveAt: 'desc' },
      take: 200,
      select: CARD_SELECT,
    }),
    prisma.modelProfile.findUnique({ where: { id: modelId }, select: { liveTipMenu: true } }),
  ]);
  const inMenu = new Set(
    parseTipMenu(profile?.liveTipMenu)
      .map((i) => i.postId)
      .filter(Boolean),
  );
  const cards = await Promise.all(rows.map(toCard));
  return cards.map((c) => ({ ...c, title: c.title === 'Sin texto' ? 'Pack sin nombre' : c.title, inMenu: inMenu.has(c.id) }));
}
