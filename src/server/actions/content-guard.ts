'use server';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { blockedFor, findContentPlaces, PLACE_LABEL, type ContentPlace } from '@/lib/content-guard';
import { prisma } from '@/lib/prisma';

/**
 * Antes de subir: ¿alguno de estos archivos ya esta en otro sitio?
 * Devuelve, por huella, donde esta y si eso impide subirlo a `target`.
 */
export async function checkContentAction(input: {
  hashes: string[];
  target: 'chat' | 'live';
}): Promise<{ ok: boolean; error?: string; data?: { hash: string; place: ContentPlace; label: string; blocked: boolean }[] }> {
  try {
    const user = await getAuthedUserOrThrow();
    const profile = await prisma.modelProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!profile) return { ok: false, error: 'Solo para creadores.' };
    const places = await findContentPlaces(profile.id, input.hashes);
    return {
      ok: true,
      data: [...places].map(([hash, place]) => ({
        hash,
        place,
        label: PLACE_LABEL[place],
        blocked: blockedFor(input.target, place),
      })),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Error' };
  }
}
