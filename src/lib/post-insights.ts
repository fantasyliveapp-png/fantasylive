import 'server-only';

import { prisma } from '@/lib/prisma';

/**
 * COMO VA CADA PUBLICACION (para la creadora).
 *
 * Tasa de interaccion = (me gusta + 2·comentarios + 3·desbloqueos) / vistas.
 * Se compara con las publicaciones de toda la plataforma que ya pasaron la
 * fase de prueba en los ultimos 30 dias, para poder decirle "funciona mejor
 * que el 80 % de las publicaciones".
 */

/** Personas que tienen que verla para salir de la fase de prueba. */
export const TEST_AUDIENCE = 40;
/** Vistas en las que se avisa a la creadora. */
const MILESTONES = [TEST_AUDIENCE, 100, 500, 1000, 5000, 10000, 50000];

export function engagementOf(p: {
  likeCount: number;
  commentCount: number;
  unlockCount: number;
}) {
  return p.likeCount + 2 * p.commentCount + 3 * p.unlockCount;
}

export function engagementRate(p: {
  likeCount: number;
  commentCount: number;
  unlockCount: number;
  viewCount: number;
}) {
  return p.viewCount > 0 ? engagementOf(p) / p.viewCount : 0;
}

/**
 * Tasas de interaccion de las publicaciones ya "probadas" (>= 40 vistas) de
 * los ultimos 30 dias, ordenadas: sirven para sacar percentiles.
 */
export async function getBenchmarkRates(): Promise<number[]> {
  const rows = await prisma.post.findMany({
    where: {
      isPublished: true,
      viewCount: { gte: TEST_AUDIENCE },
      createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
    },
    select: { likeCount: true, commentCount: true, unlockCount: true, viewCount: true },
    take: 5000,
  });
  return rows.map(engagementRate).sort((a, b) => a - b);
}

/** Porcentaje de publicaciones a las que supera (0-100), o null sin datos. */
export function percentileOf(rate: number, sortedRates: number[]): number | null {
  if (sortedRates.length < 5) return null;
  const below = sortedRates.filter((r) => r < rate).length;
  return Math.round((below / sortedRates.length) * 100);
}

/**
 * Tras sumar vistas nuevas: si alguna publicacion acaba de cruzar un hito,
 * se avisa a su creadora (una sola vez por hito: el contador solo sube de
 * uno en uno por persona, asi que el hito se cruza exactamente una vez).
 */
export async function notifyPostMilestones(postIds: string[]): Promise<void> {
  try {
    const posts = await prisma.post.findMany({
      where: { id: { in: postIds }, viewCount: { in: MILESTONES } },
      select: {
        id: true,
        body: true,
        viewCount: true,
        likeCount: true,
        commentCount: true,
        unlockCount: true,
        model: { select: { userId: true } },
      },
    });
    if (posts.length === 0) return;

    const benchmark = posts.some((p) => p.viewCount === TEST_AUDIENCE)
      ? await getBenchmarkRates()
      : [];

    for (const post of posts) {
      const snippet = post.body ? `"${post.body.slice(0, 50)}${post.body.length > 50 ? '…' : ''}"` : 'Tu publicacion';
      let title: string;
      let body: string;

      if (post.viewCount === TEST_AUDIENCE) {
        const pct = percentileOf(engagementRate(post), benchmark);
        title = 'Tu publicacion ha superado la fase de prueba';
        body =
          pct === null
            ? `${snippet} ya la han visto ${TEST_AUDIENCE} personas. Ahora sigue llegando segun lo que guste.`
            : pct >= 50
              ? `${snippet} funciona mejor que el ${pct} % de las publicaciones: la seguiremos ensenando a mas gente.`
              : `${snippet} esta por debajo de la media${pct > 0 ? ` (mejor que el ${pct} %)` : ''}. Mira en Alcance que funciona mejor.`;
      } else {
        title = `${post.viewCount.toLocaleString('es')} personas han visto tu publicacion`;
        body = `${snippet} sigue creciendo. Mira los detalles en Alcance.`;
      }

      await prisma.notification.create({
        data: {
          userId: post.model.userId,
          type: 'POST_INSIGHT',
          title,
          body,
          link: '/dashboard/model/alcance',
        },
      });
    }
  } catch {
    // Un aviso que falla no puede tumbar el registro de vistas.
  }
}
