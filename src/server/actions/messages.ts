'use server';

import { discountTokens } from '@/lib/creator-offer-rules';
import { getContentOffer, recordOfferUse } from '@/lib/creator-offers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { maybeReplyAsAi } from '@/lib/ai-responder';
import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import { checkNoContactInfo } from '@/lib/content-filter';
import { isBlockedBetween } from '@/lib/chat';
import {
  bundleLabel,
  createBundleMessage,
  deliverableRequest,
  makeBlurredPreview,
  markRequestDelivered,
  MAX_BUNDLE_FILES,
} from '@/lib/chat-bundles';
import { GEO_BLOCKED_MESSAGE, isBlockedForViewer } from '@/lib/geo';
import {
  buildMessageAttachmentKey,
  checkUpload,
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
    if (await isBlockedBetween(user.id, model.userId)) {
      return { ok: false, error: 'No puedes escribir a esta persona.' };
    }

    const existing = await prisma.conversation.findUnique({
      where: { userId_modelId: { userId: user.id, modelId: input.modelId } },
      select: { id: true },
    });
    if (existing) {
      return sendMessageAction({ conversationId: existing.id, body: body.data });
    }

    // Con la mensajeria activada ella decide el precio; 0 = gratis.
    if (!model.messagingEnabled) {
      return { ok: false, error: 'Este perfil no tiene los mensajes activados.' };
    }
    const price = Math.max(0, model.messagePriceTokens);

    const conversationId = await prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.create({
        data: {
          userId: user.id,
          modelId: input.modelId,
          unlockPriceTokens: price,
          // La abre (y paga) el fan: no es una solicitud.
          acceptedAt: new Date(),
        },
        select: { id: true },
      });

      if (price > 0) {
        await transferWithCommission(tx, {
          fromUserId: user.id,
          toUserId: model.userId,
          tokens: price,
          debitType: 'MESSAGE_UNLOCK',
          creditType: 'MESSAGE_UNLOCK_EARNING',
          description: 'Desbloqueo de conversacion',
          conversationId: conversation.id,
        });
      }

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
        link: `/mensajes/${conversation.id}`,
      });

      return conversation.id;
    });

    // Si el perfil lo atiende una IA, contesta antes de retornar: el hilo se
    // repinta con router.refresh() y asi aparecen los dos mensajes juntos.
    await maybeReplyAsAi(conversationId);

    revalidatePath(`/models/${model.slug}`);
    revalidatePath('/mensajes');
    return {
      ok: true,
      conversationId,
      message: price > 0 ? `Conversacion desbloqueada por ${price} tokens.` : undefined,
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
    if (await isBlockedBetween(conversation.userId, conversation.model.userId)) {
      return { ok: false, error: 'No puedes escribir a esta persona.' };
    }
    // Chat que existe solo por un pedido o una cita: hay que abrirlo antes.
    if (isCustomer && !conversation.chatUnlocked) {
      return {
        ok: false,
        conversationId: conversation.id,
        error: 'Abre el chat para escribirle: tienes el boton en la conversacion.',
      };
    }

    // Chat abierto por la creadora y aun sin aceptar: ella no puede insistir;
    // si el fan responde, la solicitud queda aceptada.
    const pendingRequest = conversation.startedByModel && conversation.acceptedAt === null;
    if (pendingRequest && isModel) {
      return { ok: false, error: 'Espera a que acepte tu solicitud de mensaje.' };
    }

    // En los chats gratis (precio 0 o abiertos por ella) no hace falta saldo.
    if (isCustomer && conversation.unlockPriceTokens > 0) {
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
        data: {
          lastMessageAt: new Date(),
          ...(pendingRequest && isCustomer ? { acceptedAt: new Date() } : {}),
        },
      }),
    ]);

    await createNotification(prisma, {
      userId: isCustomer ? conversation.model.userId : conversation.userId,
      type: 'NEW_MESSAGE',
      title: `${user.name ?? 'Alguien'} te escribio un mensaje`,
      // Directo al hilo, desde el lado de quien lo recibe.
      link: `/mensajes/${conversation.id}`,
    });

    // Solo contesta a lo que escribe el cliente. Si el que escribe es el dueno
    // del perfil, no hay nada que responder.
    if (isCustomer) await maybeReplyAsAi(conversation.id);

    revalidatePath(`/mensajes/${conversation.id}`);
    revalidatePath(`/mensajes/${conversation.id}`);
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
  sizeBytes: number;
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
    const invalid = checkUpload(input.contentType, input.sizeBytes, ['image', 'video']);
    if (invalid) return { ok: false, error: invalid };

    const key = buildMessageAttachmentKey({
      conversationId: conversation.id,
      filename: input.filename,
    });
    const uploadUrl = await createUploadUrl({
      key,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
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
 * Envia uno o varios archivos ya subidos a S3/R2 en UN envio con UN precio.
 * Si priceTokens es 0 se ven de inmediato; si no, el fan paga una vez con
 * unlockMessageAttachmentAction y los ve todos. Con `requestId` entrega un
 * pedido a medida ya pagado (va gratis).
 */
export async function sendMessageAttachmentAction(input: {
  conversationId: string;
  files: { storageKey: string; mimeType: string; sizeBytes?: number }[];
  priceTokens: number;
  body?: string;
  requestId?: string;
}): Promise<MessageActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    if (!Number.isInteger(input.priceTokens) || input.priceTokens < 0) {
      return { ok: false, error: 'El precio debe ser 0 o un numero de tokens positivo.' };
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      include: { model: { select: { id: true, userId: true, slug: true, stageName: true } } },
    });
    if (!conversation) return { ok: false, error: 'Conversacion no encontrada.' };
    if (conversation.model.userId !== user.id) {
      return { ok: false, error: 'Solo la modelo puede adjuntar archivos.' };
    }
    // Solo archivos subidos a ESTE chat (la clave lleva el id de la conversacion).
    const files = input.files
      .slice(0, MAX_BUNDLE_FILES)
      .filter(
        (f) => f.storageKey.startsWith(`messages/${conversation.id}/`) && /^(image|video)\//.test(f.mimeType),
      );
    if (files.length === 0) return { ok: false, error: 'Archivo no valido.' };
    const bodyText = input.body?.trim() || null;
    if (bodyText) {
      const contactError = checkNoContactInfo(bodyText);
      if (contactError) return { ok: false, error: contactError };
    }
    if (input.requestId) {
      await deliverableRequest(input.requestId, conversation.model.id, conversation.userId);
    }
    const price = input.requestId ? 0 : input.priceTokens;

    const previews = await Promise.all(
      files.map((f) => makeBlurredPreview(f.storageKey, f.mimeType, `messages/${conversation.id}`)),
    );

    await prisma.$transaction(async (tx) => {
      const message = await createBundleMessage(tx, {
        conversationId: conversation.id,
        senderId: user.id,
        body: bodyText,
        priceTokens: price,
        files: files.map((f, i) => ({ ...f, previewKey: previews[i] })),
      });
      if (input.requestId) await markRequestDelivered(tx, input.requestId, message.id);

      await createNotification(tx, {
        userId: conversation.userId,
        type: input.requestId ? 'CONTENT_REQUEST_DELIVERED' : 'NEW_MESSAGE',
        title: input.requestId
          ? `${conversation.model.stageName} te entrego tu pedido`
          : price > 0
            ? `${conversation.model.stageName} te envio ${bundleLabel(files)} especiales`
            : `${conversation.model.stageName} te envio ${bundleLabel(files)}`,
        link: `/mensajes/${conversation.id}`,
      });
    });

    revalidatePath(`/mensajes/${conversation.id}`);
    if (input.requestId) revalidatePath('/dashboard/requests');
    return {
      ok: true,
      message: input.requestId
        ? 'Pedido entregado por chat.'
        : files.length === 1
          ? 'Archivo enviado.'
          : `${files.length} archivos enviados en un solo envio.`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Un chat que existe solo por un pedido o una cita: el fan lo abre para
 * escribir pagando el precio de chat del creador (como un chat nuevo).
 */
export async function unlockDealChatAction(conversationId: string): Promise<MessageActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        userId: true,
        chatUnlocked: true,
        model: { select: { userId: true, messagingEnabled: true, messagePriceTokens: true, blockedCountries: true } },
      },
    });
    if (!conversation || conversation.userId !== user.id) return { ok: false, error: 'Conversacion no encontrada.' };
    if (conversation.chatUnlocked) return { ok: true, message: 'El chat ya esta abierto.' };
    if (await isBlockedForViewer(conversation.model.blockedCountries)) {
      return { ok: false, error: GEO_BLOCKED_MESSAGE };
    }
    if (!conversation.model.messagingEnabled) {
      return { ok: false, error: 'Este perfil no tiene los mensajes activados.' };
    }
    const price = Math.max(0, conversation.model.messagePriceTokens);

    await prisma.$transaction(async (tx) => {
      // Solo una vez aunque se pulse dos veces.
      const res = await tx.conversation.updateMany({
        where: { id: conversation.id, chatUnlocked: false },
        data: { chatUnlocked: true, unlockPriceTokens: price },
      });
      if (res.count === 0 || price === 0) return;
      await transferWithCommission(tx, {
        fromUserId: user.id,
        toUserId: conversation.model.userId,
        tokens: price,
        debitType: 'MESSAGE_UNLOCK',
        creditType: 'MESSAGE_UNLOCK_EARNING',
        description: 'Desbloqueo de conversacion',
        conversationId: conversation.id,
      });
    });

    revalidatePath(`/mensajes/${conversation.id}`);
    return { ok: true, message: price > 0 ? `Chat abierto por ${price} tokens.` : 'Chat abierto.' };
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
                  select: { id: true, userId: true, slug: true, blockedCountries: true },
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

    // Rebajas flash o cupon del creador: sale de su precio.
    const offer = await getContentOffer(conversation.model.id, user.id);
    const price = offer ? discountTokens(attachment.priceTokens, offer.percentOff) : attachment.priceTokens;

    await prisma.$transaction(async (tx) => {
      if (offer) await recordOfferUse(tx, offer, price);
      await transferWithCommission(tx, {
        fromUserId: user.id,
        toUserId: conversation.model.userId,
        tokens: price,
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
          tokensSpent: price,
        },
      });

      await createNotification(tx, {
        userId: conversation.model.userId,
        type: 'MESSAGE_ATTACHMENT_UNLOCKED',
        title: `${user.name ?? 'Alguien'} desbloqueo tu envio por ${price} tokens${offer ? ` (${offer.label} −${offer.percentOff}%)` : ''}`,
        link: '/mensajes',
      });
    });

    revalidatePath(`/mensajes/${conversation.id}`);
    return { ok: true, message: 'Desbloqueado. Ya es tuyo.' };
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
