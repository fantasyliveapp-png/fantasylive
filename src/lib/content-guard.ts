import 'server-only';

import { prisma } from '@/lib/prisma';

/**
 * CONTENIDO SIN REPETIR entre el chat y los directos.
 *
 * Lo de los directos tiene que ser exclusivo: si un fan compra un pack en un
 * directo y luego le llega lo mismo por chat (o al reves), paga dos veces por
 * lo mismo. Cada archivo guarda su huella (SHA-256 del archivo) y aqui se
 * comprueba si ya existe en otro sitio del mismo creador.
 *
 * Solo detecta el MISMO archivo (si se edita o recorta, la huella cambia);
 * por eso tambien se avisa y se pide confirmacion al subir.
 */

export type ContentPlace = 'chat' | 'live' | 'post';

export const PLACE_LABEL: Record<ContentPlace, string> = {
  chat: 'tu Bóveda del chat',
  live: 'un pack de directo',
  post: 'una publicación',
};

/** Donde esta ya cada huella (solo las que existen). */
export async function findContentPlaces(modelId: string, hashes: string[]) {
  const list = [...new Set(hashes.filter(Boolean))].slice(0, 200);
  const found = new Map<string, ContentPlace>();
  if (list.length === 0) return found;
  const [vault, assets] = await Promise.all([
    prisma.vaultItem.findMany({
      where: { modelId, contentHash: { in: list } },
      select: { contentHash: true },
    }),
    prisma.postAsset.findMany({
      where: { contentHash: { in: list }, post: { modelId, removedAt: null } },
      select: { contentHash: true, post: { select: { liveExclusiveAt: true } } },
    }),
  ]);
  for (const a of assets) {
    if (a.contentHash) found.set(a.contentHash, a.post.liveExclusiveAt ? 'live' : 'post');
  }
  // El chat pisa a "publicacion" pero no a "directo" (lo mas grave).
  for (const v of vault) {
    if (v.contentHash && found.get(v.contentHash) !== 'live') found.set(v.contentHash, 'chat');
  }
  return found;
}

/**
 * Lo que NO se puede subir a `target`:
 *  - a directos: nada que ya este en el chat, en publicaciones o en otro pack.
 *  - al chat: nada que este en un pack de directo.
 */
export function blockedFor(target: 'chat' | 'live', place: ContentPlace | undefined) {
  if (!place) return false;
  return target === 'live' ? true : place === 'live';
}
