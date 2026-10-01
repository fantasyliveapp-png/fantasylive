'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';

import { ANON_TASTE_COOKIE, decodeAnonTaste } from '@/lib/anon-taste';
import { getCurrentUser } from '@/lib/auth/guards';
import { getVisibilityContext } from '@/lib/geo';
import { getFollowingFeed, getSubscriptionsFeed, type FeedPost } from '@/lib/posts';
import { getForYouFeed } from '@/lib/recommend';

const PAGE_SIZE = 10;

const discoverSchema = z.object({
  exclude: z.array(z.string().max(40)).max(1000),
  sessionStart: z.number().int().positive(),
});

/** Siguiente tanda del Descubrir (scroll infinito). */
export async function loadDiscoverAction(input: {
  exclude: string[];
  sessionStart: number;
}): Promise<FeedPost[]> {
  const parsed = discoverSchema.safeParse(input);
  if (!parsed.success) return [];
  const [viewer, { filter: geoFilter }, jar] = await Promise.all([
    getCurrentUser(),
    getVisibilityContext(),
    cookies(),
  ]);
  // Una sesion de mas de 6 h se considera nueva.
  const start = Math.max(parsed.data.sessionStart, Date.now() - 6 * 3600_000);
  return getForYouFeed({
    viewerId: viewer?.id ?? null,
    geoFilter,
    take: PAGE_SIZE,
    sessionStart: new Date(Math.min(start, Date.now())),
    exclude: parsed.data.exclude,
    anonTaste: viewer ? null : decodeAnonTaste(jar.get(ANON_TASTE_COOKIE)?.value),
  });
}

/** Siguiente tanda de Siguiendo (por fecha, con cursor). */
export async function loadFollowingAction(cursor: string): Promise<FeedPost[]> {
  const viewer = await getCurrentUser();
  if (!viewer || typeof cursor !== 'string' || cursor.length > 40) return [];
  const { filter: geoFilter } = await getVisibilityContext();
  return getFollowingFeed({ viewerId: viewer.id, geoFilter, take: PAGE_SIZE, cursor });
}

/** Siguiente tanda de las exclusivas de sus suscripciones (perfil del fan). */
export async function loadSubscriptionsAction(
  cursor: string,
  modelId?: string | null,
): Promise<FeedPost[]> {
  const viewer = await getCurrentUser();
  if (!viewer || typeof cursor !== 'string' || cursor.length > 40) return [];
  if (modelId != null && (typeof modelId !== 'string' || modelId.length > 40)) return [];
  const { filter: geoFilter } = await getVisibilityContext();
  return getSubscriptionsFeed({ viewerId: viewer.id, geoFilter, modelId, take: PAGE_SIZE, cursor });
}
