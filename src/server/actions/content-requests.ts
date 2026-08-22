'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import { InsufficientTokensError, transferWithCommission } from '@/lib/tokens';

export interface ContentRequestActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  requestId?: string;
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

    const model = await prisma.modelProfile.findUnique({
      where: { id: parsed.data.modelId },
      select: { userId: true, slug: true, acceptsBookings: true },
    });
    if (!model) return { ok: false, error: 'Modelo no encontrada.' };
    if (model.userId === user.id) {
      return { ok: false, error: 'No podes pedirte contenido a vos misma.' };
    }

    const request = await prisma.contentRequest.create({
      data: {
        userId: user.id,
        modelId: parsed.data.modelId,
        description: parsed.data.description,
      },
      select: { id: true },
    });

    await createNotification(prisma, {
      userId: model.userId,
      type: 'CONTENT_REQUEST_RECEIVED',
      title: `${user.name ?? 'Alguien'} te pidio contenido a medida`,
      link: '/dashboard/model/requests',
    });

    revalidatePath(`/models/${model.slug}`);
    revalidatePath('/dashboard/requests');
    revalidatePath('/dashboard/model/requests');
    return {
      ok: true,
      requestId: request.id,
      message: 'Pedido enviado. Te avisamos cuando la modelo lo cotice.',
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
      title: `Tu pedido fue cotizado en ${input.quotedTokens} tokens`,
      link: '/dashboard/requests',
    });

    revalidatePath('/dashboard/model/requests');
    revalidatePath('/dashboard/requests');
    return { ok: true, message: 'Cotizacion enviada.' };
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

    revalidatePath('/dashboard/model/requests');
    revalidatePath('/dashboard/requests');
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

    revalidatePath('/dashboard/requests');
    revalidatePath('/dashboard/model/requests');
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
      include: { model: { select: { userId: true } } },
    });
    if (!request) return { ok: false, error: 'Pedido no encontrado.' };
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
    });

    revalidatePath('/dashboard/requests');
    revalidatePath('/dashboard/model/requests');
    revalidatePath('/wallet');
    return {
      ok: true,
      message: `Pagaste ${request.quotedTokens} tokens. La modelo ya puede entregar tu pedido.`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * La modelo entrega el pedido enlazando un ContentPackage ya creado (sin
 * publicar) y le da acceso gratuito solo a quien lo pidio y pago.
 */
export async function deliverContentRequestAction(input: {
  requestId: string;
  packageId: string;
}): Promise<ContentRequestActionResult> {
  try {
    const { profile } = await requireModelProfile();

    const request = await prisma.contentRequest.findFirst({
      where: { id: input.requestId, modelId: profile.id },
    });
    if (!request) return { ok: false, error: 'Pedido no encontrado.' };
    if (request.status !== 'PAID') {
      return { ok: false, error: 'Este pedido todavia no fue pagado.' };
    }

    const pkg = await prisma.contentPackage.findFirst({
      where: { id: input.packageId, modelId: profile.id },
      select: { id: true, assetCount: true, isPublished: true },
    });
    if (!pkg) return { ok: false, error: 'Paquete no encontrado.' };
    if (pkg.assetCount === 0) {
      return { ok: false, error: 'Sube al menos un archivo antes de entregar.' };
    }
    if (pkg.isPublished) {
      return {
        ok: false,
        error: 'Oculta el paquete antes de entregarlo: es privado, solo para quien lo pidio.',
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.contentRequest.update({
        where: { id: request.id },
        data: {
          status: 'DELIVERED',
          deliveredPackageId: pkg.id,
          deliveredAt: new Date(),
        },
      });
      await tx.contentUnlock.upsert({
        where: {
          userId_packageId: { userId: request.userId, packageId: pkg.id },
        },
        create: { userId: request.userId, packageId: pkg.id, tokensSpent: 0 },
        update: {},
      });
      await createNotification(tx, {
        userId: request.userId,
        type: 'CONTENT_REQUEST_DELIVERED',
        title: 'Tu pedido a medida ya esta listo',
        link: '/dashboard/requests',
      });
    });

    revalidatePath('/dashboard/model/requests');
    revalidatePath('/dashboard/requests');
    return { ok: true, message: 'Pedido entregado.' };
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
