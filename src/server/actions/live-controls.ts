'use server';

import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { checkNoContactInfo } from '@/lib/content-filter';
import { avatarOf } from '@/lib/live';
import {
  broadcastLiveState,
  loadPollState,
  STREAM_ACCESS_SELECT,
  viewerLiveAccess,
} from '@/lib/live-controls';
import {
  LIVE_LIMITS,
  normalizeWord,
  parseWidgetLayout,
  type LiveAccessModeValue,
  type WidgetLayout,
  type LivePaywall,
  parseTipMenu,
  type LiveExclusiveInfo,
  type LivePollState,
  type TipMenuItem,
} from '@/lib/live-state';
import { listRoomParticipants, removeParticipant, sendRoomData, setViewerCanChat } from '@/lib/livekit';
import { prisma } from '@/lib/prisma';
import { resolveAssetUrl } from '@/lib/storage';
import { transferWithCommission } from '@/lib/tokens';

/**
 * CONTROLES DEL DIRECTO (menu "Mas" de la creadora) y lo que hace el
 * espectador con ellos (votar, pagar la entrada).
 *
 * Todo cambio se guarda en la base y se anuncia a la sala desde el servidor:
 * un espectador no puede fingir una encuesta, un titulo o una pausa.
 */

export interface ControlResult<T = unknown> {
  ok: boolean;
  error?: string;
  message?: string;
  data?: T;
}

/** El directo en curso de la creadora que llama (o error). */
async function requireOwnStream(streamId: string) {
  const user = await getAuthedUserOrThrow();
  const stream = await prisma.liveStream.findFirst({
    where: { id: streamId, model: { userId: user.id }, status: { in: ['PREPARING', 'LIVE'] } },
    select: { id: true, roomName: true, modelId: true, model: { select: { userId: true, slug: true } } },
  });
  if (!stream) throw new Error('Directo no encontrado.');
  return { user, stream };
}

function cleanText(text: string | null | undefined, max: number) {
  const value = (text ?? '').trim().slice(0, max);
  if (!value) return null;
  const contactError = checkNoContactInfo(value);
  if (contactError) throw new Error(contactError);
  return value;
}

// ---------------------------------------------------------------------------
// Titulo, mensaje fijado, pausa y espejo
// ---------------------------------------------------------------------------

export async function setStreamTitleAction(streamId: string, title: string): Promise<ControlResult> {
  return run(async () => {
    const { stream } = await requireOwnStream(streamId);
    const value = cleanText(title, LIVE_LIMITS.titleMax);
    await prisma.liveStream.update({ where: { id: stream.id }, data: { title: value } });
    await broadcastLiveState(stream.roomName, { title: value });
    return { message: 'Titulo actualizado.' };
  });
}

export async function setPinnedMessageAction(streamId: string, text: string | null): Promise<ControlResult> {
  return run(async () => {
    const { stream } = await requireOwnStream(streamId);
    const value = cleanText(text, LIVE_LIMITS.pinnedMax);
    await prisma.liveStream.update({ where: { id: stream.id }, data: { pinnedMessage: value } });
    await broadcastLiveState(stream.roomName, { pinned: value });
    return { message: value ? 'Mensaje fijado.' : 'Mensaje quitado.' };
  });
}

export async function setStreamPausedAction(streamId: string, paused: boolean): Promise<ControlResult> {
  return run(async () => {
    const { stream } = await requireOwnStream(streamId);
    await prisma.liveStream.update({
      where: { id: stream.id },
      data: { pausedAt: paused ? new Date() : null },
    });
    await broadcastLiveState(stream.roomName, { paused });
    return {};
  });
}

export async function setStreamMirroredAction(streamId: string, mirrored: boolean): Promise<ControlResult> {
  return run(async () => {
    const { stream } = await requireOwnStream(streamId);
    await prisma.liveStream.update({ where: { id: stream.id }, data: { mirrored } });
    await broadcastLiveState(stream.roomName, { mirrored });
    return {};
  });
}

/** Poner o quitar el menu de propinas como panel sobre el directo. */
export async function setTipMenuOnScreenAction(streamId: string, on: boolean): Promise<ControlResult> {
  return run(async () => {
    const { stream } = await requireOwnStream(streamId);
    await prisma.liveStream.update({ where: { id: stream.id }, data: { tipMenuOnScreen: on } });
    await broadcastLiveState(stream.roomName, { tipMenuOnScreen: on });
    return { message: on ? 'Especiales en pantalla.' : 'Especiales ocultos.' };
  });
}

/** La creadora coloca (o devuelve a su sitio con null) los paneles. */
export async function setWidgetLayoutAction(streamId: string, layout: WidgetLayout | null): Promise<ControlResult<WidgetLayout>> {
  return run(async () => {
    const { stream } = await requireOwnStream(streamId);
    const clean = layout ? parseWidgetLayout(layout) : {};
    await prisma.liveStream.update({
      where: { id: stream.id },
      data: { widgetLayout: Object.keys(clean).length ? (clean as Prisma.InputJsonObject) : Prisma.DbNull },
    });
    await broadcastLiveState(stream.roomName, { layout: clean });
    return { data: clean };
  });
}

// ---------------------------------------------------------------------------
// Encuestas
// ---------------------------------------------------------------------------

const pollSchema = z.object({
  question: z.string().trim().min(1, 'Escribe la pregunta.').max(LIVE_LIMITS.pollTextMax),
  options: z
    .array(z.string().trim().min(1).max(LIVE_LIMITS.pollTextMax))
    .min(LIVE_LIMITS.pollOptionsMin, 'Pon al menos 2 opciones.')
    .max(LIVE_LIMITS.pollOptionsMax),
});

export async function createLivePollAction(
  streamId: string,
  input: { question: string; options: string[] },
): Promise<ControlResult<LivePollState>> {
  return run(async () => {
    const { stream } = await requireOwnStream(streamId);
    const parsed = pollSchema.safeParse({ ...input, options: input.options.filter((o) => o.trim()) });
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Encuesta no valida.');
    for (const text of [parsed.data.question, ...parsed.data.options]) cleanText(text, LIVE_LIMITS.pollTextMax);

    // Una encuesta abierta a la vez: la anterior se cierra.
    await prisma.livePoll.updateMany({
      where: { streamId: stream.id, closedAt: null },
      data: { closedAt: new Date() },
    });
    const poll = await prisma.livePoll.create({
      data: { streamId: stream.id, question: parsed.data.question, options: parsed.data.options },
      select: { id: true },
    });
    const state = (await loadPollState(poll.id))!;
    await sendRoomData(stream.roomName, { type: 'poll', poll: state });
    return { data: state, message: 'Encuesta lanzada.' };
  });
}

export async function closeLivePollAction(streamId: string, pollId: string): Promise<ControlResult<LivePollState>> {
  return run(async () => {
    const { stream } = await requireOwnStream(streamId);
    await prisma.livePoll.updateMany({
      where: { id: pollId, streamId: stream.id, closedAt: null },
      data: { closedAt: new Date() },
    });
    const state = await loadPollState(pollId);
    if (state) await sendRoomData(stream.roomName, { type: 'poll', poll: state });
    return { data: state ?? undefined, message: 'Encuesta cerrada.' };
  });
}

/** Quitar la encuesta de la pantalla de todos. */
export async function hideLivePollAction(streamId: string): Promise<ControlResult> {
  return run(async () => {
    const { stream } = await requireOwnStream(streamId);
    await prisma.livePoll.updateMany({
      where: { streamId: stream.id, closedAt: null },
      data: { closedAt: new Date() },
    });
    await sendRoomData(stream.roomName, { type: 'poll', poll: null });
    return {};
  });
}

/** El espectador vota (una vez por encuesta). */
export async function voteLivePollAction(pollId: string, option: number): Promise<ControlResult<LivePollState>> {
  return run(async () => {
    const user = await getAuthedUserOrThrow();
    const poll = await prisma.livePoll.findUnique({
      where: { id: pollId },
      select: { id: true, options: true, closedAt: true, stream: { select: { roomName: true, status: true } } },
    });
    if (!poll || poll.stream.status === 'ENDED') throw new Error('Encuesta no encontrada.');
    if (poll.closedAt) throw new Error('La encuesta ya esta cerrada.');
    if (!Number.isInteger(option) || option < 0 || option >= poll.options.length) {
      throw new Error('Opcion no valida.');
    }
    try {
      await prisma.livePollVote.create({ data: { pollId, userId: user.id, option } });
    } catch {
      throw new Error('Ya has votado.');
    }
    const state = (await loadPollState(pollId))!;
    await sendRoomData(poll.stream.roomName, { type: 'poll', poll: state });
    return { data: state };
  });
}

// ---------------------------------------------------------------------------
// Regalos del directo y espectadores
// ---------------------------------------------------------------------------

export interface LiveGiftsData {
  gifts: { id: string; from: string; avatar: string | null; tokens: number; emoji: string | null; request: string | null; at: string }[];
  topFans: { userId: string; name: string; avatar: string | null; tokens: number }[];
  totalTokens: number;
}

export async function getLiveGiftsAction(streamId: string): Promise<ControlResult<LiveGiftsData>> {
  return run(async () => {
    const { stream } = await requireOwnStream(streamId);
    const [gifts, grouped, total] = await Promise.all([
      prisma.gift.findMany({
        where: { streamId: stream.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          tokens: true,
          emoji: true,
          message: true,
          createdAt: true,
          sender: { select: { name: true, username: true } },
        },
      }),
      prisma.gift.groupBy({
        by: ['senderId'],
        where: { streamId: stream.id },
        _sum: { tokens: true },
        orderBy: { _sum: { tokens: 'desc' } },
        take: 5,
      }),
      prisma.gift.aggregate({ where: { streamId: stream.id }, _sum: { tokens: true } }),
    ]);
    const fans = await prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.senderId) } },
      select: { id: true, name: true, username: true },
    });
    return {
      data: {
        gifts: gifts.map((g) => ({
          id: g.id,
          from: g.sender.name ?? g.sender.username ?? 'Fan',
          avatar: null,
          tokens: g.tokens,
          emoji: g.emoji,
          request: g.message,
          at: g.createdAt.toISOString(),
        })),
        topFans: await Promise.all(
          grouped.map(async (g) => {
            const fan = fans.find((f) => f.id === g.senderId);
            return {
              userId: g.senderId,
              name: fan?.name ?? fan?.username ?? 'Fan',
              avatar: await avatarOf(g.senderId),
              tokens: g._sum.tokens ?? 0,
            };
          }),
        ),
        totalTokens: total._sum.tokens ?? 0,
      },
    };
  });
}

export interface LiveViewerRow {
  userId: string;
  name: string;
  avatar: string | null;
  muted: boolean;
}

export async function getLiveViewersAction(streamId: string): Promise<ControlResult<LiveViewerRow[]>> {
  return run(async () => {
    const { stream, user } = await requireOwnStream(streamId);
    const [participants, mutes] = await Promise.all([
      listRoomParticipants(stream.roomName),
      prisma.liveSanction.findMany({ where: { streamId: stream.id, kind: 'MUTE' }, select: { userId: true } }),
    ]);
    const muted = new Set(mutes.map((m) => m.userId));
    return {
      data: participants
        .filter((p) => p.identity !== user.id && !p.identity.startsWith('model_'))
        .map((p) => {
          let avatar: string | null = null;
          try {
            avatar = (JSON.parse(p.metadata || '{}') as { avatar?: string | null }).avatar ?? null;
          } catch {
            // metadatos que no son nuestros
          }
          return { userId: p.identity, name: p.name || 'Invitado', avatar, muted: muted.has(p.identity) };
        }),
    };
  });
}

/** Silenciar, quitar el silencio o expulsar a un espectador. */
export async function sanctionViewerAction(
  streamId: string,
  userId: string,
  action: 'MUTE' | 'UNMUTE' | 'KICK',
): Promise<ControlResult> {
  return run(async () => {
    const { stream, user } = await requireOwnStream(streamId);
    if (userId === user.id) throw new Error('No puedes sancionarte a ti misma.');

    if (action === 'UNMUTE') {
      await prisma.liveSanction.deleteMany({ where: { streamId: stream.id, userId, kind: 'MUTE' } });
      await setViewerCanChat(stream.roomName, userId, true);
      await sendRoomData(stream.roomName, { type: 'sanction', kind: 'UNMUTE' }, [userId]);
      return { message: 'Puede volver a escribir.' };
    }

    await prisma.liveSanction.upsert({
      where: { streamId_userId_kind: { streamId: stream.id, userId, kind: action } },
      create: { streamId: stream.id, userId, kind: action },
      update: {},
    });
    if (action === 'MUTE') {
      await setViewerCanChat(stream.roomName, userId, false);
      await sendRoomData(stream.roomName, { type: 'sanction', kind: 'MUTE' }, [userId]);
      return { message: 'Silenciado en este directo.' };
    }
    await sendRoomData(stream.roomName, { type: 'sanction', kind: 'KICK' }, [userId]);
    await removeParticipant(stream.roomName, userId);
    return { message: 'Expulsado de este directo.' };
  });
}

// ---------------------------------------------------------------------------
// Filtro de palabras y menu de propinas (se guardan en su perfil: valen para
// todos sus directos)
// ---------------------------------------------------------------------------

async function activeRoomOf(userId: string) {
  const stream = await prisma.liveStream.findFirst({
    where: { model: { userId }, status: { in: ['PREPARING', 'LIVE'] } },
    select: { roomName: true },
  });
  return stream?.roomName ?? null;
}

export async function setLiveBlockedWordsAction(words: string[]): Promise<ControlResult<string[]>> {
  return run(async () => {
    const user = await getAuthedUserOrThrow();
    const clean = [...new Set(words.map(normalizeWord).filter((w) => w.length > 0 && w.length <= 40))].slice(
      0,
      LIVE_LIMITS.blockedWordsMax,
    );
    await prisma.modelProfile.update({ where: { userId: user.id }, data: { liveBlockedWords: clean } });
    const room = await activeRoomOf(user.id);
    if (room) await broadcastLiveState(room, { blockedWords: clean });
    return { data: clean, message: 'Filtro guardado.' };
  });
}

const tipItemSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(LIVE_LIMITS.tipLabelMax),
  tokens: z.number().int().min(1).max(100_000),
  postId: z.string().min(1).max(40).optional(),
});

export async function setLiveTipMenuAction(items: TipMenuItem[]): Promise<ControlResult<TipMenuItem[]>> {
  return run(async () => {
    const user = await getAuthedUserOrThrow();
    const parsed = z.array(tipItemSchema).max(LIVE_LIMITS.tipMenuMax).safeParse(items);
    if (!parsed.success) throw new Error('Revisa el menu: cada accion necesita un texto y un precio.');
    for (const item of parsed.data) cleanText(item.label, LIVE_LIMITS.tipLabelMax);

    // Contenido exclusivo: tiene que ser suyo y exclusivo de directo, y el
    // precio es SIEMPRE el de la publicacion (no el que mande el navegador).
    const postIds = parsed.data.map((i) => i.postId).filter((id): id is string => Boolean(id));
    const posts = postIds.length
      ? await prisma.post.findMany({
          where: { id: { in: postIds }, model: { userId: user.id }, liveExclusiveAt: { not: null }, removedAt: null },
          select: { id: true, priceTokens: true },
        })
      : [];
    const priceOf = new Map(posts.map((p) => [p.id, p.priceTokens]));
    const clean: TipMenuItem[] = parsed.data
      .filter((i) => !i.postId || priceOf.has(i.postId))
      .map((i) => (i.postId ? { ...i, tokens: priceOf.get(i.postId)! } : i));

    await prisma.modelProfile.update({ where: { userId: user.id }, data: { liveTipMenu: clean as unknown as Prisma.InputJsonArray } });
    const room = await activeRoomOf(user.id);
    if (room) await broadcastLiveState(room, { tipMenu: clean });
    return { data: clean, message: 'Menu guardado.' };
  });
}

// ---------------------------------------------------------------------------
// Acceso: publico, solo suscriptores o de pago
// ---------------------------------------------------------------------------

export async function setLiveAccessAction(
  streamId: string,
  input: { mode: LiveAccessModeValue; ticketTokens?: number | null; freeForSubscribers?: boolean },
): Promise<ControlResult<{ removed: number }>> {
  return run(async () => {
    const { stream } = await requireOwnStream(streamId);
    const mode = input.mode;
    let ticketTokens: number | null = null;
    if (mode === 'PAID') {
      ticketTokens = Number(input.ticketTokens);
      if (!Number.isInteger(ticketTokens) || ticketTokens < LIVE_LIMITS.ticketMin || ticketTokens > LIVE_LIMITS.ticketMax) {
        throw new Error(`La entrada debe costar entre ${LIVE_LIMITS.ticketMin} y ${LIVE_LIMITS.ticketMax} tokens.`);
      }
    }
    const freeForSubscribers = input.freeForSubscribers ?? true;
    const updated = await prisma.liveStream.update({
      where: { id: stream.id },
      data: { accessMode: mode, ticketTokens, ticketFreeForSubscribers: freeForSubscribers },
      select: STREAM_ACCESS_SELECT,
    });
    await broadcastLiveState(stream.roomName, {
      access: { mode, ticketTokens, freeForSubscribers },
    });

    // Quien ya estaba dentro y ahora no tiene acceso sale del directo (su
    // pantalla le ofrece suscribirse o pagar la entrada).
    let removed = 0;
    if (mode !== 'PUBLIC') {
      const participants = await listRoomParticipants(stream.roomName);
      const ids = participants.map((p) => p.identity).filter((id) => !id.startsWith('model_'));
      const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true } });
      for (const viewer of users) {
        const access = await viewerLiveAccess(updated, viewer);
        if (!access.allowed) {
          await sendRoomData(stream.roomName, { type: 'access_lost', paywall: access.paywall }, [viewer.id]);
          await removeParticipant(stream.roomName, viewer.id);
          removed += 1;
        }
      }
    }
    const label = mode === 'PUBLIC' ? 'Directo abierto a todos.' : mode === 'SUBSCRIBERS' ? 'Solo suscriptores.' : `Entrada: ${ticketTokens} tokens.`;
    return { data: { removed }, message: removed > 0 ? `${label} Han salido ${removed} sin acceso.` : label };
  });
}

/** El espectador compra la entrada de un directo de pago. */
export async function buyLiveTicketAction(streamId: string): Promise<ControlResult<{ balance: number }>> {
  return run(async () => {
    const user = await getAuthedUserOrThrow();
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { ...STREAM_ACCESS_SELECT, status: true, roomName: true },
    });
    if (!stream || stream.status === 'ENDED') throw new Error('Este directo ha terminado.');
    if (stream.accessMode !== 'PAID' || !stream.ticketTokens) throw new Error('Este directo no es de pago.');
    const access = await viewerLiveAccess(stream, user);
    if (access.allowed) return { data: { balance: -1 }, message: 'Ya tienes acceso.' };

    const tokens = stream.ticketTokens;
    const balance = await prisma.$transaction(async (tx) => {
      await tx.liveTicket.create({ data: { streamId: stream.id, userId: user.id, tokens } });
      const { debit, modelTokens } = await transferWithCommission(tx, {
        fromUserId: user.id,
        toUserId: stream.model.userId,
        tokens,
        debitType: 'TIP',
        creditType: 'TIP_EARNING',
        description: 'Entrada a directo de pago',
        liveStreamId: stream.id,
        metadata: { kind: 'live_ticket' },
      });
      await tx.liveStream.update({ where: { id: stream.id }, data: { tokensEarned: { increment: modelTokens } } });
      return debit.balanceAfter;
    });
    await sendRoomData(stream.roomName, {
      type: 'ticket',
      from: user.name ?? 'Alguien',
      avatar: await avatarOf(user.id),
      tokens,
    });
    return { data: { balance }, message: 'Entrada comprada. ¡Disfruta!' };
  });
}

/** ¿Sigo teniendo acceso? (el visor lo pregunta cuando cambia el modo). */
export async function checkLiveAccessAction(
  streamId: string,
): Promise<ControlResult<{ allowed: boolean; paywall: LivePaywall | null }>> {
  return run(async () => {
    const user = await getAuthedUserOrThrow();
    const stream = await prisma.liveStream.findUnique({ where: { id: streamId }, select: STREAM_ACCESS_SELECT });
    if (!stream) throw new Error('Directo no encontrado.');
    const access = await viewerLiveAccess(stream, user);
    return { data: { allowed: access.allowed, paywall: access.allowed ? null : access.paywall } };
  });
}

async function run<T>(fn: () => Promise<{ data?: T; message?: string }>): Promise<ControlResult<T>> {
  try {
    const r = await fn();
    return { ok: true, ...r };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'UNAUTHORIZED') return { ok: false, error: 'Debes iniciar sesion.' };
      if (error.name === 'InsufficientTokensError') return { ok: false, error: error.message };
      return { ok: false, error: error.message };
    }
    return { ok: false, error: 'Error inesperado.' };
  }
}

// ---------------------------------------------------------------------------
// Contenido exclusivo de directo (publicaciones con liveExclusiveAt)
// ---------------------------------------------------------------------------

const EXCLUSIVE_SELECT = {
  id: true,
  body: true,
  priceTokens: true,
  assets: {
    orderBy: { sortOrder: 'asc' as const },
    select: { mimeType: true, previewKey: true, durationSec: true },
  },
} as const;

async function toExclusiveInfo(
  post: {
    id: string;
    body: string | null;
    priceTokens: number;
    assets: { mimeType: string; previewKey: string | null; durationSec: number | null }[];
  },
  owned: boolean,
  label?: string,
): Promise<LiveExclusiveInfo> {
  const videos = post.assets.filter((a) => a.mimeType.startsWith('video/'));
  return {
    postId: post.id,
    label: label ?? exclusiveLabel(post.body),
    body: post.body,
    priceTokens: post.priceTokens,
    photos: post.assets.length - videos.length,
    videos: videos.length,
    videoSeconds: videos.reduce((s, v) => s + (v.durationSec ?? 0), 0),
    // Solo miniaturas difuminadas de 32 px: el original nunca sale de aqui.
    previews: await Promise.all(
      post.assets
        .filter((a) => a.previewKey)
        .slice(0, 4)
        .map((a) => resolveAssetUrl(a.previewKey!, { isPublic: true })),
    ).then((urls) => urls.filter((u): u is string => Boolean(u))),
    owned,
  };
}

function exclusiveLabel(body: string | null) {
  const first = body?.split('\n')[0]?.trim();
  return first ? first.slice(0, LIVE_LIMITS.tipLabelMax) : 'Contenido exclusivo';
}

/** La creadora: sus contenidos exclusivos de directo, para el menu. */
export async function getMyLiveExclusivesAction(): Promise<ControlResult<LiveExclusiveInfo[]>> {
  return run(async () => {
    const user = await getAuthedUserOrThrow();
    const posts = await prisma.post.findMany({
      where: { model: { userId: user.id }, liveExclusiveAt: { not: null }, removedAt: null },
      orderBy: { liveExclusiveAt: 'desc' },
      take: 50,
      select: EXCLUSIVE_SELECT,
    });
    return { data: await Promise.all(posts.map((p) => toExclusiveInfo(p, false))) };
  });
}

export interface LiveMenuExclusive {
  info: LiveExclusiveInfo;
  /** Si ya lo tiene: otro exclusivo suyo que aun no ha comprado. */
  suggestion: LiveExclusiveInfo | null;
}

/**
 * El fan: lo que contiene cada exclusivo del menu, si ya lo tiene y, en ese
 * caso, una sugerencia de otro que aun no ha comprado.
 */
export async function getLiveMenuExclusivesAction(
  streamId: string,
): Promise<ControlResult<Record<string, LiveMenuExclusive>>> {
  return run(async () => {
    const user = await getAuthedUserOrThrow();
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { modelId: true, model: { select: { liveTipMenu: true } } },
    });
    if (!stream) throw new Error('Directo no encontrado.');
    const menu = parseTipMenu(stream.model.liveTipMenu).filter((i) => i.postId);

    // Todos sus exclusivos (para las sugerencias) y cuales tiene ya este fan.
    const pool = await prisma.post.findMany({
      where: { modelId: stream.modelId, liveExclusiveAt: { not: null }, removedAt: null, assets: { some: {} } },
      orderBy: { liveExclusiveAt: 'desc' },
      take: 50,
      select: EXCLUSIVE_SELECT,
    });
    const owned = new Set(
      (
        await prisma.postUnlock.findMany({
          where: { userId: user.id, postId: { in: pool.map((p) => p.id) } },
          select: { postId: true },
        })
      ).map((u) => u.postId),
    );
    const inMenu = new Set(menu.map((i) => i.postId!));
    // Primero los que no estan en el menu (es lo que "tiene guardado").
    const candidates = [
      ...pool.filter((p) => !owned.has(p.id) && !inMenu.has(p.id)),
      ...pool.filter((p) => !owned.has(p.id) && inMenu.has(p.id)),
    ];
    const used = new Set<string>();

    const out: Record<string, LiveMenuExclusive> = {};
    for (const item of menu) {
      const post = pool.find((p) => p.id === item.postId);
      if (!post) continue;
      const isOwned = owned.has(post.id);
      let suggestion: LiveExclusiveInfo | null = null;
      if (isOwned) {
        const next = candidates.find((c) => !used.has(c.id));
        if (next) {
          used.add(next.id);
          suggestion = await toExclusiveInfo(next, false);
        }
      }
      out[item.id] = { info: await toExclusiveInfo(post, isOwned, item.label), suggestion };
    }
    return { data: out };
  });
}

/** El fan compra un exclusivo de directo (una sola vez para siempre). */
export async function buyLiveExclusiveAction(
  streamId: string,
  postId: string,
): Promise<ControlResult<{ balance: number | null }>> {
  return run<{ balance: number | null }>(async () => {
    const user = await getAuthedUserOrThrow();
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { id: true, status: true, roomName: true, modelId: true, model: { select: { userId: true } } },
    });
    if (!stream || stream.status === 'ENDED') throw new Error('Este directo ha terminado.');
    const post = await prisma.post.findFirst({
      where: { id: postId, modelId: stream.modelId, liveExclusiveAt: { not: null }, removedAt: null },
      select: { id: true, body: true, priceTokens: true },
    });
    if (!post) throw new Error('Este contenido ya no esta disponible.');
    if (stream.model.userId === user.id) throw new Error('Es tu propio contenido.');

    const already = await prisma.postUnlock.findUnique({
      where: { userId_postId: { userId: user.id, postId: post.id } },
      select: { id: true },
    });
    if (already) return { data: { balance: null }, message: 'Ya lo tenias: no se te ha cobrado.' };

    const balance = await prisma.$transaction(async (tx) => {
      // El unico de (usuario, publicacion) impide pagarlo dos veces aunque
      // lleguen dos toques a la vez.
      await tx.postUnlock.create({ data: { userId: user.id, postId: post.id, tokensSpent: post.priceTokens } });
      const { debit, modelTokens } = await transferWithCommission(tx, {
        fromUserId: user.id,
        toUserId: stream.model.userId,
        tokens: post.priceTokens,
        debitType: 'POST_UNLOCK',
        creditType: 'POST_EARNING',
        description: 'Contenido exclusivo de directo',
        postId: post.id,
        liveStreamId: stream.id,
        metadata: { kind: 'live_exclusive' },
      });
      await tx.post.update({
        where: { id: post.id },
        data: { unlockCount: { increment: 1 }, tokensEarned: { increment: modelTokens } },
      });
      await tx.liveStream.update({ where: { id: stream.id }, data: { tokensEarned: { increment: modelTokens } } });
      return debit.balanceAfter;
    });

    await sendRoomData(stream.roomName, {
      type: 'pack',
      from: user.name ?? 'Alguien',
      avatar: await avatarOf(user.id),
      tokens: post.priceTokens,
      label: exclusiveLabel(post.body),
    });
    return { data: { balance }, message: 'Desbloqueado. ¡Ya es tuyo para siempre!' };
  });
}

/** Las fotos y videos de un exclusivo que el fan ya ha comprado. */
export async function getLiveExclusiveMediaAction(
  postId: string,
): Promise<ControlResult<{ id: string; url: string | null; mimeType: string }[]>> {
  return run(async () => {
    const user = await getAuthedUserOrThrow();
    const post = await prisma.post.findFirst({
      where: { id: postId, liveExclusiveAt: { not: null } },
      select: {
        id: true,
        model: { select: { userId: true } },
        assets: { orderBy: { sortOrder: 'asc' }, select: { id: true, mimeType: true, storageKey: true } },
      },
    });
    if (!post) throw new Error('Contenido no encontrado.');
    const isOwner = post.model.userId === user.id;
    if (!isOwner) {
      const unlock = await prisma.postUnlock.findUnique({
        where: { userId_postId: { userId: user.id, postId: post.id } },
        select: { id: true },
      });
      if (!unlock) throw new Error('Aun no has comprado este contenido.');
    }
    // Fotos con su marca de agua personal; videos por URL firmada de corta vida.
    return {
      data: await Promise.all(
        post.assets.map(async (a) => ({
          id: a.id,
          mimeType: a.mimeType,
          url:
            a.mimeType.startsWith('image/') && !isOwner
              ? `/api/posts/${post.id}/media/${a.id}`
              : await resolveAssetUrl(a.storageKey, { isPublic: false }),
        })),
      ),
    };
  });
}
