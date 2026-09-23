'use server';

import { revalidatePath } from 'next/cache';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';

export interface FollowActionResult {
  ok: boolean;
  error?: string;
  following?: boolean;
}

/** Alterna seguir/dejar de seguir a una modelo y ajusta su contador. */
export async function toggleFollowAction(
  modelId: string,
  slug: string,
): Promise<FollowActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const model = await prisma.modelProfile.findUnique({
      where: { id: modelId },
      select: { userId: true },
    });
    if (!model) return { ok: false, error: 'Modelo no encontrada.' };
    if (model.userId === user.id) {
      return { ok: false, error: 'No podes seguirte a vos misma.' };
    }

    const existing = await prisma.follow.findUnique({
      where: { userId_modelId: { userId: user.id, modelId } },
      select: { id: true },
    });

    if (existing) {
      await prisma.$transaction([
        prisma.follow.delete({ where: { id: existing.id } }),
        prisma.modelProfile.update({
          where: { id: modelId },
          data: { followersCount: { decrement: 1 } },
        }),
      ]);
      revalidatePath(`/models/${slug}`);
      return { ok: true, following: false };
    }

    await prisma.$transaction(async (tx) => {
      await tx.follow.create({ data: { userId: user.id, modelId } });
      await tx.modelProfile.update({
        where: { id: modelId },
        data: { followersCount: { increment: 1 } },
      });
      await createNotification(tx, {
        userId: model.userId,
        type: 'NEW_FOLLOWER',
        title: `${user.name ?? 'Alguien'} empezo a seguirte`,
        link: '/dashboard/model',
      });
    });
    revalidatePath(`/models/${slug}`);
    return { ok: true, following: true };
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return { ok: false, error: 'Debes iniciar sesion para seguir.' };
    }
    return { ok: false, error: 'No se pudo actualizar. Intenta de nuevo.' };
  }
}
