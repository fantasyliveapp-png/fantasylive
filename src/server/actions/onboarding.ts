'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Gender } from '@prisma/client';

import { refreshSession } from '@/lib/auth';
import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { GENDER_LABELS } from '@/lib/constants';
import { createCreatorProfile } from '@/lib/creator-profile';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  stageName: z.string().trim().min(2).max(40),
  gender: z.enum(Object.keys(GENDER_LABELS) as [Gender, ...Gender[]]),
});

/** Activa el modo creadora en una cuenta que ya existe (un solo paso). */
export async function createModelProfileAction(input: {
  stageName: string;
  gender: Gender;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await getAuthedUserOrThrow();
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Revisa tu nombre de creadora.' };

    const account = await prisma.user.findUnique({
      where: { id: user.id },
      select: { orientation: true, country: true, modelProfile: { select: { id: true } } },
    });
    if (account?.modelProfile) return { ok: true };

    await createCreatorProfile(user.id, {
      stageName: parsed.data.stageName,
      gender: parsed.data.gender,
      orientation: account?.orientation ?? undefined,
      country: account?.country,
    });

    // El rol nuevo entra en la sesion ya: sin esto el panel quedaria
    // bloqueado (rol viejo en el token) hasta volver a iniciar sesion.
    await refreshSession({});

    revalidatePath('/dashboard/model');
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Error inesperado.',
    };
  }
}
