'use server';

import { revalidatePath } from 'next/cache';
import { Gender } from '@prisma/client';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { getVisibilityContext } from '@/lib/geo';
import { prisma } from '@/lib/prisma';
import { getSuggestedCreators, type SuggestedCreator } from '@/lib/recommend';
import { LOOKING_FOR_IDS, TASTE_TAG_IDS } from '@/lib/tastes';

export interface TastesActionResult {
  ok: boolean;
  error?: string;
  suggestions?: SuggestedCreator[];
}

const tastesSchema = z.object({
  preferredGenders: z.array(z.nativeEnum(Gender)).max(10),
  interests: z.array(z.string()).max(TASTE_TAG_IDS.length),
  lookingFor: z.array(z.string()).max(LOOKING_FOR_IDS.length),
});

/**
 * Guarda los gustos de la bienvenida (o de "Tus gustos" en el menu) y
 * devuelve creadoras que encajan, para el ultimo paso.
 */
export async function saveTastesAction(input: {
  preferredGenders: string[];
  interests: string[];
  lookingFor: string[];
}): Promise<TastesActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const parsed = tastesSchema.safeParse({
      preferredGenders: [...new Set(input.preferredGenders)],
      interests: [...new Set(input.interests)].filter((t) => TASTE_TAG_IDS.includes(t)),
      lookingFor: [...new Set(input.lookingFor)].filter((l) => LOOKING_FOR_IDS.includes(l)),
    });
    if (!parsed.success) return { ok: false, error: 'Respuestas no validas.' };

    const tastes = parsed.data;

    await prisma.user.update({
      where: { id: user.id },
      data: { ...tastes, onboardedAt: new Date() },
    });

    const { filter: geoFilter } = await getVisibilityContext();
    const suggestions = await getSuggestedCreators({ viewerId: user.id, tastes, geoFilter });

    revalidatePath('/feed');
    return { ok: true, suggestions };
  } catch {
    return { ok: false, error: 'No se pudieron guardar tus gustos.' };
  }
}

/** "Saltar": no vuelve a preguntar, y el Descubrir sigue cronologico. */
export async function skipTastesAction(): Promise<TastesActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    await prisma.user.update({
      where: { id: user.id },
      data: { onboardedAt: new Date() },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: 'No se pudo guardar.' };
  }
}
