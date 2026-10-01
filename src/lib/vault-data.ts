import 'server-only';

import type { VaultSection } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { resolveAssetUrl } from '@/lib/storage';
import { SECTION_RANK, suggestedPrice, type VaultPrices } from '@/lib/vault';

const TEASER_WINDOW_MS = 7 * 24 * 3600 * 1000;

export interface VaultItemView {
  id: string;
  section: VaultSection;
  folderId: string | null;
  mimeType: string;
  note: string | null;
  /** Precio propio (null = el del nivel). */
  priceTokens: number | null;
  /** Lo que se propone al enviarlo. */
  suggestedPrice: number;
  url: string | null;
  createdAt: string;
  /** Paquete al que pertenece (solo se vende dentro de el). */
  packId: string | null;
}

export interface VaultPackView {
  id: string;
  name: string;
  priceTokens: number;
  itemIds: string[];
  photos: number;
  videos: number;
}

async function itemViews(modelId: string, prices: VaultPrices): Promise<VaultItemView[]> {
  const items = await prisma.vaultItem.findMany({
    where: { modelId },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });
  return Promise.all(
    items.map(async (i) => ({
      id: i.id,
      section: i.section,
      folderId: i.folderId,
      mimeType: i.mimeType,
      note: i.note,
      priceTokens: i.priceTokens,
      suggestedPrice: suggestedPrice(i, prices),
      url: await resolveAssetUrl(i.storageKey, { isPublic: false }),
      createdAt: i.createdAt.toISOString(),
      packId: i.packId,
    })),
  );
}

/** Paquetes con sus archivos (los vacios no se muestran). */
async function packViews(modelId: string, items: VaultItemView[]): Promise<VaultPackView[]> {
  const packs = await prisma.vaultPack.findMany({
    where: { modelId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, priceTokens: true },
  });
  return packs
    .map((p) => {
      const inPack = items.filter((i) => i.packId === p.id);
      const videos = inPack.filter((i) => i.mimeType.startsWith('video/')).length;
      return { ...p, itemIds: inPack.map((i) => i.id), photos: inPack.length - videos, videos };
    })
    .filter((p) => p.itemIds.length > 0);
}

function folders(modelId: string) {
  return prisma.vaultFolder.findMany({
    where: { modelId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}

/** Boveda completa para la creadora, con lo que ha vendido cada archivo. */
export async function getVaultForCreator(modelId: string, prices: VaultPrices) {
  const [items, folderList, sends, unlocks, teaserSends] = await Promise.all([
    itemViews(modelId, prices),
    folders(modelId),
    prisma.messageAttachmentFile.groupBy({
      by: ['vaultItemId'],
      where: { vaultItem: { modelId } },
      _count: { _all: true },
    }),
    // Un envio puede llevar varios archivos: su venta se reparte entre ellos.
    prisma.messageAttachmentUnlock.findMany({
      where: { attachment: { files: { some: { vaultItem: { modelId } } } } },
      select: {
        tokensSpent: true,
        createdAt: true,
        attachment: { select: { files: { select: { vaultItemId: true } } } },
      },
    }),
    prisma.messageAttachmentFile.findMany({
      where: { vaultItem: { modelId, section: 'TEASER' } },
      select: {
        vaultItemId: true,
        createdAt: true,
        attachment: { select: { message: { select: { conversationId: true } } } },
      },
    }),
  ]);

  // Enganche: tras recibir el adelanto, ¿compro algo en ese chat en 7 dias?
  const convIds = [...new Set(teaserSends.map((t) => t.attachment.message.conversationId))];
  const purchases = convIds.length
    ? await prisma.messageAttachmentUnlock.findMany({
        where: { attachment: { message: { conversationId: { in: convIds } } } },
        select: {
          createdAt: true,
          attachment: { select: { message: { select: { conversationId: true } } } },
        },
      })
    : [];
  const buysByConv = new Map<string, Date[]>();
  for (const p of purchases) {
    const c = p.attachment.message.conversationId;
    buysByConv.set(c, [...(buysByConv.get(c) ?? []), p.createdAt]);
  }

  const stats = new Map<string, { sends: number; sales: number; tokens: number; hooked: number }>();
  const get = (id: string) => {
    const cur = stats.get(id) ?? { sends: 0, sales: 0, tokens: 0, hooked: 0 };
    stats.set(id, cur);
    return cur;
  };
  for (const s of sends) if (s.vaultItemId) get(s.vaultItemId).sends = s._count._all;
  for (const u of unlocks) {
    const ids = u.attachment.files.map((f) => f.vaultItemId).filter((id): id is string => Boolean(id));
    for (const id of ids) {
      const st = get(id);
      st.sales += 1;
      st.tokens += Math.round(u.tokensSpent / u.attachment.files.length);
    }
  }
  for (const t of teaserSends) {
    if (!t.vaultItemId) continue;
    const buys = buysByConv.get(t.attachment.message.conversationId) ?? [];
    const sentAt = t.createdAt.getTime();
    if (buys.some((b) => b.getTime() > sentAt && b.getTime() - sentAt < TEASER_WINDOW_MS)) {
      get(t.vaultItemId).hooked += 1;
    }
  }

  // Ventas de cada paquete: envios desbloqueados que llevaban sus archivos.
  // Solo cuenta lo vendido desde que existe el paquete.
  const packList = await packViews(modelId, items);
  const packCreated = new Map(
    (await prisma.vaultPack.findMany({ where: { modelId }, select: { id: true, createdAt: true } })).map((p) => [p.id, p.createdAt]),
  );
  const packOf = new Map(items.filter((i) => i.packId).map((i) => [i.id, i.packId!]));
  const packStats = new Map<string, { sales: number; tokens: number }>();
  for (const u of unlocks) {
    const packIds = new Set(u.attachment.files.map((f) => (f.vaultItemId ? packOf.get(f.vaultItemId) : undefined)));
    for (const id of packIds) {
      if (!id) continue;
      const since = packCreated.get(id);
      if (since && u.createdAt < since) continue;
      const cur = packStats.get(id) ?? { sales: 0, tokens: 0 };
      cur.sales += 1;
      cur.tokens += u.tokensSpent;
      packStats.set(id, cur);
    }
  }

  return {
    items: items.map((i) => ({
      ...i,
      stats: stats.get(i.id) ?? { sends: 0, sales: 0, tokens: 0, hooked: 0 },
    })),
    packs: packList.map((p) => ({
      ...p,
      stats: packStats.get(p.id) ?? { sales: 0, tokens: 0 },
    })),
    folders: folderList,
  };
}

export type CreatorVault = Awaited<ReturnType<typeof getVaultForCreator>>;

/**
 * Boveda vista desde un chat: que se le ha enviado ya a ese fan, que tiene
 * (lo comprado y lo que recibio gratis) y una pista de hasta donde llega.
 */
export async function getVaultForChat(params: {
  modelId: string;
  prices: VaultPrices;
  conversationId: string;
  fanId: string;
}) {
  const { modelId, prices, conversationId, fanId } = params;
  const [items, folderList, sent, bought, spent] = await Promise.all([
    itemViews(modelId, prices),
    folders(modelId),
    prisma.messageAttachmentFile.findMany({
      where: { vaultItemId: { not: null }, attachment: { message: { conversationId } } },
      select: { vaultItemId: true, attachment: { select: { priceTokens: true } } },
    }),
    prisma.messageAttachmentUnlock.findMany({
      where: { userId: fanId, attachment: { files: { some: { vaultItem: { modelId } } } } },
      select: {
        attachment: {
          select: { files: { select: { vaultItem: { select: { id: true, section: true } } } } },
        },
      },
    }),
    prisma.messageAttachmentUnlock.aggregate({
      where: { userId: fanId, attachment: { message: { conversationId } } },
      _sum: { tokensSpent: true },
      _count: true,
    }),
  ]);

  const boughtItems = bought
    .flatMap((b) => b.attachment.files.map((f) => f.vaultItem))
    .filter((v) => v !== null);
  const freeIds = sent.filter((s) => s.attachment.priceTokens <= 0).map((s) => s.vaultItemId!);
  const topRank = Math.max(0, ...boughtItems.map((v) => SECTION_RANK[v.section]));
  return {
    items,
    packs: await packViews(modelId, items),
    folders: folderList,
    sentIds: [...new Set(sent.map((s) => s.vaultItemId!).filter(Boolean))],
    boughtIds: [...new Set([...boughtItems.map((v) => v.id), ...freeIds])],
    fan: {
      topLevel: topRank,
      purchases: spent._count,
      spentTokens: spent._sum.tokensSpent ?? 0,
    },
  };
}

export type ChatVault = Awaited<ReturnType<typeof getVaultForChat>>;
