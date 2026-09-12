import 'server-only';

import type { TransactionType } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * ANALITICAS DE CREADORA
 *
 * Responde a tres preguntas: quien me compra, quien me visita y de donde sale
 * mi dinero. Todo se calcula sobre las tablas que ya existen (Transaction,
 * ProfileVisit, Follow), sin tablas de agregacion nuevas: con el volumen de
 * una creadora individual las consultas son baratas y los numeros nunca se
 * quedan desincronizados de la contabilidad real.
 *
 * IMPORTANTE: los ingresos se leen de las transacciones de la CUENTA de la
 * creadora (tipos *_EARNING), no de lo que gasto el usuario. Asi el panel
 * muestra lo que de verdad entra en su monedero, ya descontada la comision.
 */

/** Tipos de movimiento que representan una compra de un usuario a la creadora. */
const EARNING_TYPES: TransactionType[] = [
  'CALL_EARNING',
  'CONTENT_EARNING',
  'TIP_EARNING',
  'SUBSCRIPTION_EARNING',
  'CONTENT_REQUEST_EARNING',
  'MESSAGE_UNLOCK_EARNING',
  'MESSAGE_ATTACHMENT_EARNING',
  'POST_EARNING',
];

/** Etiqueta legible del origen del ingreso, para el desglose. */
export const EARNING_SOURCE_LABELS: Record<string, string> = {
  CALL_EARNING: 'Videollamadas',
  CONTENT_EARNING: 'Packs de contenido',
  TIP_EARNING: 'Regalos y propinas',
  SUBSCRIPTION_EARNING: 'Suscripciones',
  CONTENT_REQUEST_EARNING: 'Pedidos a medida',
  MESSAGE_UNLOCK_EARNING: 'Conversaciones',
  MESSAGE_ATTACHMENT_EARNING: 'Adjuntos de mensaje',
  POST_EARNING: 'Publicaciones del feed',
};

export interface TopBuyer {
  userId: string;
  name: string;
  image: string | null;
  country: string | null;
  tokens: number;
  purchases: number;
  lastPurchaseAt: string;
  /** Visitas registradas de esa persona a este perfil */
  visits: number;
}

export interface TopVisitor {
  userId: string | null;
  name: string;
  image: string | null;
  country: string | null;
  visits: number;
  lastVisitAt: string;
  /** Tokens que ha gastado con esta creadora (0 si nunca compro) */
  tokensSpent: number;
}

export interface CreatorAnalytics {
  rangeDays: number;
  totals: {
    tokensEarned: number;
    purchases: number;
    buyers: number;
    visits: number;
    uniqueVisitors: number;
    newFollowers: number;
    /** % de visitantes distintos que acabaron comprando algo */
    conversionPercent: number;
  };
  bySource: Array<{ type: string; label: string; tokens: number }>;
  byDay: Array<{ day: string; tokens: number; visits: number }>;
  topBuyers: TopBuyer[];
  topVisitors: TopVisitor[];
  topCountries: Array<{ country: string; visits: number }>;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Panel completo de una creadora para los ultimos `rangeDays` dias.
 *
 * `modelUserId` es la cuenta de usuario de la creadora (donde viven sus
 * transacciones) y `modelId` su perfil (donde viven las visitas y los
 * seguidores): son dos identificadores distintos y confundirlos devuelve el
 * panel vacio sin dar ningun error.
 */
export async function getCreatorAnalytics(params: {
  modelId: string;
  modelUserId: string;
  rangeDays?: number;
}): Promise<CreatorAnalytics> {
  const rangeDays = params.rangeDays ?? 30;
  const since = daysAgo(rangeDays);

  const [earnings, visits, newFollowers] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId: params.modelUserId,
        type: { in: EARNING_TYPES },
        status: 'COMPLETED',
        createdAt: { gte: since },
      },
      select: {
        type: true,
        tokens: true,
        createdAt: true,
        callSession: { select: { callerId: true } },
        contentPackage: { select: { id: true } },
        gift: { select: { senderId: true } },
        conversation: { select: { userId: true } },
        subscription: { select: { userId: true } },
        contentRequest: { select: { userId: true } },
        post: { select: { id: true } },
        metadata: true,
      },
    }),
    prisma.profileVisit.findMany({
      where: { modelId: params.modelId, createdAt: { gte: since } },
      select: {
        viewerId: true,
        country: true,
        visits: true,
        day: true,
        updatedAt: true,
        viewer: { select: { id: true, name: true, image: true, country: true } },
      },
    }),
    prisma.follow.count({
      where: { modelId: params.modelId, createdAt: { gte: since } },
    }),
  ]);

  // --- Ingresos por origen y por dia ---------------------------------------
  const bySourceMap = new Map<string, number>();
  const byDayMap = new Map<string, { tokens: number; visits: number }>();

  for (let i = rangeDays - 1; i >= 0; i--) {
    byDayMap.set(dayKey(daysAgo(i)), { tokens: 0, visits: 0 });
  }

  let tokensEarned = 0;
  for (const tx of earnings) {
    const tokens = Math.abs(tx.tokens);
    tokensEarned += tokens;
    bySourceMap.set(tx.type, (bySourceMap.get(tx.type) ?? 0) + tokens);

    const key = dayKey(tx.createdAt);
    const bucket = byDayMap.get(key);
    if (bucket) bucket.tokens += tokens;
  }

  // --- Quien compra --------------------------------------------------------
  //
  // El comprador se deduce del vinculo de la transaccion, que cambia segun el
  // tipo de ingreso: la llamada guarda a quien llamo, el regalo a quien lo
  // envio, la conversacion y la suscripcion al usuario. Los ingresos por pack
  // de contenido no guardan al comprador en la transaccion de la creadora, asi
  // que se resuelven despues contra ContentUnlock.
  const buyerTokens = new Map<string, { tokens: number; purchases: number; last: Date }>();

  const addBuyer = (userId: string | null | undefined, tokens: number, at: Date) => {
    if (!userId) return;
    const current = buyerTokens.get(userId);
    if (current) {
      current.tokens += tokens;
      current.purchases += 1;
      if (at > current.last) current.last = at;
    } else {
      buyerTokens.set(userId, { tokens, purchases: 1, last: at });
    }
  };

  for (const tx of earnings) {
    const tokens = Math.abs(tx.tokens);
    addBuyer(
      tx.callSession?.callerId ??
        tx.gift?.senderId ??
        tx.conversation?.userId ??
        tx.subscription?.userId ??
        tx.contentRequest?.userId ??
        null,
      tokens,
      tx.createdAt,
    );
  }

  // Compradores de packs y de publicaciones: se cruzan por sus tablas de
  // desbloqueo, que si guardan quien pago.
  const [contentUnlocks, postUnlocks] = await Promise.all([
    prisma.contentUnlock.findMany({
      where: {
        createdAt: { gte: since },
        package: { modelId: params.modelId },
      },
      select: { userId: true, tokensSpent: true, createdAt: true },
    }),
    prisma.postUnlock.findMany({
      where: { createdAt: { gte: since }, post: { modelId: params.modelId } },
      select: { userId: true, tokensSpent: true, createdAt: true },
    }),
  ]);

  for (const unlock of [...contentUnlocks, ...postUnlocks]) {
    addBuyer(unlock.userId, unlock.tokensSpent, unlock.createdAt);
  }

  // --- Visitas -------------------------------------------------------------
  const visitorMap = new Map<
    string,
    { userId: string | null; name: string; image: string | null; country: string | null; visits: number; last: Date }
  >();
  const countryMap = new Map<string, number>();
  let totalVisits = 0;

  for (const visit of visits) {
    totalVisits += visit.visits;

    const bucket = byDayMap.get(visit.day);
    if (bucket) bucket.visits += visit.visits;

    const country = visit.viewer?.country ?? visit.country;
    if (country) {
      countryMap.set(country, (countryMap.get(country) ?? 0) + visit.visits);
    }

    const key = visit.viewerId ?? 'anon';
    const current = visitorMap.get(key);
    if (current) {
      current.visits += visit.visits;
      if (visit.updatedAt > current.last) current.last = visit.updatedAt;
    } else {
      visitorMap.set(key, {
        userId: visit.viewerId,
        name: visit.viewer?.name ?? 'Visitante',
        image: visit.viewer?.image ?? null,
        country: country ?? null,
        visits: visit.visits,
        last: visit.updatedAt,
      });
    }
  }

  // --- Datos de los usuarios que aparecen en los rankings -------------------
  const userIds = [
    ...new Set([
      ...buyerTokens.keys(),
      ...[...visitorMap.values()].map((v) => v.userId).filter(Boolean),
    ]),
  ] as string[];

  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, image: true, country: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const visitsByUser = new Map(
    [...visitorMap.values()]
      .filter((v) => v.userId)
      .map((v) => [v.userId as string, v.visits]),
  );

  const topBuyers: TopBuyer[] = [...buyerTokens.entries()]
    .map(([userId, data]) => {
      const user = userById.get(userId);
      return {
        userId,
        // Si no hay nombre se usa la parte local del correo: mostrar el correo
        // completo de un cliente en el panel de la creadora seria de mas.
        name: user?.name ?? user?.email?.split('@')[0] ?? 'Usuario',
        image: user?.image ?? null,
        country: user?.country ?? null,
        tokens: data.tokens,
        purchases: data.purchases,
        lastPurchaseAt: data.last.toISOString(),
        visits: visitsByUser.get(userId) ?? 0,
      };
    })
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 15);

  const tokensByBuyer = new Map(
    [...buyerTokens.entries()].map(([id, d]) => [id, d.tokens]),
  );

  const topVisitors: TopVisitor[] = [...visitorMap.values()]
    .map((visitor) => {
      const user = visitor.userId ? userById.get(visitor.userId) : null;
      return {
        userId: visitor.userId,
        name: user?.name ?? user?.email?.split('@')[0] ?? visitor.name,
        image: user?.image ?? visitor.image,
        country: user?.country ?? visitor.country,
        visits: visitor.visits,
        lastVisitAt: visitor.last.toISOString(),
        tokensSpent: visitor.userId
          ? (tokensByBuyer.get(visitor.userId) ?? 0)
          : 0,
      };
    })
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 15);

  const uniqueVisitors = visitorMap.size;
  const buyers = buyerTokens.size;

  return {
    rangeDays,
    totals: {
      tokensEarned,
      purchases: earnings.length + contentUnlocks.length + postUnlocks.length,
      buyers,
      visits: totalVisits,
      uniqueVisitors,
      newFollowers,
      conversionPercent:
        uniqueVisitors > 0 ? Math.round((buyers / uniqueVisitors) * 100) : 0,
    },
    bySource: [...bySourceMap.entries()]
      .map(([type, tokens]) => ({
        type,
        label: EARNING_SOURCE_LABELS[type] ?? type,
        tokens,
      }))
      .sort((a, b) => b.tokens - a.tokens),
    byDay: [...byDayMap.entries()].map(([day, data]) => ({ day, ...data })),
    topBuyers,
    topVisitors,
    topCountries: [...countryMap.entries()]
      .map(([country, visits]) => ({ country, visits }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 10),
  };
}
