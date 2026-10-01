import 'server-only';

import type { LiveAccessMode } from '@prisma/client';

import { sendRoomData } from '@/lib/livekit';
import {
  parseTipMenu,
  parseWidgetLayout,
  type LivePaywall,
  type LivePollState,
  type LiveRoomState,
} from '@/lib/live-state';
import { prisma } from '@/lib/prisma';
import { getActiveSubscription } from '@/lib/subscriptions';

/** Estado completo de un directo, tal como lo recibe quien entra. */
export async function loadLiveRoomState(streamId: string): Promise<LiveRoomState | null> {
  const stream = await prisma.liveStream.findUnique({
    where: { id: streamId },
    select: {
      title: true,
      pinnedMessage: true,
      pausedAt: true,
      mirrored: true,
      accessMode: true,
      ticketTokens: true,
      ticketFreeForSubscribers: true,
      widgetLayout: true,
      tipMenuOnScreen: true,
      acceptsPrivate: true,
      model: { select: { liveBlockedWords: true, liveTipMenu: true } },
    },
  });
  if (!stream) return null;
  return {
    title: stream.title,
    pinned: stream.pinnedMessage,
    paused: stream.pausedAt != null,
    mirrored: stream.mirrored,
    access: {
      mode: stream.accessMode,
      ticketTokens: stream.ticketTokens,
      freeForSubscribers: stream.ticketFreeForSubscribers,
    },
    blockedWords: stream.model.liveBlockedWords,
    tipMenu: parseTipMenu(stream.model.liveTipMenu),
    tipMenuOnScreen: stream.tipMenuOnScreen,
    layout: parseWidgetLayout(stream.widgetLayout),
    acceptsPrivate: stream.acceptsPrivate,
  };
}

/** Anuncia a la sala un cambio de estado (solo los campos que cambian). */
export async function broadcastLiveState(roomName: string, patch: Partial<LiveRoomState>) {
  await sendRoomData(roomName, { type: 'state', patch });
}

/** Encuesta con su recuento. */
export async function loadPollState(pollId: string): Promise<LivePollState | null> {
  const poll = await prisma.livePoll.findUnique({
    where: { id: pollId },
    select: { id: true, question: true, options: true, closedAt: true },
  });
  if (!poll) return null;
  const grouped = await prisma.livePollVote.groupBy({
    by: ['option'],
    where: { pollId },
    _count: { _all: true },
  });
  const counts = poll.options.map((_, i) => grouped.find((g) => g.option === i)?._count._all ?? 0);
  return {
    id: poll.id,
    question: poll.question,
    options: poll.options,
    counts,
    total: counts.reduce((a, b) => a + b, 0),
    closed: poll.closedAt != null,
  };
}

/** La encuesta abierta del directo (o la ultima cerrada, para ver resultados). */
export async function loadCurrentPoll(streamId: string, viewerId?: string) {
  const poll = await prisma.livePoll.findFirst({
    where: { streamId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!poll) return { poll: null, myVote: null };
  const [state, vote] = await Promise.all([
    loadPollState(poll.id),
    viewerId
      ? prisma.livePollVote.findUnique({
          where: { pollId_userId: { pollId: poll.id, userId: viewerId } },
          select: { option: true },
        })
      : null,
  ]);
  return { poll: state, myVote: vote?.option ?? null };
}

/**
 * ¿Puede esta persona ver el directo? La creadora y el equipo siempre; en un
 * directo de suscriptores, sus suscriptores activos; en uno de pago, quien
 * tenga entrada (y sus suscriptores si ella lo ha dejado asi).
 */
export async function viewerLiveAccess(
  stream: {
    id: string;
    modelId: string;
    accessMode: LiveAccessMode;
    ticketTokens: number | null;
    ticketFreeForSubscribers: boolean;
    model: { userId: string; slug: string };
  },
  viewer: { id: string; role: string },
): Promise<{ allowed: true } | { allowed: false; paywall: LivePaywall }> {
  if (stream.accessMode === 'PUBLIC') return { allowed: true };
  if (viewer.id === stream.model.userId || viewer.role === 'ADMIN') return { allowed: true };

  const paywall: LivePaywall = {
    mode: stream.accessMode,
    ticketTokens: stream.ticketTokens,
    freeForSubscribers: stream.ticketFreeForSubscribers,
    modelSlug: stream.model.slug,
  };
  const subscribed = Boolean(await getActiveSubscription(viewer.id, stream.modelId));

  if (stream.accessMode === 'SUBSCRIBERS') {
    return subscribed ? { allowed: true } : { allowed: false, paywall };
  }
  // PAID
  if (subscribed && stream.ticketFreeForSubscribers) return { allowed: true };
  const ticket = await prisma.liveTicket.findUnique({
    where: { streamId_userId: { streamId: stream.id, userId: viewer.id } },
    select: { id: true },
  });
  return ticket ? { allowed: true } : { allowed: false, paywall };
}

export const STREAM_ACCESS_SELECT = {
  id: true,
  modelId: true,
  accessMode: true,
  ticketTokens: true,
  ticketFreeForSubscribers: true,
  model: { select: { userId: true, slug: true } },
} as const;
