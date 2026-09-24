import 'server-only';

import { prisma } from '@/lib/prisma';
import { withdrawableTokens } from '@/lib/tokens';

/**
 * EQUIPO DE CHAT
 *
 * Una creadora puede delegar sus mensajes en otras cuentas (chatters). El
 * chatter entra con su propia cuenta, ve la bandeja de ella y escribe en su
 * nombre. Lo que vende en el chat (archivos de pago que envia) se reparte
 * solo: su % sale de la parte de la creadora; la plataforma cobra lo mismo.
 *
 * El chatter NUNCA ve el dinero de ella, sus retiros, su verificacion ni el
 * email de los fans: solo la bandeja.
 */

export const MAX_CHATTER_PERCENT = 50;
export const MAX_TEAM_SIZE = 10;

/** Quien mira un chat fan <-> creadora, y en calidad de que. */
export type ChatRole = 'fan' | 'creator' | 'assistant';

export async function getChatRole(
  conversation: { userId: string; model: { id: string; userId: string } },
  viewerId: string,
): Promise<ChatRole | null> {
  if (conversation.userId === viewerId) return 'fan';
  if (conversation.model.userId === viewerId) return 'creator';
  return (await activeAssistant(conversation.model.id, viewerId)) ? 'assistant' : null;
}

/** El chatter activo de esta creadora (o null). */
export function activeAssistant(modelId: string, userId: string) {
  return prisma.chatAssistant.findFirst({
    where: { modelId, userId, status: 'ACTIVE' },
    select: { id: true, userId: true, percent: true },
  });
}

/** Cuentas del equipo que deben enterarse de un mensaje nuevo de un fan. */
export async function activeAssistantIds(modelId: string): Promise<string[]> {
  const rows = await prisma.chatAssistant.findMany({
    where: { modelId, status: 'ACTIVE' },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** Creadoras para las que trabaja (o la han invitado) esta cuenta. */
export function getMyTeams(userId: string) {
  return prisma.chatAssistant.findMany({
    where: { userId, status: { in: ['INVITED', 'ACTIVE'] } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      status: true,
      percent: true,
      model: { select: { id: true, userId: true, stageName: true, avatarUrl: true, slug: true } },
    },
  });
}

/**
 * Ventas y ganancias de cada chatter de una creadora desde `since`.
 * saleTokens = lo que pago el fan; earnedTokens = lo que cobro el chatter.
 */
export async function teamSales(modelUserId: string, since: Date) {
  const rows = await prisma.transaction.findMany({
    where: {
      type: 'CHATTER_EARNING',
      createdAt: { gte: since },
      metadata: { path: ['creatorUserId'], equals: modelUserId },
    },
    select: { userId: true, tokens: true, metadata: true },
  });
  const byUser = new Map<string, { sales: number; saleTokens: number; earnedTokens: number }>();
  for (const r of rows) {
    const meta = (r.metadata ?? {}) as { saleTokens?: number };
    const cur = byUser.get(r.userId) ?? { sales: 0, saleTokens: 0, earnedTokens: 0 };
    cur.sales += 1;
    cur.saleTokens += meta.saleTokens ?? 0;
    cur.earnedTokens += r.tokens;
    byUser.set(r.userId, cur);
  }
  return byUser;
}

export function startOfMonth() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Admin: todas las personas que han llevado mensajes, con sus creadoras y
 * lo que hay que pagarles. Las que son creadoras retiran solas desde su panel;
 * al resto se les paga a mano, como a los reclutadores.
 */
export async function getChattersForAdmin() {
  const users = await prisma.user.findMany({
    where: { chatAssistantOf: { some: {} } },
    select: {
      id: true,
      username: true,
      email: true,
      status: true,
      modelProfile: { select: { id: true } },
      wallet: { select: { balance: true, pendingEarnings: true } },
      chatAssistantOf: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          status: true,
          percent: true,
          model: { select: { stageName: true, userId: true } },
        },
      },
    },
  });
  const earned = await prisma.transaction.groupBy({
    by: ['userId'],
    where: { type: 'CHATTER_EARNING', userId: { in: users.map((u) => u.id) } },
    _sum: { tokens: true },
  });
  const earnedBy = new Map(earned.map((e) => [e.userId, e._sum.tokens ?? 0]));
  return users
    .map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      status: u.status,
      isCreator: Boolean(u.modelProfile),
      teams: u.chatAssistantOf,
      earnedTokens: earnedBy.get(u.id) ?? 0,
      pendingTokens: u.wallet ? withdrawableTokens(u.wallet) : 0,
    }))
    .sort((a, b) => b.pendingTokens - a.pendingTokens);
}
