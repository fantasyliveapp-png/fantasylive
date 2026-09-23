'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { checkCanStartChat, isBlockedBetween, peerPair } from '@/lib/chat';
import { checkNoContactInfo } from '@/lib/content-filter';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import { sendMessageAction, startConversationAction } from '@/server/actions/messages';

/**
 * MENSAJES ENTRE TODOS
 *
 * Punto de entrada unico para "Enviar mensaje" desde cualquier perfil. Decide
 * el tipo de chat segun quien escribe y a quien:
 *  - fan -> creadora: el chat de siempre, con el precio que ella ponga.
 *  - creadora -> fan: el mismo chat, gratis; solicitud si el fan no la sigue.
 *  - resto (fan-fan, creadora-creadora): PeerChat gratis; solicitud si no se
 *    siguen.
 */

export interface ChatActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  /** Donde queda el hilo, para abrirlo. */
  href?: string;
}

const bodySchema = z.string().trim().min(1, 'Escribe un mensaje.').max(1000);

function validateBody(raw: string): { ok: true; body: string } | { ok: false; error: string } {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Escribe un mensaje.' };
  // Todo el contacto se queda dentro de la plataforma.
  const contactError = checkNoContactInfo(parsed.data);
  if (contactError) return { ok: false, error: contactError };
  return { ok: true, body: parsed.data };
}

export async function messageUserAction(input: {
  targetUserId: string;
  body: string;
}): Promise<ChatActionResult> {
  try {
    const me = await getAuthedUserOrThrow();
    const valid = validateBody(input.body);
    if (!valid.ok) return valid;

    if (input.targetUserId === me.id) return { ok: false, error: 'No puedes escribirte a ti.' };

    const [sender, target] = await Promise.all([
      prisma.user.findUnique({
        where: { id: me.id },
        select: { name: true, modelProfile: { select: { id: true, stageName: true } } },
      }),
      prisma.user.findUnique({
        where: { id: input.targetUserId },
        select: {
          id: true,
          status: true,
          messagePrivacy: true,
          modelProfile: { select: { id: true, slug: true } },
        },
      }),
    ]);
    if (!target || target.status !== 'ACTIVE') {
      return { ok: false, error: 'Esta cuenta no esta disponible.' };
    }
    if (await isBlockedBetween(me.id, target.id)) {
      return { ok: false, error: 'No puedes escribir a esta persona.' };
    }

    const senderName = sender?.modelProfile?.stageName ?? sender?.name ?? 'Alguien';

    // 1) Fan -> creadora: el chat de pago de siempre (precio de ella, puede ser 0).
    if (target.modelProfile && !sender?.modelProfile) {
      const result = await startConversationAction({
        modelId: target.modelProfile.id,
        body: valid.body,
      });
      return { ...result, href: `/dashboard/messages/${target.modelProfile.slug}` };
    }

    // 2) Creadora -> fan: mismo tipo de chat, gratis y abierto por ella.
    if (sender?.modelProfile && !target.modelProfile) {
      const existing = await prisma.conversation.findUnique({
        where: { userId_modelId: { userId: target.id, modelId: sender.modelProfile.id } },
        select: { id: true },
      });
      if (existing) {
        const result = await sendMessageAction({ conversationId: existing.id, body: valid.body });
        return { ...result, href: `/dashboard/model/messages/${existing.id}` };
      }

      const can = await checkCanStartChat(me.id, target);
      if (!can.ok) return can;

      const conversation = await prisma.$transaction(async (tx) => {
        const c = await tx.conversation.create({
          data: {
            userId: target.id,
            modelId: sender.modelProfile!.id,
            unlockPriceTokens: 0,
            startedByModel: true,
            acceptedAt: can.asRequest ? null : new Date(),
          },
          select: { id: true },
        });
        await tx.message.create({
          data: { conversationId: c.id, senderId: me.id, body: valid.body },
        });
        await createNotification(tx, {
          userId: target.id,
          type: 'NEW_MESSAGE',
          title: can.asRequest
            ? `${senderName} quiere enviarte un mensaje`
            : `${senderName} te escribio un mensaje`,
          link: '/mensajes',
        });
        return c;
      });

      revalidatePath('/mensajes');
      return {
        ok: true,
        href: `/dashboard/model/messages/${conversation.id}`,
        message: can.asRequest ? 'Enviado como solicitud: le llegara cuando la acepte.' : undefined,
      };
    }

    // 3) Resto: chat entre personas, gratis.
    const pair = peerPair(me.id, target.id);
    const existing = await prisma.peerChat.findUnique({
      where: { userAId_userBId: pair },
      select: { id: true },
    });
    if (existing) {
      const result = await sendPeerMessageAction({ chatId: existing.id, body: valid.body });
      return { ...result, href: `/mensajes/${existing.id}` };
    }

    const can = await checkCanStartChat(me.id, target);
    if (!can.ok) return can;

    const chat = await prisma.$transaction(async (tx) => {
      const c = await tx.peerChat.create({
        data: {
          ...pair,
          createdById: me.id,
          acceptedAt: can.asRequest ? null : new Date(),
        },
        select: { id: true },
      });
      await tx.peerMessage.create({ data: { chatId: c.id, senderId: me.id, body: valid.body } });
      await createNotification(tx, {
        userId: target.id,
        type: 'NEW_MESSAGE',
        title: can.asRequest
          ? `${senderName} quiere enviarte un mensaje`
          : `${senderName} te escribio un mensaje`,
        link: can.asRequest ? '/mensajes?tab=solicitudes' : `/mensajes/${c.id}`,
      });
      return c;
    });

    revalidatePath('/mensajes');
    return {
      ok: true,
      href: `/mensajes/${chat.id}`,
      message: can.asRequest ? 'Enviado como solicitud: le llegara cuando la acepte.' : undefined,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Escribir en un chat entre personas ya abierto. */
export async function sendPeerMessageAction(input: {
  chatId: string;
  body: string;
}): Promise<ChatActionResult> {
  try {
    const me = await getAuthedUserOrThrow();
    const valid = validateBody(input.body);
    if (!valid.ok) return valid;

    const chat = await prisma.peerChat.findUnique({
      where: { id: input.chatId },
      select: { id: true, userAId: true, userBId: true, createdById: true, acceptedAt: true },
    });
    if (!chat || (chat.userAId !== me.id && chat.userBId !== me.id)) {
      return { ok: false, error: 'Chat no encontrado.' };
    }
    const otherId = chat.userAId === me.id ? chat.userBId : chat.userAId;
    if (await isBlockedBetween(me.id, otherId)) {
      return { ok: false, error: 'No puedes escribir a esta persona.' };
    }

    // Solicitud pendiente: quien la envio no puede insistir; quien la recibe,
    // al responder, la acepta.
    const pending = chat.acceptedAt === null;
    if (pending && chat.createdById === me.id) {
      return { ok: false, error: 'Espera a que acepte tu solicitud de mensaje.' };
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.peerMessage.create({ data: { chatId: chat.id, senderId: me.id, body: valid.body } }),
      prisma.peerChat.update({
        where: { id: chat.id },
        data: { lastMessageAt: now, ...(pending ? { acceptedAt: now } : {}) },
      }),
    ]);

    await createNotification(prisma, {
      userId: otherId,
      type: 'NEW_MESSAGE',
      title: `${me.name ?? 'Alguien'} te escribio un mensaje`,
      link: `/mensajes/${chat.id}`,
    });

    revalidatePath(`/mensajes/${chat.id}`);
    revalidatePath('/mensajes');
    return { ok: true, href: `/mensajes/${chat.id}` };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Aceptar o eliminar una solicitud de mensaje recibida. Eliminar borra el chat
 * (solo es posible mientras sea solicitud: nunca hay pagos en ella).
 */
export async function respondToChatRequestAction(input: {
  kind: 'peer' | 'conversation';
  id: string;
  accept: boolean;
}): Promise<ChatActionResult> {
  try {
    const me = await getAuthedUserOrThrow();

    if (input.kind === 'peer') {
      const chat = await prisma.peerChat.findUnique({
        where: { id: input.id },
        select: { id: true, userAId: true, userBId: true, createdById: true, acceptedAt: true },
      });
      const isRecipient =
        chat &&
        chat.createdById !== me.id &&
        (chat.userAId === me.id || chat.userBId === me.id);
      if (!chat || !isRecipient || chat.acceptedAt) {
        return { ok: false, error: 'Solicitud no encontrada.' };
      }
      if (input.accept) {
        await prisma.peerChat.update({ where: { id: chat.id }, data: { acceptedAt: new Date() } });
      } else {
        await prisma.peerChat.delete({ where: { id: chat.id } });
      }
    } else {
      const c = await prisma.conversation.findUnique({
        where: { id: input.id },
        select: { id: true, userId: true, startedByModel: true, acceptedAt: true, unlockPriceTokens: true },
      });
      if (!c || c.userId !== me.id || !c.startedByModel || c.acceptedAt) {
        return { ok: false, error: 'Solicitud no encontrada.' };
      }
      if (input.accept) {
        await prisma.conversation.update({ where: { id: c.id }, data: { acceptedAt: new Date() } });
      } else if (c.unlockPriceTokens === 0) {
        await prisma.conversation.delete({ where: { id: c.id } });
      }
    }

    revalidatePath('/mensajes');
    return {
      ok: true,
      href: input.accept && input.kind === 'peer' ? `/mensajes/${input.id}` : '/mensajes',
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Quien puede escribirme: todos, las personas que sigo o nadie. */
export async function setMessagePrivacyAction(
  value: 'EVERYONE' | 'FOLLOWING' | 'NOBODY',
): Promise<ChatActionResult> {
  try {
    const me = await getAuthedUserOrThrow();
    if (!['EVERYONE', 'FOLLOWING', 'NOBODY'].includes(value)) {
      return { ok: false, error: 'Opcion no valida.' };
    }
    await prisma.user.update({ where: { id: me.id }, data: { messagePrivacy: value } });
    return { ok: true, message: 'Guardado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Bloquear o desbloquear a una persona: no podra escribirte ni tu a ella. */
export async function toggleBlockUserAction(
  targetUserId: string,
): Promise<ChatActionResult & { blocked?: boolean }> {
  try {
    const me = await getAuthedUserOrThrow();
    if (targetUserId === me.id) return { ok: false, error: 'No puedes bloquearte a ti.' };

    const existing = await prisma.blockedPair.findUnique({
      where: { blockerId_blockedId: { blockerId: me.id, blockedId: targetUserId } },
      select: { id: true, isSkip: true },
    });

    // Un "saltar" de las llamadas aleatorias se convierte en bloqueo real.
    if (existing && !existing.isSkip) {
      await prisma.blockedPair.delete({ where: { id: existing.id } });
      revalidatePath('/mensajes');
      return { ok: true, blocked: false, message: 'Desbloqueado.' };
    }
    if (existing) {
      await prisma.blockedPair.update({
        where: { id: existing.id },
        data: { isSkip: false, expiresAt: null },
      });
    } else {
      await prisma.blockedPair.create({ data: { blockerId: me.id, blockedId: targetUserId } });
    }
    revalidatePath('/mensajes');
    return { ok: true, blocked: true, message: 'Bloqueado. Ya no podra escribirte.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    if (error.message === 'ACCOUNT_BANNED') return 'Tu cuenta esta suspendida.';
    return error.message;
  }
  return 'Error inesperado.';
}
