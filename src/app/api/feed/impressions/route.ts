import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ ids: z.array(z.string().min(1).max(40)).min(1).max(50) });

/**
 * POST /api/feed/impressions  { ids: [postId, ...] }
 *
 * Publicaciones que la persona ha tenido al menos 1 s en pantalla. Cada
 * persona cuenta UNA vez por publicacion (viewCount = personas distintas),
 * que es lo que usa el Descubrir para repartir la visibilidad. Las propias
 * no cuentan. Se manda en lotes (y con sendBeacon al salir de la pagina).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 204 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const ids = [...new Set(parsed.data.ids)];

  const [posts, already] = await Promise.all([
    prisma.post.findMany({
      where: { id: { in: ids }, isPublished: true, model: { userId: { not: user.id } } },
      select: { id: true },
    }),
    prisma.postImpression.findMany({
      where: { userId: user.id, postId: { in: ids } },
      select: { postId: true },
    }),
  ]);
  const seen = new Set(already.map((a) => a.postId));
  const fresh = posts.map((p) => p.id).filter((id) => !seen.has(id));
  if (fresh.length === 0) return new NextResponse(null, { status: 204 });

  const created = await prisma.postImpression.createMany({
    data: fresh.map((postId) => ({ userId: user.id, postId })),
    skipDuplicates: true,
  });
  // Con dos pestanas a la vez puede colarse alguna repetida en createMany;
  // solo se suma si realmente se inserto la fila.
  if (created.count === fresh.length) {
    await prisma.post.updateMany({
      where: { id: { in: fresh } },
      data: { viewCount: { increment: 1 } },
    });
  } else {
    for (const postId of fresh) {
      const views = await prisma.postImpression.count({ where: { postId } });
      await prisma.post.update({ where: { id: postId }, data: { viewCount: views } });
    }
  }

  return new NextResponse(null, { status: 204 });
}
