import 'server-only';

import { cache } from 'react';
import type { TransactionType } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * DATOS DEL PANEL DE CREADORA
 *
 * Todo lo que el panel necesita para responder a tres preguntas: que tengo
 * pendiente, cuanto he ganado y de donde viene. `cache` evita repetir las
 * consultas cuando el layout y la pagina piden lo mismo en una peticion.
 */

/** Todos los movimientos que son ingreso de la modelo, con su origen legible. */
export const EARNING_SOURCES = {
  CALL_EARNING: 'Llamadas',
  POST_EARNING: 'Publicaciones',
  SUBSCRIPTION_EARNING: 'Suscripciones',
  TIP_EARNING: 'Propinas y regalos',
  CONTENT_EARNING: 'Packs',
  CONTENT_REQUEST_EARNING: 'Pedidos a medida',
  MESSAGE_UNLOCK_EARNING: 'Mensajes',
  MESSAGE_ATTACHMENT_EARNING: 'Mensajes',
} as const satisfies Partial<Record<TransactionType, string>>;

export type EarningType = keyof typeof EARNING_SOURCES;
const EARNING_TYPES = Object.keys(EARNING_SOURCES) as EarningType[];

export interface CreatorPending {
  unansweredMessages: number;
  pendingBookings: number;
  pendingRequests: number;
}

/** Lo que espera respuesta de la creadora. */
export const getCreatorPending = cache(
  async (modelId: string, userId: string): Promise<CreatorPending> => {
    const [pendingBookings, pendingRequests, conversations] = await Promise.all([
      prisma.booking.count({ where: { modelId, status: 'PENDING_CONFIRMATION' } }),
      prisma.contentRequest.count({
        where: { modelId, status: { in: ['PENDING', 'PAID'] } },
      }),
      // No hay marca de "leido": una conversacion espera respuesta si el
      // ultimo mensaje lo escribio el fan. Se miran las mas recientes.
      prisma.conversation.findMany({
        where: { modelId },
        orderBy: { lastMessageAt: 'desc' },
        take: 100,
        select: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { senderId: true },
          },
        },
      }),
    ]);

    const unansweredMessages = conversations.filter(
      (c) => c.messages[0] && c.messages[0].senderId !== userId,
    ).length;

    return { unansweredMessages, pendingBookings, pendingRequests };
  },
);

export interface CreatorEarnings {
  /** Ultimos 7 dias, del mas antiguo a hoy. */
  days: { date: string; label: string; tokens: number }[];
  weekTokens: number;
  previousWeekTokens: number;
  monthTokens: number;
  /** Ultimos 30 dias por origen, de mayor a menor. */
  bySource: { label: string; type: EarningType; tokens: number }[];
  recent: {
    id: string;
    type: EarningType;
    label: string;
    description: string | null;
    tokens: number;
    createdAt: Date;
  }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

function startOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export const getCreatorEarnings = cache(async (userId: string): Promise<CreatorEarnings> => {
  const today = startOfDay(new Date());
  const weekStart = new Date(today.getTime() - 6 * DAY_MS);
  const prevWeekStart = new Date(weekStart.getTime() - 7 * DAY_MS);
  const monthStart = new Date(today.getTime() - 29 * DAY_MS);

  const base = { userId, type: { in: EARNING_TYPES }, status: 'COMPLETED' as const };

  const [last30, prevWeek, recent] = await Promise.all([
    prisma.transaction.findMany({
      where: { ...base, createdAt: { gte: monthStart } },
      select: { type: true, tokens: true, createdAt: true },
    }),
    prisma.transaction.aggregate({
      where: { ...base, createdAt: { gte: prevWeekStart, lt: weekStart } },
      _sum: { tokens: true },
    }),
    prisma.transaction.findMany({
      where: base,
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, type: true, description: true, tokens: true, createdAt: true },
    }),
  ]);

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart.getTime() + i * DAY_MS);
    return {
      date: date.toISOString(),
      label: i === 6 ? 'Hoy' : WEEKDAY[date.getDay()]!,
      tokens: 0,
    };
  });

  const bySourceMap = new Map<string, { label: string; type: EarningType; tokens: number }>();
  let weekTokens = 0;
  let monthTokens = 0;

  for (const t of last30) {
    const type = t.type as EarningType;
    const tokens = Math.max(0, t.tokens);
    monthTokens += tokens;

    const label = EARNING_SOURCES[type];
    const entry = bySourceMap.get(label) ?? { label, type, tokens: 0 };
    entry.tokens += tokens;
    bySourceMap.set(label, entry);

    if (t.createdAt >= weekStart) {
      weekTokens += tokens;
      const index = Math.floor((startOfDay(t.createdAt).getTime() - weekStart.getTime()) / DAY_MS);
      if (days[index]) days[index]!.tokens += tokens;
    }
  }

  return {
    days,
    weekTokens,
    previousWeekTokens: Math.max(0, prevWeek._sum.tokens ?? 0),
    monthTokens,
    bySource: [...bySourceMap.values()].sort((a, b) => b.tokens - a.tokens),
    recent: recent.map((t) => ({
      id: t.id,
      type: t.type as EarningType,
      label: EARNING_SOURCES[t.type as EarningType],
      description: t.description,
      tokens: Math.max(0, t.tokens),
      createdAt: t.createdAt,
    })),
  };
});
