import 'server-only';

import type { Prisma } from '@prisma/client';

import { MODEL_TAGS, PUBLIC_MODEL_TAGS } from '@/lib/constants';
import { affinityOf, isPersonalized, type AffinityContext } from '@/lib/personal-search';
import { prisma } from '@/lib/prisma';

/**
 * BUSCADOR
 *
 * Busca creadoras por nombre artistico, @usuario, titular o #etiqueta. Aplica
 * las mismas reglas que el catalogo: solo perfiles verificados y activos, y
 * nunca los que bloquean el pais de quien busca (`geoFilter`).
 */

export interface SearchCreator {
  id: string;
  slug: string;
  stageName: string;
  headline: string | null;
  avatarUrl: string | null;
  isOnline: boolean;
  isLive: boolean;
  followersCount: number;
  tags: string[];
  /** % de afinidad con quien busca (solo si hay gustos o senales). */
  match?: number;
}

export interface SearchResult {
  query: string;
  creators: SearchCreator[];
  tags: string[];
}

const select = {
  id: true,
  slug: true,
  stageName: true,
  headline: true,
  avatarUrl: true,
  isOnline: true,
  followersCount: true,
  tags: true,
  gender: true,
  streams: { where: { status: 'LIVE' as const }, select: { id: true }, take: 1 },
} satisfies Prisma.ModelProfileSelect;

type Row = Prisma.ModelProfileGetPayload<{ select: typeof select }>;

function toCreator(row: Row): SearchCreator {
  return {
    id: row.id,
    slug: row.slug,
    stageName: row.stageName,
    headline: row.headline,
    avatarUrl: row.avatarUrl,
    isOnline: row.isOnline,
    isLive: row.streams.length > 0,
    followersCount: row.followersCount,
    tags: row.tags,
  };
}

/** Minusculas y sin acentos: "Asiática" encuentra la etiqueta "asiatica". */
export function normalizeQuery(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/^[@#]+/, '')
    .toLowerCase()
    .slice(0, 60);
}

function baseWhere(geoFilter: Prisma.ModelProfileWhereInput): Prisma.ModelProfileWhereInput {
  return { kycStatus: 'APPROVED', user: { status: 'ACTIVE' }, ...geoFilter };
}

export async function searchCreators(
  rawQuery: string,
  geoFilter: Prisma.ModelProfileWhereInput,
  /** Gustos de quien busca: suben lo que encaja con el y se ve su % de match. */
  affinity?: AffinityContext,
): Promise<SearchResult> {
  const q = normalizeQuery(rawQuery);
  if (!q) return { query: '', creators: [], tags: [] };

  // "lat" tambien encuentra a quien tiene la etiqueta "latina".
  const matchingTags = MODEL_TAGS.filter((t) => t.includes(q));

  const rows = await prisma.modelProfile.findMany({
    where: {
      ...baseWhere(geoFilter),
      OR: [
        { stageName: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q.replace(/\s+/g, ''), mode: 'insensitive' } },
        { headline: { contains: q, mode: 'insensitive' } },
        { tags: { has: q } },
        ...(matchingTags.length > 0 ? [{ tags: { hasSome: [...matchingTags] } }] : []),
      ],
    },
    take: 40,
    select,
  });

  // Orden: coincidencia exacta > empieza por > contiene; luego quien esta en
  // directo o conectada, y por ultimo seguidores.
  const score = (r: Row) => {
    const name = normalizeQuery(r.stageName);
    const slug = r.slug.toLowerCase();
    let s = 0;
    if (name === q || slug === q) s += 1000;
    else if (name.startsWith(q) || slug.startsWith(q)) s += 500;
    else if (name.includes(q) || slug.includes(q)) s += 250;
    else if (r.tags.includes(q)) s += 150;
    else if (r.tags.some((t) => matchingTags.some((m) => m === t))) s += 100;
    if (r.streams.length > 0) s += 80;
    if (r.isOnline) s += 40;
    return s + Math.min(30, Math.log10(r.followersCount + 1) * 6);
  };

  // Con gustos: la afinidad suma (sin pasar por encima de un nombre exacto).
  const personal = affinity && isPersonalized(affinity);
  const matches = new Map(
    personal
      ? rows.map((r) => [
          r.id,
          affinityOf(affinity, { ...r, isLive: r.streams.length > 0 }).match,
        ])
      : [],
  );
  const total = (r: Row) => score(r) + (matches.get(r.id) ?? 0) * 1.2;

  const creators = rows
    .sort((a, b) => total(b) - total(a))
    .slice(0, 24)
    .map((r) => ({ ...toCreator(r), ...(personal ? { match: matches.get(r.id) } : {}) }));

  // Etiquetas publicas que encajan con lo escrito (sugerencias rapidas).
  const tags = PUBLIC_MODEL_TAGS.filter((t) => t.includes(q)).slice(0, 6);

  return { query: q, creators, tags };
}
