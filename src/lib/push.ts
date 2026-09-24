import 'server-only';

import webpush from 'web-push';

import { prisma } from '@/lib/prisma';

/**
 * AVISOS AL MOVIL (Web Push)
 *
 * Cada notificacion de la app tambien llega al movil u ordenador donde la
 * persona activo los avisos, aunque tenga la app cerrada. El contenido es
 * discreto por defecto: nunca se manda una foto ni texto explicito, solo el
 * aviso (se ve en la pantalla bloqueada).
 */

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:soporte@fantasylive.app';

let ready = false;
function configure() {
  if (ready) return true;
  if (!PUBLIC_KEY || !PRIVATE_KEY) return false;
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  ready = true;
  return true;
}

export function isPushConfigured() {
  return Boolean(PUBLIC_KEY && PRIVATE_KEY);
}

export interface PushPayload {
  title: string;
  body?: string;
  /** A donde lleva al tocarla. */
  url?: string;
  /** Avisos con el mismo tag se reemplazan (p. ej. varios mensajes de un chat). */
  tag?: string;
}

/** Envia un aviso a todos los dispositivos de estas personas. Nunca lanza. */
export async function sendPush(userIds: string[], payload: PushPayload): Promise<number> {
  if (!configure() || userIds.length === 0) return 0;
  let sent = 0;
  // Por tandas, para no abrir cientos de conexiones a la vez.
  for (let i = 0; i < userIds.length; i += 500) {
    const subs = await prisma.pushSubscription.findMany({
      where: { userId: { in: userIds.slice(i, i + 500) } },
    });
    const body = JSON.stringify({ ...payload, url: payload.url ?? '/' });
    // "topic" solo admite letras, numeros, - y _ (max 32).
    const topic = payload.tag?.replace(/[^A-Za-z0-9_-]/g, '').slice(-32) || undefined;
    for (let j = 0; j < subs.length; j += 20) {
      const results = await Promise.allSettled(
        subs.slice(j, j + 20).map((s) =>
          webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 60 * 60 * 24, urgency: 'normal', topic },
          ),
        ),
      );
      const gone: string[] = [];
      const used: string[] = [];
      results.forEach((r, k) => {
        const sub = subs[j + k]!;
        if (r.status === 'fulfilled') {
          sent += 1;
          used.push(sub.id);
        } else {
          const code = (r.reason as { statusCode?: number })?.statusCode;
          // 404/410: el navegador dio de baja los avisos; se borra.
          if (code === 404 || code === 410) gone.push(sub.id);
        }
      });
      if (gone.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
      if (used.length) {
        await prisma.pushSubscription.updateMany({
          where: { id: { in: used } },
          data: { lastUsedAt: new Date() },
        });
      }
    }
  }
  return sent;
}
