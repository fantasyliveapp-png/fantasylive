'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import { checkNoContactInfo } from '@/lib/content-filter';

export interface ReviewActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const reviewSchema = z.object({
  modelId: z.string().min(1),
  slug: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(600).optional(),
});

/** Crea la resena del usuario o actualiza la que ya tenia para esta modelo. */
export async function upsertReviewAction(input: {
  modelId: string;
  slug: string;
  rating: number;
  comment?: string;
}): Promise<ReviewActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const parsed = reviewSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: 'Elegi una puntuacion de 1 a 5 estrellas.' };
    }

    if (parsed.data.comment) {
      const contactError = checkNoContactInfo(parsed.data.comment);
      if (contactError) return { ok: false, error: contactError };
    }

    const model = await prisma.modelProfile.findUnique({
      where: { id: parsed.data.modelId },
      select: { userId: true },
    });
    if (!model) return { ok: false, error: 'Modelo no encontrada.' };
    if (model.userId === user.id) {
      return { ok: false, error: 'No podes calificarte a vos misma.' };
    }

    const isNewReview = !(await prisma.review.findUnique({
      where: { modelId_userId: { modelId: parsed.data.modelId, userId: user.id } },
      select: { id: true },
    }));

    await prisma.$transaction(async (tx) => {
      await tx.review.upsert({
        where: {
          modelId_userId: { modelId: parsed.data.modelId, userId: user.id },
        },
        create: {
          modelId: parsed.data.modelId,
          userId: user.id,
          rating: parsed.data.rating,
          comment: parsed.data.comment?.trim() || null,
        },
        update: {
          rating: parsed.data.rating,
          comment: parsed.data.comment?.trim() || null,
        },
      });

      if (isNewReview) {
        await createNotification(tx, {
          userId: model.userId,
          type: 'NEW_REVIEW',
          title: `${user.name ?? 'Alguien'} te dejo una resena de ${parsed.data.rating} estrellas`,
          link: `/models/${parsed.data.slug}`,
        });
      }

      const agg = await tx.review.aggregate({
        where: { modelId: parsed.data.modelId },
        _avg: { rating: true },
        _count: true,
      });

      await tx.modelProfile.update({
        where: { id: parsed.data.modelId },
        data: {
          ratingAvg: agg._avg.rating ?? 0,
          ratingCount: agg._count,
        },
      });
    });

    revalidatePath(`/models/${parsed.data.slug}`);
    return { ok: true, message: 'Gracias por tu resena.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion para dejar una resena.';
    return error.message;
  }
  return 'No se pudo guardar la resena. Intenta de nuevo.';
}
