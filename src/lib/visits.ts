import 'server-only';

import type { VisitSource } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/** Dia UTC en formato YYYY-MM-DD, clave de deduplicacion de visitas. */
export function utcDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Registra una visita al perfil, al directo o a una publicacion.
 *
 * Se deduplica por (perfil, visitante, origen, dia): recargar la ficha veinte
 * veces cuenta como una visita del dia, que es lo que la creadora espera leer
 * en sus analiticas. El contador `visits` guarda cuantas veces volvio ese dia,
 * por si interesa distinguir "curioseo" de "visita".
 *
 * Nunca lanza: es telemetria de producto, no puede tumbar la pagina que la
 * dispara. Tampoco registra la visita de la propia creadora a su perfil.
 */
export async function recordProfileVisit(params: {
  modelId: string;
  modelUserId?: string | null;
  viewerId: string | null;
  viewerCountry: string | null;
  source?: VisitSource;
}): Promise<void> {
  if (params.viewerId && params.modelUserId === params.viewerId) return;

  const source = params.source ?? 'PROFILE';
  const day = utcDay();

  try {
    // Solo las visitas con cuenta van a ProfileVisit: viewerId null no puede
    // participar en el unique compuesto de Prisma, asi que no se podrian
    // deduplicar. profileViews cuenta TODAS las cargas (con cuenta y sin
    // ella), y es el unico rastro que dejan los visitantes anonimos.
    if (params.viewerId) {
      await prisma.profileVisit.upsert({
        where: {
          modelId_viewerId_source_day: {
            modelId: params.modelId,
            viewerId: params.viewerId,
            source,
            day,
          },
        },
        create: {
          modelId: params.modelId,
          viewerId: params.viewerId,
          source,
          day,
          country: params.viewerCountry,
        },
        update: { visits: { increment: 1 } },
      });
    }

    await prisma.modelProfile.update({
      where: { id: params.modelId },
      data: { profileViews: { increment: 1 } },
    });
  } catch {
    // Ignorado a proposito: ver comentario de cabecera.
  }
}
