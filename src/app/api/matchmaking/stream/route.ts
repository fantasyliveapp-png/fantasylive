import { NextRequest } from 'next/server';

import { getCurrentUser } from '@/lib/auth/guards';
import { pollQueue } from '@/lib/matchmaking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Server-Sent Events para el estado de la cola de emparejamiento.
 *
 * Alternativa a WebSockets valida en Vercel Serverless: el navegador mantiene
 * una conexion HTTP y el servidor empuja el estado. El bucle hace de heartbeat
 * de la entrada en cola, asi que ademas mantiene viva la posicion del usuario.
 *
 * GET /api/matchmaking/stream?entryId=xxx
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const entryId = request.nextUrl.searchParams.get('entryId');
  if (!entryId) {
    return new Response('entryId requerido', { status: 400 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      send('connected', { entryId });

      // Vercel Hobby corta las funciones a los ~60s; el cliente reconecta solo.
      const maxIterations = 55;

      for (let i = 0; i < maxIterations && !closed; i++) {
        try {
          const result = await pollQueue(entryId, user.id);

          if (result.status === 'matched') {
            send('matched', result);
            break;
          }
          if (result.status === 'cancelled' || result.status === 'expired') {
            send('ended', result);
            break;
          }

          send('waiting', { ...result, tick: i });
        } catch (error) {
          send('error', {
            message: error instanceof Error ? error.message : 'error',
          });
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (!closed) {
        send('reconnect', { reason: 'timeout' });
        controller.close();
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
