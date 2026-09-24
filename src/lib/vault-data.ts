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
    })),
  );
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
    prisma.messageAttachment.groupBy({
      by: ['vaultItemId'],
      where: { vaultItem: { modelId } },
      _count: { _all: true },
    }),
    prisma.messageAttachmentUnlock.findMany({
      where: { attachment: { vaultItem: { modelId } } },
      select: { tokensSpent: true, attachment: { select: { vaultItemId: true } } },
    }),
    prisma.messageAttachment.findMany({
      where: { vaultItem: { modelId, section: 'TEASER' } },
      select: { vaultItemId: true, createdAt: true, message: { select: { conversationId: true } } },
    }),
  ]);

  // Enganche: tras recibir el adelanto, ¿compro algo en ese chat en 7 dias?
  const convIds = [...new Set(teaserSends.map((t) => t.message.conversationId))];
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
    if (!u.attachment.vaultItemId) continue;
    const st = get(u.attachment.vaultItemId);
    st.sales += 1;
    st.tokens += u.tokensSpent;
  }
  for (const t of teaserSends) {
    if (!t.vaultItemId) continue;
    const buys = buysByConv.get(t.message.conversationId) ?? [];
    const sentAt = t.createdAt.getTime();
    if (buys.some((b) => b.getTime() > sentAt && b.getTime() - sentAt < TEASER_WINDOW_MS)) {
      get(t.vaultItemId).hooked += 1;
    }
  }

  return {
    items: items.map((i) => ({
      ...i,
      stats: stats.get(i.id) ?? { sends: 0, sales: 0, tokens: 0, hooked: 0 },
    })),
    folders: folderList,
  };
}

export type CreatorVault = Awaited<ReturnType<typeof getVaultForCreator>>;

/**
 * Boveda vista desde un chat: que se le ha enviado ya a ese fan, que ha
 * comprado, y una pista de hasta donde llega (nivel y gasto en el chat).
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
    prisma.messageAttachment.findMany({
      where: { vaultItemId: { not: null }, message: { conversationId } },
      select: { vaultItemId: true },
    }),
    prisma.messageAttachmentUnlock.findMany({
      where: { userId: fanId, attachment: { vaultItem: { modelId } } },
      select: { attachment: { select: { vaultItem: { select: { id: true, section: true } } } } },
    }),
    prisma.messageAttachmentUnlock.aggregate({
      where: { userId: fanId, attachment: { message: { conversationId } } },
      _sum: { tokensSpent: true },
      _count: true,
    }),
  ]);

  const boughtItems = bought.map((b) => b.attachment.vaultItem).filter((v) => v !== null);
  const topRank = Math.max(0, ...boughtItems.map((v) => SECTION_RANK[v.section]));
  return {
    items,
    folders: folderList,
    sentIds: [...new Set(sent.map((s) => s.vaultItemId!).filter(Boolean))],
    boughtIds: [...new Set(boughtItems.map((v) => v.id))],
    fan: {
      topLevel: topRank,
      purchases: spent._count,
      spentTokens: spent._sum.tokensSpent ?? 0,
    },
  };
}

export type ChatVault = Awaited<ReturnType<typeof getVaultForChat>>;
