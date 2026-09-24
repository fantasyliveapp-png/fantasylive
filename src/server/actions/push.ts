'use server';

import { headers } from 'next/headers';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { isPushConfigured, sendPush } from '@/lib/push';

export interface PushActionResult {
  ok: boolean;
  error?: string;
}

const subscriptionSchema = z.object({
  endpoint: z.string().url().startsWith('https://').max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** Guarda este dispositivo para recibir avisos (uno por navegador). */
export async function savePushSubscriptionAction(input: unknown): Promise<PushActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    if (!isPushConfigured()) return { ok: false, error: 'Los avisos no estan configurados.' };
    const sub = subscriptionSchema.safeParse(input);
    if (!sub.success) return { ok: false, error: 'Suscripcion no valida.' };
    const userAgent = (await headers()).get('user-agent')?.slice(0, 300) ?? null;

    // Si otra cuenta uso este mismo navegador, los avisos pasan a esta.
    await prisma.pushSubscription.upsert({
      where: { endpoint: sub.data.endpoint },
      create: {
        userId: user.id,
        endpoint: sub.data.endpoint,
        p256dh: sub.data.keys.p256dh,
        auth: sub.data.keys.auth,
        userAgent,
      },
      update: {
        userId: user.id,
        p256dh: sub.data.keys.p256dh,
        auth: sub.data.keys.auth,
        userAgent,
      },
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Error inesperado.' };
  }
}

/** Deja de enviar avisos a este dispositivo. */
export async function removePushSubscriptionAction(endpoint: string): Promise<PushActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Error inesperado.' };
  }
}

/** Aviso de prueba a los dispositivos de quien lo pide. */
export async function sendTestPushAction(): Promise<PushActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const sent = await sendPush([user.id], {
      title: 'Avisos activados',
      body: 'Asi te avisaremos de mensajes, directos y novedades.',
      url: '/',
      tag: 'prueba',
    });
    return sent > 0 ? { ok: true } : { ok: false, error: 'No se pudo enviar el aviso de prueba.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Error inesperado.' };
  }
}
