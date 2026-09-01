'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import { checkNoContactInfo } from '@/lib/content-filter';
import { GEO_BLOCKED_MESSAGE, isBlockedForViewer } from '@/lib/geo';
import {
  buildMessageAttachmentKey,
  createUploadUrl,
} from '@/lib/storage';
import { InsufficientTokensError, transferWithCommission } from '@/lib/tokens';

export interface MessageActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  conversationId?: string;
}

export interface MessageActionResultWithData<T> extends MessageActionResult {
  data?: T;
}

const bodySchema = z.string().trim().min(1).max(1000);

/**
 * Abre la conversacion cobrando el precio de la modelo y envia el primer
 * mensaje. Si ya existe una conversacion (incluso de una modelo que despues
 * desactivo la mensajeria), solo agrega el mensaje sin volver a cobrar.
 */
export async function startConversationAction(input: {
  modelId: string;
  body: string;
}): Promise<MessageActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const body = bodySchema.safeParse(input.body);
    if (!body.success) return { ok: false, error: 'Escribi un mensaje.' };

    // Todo el contacto tiene que quedarse dentro de la plataforma.
    const contactError = checkNoContactInfo(body.data);
    if (contactError) return { ok: false, error: contactError };

    const model = await prisma.modelProfile.findUnique({
      where: { id: input.modelId },
      select: {
        userId: true,
        slug: true,
        messagingEnabled: true,
        messagePriceTokens: true,
        blockedCountries: true,
      },
    });
    if (!model) return { ok: false, error: 'Modelo no encontrada.' };
    if (model.userId === user.id) {
      return { ok: false, error: 'No podes enviarte mensajes a vos misma.' };
    }
    if (await isBlockedForViewer(model.blockedCountries)) {
      return { ok: false, error: GEO_BLOCKED_MESSAGE };
    }

    const existing = await prisma.conversation.findUnique({
      where: { userId_modelId: { userId: user.id, modelId: input.modelId } },
      select: { id: true },
    });
    if (existing) {
      return sendMessageAction({ conversationId: existing.id, body: body.data });
    }

    if (!model.messagingEnabled || model.messagePriceTokens <= 0) {
      return { ok: false, error: 'Esta modelo no tiene mensajeria activada.' };
    }

    const conversationId = await prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.create({
        data: {
          userId: user.id,
          modelId: input.modelId,
          unlockPriceTokens: model.messagePriceTokens,
        },
        select: { id: true },
      });

      await transferWithCommission(tx, {
        fromUserId: user.id,
        toUserId: model.userId,
        tokens: model.messagePriceTokens,
        debitType: 'MESSAGE_UNLOCK',
        creditType: 'MESSAGE_UNLOCK_EARNING',
        description: 'Desbloqueo de conversacion',
        conversationId: conversation.id,
      });

      await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderId: user.id,
          body: body.data,
        },
      });

      await createNotification(tx, {
        userId: model.userId,
        type: 'NEW_MESSAGE',
        title: `${user.name ?? 'Alguien'} te escribio un mensaje`,
        link: '/dashboard/model/messages',
      });

      return conversation.id;
    });

    revalidatePath(`/models/${model.slug}`);
    revalidatePath('/dashboard/messages');
    revalidatePath('/dashboard/model/messages');
    return {
      ok: true,
      conversationId,
      message: `Conversacion desbloqueada por ${model.messagePriceTokens} tokens.`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Envia un mensaje en una conversacion ya desbloqueada. El usuario que paga
 * necesita saldo positivo para seguir escribiendo; la modelo responde gratis.
 */
export async function sendMessageAction(input: {
  conversationId: string;
  body: string;
}): Promise<MessageActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const body = bodySchema.safeParse(input.body);
    if (!body.success) return { ok: false, error: 'Escribi un mensaje.' };

    const contactError = checkNoContactInfo(body.data);
    if (contactError) return { ok: false, error: contactError };

    const conversation = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      include: {
        model: { select: { userId: true, slug: true, blockedCountries: true } },
      },
    });
    if (!conversation) return { ok: false, error: 'Conversacion no encontrada.' };

    const isCustomer = conversation.userId === user.id;
    const isModel = conversation.model.userId === user.id;
    if (!isCustomer && !isModel) {
      return { ok: false, error: 'No tenes acceso a esta conversacion.' };
    }

    // El bloqueo por pais tambien corta las conversaciones ya abiertas: si la
    // modelo bloquea el pais despues, el cliente deja de poder escribirle.
    // Solo aplica al cliente; ella siempre puede responder.
    if (isCustomer && (await isBlockedForViewer(conversation.model.blockedCountries))) {
      return { ok: false, error: GEO_BLOCKED_MESSAGE };
    }

    if (isCustomer) {
      const wallet = await prisma.wallet.findUnique({
        where: { userId: user.id },
        select: { balance: true },
      });
      if ((wallet?.balance ?? 0) <= 0) {
        return {
          ok: false,
          error: 'Necesitas tokens en tu monedero para seguir esta conversacion.',
        };
      }
    }

    await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: user.id,
          body: body.data,
        },
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      }),
    ]);

    await createNotification(prisma, {
      userId: isCustomer ? conversation.model.userId : conversation.userId,
      type: 'NEW_MESSAGE',
      title: `${user.name ?? 'Alguien'} te escribio un mensaje`,
      link: isCustomer ? '/dashboard/model/messages' : '/dashboard/messages',
    });

    revalidatePath(`/dashboard/messages/${conversation.model.slug}`);
    revalidatePath(`/dashboard/model/messages/${conversation.id}`);
    return { ok: true, conversationId: conversation.id };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * URL firmada para que la modelo suba un archivo adjunto a una conversacion.
 * Solo la modelo de la conversacion puede adjuntar archivos.
 */
export async function requestMessageAttachmentUploadUrlAction(input: {
  conversationId: string;
  filename: string;
  contentType: string;
}): Promise<MessageActionResultWithData<{ uploadUrl: string; key: string }>> {
  try {
    const user = await getAuthedUserOrThrow();

    const conversation = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      include: { model: { select: { userId: true } } },
    });
    if (!conversation) return { ok: false, error: 'Conversacion no encontrada.' };
    if (conversation.model.userId !== user.id) {
      return { ok: false, error: 'Solo la modelo puede adjuntar archivos.' };
    }

    const key = buildMessageAttachmentKey({
      conversationId: conversation.id,
      filename: input.filename,
    });
    const uploadUrl = await createUploadUrl({
      key,
      contentType: input.contentType,
    });
    if (!uploadUrl) {
      return { ok: false, error: 'El almacenamiento no esta configurado.' };
    }

    return { ok: true, data: { uploadUrl, key } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Envia un mensaje con un archivo adjunto ya subido a S3/R2. Si priceTokens
 * es 0 queda visible de inmediato para quien reciba el mensaje; si no, hay
 * que desbloquearlo con unlockMessageAttachmentAction.
 */
export async function sendMessageAttachmentAction(input: {
  conversationId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes?: number;
  priceTokens: number;
  body?: string;
}): Promise<MessageActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    if (!Number.isInteger(input.priceTokens) || input.priceTokens < 0) {
      return { ok: false, error: 'El precio debe ser 0 o un numero de tokens positivo.' };
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      include: { model: { select: { userId: true, slug: true } } },
    });
    if (!conversation) return { ok: false, error: 'Conversacion no encontrada.' };
    if (conversation.model.userId !== user.id) {
      return { ok: false, error: 'Solo la modelo puede adjuntar archivos.' };
    }

    await prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderId: user.id,
          body: input.body?.trim() || null,
        },
        select: { id: true },
      });

      await tx.messageAttachment.create({
        data: {
          messageId: message.id,
          storageKey: input.storageKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes ?? null,
          priceTokens: input.priceTokens,
        },
      });

      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });

      await createNotification(tx, {
        userId: conversation.userId,
        type: 'NEW_MESSAGE',
        title:
          input.priceTokens > 0
            ? `${user.name ?? 'Alguien'} te envio un archivo de pago`
            : `${user.name ?? 'Alguien'} te envio un archivo`,
        link: `/dashboard/messages/${conversation.model.slug}`,
      });
    });

    revalidatePath(`/dashboard/messages/${conversation.model.slug}`);
    revalidatePath(`/dashboard/model/messages/${conversation.id}`);
    return { ok: true, message: 'Archivo enviado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** El destinatario paga para ver un archivo adjunto bloqueado. */
export async function unlockMessageAttachmentAction(
  attachmentId: string,
): Promise<MessageActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const attachment = await prisma.messageAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        message: {
          include: {
            conversation: {
              include: {
                model: {
                  select: { userId: true, slug: true, blockedCountries: true },
                },
              },
            },
          },
        },
      },
    });
    if (!attachment) return { ok: false, error: 'Archivo no encontrado.' };

    const conversation = attachment.message.conversation;
    if (conversation.userId !== user.id) {
      return { ok: false, error: 'No tenes acceso a este archivo.' };
    }
    if (await isBlockedForViewer(conversation.model.blockedCountries)) {
      return { ok: false, error: GEO_BLOCKED_MESSAGE };
    }
    if (attachment.priceTokens <= 0) {
      return { ok: true, message: 'Este archivo ya es de acceso libre.' };
    }

    const already = await prisma.messageAttachmentUnlock.findUnique({
      where: { userId_attachmentId: { userId: user.id, attachmentId } },
      select: { id: true },
    });
    if (already) return { ok: true, message: 'Ya desbloqueaste este archivo.' };

    await prisma.$transaction(async (tx) => {
      await transferWithCommission(tx, {
        fromUserId: user.id,
        toUserId: conversation.model.userId,
        tokens: attachment.priceTokens,
        debitType: 'MESSAGE_ATTACHMENT_UNLOCK',
        creditType: 'MESSAGE_ATTACHMENT_EARNING',
        description: 'Desbloqueo de archivo adjunto',
        conversationId: conversation.id,
        messageAttachmentId: attachment.id,
      });

      await tx.messageAttachmentUnlock.create({
        data: {
          userId: user.id,
          attachmentId: attachment.id,
          tokensSpent: attachment.priceTokens,
        },
      });

      await createNotification(tx, {
        userId: conversation.model.userId,
        type: 'MESSAGE_ATTACHMENT_UNLOCKED',
        title: `${user.name ?? 'Alguien'} desbloqueo tu archivo por ${attachment.priceTokens} tokens`,
        link: '/dashboard/model/messages',
      });
    });

    revalidatePath(`/dashboard/messages/${conversation.model.slug}`);
    return { ok: true, message: 'Archivo desbloqueado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof InsufficientTokensError) return error.message;
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    return error.message;
  }
  return 'No se pudo enviar. Intenta de nuevo.';
}
