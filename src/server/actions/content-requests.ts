'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { createNotification } from '@/lib/notifications';
import { assertCreatorVerified } from '@/lib/creator-kyc';
import { dealChatHref, ensureDealConversation } from '@/lib/deal-chat';
import { prisma } from '@/lib/prisma';
import { checkNoContactInfo } from '@/lib/content-filter';
import { GEO_BLOCKED_MESSAGE, isBlockedForViewer } from '@/lib/geo';
import { InsufficientTokensError, transferWithCommission } from '@/lib/tokens';

export interface ContentRequestActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  requestId?: string;
  /** Chat con ese creador, donde vive el pedido. */
  conversationId?: string;
}

async function requireModelProfile() {
  const user = await getAuthedUserOrThrow();
  const profile = await prisma.modelProfile.findUnique({
    where: { userId: user.id },
  });
  if (!profile) throw new Error('MODEL_PROFILE_MISSING');
  return { user, profile };
}

const createSchema = z.object({
  modelId: z.string().min(1),
  description: z.string().min(10).max(600),
});

/** El usuario describe lo que quiere; queda esperando cotizacion. */
export async function createContentRequestAction(input: {
  modelId: string;
  description: string;
}): Promise<ContentRequestActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: 'Contanos con mas detalle que queres (min. 10 caracteres).' };
    }

    const contactError = checkNoContactInfo(parsed.data.description);
    if (contactError) return { ok: false, error: contactError };

    const model = await prisma.modelProfile.findUnique({
      where: { id: parsed.data.modelId },
      select: {
        userId: true,
        slug: true,
        acceptsBookings: true,
        blockedCountries: true,
      },
    });
    if (!model) return { ok: false, error: 'Modelo no encontrada.' };
    if (model.userId === user.id) {
      return { ok: false, error: 'No podes pedirte contenido a vos misma.' };
    }
    if (await isBlockedForViewer(model.blockedCountries)) {
      return { ok: false, error: GEO_BLOCKED_MESSAGE };
    }

    // El pedido vive en el chat con ese creador (se crea si no existia).
    const { request, conversationId } = await prisma.$transaction(async (tx) => {
      const request = await tx.contentRequest.create({
        data: {
          userId: user.id,
          modelId: parsed.data.modelId,
          description: parsed.data.description,
        },
        select: { id: true },
      });
      const conversationId = await ensureDealConversation(tx, user.id, parsed.data.modelId);
      await createNotification(tx, {
        userId: model.userId,
        type: 'CONTENT_REQUEST_RECEIVED',
        title: `${user.name ?? 'Alguien'} te pidio contenido a medida`,
        link: `/mensajes/${conversationId}`,
      });
      return { request, conversationId };
    });

    revalidatePath(`/models/${model.slug}`);
    revalidatePath('/mensajes');
    return {
      ok: true,
      requestId: request.id,
      conversationId,
      message: 'Pedido enviado. Te avisamos en el chat cuando le ponga precio.',
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** La modelo cotiza (o vuelve a cotizar) un pedido pendiente. */
export async function quoteContentRequestAction(input: {
  requestId: string;
  quotedTokens: number;
  note?: string;
}): Promise<ContentRequestActionResult> {
  try {
    const { profile } = await requireModelProfile();
    await assertCreatorVerified({ modelId: profile.id });

    if (!Number.isInteger(input.quotedTokens) || input.quotedTokens < 1) {
      return { ok: false, error: 'El precio debe ser un numero de tokens mayor a 0.' };
    }

    const request = await prisma.contentRequest.findFirst({
      where: { id: input.requestId, modelId: profile.id },
    });
    if (!request) return { ok: false, error: 'Pedido no encontrado.' };
    if (request.status !== 'PENDING' && request.status !== 'QUOTED') {
      return { ok: false, error: 'Este pedido ya no se puede cotizar.' };
    }

    await prisma.contentRequest.update({
      where: { id: request.id },
      data: {
        status: 'QUOTED',
        quotedTokens: input.quotedTokens,
        modelNote: input.note?.trim() || null,
        quotedAt: new Date(),
      },
    });

    await createNotification(prisma, {
      userId: request.userId,
      type: 'CONTENT_REQUEST_QUOTED',
      title: `Tu pedido ya tiene precio: ${input.quotedTokens} tokens`,
      link: await dealChatHref(request.userId, profile.id),
    });

    revalidatePath('/mensajes', 'layout');
    return { ok: true, message: 'Precio enviado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** La modelo rechaza un pedido que aun no fue pagado. */
export async function declineContentRequestAction(input: {
  requestId: string;
  note?: string;
}): Promise<ContentRequestActionResult> {
  try {
    const { profile } = await requireModelProfile();

    const request = await prisma.contentRequest.findFirst({
      where: { id: input.requestId, modelId: profile.id },
    });
    if (!request) return { ok: false, error: 'Pedido no encontrado.' };
    if (request.status !== 'PENDING' && request.status !== 'QUOTED') {
      return { ok: false, error: 'Este pedido ya no se puede rechazar.' };
    }

    await prisma.contentRequest.update({
      where: { id: request.id },
      data: { status: 'DECLINED', modelNote: input.note?.trim() || null },
    });
    await createNotification(prisma, {
      userId: request.userId,
      type: 'CONTENT_REQUEST_QUOTED',
      title: `${profile.stageName} no puede hacer tu pedido`,
      link: await dealChatHref(request.userId, profile.id),
    });

    revalidatePath('/mensajes', 'layout');
    return { ok: true, message: 'Pedido rechazado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** El usuario cancela su propio pedido antes de pagarlo. */
export async function cancelContentRequestAction(
  requestId: string,
): Promise<ContentRequestActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const request = await prisma.contentRequest.findFirst({
      where: { id: requestId, userId: user.id },
    });
    if (!request) return { ok: false, error: 'Pedido no encontrado.' };
    if (request.status !== 'PENDING' && request.status !== 'QUOTED') {
      return { ok: false, error: 'Este pedido ya no se puede cancelar.' };
    }

    await prisma.contentRequest.update({
      where: { id: request.id },
      data: { status: 'CANCELLED' },
    });

    revalidatePath('/mensajes', 'layout');
    return { ok: true, message: 'Pedido cancelado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** El usuario paga la cotizacion vigente. */
export async function payContentRequestAction(
  requestId: string,
): Promise<ContentRequestActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const request = await prisma.contentRequest.findFirst({
      where: { id: requestId, userId: user.id },
      include: {
        model: { select: { userId: true, blockedCountries: true } },
      },
    });
    if (!request) return { ok: false, error: 'Pedido no encontrado.' };
    if (await isBlockedForViewer(request.model.blockedCountries)) {
      return { ok: false, error: GEO_BLOCKED_MESSAGE };
    }
    if (request.status !== 'QUOTED' || !request.quotedTokens) {
      return { ok: false, error: 'Este pedido no tiene una cotizacion pendiente de pago.' };
    }

    await prisma.$transaction(async (tx) => {
      await transferWithCommission(tx, {
        fromUserId: user.id,
        toUserId: request.model.userId,
        tokens: request.quotedTokens as number,
        debitType: 'CONTENT_REQUEST_PAYMENT',
        creditType: 'CONTENT_REQUEST_EARNING',
        description: 'Pedido de contenido a medida',
        contentRequestId: request.id,
      });

      await tx.contentRequest.update({
        where: { id: request.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
      await createNotification(tx, {
        userId: request.model.userId,
        type: 'CONTENT_REQUEST_RECEIVED',
        title: `${user.name ?? 'Un fan'} pago su pedido: ya puedes entregarlo`,
        link: await dealChatHref(user.id, request.modelId),
      });
    });

    revalidatePath('/mensajes', 'layout');
    revalidatePath('/wallet');
    return {
      ok: true,
      message: `Pagaste ${request.quotedTokens} tokens. Te lo entregara en este chat.`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof InsufficientTokensError) return error.message;
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    if (error.message === 'MODEL_PROFILE_MISSING') return 'No tienes perfil de modelo.';
    return error.message;
  }
  return 'No se pudo actualizar. Intenta de nuevo.';
}
