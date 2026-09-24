'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { MAX_CHATTER_PERCENT, MAX_TEAM_SIZE } from '@/lib/chat-team';
import { config } from '@/lib/config';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import {
  applyLedgerEntry,
  splitPayoutFee,
  tokensToPayoutCents,
  withdrawableTokens,
} from '@/lib/tokens';
import { formatMoney } from '@/lib/utils';

export interface TeamActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const percentSchema = z.number().int().min(0).max(MAX_CHATTER_PERCENT);

async function handleOf(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  return u?.username ? `@${u.username}` : 'Alguien';
}

async function requireCreator() {
  const user = await getAuthedUserOrThrow();
  const profile = await prisma.modelProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, stageName: true },
  });
  if (!profile) throw new Error('Solo para creadoras.');
  return { user, profile };
}

/** Un miembro del equipo de ESTA creadora. */
async function ownMember(modelId: string, id: string) {
  const member = await prisma.chatAssistant.findUnique({
    where: { id },
    select: { id: true, modelId: true, userId: true, status: true, percent: true },
  });
  if (!member || member.modelId !== modelId) throw new Error('No esta en tu equipo.');
  return member;
}

function revalidateTeam() {
  revalidatePath('/dashboard/model/equipo');
  revalidatePath('/equipo');
  revalidatePath('/mensajes');
}

// ---------------------------------------------------------------------------
// CREADORA
// ---------------------------------------------------------------------------

/** Invita a una cuenta (por su @usuario) a llevar sus mensajes. */
export async function inviteChatterAction(input: {
  username: string;
  percent: number;
}): Promise<TeamActionResult> {
  try {
    const { user, profile } = await requireCreator();
    const percent = percentSchema.safeParse(input.percent);
    if (!percent.success) {
      return { ok: false, error: `El % tiene que ser de 0 a ${MAX_CHATTER_PERCENT}.` };
    }
    const username = input.username.trim().replace(/^@/, '').toLowerCase();
    const target = await prisma.user.findUnique({
      where: { username },
      select: { id: true, status: true, role: true },
    });
    if (!target || target.status !== 'ACTIVE' || target.role === 'ADMIN') {
      return { ok: false, error: 'No encontramos esa cuenta.' };
    }
    if (target.id === user.id) return { ok: false, error: 'No puedes invitarte a ti.' };

    const size = await prisma.chatAssistant.count({
      where: { modelId: profile.id, status: { in: ['INVITED', 'ACTIVE'] } },
    });
    const existing = await prisma.chatAssistant.findUnique({
      where: { modelId_userId: { modelId: profile.id, userId: target.id } },
      select: { id: true, status: true },
    });
    if (existing && existing.status !== 'REMOVED') {
      return { ok: false, error: 'Ya esta en tu equipo o tiene la invitacion pendiente.' };
    }
    if (size >= MAX_TEAM_SIZE) {
      return { ok: false, error: `Maximo ${MAX_TEAM_SIZE} personas en tu equipo.` };
    }

    await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.chatAssistant.update({
          where: { id: existing.id },
          data: { status: 'INVITED', percent: percent.data, acceptedAt: null, endedAt: null },
        });
      } else {
        await tx.chatAssistant.create({
          data: { modelId: profile.id, userId: target.id, percent: percent.data },
        });
      }
      await createNotification(tx, {
        userId: target.id,
        type: 'TEAM_INVITE',
        title: `${profile.stageName} te invita a llevar sus mensajes`,
        body: `Cobrarias el ${percent.data}% de lo que vendas en sus chats.`,
        link: '/equipo',
      });
    });

    revalidateTeam();
    return { ok: true, message: `Invitacion enviada a @${username}.` };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Cambia el % de un chatter. Vale para las ventas nuevas. */
export async function updateChatterPercentAction(input: {
  id: string;
  percent: number;
}): Promise<TeamActionResult> {
  try {
    const { profile } = await requireCreator();
    const member = await ownMember(profile.id, input.id);
    const percent = percentSchema.safeParse(input.percent);
    if (!percent.success) {
      return { ok: false, error: `El % tiene que ser de 0 a ${MAX_CHATTER_PERCENT}.` };
    }
    if (member.status === 'REMOVED') return { ok: false, error: 'Ya no esta en tu equipo.' };

    await prisma.chatAssistant.update({ where: { id: member.id }, data: { percent: percent.data } });
    await createNotification(prisma, {
      userId: member.userId,
      type: 'TEAM_INVITE',
      title: `${profile.stageName} cambio tu comision al ${percent.data}%`,
      body: 'Se aplica a las ventas nuevas.',
      link: '/equipo',
    });
    revalidateTeam();
    return { ok: true, message: 'Comision actualizada.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Quita a alguien del equipo: deja de ver la bandeja al momento. */
export async function removeChatterAction(id: string): Promise<TeamActionResult> {
  try {
    const { profile } = await requireCreator();
    const member = await ownMember(profile.id, id);
    if (member.status === 'REMOVED') return { ok: true };
    await prisma.chatAssistant.update({
      where: { id: member.id },
      data: { status: 'REMOVED', endedAt: new Date() },
    });
    await createNotification(prisma, {
      userId: member.userId,
      type: 'TEAM_INVITE',
      title: `${profile.stageName} te ha quitado de su equipo`,
      body: 'Lo que ya ganaste sigue siendo tuyo.',
      link: '/equipo',
    });
    revalidateTeam();
    return { ok: true, message: 'Quitado del equipo.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// CHATTER
// ---------------------------------------------------------------------------

/** Aceptar o rechazar una invitacion. */
export async function respondTeamInviteAction(input: {
  id: string;
  accept: boolean;
}): Promise<TeamActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const member = await prisma.chatAssistant.findUnique({
      where: { id: input.id },
      select: { id: true, userId: true, status: true, model: { select: { userId: true } } },
    });
    if (!member || member.userId !== user.id || member.status !== 'INVITED') {
      return { ok: false, error: 'Esta invitacion ya no esta disponible.' };
    }
    await prisma.chatAssistant.update({
      where: { id: member.id },
      data: input.accept
        ? { status: 'ACTIVE', acceptedAt: new Date() }
        : { status: 'REMOVED', endedAt: new Date() },
    });
    await createNotification(prisma, {
      userId: member.model.userId,
      type: 'TEAM_INVITE',
      title: input.accept
        ? `${await handleOf(user.id)} acepto llevar tus mensajes`
        : `${await handleOf(user.id)} rechazo tu invitacion`,
      link: '/dashboard/model/equipo',
    });
    revalidateTeam();
    return { ok: true, message: input.accept ? 'Ya estas en su equipo.' : 'Invitacion rechazada.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** El chatter deja el equipo por su cuenta. */
export async function leaveTeamAction(id: string): Promise<TeamActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const member = await prisma.chatAssistant.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true, model: { select: { userId: true } } },
    });
    if (!member || member.userId !== user.id || member.status === 'REMOVED') {
      return { ok: false, error: 'No estas en ese equipo.' };
    }
    await prisma.chatAssistant.update({
      where: { id: member.id },
      data: { status: 'REMOVED', endedAt: new Date() },
    });
    await createNotification(prisma, {
      userId: member.model.userId,
      type: 'TEAM_INVITE',
      title: `${await handleOf(user.id)} ha dejado de llevar tus mensajes`,
      link: '/dashboard/model/equipo',
    });
    revalidateTeam();
    return { ok: true, message: 'Has salido del equipo.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// ADMIN: pagar a un chatter (igual que a los reclutadores)
// ---------------------------------------------------------------------------

/**
 * Anota que se le ha pagado TODO su saldo retirable (el pago se hace fuera),
 * menos la comision de retiro del 10%, igual que a creadoras y reclutadores.
 */
export async function payChatterAction(input: {
  userId: string;
  note?: string;
}): Promise<TeamActionResult> {
  try {
    const admin = await getAuthedUserOrThrow();
    if (admin.role !== 'ADMIN') throw new Error('FORBIDDEN');

    const wallet = await prisma.wallet.findUnique({ where: { userId: input.userId } });
    const tokens = wallet ? withdrawableTokens(wallet) : 0;
    if (tokens < config.economy.minPayoutTokens) {
      return {
        ok: false,
        error: `Aun no llega al minimo de pago (${formatMoney(tokensToPayoutCents(config.economy.minPayoutTokens))}).`,
      };
    }
    const { feeTokens, netTokens } = splitPayoutFee(tokens);
    const cents = tokensToPayoutCents(netTokens);

    await prisma.$transaction(async (tx) => {
      await applyLedgerEntry(tx, {
        userId: input.userId,
        type: 'PAYOUT',
        tokens,
        amountCents: cents,
        currency: 'USD',
        platformFeeTokens: feeTokens,
        description: `Pago a chatter (${formatMoney(cents)})${input.note ? `: ${input.note.slice(0, 200)}` : ''}`,
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: 'CHATTER_PAID',
          entityType: 'User',
          entityId: input.userId,
          metadata: { tokens, feeTokens, netTokens, cents, note: input.note ?? null },
        },
      });
    });

    revalidatePath('/admin/chatters');
    return { ok: true, message: `Pago de ${formatMoney(cents)} anotado.` };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    if (error.message === 'FORBIDDEN') return 'Solo para administradores.';
    return error.message;
  }
  return 'Error inesperado.';
}
