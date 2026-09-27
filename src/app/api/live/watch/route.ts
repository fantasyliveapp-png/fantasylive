import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  streamId: z.string().min(1).max(40),
  seconds: z.number().int().min(1).max(60),
});

/** Tope por persona y directo: dejar el movil encima no cuenta 5 h. */
const MAX_SECONDS_PER_VIEW = 3 * 3600;

/**
 * POST /api/live/watch  { streamId, seconds }
 *
 * Tiempo que alguien ha mirado un directo con la pestana visible. Llega por
 * tramos (cada ~15 s y al salir, con keepalive para que sobreviva al cerrar
 * la pestana) y se acumula en LiveView. Es la retencion que usa el
 * algoritmo de directos (lib/live-rank.ts).
 *
 * Es una ruta y no una server action precisamente por el keepalive: el
 * ultimo tramo se envia cuando la pagina ya se esta cerrando.
 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: true });

  const { streamId, seconds } = parsed.data;
  const stream = await prisma.liveStream.findUnique({
    where: { id: streamId },
    select: { status: true, modelId: true, model: { select: { userId: true } } },
  });
  // La creadora mirando su propio directo no cuenta.
  if (!stream || stream.status !== 'LIVE' || stream.model.userId === user.id) {
    return NextResponse.json({ ok: true });
  }

  const view = await prisma.liveView.upsert({
    where: { streamId_userId: { streamId, userId: user.id } },
    create: { streamId, userId: user.id, modelId: stream.modelId, seconds },
    update: { seconds: { increment: seconds } },
    select: { id: true, seconds: true },
  });
  if (view.seconds > MAX_SECONDS_PER_VIEW) {
    await prisma.liveView.update({
      where: { id: view.id },
      data: { seconds: MAX_SECONDS_PER_VIEW },
    });
  }

  return NextResponse.json({ ok: true });
}
