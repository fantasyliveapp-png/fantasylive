import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';

import {
  addAnonSignal,
  ANON_TASTE_COOKIE,
  ANON_TASTE_MAX_AGE,
  decodeAnonTaste,
  emptyAnonTaste,
  encodeAnonTaste,
} from '@/lib/anon-taste';
import { getCurrentUser } from '@/lib/auth/guards';
import { notifyPostMilestones } from '@/lib/post-insights';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        ms: z.number().int().min(0).max(3_600_000),
        done: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(50),
});

/** Tope por persona y publicacion: dejar el movil encima no cuenta 1 h. */
const MAX_DWELL_MS = 600_000;
/** Lo que suma cada persona al tiempo total de la publicacion. */
const MAX_WATCH_PER_VIEW = 60_000;
/** Menos que esto en pantalla = la paso de largo. */
const SKIP_MS = 1_500;

/**
 * POST /api/feed/impressions  { items: [{ id, ms, done }] }
 *
 * Lo que alguien ha mirado en el feed y durante cuanto tiempo (y si vio un
 * video entero). Llega en lotes, varias veces por publicacion: se acumula.
 *
 * - Con cuenta: se guarda por persona (una "vista" por persona) y se suman
 *   los totales de la publicacion, que usa el Descubrir y el panel de
 *   alcance. Al cruzar hitos de vistas se avisa a la creadora.
 * - Sin cuenta: se resume en la cookie de gustos anonimos.
 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  // Un mismo lote puede traer la misma publicacion dos veces: se juntan.
  const merged = new Map<string, { ms: number; done: boolean }>();
  for (const item of parsed.data.items) {
    const prev = merged.get(item.id);
    merged.set(item.id, {
      ms: (prev?.ms ?? 0) + item.ms,
      done: Boolean(prev?.done || item.done),
    });
  }
  const ids = [...merged.keys()];

  const user = await getCurrentUser();
  const posts = await prisma.post.findMany({
    where: { id: { in: ids }, isPublished: true },
    select: {
      id: true,
      model: { select: { id: true, userId: true, gender: true, tags: true } },
    },
  });

  if (!user) return trackAnonymous(posts, merged);

  const own = posts.filter((p) => p.model.userId !== user.id);
  const existing = await prisma.postImpression.findMany({
    where: { userId: user.id, postId: { in: own.map((p) => p.id) } },
    select: { postId: true, dwellMs: true, completed: true },
  });
  const before = new Map(existing.map((e) => [e.postId, e]));
  const newViews: string[] = [];

  for (const post of own) {
    const view = merged.get(post.id)!;
    const old = before.get(post.id);
    const oldDwell = old?.dwellMs ?? 0;
    const dwell = Math.min(oldDwell + view.ms, MAX_DWELL_MS);
    const completedNow = view.done && !old?.completed;

    if (!old) {
      try {
        await prisma.postImpression.create({
          data: { userId: user.id, postId: post.id, dwellMs: dwell, completed: view.done },
        });
      } catch {
        continue; // otra pestana la creo a la vez: esa ya sumo
      }
      newViews.push(post.id);
    } else {
      await prisma.postImpression.update({
        where: { userId_postId: { userId: user.id, postId: post.id } },
        data: { dwellMs: dwell, ...(completedNow ? { completed: true } : {}) },
      });
    }

    const watchDelta =
      Math.min(dwell, MAX_WATCH_PER_VIEW) - Math.min(oldDwell, MAX_WATCH_PER_VIEW);
    const skipDelta = !old
      ? dwell < SKIP_MS && !view.done
        ? 1
        : 0
      : oldDwell < SKIP_MS && !old.completed && (dwell >= SKIP_MS || completedNow)
        ? -1
        : 0;

    await prisma.post.update({
      where: { id: post.id },
      data: {
        ...(!old ? { viewCount: { increment: 1 } } : {}),
        ...(watchDelta > 0 ? { watchMs: { increment: BigInt(watchDelta) } } : {}),
        ...(completedNow ? { completions: { increment: 1 } } : {}),
        ...(skipDelta > 0 ? { skips: { increment: 1 } } : {}),
      },
    });
    // Al corregir una "pasada de largo" nunca por debajo de 0 (las vistas de
    // antes de medir el tiempo no contaron como tal).
    if (skipDelta < 0) {
      await prisma.post.updateMany({
        where: { id: post.id, skips: { gt: 0 } },
        data: { skips: { decrement: 1 } },
      });
    }
  }

  if (newViews.length > 0) await notifyPostMilestones(newViews);
  return new NextResponse(null, { status: 204 });
}

async function trackAnonymous(
  posts: { id: string; model: { id: string; gender: import('@prisma/client').Gender; tags: string[] } }[],
  merged: Map<string, { ms: number; done: boolean }>,
) {
  const jar = await cookies();
  const taste = decodeAnonTaste(jar.get(ANON_TASTE_COOKIE)?.value) ?? emptyAnonTaste();
  for (const post of posts) {
    const view = merged.get(post.id)!;
    addAnonSignal(taste, { postId: post.id, model: post.model, ms: view.ms, done: view.done });
  }
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(ANON_TASTE_COOKIE, encodeAnonTaste(taste), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ANON_TASTE_MAX_AGE,
    path: '/',
  });
  return response;
}
