import 'server-only';

import { cache } from 'react';

import { prisma } from '@/lib/prisma';

export interface ProfileShortcut {
  slug: string;
  stageName: string;
  avatarUrl: string | null;
}

/**
 * Datos minimos del perfil de la modelo en sesion para los accesos directos
 * (barra inferior, menu). Con `cache` la consulta se hace una vez por
 * peticion aunque la pidan el navbar y el layout a la vez (por eso recibe el
 * id y no el objeto de usuario: `cache` compara argumentos por referencia).
 */
export const getProfileShortcut = cache(
  async (modelProfileId: string | null | undefined): Promise<ProfileShortcut | null> => {
    if (!modelProfileId) return null;
    return prisma.modelProfile.findUnique({
      where: { id: modelProfileId },
      select: { slug: true, stageName: true, avatarUrl: true },
    });
  },
);
