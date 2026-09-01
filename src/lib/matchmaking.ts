import 'server-only';

import type { Gender, QueueMode } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { isCountryBlocked } from '@/lib/geo';
import { randomRoomName } from '@/lib/utils';

export interface JoinQueueInput {
  userId: string;
  mode: QueueMode;
  selfGender?: Gender | null;
  genderPreference?: Gender[];
  countryPreference?: string | null;
  /** Pais ISO del usuario, resuelto por geolocalizacion al entrar en cola. */
  selfCountry?: string | null;
}

export interface MatchResult {
  status: 'waiting' | 'matched';
  queueEntryId: string;
  sessionId?: string;
  roomName?: string;
  partnerId?: string;
  ratePerMinute?: number;
}

const QUEUE_TTL_MS = config.matchmaking.queueTtlSeconds * 1000;

/** Marca como expiradas las entradas sin heartbeat reciente. */
export async function reapStaleEntries(): Promise<number> {
  const cutoff = new Date(Date.now() - QUEUE_TTL_MS);
  const result = await prisma.matchQueueEntry.updateMany({
    where: { status: 'WAITING', heartbeatAt: { lt: cutoff } },
    data: { status: 'EXPIRED' },
  });
  return result.count;
}

/** IDs con los que este usuario NO debe emparejarse (skips y bloqueos). */
async function getExcludedUserIds(userId: string): Promise<string[]> {
  const now = new Date();
  const pairs = await prisma.blockedPair.findMany({
    where: {
      AND: [
        { OR: [{ blockerId: userId }, { blockedId: userId }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });

  const ids = new Set<string>();
  for (const p of pairs) {
    ids.add(p.blockerId === userId ? p.blockedId : p.blockerId);
  }
  return [...ids];
}

/**
 * Entra en la cola e intenta emparejar de inmediato.
 *
 * Estrategia (serializable, sin dependencias externas):
 *  1. Se limpian entradas muertas.
 *  2. Se cancela cualquier entrada previa del mismo usuario.
 *  3. Dentro de una transaccion se busca el candidato mas antiguo compatible
 *     y se marca MATCHED con un UPDATE condicional (evita doble emparejamiento).
 *  4. Si no hay candidato, queda WAITING y el cliente hace polling/SSE.
 */
export async function joinQueue(input: JoinQueueInput): Promise<MatchResult> {
  await reapStaleEntries();

  // Una sola entrada activa por usuario
  await prisma.matchQueueEntry.updateMany({
    where: { userId: input.userId, status: 'WAITING' },
    data: { status: 'CANCELLED' },
  });

  const now = new Date();

  const entry = await prisma.matchQueueEntry.create({
    data: {
      userId: input.userId,
      mode: input.mode,
      selfGender: input.selfGender ?? undefined,
      genderPreference: input.genderPreference ?? [],
      countryPreference: input.countryPreference ?? undefined,
      selfCountry: input.selfCountry ?? undefined,
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + QUEUE_TTL_MS),
    },
  });

  const match = await tryMatch(entry.id);
  return match ?? { status: 'waiting', queueEntryId: entry.id };
}

/**
 * Intenta emparejar una entrada concreta. Devuelve null si sigue esperando.
 * Es idempotente: si la entrada ya fue emparejada devuelve ese match.
 */
export async function tryMatch(entryId: string): Promise<MatchResult | null> {
  const entry = await prisma.matchQueueEntry.findUnique({
    where: { id: entryId },
    include: {
      user: {
        select: {
          id: true,
          gender: true,
          isVip: true,
          modelProfile: {
            select: {
              blockedCountries: true,
              isVipEnabled: true,
              isAvailableForVip: true,
              vipRatePerMinute: true,
            },
          },
        },
      },
    },
  });

  if (!entry) return null;

  // Ya emparejado por el otro lado
  if (entry.status === 'MATCHED' && entry.matchedSessionId) {
    const session = await prisma.callSession.findUnique({
      where: { id: entry.matchedSessionId },
      select: { id: true, roomName: true, ratePerMinute: true },
    });
    if (session) {
      return {
        status: 'matched',
        queueEntryId: entry.id,
        sessionId: session.id,
        roomName: session.roomName,
        partnerId: entry.matchedWithId ?? undefined,
        ratePerMinute: session.ratePerMinute,
      };
    }
  }

  if (entry.status !== 'WAITING') return null;

  const excluded = await getExcludedUserIds(entry.userId);
  const cutoff = new Date(Date.now() - QUEUE_TTL_MS);

  return prisma.$transaction(async (tx) => {
    // Busca candidatos vivos del mismo modo, excluyendo bloqueados y a si mismo
    const candidates = await tx.matchQueueEntry.findMany({
      where: {
        id: { not: entry.id },
        mode: entry.mode,
        status: 'WAITING',
        heartbeatAt: { gte: cutoff },
        userId: { notIn: [entry.userId, ...excluded] },
        ...(entry.genderPreference.length > 0
          ? { selfGender: { in: entry.genderPreference } }
          : {}),
        ...(entry.countryPreference
          ? { countryPreference: entry.countryPreference }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
      include: {
        user: {
          select: {
            id: true,
            gender: true,
            isVip: true,
            status: true,
            modelProfile: {
              select: {
                id: true,
                blockedCountries: true,
                isVipEnabled: true,
                isAvailableForVip: true,
                vipRatePerMinute: true,
                kycStatus: true,
                userId: true,
              },
            },
          },
        },
      },
    });

    // Filtro de reciprocidad: la preferencia del candidato debe aceptarme
    const viable = candidates.filter((c) => {
      if (c.user.status !== 'ACTIVE') return false;
      if (c.genderPreference.length > 0) {
        const mine = entry.selfGender ?? entry.user.gender;
        if (!mine || !c.genderPreference.includes(mine)) return false;
      }
      // Bloqueo geografico, en los dos sentidos: ni la modelo atiende a un
      // pais que bloquea, ni se le manda a alguien que ella bloquea.
      if (isCountryBlocked(c.user.modelProfile?.blockedCountries, entry.selfCountry)) {
        return false;
      }
      if (isCountryBlocked(entry.user.modelProfile?.blockedCountries, c.selfCountry)) {
        return false;
      }

      if (entry.mode === 'VIP') {
        // En modo VIP uno de los dos debe ser una modelo VIP disponible
        const iAmModel = Boolean(entry.user.isVip);
        const partnerIsVipModel = Boolean(
          c.user.modelProfile?.isVipEnabled &&
            c.user.modelProfile?.isAvailableForVip,
        );
        if (!partnerIsVipModel && !iAmModel) return false;
      }
      return true;
    });

    const partner = viable[0];
    if (!partner) return null;

    // Reserva atomica del partner: solo gana quien lo pase de WAITING a MATCHED
    const claimed = await tx.matchQueueEntry.updateMany({
      where: { id: partner.id, status: 'WAITING' },
      data: { status: 'MATCHED', matchedWithId: entry.userId },
    });
    if (claimed.count === 0) return null;

    const claimedSelf = await tx.matchQueueEntry.updateMany({
      where: { id: entry.id, status: 'WAITING' },
      data: { status: 'MATCHED', matchedWithId: partner.userId },
    });
    if (claimedSelf.count === 0) {
      // Alguien nos emparejo mientras tanto: liberamos al partner
      await tx.matchQueueEntry.updateMany({
        where: { id: partner.id, status: 'MATCHED', matchedWithId: entry.userId },
        data: { status: 'WAITING', matchedWithId: null },
      });
      return null;
    }

    // Determina quien paga y a que tarifa.
    //
    // En VIP paga SIEMPRE el usuario y cobra la modelo. Cualquiera de los dos
    // puede ser quien dispara el emparejamiento, asi que hay que mirar de que
    // lado esta el perfil de modelo.
    //
    // OJO: aqui habia un bug. Las dos ramas del ternario devolvian
    // entry.userId, de modo que cuando era la modelo la que entraba en cola
    // acababa siendo ella la pagadora y el usuario el que cobraba: el cobro
    // salia invertido la mitad de las veces.
    const isVipCall = entry.mode === 'VIP';
    const partnerModel = partner.user.modelProfile;
    const entryModel = entry.user.modelProfile;

    const partnerIsVipModel = Boolean(
      partnerModel?.isVipEnabled && partnerModel?.isAvailableForVip,
    );
    const entryIsVipModel = Boolean(
      entryModel?.isVipEnabled && entryModel?.isAvailableForVip,
    );

    // La modelo es el "callee" (cobra); el otro es el "caller" (paga).
    const modelIsEntry = isVipCall && entryIsVipModel && !partnerIsVipModel;

    const callerId = modelIsEntry ? partner.userId : entry.userId;
    const calleeId = modelIsEntry ? entry.userId : partner.userId;

    const billingModel = modelIsEntry ? entryModel : partnerModel;
    const ratePerMinute =
      isVipCall && billingModel ? billingModel.vipRatePerMinute : 0;

    const session = await tx.callSession.create({
      data: {
        type: isVipCall ? 'VIP_RANDOM' : 'RANDOM',
        status: 'PENDING',
        callerId,
        calleeId,
        roomName: randomRoomName(isVipCall ? 'vip' : 'rnd'),
        ratePerMinute,
      },
      select: { id: true, roomName: true, ratePerMinute: true },
    });

    await tx.matchQueueEntry.updateMany({
      where: { id: { in: [entry.id, partner.id] } },
      data: { matchedSessionId: session.id },
    });

    return {
      status: 'matched' as const,
      queueEntryId: entry.id,
      sessionId: session.id,
      roomName: session.roomName,
      partnerId: partner.userId,
      ratePerMinute: session.ratePerMinute,
    };
  });
}

/** Refresca el heartbeat y consulta el estado. Lo llama el cliente cada ~5s. */
export async function pollQueue(
  entryId: string,
  userId: string,
): Promise<MatchResult | { status: 'cancelled' | 'expired' }> {
  const entry = await prisma.matchQueueEntry.findFirst({
    where: { id: entryId, userId },
  });
  if (!entry) return { status: 'expired' };

  if (entry.status === 'WAITING') {
    await prisma.matchQueueEntry.update({
      where: { id: entryId },
      data: {
        heartbeatAt: new Date(),
        expiresAt: new Date(Date.now() + QUEUE_TTL_MS),
      },
    });
    const match = await tryMatch(entryId);
    return match ?? { status: 'waiting', queueEntryId: entryId };
  }

  if (entry.status === 'MATCHED') {
    return (await tryMatch(entryId)) ?? { status: 'waiting', queueEntryId: entryId };
  }

  return { status: entry.status === 'CANCELLED' ? 'cancelled' : 'expired' };
}

export async function leaveQueue(entryId: string, userId: string) {
  await prisma.matchQueueEntry.updateMany({
    where: { id: entryId, userId, status: 'WAITING' },
    data: { status: 'CANCELLED' },
  });
}

/** Registra un skip para no reemparejar a las mismas dos personas enseguida. */
export async function registerSkip(userId: string, partnerId: string) {
  const expiresAt = new Date(
    Date.now() + config.matchmaking.skipCooldownMinutes * 60 * 1000,
  );
  await prisma.blockedPair.upsert({
    where: { blockerId_blockedId: { blockerId: userId, blockedId: partnerId } },
    create: { blockerId: userId, blockedId: partnerId, isSkip: true, expiresAt },
    update: { expiresAt },
  });
}

/** Metricas en vivo para la home y el panel admin. */
export async function getQueueStats() {
  const cutoff = new Date(Date.now() - QUEUE_TTL_MS);
  const [waitingRandom, waitingVip, activeCalls, onlineModels, vipModels] =
    await Promise.all([
      prisma.matchQueueEntry.count({
        where: { mode: 'RANDOM', status: 'WAITING', heartbeatAt: { gte: cutoff } },
      }),
      prisma.matchQueueEntry.count({
        where: { mode: 'VIP', status: 'WAITING', heartbeatAt: { gte: cutoff } },
      }),
      prisma.callSession.count({ where: { status: 'ACTIVE' } }),
      prisma.modelProfile.count({ where: { isOnline: true } }),
      prisma.modelProfile.count({
        where: { isOnline: true, isVipEnabled: true, isAvailableForVip: true },
      }),
    ]);

  return { waitingRandom, waitingVip, activeCalls, onlineModels, vipModels };
}
