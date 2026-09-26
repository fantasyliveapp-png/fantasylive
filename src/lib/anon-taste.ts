import 'server-only';

import type { Gender } from '@prisma/client';

/**
 * GUSTOS DE QUIEN NO TIENE CUENTA.
 *
 * Mientras alguien mira el Descubrir sin sesion, lo que mira (y cuanto rato)
 * se resume en una cookie pequena: que etiquetas, que tipo de persona y que
 * creadoras le interesan, y las ultimas publicaciones que ya vio. Con eso su
 * feed se personaliza desde la primera visita, y si se registra, sus
 * respuestas de bienvenida salen ya marcadas.
 *
 * Solo contiene ids y pesos (nada personal) y solo afecta a su propio feed.
 */

export const ANON_TASTE_COOKIE = 'fl_taste';
export const ANON_TASTE_MAX_AGE = 90 * 24 * 3600;

const MAX_CREATORS = 20;
const MAX_SEEN = 60;

export interface AnonTaste {
  /** etiqueta -> peso */
  t: Record<string, number>;
  /** genero -> peso */
  g: Partial<Record<Gender, number>>;
  /** creadora (modelId) -> peso */
  c: Record<string, number>;
  /** ultimas publicaciones vistas */
  s: string[];
  /** cuantas senales lleva */
  n: number;
}

export function emptyAnonTaste(): AnonTaste {
  return { t: {}, g: {}, c: {}, s: [], n: 0 };
}

export function decodeAnonTaste(raw: string | undefined | null): AnonTaste | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as AnonTaste;
    if (typeof data !== 'object' || !data || !Array.isArray(data.s)) return null;
    return {
      t: data.t ?? {},
      g: data.g ?? {},
      c: data.c ?? {},
      s: data.s.filter((x) => typeof x === 'string').slice(-MAX_SEEN),
      n: Number(data.n) || 0,
    };
  } catch {
    return null;
  }
}

export function encodeAnonTaste(taste: AnonTaste): string {
  const round = (o: Record<string, number>) =>
    Object.fromEntries(
      Object.entries(o)
        .map(([k, v]) => [k, Math.round(v * 10) / 10] as const)
        .filter(([, v]) => v !== 0),
    );
  // Solo las creadoras con mas peso (positivo o negativo): la cookie no crece.
  const creators = Object.entries(taste.c)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, MAX_CREATORS);
  const compact: AnonTaste = {
    t: round(taste.t),
    g: round(taste.g as Record<string, number>),
    c: round(Object.fromEntries(creators)),
    s: taste.s.slice(-MAX_SEEN),
    n: taste.n,
  };
  return Buffer.from(JSON.stringify(compact), 'utf8').toString('base64url');
}

/** Suma lo que acaba de mirar a su perfil. */
export function addAnonSignal(
  taste: AnonTaste,
  view: { postId: string; model: { id: string; gender: Gender; tags: string[] }; ms: number; done: boolean },
) {
  if (!taste.s.includes(view.postId)) taste.s.push(view.postId);

  let weight = 0;
  if (view.done) weight += 2;
  if (view.ms >= 8000) weight += 1;
  else if (view.ms >= 3000) weight += 0.3;

  if (view.ms < 1500 && !view.done) {
    // Pasada de largo: solo baja a esa creadora, no sus etiquetas.
    taste.c[view.model.id] = (taste.c[view.model.id] ?? 0) - 0.5;
    return;
  }
  if (weight === 0) return;

  taste.n += 1;
  taste.c[view.model.id] = (taste.c[view.model.id] ?? 0) + weight;
  taste.g[view.model.gender] = (taste.g[view.model.gender] ?? 0) + weight;
  for (const tag of view.model.tags) taste.t[tag] = (taste.t[tag] ?? 0) + weight;
}
